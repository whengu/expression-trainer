# TASKS — expression-trainer WebUI 实施任务清单

> 依据 docs/DESIGN.md（v1.1）拆解。逐步更新，不累积。

## 状态图例
- [ ] 待办
- [x] 完成
- [⏸] 阻塞（待用户/待调查）

## Phase 0 — 前置（已完成）
- [x] DESIGN.md v1.1 定稿（FunASR、Electron 保留、Nginx 部署）
- [x] package.json 清理 electron/sherpa 依赖
- [x] npm run check 语法检查命令建立
- [x] AGENTS.md 铁律 + 语法检查规则
- [x] LSP typescript（vtsls）配置生效
- [x] Hermes 快速检查 .js/.ts 剔除（源码补丁 + 已重启生效）

## Phase 1 — 骨架 + 词库复用
- [ ] 读原版核心源码确认复用点
- [ ] server 骨架（config.js / index.js / 静态托管 / health）
- [ ] /api/analyze 词库分析
- [ ] /api/settings + test-llm（脱敏）
- [ ] 前端迁移 public/ + IPC→REST
- [ ] npm run dev 验收（粘贴分析链路）
- [ ] 跟踪文档初始化（TASKS/IMPLEMENTATION/DECISIONS）

## Phase 2 — FunASR 流式接入
- [⏸] FunASR WebSocket 协议调查（子智能体）——地址待用户提供
- [ ] 录音模块（getUserMedia + 16kHz + 小块 WAV 上传）
- [ ] WS 通道（音频上行 + asr-partial/asr-final）
- [ ] server/asr/client.js FunASR 客户端
- [ ] 验收：实时出字 + 断线重连

## Phase 3 — AI 反馈 + 报告
- [ ] LLM 客户端（deepseek/openai/custom）
- [ ] AI 实时反馈（双触发 + 冷却）
- [ ] 报告生成 + 浏览器下载
- [ ] 设置页完整（ASR + LLM + 阈值）

## Phase 4 — 打包 + Nginx 部署
- [ ] 打包脚本（静态 + 服务）
- [ ] Nginx 配置（托管/反代）
- [ ] README 重写
- [ ] 首见路径验收

## 代码审查优化
- [ ] 性能优化
- [ ] 代码质量审查