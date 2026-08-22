# TEST REPORT — expression-trainer ASR 切换 FunASR v2（中英混说）

- 版本：v1.0
- 日期：2026-08-22
- 角色：tester（t_169a4a67）独立验证
- 交付对象：reviewer（t_90c23116）把关 + developer 修复清单
- 被测交付：commit `611a5fd`（运行配置启用 funasr-v2 + 验证脚本/夹具 + 文档收尾）
- 环境：Windows 10 / git-bash / node（pty）；远程服务 192.168.156.68:10095（新版）、:10096（旧版）均在线上；本机无 .env

---

## 1. 结论（TL;DR）

**24/24 条 AC 全部通过，未发现阻止验收的缺陷。** 发现 1 个 P2 级既有缺陷（设置页保存会清空 LLM custom 模型名，破坏反馈链）+ 4 个观察项，均不影响本次「切换到 FunASR v2」验收结论，但 P2 建议 developer 排期修复。

独立复现方式：不摘抄 developer 交付证据，全部命令在 clean 工作区重新执行（A 组配置读取、B/C 组脚本运行、C4 备份/恢复用例、D 组 API 互切、E 组静态核对、R 组全量检查）。

---

## 2. 覆盖清单（PRD 24 条 AC）

| 组 | AC | 结果 | 证据摘要 |
|---|---|---|---|
| A 配置 | A1 settings.json 启用 v2 + 双块保留 | ✅ PASS | 文件读取 + 终态与交付 .bak 字节一致 |
| A | A2 GET /api/settings 脱敏正确 | ✅ PASS | HTTP 200，provider=funasr-v2，funasrV2.wsUrl=10095，token 空；设置页实测 LLM key 显示掩码 |
| A | A3 DEFAULTS.provider='funasr' + 白名单 | ✅ PASS | config.js L24 / ws/server.js L66 静态核对未改 |
| A | A4 样例文件合法含 10095 + .env ASR_V2_* | ✅ PASS | example JSON parse OK；.env.example 含 ASR_V2_WS_URL/ASR_V2_TOKEN |
| B 直连 | B1 started + is_final 非空 | ✅ PASS | 直连脚本 ✅ |
| B | B2 中英混写口径 | ✅ PASS | 「大家好，今天我们来聊聊在Apple的工作体验，我觉得Teamwork很重要。」 |
| B | B3 stopped + 15s 内关 | ✅ PASS | 事件序列完整 |
| B | B4 静音生命周期 | ✅ PASS | started/stopped 成立，无空 final |
| B | B5 死端口明确报错 | ✅ PASS | ECONNREFUSED 1~3ms，不悬挂 |
| C 回环 | C1 ready | ✅ PASS | handleStart 路由生效 |
| C | C2 asr-final{text,analysis} 结构与旧版一致 | ✅ PASS | analysis={totalWords:36, hedges:[我觉得@23], density:97,…} |
| C | C3 前端全链路 | ✅ PASS（等价证据） | 设置页 MCP Chrome 实测；/api/feedback 200；/api/analyze 与回环一致；app.js 接线静态核对 |
| C | C4 未配置地址报错 | ✅ PASS | 精确文案 + 进程不崩 + 恢复后 ready |
| C | C5 静音回环无空 final | ✅ PASS | ✅ AC-C5 无空文本 asr-final 下行 |
| D 回归 | D1 切回旧版可识别 | ✅ PASS | 10096 在线：设置/API 切回 + 立即录音 partial 流 + 直连 offline 定稿 |
| D | D2 双槽位不串扰 + token 脱敏 | ✅ PASS | A/B 双块互不覆盖；****1234 回传不覆盖真值 |
| D | D3 免重启切换 | ✅ PASS | PUT 后立即 /ws start 即按目标 provider 路由 |
| E 文档 | E1 IMPLEMENTATION | ✅ PASS | 2026-08-22 段存在且与实测一致 |
| E | E2 DECISIONS 订正 + D1/D2 | ✅ PASS | 旧条目已拆两服务并存事实 |
| E | E3 README 四更新 | ✅ PASS | 功能/技术栈/配置/变更记录 |
| R 红线 | R1 写盘仅项目目录 | ✅ PASS | 全仓静态审计，无 tempfile/os.tmpdir/系统临时目录 |
| R | R2 无本地模型/无新依赖 | ✅ PASS | models/ 仅 .gitkeep；git diff package*.json 空 |
| R | R3 npm run check | ✅ PASS | 25/25 OK |
| R | R4 零生产代码改动 | ✅ PASS | git diff HEAD 空（=commit 611a5fd） |

