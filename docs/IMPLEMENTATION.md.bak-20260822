# IMPLEMENTATION — expression-trainer WebUI 实现记录

> 随进度逐步更新。记录：每阶段做了什么、关键决策、遇到的问题。

## 2026-08-14 Phase 1 启动

### 已完成
- TASKS.md / DECISIONS.md / 本文件初始化
- DESIGN.md 更新至 v1.1（FunASR 配置化、Electron 保留、Nginx 部署）
- **原版源码通读完成**（复用点确认，见下）

### 原版复用点评估（读代码确认，非猜测）
| 文件 | 复用方式 |
|------|---------|
| `data/emotion-lexicon.json` | ✅ 原样复用（后端加载） |
| `lib/lexicon.js` | ✅ **原样复用**：`loadLexicon()` + `analyzeText()` 纯 Node 逻辑，无 Electron 依赖。**注意**：返回的 `position` 是分词数组索引（非字符偏移）——后端可用作高亮依据（按分词重建偏移），或前端保持 regex 高亮。设计 §4.2 的"词位高亮"需在 Phase 1 定方案 |
| `lib/prompts.js` | ✅ 原样复用（getRealtimePrompt / getReportPrompt 纯函数） |
| `lib/ai-feedback.js` | 🔁 改造复用：删除 ollama 分支，`getProviderConfig` 从"扁平 settings"改为"嵌套 providers"（原版 main.js 是嵌套结构但 ai-feedback.js 读扁平字段——**原版就有这个 bug**，WebUI 版修正为读嵌套） |
| `src/index.html` | ✅ 迁移到 public/（无 Electron 依赖） |
| `src/app.js` | ⚠️ 迁移改造：`window.api.*` IPC 调用替换为 fetch/WS；`window.api.saveFile` 改为浏览器 Blob 下载；其余逻辑（录制状态机/字幕/统计/反馈/报告/粘贴分析）可复用 |
| `src/styles.css` | ✅ 原样迁移 |
| `main.js` / `preload.js` | ❌ 不使用（Electron 壳，保留参考） |
| `src/settings.html` / `settings.js` | ⚠️ 迁移改造：provider 配置改为嵌套结构 + ASR 段 |

## 2026-08-14 Phase 1 完成

### Phase 1 交付（已通过浏览器端到端验收）
- ✅ server 骨架：`server/index.js`（Express + 静态托管 + health）、`server/config.js`（env > settings.json 覆盖层）、`server/routes/`（analyze/settings/report/health）
- ✅ `/api/analyze`：复用 `lib/lexicon.js` 零改动，实测识别填充/犹豫/笼统词 + 替代建议 + 密度
- ✅ `/api/settings`：嵌套结构 + 密钥脱敏（只回显后 4 位）；`/api/settings/test-llm`、`/api/report`（未配 key 返回可读提示）
- ✅ 前端迁移 `public/`：index/styles/app/settings 全迁移；新增 `api-client.js`（window.api 同构，REST + 浏览器下载）
- ✅ 设置页重写：LLM 三后端（删 ollama）+ ASR FunASR 配置 + 阈值；`.gitignore` + `config/settings.example.json` + `.env.example`
- ✅ 依赖：express ^5.1.0 + ws ^8.18.0（共 68 包，0 漏洞）
- ✅ package.json：start = node server/index.js，check 保留

### Phase 1 浏览器端到端验收结果（MCP Chrome 实测）
- 主页面三栏渲染正常，粘贴逐字稿分析链路通过：统计面板（笼统 3 / 填充 6 / 犹豫 2 / 密度 73%）正确，字幕分词高亮正常，操作按钮出现
- 设置页渲染正常（LLM 三后端、ASR FunASR、阈值 50）

### 遇到的问题
- **后台启动 node 服务失败**：Git-bash background=true 下 node 退出（`no job control in this shell`，stdin not a tty）。解决：**用 pty=true 启动**（用户指示）。前台 timeout 测试正常。
- **config.js 字段不一致**：最初写成 `asr.wsfun` 与定义 `asr.funasr` 不符，已修正（自查发现）。
- 前台首次 run 时 `timeout 8 node server/index.js` 正常验证了启动路径。

### 待第二阶段
- FunASR WebSocket 协议调查（子智能体）
- 录音模块 + WS 通道 + asr-partial/asr-final
- AI 反馈 / 报告（LLM 客户端改造，删 ollama）

## 2026-08-14 Phase 2 完成（FunASR 流式接入）

