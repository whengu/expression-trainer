# 宇宙无敌表达训练系统 — WebUI 版设计文档

> 版本：v1.1（已按用户 2026-08-14 反馈更新：ASR=FunASR 自部署 WebSocket 配置化、Electron 源码保留参考、部署=Nginx 打包）
> 状态：design-first 设计稿，审批通过后进入编码
> 2026-08

---

## 1. 项目概述

### 1.1 原版（Electron 桌面版）功能

原版是 Electron 桌面应用，核心功能链为：

```
浏览器麦克风录音（Web Audio 采集 16kHz PCM）
  → Electron 主进程 sherpa-onnx 离线流式 ASR
  → 实时字幕（逐句 + interim 半截稿）
  → 词库分析（填充词 / 犹豫词 / 笼统词 / 情绪词，纯 JS 词表匹配）
  → AI 实时反馈（deepseek / openai / ollama / custom 多后端，每 30 字触发）
  → 结束生成 6 维度报告（总分、亮点、逐句编辑、用词精准度、行为模式、数据）
```

原版问题（用户已确认）：sherpa-onnx 本地识别性能差（小模型中文准确率一般、初始化重、模型需手动下载约 500MB），且 Electron 壳重、依赖 install 繁琐。

### 1.2 WebUI 版目标

- **纯 Web 架构**：Node.js 后端服务 + 浏览器前端，无 Electron、无 Tauri、无任何桌面壳。
- **模型全部走 API**：语音转文字走 **自部署 FunASR 服务（WebSocket 流式实时转写，开源版，不用任何 SDK）**，AI 分析走已有 LLM API（deepseek / openai / custom）。FunASR 部署在服务器上，本地不落地任何模型。
- **词库分析原样复用**：`data/*.json` + `lib/lexicon.js` 的纯 JS 逻辑零改动迁移。
- **功能等价**：原版全部功能（录音训练、实时字幕、词库统计、AI 实时反馈、结束报告、粘贴逐字稿分析、自定义 Prompt 编辑器）在浏览器中保留。
- **部署形态**：开发期本地 `npm run dev` → 浏览器打开 `http://localhost:<port>`；**最终打包后部署到 Nginx 下**（见 §9 Phase 4）。host/port 全部做成配置（config 或 .env），可随时改。

### 1.3 项目铁律（AGENTS.md 强制约束，设计必须遵守）

| # | 铁律 | 在本设计中的落实 |
|---|------|------------------|
| 1 | **禁止本地安装/部署/运行任何模型**（ASR/LLM 都不行），全部走远程 API；`models/` 不得填充本地模型 | 后端只做 API 转发；`models/` 目录整体移除；**ollama 本地选项砍掉**（见 3.4） |
| 2 | 除 NPM 依赖外不安装任何东西 | 纯 Node.js + npm 依赖，无 Python、无系统工具链、无模型文件 |
| 3 | 所有写入只允许在项目目录内 | 配置/日志/临时文件全部落在项目目录（`config/`、`data/`），不写系统临时目录 |

---

## 2. 整体架构

