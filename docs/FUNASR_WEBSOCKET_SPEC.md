# FunASR WebSocket 流式识别对接规范（Node.js ws 客户端版）

> 调查基准：modelscope/FunASR `main` 分支官方仓库（截至 2026-08）。
> 直接证据来源（仓库内路径）：
> - `runtime/docs/websocket_protocol_zh.md` —— 官方通信协议文档（最权威）
> - `runtime/docs/SDK_tutorial_online_zh.md` / `runtime/docs/SDK_advanced_guide_online_zh.md` —— 部署/启动/并发指引
> - `runtime/python/websocket/funasr_wss_server.py` —— Python 服务端实现（协议处理）
> - `runtime/python/websocket/funasr_wss_client.py` / `funasr_client_api.py` —— Python 客户端
> - `runtime/html5/static/wsconnecter.js` + `main.js` —— 浏览器 JS 客户端（与 Node 协议完全一致）
> - `runtime/golang/websocket/go_ws_client.go` —— Go 客户端
> - `runtime/websocket/bin/` —— C++ 服务端/客户端（websocketpp）
> - `tests/test_websocket_file_finalization.py` —— 官方端到端协议测试

---

## 0. 三个核心结论（先看这个）

1. **上行**：连接建立后先发一条**文本帧（JSON 配置）**，之后所有音频都是**裸二进制帧（原始 PCM 字节）**，最后再发一条**文本帧（JSON 结束标志）**。没有 base64、没有 JSON 封装音频。
2. **下行**：服务端全部回复**文本帧 JSON**。`mode` 字段区分消息类型（`online`/`2pass-online` = 实时半截稿，`2pass-offline`/`offline` = 定稿），**`is_final` 表示该句定稿**，`is_end` 表示服务端已处理完输入。
3. **无鉴权、无特定路径**：官方 runtime 是裸 WebSocket 服务，`ws://host:port/`（根路径）直连即可，无 token/签名，无健康检测专用端点（用一条完整最小会话实测最可靠）。

---

## 1. WebSocket 服务端入口

| 项 | 结论 | 证据 |
|---|---|---|
| 默认端口 | **10095**（Python 与 C++ 服务端均为默认值）；docker 一键部署常映射为 **10096**（`-p 10096:10095`） | `funasr_wss_server.py` `--port default=10095`；`funasr-wss-server.cpp` `port` default 10095；`SDK_advanced_guide_online_zh.md` 中 `docker run -p 10096:10095` |
| 地址路径 | `ws(s)://<host>:<port>/`，**路径无要求**（Go 客户端写死 `Path: "/"`；Python `websockets.serve` 接受任意路径） | `go_ws_client.go` `url.URL{...Path: "/"}`；`funasr_wss_server.py` `websockets.serve(ws_serve, host, port)` |
| 协议子协议 | Python 服务端声明 `subprotocols=["binary"]`；**客户端不需要在握手时带子协议**（浏览器/Go 客户端都没带），`ws` 包无需任何配置 | `funasr_wss_server.py` main() |
| 启动方式 | **Python**：`python funasr_wss_server.py --port 10095`；**C++ runtime**：`funasr-wss-server` / `funasr-wss-server-2pass`（见 `runtime/run_server.sh`，`--port/--certfile/--keyfile/--decoder-thread-num/--io-thread-num` 等） | `runtime_html5_readme_zh.md`、`runtime_run_server.sh` |
| TLS | 传 `--certfile/--keyfile` 即 WSS；`--certfile 0` 关闭 SSL。**服务端证书默认是自签名**，Node `ws` 端需 `rejectUnauthorized:false`（或注自定义 CA） | `SDK_advanced_guide_online_zh.md`、`runtime/ssl_key/` |
| 健康检测 | **官方无 HTTP/WS 健康检查端点**（check_and_clean_connection 只是内部清理）。Node 端建议自己做：连接 + 最小会话，或 TCP connect 探测 | `websocket-server.cpp` 无任何 http handler |

---

## 2. 客户端握手 / 鉴权 / 首条配置消息

- **无鉴权**：官方所有客户端（Python/JS/Go/C++/Java/C#）连接时都**不带 token、无查询参数、无自定义 header**。
- **连接成功（onopen）后第一条消息必须是 JSON 文本帧**（配置消息），否则后续音频帧会被服务端丢弃（Python 服务端会打 `[WARN] chunk_size not set yet, skip audio frame` 并报错）。

### 配置消息 JSON（服务端文档 + 所有官方客户端一致）

