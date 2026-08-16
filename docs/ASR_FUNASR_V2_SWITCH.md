# expression-trainer — ASR Provider 切换：新增 FunASR v2（新版实时）设计文档

- 版本：v1.1
- 日期：2026-08-16
- 状态：已通过子智能体审查（3 P0 + 6 P1 已修订），待用户确认后进入开发
- 审查：deleg_916ac820（2026-08-16）
- 关联文档：
  - 服务端部署文档（正式版）：https://guwenhao.feishu.cn/docx/RVJ3dewWJoEJk0xh9iFcFgAtnpi
  - 现有 ASR 实现：`docs/FUNASR_WEBSOCKET_SPEC.md`（旧版 2pass 协议）、`server/asr/client.js`

---

## 1. 背景与目标

### 1.1 背景

用户已部署新版 FunASR 语音转写服务（Fun-ASR-Nano-2512，中英混说旗舰模型），提供两套服务：

| 服务 | 端口 | 类型 | 协议 |
|---|---|---|---|
| funasr-v2（离线 API） | 10097 | OpenAI 兼容 HTTP | POST /v1/audio/transcriptions |
| **funasr-realtime（实时 WS）** | **10095** | WebSocket 新版协议 | START/STOP 文本帧 + PCM 二进制帧 |
| funasr-cpu（旧服务） | 10096 | WebSocket 旧版协议 | 2pass 配置帧 + PCM 二进制帧 |

本项目（expression-trainer）当前使用 **funasr-cpu（10096）旧版服务**（`ws://192.168.156.68:10096`，2pass 协议，paraformer-zh 纯中文）。

### 1.2 目标

- **保留旧版 provider 不动**（funasr / 10096 旧协议路径原样保留）；
- 新增 **funasr-v2 provider**（10095 新版实时协议，Fun-ASR-Nano-2512 中英混说效果更好）；
- 设置页 ASR Provider 下拉**增加一个选项**切换，切换后立即生效（服务端读取配置时生效）；
- 不引任何新依赖（`ws` 包已存在）；不装任何模型/工具链（遵守 AGENTS.md 铁律）。

### 1.3 非目标

- 不改 FunASR 服务器侧任何东西；
- 不接入 10097 离线 HTTP API（本项目需要流式，只有 10095 匹配）；
- 不改动前端内部 WS 协议（前端↔后端仍然 `{type:'start'}`/binary/`{type:'stop'}`）。

---

## 2. 现状梳理（代码事实）

| 层 | 文件 | 现状 |
|---|---|---|
| 配置 | `server/config.js` | `DEFAULTS.asr = { provider: 'funasr', funasr: { wsUrl, token } }`；env 覆盖 `ASR_WS_URL`/`ASR_TOKEN` → `asr.funasr` |
| 配置样例 | `config/settings.example.json` | `provider: 'funasr'`，`funasr.wsUrl = ws://192.168.156.68:10096` |
| ASR 客户端 | `server/asr/client.js` | `createFunasrSession()`（旧版 2pass 协议，见 §2.1）；导出 `wavToPcm()` |
| WS 服务 | `server/ws/server.js` | `handleStart()` 用 `config.asr.funasr.wsUrl` 创建会话；统一回调 `onPartial/onFinal/onError`；`onFinal` 后做 `analyzeText()` 词库分析并下发 `asr-final` |
| 设置接口 | `server/routes/settings.js` | `maskSettings()` 脱敏；`PUT /settings` 写 `asr.funasr`；token 以 `****` 开头不覆盖 |
| 设置页前端 | `public/settings.html` / `settings.js` | Provider 下拉仅 `funasr` 一项；wsUrl/token 输入框绑定 `asr.funasr` |
| 前端主流程 | `public/api-client.js` / `app.js` / `recorder.js` | 与后端 WS 协议无关新旧（只发 start/binary/stop，收 asr-partial/asr-final/error）；**无需改动** |

### 2.1 旧版协议（createFunasrSession，现状保留）

