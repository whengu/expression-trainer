// server/ws/server.js — WebSocket 服务器（Phase 2）
// 挂载到 Express http server；处理 /ws 上的会话
// 内部协议：
//   收 {type:'start'} → 创建 FunASR 会话
//   收 binary(WAV帧) → 转发 FunASR（剥离 WAV 头，转裸 PCM 上行——见 asr/client.js）
//   收 {type:'stop'} → 结束 FunASR 会话 → 会话清理
//   发 {type:'asr-partial', text} / {type:'asr-final', text, analysis} / {type:'error', message}
const { WebSocketServer } = require('ws');

const { getConfig } = require('../config');
const { analyzeText, loadLexicon } = require('../../lib/lexicon');

loadLexicon(); // 确保词库已加载（幂等）

// 每个连接独立 FunASR 会话（Map 按 socket 隔离，避免多连接互相踩踏）
const sessions = new Map();

function attachWS(server) {
  // maxPayload: 音频帧最大 ~32KB（1s WAV），限 1MB 防 DoS（ws 默认 100MB 过大）
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 * 1024 * 1024 });

  wss.on('connection', (socket) => {
    socket.on('message', async (data, isBinary) => {
      try {
        if (isBinary) {
          // 音频帧 → 转发给该连接的 FunASR 会话
          await handleAudioFrame(socket, data);
          return;
        }
        const msg = JSON.parse(data.toString());
        if (msg.type === 'start') {
          await handleStart(socket);
        } else if (msg.type === 'stop') {
          await handleStop(socket);
        }
      } catch (e) {
        console.error('[ws] 处理消息失败:', e);
        send(socket, { type: 'error', message: e.message });
      }
    });

    socket.on('close', () => {
      // 断开=会话结束；停止该连接的 FunASR
      const session = sessions.get(socket);
      if (session) {
        try { session.close(); } catch {}
        sessions.delete(socket);
      }
    });
  });

  return wss;
}

async function handleStart(socket) {
  // 若该连接已有会话，先关旧的（幂等）
  const old = sessions.get(socket);
  if (old) {
    try { await old.close(); } catch {}
    sessions.delete(socket);
  }

  const config = getConfig();
  const provider = config.asr?.provider || 'funasr';
  // 白名单校验（审查 P1-3）：未知 provider 直接报错，避免静默回退旧版造成"选了新版实际连旧版"假象
  if (!['funasr', 'funasr-v2'].includes(provider)) {
    send(socket, { type: 'error', message: `未知 ASR provider: ${provider}` });
    return;
  }
  const ep = provider === 'funasr-v2'
    ? { wsUrl: config.asr?.funasrV2?.wsUrl, token: config.asr?.funasrV2?.token, label: 'FunASR v2' }
    : { wsUrl: config.asr?.funasr?.wsUrl,   token: config.asr?.funasr?.token,   label: 'FunASR' };

  if (!ep.wsUrl) {
    send(socket, { type: 'error', message: `${ep.label} 服务地址未配置（config/settings.json 或 .env）` });
    return;
  }

  const factory = provider === 'funasr-v2'
    ? require('../asr/client').createFunasrV2Session
    : require('../asr/client').createFunasrSession;

  const session = factory({
    wsUrl: ep.wsUrl,
    token: ep.token,
    socket,
    onPartial: (text) => send(socket, { type: 'asr-partial', text }),
    onFinal: async (text) => {
      // final 句 → 词库分析 → 一并下发
      const analysis = analyzeText(text);
      send(socket, { type: 'asr-final', text, analysis });
    },
    onError: (message) => send(socket, { type: 'error', message }),
  });
  sessions.set(socket, session);
  send(socket, { type: 'ready' });
}

async function handleAudioFrame(socket, wavBuffer) {
  // 音频帧（WAV）→ 该连接的 FunASR 会话。未 start 时静默丢弃
  const session = sessions.get(socket);
  if (!session) return;
  await session.writeAudio(wavBuffer);
}

async function handleStop(socket) {
  const session = sessions.get(socket);
  if (session) {
    await session.close();
    sessions.delete(socket);
  }
}

function send(socket, obj) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(obj));
  }
}

module.exports = { attachWS };