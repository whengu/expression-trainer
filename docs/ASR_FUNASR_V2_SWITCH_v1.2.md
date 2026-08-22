# expression-trainer — ASR 切换 FunASR v2：最终执行设计（v1.2）

- 版本：v1.2（本次切换最终执行设计）
- 日期：2026-08-22
- 角色：architect 出设计；kanban 任务 t_125b4437
- 上游依据：
  - owner PRD：`docs/PRD_FUNASR_V2_SWITCH.md`（v1.0，24 条 AC，决策 D1/D2）
  - 既有适配设计（已过审、已实现）：`docs/ASR_FUNASR_V2_SWITCH.md`（v1.1，2026-08-16）
  - 服务端事实契约：飞书正式部署文档 §1.2/§1.3/§7.2/§10.3（https://guwenhao.feishu.cn/docx/RVJ3dewWJoEJk0xh9iFcFgAtnpi）
  - 代码事实：git commit 0fb6745（工作树除本 PRD 外干净；`config/settings.json` 不入库）
- 下游：developer（t_fcfb6016）实施 + 验证；tester（t_169a4a67）出报告；reviewer（t_90c23116）把关

## ★ 执行指示（developer 必读）

本次变更**按本文件（v1.2）执行**；`docs/ASR_FUNASR_V2_SWITCH.md`（v1.1）是适配层设计，其全部代码已随 commit 0fb6745 实现并评审，**本次不重写、不重复实现**，仅作为适配层内部语义（协议、会话状态机、空文本过滤 P0-1、STOP 等待 P0-2）的引用基线。若真实验收暴露适配层缺陷，修复须在 v1.1 §5 语义内进行，并将 diff 单独列入交付说明。

**本设计核心结论：本次「切换」零生产代码改动**——真正的缺口只有三件：① 运行配置 `config/settings.json` 启用 v2（D1）；② 真实中英混说端到端验证（工具扩展 + 用例设计）；③ 文档收尾（E 组）。验证工具（scripts/test_funasr_v2_ws.js 扩展）与文档属交付物，`npm run check` 覆盖。

---

## 1. 事实基线（已核验，逐条可溯源）

### 1.1 服务端契约（飞书部署文档）

| 服务 | 地址 | 协议 | 模型 | 本项目角色 |
|---|---|---|---|---|
| funasr-realtime（新） | `ws://192.168.156.68:10095` | 文本 `START` → 裸 PCM16 16k mono → 文本 `STOP`；下行 `started`/partial(`is_final:false`)/final(`is_final:true`+`sentences`)/`stopped`/`error` | Fun-ASR-Nano-2512（中英混说） | **本次切换目标** |
| funasr-cpu（旧） | `ws://192.168.156.68:10096` | 旧版 2pass 配置 JSON → 裸 PCM → 结束 JSON；下行 `2pass-offline`/`offline`=定稿 | paraformer-zh（纯中文） | 回归对象，保留可切回 |
| funasr-v2 离线 API | `http://192.168.156.68:10097` | OpenAI 兼容 HTTP | fun-asr-nano | 不接入（需流式） |

### 1.2 代码事实（commit 0fb6745，已逐文件核对)

| 层 | 文件 | 现状（= 已实现） |
|---|---|---|
| 配置 | `server/config.js` | `DEFAULTS.asr.provider='funasr'`；`funasrV2{wsUrl,token}` 缺省 + `loadSettings` 合并；env `ASR_V2_WS_URL/ASR_V2_TOKEN` 覆盖 |
| ASR 客户端 | `server/asr/client.js` | `createFunasrV2Session`（START+LANGUAGE:中文；is_final 拼接 trim 非空才 onFinal；STOP→等 stopped→15s 兜底）；`createFunasrSession` 原样保留 |
| WS 服务 | `server/ws/server.js` | provider 白名单 `['funasr','funasr-v2']`；缺 wsUrl 报 `` `${label} 服务地址未配置（config/settings.json 或 .env）` ``；onFinal→`analyzeText()`→下发 `asr-final{text,analysis}` |
| 设置接口 | `server/routes/settings.js` | `maskSettings` 含 funasrV2；PUT 按显式提交块更新，未提交块保留，token `****` 不覆盖 |
| 设置页 | `public/settings.js` | 双槽位 asrSlot 互不串扰；payload 只提交当前 provider 块 |
| 样例 | `config/settings.example.json` / `.env.example` | 均含 funasrV2(10095)/`ASR_V2_*` 样例 |

