# DECISIONS — expression-trainer WebUI 决策记录

> 记录影响方向的决策 + 依据（用户确认/调查结论/设计评审）。只记结论和依据，不记过程。

## 2026-08-14

| 决策 | 依据 | 结论 |
|------|------|------|
| ASR 选型 | 用户确认 + FunASR 仓库（19k★ 流式支持） | **FunASR 自部署 WebSocket**，不引 SDK；地址/token 配置化（config 或 .env），用户稍后提供，不阻塞开发 |
| LLM 后端 | 原版已有 + 用户环境 | deepseek / openai / custom，移除本地 ollama（违反铁律1） |
| Electron 源码 | 用户确认 | **保留**，留作功能参考，不删除；新前端实现在 public/ |
| 部署形态 | 用户确认 | **打包后部署到 Nginx**；host/port 配置化可改 |
| 前端技术栈 | 设计评审 | 原生 HTML/JS ES Module，零构建链，复用原版代码 |
| 后端技术栈 | 设计评审 | Node.js + Express + ws，2~3 个 npm 包 |
| 实时通信 | 设计评审 | WebSocket（audio 上行 binary + partial/final 下行） |
| 阈值默认 | 设计评审 | 50 字自动触发 / 冷却 8s，可调 |
| 语法检查 | 用户确认 | `npm run check`（node --check 遍历），禁止用 build 检查 |
| 快速检查 bug | 子智能体根因调查 | 仅修改 Hermes LINTERS 表剔除 .js/.ts（本地最小修复） |
| FunASR 协议 | 子智能体调查官方仓库（58 API 调用） | 端口 10095、无鉴权、上行配置JSON→裸PCM→结束JSON、下行2pass-offline=定稿；规范存 docs/FUNASR_WEBSOCKET_SPEC.md |
| WS 会话并发 | 代码审查优化 | 每连接独立 FunASR 会话（Map 隔离），避免多连接踩踏 |
| Linux 后台启动 | 排查经验 | git-bash background 下 node 需 pty=true；Windows 上 powershell Stop-Process 清理残留 |