```jsonc
{
  "mode": "2pass",                    // 必填："offline" | "online" | "2pass"（推荐）
  "wav_name": "demo",                 // 会话标识，服务端结果原样回传
  "wav_format": "pcm",                // 实时流固定 "pcm"（离线可传 mp3/mp4 等）
  "is_speaking": true,                // 必填 true；false 等同结束标志
  "chunk_size": [5, 10, 5],           // 流式延迟配置，见下方详解
  "chunk_interval": 10,               // 可选，默认 10
  "audio_fs": 16000,                  // PCM 采样率（8k/16k 都支持），实时流必带
  "itn": true,                        // 可选，数字归一化，默认 true
  "hotwords": "{\"阿里巴巴\":20,\"通义实验室\":30}",  // 可选，热词；NN 热词服务用逗号分隔字符串
  "encoder_chunk_look_back": 4,       // 可选（Python 客户端默认 4）
  "decoder_chunk_look_back": 0        // 可选（Python 客户端默认 0）
}
```

- `chunk_size: [5,10,5]` 含义：单次解码 600ms、回看 300ms、右看 300ms（`60*10/1000s`）。常用 `[5,10,5]`=600ms、`[8,8,4]`=480ms。**5/10/5 要与发送分片大小匹配**（见 §3）。
- `hotwords` 是个**字符串**，内容本身是 JSON（`{"词":权重}`）——注意 `"hotwords"` 的值是字符串而不是对象，别把对象直接序列化。
- 服务器 Python 版处理 `is_speaking`/`chunk_interval`/`wav_name`/`chunk_size`/`hotwords`/`mode`/`audio_fs`，**逐条消息可随时更新**（例如中途改热词）。
- 服务端有默认值：wav_name 默认 "microphone"/"wav-default-id"，audio_fs 默认 16000，mode 默认 "2pass"。

证据：`runtime/docs/websocket_protocol_zh.md`（实时识别首次通信）、`wsconnecter.js onOpen()`、`funasr_wss_client.py`、`go_ws_client.go`、`funasr_wss_server.py`（文本消息解析分支）。

---

## 3. 音频帧格式（Node.js 发送侧精确规格）

- **音频 = 裸二进制帧**：`ws.send(Buffer.from(pcmBytes))`，即 WebSocket **binary frame**，内容就是 **16-bit 小端（INT16LE）单声道 PCM**，**无 WAV 头、无任何封装**。
- 浏览器端 16k 采样：recorder 输出 PCM 字节 → 直接切 960 样本块（`960 = 16000/1000*60ms`）发送。**960 样本 = 1920 字节/60ms**，正好对应 chunk_size `[5,10,5]`。
- **分片大小建议**（Node 端直接抄）：
  - 每帧发送的 PCM 字节数 = `60 * chunk_size[1] / chunk_interval / 1000 * audio_fs * 2`
  - 例：`[5,10,5]` + `chunk_interval=10` + 16kHz → `60*10/10/1000*16000*2 = 1920 字节（960 样本 = 60ms）`
  - 例：`[8,8,4]` + `chunk_interval=10` → `60*8/10/1000*16000*2 = 1536 字节（48ms）`
- 发送节奏：实时流**每个分片间 sleep 60ms（= chunk 时长）**；压测可加速，但服务端推理是按收到的音频字节流积攒 chunk 的，发太快没关系（官方客户端有 `send_without_sleep` 压测模式）。
- 支持 8k/16k 采样率（`audio_fs` 声明）；2pass/online 模式服务端要求 pcm。
- C++ 离线客户端用 102400 字节大块发二进制也工作（服务端只是往字节缓冲 append），说明**服务端对分片大小不敏感**，只要总和正确 + 节奏合理即可。

证据：`main.js` `recProcess()`（960 采样切片、binary send）、`funasr_wss_client.py` stride 计算、`go_ws_client.go`、`funasr_wss_server.py`（`isinstance(message, bytes)` → append PCM）。

---

## 4. 下行消息结构（Node.js 接收侧解析规格）

