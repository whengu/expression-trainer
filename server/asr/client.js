// server/asr/client.js — FunASR WebSocket 客户端（Phase 2 完成）
// 协议依据：docs/FUNASR_WEBSOCKET_SPEC.md（子智能体调查官方仓库所得，2026-08）
// 要点：
//   上行：① 配置 JSON 文本帧（mode/wav_format=pcm/is_speaking:true/chunk_size/audio_fs）
//        ② 裸 PCM 二进制帧（INT16LE，无 WAV 头；每帧 1920B=60ms @16k 对应 [5,10,5]）
//        ③ 结束 JSON 文本帧 {"is_speaking":false,"is_end":true}（收到 is_end:true 回执后关）
//   下行：全部文本帧 JSON；mode=2pass-offline/offline → 定稿；2pass-online/online+!is_final → partial；is_end → 完成
//   鉴权：无（官方协议无 token）；自签证书需 rejectUnauthorized:false
const WebSocket = require('ws');

// WAV → 16-bit PCM 裸流
// 严格校验 WAV 头：RIFF/WAVE/fmt=PCM(1)/channels=1/bits=16，data 偏移由 fmt chunk length 决定
// 不符合时原样透传（不瞎裁）；非 WAV 原样透传
function wavToPcm(wavBuffer) {
  const b = wavBuffer;
  if (b.length < 44) return Buffer.from(b);
  // RIFF/WAVE 魔数
  if (!(b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) // 'RIFF'
      || !(b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45)) { // 'WAVE'
    return Buffer.from(b);
  }
  // fmt chunk：找到 'fmt '（偏移 12 后常见 16 字节 fmt，但保险起见扫描）
  const audioFormat = b.readUInt16LE(20);   // 1 = PCM
  const channels = b.readUInt16LE(22);
  const bitsPerSample = b.readUInt16LE(34);
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
    return Buffer.from(b); // 非 16bit mono PCM，不处理（原样透传，避免错误裁剪）
  }
  // data 偏移：标准 44 字节头；非标准头从 'data' 标记算
  let dataStart = 44;
  const dataIdx = findChunk(b, 'data');
  if (dataIdx !== -1) dataStart = dataIdx;
  return Buffer.from(b.subarray(dataStart));
}

// 在 WAV 字节中找指定 chunk（如 'data'），返回 data 数据起始偏移；找不到返回 -1
function findChunk(buf, name) {
  let i = 12;
  while (i + 8 <= buf.length) {
    const chunkName = buf.slice(i, i + 4).toString('latin1');
    const chunkSize = buf.readUInt32LE(i + 4);
    if (chunkName === name) {
      return i + 8; // data 起始：chunk 名称 4 + size 4
    }
    // 跳到下一个 chunk（对齐 2 字节）
    i += 8 + chunkSize + (chunkSize % 2);
  }
  return -1;
}

// 创建一次 FunASR 会话（一条连接一次"配置→音频→结束"或复用循环）
// 参数：
//   wsUrl/_token —— 地址与可选 token（官方无鉴权，token 预留）
//   socket       —— 浏览器 WebSocket（把 partial/final 推给前端）
//   onPartial/onFinal/onError
// 返回 { writeAudio(wavBuffer), close() }
function createFunasrSession({ wsUrl, token, socket, onPartial, onFinal, onError } = {}) {
  let ws = null;
  let closed = false;
  const wavName = `session_${Date.now()}`;
  const fs = 16000;

  if (!wsUrl) {
    const err = 'FunASR 服务地址未配置（config/settings.json 或 .env ASR_WS_URL）';
    process.nextTick(() => onError && onError(err));
    console.error('[asr]', err);
    return { writeAudio: async () => {}, close: async () => {} };
  }

  ws = new WebSocket(wsUrl, { rejectUnauthorized: false });

  ws.on('open', () => {
    // 连接成功后发配置（先配置后音频，否则服务端丢帧）
    const cfg = {
      mode: '2pass',
      wav_name: wavName,
      wav_format: 'pcm',
      is_speaking: true,
      chunk_size: [5, 10, 5],
      chunk_interval: 10,
      audio_fs: fs,
      itn: true,
    };
    ws.send(JSON.stringify(cfg));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // 服务端不下发二进制
    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch (e) { return; }

    // 定稿判定（见 SPEC §4）：2pass-offline / offline / online+is_final=true
    if (m.mode === '2pass-offline' || m.mode === 'offline' || (m.mode === 'online' && m.is_final)) {
      if (m.text) onFinal && onFinal(m.text);
    } else {
      if (m.text) onPartial && onPartial(m.text);
    }
    if (m.is_end && !closed) {
      // 输入处理完成 → 主动关（客户端责任）
      try { ws.close(); } catch {}
    }
  });

  ws.on('error', (e) => {
    if (!closed) onError && onError(`FunASR 连接错误: ${e.message}`);
  });

  ws.on('close', () => {
    if (!closed) onError && onError('FunASR 连接已断开');
  });

  return {
    async writeAudio(wavBuffer) {
      if (closed || !ws || ws.readyState !== ws.OPEN) return;
      const pcm = wavToPcm(wavBuffer);
      ws.send(pcm); // binary frame：裸 PCM
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        if (ws && ws.readyState === ws.OPEN) {
          // 结束标志 → 请求服务端 flush 并回执 is_end
          ws.send(JSON.stringify({ is_speaking: false, is_end: true }));
          // 短暂等待回执；随后关闭
          setTimeout(() => { try { ws.close(); } catch {} }, 500);
        } else if (ws) {
          try { ws.close(); } catch {}
        }
      } catch (e) { /* ignore */ }
    },
  };
}