- 上行：① 配置 JSON 文本帧（`mode:'2pass'`, `wav_format:'pcm'`, `chunk_size:[5,10,5]`…）→ ② 裸 PCM 二进制帧（16k/mono/16bit）→ ③ `{is_speaking:false,is_end:true}`；
- 下行：`2pass-offline`/`offline` → final；`online`+`!is_final` → partial；`is_end:true` → 关连接。
- 音频预处理 `wavToPcm()`（剥离 WAV 头）**可直接复用**：前端上传的是 WAV 帧，两个服务都要求裸 PCM。

---

## 3. 新版服务协议（funasr-realtime / 10095）事实

依据：飞书部署文档（正式版）§7.2，部署时实测压测记录。

### 3.1 上行（客户端 → 服务）

| 帧 | 内容 | 说明 |
|---|---|---|
| 文本 | `START` | 开始会话，服务端回 `{"event":"started"}` |
| 二进制 | PCM16 16kHz 单声道 | 流式推送音频 |
| 文本 | `STOP` | 结束会话，服务端做最终解码（`is_final:true`）并回 `{"event":"stopped"}` |
| 文本（可选） | `LANGUAGE:中文` | 动态改语言提示 |
| 文本（可选） | `HOTWORDS:词1,词2` / `POSTPROCESS_HOTWORDS:错=>对` | 热词/后处理纠正 |

### 3.2 下行（服务端 → 客户端）

| 消息 | 含义 |
|---|---|
| `{"event":"started"}` | 会话已开始 |
| `{"sentences":[],"partial":"识别中的中间文本","partial_start_ms":512,"duration_ms":512,"is_final":false}` | 流式 partial（未锁定） |
| `{"sentences":[{"text":"...","start":420,"end":5610}],...,"is_final":true}` | **最终结果**（STOP 后或 VAD 句边界触发） |
| `{"event":"stopped"}` | 会话已结束（可关连接） |
| `{"event":"error","error":"..."}` | 错误 |

关键语义：`is_final:true` 且 `sentences` 非空 = 定稿句（每个 VAD 句边界或 STOP 后各触发一次）；`partial` 非空 = 流式临时文本。

### 3.3 与旧版差异要点（影响实现）

| 维度 | 旧版（10096） | 新版（10095） |
|---|---|---|
| 会话建立 | 发配置 JSON | 发 `START` 文本帧 |
| 音频帧 | 裸 PCM 二进制 | 裸 PCM 二进制（**复用 wavToPcm**） |
| 结束 | `{is_end:true}` → 等 `is_end` 回执 | 发 `STOP` → 等 `stopped` |
| 定稿判定 | mode=2pass-offline | is_final=true 且 sentences 非空 |
| token 鉴权 | 无 | 无（ws://，不需要 rejectUnauthorized 配置） |

---

## 4. 总体设计

**核心思路：provider 路由 + 协议适配层。** 前后端内部 WS 协议不变；新增一个外部协议适配器（`createFunasrV2Session`），与现有 `createFunasrSession` 暴露**相同接口形态**（`{ writeAudio(wavBuffer), close() }` + 回调 `onPartial/onFinal/onError`），由 `server/ws/server.js` 按配置的 provider 选择。

改动范围（全部在项目目录内，5 个文件 + 2 个样例文件）：

```
server/config.js            # 配置模型：新增 asr.funasrV2 块 + env 覆盖
server/asr/client.js        # 新增 createFunasrV2Session（新版协议适配）+ 导出
server/ws/server.js         # handleStart 按 provider 路由；错误提示区分版本
server/routes/settings.js   # maskSettings/PUT 增加 funasrV2 字段
public/settings.html        # ASR Provider 下拉新增选项；label 随选项切换
public/settings.js          # load/save 按 provider 写 funasr 或 funasrV2；label 联动
config/settings.example.json# 新字段样例
.env.example                # ASR_V2_WS_URL 样例
```

不改：`public/api-client.js`、`public/recorder.js`、`server/index.js`、`lib/lexicon.js`。

---

## 5. 详细设计

### 5.1 配置模型（server/config.js）

**命名映射表（防混淆，审查 P1-5）**：

| provider 路由值（`asr.provider`） | 配置键（settings.json 字段） | 服务 |
|---|---|---|
| `'funasr'` | `asr.funasr` | 旧版 10096（2pass） |
| `'funasr-v2'` | `asr.funasrV2` | 新版 10095（START/STOP） |

