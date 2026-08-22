# PRD — expression-trainer ASR 切换 FunASR v2（中英混写）

- 版本：v1.0
- 日期：2026-08-22
- 角色：owner（产品负责人）出 PRD；kanban 任务 t_21c4d163
- 上游依据：PM 已澄清需求（任务卡 body） + 飞书正式部署文档（服务端事实契约，https://guwenhao.feishu.cn/docx/RVJ3dewWJoEJk0xh9iFcFgAtnpi）+ 代码/仓库事实（git commit 0fb6745）
- 下游依赖：本 PRD → architect 设计（t_125b4437，依据 PRD + 既有 `docs/ASR_FUNASR_V2_SWITCH.md` v1.1）
- 关联文档：`docs/ASR_FUNASR_V2_SWITCH.md`（v1.1 设计，已评审）、`docs/FUNASR_WEBSOCKET_SPEC.md`（旧版 2pass 协议）

---

## 1. 需求一句话

把 expression-trainer（WebUI 版，本目录）的语音识别从旧版 FunASR（10096，2pass，纯中文）切换到新版部署 **FunASR v2 实时转写（10095，START/STOP 协议，Fun-ASR-Nano-2512 中英混说模型）**，**默认开箱即走 v2**，同时保留旧版路径可随时切回；并以真实「中英混说」音频端到端验收本次切换。

## 2. 目标用户与核心场景

| 项 | 内容 |
|---|---|
| 目标用户 | 使用者本人（本地自部署单用户）；口语表达训练者 |
| 核心场景 A | 训练时边说中文边说英文口语词/词组（如「我觉得这个方案不错，especially 对 team 来说」），字幕需把中英文都准确转出来 |
| 核心场景 B | 训练中切换 ASR：设置页从 FunASR v2 切回旧版 FunASR（或反向），无需重启服务即生效 |
| 核心场景 C | 恢复/新部署时，按样例配置即默认启用新版实时服务 |

痛点：旧版 paraformer-zh 为纯中文模型，英文词会被错转/吞掉；本次切换解决「中英混写」识别，并补齐从未做过的真实音频端到端验证。

## 3. 事实基线（本 PRD 全部依据，逐条可溯源）

### 3.1 服务端契约（飞书正式部署文档，§1.2/§1.3/§7.2/§10.3）

| 服务 | 地址 | 协议 | 模型/引擎 | 备注 |
|---|---|---|---|---|
| funasr-realtime（实时 WS） | `ws://192.168.156.68:10095` | 文本控制帧 + 二进制 PCM 帧，状态机 START→音频→partial→STOP | Fun-ASR-Nano-2512（Qwen3-0.6B 解码器 + SenseVoice 编码器），vLLM CPU | 服务端 VAD 自动断句；默认 `--language 中文`；`ws-max-size 10MB` |
| funasr-v2（离线 API） | `http://192.168.156.68:10097` | OpenAI 兼容 `POST /v1/audio/transcriptions` | fun-asr-nano | 本项目**不接入**（需流式，只有 10095 匹配） |
| funasr-cpu（旧服务） | `ws://192.168.156.68:10096` | 旧版 2pass 配置帧 + PCM 帧 | paraformer-zh（纯中文） | 现状项目在用；本次回归对象 |

实时协议关键事实（§7.2，与设计文档 v1.1 §3 一致）：
- 上行：`START` 文本帧 → 裸 PCM16 16kHz 单声道二进制帧 → `STOP` 文本帧；可选 `LANGUAGE:中文` / `HOTWORDS:...` / `POSTPROCESS_HOTWORDS:...`
- 下行：`{"event":"started"}`；流式 partial `{"sentences":[],"partial":"...","partial_start_ms":...,"duration_ms":...,"is_final":false}`；最终 `{"sentences":[{"text":"...","start":420,"end":5610}],...,"is_final":true}`（STOP 或 VAD 句边界触发）；`{"event":"stopped"}`；`{"event":"error","error":"..."}`
- 已知限制（§10.3）：CPU 推理，预热后中文短句约 1s 级延迟；**仅句子级 `start/end` 时间戳，无词级时间戳**；切换说话人分离默认关闭。这些属服务能力边界，不作为缺陷。

