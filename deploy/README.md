# 部署指南 — 宇宙无敌表达训练 WebUI（Nginx + Node）

## 架构

```
浏览器 ──> Nginx (80/443)
              ├── /          → 静态前端（项目 public/ 目录，打包时拷贝）
              ├── /api/*     → 反代 → Node 127.0.0.1:3210
              └── /ws        → WebSocket 反代（Upgrade）→ Node 127.0.0.1:3210
```

- **Nginx**：托管前端静态资源 + 反代 API/WebSocket
- **Node 服务**（express + ws）：词库分析 /api/analyze、设置 /api/settings、LLM 反馈/报告、FunASR 转发
- **FunASR**：服务器上自部署的 WebSocket 识别服务（地址在 config/settings.json 或 .env 配置）

## 一、打包（本机）

把项目打成部署包：代码 + 依赖 + 前端产物。

```bash
# 在项目根目录
npm ci                    # 安装依赖（与 package-lock.json 一致）
npm run check             # 语法检查（可选，但建议）
tar -czf expression-trainer-webui.tar.gz \
  --exclude='.git' \
  --exclude='node_modules/.cache' \
  --exclude='*.log' \
  .                       # 把整个项目打包（含 node_modules 与 public/）
```

> 如果不想带 node_modules，服务器上再 `npm ci` 也一样（推荐，包更小）。

## 二、服务器部署

```bash
# 1. 解包到目标目录
mkdir -p /opt/expression-trainer
tar -xzf expression-trainer-webui.tar.gz -C /opt/expression-trainer

# 2. 配置（首次）
cd /opt/expression-trainer
cp config/settings.example.json config/settings.json
#   编辑 config/settings.json 填：LLM apiKey / FunASR wsUrl / token / 端口
#   或复制 .env.example 为 .env 用环境变量覆盖

# 3. 启动 Node 服务（监听 127.0.0.1，仅 Nginx 访问）
npm run dev                 # 前台；生产建议 pm2 / systemd
#   默认端口 3000；Nginx 模板里用的 3210，如需改端口：
#   EXPR_PORT=3210 npm run dev
```

## 三、Nginx 配置

1. 把前端静态目录拷到 Nginx 托管路径：
   ```bash
   mkdir -p /opt/expression-trainer/public   # 已存在（解包自带）
   # 模板 server 块 root 指向它
   ```
2. 复制配置：`cp deploy/nginx.conf.example /etc/nginx/conf.d/expression-trainer.conf`
3. 改 `server_name` 为实际域名/IP；如需 https 加证书
4. 若 Node 端口不是 3210，同步改 `proxy_pass` 两处
5. 检查并重载：
   ```bash
   nginx -t && nginx -s reload
   ```

## 四、验证

| 检查 | 命令 | 期望 |
|------|------|------|
| 页面 | curl http://<host>/ | 200 + HTML |
| 健康 | curl http://<host>/api/health | {"ok":true,...} |
| 分析 | curl -X POST http://<host>/api/analyze -H 'Content-Type: application/json' -d '{"text":"我觉得可能很好"}' | analysis JSON |
| WebSocket | 页面点开始录制（需 https/localhost + 麦克风授权） | WS 握手成功 |

## 五、环境变量（可选覆盖）

| 变量 | 含义 | 默认 |
|------|------|------|
| EXPR_HOST | Node 监听地址 | 127.0.0.1 |
| EXPR_PORT | Node 端口 | 3000 |
| LLM_PROVIDER | LLM 后端 | deepseek |
| LLM_API_KEY | LLM key | （settings.json） |
| ASR_WS_URL | FunASR WebSocket 地址 | （settings.json） |
| ASR_TOKEN | FunASR token（官方无鉴权，预留） | （settings.json） |

## 六、常见问题

- **麦克风没声音/权限被拒**：getUserMedia 需要 **https 或 localhost**。http://IP 会被浏览器阻止 → 必须配 https（证书）。
- **WS 连不上**：确认 Nginx `location /ws` 的 Upgrade 头配置正确；Node 服务活着；端口一致。
- **ASR 识别不出字**：确认 FunASR 服务在线、wsUrl 正确、音频格式 16k/16bit/mono。
- **LLM 反馈空白**：设置页填 API Key 并「测试连接」。