```js
// DEFAULTS.asr 新增：
asr: {
  provider: 'funasr',                 // 'funasr'（旧版 10096）| 'funasr-v2'（新版 10095）
  funasr:   { wsUrl: '', token: '' }, // 旧版（保留现状）
  funasrV2: { wsUrl: '', token: '' }, // 新版（新增）
}

// .env 新增覆盖（loadEnv 后）：
if (env.ASR_V2_WS_URL) cached.asr.funasrV2.wsUrl = env.ASR_V2_WS_URL.trim();
if (env.ASR_V2_TOKEN)  cached.asr.funasrV2.token  = env.ASR_V2_TOKEN.trim();
// ASR_WS_URL / ASR_TOKEN 保持只映射 funasr（旧版），语义不变；新增 ASR_V2_* 避免歧义
```

兼容性：`loadSettings()` 现有 merge 逻辑对 `raw.asr.funasr` 合并缺省；需要**同样为 `funasrV2` 做缺省合并**：

```js
if (raw.asr) {
  raw.asr.funasr   = { ...DEFAULTS.asr.funasr,   ...(raw.asr.funasr || {}) };
  raw.asr.funasrV2 = { ...DEFAULTS.asr.funasrV2, ...(raw.asr.funasrV2 || {}) };
}
```

### 5.2 ASR 客户端适配器（server/asr/client.js）

新增导出 `createFunasrV2Session({ wsUrl, socket, onPartial, onFinal, onError })`，接口与旧版完全对齐：

```
流程：
1. new WebSocket(wsUrl)（同 http 内网 ws://，无需 rejectUnauthorized）
2. on('open') → ws.send('START')；随后显式 ws.send('LANGUAGE:中文')（审查 P1-2：规避中英混说模型默认语言行为不确定性，一行成本）
3. writeAudio(wavBuffer):
   - wavToPcm(wavBuffer)（复用现有导出）→ ws.send(pcm)  // 二进制帧
4. on('message'):
   - 若是字符串 → JSON.parse（parse 失败忽略，不触发 onError）：
     a. parsed.event === 'started' → ignore（或可选透传）
     b. parsed.is_final === true && Array.isArray(parsed.sentences)：
          const t = parsed.sentences.map(s => (s && typeof s.text === 'string') ? s.text : '').join('').trim();
          非空 → onFinal(t)；空 → 丢弃（审查 P0-1：防空句子污染统计/字幕/空分析请求）
     c. parsed.partial 非空且 !is_final → onPartial(parsed.partial)
     d. parsed.event === 'error' → onError(parsed.error || 'FunASR v2 服务端错误')
     e. parsed.event === 'stopped' → stoppedFlag = true（触发 close 收尾，见 step 7）
   - 二进制下行忽略（服务端不下发二进制）
5. on('error') → onError(`FunASR v2 连接错误: ${e.message}`)
6. on('close') 未主动关 → onError('FunASR v2 连接已断开')
7. close() → 置 closedFlag（仅抑制 onError 的 close 提示，**不拦截消息**）→ ws.send('STOP') → 等待 stoppedFlag（消息 handler 置位）后 ws.close()；兜底超时 15s 强制 close（审查 P0：CPU LLM 最终解码可数秒，官方示例单句 duration_ms 5616ms）
```

细节决策：

- **定稿判定**：`is_final === true && Array.isArray(sentences)`，且**拼接去空（trim）后非空才回调 onFinal**（审查 P0-1）。★注：部署文档写明 VAD 句边界也会触发 `is_final:true`，与旧版"每句 2pass-offline 定稿"语义一致；空文本定稿句（语音末尾静音/纯噪声）直接丢弃，不与旧版 `if (m.text)`（client.js L93-94）差。
- **partial 去重**：partial 是瞬态文本，作为 `asr-partial` 直发（前端已有 partial 覆盖语义，见 app.js 现状）。
- **STOP 后等待**：`close()` 发 STOP 后**等待服务端回 `{"event":"stopped"}` 再主动 close**（收到 stopped = 最终句已 flush 完毕），另设 15s 兜底超时防悬挂。**不采用旧版 500ms 节奏**（审查 P0-2）：旧版最终定稿句在结束帧**之前**已由 2pass-offline 逐句下发，500ms 只等 is_end 回执；新版唯一最终结果在 STOP **之后**由 CPU LLM 解码产生，500ms 关闭必然截断末尾语音。
- **并发**：`writeAudio` 在 `readyState !== OPEN` 时静默丢弃（与旧版一致）。