### 1.3 真实缺口（本次要做的）

1. `config/settings.json`：`provider:"funasr"` + 无 `funasrV2` 块（未启用 v2）。
2. 从未用真实中英混说音频端到端验证（直连 10095 / /ws 回环 / 字幕+词库+反馈链路）。
3. 文档未收尾：README 单 provider 描述；IMPLEMENTATION.md 无本次切换段；DECISIONS.md 无 v2 决策且旧条目「端口 10095」把新旧协议张冠李戴，需订正。

---

## 2. 产品决策落账（owner PRD §4，本设计照此执行）

| 决策 | 内容 | 对设计的影响 |
|---|---|---|
| D1 | 「切换」= 运行配置 `config/settings.json` 启用 `provider:"funasr-v2"` + `funasrV2.wsUrl=ws://192.168.156.68:10095`（开箱即走 v2）；旧 `funasr` 块原值保留 | §4 唯一运行配置改动 |
| D2 | 代码出厂缺省 `DEFAULTS.asr.provider` 保持 `'funasr'` 不改；`settings.example.json` 保留双块示例不切默认 | 不改 `server/config.js`；AC-A3 为静态核对 |
| D3 | provider 命名与双轨现状不变（`funasr` / `funasr-v2` 白名单）；前端内部 WS 协议不变；不接 10097 | 不产生改动 |
| D4 | 旧版 10096 路径零改动、可切回；回归允许「明确错误」形态 | §6 D 组 |
| v1.1 遗留 3 项待确认（v1.1 §10） | ① provider 取值 `funasr-v2`（采纳）；② 设置页单输入框 + label 随 provider 联动（已实现）；③ `.env.example` 加 `ASR_V2_*`（已实现） | 全部关闭，无开放项 |

---

## 3. 改动范围（全量）

**要改（交付物）：**

| 文件 | 动作 | 内容 | 是否入库 |
|---|---|---|---|
| `config/settings.json` | 修改（运行配置） | 见 §4 | 否（.gitignore，仅本工作区运行时状态） |
| `scripts/test_funasr_v2_ws.js` | 修改（验证工具扩展） | 见 §5.2 | 是 |
| `scripts/make_mixed_fixture.html` | 新增（fixture 录制助手，可选交付） | 见 §5.1 | 是 |
| `scripts/mixed_test.wav` | 新增（真实中英混说 fixture） | 见 §5.1 | 是（推荐，体积 <1MB） |
| `docs/IMPLEMENTATION.md` | 修改（E1） | 见 §7.1 | 是 |
| `docs/DECISIONS.md` | 修改（E2，含订正旧条目） | 见 §7.2 | 是 |
| `README.md` | 修改（E3） | 见 §7.3 | 是 |

**明确不改（杜绝返工）：** `server/config.js`、`server/asr/client.js`、`server/ws/server.js`、`server/routes/settings.js`、`server/index.js`、`public/*`、`lib/*`、`config/settings.example.json`、`.env.example`、`package.json`、`docs/FUNASR_WEBSOCKET_SPEC.md`（旧 2pass 协议参考，另见 §7.2 可选注记）。

**配置优先级事实**（设计依据，供验证时对照）：`env(.env) > config/settings.json > 代码 DEFAULTS`（`server/config.js` getConfig 顺序）。当前工作区**不存在 `.env`**，settings.json 为权威运行配置；若验证环境存在 `.env`，须先确认其中无生效的 `ASR_V2_WS_URL`（否则会覆盖 settings.json）。