// 创建一次 FunASR v2（新版实时 10095）会话
// 协议（设计文档 docs/ASR_FUNASR_V2_SWITCH.md §3）：
//   上行：'START' 文本帧 → 裸 PCM 二进制帧（16k/mono/16bit）→ 'STOP' 文本帧
//   下行：{"event":"started"} / {sentences,partial,is_final} / {"event":"stopped"} / {"event":"error","error":"..."}
// 定稿判定：is_final === true 且 sentences 拼接 trim 后非空才 onFinal（审查 P0-1）
// close()：发 STOP → 等服务端回 stopped（最终句 flush 完毕）再主动关；15s 兜底超时（审查 P0-2）
// token：新版无鉴权（ws://），token 预留接口对齐
function createFunasrV2Session({ wsUrl, token, socket, onPartial, onFinal, onError } = {}) {
  let ws = null;
  let closedFlag = false;  // 仅抑制 onError 的 close 提示，不拦截消息
  let stoppedFlag = false; // 服务端已回 "stopped" 事件
  let waitStopped = null;  // close() 等待 stopped 的 resolve
  let stopTimer = null;

  if (!wsUrl) {
    const err = 'FunASR v2 服务地址未配置（config/settings.json 或 .env ASR_V2_WS_URL）';
    process.nextTick(() => onError && onError(err));
    console.error('[asr]', err);
    return { writeAudio: async () => {}, close: async () => {} };
  }

  ws = new WebSocket(wsUrl); // 同 http 内网 ws://，无需 rejectUnauthorized

  ws.on('open', () => {
    ws.send('START');         // 开始会话
    ws.send('LANGUAGE:中文'); // 显式语言提示（审查 P1-2：规避中英混说模型默认语言行为不确定性）
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // 服务端不下发二进制
    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch (e) { return; } // 解析失败忽略，不触发 onError

    if (m.event === 'error') {
      onError && onError(m.error || 'FunASR v2 服务端错误');
      return;
    }
    if (m.event === 'stopped') {
      // 会话已结束（最终句已 flush 完毕）→ 通知 close() 收尾
      stoppedFlag = true;
      if (waitStopped) { const r = waitStopped; waitStopped = null; r(); }
      return;
    }
    if (m.event === 'started') return; // 会话已开始，无需透传

    if (m.is_final === true && Array.isArray(m.sentences)) {
      // 定稿句：拼接 trim 后非空才 onFinal（审查 P0-1：防空句子污染统计/字幕/空分析请求）
      const t = m.sentences.map(s => (s && typeof s.text === 'string') ? s.text : '').join('').trim();
      if (t) onFinal && onFinal(t);
      return;
    }
    if (typeof m.partial === 'string' && m.partial.trim() && m.is_final !== true) {
      onPartial && onPartial(m.partial);
    }
  });

  ws.on('error', (e) => {
    onError && onError(`FunASR v2 连接错误: ${e.message}`);
  });

  ws.on('close', () => {
    if (!closedFlag) onError && onError('FunASR v2 连接已断开');
  });

  return {
    async writeAudio(wavBuffer) {
      if (closedFlag || !ws || ws.readyState !== ws.OPEN) return; // 非 OPEN 静默丢弃（与旧版一致）
      const pcm = wavToPcm(wavBuffer); // 复用 wavToPcm：剥离 WAV 头转裸 PCM
      ws.send(pcm); // binary frame：裸 PCM
    },
    async close() {
      if (closedFlag) return;
      closedFlag = true; // 置位：仅抑制 onError 的 close 提示，不拦截消息
      try {
        if (ws && ws.readyState === ws.OPEN) {
          if (!stoppedFlag) {
            // 结束会话：STOP → 等 stopped 回执（CPU LLM 最终解码可数秒，旧版 500ms 节奏会截断末尾）
            ws.send('STOP');
            await new Promise((resolve) => {
              waitStopped = resolve;
              stopTimer = setTimeout(resolve, 15000); // 兜底超时防悬挂
            });
            if (stopTimer) clearTimeout(stopTimer);
            waitStopped = null;
          }
          try { ws.close(); } catch {}
        } else if (ws) {
          try { ws.close(); } catch {}
        }
      } catch (e) { /* ignore */ }
    },
  };
}

module.exports = { createFunasrSession, createFunasrV2Session, wavToPcm };