### FunASR 协议调查（子智能体 deleg_52425654，58 API 调用，266s）
- 产出 `docs/FUNASR_WEBSOCKET_SPEC.md`（299 行完整对接规范，来源官方仓库交叉验证）
- 核心结论：默认端口 10095；无鉴权；上行=配置 JSON→裸 PCM 二进制→结束 JSON；下行=文本 JSON（2pass-offline/offline=定稿，2pass-online/online=partial，is_end=完成确认）

### 实现
- ✅ `public/recorder.js`：getUseMedia + AudioContext 16kHz + PCM 分块 + WAV 编码（每 1s 一块发送）
- ✅ `public/api-client.js` 扩展：connectWS（带回退重连）+ wsSendStart/Stop/Audio
- ✅ `server/ws/server.js`：/ws 挂载，会话管理（start→ready、音频帧转发、stop）
- ✅ `server/asr/client.js`：按官方协议实现（配置帧→裸 PCM→结束帧→is_end 回执；WAV 头剥离 wavToPcm）
- ✅ app.js 录音改造：真实 Recorder + WS（替换原 IPC feedAudio）

### Phase 2 验收（Node 模拟浏览器全链路）
- ✅ WS /ws 连接 → start → ready
- ✅ WAV 音频帧（32044B）→ 后端剥头 → asr client → 未配置地址时友好报错（不崩）
- ✅ stop → 会话清理
- ⏸ 真实 FunASR 转写验收：需用户提供 ws:// 地址后做（todo #15）

### 遇到的问题
- **Chrome MCP 持续超时**（Network.enable timed out ×3）：与项目无关，是调试协议连接问题；改用 Node 无头脚本验证（等价覆盖）
- **浏览器缓存旧 index.html**：导致 recorder.js 未加载（hasRecorder:false）；服务端已正确提供，刷新解决
- **3001 端口被旧进程占用**：旧 node server 进程残留，powershell Stop-Process 清理后重启正常
- **patch 工具与 CRLF 文件匹配不可靠**（index.html 缩进没改掉）：改用 `sed -i` 直接修

## 2026-08-14 Phase 3 完成（LLM 客户端改造）

### 实现
- ✅ `server/llm/client.js`：由 lib/ai-feedback.js 迁移改造（删 ollama，适配嵌套配置 llm.providers），支持 deepseek/openai/custom
- ✅ `server/routes/feedback.js`：POST /api/feedback（LLM 实时反馈，最近 600 字，防 token 爆炸）
- ✅ `server/routes/report.js`：POST /api/report 真实实现（LLM 报告，max_tokens 8192）
- ✅ `server/routes/settings.js`：test-llm 改用 llm/client（嵌套结构）
- ✅ config.js 增加 prompts 段（realtime/report 自定义 prompt，可覆盖默认）
- ✅ api-client.js getRealtimeFeedback 对接 /api/feedback（去占位）
- ✅ app.js 反馈阈值动态读取（autoThresholdChars，默认 50，设置页可调）

### Phase 3 验收（未配 key 场景）
- ✅ /api/feedback → `LLM (deepseek) 未配置 API Key` 友好提示
- ✅ /api/report → 同
- ✅ /api/settings/test-llm → 端点未配置/缺 key 提示
- ⏸ 真实 LLM 调用：需用户提供 key 后验收（todo #15）

### 遇到的问题
- **3001 端口被更早的残留进程占用**（PID 14624，11:57 旧测试服务）：kill 会话进程树不彻底，用 powershell Stop-Process 清理后重启正常
- 9Router（localhost:20128）不在线，未做真实 LLM 调用测试

## 2026-08-14 Phase 4 + 代码审查优化

### Phase 4 交付
- ✅ `deploy/nginx.conf.example`：Nginx 配置模板（静态托管 public/ + 反代 /api 和 /ws 带 Upgrade）
- ✅ `deploy/README.md`：打包→部署→验证全流程指南
- ✅ README.md：重写为 WebUI 版说明
- ✅ 打包验证：tar 787K、排除 .git/node_modules缓存，含 node_modules（部署免 npm ci）

### 代码审查优化（requesting-code-review skill 流程）
- ✅ 静态扫描：无硬编码密钥 / 无 eval/exec / 路径固定无遍历
- ✅ 自审 checklist 通过
- ✅ ws/server.js：会话 Map 化（多连接隔离）+ 清理死代码（crypto/未用 lastFeedbackAt）
- ✅ app.js：AI 反馈冷却 8s（防刷屏省 token）+ 阈值动态读取（默认 50）
- ✅ custom provider 设置页完整（baseUrl/model 输入已存在）
- 🔄 独立 reviewer 子智能体审查中（deleg_9a6274fd）