---

## 4. 详细设计 A — 运行配置启用 v2（PRD AC-A 组）

### 4.1 改动动作（developer 实施）

1. 备份：`cp config/settings.json config/settings.json.bak-20260822`（项目目录内）。
2. 编辑 `config/settings.json`，**只改 asr 段**，llm/feedback 等其余段原样不动：

```jsonc
"asr": {
  "provider": "funasr-v2",                          // ← 原 "funasr" 改为此
  "funasr": {                                        // 旧版块原值保留（10096）
    "wsUrl": "ws://192.168.156.68:10096",
    "token": ""
  },
  "funasrV2": {                                      // ← 原文件无此块，新增
    "wsUrl": "ws://192.168.156.68:10095",
    "token": ""
  }
}
```

> ⚠️ 严禁把 settings.json 其余段（尤其 llm.custom.apiKey 密钥）复制进任何文档/日志/交付物；文档只出现 asr 段。

3. 校验：`node -e "const c=require('./config/settings.json'); console.log(c.asr.provider, c.asr.funasrV2.wsUrl, c.asr.funasr.wsUrl)"` 输出必须为 `funasr-v2 ws://192.168.156.68:10095 ws://192.168.156.68:10096`。

### 4.2 验证用例（AC-A 组映射）

| AC | 验证手段 | 通过判据 |
|---|---|---|
| AC-A1 | 上节 1~3 | provider==funasr-v2、funasrV2.wsUrl==10095、funasr.wsUrl==10096 保留 |
| AC-A2 | 启动 `node server/index.js` 后 `curl -s http://127.0.0.1:3000/api/settings` | 返回 `asr.provider=="funasr-v2"`、`funasrV2.wsUrl=="ws://192.168.156.68:10095"`、`funasrV2.token==""` 或脱敏 `****尾4` |
| AC-A3 | 静态核对（只读） | `server/config.js` `DEFAULTS.asr.provider==='funasr'`（grep `"provider: 'funasr'"`）；`server/ws/server.js` 白名单含 `'funasr','funasr-v2'`；两处均不改动 |
| AC-A4 | `node -e "JSON.parse(require('fs').readFileSync('config/settings.example.json','utf8'))"` 且 grep `.env.example` 含 `ASR_V2_WS_URL`/`ASR_V2_TOKEN` | parse 通过；两样例含 10095 字样；均不改动（现状已满足） |

---

## 5. 详细设计 B — 真实中英混说端到端验证（§PRD AC-B / AC-C）

### 5.1 FIX（fixture）规格与制备

**规格**：16 kHz / 单声道 / 16-bit PCM 的 WAV（或裸 PCM `.pcm`），时长 4~8s；语料用 PRD 推荐句：
「大家好，今天我们来聊聊在 Apple 的工作体验，我觉得 teamwork 很重要。」
（含 >30 汉字 + 2 个英文词；含「我觉得」，可驱动词库 hedges 计数。）存放 `scripts/mixed_test.wav`，作为可复现 fixture 入库。

**制备路径**（任一，均零新依赖）：
- **首选（推荐）**：新增交付助手 `scripts/make_mixed_fixture.html`（纯 HTML/CSS/JS，零依赖）：页面 `getUserMedia` + `AudioContext({sampleRate:16000})`（与 `public/recorder.js` 采集链路一致）录制 → 编码 16-bit mono WAV → 浏览器下载 `mixed_test.wav`，保存到 `scripts/`。无麦克风时该页提供「speechSynthesis 合成朗读语料 → 录下」的退化模式（系统 TTS，非模型文件、非产品功能，仅制卡用）。
- 备选：远程 TTS（如 edge-tts，若可用）生成同语料音频 → 转 16k mono PCM 置于 `scripts/`；转换只能使用项目内已有手段或本机既有工具，**不得新增依赖**。
- 兜底：两种都不可行时，**kanban_block 上报**（capability），禁止伪造音频/识别结果。

