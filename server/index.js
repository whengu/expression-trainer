// expression-trainer WebUI 服务入口
// Phase 1: HTTP(REST) + 静态托管 + health；Phase 2 挂 WS
const express = require('express');
const http = require('http');
const path = require('path');

const { getConfig } = require('./config');

async function main() {
  const config = getConfig();
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // 静态托管前端（public/）
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // 路由
  app.use('/api', require('./routes/health'));
  app.use('/api', require('./routes/analyze'));
  app.use('/api', require('./routes/settings'));
  app.use('/api', require('./routes/feedback'));
  app.use('/api', require('./routes/report'));

  // 非 API 路径回首页（SPA 不需，但兜底）
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  const server = http.createServer(app);

  // Phase 2: WebSocket 会话（音频上行 + asr-partial/final）
  const { attachWS } = require('./ws/server');
  attachWS(server);

  server.listen(config.server.port, config.server.host, () => {
    console.log(`[server] 宇宙无敌表达训练 WebUI 已启动: http://${config.server.host}:${config.server.port}`);
  });

  // 优雅退出：Ctrl+C (SIGINT) 或终止信号 (SIGTERM) → 关 HTTP/WS 后退出
  function shutdown(signal) {
    console.log(`\n[server] 收到 ${signal}，优雅退出...`);
    // 停止接受新连接；已有请求/WS 会话处理完后回调
    server.close(() => {
      console.log('[server] 已关闭，退出');
      process.exit(0);
    });
    // 兜底：3 秒内没关完（如长连接挂住）则强制退出，避免进程残留
    setTimeout(() => {
      console.log('[server] 关闭超时，强制退出');
      process.exit(0);
    }, 3000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] 启动失败:', err);
  process.exit(1);
});