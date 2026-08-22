# 🚀 宇宙无敌表达训练系统（WebUI 版）

一个帮你训练口语表达精准度的 Web 应用：**实时语音识别 → 词库匹配 → AI 反馈**。
由原 Electron 桌面版（fxy2311-youyou/expression-trainer）改造而来：**模型全部走远程 API，本地不落地任何模型**。

## 功能

- 🎤 **实时语音识别**：FunASR（自部署，WebSocket 流式）实时转写，边说边出字
- 📝 **全屏字幕显示**：实时显示每句话，partial/final 渐进更新，词级高亮
- 🔍 **词库分析**：自动检测填充词、犹豫词、笼统词，给出精准替代建议（本地词库 146+ 情绪词，离线匹配，无延迟）
- 🤖 **AI 反馈**：每 N 字触发语境化建议（DeepSeek / OpenAI / 自定义 OpenAI 兼容后端）
- 📊 **分析报告**：结束后 6 维度深度分析（逻辑/直接性/填充词/密度/词汇/亮点）
- 📋 **粘贴逐字稿**：不录音也能把逐字稿贴进来分析

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | 原生 HTML/JS/CSS（零构建，`public/` 直接托管） |
| 后端 | Node.js + Express + ws |
| ASR | **FunASR 自部署 WebSocket 流式**（官方协议，不引 SDK） |
| LLM | DeepSeek / OpenAI / 自定义 OpenAI 兼容（API） |
| 部署 | Nginx（静态 + 反代）/api 与 /ws |

## 快速开始

```bash
npm install          # 安装依赖（仅 express + ws，共 68 包零漏洞）
npm run dev            # 启动 → http://localhost:3000
```

> 语法检查（可选）：`npm run check`（node --check 遍历全部 JS）

## 配置

首次使用打开设置页（⚙️）填写：
- **AI 反馈（LLM）**：选后端 → 填 API Key → 测试连接
- **语音识别（ASR）**：填 FunASR WebSocket 地址（ws://host:port）与可选 token
- **反馈触发**：自动反馈阈值（默认 50 字）

配置保存在 `config/settings.json`（可用 `.env` 环境变量覆盖，见 `.env.example`）。

## 部署（Nginx）

见 [`deploy/README.md`](deploy/README.md)：打包 → 服务器解包 → Nginx 静态托管 + 反代 /api 与 /ws。

## 项目结构

```
server/            Node 后端（入口、配置、REST 路由、WS 会话、FunASR/LLM 客户端）
public/            Web 前端（index/styles/app/recorder/api-client/settings）
lib/               复用原版分析逻辑（lexicon 词库 / prompts 模板，原样保留）
config/            运行时配置（settings.example.json 模板；settings.json 不入库）
docs/              设计/实现/任务/决策/FunASR 协议规范
deploy/            Nginx 配置模板 + 部署指南
data/              情绪词库数据（emotion-lexicon.json）
```

## 变更记录

- **2026-08**：WebUI 版改造——移除 Electron/sherpa-onnx 本地依赖；ASR 改 FunASR 自部署 WebSocket；LLM 改远程 API（删 ollama）；部署改 Nginx 打包。原 Electron 源码保留在仓库作功能参考。

## License

MIT