### 5.2 `scripts/test_funasr_v2_ws.js` 扩展规格（只增不改既有断言，输出格式兼容）

1. **参数解析**：保持 `args[0]=audioPath`、`args[1]=loopbackWs`；新增可选标志 `--mixed`（声明 FIX 为中英混说，启用 AC-B2 断言）。
2. **fixture 候选**：`findAudio()` candidates 在现有 `zh_*` 之后、`sample.*` 之前插入 `path.join(__dirname,'mixed_test.wav')`、`path.join(__dirname,'mixed_test.pcm')`（默认回归仍优先 zh_test.pcm，行为不变）。
3. **新增 helper**：
   ```js
   const MIXED_EN = /[A-Za-z]{2,}/;
   const MIXED_HAN = /[\u4e00-\u9fa5]{4,}/;
   const isMixedText = (t) => MIXED_EN.test(t) && MIXED_HAN.test(t); // AC-B2 存在性口径
   ```
4. **测试 1（直连 10095）**：useReal 分支且 `--mixed` 时，既有非空 final 断言后追加：
   `assert('AC-B2 中英混写口径', isMixedText(finalText), '全文=' + finalText)`；完整识别文本始终打印（供人工复核，不绑定具体单词）。
5. **测试 2（/ws 回环）**：
   - 增加真实音频分支：`loopbackWs` 给定且 fixture 存在 → 推真实音频（WAV→`wavToPcm`，裸 PCM 直送），否则维持静音退化；ready 后按 `start → 推音频 → 600ms → {type:'stop'}` 时序，**观察窗口 20s**（CPU LLM 最终解码可达数秒，部署文档 §10.3；现有 3s 窗口会截断真实定稿）。
   - 新增消息处理：`m.type==='asr-final'` → 记录 `finalText/finalAnalysis`，空文本时置 `emptyFinalSeen=true`。
   - 关闭后断言（useReal && `--mixed`）：收到 `asr-final` 且 `isMixedText(finalText)` 且 **analysis 结构与旧版一致**：
     `finalAnalysis && Array.isArray(finalAnalysis.fillers) && Array.isArray(finalAnalysis.hedges) && Array.isArray(finalAnalysis.vagueWords) && typeof finalAnalysis.density==='number' && Array.isArray(finalAnalysis.suggestions)`（对应 AC-C2）。
   - 静音分支追加：`assert('AC-C5 无空文本 asr-final 下行', !emptyFinalSeen, ...)`；`ready` 断言保留（AC-C1）。
6. **新增测试 3（AC-B5）**：连接死端口 `ws://127.0.0.1:59999`（或用环境变量 `ASR_V2_DEAD_PORT` 覆盖），断言 8s 内出现 `error`（ECONNREFUSED）或 close，进程不悬挂（整体超时 + `process.exit(fail?1:0)` 兜底已在脚本内）。
7. `npm run check` 必须通过（check-syntax.js 遍历 scripts/ 下全部 .js）。

### 5.3 直连 + 回环用例表（AC-B / AC-C 映射）

| AC | 命令/步骤 | 判定 |
|---|---|---|
| AC-B1 | `node scripts/test_funasr_v2_ws.js scripts/mixed_test.wav --mixed`（直连段） | started ✓；STOP 后 is_final:true 且 sentences 拼接非空 |
| AC-B2 | 同上 | 文本满足 `isMixedText`（≥2 个连续英文 + ≥4 汉字）；全部识别文本入报告 |
| AC-B3 | 同上 | 收到 stopped；连接在 STOP 后 15s 兜底内正常关闭 |
| AC-B4 | `node scripts/test_funasr_v2_ws.js`（无 fixture → 静音退化） | 无空串 final；生命周期 started→stopped 成立 |
| AC-B5 | 测试 3（死端口） | 明确连接失败，脚本 ≤8s 退出不悬挂 |
| AC-C1 | 启用 §4 配置启动 server 后：`node scripts/test_funasr_v2_ws.js scripts/mixed_test.wav ws://127.0.0.1:3000/ws --mixed` | 收到 `ready`（handleStart 建会话成功） |
| AC-C2 | 同上 | 收到 `asr-final{text,analysis}`；text 满足 AC-B2；analysis 结构合法（§5.2-5） |
| AC-C4 | 见 §5.4 | error 消息精确匹配 + 进程不崩溃 |
| AC-C5 | 静音回环分支 | 无空文本 `asr-final` 下行 |