```
┌─────────────────────────── 浏览器（前端，纯静态） ───────────────────────────┐
│                                                                              │
│  index.html / styles.css / app.js（ES Module）                                │
│                                                                              │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌──────────────┐        │
│  │ 录音模块    │   │ 实时字幕    │   │ 词库统计    │   │ AI 反馈面板   │        │
│  │ getUserMedia│  │ 高亮渲染    │   │ 填充/犹豫/  │   │ + 报告弹窗    │        │
│  │ → VAD 切句  │   │            │   │ 笼统/情绪   │   │              │        │
│  └──────┬─────┘   └─────▲──────┘   └─────▲──────┘   └──────▲───────┘        │
│         │  WAV 分片      │   字幕/分析     │  分析结果      │  AI 反馈/报告   │
│         └───────────────┼────────────────┼────────────────┼────────────────┘
│                    WebSocket（ws://，单通道）          HTTP（fetch）
└─────────────────────────┼───────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────────────┐
│                        Node.js 后端（server/）                              │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────┐            │
│  │ HTTP 服务（Express，托管 public/ 静态资源 + REST API）       │            │
│  │   GET/POST /api/analyze   词库分析（复用 lib/lexicon.js）    │            │
│  │   GET/PUT /api/settings   设置读写（服务端 config/settings.json）│        │
│  │   POST /api/settings/test-llm  LLM 连通性测试               │            │
│  │   POST /api/report        结束报告（LLM）                   │            │
│  │   GET  /api/health        健康检查                          │            │
│  └────────────────────────────────────────────────────────────┘            │
│  ┌────────────────────────────────────────────────────────────┐            │
│  │ WebSocket 服务（ws，会话级）                                 │            │
│  │   收：音频分片(binary) / 命令(JSON)：request-feedback 等     │            │
│  │   发：asr-final / analysis / ai-feedback / error            │            │
│  └────────────────────────────────────────────────────────────┘            │
│  ┌────────────────────────────────────────────────────────────┐            │
│  │ ASR 适配层（server/asr/client.js，多 Provider 可插拔）       │            │
│  │ FunASR WebSocket 客户端（原生 ws，不引 SDK）      │            │
│  └────────────────────────────────────────────────────────────┘            │
│  ┌────────────────────────────────────────────────────────────┐            │
│  │ LLM 客户端（复用 lib/ai-feedback.js + lib/prompts.js）       │            │
│  │   deepseek / openai / custom（OpenAI 兼容）                 │            │
│  └────────────────────────────────────────────────────────────┘            │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTPS 出站
              ┌────────────────┴─────────────────┐
              ▼                                  ▼
      FunASR（自部署，WebSocket）          LLM API（远程）
      服务器上，本地不落地模型           deepseek / openai / custom
```

**数据流一句话**：浏览器录音 → 静音检测切句 → 每句一个 16kHz WAV 分片走 WebSocket → 后端转发给 ASR API → 文本回传 → 后端跑词库分析 → 双结果一并推回前端渲染；AI 反馈与报告由后端按需调 LLM API。

---

## 3. 技术栈选型

### 3.1 后端：Node.js + Express + ws

| 方案 | 评价 |
|------|------|
| **Express 5 + ws（推荐）** | 事实标准，生态最大、文档最多；本应用 REST 接口极少（4 个），Express 完全够用；`ws` 是最轻量的 WebSocket 库，功能贴合（无需房间/广播等高级特性） |
| Node 内置 `http` + 手写路由 | 零依赖但手写路由/静态托管/body 解析繁琐，不值得省一个依赖 |
| Fastify | 性能更好、schema 校验强，但引入插件体系心智负担，本项目无性能瓶颈 |
| Koa | 中间件模型更现代，但社区体量不及 Express，团队熟悉度低于 Express |

理由：**最小成本 + 主流性**。本项目后端就是"一个静态托管 + 4 个 REST + 1 个 WebSocket 通道"，Express 是复杂度与生态平衡点。REST 层用 Express，WebSocket 用 `ws`（挂在同一 HTTP server 上，共用端口）。

### 3.2 前端：原生 HTML/JS（ES Module），不引构建链

| 方案 | 评价 |
|------|------|
| **原生 JS（推荐）** | 原版已是原生 JS 单类架构（`ExpressionTrainer`），`index.html + styles.css + app.js` 可直接迁移复用（仅把 `window.api.xxx` IPC 调用替换为 fetch / WebSocket）；零构建、零依赖、`node server/index.js` 直接跑 |
| React/Vue + Vite | 组件化/状态管理更规范，但需要 Node 构建链、产物托管、热更新心智；对单页 3 面板应用是过度设计 |
| Vue 3 + CDN 运行时 | 无构建链但引入运行时依赖和模板语法迁移成本，收益有限 |

理由：**复用原版 + 避免重型构建链**（用户约束："不要引入不必要的复杂度"）。原版交互逻辑（录制状态机、字幕渲染、统计累加、反馈去重）是纯前端逻辑，与框架无关；迁移成本最低的方式就是保留原生实现。前端仅一个新增依赖需求——ES Module 方式组织文件，浏览器原生支持。

### 3.3 实时通信：WebSocket 为主通道 + HTTP 为辅