服务端回复**全部是文本帧 JSON**（Python 用 `websocket.send(json.dumps(...))`，C++ 用 `opcode::text`）。字段（按出现频率）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `mode` | string | **消息类型**：`online`（实时）、`2pass-online`（2pass 实时半截稿）、`2pass-offline`（2pass 句尾纠错定稿）、`offline`（一句话识别） |
| `text` | string | 识别文本（可能为空字符串） |
| `wav_name` | string | 回声话标识（= 客户端配置消息里的 wav_name） |
| `is_final` | bool | **该句是否定稿**。`true` = 这一句到此为止（final）；`false` = partial（半截稿，会随后续音频更新） |
| `is_end` | bool | **服务端已处理完输入**（仅当客户端发了 `{"is_speaking":false,"is_end":true}` 时回复；可选字段，旧客户端无） |
| `timestamp` | string | 时间戳模型才有，格式是**字符串** `"[[100,200],[200,500]]"`（ms，需 JSON.parse） |
| `stamp_sents` / `sentence_info` | array/object | 句子级时间戳 / 句子信息（时间戳模型才有） |
| `spk_name` / `spk_score` | string/number | 声纹识别附加（Python 服务端新特性，没启用说话人验证则无） |
| `punc_array` | array | 标点序列（Python 服务端标点模型输出） |
| `error` | string | 出错时附在 `is_end` 确认包中（`is_final:false`） |

### partial 与 final 的判定规则（关键）

| mode | 半截稿(begin) | 定稿(final) | 备注 |
|---|---|---|---|
| `online` | `mode=online` 且 `is_final=false` | `is_final=true`（收到 `{"is_speaking":false}` 或 VAD 断句后） | 每 ~60ms 一条，text 是累计已识别内容 |
| `2pass` | `mode=2pass-online`，`is_final` 恒为 false | `mode=2pass-offline`（**最终结果以这条为准**） | 2pass 的 online 阶段不发 is_final=true（Python 服务端显式 return） |
| `offline` | 无 | 只有一条结果，`mode=offline`；**is_final 恒为 false**（C++ 服务端）或 true（Python 服务端），别以 is_final 判断离线完成 | 协议文档明确："offline 模式这个字段永远为 False，只返回一次结果" |

**Node 端建议的简单判据**：
- `mode === '2pass-offline' || mode === 'offline'` → 定稿句，累加进最终文本
- `mode === 'online' && is_final === true` → 定稿句（online 模式）
- `mode === '2pass-online' || (mode === 'online' && is_final === false)` → partial 半截稿，用于"边听边显示"，会被后续消息刷新
- `is_end === true` → 输入处理完毕（最终确认信号）

证据：`websocket_protocol_zh.md`（服务端→客户端消息结构）、`funasr_wss_server.py` `async_asr_online`/`async_asr`、`main.js` `getJsonMessage()`（`2pass-offline || offline` 追加到最终文本，`2pass-online/online` 追加到实时文本）。

---

## 5. 结束会话（完整关闭流程）

1. 发完最后的音频帧后，发一条 JSON 文本帧结束标志：
   - 朴素版（老协议，所有客户端都兼容）：`{"is_speaking": false}`
   - **推荐版（Python 服务端新特性，会回确认包）**：`{"is_speaking": false, "is_end": true}`
2. 服务端（仅 `is_end:true` 时）处理完所有缓冲的 online/offline 推理后，回复确认：
   ```json
   {"mode": "2pass", "wav_name": "demo", "is_final": true, "is_end": true}
   ```
   （失败时 `is_final:false` + `error:"..."`）
3. 收到 `is_end:true` 确认（或超时）后，客户端主动 `ws.close()`。
4. **说完一句话后也可不关连接继续发下一句**：官方客户端每个文件都走"配置(is_speaking:true) → 音频 → 结束(is_speaking:false)"循环，同一个连接可重复使用（`funasr_wss_client.py` 对 wav.scp 逐文件在同一连接上发；wav_name 起会话区分作用）。

注意：online/2pass 模式下提前 `ws.close()`（不等确认）也可，服务端 `on_close` 后会清理状态（`websocket-server.cpp on_close`、Python 版异常清理）；但会丢掉未 final 的结果。**正确做法是：等 `2pass-offline` / `is_final` 结果，再发结束标志，等 `is_end` 回执**。

证据：`funasr_wss_client.py`（`json.dumps({"is_speaking": False, "is_end": True})` → `wait_for(completion_queue)`）、`tests/test_websocket_file_finalization.py`、`funasr_client_api.py` `close()`（`{"is_speaking": False}` + sleep + close）、C++ 2pass 客户端（`is_final==true` 时 close）。

---

## 6. 完整生命周期（一次标准 2pass 会话）