### 5.4 AC-C4 用例（funasrV2.wsUrl 未配置 → 明确错误）

```
1) cp config/settings.json config/settings.json.bak-c4            # 项目目录内备份
2) 编辑 settings.json：asr.funasrV2.wsUrl 置 ""（只改这一处）
3) 重启 server（node server/index.js）
   → ws://127.0.0.1:3000/ws 发 {type:'start'}
   → 期望收到 {type:'error', message:'FunASR v2 服务地址未配置（config/settings.json 或 .env）'}   # 精确匹配 server/ws/server.js L75
   → curl /api/settings 仍 200（进程不崩溃）
4) 恢复：mv config/settings.json.bak-c4 config/settings.json；重启 server → ws start → ready（恢复后正常）
```

### 5.5 前端全链路 AC-C3（字幕/词库统计/高亮/反馈）

- **首选（浏览器实测）**：启动 server → 打开 `http://127.0.0.1:3000` → 设置页确认 provider=FunASR v2 → 主页用真实麦克风说推荐语料（或等价把 FIX 音频注入采集链路）→ 观察：字幕先出现 **partial**（`renderSubtitle(text,false)`）→ 停止后 **final 定稿**进入统计面板与高亮（`applyAnalysis`，fillers/hedges/vague 计数≥0 且与 analyzeText 一致）→ **AI 反馈**：若已配 LLM key 且达阈值，`/api/feedback` 返回 `{success:true, feedback}`。记录控制台/网络事件日志。
- **等价（无浏览器/无麦克风）**：协议层已由 §5.3 覆盖；词库链用返回的 asr-final 文本直调 `POST /api/feedback {text: <asr-final.text>}`，LLM 可达则断言 `success:true && feedback 非空`；LLM 不可达（网关不在线）则如实记录 `success:false` 与 error 原文——**与旧版同口径，不伪造成功**。字幕渲染属前端行为，无浏览器时以「事件顺序 + lib/lexicon.js 单测」为等价证据并在报告注明。
- **阈值注记**：默认 `autoThresholdChars=50`，推荐语料约 30~45 字元可能不足 50。前端触发 AI 反馈时先临时把阈值调低（如 20）或使用更长语料；测试后恢复默认 50（属测试操作，非交付改动）。

---

## 6. 详细设计 C — 旧版回退与可切回（AC-D 组）

**原则**：旧 `createFunasrSession`（10096 2pass）零改动；设置页/API 即可切回；切换无需重启（PUT → `saveSettings` 置空缓存 → 下次 `getConfig` 重载，`server/config.js` L116）。

| AC | 步骤（API 演示，设置页等价） | 判定 |
|---|---|---|
| AC-D1 | `curl -X PUT http://127.0.0.1:3000/api/settings -H 'Content-Type: application/json' -d '{"asr":{"provider":"funasr"}}'` → `curl -s /api/settings` 确认 provider==funasr → /ws start 录音。 | **两形态之一即通过**：① 10096 在线 → `asr-final` 文本纯中文正确；② 10096 不在线 → 收到明确 `FunASR 连接错误/连接已断开` error 且不崩溃。如实记录旧服务状态，不要求在线成功率 |
| AC-D2 | ① v2 地址=A（现 10095）；② `PUT {"asr":{"provider":"funasr","funasr":{"wsUrl":"ws://192.168.156.68:19999","token":""}}}`；③ `PUT {"asr":{"provider":"funasr-v2"}}`（不提交 funasrV2 块） | GET 返回 `funasrV2.wsUrl` 仍 A、`funasr.wsUrl` 仍 B；token 回显 `****` 后保存不覆盖原值 |
| AC-D3 | 上述 PUT 后**立即** /ws start | 无需重启即按目标 provider 路由（D1 步骤中顺带断言） |