| 方案 | 评价 |
|------|------|
| **WebSocket（ws，推荐）** | 双向 + 低延迟 + 服务端可主动推送。音频分片是单向"上传"、字幕/AI 反馈是服务端"下发"，一个 ws 通道天然按序承载事件流；协议模型与原版 IPC（invoke 上传 / 事件回传）一一对应，迁移顺畅 |
| SSE（Server-Sent Events） | 只支持服务端→客户端单向，音频仍需另行 HTTP 上传；对"结果推送"够用，但拆成两套通道（SSE + 音频 POST）复杂度反而高，且无双向控制（如服务端节流/中止会话） |
| HTTP 轮询 | 实现最笨重：要么前端频繁轮询结果状态（延迟高、浪费请求），要么每次分片都建立 POST/响应闭环（并发乱序需序号协调）；实时字幕体验最差 |

选用 WebSocket 的判断依据：会话期间只有一条低成本长连接；实现上音频分片用 **binary frame**（WAV 字节），命令与结果用 **text frame**（JSON），按 frame 顺序配对即可，无需额外序号协议（见 6.1）。

### 3.4 LLM 反馈后端：沿用 deepseek / openai / custom，**移除 ollama**

原版 4 后端：deepseek、openai、ollama、custom。WebUI 版改为 3 选 1：

| 后端 | 是否保留 | 理由 |
|------|----------|------|
| **deepseek（推荐默认）** | ✅ | 国内直连、便宜、中文质量好；原版 README 也推荐 deepseek；用户已有使用经验 |
| **openai** | ✅ | 质量标杆；但国内网络直连不稳定，作为备选 |
| **custom** | ✅ | 指向任意远程 OpenAI 兼容端点（Groq / Moonshot / 通义 / 云端 Ollama 等），覆盖长尾需求 |
| ollama | ❌ **移除** | 默认形态是 `localhost:11434` 本地跑模型，**违反铁律 1**（禁止本地部署/运行模型）。需要 Ollama 能力的用户可通过 custom 指向「远程」Ollama 服务器（遵守铁律，模型不在本机） |

### 3.5 ASR 选型：**自部署 FunASR（WebSocket 流式，不用 SDK）**（已确认）

**已确认方案**：使用服务器上部署的开源 **FunASR** 服务，WebSocket 实时转写，**不引入任何厂商 SDK**。FunASR 部署在服务器上（不在本机落地模型，符合铁律 1），本地项目只作为客户端通过 WebSocket 对接。

**核心思路（细节留开发阶段调查）**：
- 仓库：`modelscope/FunASR`（开源、19k+★，支持 streaming ASR / Paraformer-zh-streaming）
- 对接方式：**原生 WebSocket**（音频块上行 + partial/final 文本下行），Node 端用 `ws` 即可，不需要厂商 SDK
- 服务地址：**待用户提供**（服务器上部署好的 FunASR 服务 ws:// 地址）
- 调查任务（开发阶段进行，不阻塞设计定稿）：在 GitHub 官方仓库找 WebSocket 客户端示例（runtime/python、html5 等目录），确认协议细节——握手/鉴权方式、音频帧格式（16kHz PCM？）、分片大小、partial/final 消息结构、断开重连行为

**架构影响**：FunASR 支持**真流式**转写（说着实时出字），比"句级分片一刀切"更接近原版 sherpa 的 interim 体验。设计上：
- WebSocket 音频上行从"句级分片"升级为"持续小片上传"（如 1s 块）
- 服务端可回 `partial`（半截字幕）与 `final`（定稿句）两类事件
- 原 6.1 的"分片式非流式"需要相应调整为"流式 + VAD 切句定稿"，这是一处**重要的设计调整点**（§6.1 同步更新）

> ⚠️ 原 4 厂商对比（豆包/Whisper/阿里云/讯飞）**作废**，不再作为候选。

---

## 4. 模块设计