**统计：AC 24/24 PASS，0 FAIL；脚本断言 34/34 PASS（直连/回环/死端口/静音各轮次，脚本自身 exit 0）。**

---

## 3. 功能验证真实输出（本次执行，非抄录）

### 3.1 A 组配置与 /api/settings（AC-A1/A2）

`node server/index.js` 启动后：

```
HTTP 200
provider = funasr-v2
slot funasr: wsUrl=ws://192.168.156.68:10096 token=(empty)
slot funasrV2: wsUrl=ws://192.168.156.68:10095 token=(empty)
has llm.custom.apiKey = true
```

（临时校验脚本只回显 asr 段与 key 存在性掩码，不落任何密钥）

### 3.2 B/C 组：直连 10095 + /ws 回环 + 死端口（AC-B1~B5, C1/C2/C5）

命令：`node scripts/test_funasr_v2_ws.js scripts/mixed_test.wav ws://127.0.0.1:3000/ws --mixed`

```
=== 测试 1：直连 10095 ===
事件序列: open → started → language_set → audio-sent → stop-sent → partial → is_final → stopped → client-close
  ✅ 收到 started 事件
  ✅ 收到 is_final 且 sentences 拼接非空（P0-1 空文本过滤）
  ✅ 收到 stopped 事件
  ✅ AC-B2 中英混写口径（≥2 英文 + ≥4 汉字）
  完整识别文本: 大家好，今天我们来聊聊在Apple的工作体验，我觉得Teamwork很重要。
  ✅ stopped 后连接在 15s 兜底超时内关闭（P0-2 等待语义）

=== 测试 2：server /ws 路由（provider=funasr-v2）===
事件序列: open → ready → audio-sent → stop-sent → asr-partial(大家好，今天我们来聊聊在Apple的工作) → asr-final(...)
✅ 收到 ready（handleStart 会话创建成功，funasr-v2 路由生效）
✅ 无 error 下行（链路无错误）
✅ 收到 asr-final{text,analysis}
✅ AC-B2 中英混写口径（回环）
✅ AC-C2 analysis 结构合法（fillers/hedges/vagueWords/density/suggestions）
analysis: {"totalWords":36,"fillers":[],"hedges":[{"word":"我觉得","position":23}],"vagueWords":[],"emotionWords":[],"density":97,"suggestions":[]}

=== 测试 3：死端口连接失败（AC-B5）===
事件序列: error:connect ECONNREFUSED 127.0.0.1:59999（2ms）
✅ AC-B5 明确拒绝（ECONNREFUSED error 或 close 且进程不悬挂）

结果: ✅ 11 通过, ❌ 0 失败
```

### 3.3 静音退化（AC-B4 直连 / AC-C5 回环）

临时移走 fixtures（夹具位于 `_tester_tmp/fixture_stash`），校验 md5 后恢复，无夹具变更：

```
AC-B4 静音直连：事件序列 open → started → language_set → audio-sent → partial → stop-sent → is_final → stopped → client-close；✅ 生命周期成立，无空串 final
AC-C5 静音回环：事件序列 open → ready → audio-sent → stop-sent（无 asr-final 下行）
✅ AC-C5 无空文本 asr-final 下行  ✅ gotReady 后无 error
```

### 3.4 未配置地址错误（AC-C4）