**收尾铁律**：D 组测试结束后必须恢复 §4 终态（provider=funasr-v2 + 双块地址），并 `node -e` 校验，避免把本地配置停在测试态。

---

## 7. 详细设计 D — 文档收尾清单（AC-E 组）

### 7.1 `docs/IMPLEMENTATION.md`（E1：追加本次切换段落）

在文件末尾追加（日期、commit、配置变更、验收摘要、fixture 与回归工具，模板如下，`<...>` 处填真实验证输出）：

```markdown
## 2026-08-22 ASR 切换 FunASR v2（中英混说）完成

### 背景与变更
- 本次「切换」= 运行配置 config/settings.json 启用 provider=funasr-v2 + funasrV2.wsUrl=ws://192.168.156.68:10095（开箱即走 v2）；旧 funasr 块原值保留，设置页可一键切回（决策 D1/D2 见 DECISIONS.md）。
- 适配代码（createFunasrV2Session、/ws 路由、设置页双槽位）于 commit 0fb6745 已提交；本次零生产代码改动，仅运行配置 + 验证工具 + 文档。
- 执行设计：docs/ASR_FUNASR_V2_SWITCH_v1.2.md；PRD：docs/PRD_FUNASR_V2_SWITCH.md。

### 验收结果摘要
- A 组配置：AC-A1~A4 通过（settings.json 已启用 v2；/api/settings 脱敏正确；DEFAULTS.provider 保持 'funasr'；样例文件 JSON 合法含 10095）。
- B 组直连 10095：AC-B1~B5 通过（FIX=scripts/mixed_test.wav，识别文本：<粘贴完整输出>）。
- C 组 /ws 回环：AC-C1~C5 通过（asr-final text/analysis 与旧版结构一致；analysis=<贴 JSON>）。
- D 组回退：AC-D1~D3 通过（旧服务 10096 状态：<在线识别成功 / 不在线明确报错，如实填写>）。
- 红线：npm run check N/N OK；无新依赖；写盘仅项目目录。

### 回归工具与 fixture
- scripts/test_funasr_v2_ws.js 保留为回归工具（直连 10095 + /ws 回环双测试，含 --mixed 中英混说断言）。
- scripts/mixed_test.wav 为本次验收 fixture（16k mono 16-bit，语料<可选填写>）；scripts/make_mixed_fixture.html 可再录制。
```

### 7.2 `docs/DECISIONS.md`（E2：订正旧条目 + 新增决策行）

**订正旧条目**（2026-08-14 表内）——旧文「端口 10095、无鉴权、上行配置JSON→裸PCM→结束JSON、下行2pass-offline=定稿」把新旧两会话混为一谈，替换为两服务并存事实：

```markdown
| FunASR 协议（旧版 10096） | 子智能体调查官方仓库（58 API 调用） | 旧版 2pass：上行配置JSON→裸PCM→结束JSON、下行 2pass-offline/offline=定稿、is_end=完成确认；规范存 docs/FUNASR_WEBSOCKET_SPEC.md（旧版协议） |
| FunASR 其他版本协议（新版实时 10095） | 飞书部署文档 §7.2 + commit 0fb6745 实测 | 新版实时：START→裸PCM→STOP，下行 started/partial/is_final/stopped/error；无鉴权；**旧 10096 与 10095 并存，勿与旧版 2pass 混淆** |
```

**新增决策行**（2026-08-22）：