### 4.1 后端模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口/装配 | `server/index.js` | 读配置 → 起 HTTP+WS 服务 → 挂路由 → 挂 WS handlers → 监听端口 |
| 配置管理 | `server/config.js` | 合并 环境变量（`ASR_PROVIDER`/`ASR_API_KEY` 等）与 `config/settings.json`；启动时校验必填项，缺失则启动成功但录音时给友好报错 |
| 设置管理 | `server/routes/settings.js` | `GET /api/settings`（**API key 脱敏返回**，只回显后 4 位）、`PUT /api/settings`（写 `config/settings.json`）、`POST /api/settings/test-llm`（复用原 `testConnection` 逻辑 → 一键测 LLM 连通） |
| 词库分析 | `server/routes/analyze.js` | `POST /api/analyze {text}` → 调 `lib/lexicon.js` 的 `loadLexicon()` + `analyzeText()`（**原样复用，零改动**）→ 返回分析结果（粘贴逐字稿模式用） |
| 报告生成 | `server/routes/report.js` | `POST /api/report {fullText, stats}` → `lib/prompts.js` 组装 → LLM API（max_tokens 8192）→ 返回 Markdown |
| ASR 转发 | `server/asr/client.js` | **FunASR WebSocket 客户端**（原生 ws，不引 SDK）；`transcribe/writeAudio(chunk)` 持续上行音频块、接收 partial/final 文本；超时/重试、断线重连、错误归类转成可读 message 推给前端 |
| LLM 转发 | `server/llm/client.js` | 由原 `lib/ai-feedback.js` 改造（删掉 ollama 分支；其余 provider 逻辑原样保留）：`sendFeedback(text)`、`sendReport(fullText, stats)`、`testConnection(settings)` |
| WebSocket | `server/ws/session.js` | 会话生命周期：连接=会话开始，断开=会话结束（清理该会话未完成的 ASR/LLM 请求）；每会话维护 `fullText`、`lastFeedbackAt`（供节流阀使用） |
| 事件处理 | `server/ws/handlers.js` | 收：`audio` 分片（配二进制帧）→ 调 ASR → 词库分析 → 推 `asr-final`；收 `request-feedback` → 立即触发一次 AI 反馈（绕过节流） |
| 静态托管 | Express `express.static('public')` | 前端三页面（主界面/设置/提示词编辑）+ 样式 + 脚本，`/` 导向 index.html |

### 4.2 前端模块（迁移自 `src/`，仅替换通信层）

| 模块 | 说明 |
|------|------|
| 录音模块 | `getUserMedia({audio:true})` → **Web Audio 节点链**：输入 → 16kHz 重采样（`AudioContext({sampleRate:16000})`，原版同款）→ **VAD 静音切句**（RMS 能量阈值 + 静音尾 400ms 判定句尾）→ 每句编码 WAV Buffer → `ws.send(binary)` |
| 实时字幕 | 复用原版 `renderSubtitle`/`highlightText` 的视觉逻辑，但**高亮来源升级**：不再用前端硬编码 regex 词表，改用后端 `analysis` 返回的词位（word + 类别），消除两套词表漂移（原版坑点）；interim 半截稿行改为"识别中…"占位（API 分片模式无真正 interim，见 6.1） |
| 词库统计 | 每句 `asr-final` 携带的 `analysis` 累加 填充/犹豫/笼统/情绪词 计数 + 表达密度；笼统词弹替换建议卡片（复用原版反馈栏交互） |
| AI 反馈面板 | 接收 `ai-feedback` 事件 → 原版 `classifyFeedback` 分类 → 反馈流（去重、上限 12 条） |
| 设置页 | 由 `settings.html/js` 迁移：LLM provider（deepseek/openai/custom）+ **ASR provider 及对应凭证** + 触发阈值（默认 50 字）+ 保存时测 LLM 连通（原版交互保留） |
| 报告生成 | 复用原版报告弹窗 + markdown→html 渲染；**保存改为浏览器原生下载**（`Blob` + `<a download>`，替代原 Electron 保存对话框，REST 版无需后端参与） |
| 通信层（新增） | `public/api-client.js`：封装 `fetch`（REST）+ WebSocket 单例（自动重连：指数退避 1s/2s/4s/8s 封顶，重连后提示手动重开训练会话，不静默丢数据）；提供与原来 `window.api` 同构的方法名，迁移时替换点唯一 |

---

## 5. 数据与词库