### 3.2 代码/配置现状（git 已提交 commit 0fb6745，工作树干净）

| 层 | 文件 | 现状（代码事实） |
|---|---|---|
| 配置 | `server/config.js` | 已有 `DEFAULTS.asr.funasrV2{wsUrl,token}`、env `ASR_V2_WS_URL/ASR_V2_TOKEN` 覆盖、loadSettings 缺省合并 funasrV2；`DEFAULTS.asr.provider='funasr'` |
| ASR 客户端 | `server/asr/client.js` | 已有 `createFunasrV2Session`（START/`LANGUAGE:中文`/定稿拼接 trim 非空才 onFinal/STOP→等 stopped→15s 兜底）；`createFunasrSession`（旧版）原样保留 |
| WS 服务 | `server/ws/server.js` | 已有 provider 白名单校验 + funasr/funasr-v2 双路由；onFinal 后 `analyzeText()` 并下发 `asr-final{text,analysis}` |
| 设置接口 | `server/routes/settings.js` | maskSettings 含 funasrV2；PUT 按显式提交块更新（未提交块保留，token `****` 不覆盖） |
| 设置页 | `public/settings.html` / `settings.js` | 下拉已含 funasr-v2；双槽位 asrSlot 互不串扰；label 随 provider 联动；保存只提交当前 provider 块 |
| 样例 | `config/settings.example.json` | 已含 `funasrV2: { wsUrl: "ws://192.168.156.68:10095", token: "" }` |
| 样例 | `.env.example` | 已含 `# ASR_V2_WS_URL=` / `# ASR_V2_TOKEN=` |
| 验收脚本 | `scripts/test_funasr_v2_ws.js` | 已存在：测试 1 直连 10095、测试 2 走本项目 /ws 回环；支持真实音频或静音退化 |
| 前端主流程 | `public/app.js` / `api-client.js` / `recorder.js` | 与新旧 provider 无关：onPartial→字幕 partial；onFinal{text,analysis}→缓存句子+词库统计/高亮；反馈阈值动态读 |

### 3.3 真正的缺口

1. **实际运行配置未启用 v2**：`config/settings.json` 仍是 `provider: "funasr"` + `funasr.wsUrl=10096`，**无 funasrV2 块**（靠代码缺省合并兜底）。
2. **从未用真实中英混说音频端到端验证**：直连 10095、本项目 /ws 回环、字幕/词库分析/反馈链路均无真实混排音频证据。
3. **文档未收尾**：README 仍是单 provider 描述；IMPLEMENTATION.md 最近记录停留在旧版真实验收（2026-08-14）；DECISIONS.md 无 v2 切换决策，且旧条目「FunASR 协议…端口 10095」描述与当前两服务并存事实不符（旧 10096 2pass / 新 10095 START-STOP），需订正，避免后续把端口与协议张冠李戴。

## 4. 功能范围与产品决策

### 4.1 决策 D1 — 「切换」的验收定义：运行配置默认启用 funasr-v2（开箱即走 v2）

本 PRD 裁决：**本次「切换」= 实际运行配置 `config/settings.json` 改为 `provider: "funasr-v2"` 且 `funasrV2.wsUrl: "ws://192.168.156.68:10095"`**（并保留旧 funasr 块原值不动）。即：用户运行本项目，默认就使用新版中英混写服务。

- 理由：用户诉求就是「切换到新版（中英混写）」；10095 已部署在线，适配代码已提交；本机为单用户自部署，settings.json 是权威运行配置，写进去即「默认 v2」。
- 厂商级兜底：旧 funasr 块原样保留在 settings.json，设置页一键可切回，不丢配置。