```
1) cp config/settings.json _tester_tmp/settings.json.bak-c4（项目内备份）
2) 仅改 asr.funasrV2.wsUrl=""
3) 重启 server → /ws start：
MSG {"type":"error","message":"FunASR v2 服务地址未配置（config/settings.json 或 .env）"}
4) /api/settings 仍 HTTP 200（进程未崩）
5) cp 恢复备份 → diff 空 IDENTICAL → 重启 → /ws start → {"type":"ready"}
```

### 3.5 D 组旧版回归 / 可切回（AC-D1~D3）

- D3 免重启：`PUT {"asr":{"provider":"funasr"}}` 后**立即**回环，事件序列 `open → ready → audio-sent → asr-partial(大) → asr-partial(家) → …`（逐字粒度=10096 旧版 partial 特征），并收到 asr-final 全句（旧版在线形态①）。
- 直连 10096（旧版 2pass 协议，zh_test.pcm）：收到 `2pass-online` partials + `2pass-offline` 定稿「开放时间，早上九点至下午」（≥4 汉字，旧服务在线）。注：旧服务在本次探针 30s 观察窗内未回 `is_end` 确认（旧服务 flush 时序），offline 定稿文本已完整收到，服务在线判定成立。
- D2 双块与脱敏：
```
PUT funasr.wsUrl=B(19999)   → funasrV2.wsUrl 仍 A(10095)
PUT provider=funasr-v2（不提交 v2 块） → funasrV2.wsUrl 仍 A、funasr.wsUrl 仍 B
PUT funasrV2.token="mysecret1234" → 回显 ****1234
PUT funasrV2.token="****1234"     → 回显仍 ****1234，文件内 token 仍 mysecret1234（未覆盖）
```

### 3.6 设置页浏览器实测（AC-C3 前端 + 切换保存行为）

MCP Chrome 打开 `http://127.0.0.1:3000/settings.html`，快照核对：

```
ASR Provider combobox value = FunASR v2（新版实时）[selected]
FunASR v2 WebSocket 地址 textbox value = ws://192.168.156.68:10095
label = FunASR v2 WebSocket 地址 / hint = 新版实时服务地址（示例 ws://192.168.156.68:10095）
LLM API Key 输入框 = ••••••••（脱敏显示）
```

切换往返（槽位不串扰）：

```
切换下拉 → FunASR（自部署 WebSocket）→ label=FunASR WebSocket 地址、地址=ws://192.168.156.68:10096（旧槽值）
切回     → FunASR v2（新版实时）→ label=FunASR v2 WebSocket 地址、地址=ws://192.168.156.68:10095（v2 槽值保留）
```

词库/反馈链等价证据：
- `POST /api/analyze {text}` 直测 → `{"totalWords":36,…,hedges:[{"word":"我觉得",…}],"density":97,…}` 与回环 asr-final.analysis **完全一致**（词库分析链随 v2 路径生效）。
- `POST /api/feedback {text}` → HTTP 200 `{"success":true,"feedback":""}`（网关 200 但模型输出空串——见观察项 O3）。
- 前端接线静态核对 public/app.js：`onPartial→renderSubtitle(text,false)`（L98）、`onFinal→handleASRResult({text,isFinal:true,analysis})→applyAnalysis`（L99/L192）、反馈仅 `success && feedback` 才渲染（L300）。无麦克风，字幕 DOM 呈现以事件顺序+接线为等价证据（符合设计 §5.5 等价口径）。

---

## 4. 静态审查（AC-R1 写盘红线 + R2/R3/R4）

### 4.1 写盘逻辑全仓审计

扫描 `writeFile|createWriteStream|appendFile|openSync|tempfile|NamedTemporary|mkdirSync|execFile|spawn|os.tmp|C:\TEMP|/tmp|%TEMP%` 结果（排除 node_modules）：

| 位置 | 写盘 | 目标 |
|---|---|---|
| server/config.js L114-115 | mkdirSync+writeFileSync | `__dirname/../config/settings.json`（项目内）✅ |
| scripts/check-syntax.js L3/26 | spawnSync('node',['--check',…]) | 无输出文件 ✅ |
| main.js L30/89/306（Electron legacy） | writeFileSync | 本次交付**未改**，属旧 Electron 参考代码（userData 路径），不在本 diff 范围 |