原样复用，不做任何格式改动：

| 文件 | 内容 | 消费方 |
|------|------|--------|
| `data/emotion-lexicon.json` | 情绪词库：7 大类、650 词（category/subcategory/强度/极性）+ 笼统词→精准词映射 | `lib/lexicon.js`（后端加载，`loadLexicon()` 已实现，含缺失兜底） |
| `data/tiered-lexicon.json` | 分层词库 v1：口语高频笼统词（tier1）→ 精准替换候选池（tier2） | 二期（Phase 4）可作为建议增强接入，起决定性建议质量；首期不接，避免与 emotion-lexicon 结果打架 |

- 词库加载时机：后端启动时 `loadLexicon()` 一次，内存驻留；文件热更新不做（改动需重启，在 README 说明）。
- 分析逻辑（`lib/lexicon.js`）：最大正向匹配分词 + 三类词检测 + 表达密度 + 建议生成，**纯同步纯函数，零改动复用到后端**；它不依赖 Electron/fs 之外的任何东西，天然 Web 兼容。
- 前端高亮：以 `analysis` 返回词位为准（见 4.2），前端不再内置词表副本。

---

## 6. 关键流程

### 6.1 实时识别流程（**FunASR WebSocket 流式**）

选型决定：FunASR 服务支持 WebSocket **流式**识别（持续上行音频小块、持续下行 partial/final 文本），因此前端采用**持续上传 + 服务端 partial/final 事件**的流式方案，接近原版 sherpa 的 interim 体验。

```
① 用户点开始 → getUserMedia 授权 → Web Audio 采集（16kHz mono）
② 前端按小块（如 1s / 4096 采样）持续编码 WAV 帧 → ws.send(binary)，不打句断
③ 后端保持到 FunASR 的长 WS 连接，把音频小块转发上行
④ FunASR 下行：
     partial 文本（说着实时出字，半截稿）→ 后端直接推 {type:'asr-partial', text}
     final 句（VAD 自动断句定稿）      → 后端调 analyzeText() 词库分析
                                          → 推 {type:'asr-final', text, analysis}
⑤ 前端：partial 行随字更新；final 句追加为正式字幕行（高亮+统计累加）
```

**服务端断句**：FunASR 自带 VAD 模型自动切句发 `final`（这正是选它优于 Whisper 分片的原因之一）；后端**不做**前端切句，只透传。若 FunASR 用 Paraformer-online 需要调 hotword/端点参数，开发阶段按官方文档调。

**真实时性说明**：延迟 ≈ FunASR 推断延迟（通常亚秒级到 1s+，取决于服务器 GPU/模型）。相比原"句级分片"方案更实时，且不需要前端 VAD 切句逻辑（原 §6.1 的"VAD 静音切句→分片"实现要点作废，前端只需持续上传）。

**失败处理**：FunASR 连接断开 → 后端给前端推 error，前端显示"识别服务断开，正在重连…"；按指数退避重连，不丢已定稿句子。

### 6.2 AI 实时反馈流程

```
触发条件（双触发）：
  A. 自动：session 内 fullText 增量 ≥ 阈值（默认 50 字，设置页可调 30~100，原版为 30）且距上次 AI 反馈 ≥ 冷却 8s（防连续触发轰炸）
  B. 手动：用户点「反馈」按钮 → 立即触发一次（带冷却 2s 误触保护）
  触发即记录 lastFeedbackAt / 已反馈字数水位，防止重复
执行：
  后端取 session 缓存 fullText（最近 500 字窗口，prompt 模板本身只取 text.slice(-500)）
  → lib/prompts.js getRealtimePrompt(text, context, customPrompt) 组装
  → LLM API（max_tokens 150）→ 返回单一短提示
  → 推 {type:'ai-feedback', text} → 前端 classifyFeedback 分类渲染
失败处理：LLM 报错 → 推 error 事件，前端气泡提示"实时反馈暂时不可用"，不打断训练
```

### 6.3 报告生成流程