```markdown
| ASR v2 切换（D1/D2） | owner PRD 2026-08-22 裁决 | 运行配置 settings.json 默认启用 funasr-v2（10095 START/STOP，中英混说）；代码 DEFAULTS.provider 保持 'funasr'（出厂兜底）；provider 取值 'funasr'/'funasr-v2' 白名单双轨；旧版 10096 块保留可切回；不接入 10097 离线 HTTP |
```

**可选（建议）**：在 `docs/FUNASR_WEBSOCKET_SPEC.md` 头部加两行注记「本文档仅描述旧版 2pass 协议；生产环境旧服务=10096，新版实时=10095（见 DECISIONS.md）」，防未来误读。此项非 PRD 强制，developer 可做可不做，做了要计入交付说明。

### 7.3 `README.md`（E3：三处更新）

- **功能段**原：
  `- 🎤 **实时语音识别**：FunASR（自部署，WebSocket 流式）实时转写，边说边出字`
  改：
  `- 🎤 **实时语音识别**：FunASR / FunASR v2（新版，支持中英混说，默认）二选一（自部署 WebSocket 流式），边说边出字`
- **技术栈 ASR 行**改：
  `| ASR | **FunASR / FunASR v2 自部署 WebSocket 流式**（官方协议，不引 SDK；v2 支持中英混说） |`
- **配置段** ASR 行改为：
  `- **语音识别（ASR）**：Provider 二选一 —— \`FunASR\`（旧版 10096，2pass，纯中文）或 \`FunASR v2\`（新版 10095，START/STOP，中英混说，默认启用）；分别填各自 WebSocket 地址（ws://host:port）与可选 token；亦可用 \`.env\` 的 \`ASR_WS_URL/ASR_TOKEN\`（旧版）或 \`ASR_V2_WS_URL/ASR_V2_TOKEN\`（新版）覆盖（优先级高于 settings.json）`
- **变更记录**在 2026-08 条目末尾追加一条：
  ` - **2026-08-22**：ASR 默认切换 FunASR v2（10095 中英混说实时转写），旧版 10096 可一键切回；`

---

## 8. 红线落实（AC-R 组）

- **R1（写盘）**：本次一切写入限 `$HERMES_KANBAN_WORKSPACE`（本项目目录）；新增/扩展脚本零 tempfile；fixture 写 `scripts/`；settings 备份/测试备份都是项目目录内 `.bak` 文件；**禁止** `%TEMP%`、`/tmp`、`C:\TEMP`。
- **R2（模型禁令）**：识别全部走 10095 API；不下载/安装/部署任何模型文件；除 NPM 依赖外零新装——交付检查 `git diff package*.json` 为空；`make_mixed_fixture.html` 的 speechSynthesis 仅制测试音频（系统 TTS，非模型）。
- **R3（语法）**：收尾必跑 `npm run check`，0 错误。
- **R4（design-first）**：本文件即本次设计依据；实施前不擅自改生产代码。

---

## 9. 验收对照表（24 条 AC → 设计条款）

| PRD AC | 设计条款 |
|---|---|
| A1/A2/A3/A4 | §4.1、§4.2 表 |
| B1/B2/B3/B4/B5 | §5.2（1/3/4）、§5.3 表、§5.4 |
| C1/C2/C3/C4/C5 | §5.2（5/6）、§5.3 表、§5.4、§5.5 |
| D1/D2/D3 | §6 表 + 收尾铁律 |
| E1/E2/E3 | §7.1/§7.2/§7.3 |
| R1/R2/R3/R4 | §8 |

验收证据三要点（供 tester/reviewer 复核）：① 命令真实输出（直连识别全文、/ws 回环 asr-final JSON、npm run check 输出）；② fixture 路径与时长；③ 旧服务 10096 状态如实记录。

---

## 10. 与 v1.1 设计差异说明（任务目标 5）