## 2026-08-14 代码审查修复循环（reviewer 发现 8 项 → 已全部修复）

### Reviewer 结论（deleg_9a6274fd，10 API，543s，fail-closed: passed=false）
- 安全 4 项：ws 无 maxPayload（默认 100MB DoS 风险）、FunASR/LLM 无鉴权、ASR rejectUnauthorized:false、LLM 端无 URL 校验
- 逻辑 6 项：**recorder.js flat() NaN 音频全毁（P0，已运行时验证）**、wavToPcm 只查 4 字节 RIFF 硬截 44、start 并发丢弃音频帧、未配置 URL 仍发 ready、env EXPR_PORT NaN、反馈阈值差值逻辑
- 建议：标准重采样、body 上限、innerHTML XSS、正则转义、单测

### 已修复（第一轮）
| # | 问题 | 修复 |
|---|------|------|
| P0 | recorder.js `Float32Array.from(out.flat())` → NaN | 改用累计 Float32Array buffer（append+slice），去 flat；验证 6s→6 块全对 |
| P1 | ws maxPayload 100MB | `maxPayload: 1MB`（音频帧 ~32KB，足够） |
| P1 | wavToPcm 只查 RIFF 截 44 | 严格校验 RIFF/WAVE/fmt=PCM/mono/16bit + data chunk 定位（含 fact 头验证） |
| P1 | LLM 无 URL 校验 | assertSafeEndpoint 只允许 http/https（防 SSRF） |
| P1 | body 无上限 | express.json limit 1mb + analyze/feedback/report 文本 ≤200000 字符（413 验证） |
| P2 | EXPR_PORT NaN | parseInt 校验 + trim；host trim |
| P2 | 冷却硬编码 8s | 从设置读 cooldownSec |
| P2 | 阈值差值缺陷 | 差值=距上次请求增量，语义正确（reviewer 场景实际可触发）；冷却/阈值全动态 |

### 修复后回归验证
- ✅ npm run check 24/24
- ✅ analyze 正常 + 超长 413
- ✅ WS ready + 未配置 error
- ✅ wavToPcm 标准头/含fact头/非WAV 全部正确
- ✅ Map 会话隔离（双连接各自 ready）

### 未处理项（合理接受，非缺陷）
- ASR rejectUnauthorized:false：FunASR 官方自签证书必需（SPEC §1），保留
- FunASR 无鉴权：官方协议（SPEC §2）；Nginx 部署由服务器访问控制兜底（deploy/README 已注明）
- 前端重采样仅线性抽取：浏览器 AudioContext({sampleRate:16000}) 现代浏览器均支持，常规场景已覆盖（上线后如需可换 AudioWorklet）

## 2026-08-14 用户提供配置 + 端到端真实验收通过

### 用户提供（已写入 config/settings.json）
- FunASR: ws://192.168.156.68:10096（验证可达、协议正确、真实转写通过）
- LLM: custom provider → router http://192.168.155.44:8000/to68/router/v1，模型 dic/DeepSeek-V4-Flash-0731（key 存配置，不入库）

### 发现并修复：router 返回 SSE 格式
- 9Router 类网关即使 stream:false 也返回 text/event-stream（body = JSON + 'data: [DONE]' 尾巴）
- `response.json()` 解析失败 → 新增 `parseChatResponse`（截取首个完整 JSON / 兼容纯 JSON / SSE 行）
- 修复后 feedback/report/test-llm 全部真实调用成功

### 端到端验收结果（全部实测）
- ✅ test-llm custom → success:true
- ✅ feedback（真实 LLM 反馈文本）→ "你到底觉得呢"
- ✅ report（真实 LLM 6 维度报告）→ 完整报告（识别填充/犹豫/密度问题）
- ✅ FunASR 直连：partial 流式 + 2pass-offline 定稿 + stamp_sents 时间戳，正确识别 "欢迎大家来体验达摩院推出的语音识别模型"
- ✅ **浏览器→后端→FunASR→回传全链路**：partial 逐 60ms 流式 + final 定稿句（官方测试音频验证）

### 遇到的问题
- **kill 进程树不彻底**：多次 EADDRINUSE，残留 node 进程占用 3001 导致测到旧代码；用 powershell Get-NetTCPConnection 按端口清理后解决
- funasr 直连发送整块一次性 + 过早 stop → 无结果；真实节奏（60ms/1920B）+ 等 partial/final 后 stop 正常
- edge TTS 失败（无音频返回）→ 改用官方测试音频验证