```
用户点「生成报告」→ 前端立即展示 loading
→ POST /api/report {fullText, stats:{duration,totalWords,fillers,hedges,vagueWords}}
→ 后端 lib/prompts.js getReportPrompt 组装（含 customPrompt 合并，逻辑与现版一致）
→ LLM API（max_tokens 8192，温度沿用 0.7）→ Markdown 文本
→ 前端复用原版 markdown→HTML 渲染进弹窗
→ 操作：📋 复制全文 / 💾 下载（浏览器 Blob 下载 `表达训练-YYYY-MM-DD-HHMM.md`，含原文段）
失败处理：弹窗内红色错误 + 重试按钮；网络问题提示检查 API 配置
```

### 6.4 设置保存流程（含一键测试）

```
设置页 → PUT /api/settings（LLM provider 配置 + ASR provider 配置 + 反馈阈值）
→ 后端写 config/settings.json（密码脱敏存储见 7.2）
→ 前端调 POST /api/settings/test-llm → 成功才提示"已保存"，失败停在页面显示错误（原版交互）
ASR 连通性测试：设置页加「测试 ASR」按钮 → 录 3 秒样音 → 调 transcribe → 显示识别文本（验证 key/计费/网络一次到位）
```

---

## 7. 设置与配置（API Key 管理）

### 7.1 存储位置与方案对比

| 方案 | 评价 |
|------|------|
| **服务端 `config/settings.json`（推荐）** | 与现版 `userData/settings.json` 结构一致（per-provider 结构可整段复用），key 只存在于后端进程内，前端拿不到明文；本项目为**个人本机工具**（localhost，无多用户），该模型简单可靠 |
| `.env` 环境变量 | 作为**增强项**同时支持：`ASR_PROVIDER`、`ASR_API_KEY`、`LLM_PROVIDER`、`LLM_API_KEY` 等；环境变量优先级高于 settings.json。适合将来部署到服务器/CI 注入密钥 |
| 浏览器 localStorage | ❌ key 会暴露给任何打开页面的人/脚本（XSS 面），且多浏览器不同步；仅当"无后端纯静态"才考虑，本架构不采用 |
| 硬编码 | ❌ 铁律禁止（源代码入库即泄露） |

**结论：`config/settings.json`（git 忽略）为主，`.env` 环境变量为覆盖层。** 提供 `config/settings.example.json` 模板（keys 为空）+ `.env.example` 模板，首次运行检测到缺 key 时日志与前端均有引导提示。

### 7.2 存储细节

- `config/` 目录整体加入 `.gitignore`；`.env` 也加入 `.gitignore`（提交 `.env.example` 即可）。
- settings.json 结构（向后兼容现版字段）：

```jsonc
{
  "llm": {
    "provider": "deepseek",                // deepseek | openai | custom
    "providers": { /* 原版同构：deepseek{apiKey,model} openai{...} custom{apiKey,baseUrl,model} */ }
  },
  "asr": {
    "provider": "funasr",              // funasr（自部署，无其他候选）
    "funasr": { "wsUrl": "", "token": "" },  // FunASR WebSocket 地址（待用户提供）、可选 token
  },
  "feedback": { "autoThresholdChars": 50, "cooldownSec": 8 }
}
```

- 安全边界声明：本工具定位个人本机使用，key 明文存于本机项目目录属**可接受风险**（等同原版 Electron 明文 `userData/settings.json`）；若未来要公开部署/多用户，另行引入服务端加密（环境变量注入 + key 脱敏回显已为此预留接口）。

---

## 8. 目录结构规划