| 维度 | v1.1（2026-08-16） | v1.2（本文件） |
|---|---|---|
| 定位 | 适配层设计：新增 funasr-v2 provider（配置/客户端/路由/设置页） | 切换执行设计：启用运行配置 + 真实验收 + 回退 + 文档收尾 |
| 状态 | 已评审、已实现（commit 0fb6745） | 本次执行依据（新文件） |
| 生产代码 | —（v1.1 已落地） | **零改动**（仅 settings.json 运行配置） |
| 验证 | v1.1 §8 第 4 项要求临时脚本验证 is_final 非空 + stopped；但未做真实中英混说 | 补齐 AC-B2 中英口径断言、真 FIX 端到端、回环 analysis 结构断言、死端口错误路径、AC-C4 配置缺失用例 |
| 决策 | v1.1 §10 三项待确认 | 全部关闭（§2） |
| 文档 | 未涉及收尾 | E1/E2/E3 + DECISIONS 旧条目订正 |

不重写 v1.1 的理由：v1.1 已过审且实现已提交并与飞书契约逐条对应；本次任务是「启动它 + 证明它 + 收尾」，重写既得资产违反最小改动原则。若验收暴露适配缺陷，修复仍以 v1.1 §5 语义为界。

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 10095 不可达 / vLLM 首次预热慢（分钟级） | 重试一次；连接类失败按 AC-B5 错误路径验证，记入报告；仍不可达→**kanban_block 上报，不伪造识别证据** |
| CPU 推理延迟 ~1s（§10.3），回环观察窗口不足 | 回环真实音频观察窗口 20s；只断言事件顺序与最终文本，不评语速 |
| 中英混写识别字级波动 | AC-B2 用存在性正则（英文串 + ≥4 汉字），不绑定具体单词；报告附全文人工复核 |
| 旧服务 10096 可能已下线 | AC-D1 双形态：在线→文本，离线→明确错误即通过；如实记录，不造假成功率 |
| fixture 无法制备（无麦克风/无可用 TTS） | helper 页 speechSynthesis 退化模式；仍不行→ kanban_block（capability） |
| 浏览器不可用（AC-C3） | §5.5 等价方案（协议层 + /api/feedback 直调 + analyzeText 单测），报告注明证据等价性 |
| LLM 网关/router 不可达（反馈链） | /api/feedback 返回 `success:false` 与 error 原文如实记录，与旧版同口径 |
| 测试临时改配置污染终态 | 所有临时改动用 .bak 备份 + 完成后强制校验恢复到 §4 终态 |
| settings.json 不入库导致「开箱默认」依赖本地状态 | 与 PRD D1/D2 口径一致：运行配置即切换定义；仓库侧以样例双块 + 文档（E3）承载默认策略说明 |

---

## 12. 执行顺序（developer）

1. §4 备份 + 改 settings.json + 校验（A1）
2. 启动 server → A2 验证；A3/A4 静态核对
3. §5.1 制备 FIX（helper 页录制，落 `scripts/mixed_test.wav`）
4. §5.2 扩展 `test_funasr_v2_ws.js` → `npm run check`
5. 直连测试（B1~B5，记录真实输出）
6. 回环测试（C1/C2/C5）+ AC-C4 备份/恢复用例
7. C3 前端链路（浏览器或等价）
8. D 组回退用例 → 恢复 §4 终态
9. E 组文档收尾（§7.1/§7.2/§7.3）
10. 全量 `npm run check` + `git diff` 自审（确认零生产代码/零依赖改动）+ commit

**commit 建议**（单 commit）：`feat(asr): 运行配置启用 FunASR v2 中英混说 + 端到端验证脚本/夹具与文档收尾`；内容 = `scripts/test_funasr_v2_ws.js`（改）、`scripts/make_mixed_fixture.html`（新）、`scripts/mixed_test.wav`（新，若体积合理）、`docs/IMPLEMENTATION.md`、`docs/DECISIONS.md`、`README.md`、`docs/ASR_FUNASR_V2_SWITCH_v1.2.md`（本设计，建议一并入库留痕；settings.json 不入库属预期）。