### 4.2 决策 D2 — 代码出厂缺省 `DEFAULTS.provider` 保持 `'funasr'`，不改

- 仅为「无任何运行配置的全新安装」提供中性缺省；真实运行态以 settings.json 为准。
- 备选（不默认执行）：若后续要求「出厂即 v2」，只需改 config.js 一行 `provider: 'funasr-v2'`；此变更**不在**本次验收范围，除非评审提出。
- 影响：`config/settings.example.json` 保留双块示例（funasr 缺省值 + funasrV2 示例值），不把示例默认切成 v2，避免新装未配置就报错。

### 4.3 决策 D3 — provider 取值命名与协议双轨现状不变

- `'funasr'`（旧版 10096 2pass）与 `'funasr-v2'`（新版 10095 START/STOP）两个取值，白名单内路由；未知取值直接报错（已有实现）。
- 前端内部 WS 协议（`{type:'start'}`/binary/`{type:'stop'}` ↔ `asr-partial/asr-final/error`）**不变**。
- 不接入 10097 离线 HTTP（本项目需要流式）。

### 4.4 决策 D4 — 旧版回归路径必须保留且可切回

- `createFunasrSession`（10096 2pass）代码零改动；设置页可切回；回归验收见 §5 D 组。
- 回归验收允许两种结果形态（见 AC-D1），避免把「旧服务不在线」误判为缺陷。

### 4.5 范围清单

| 做 | 不做 |
|---|---|
| 运行配置启用 v2（settings.json） | 改 FunASR 服务端任何东西 |
| 真实中英混说端到端验证（直连 + /ws 回环 + 全链路） | 接入 10097 离线 API |
| 旧版回归 + 可切回验证 | 改前端内部 WS 协议 |
| 文档收尾（IMPLEMENTATION/DECISIONS/README） | 新增词库/反馈/报告功能本身 |
| 保留 `scripts/test_funasr_v2_ws.js` 作为回归工具（记录用途） | 重写已实现的 v2 适配代码（除非验收暴露缺陷） |

## 5. 验收标准（AC）—— 全部可执行、可自动化或可人工复核

> 口径说明：真实中英混说音频 fixture（下文 FIX）由验收人（developer/tester）制备，任选其一：
> - **首选**：本应用浏览器录音器（项目自带，16k mono WAV）录制一句含中英文的口语句（推荐语料：「大家好，今天我们来聊聊在 Apple 的工作体验，我觉得 teamwork 很重要。」），存到 `scripts/` 下作为可复现 fixture（如 `scripts/mixed_test.wav`）。
> - 备选：远程 TTS（如 edge）生成同语料音频后转为 16k 单声道 PCM 置于 `scripts/`（不安装任何本地模型/工具链；如需转换只可用项目内已有手段，不得新增依赖）。
> 断言不绑定具体单词（中英正则存在性），避免模型对个别词的识别波动造成假失败；验收报告必须附 fixture 路径与完整识别文本。

### A 组 — 配置与默认策略

- **AC-A1**：本次交付后 `config/settings.json` 存在且 `asr.provider === "funasr-v2"`、`asr.funasrV2.wsUrl === "ws://192.168.156.68:10095"`；`asr.funasr` 块保持原值（10096）。
- **AC-A2**：`GET /api/settings` 返回 `asr.provider==="funasr-v2"` 且 `funasrV2.wsUrl` 与 token 脱敏正确（token 为空或后 4 位）。
- **AC-A3**：`config.js` 的 `DEFAULTS.asr.provider` 仍为 `'funasr'`（决策 D2 保持）；代码中 `['funasr','funasr-v2']` 白名单路由保留。
- **AC-A4**：`config/settings.example.json` 与 `.env.example` 均含 funasrV2 样例（10095）且格式合法（JSON parse 通过）。

### B 组 — 直连 10095 协议链路（nodescripts/test_funasr_v2_ws.js 扩展或等价脚本）