### 5.3 WS 服务路由（server/ws/server.js）

`handleStart()` 内修改（其余不动）：

```js
const config = getConfig();
const provider = config.asr?.provider || 'funasr';
// 白名单校验（审查 P1-3）：未知 provider 直接报错，避免静默回退旧版造成"选了新版实际连旧版"假象
if (!['funasr', 'funasr-v2'].includes(provider)) {
  send(socket, { type: 'error', message: `未知 ASR provider: ${provider}` });
  return;
}
const ep = provider === 'funasr-v2'
  ? { wsUrl: config.asr?.funasrV2?.wsUrl, token: config.asr?.funasrV2?.token, label: 'FunASR v2' }
  : { wsUrl: config.asr?.funasr?.wsUrl,   token: config.asr?.funasr?.token,   label: 'FunASR' };

if (!ep.wsUrl) {
  send(socket, { type: 'error', message: `${ep.label} 服务地址未配置（设置页或 .env）` });
  return;
}

const factory = provider === 'funasr-v2'
  ? require('../asr/client').createFunasrV2Session
  : require('../asr/client').createFunasrSession;

const session = factory({
  wsUrl: ep.wsUrl, token: ep.token, socket,
  onPartial: (text) => send(socket, { type: 'asr-partial', text }),
  onFinal:   async (text) => { const analysis = analyzeText(text); send(socket, { type: 'asr-final', text, analysis }); },
  onError:   (message) => send(socket, { type: 'error', message }),
});
```

说明：`handleAudioFrame` / `handleStop` / `socket.on('close')` 全部走 `session` 同一接口，**零改动**。

### 5.4 设置接口（server/routes/settings.js）

- `maskSettings()`：`asr` 增加 `funasrV2: { wsUrl: ..., token: token ? mask(token) : '' }`；
- `PUT /settings` 的 `body.asr` 处理：改为**按显式提交的块更新，未提交的块原样保留**（审查 P0-3：避免 provider 互切时「旧版块被清空 / 双块串扰」），token masked 不覆盖：

```js
if (body.asr) {
  next.asr = next.asr || {};
  if (body.asr.provider) next.asr.provider = body.asr.provider;
  // 显式提交的块才更新；未提交的块原样保留（防止 funasr ↔ funasrV2 互切双向清空，审查 P0-3）
  for (const key of ['funasr', 'funasrV2']) {
    const src = body.asr?.[key];
    if (!src) continue;
    const cur = next.asr[key] || {};
    next.asr[key] = {
      ...cur,
      wsUrl: typeof src.wsUrl === 'string' ? src.wsUrl.trim() : cur.wsUrl,
      token: src.token && !src.token.startsWith('****') ? src.token : (cur.token || ''),
    };
  }
}
```

### 5.5 设置页（public/settings.html + settings.js）

- 下拉新增：`<option value="funasr-v2">FunASR v2（新版实时）</option>`；
- **DOM 锚点**（审查 P1-4）：`settings.html` 中给 ASR 地址/口令 label 加 `id`（如 `id="asr-wsurl-label"`、`id="asr-token-label"`），切换 provider 时用 `textContent` 更新 label/hint（`FunASR v2 WebSocket 地址` vs `FunASR WebSocket 地址`）。不要用 `previousElementSibling` 等 DOM 形状推测；
- `loadSettings()`：按当前 provider 读取对应块 → `this.asrWsUrlInput.value = provider==='funasr-v2' ? asr.funasrV2?.wsUrl : asr.funasr?.wsUrl`（token 同理）；**切换 provider 时输入框不清空、不互相写入**（保留各自已加载的值，避免误把 A 的地址存进 B）；
- `save()`：payload **只提交当前 provider 对应的块**（v2 时 `asr: { provider, funasrV2: { wsUrl, token } }`，旧版时 `asr: { provider, funasr: { wsUrl, token } }`），配合服务端"未提交块保留"逻辑闭环；`asr.provider` 始终写当前选择（审查 P0-3）。

### 5.6 样例文件