```
expression-trainer/
├── AGENTS.md                  # 保持（铁律）
├── README.md                  # 更新：WebUI 版安装/运行/配置说明（Phase 4）
├── package.json               # 【修改】重写：scripts.start = "node server/index.js"；
│                              #        移除 electron / sherpa-onnx-node 依赖
├── .gitignore                 # 【新增】config/、.env、node_modules、*.log
├── .env.example               # 【新增】环境变量模板（ASR/LLM key 可注入覆盖）
│
├── server/                    # 【新增】后端
│   ├── index.js               #   入口：HTTP + WS 装配
│   ├── config.js              #   配置加载（env > settings.json）+ 校验
│   ├── routes/
│   │   ├── settings.js        #   GET/PUT /api/settings + /api/settings/test-llm
│   │   ├── analyze.js         #   POST /api/analyze
│   │   ├── report.js          #   POST /api/report
│   │   └── health.js          #   GET /api/health
│   ├── ws/
│   │   ├── session.js         #   会话状态（fullText/节流水位）
│   │   └── handlers.js        #   音频帧/命令处理 + 事件推送
│   ├── asr/
│   │   └── client.js          #   FunASR WebSocket 客户端（原生 ws，不引 SDK）
│   └── llm/
│       └── client.js          #   LLM 客户端（由 lib/ai-feedback.js 提炼，删 ollama）
│
├── public/                    # 【迁移自 src/】前端静态资源（Express 托管）
│   ├── index.html             #   主界面（原版结构 + 新增「AI 手动反馈」按钮位）
│   ├── styles.css             #   原样迁移（深色主题/全屏字幕/三面板）
│   ├── app.js                 #   主逻辑（替换 IPC 调用为 api-client 封装）
│   ├── api-client.js          #   【新增】fetch + WebSocket 单例 + 重连
│   ├── settings.html / settings.js   # 设置页（增 ASR 配置区 + 测试按钮）
│   └── prompt-editor.html / prompt-editor.js   # 自定义提示词编辑器
│
├── lib/                       # 【原样保留】纯 JS 逻辑
│   ├── lexicon.js             #   词库分析（零改动）
│   ├── prompts.js             #   Prompt 模板（零改动）
│   └── ai-feedback.js         #   【修改】删 ollama 分支；其余不变（或并入 server/llm/client.js）
│
├── data/                      # 【原样保留】
│   ├── emotion-lexicon.json
│   └── tiered-lexicon.json
│
├── config/                    # 【新增，gitignore】运行时配置
│   ├── settings.json          #   用户设置（含 API key，不入库）
│   └── settings.example.json  #   模板（入库）
│
├── docs/
│   └── DESIGN.md              # 本文件
│
├── main.js / preload.js       # 【保留】Electron 壳，留作功能参考（用户确认）——WebUI 版不使用，但不删除
├── lsp-verify-test.js         # 【保留】遗留测试文件（后续清理）
├── models/                    # 【保留目录】空目录，不填模型；部署/运行时忽略（铁律 1 只禁止本地模型，目录本身无碍，是否删除到 Phase 4 定）
└── src/                       # 【保留】Electron 渲染进程源码，迁移参考；新前端实现在 public/
```

依赖清单（npm）：`express`、`ws`；devDependencies 可加 `nodemon`（可选）。**总共 2~3 个 npm 包**，无其他任何安装。

---

## 9. 实施步骤（分阶段，每阶段可验收）

### Phase 1 — 骨架 + 词库复用（纯 Web 跑通原版"粘贴分析"链路）

- 任务：package.json 重写（移除 electron/sherpa 依赖，改 start=node server/index.js）、`server/index.js` 起服务、静态托管 `public/`、`/api/analyze`、设置读写；迁移 index/styles/app 前端并把 IPC 调用替换为 REST。**Electron 原文件（main.js/preload.js/src/）保留作功能参考，不删除。**
- 前端适配：`window.api.analyzeText()` → `fetch('/api/analyze')`；其余按钮先占位。
- **验收标准**：`npm install && npm run dev` 后浏览器打开首页；「粘贴逐字稿」→ 字幕高亮（笼统词/填充词/犹豫词三类颜色）、统计面板数字正确、AI 反馈按钮见 UI；两端词表结果与原版分析输出一致（可拿原版 README 示例文本对照）。

### Phase 2 — FunASR 流式接入（实时识别）

- 任务：录音模块（getUserMedia + 持续小块 WAV 上传）、WS 通道（音频流上行 + `asr-partial`/`asr-final` 事件）、`server/asr/client.js` 实现 **FunASR WebSocket 客户端**（协议细节**从官方仓库 runtime 示例调查**：握手/帧格式/partial-final 消息/重连）。
- 前置：用户提供 FunASR 服务 ws:// 地址；设置页可填（或 .env）。
- 验收标准：授权麦克风 → 说 3 个不同句子 → 说话时 partial 随字出现、句末 final 定稿追加字幕行，高亮与统计随句更新；FunASR 断开：字幕区红色提示、自动重连、恢复后不崩溃；**AI 反馈与报告按钮此阶段可禁用**。

