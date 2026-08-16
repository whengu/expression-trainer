# expression-trainer WebUI 版 — 项目规则

## 绝对铁律：模型禁止在本地

1. **禁止在本地安装任何模型**（包括本地下载、缓存、存储模型权重文件）
2. **禁止在本地部署/加载/运行任何模型**（ASR 语音识别模型、LLM 等一律不准本地跑）
3. **所有模型能力必须通过远程 API 调用**（语音转文字走 ASR API，AI 分析走 LLM API）
4. 本地只保留代码，不保留任何模型文件；`models/` 目录不得填充本地模型

> 违反此铁律 = 信任破裂。任何涉及"本地模型"的操作都要先问用户。

## 项目定位

- 将原版 Electron 桌面应用（fxy2311-youyou/expression-trainer）改造为 **WebUI 版本**
- 砍掉 Electron 和 sherpa-onnx-node 本地识别依赖
- 前端 Web 界面 + 后端服务，语音识别和 AI 分析全部走 API

## 开发纪律

- **除了 NPM 依赖，不准安装任何东西**（不准装 Python 包、系统软件、模型、工具链等）
- **语法检查用 `npm run check`**（node --check 遍历全部 JS，秒级完成）。禁止用 `npm run build` 来检查语法——本项目无 build 流程，build 会拉整个构建链、耗时且与语法检查无关
- **代码开发中的所有写入操作，只能写入项目目录内**（D:\myagent\workspace\project\expression-trainer），严禁写入系统临时目录（/tmp、C:\TEMP 等）
- 变更操作先报告、获授权后执行
- 代码改动遵循 design-first：先写设计文档，用户批准后再编码