- `config/settings.example.json`：`asr.funasrV2: { wsUrl: "ws://192.168.156.68:10095", token: "" }` 注释为示例；
- `.env.example`：`ASR_V2_WS_URL=ws://192.168.156.68:10095` `ASR_V2_TOKEN=`。

---

## 6. 对外行为（用户可感知的变化）

| 场景 | 行为 |
|---|---|
| 设置页选 `FunASR（旧版）` | 与现状完全一致（10096） |
| 设置页选 `FunASR v2（新版实时）` | 保存后启动录音 → 后端连 10095，走新版协议；识别文本走同一字幕/词库分析/反馈链路 |
| 未配置地址 | start 时收到 `error`：「FunASR（v2）服务地址未配置」 |
| 新版服务未启动/预热中（10095 vLLM 首次启动 3-5 分钟） | recv `error`「FunASR v2 连接错误/连接已断开」，前端字幕错误提示 |

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 新版服务 vLLM 预热慢，首连可能失败 | 错误信息明确；`ws.on('error')` 透传服务端/连接错误；不自动重试（与旧版一致，由用户重按开始） |
| `is_final` 句边界语义与旧版有差异 | 已在 §5.2 明确判定口径；联调用真实/示例音频验证 |
| partial 持续刷新造成前端频繁渲染 | 现状前端已有 partial 覆盖机制（app.js），新 provider 复用同一链路，无额外改动 |
| 设置页 token masked 误覆盖 | 沿用现有 `startsWith('****')` 保护逻辑（funasrV2 分支同样处理） |
| 默认 provider 切换导致行为突变 | **默认保持 `funasr`**；用户需显式在设置页切换 |
| API 兼容：settings.json 旧文件无 funasrV2 | config.js 默认合并（§5.1），无需迁移脚本 |

---

## 8. 验证方案（开发完成后执行）

1. **语法**：`npm run check`（node --check 全部 JS）；
2. **配置层**：启动 server，`GET /api/settings` 应返回 `asr.funasrV2` 新字段（脱敏）；`PUT` 保存后 `config/settings.json` 写入正确、token 不被 `****` 覆盖；
3. **连接路由**：provider=funasr 时后端连 10096（回归，旧协议不受影响）；provider=funasr-v2 时后端连 10095；
4. **新版识别**：临时在 scripts/ 下写一个 node 测试脚本（用 `ws` 包 + 复用 `wavToPcm`）：连 10095 → START → 推官方示例 PCM（或 16k wav）→ STOP → 断言收到 `is_final:true` 且 `sentences[0].text` **非空字符串**（收紧断言，审查 P1-6：同时覆盖 P0-1 空文本过滤的回归验证）；验证 `stopped` 事件后连接在兜底超时前正常关闭（覆盖 P0-2 的等待语义）。脚本写入项目目录，验证完按 TASKS.md 决定保留/删除；
5. **端到端（可选）**：浏览器开设置页切换到 FunASR v2 → 录音 → 识别文本出现在字幕。注：需本机浏览器 Web Audio 权限+内网可达 3000 端口（dev）。

---

## 9. 改动文件清单（交付核对）

| 文件 | 动作 |
|---|---|
| server/config.js | 修改（DEFAULTS + env + merge） |
| server/asr/client.js | 修改（新增 createFunasrV2Session；导出 wavToPcm 已有） |
| server/ws/server.js | 修改（provider 路由） |
| server/routes/settings.js | 修改（mask/PUT 加 funasrV2） |
| public/settings.html | 修改（下拉/label） |
| public/settings.js | 修改（load/save 按 provider） |
| config/settings.example.json | 修改（样例） |
| .env.example | 修改（ASR_V2_* 样例） |

新增文件：`docs/ASR_FUNASR_V2_SWITCH.md`（本文档）。

不引入新依赖；不改前端主流程协议；不改旧版 provider 路径。

---

## 10. 待确认项（开发前）

1. provider 取值命名：`funasr-v2`（本设计采用，与用户之前表述一致）— 如需改为 `funasr-realtime` 请指出；
2. 设置页 UI 采用「单输入框 + label 随 provider 切换」还是「分别显示两个 URL 输入框」？本设计默认前者（最小改动）；
3. 是否需要把新版实时服务加到 `.env.example`（本设计加）还是只在 settings.json 配置？