```
Node 客户端                               FunASR 服务端
   │  1. new WebSocket("ws://host:10095/")   │
   │ ─────────────────────────────────────▶  │  握手（无鉴权）
   │◀─────────────────────────────────────   │  onopen
   │  2. send(JSON text) 配置                 │
   │ ─────────────────────────────────────▶  │  解析 mode/chunk_size/audio_fs...
   │  3. send(binary PCM 1920B) × N（每帧60ms）│
   │ ─────────────────────────────────────▶  │  实时解码 → VAD
   │◀─────────────────────────────────────│  {"mode":"2pass-online","text":"你","is_final":false}   ← partial 半截稿
   │◀─────────────────────────────────────│  {"mode":"2pass-online","text":"你好，","is_final":false}
   │  4. send(JSON text) {"is_speaking":false,"is_end":true}
   │ ─────────────────────────────────────▶  │
   │                                          │    flush online → offline 纠错、标点
   │◀─────────────────────────────────────│  {"mode":"2pass-offline","text":"你好，世界。","is_final":true,"timestamp":"..."}   ← 定稿
   │◀─────────────────────────────────────│  {"mode":"2pass","wav_name":"demo","is_final":true,"is_end":true}   ← 处理完成确认
   │  5. ws.close()（可复用连接继续下一轮）    │
```

在线（online）模式同样流程，只是定稿靠 `is_final:true` 而非 `2pass-offline`。
一句话离线（offline）模式：配置 → 音频推流（可快速发）→ 结束标志 → 收到唯一一条 `mode=offline` 结果。

---

## 7. 官方示例代码（最典型两个）

### 7.1 浏览器 JS（与 Node 协议完全一致）— runtime/html5/static/

发送侧（`wsconnecter.js` onOpen + `main.js` recProcess 合并要点）：

```js
// 连接
var speechSokt = new WebSocket(uri); // uri = "ws://host:10095" 或 wss://
// onopen 时发配置
speechSokt.onopen = function () {
  speechSokt.send(JSON.stringify({
    chunk_size: [5, 10, 5],
    wav_name: "h5",
    is_speaking: true,
    chunk_interval: 10,
    itn: true,
    mode: "2pass",
  }));
};
// 录音回调里：把 16k PCM 切成 960 样本（1920 字节）直接 send
while (sampleBuf.length >= chunk_size) {
  var sendBuf = sampleBuf.slice(0, chunk_size); // 960 samples
  speechSokt.send(sendBuf);                     // binary frame
  sampleBuf = sampleBuf.slice(chunk_size);
}
// 结束：发 JSON
speechSokt.send(JSON.stringify({ chunk_size: [5,10,5], wav_name:"h5", is_speaking: false, chunk_interval: 10, mode: "2pass" }));
```

接收侧（`main.js getJsonMessage`）：

```js
var msg = JSON.parse(event.data);
if (msg.mode === "2pass-offline" || msg.mode === "offline") {
  // 定稿句，追加到最终文本
} else {
  // 2pass-online / online 半截稿，追加到实时文本
}
```

参考 URL：https://github.com/modelscope/FunASR/tree/main/runtime/html5/static

### 7.2 Python 极简客户端（completion 确认版）— runtime/python/websocket/funasr_client_api.py

```python
rcg = Funasr_websocket_recognizer(host="127.0.0.1", port="10095", is_ssl=True, mode="2pass", chunk_size="0,10,5")
text = rcg.feed_chunk(data)   # send binary chunk, 同步取回一条结果
text = rcg.close(timeout=3)   # 发 {"is_speaking": False}，等结果后关闭
```

协议可参考 `funasr_wss_client.py` 完整版（含 `is_end` 确认等待，本规范已提炼其逻辑）。

---

## 8. 多路并发

- **官方支持高并发多客户端**，每个客户端一条独立 WebSocket 连接，连接间状态完全隔离（C++ 服务端 on_open 为每个连接建独立 `data_msg` 缓冲/解码句柄/热词）。
- Python 版：**单 server 单 client**（早期文档明确"单个server，支持单个client"；新版加了一定并发控制参数 `--worker_threads/--concurrent_*`，但仍是玩具级并发）。
- C++ runtime-SDK 版（生产推荐）：官方文档给出并发参考 —— 4 核 8G ≈ 16 路；16 核 32G ≈ 32 路；64 核 128G ≈ 100 路（`SDK_tutorial_online_zh.md`；`--decoder-thread-num` 即"支持的最大并发路数"）。
- 结论：**Node 端无需任何并发特殊处理**——每路一个 `new WebSocket()` 即可；具体上限取决于服务端部署形态（Python 单路 / C++ 高并发）与线程数配置。

---

## 9. Node.js 精确帧格式清单（写给 ws 包）