### Phase 3 — AI 反馈 + 报告

- 任务：`server/llm/client.js`（deepseek/openai/custom）、AI 反馈自动/手动触发 + 冷却、设置页（含保留"测试 LLM 连接"）、报告弹窗 + 浏览器下载、自定义 prompt 编辑器接通。
- 验收标准：连说 2 分钟以上 → 出现 ≥3 条分类反馈（含笼统词替换、正向激励）；点「AI」按钮立即出 1 条；结束生成报告：6 维度齐全、可复制、可下载 .md；设置页改 provider（deepseek↔custom）后测试连接通过再生效。

### Phase 4 — 打磨与上线

- 任务：设置页加「测试 ASR」；错误分级提示（缺 key/鉴权失败/网络/限流）；WS 断线重连体验；README 重写（安装、.env 配置、启动、使用说明）；可选：流式 ASR 升级口子、tiered 词库增强、手机浏览器兼容（录音权限提示）。
- 验收标准：**首次体验路径 <5 分钟**（clone → npm i → 填两个 key → 浏览器出字幕）；连续训练 30 分钟无崩溃/无静默丢句；README 覆盖全部配置项。

---

## 10. 风险与待确认事项

### 10.1 需要用户拍板的决策（阻塞项）

| # | 事项 | 选项/状态 | 影响 |
|---|------|-----------|------|
| 1 | **FunASR 服务地址** | ✅ 方案已定；**地址+token 做成配置项**（config/settings.json 或 .env），用户稍后提供，**不阻塞开发**（缺省时 UI 提示"未配置 ASR 服务"） | Phase 2 前置但不阻塞编码；配置化后随时可填 |
| 2 | 触发阈值默认值 | 原版代码是 30 字（README 却写 50 字） | 设计按"默认 50 字、可调 30~100"执行（配置项，可改） |
| 3 | Electron 源码 | ✅ **保留参考**（用户确认：不删除，留作功能参考） | WebUI 版不复用 Electron 运行，但保留 main.js/src/ 对照功能 |
| 4 | 部署形态 | ✅ **打包后部署到 Nginx**（用户确认）；host/port 配置化，可随时改 | Phase 4 打包（静态产物 + 后端服务）→ Nginx 托管/反代 |

### 10.2 已知风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| FunASR 服务不可达/未部署（ws 连接失败） | 高 | Phase 2 前置确认地址；无服务时启动不崩、UI 给引导文案；「测试 ASR」按钮提前到 Phase 2 验收 |
| FunASR 流式协议细节不符预期（帧格式/消息结构） | 中 | 开发阶段先从官方仓库 runtime 示例调查协议，做最小验证（wav 文件回放）再接入实时流 |
| 后端到 FunASR 延迟/并发（服务器负载高） | 中 | 单会话单连接串行；必要时后端做队列并发上限 |
| 断线丢句（FunASR 重连期间已说内容） | 中 | 指数退避重连；partial 已在本地缓存的文本重放；最终以 final 句为准，不重复累加 |
| 明文 API key 于 `config/settings.json` | 低（本机自用） | 铁律已有认知；文档 7.2 声明边界；`.gitignore` 保证不入库 |
| 浏览器录音兼容性（Firefox/Safari） | 低 | Web Audio + getUserMedia 全现代浏览器支持；WAV 编码自己写（无外部依赖），已覆盖 WebKit 差异 |

### 10.3 明确不做（本期范围外）

- ❌ 不做用户系统/多人鉴权（除非 10.1-4 确认为局域网部署）
- ❌ 不做流式字级字幕（Phase 4 仅留口子）
- ❌ 不做模型下载/本地推理的任何路径（铁律 1 的防御性表述：即便选项列表里出现"本地"字样的一律砍掉）
- ❌ 不做移动端 App / PWA 打包

---

*本文档为设计稿，所有"待用户确认"项确认后即最终定稿，Phase 1 起按 §9 顺序实施。*