- **AC-B1**：以 FIX 推送直连 `ws://192.168.156.68:10095`：收到 `started` 事件；`STOP` 后收到 `is_final:true` 且 `sentences` 拼接文本**非空**。
- **AC-B2**：文本同时满足中英混写口径：含 ≥1 个 ASCII 英文字母串（`/[A-Za-z]{2,}/`）**且**含 ≥4 个汉字（`/[\u4e00-\u9fa5]{4,}/`）——中文正则断言失效视为识别链路未达「中英混写」目标，记录并回报。
- **AC-B3**：完整生命周期：收到 `stopped` 事件；连接在发送 STOP 后 **15 秒内**正常关闭（P0-2 等待语义回归；测试脚本已有该断言）。
- **AC-B4**：空文本定稿不产生结果回调（P0-1 回归）：静音退化场景（纯静音 PCM）不产出空字符串 final；若服务端对静音无 `is_final:true` 则协议生命周期（started→stopped）仍成立。直连脚本中的静音分支断言保留。
- **AC-B5**：连接错误路径：向不存在/未启动的端口连接时，脚本（或等价探针）收到明确连接失败，进程不悬挂（有超时退出）。

### C 组 — 本项目 /ws 回环 + 字幕/词库分析/反馈链路

- **AC-C1**：以 AC-A1 配置启动 `node server/index.js`（或 `npm run dev`）后，`ws://127.0.0.1:3000/ws` 发 `{type:'start'}`：收到 `{type:'ready'}`（handleStart 按 provider=funasr-v2 建会话成功）。
- **AC-C2**：回环推 FIX 音频（WAV 或裸 PCM）+ `{type:'stop'}`：收到 `{type:'asr-final', text, analysis}`，其中 `text` 满足 AC-B2 中英口径，`analysis` 为既有 `lib/lexicon.js` 输出结构（含 fillers/hedges/vagueWords 等字段，与旧版一致）——证明词库分析链随 v2 路径生效。
- **AC-C3**：前端全链路（浏览器或等价 DOM 调用）：主页面开始录音后，字幕先出 partial（`renderSubtitle(text,false)`）后定稿为 final；定稿文本进入统计面板与高亮（`applyAnalysis` 生效，fillers/hedges/vague 计数递增）；若已配置 LLM key，达到阈值后出现 AI 反馈（`/api/feedback` 成功返回）。
- **AC-C4**：未配置 `funasrV2.wsUrl`（临时清空）时 start 收到明确错误 `FunASR v2 服务地址未配置（config/settings.json 或 .env）`，进程不崩溃；恢复配置后正常。
- **AC-C5**：空文本定稿不发生 `asr:final` 下行（回环层 P0-1 回归）：静音场景不应出现空串 final 污染字幕/统计。

### D 组 — 旧版回归与可切回

- **AC-D1**：设置页切回 `FunASR`（旧版）并保存：`GET /api/settings` 返回 `asr.provider==="funasr"`；再录音：路由应走 10096。**两形态之一即为通过**：① 旧服务在线 → `asr-final` 文本正确（纯中文）；② 旧服务不在线 → 前端收到明确 `FunASR 连接错误/连接已断开` 且不崩溃（如实记录旧服务状态，不要求在线成功率）。
- **AC-D2**：新旧互切配置不串扰（P0-3 回归）：设 v2 地址为 A、切旧版并设地址 B、再切回 v2 —— `GET /api/settings` 中 funasrV2.wsUrl 仍为 A、funasr.wsUrl 仍为 B；token 带 `****` 回显时保存不覆盖原值。
- **AC-D3**：切换**无需重启服务**：保存设置后立即开始录音即走目标 provider（config 缓存失效后重载，验证 saveSettings→getConfig 语义）。

### E 组 — 文档收尾