| 时机 | ws API | 内容 |
|---|---|---|
| onopen 后 | `ws.send(JSON.stringify({mode, wav_name, wav_format:"pcm", is_speaking:true, chunk_size:[5,10,5], chunk_interval:10, audio_fs:16000, itn:true}))` | 文本帧 |
| 推流中 | `ws.send(pcmBuf)`，`pcmBuf` 为 `Buffer`（**不要传 string**，保证 binary 帧） | 二进制帧，裸 INT16LE PCM，每帧 1920B/60ms（chunk_size=[5,10,5]） |
| 结束 | `ws.send(JSON.stringify({is_speaking:false, is_end:true}))` | 文本帧 |
| 收消息 | `ws.on('message', (data, isBinary) => { if (!isBinary) { const m = JSON.parse(data.toString('utf8')); ... } })` | **所有下行都是文本帧 JSON** |
| TLS | `new WebSocket(url, { rejectUnauthorized: false })`（自签证书时） | — |
| 握手 | 无需 path/subprotocol/header；若服务端强制校验 Origin 可带 `origin`（官方无此要求，推断） | — |

### 常见坑

1. **`hotwords` 是字符串**：`hotwords: JSON.stringify({"阿里巴巴":20})`，不是对象。
2. **`timestamp` 是字符串**：`"[[100,200],...]"`，要 JSON.parse。`stamp_sents`/`sentence_info` 是数组/对象。
3. **`is_final` 语义随 mode 不同**：offline 模式可能永远 false；2pass 最终结果看 `2pass-offline`，别只看 is_final。
4. **先发配置再发音频**，否则 Python 服务端丢帧（打印 WARN 并记 error）。
5. **不要用 `ws.send(str)` 发 PCM**：必须是二进制帧（服务端按 `frame::opcode::binary` 判定）。
6. **连接复用**：一句话结束（`is_end` 回执）后可以继续下一轮（重新发配置），不必重连。
7. 服务端 Python 版每连接是共享同一进程模型，长时间闲置可能被服务端清理；客户端重连逻辑按需实现（推断）。

---

## 附：典型 Node.js 最小实现骨架

```js
const WebSocket = require('ws');

function createFunasrStream({ url = 'ws://127.0.0.1:10095', mode = '2pass',
                              wavName = 'demo', fs = 16000,
                              chunkSize = [5, 10, 5], chunkInterval = 10, hotwords } = {}) {
  const ws = new WebSocket(url, { rejectUnauthorized: false });
  let onPartial = () => {}, onFinal = () => {}, onEnd = () => {}, onError = () => {};
  const stride = Math.round(60 * chunkSize[1] / chunkInterval / 1000 * fs * 2); // 1920B @16k

  ws.on('open', () => {
    const cfg = { mode, wav_name: wavName, wav_format: 'pcm', is_speaking: true,
                  chunk_size: chunkSize, chunk_interval: chunkInterval, audio_fs: fs, itn: true };
    if (hotwords) cfg.hotwords = JSON.stringify(hotwords);
    ws.send(JSON.stringify(cfg));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // 服务端不下发二进制
    const m = JSON.parse(data.toString('utf8'));
    if (m.mode === '2pass-offline' || m.mode === 'offline' || (m.mode === 'online' && m.is_final)) {
      onFinal(m);                       // 定稿句
    } else {
      onPartial(m);                     // 半截稿
    }
    if (m.is_end) onEnd(m);             // 输入处理完成
  });

  return {
    sendPcm(buf) { ws.send(buf); },           // Buffer: 裸 INT16LE PCM
    finish() { ws.send(JSON.stringify({ is_speaking: false, is_end: true })); },
    close() { ws.close(); },
    onPartial(fn) { onPartial = fn; }, onFinal(fn) { onFinal = fn; },
    onEnd(fn) { onEnd = fn; }, onError(fn) { ws.on('error', fn); },
  };
}
```

---

## 调查来源汇总

- 协议文档：`runtime/docs/websocket_protocol_zh.md`（https://github.com/modelscope/FunASR/blob/main/runtime/docs/websocket_protocol_zh.md）
- 服务端/客户端代码：`runtime/python/websocket/*`、`runtime/websocket/bin/*`、`runtime/html5/static/*`、`runtime/golang/websocket/*`
- 部署文档：`runtime/docs/SDK_tutorial_online_zh.md`、`runtime/docs/SDK_advanced_guide_online_zh.md`、`runtime/html5/readme_zh.md`、`runtime/run_server.sh`
- 官方测试：`tests/test_websocket_file_finalization.py`
- 标注"推断"的条目：健康检测端点、Origin 要求、重连策略（官方未文档化，为合理推断）。