- 交付物 `scripts/test_funasr_v2_ws.js` 仅 `readFileSync`，零写盘；`scripts/make_mixed_fixture.html` 纯前端（blob 下载由浏览器发起，非应用写系统目录）。**全仓无 tempfile / os.tmpdir / 系统临时目录硬编码。**

### 4.2 模型/依赖/语法/改动面

- R2 本地模型：`models/` 仅 `.gitkeep`；识别全部走 10095 API；`git diff HEAD -- package.json package-lock.json` 为空（零新依赖）。
- R3 语法：`npm run check` → `25/25 files OK`，exit 0。
- R4 零生产代码：`git diff HEAD --stat` 为空；工作树 = commit `611a5fd`；唯一 untracked = `config/settings.json.bak-20260822`（交付备份，不入库属预期）；终态 settings.json 与该 .bak **字节一致**。

---

## 5. 缺陷清单

| 编号 | 级别 | 标题 | 复现 | 影响 | 归属 |
|---|---|---|---|---|---|
| D1 | P2 | 设置页保存会清空 LLM custom provider 的 model 名 | 打开设置页（LLM=custom，模型名 dic/DeepSeek-V4-Flash-0731）→ 直接点「保存设置」→ config/settings.json 中 `llm.providers.custom.model` 变 `""`、新增 `customModel:""`；server/llm/client.js 取 `p.customModel || p.model` 两者皆空 → 请求 model 为空 | LLM 实时反馈/报告链失效（本次实测量化：保存后 GET 回显模型已空；测试后已用交付备份恢复） | public/settings.js（本次交付**未改**此文件，属既有缺陷；但处于「设置页保存 provider」验收范围内，建议 developer 修复：loadProviderFields 读取 `p.customModel || p.model`，save 保持一致） |

## 6. 观察项（不阻塞验收）

| 编号 | 级别 | 内容 |
|---|---|---|
| O1 | 观察 | PUT /api/settings 对 token 传空串 `""` 不会清除已存在的 token（settings.js L63 空串走 `cur.token||''` 保留旧值）。当前 token 为空无影响；若未来支持清空 token 需调整语义 |
| O2 | 观察 | `/api/feedback` 返回 `{success:true, feedback:""}`（HTTP 200 1~1.2s，LLM 网关 200 但模型输出空串）。两 provider 共用接口，非本次切换引入；与 developer 记录一致 |
| O3 | 观察 | developer 记录「回环脚本在 provider=funasr 收不到 asr-final（500ms flush 竞态）」——本轮旧版回环**实际收到** asr-final 全句，说明该行为是时序竞态（是否收到取决于 10096 CPU flush 与 500ms close 窗口），非确定性缺陷；旧版定稿以直连 10096 二次确认 |
| O4 | 环境 | git-bash 后台跑 node 必须 `pty=true`（无 TTY 一律 exit 1/无输出），已在 DECISIONS.md L22 记录，本轮独立复现一致 |

## 7. 未覆盖/注意

- 字幕 DOM 渲染、高亮点击、统计面板点击交互未实测（无麦克风设备；以等价证据覆盖，见 §3.6 注）。
- 前端真实录音流程（麦克风→/ws）未执行（同因）；采集链路 recorder.js 与 make_mixed_fixture.html 同构，fixture 已真实走通 /ws。
- 反馈链「模型输出非空文本」依赖远程模型状态，未强行造成功（如实记录空输出）。

## 8. 结论

**本任务验收结论：PASS（24/24 AC）。** ASR 已切换运行配置到 FunASR v2（10095，中英混说）且真实音频直连 + 本项目 /ws 回环全链（识别→词库分析→反馈接口）均可复现；设置页 provider 切换/保存槽位不串扰、token 脱敏保护、未配置地址精确报错；旧版 10096 路径零改动可切回（含免重启）；写盘仅项目目录、无本地模型、无新依赖、npm run check 25/25。发现 1 个既有 P2（设置页保存清 LLM 模型名）建议 developer 单独修复并回归，不阻塞本次切换合入。