- **AC-E1**：`docs/IMPLEMENTATION.md` 新增本次切换段落：日期、对应 commit（0fb6745）、配置变更、验收结果摘要（含 FIX 与识别文本）、保留 `scripts/test_funasr_v2_ws.js` 作为回归工具。
- **AC-E2**：`docs/DECISIONS.md` 新增 ASR v2 切换决策行（provider 命名、默认策略 D1/D2、10095 START/STOP 事实、旧版保留）；并**订正旧条目**「FunASR 协议…端口 10095」为两服务并存事实（10096 旧 2pass / 10095 新实时 START/STOP），避免误读。
- **AC-E3**：`README.md` 更新：功能段「实时语音识别」说明 FunASR 与 FunASR v2 两 provider 可选、v2 支持中英混说；配置段补充 ASR 二选一与 `ASR_V2_WS_URL/ASR_V2_TOKEN`；变更记录补 2026-08 条目。

### R 组 — 红线约束（必须达成，与上同权）

- **AC-R1（写盘）**：本次一切交付物、日志、临时文件只写入项目目录（`D:\myagent\workspace\project\expression-trainer`）；无任何写入系统临时目录（`%TEMP%`、`/tmp`、`C:\TEMP`）；脚本/代码中 `tempfile` 必须显式 `dir=` 项目目录（现有代码/测试脚本照此审计）。
- **AC-R2（模型禁令）**：无本地模型安装/部署/运行，一切识别走 10095 API；除 NPM 依赖外无任何新装（`git diff package*.json` 无变化或不新增依赖）。
- **AC-R3（语法）**：`npm run check` 通过，0 错误（node --check 遍历全部 JS）。
- **AC-R4（design-first）**：编码/成品变更前由 architect 输出设计（复用/修订 `ASR_FUNASR_V2_SWITCH.md`），设计评审通过后实施；本 PRD 是设计输入而非设计替代。

## 6. 可行性与风险

**可行性结论：可落地。** 服务端（10095）已部署且契约明确；客户端适配代码已提交（0fb6745）且与契约逐条对应（§3.2）；真实缺口集中在「启用运行配置 + 真实音频验证 + 文档收尾」三件事，均无需新增技术依赖。

| 风险 | 对策（写入验收口径） |
|---|---|
| 10095 服务偶发不可用/vLLM 首次预热慢（分钟级） | 验收如实记录服务状态；连接类失败按错误路径验证（AC-B5），不算代码缺陷；可重试一次 |
| CPU 推理延迟 ~1s（§10.3） | partial 时序偏慢属服务能力边界，不作为失败判据；只断言事件顺序与最终文本 |
| 中英混写识别字级波动 | 验收断言用中英**存在性正则**（AC-B2）而非词级误字率；报告附完整文本供人工复核 |
| 旧服务 10096 可能已下线 | AC-D1 允许「明确错误提示」形态通过；不伪造成功率 |
| 配置互切换串扰 | 已有实现（双槽位 + PUT 未提交块保留），AC-D2 专项验证 |

## 7. 交付物与下游衔接

- 本 PRD：`docs/PRD_FUNASR_V2_SWITCH.md`（本文件）。
- 下游 architect（t_125b4437）：依据本 PRD + 既有 v1.1 设计，输出本次最终设计（可修订 v1.1 或新增 v1.2），覆盖：启用配置方案、真实音频验证脚本/用例设计、旧版回退、文档收尾清单，并给出与 v1.1 差异说明。
- developer / tester / reviewer 链路按看板既有依赖推进；reviewer 把关项见子卡（契约一致性、证据真实性、写盘红线、AGENTS 合规、文档质量）。

## 8. 假设与无歧义声明

- 服务端事实以飞书部署文档为准；若文档与实测不一致，以实测为准并回报 PM（服务端契约修订权在服务方，不改代码硬适配）。
- 本 PRD 不新增任何「待用户拍板」的开放项；D1/D2 为产品裁决结论。若用户另有指示（如「出厂即 v2」），由 PM 修订后以新版本 PRD 为准。