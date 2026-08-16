// api-client.js — WebUI 版通信层
// 替代 Electron preload 的 window.api，提供同构方法名。
// Phase 1: REST（analyze/settings/report/health）+ 保存（浏览器下载）
// Phase 2: 增加 WebSocket（audio 上行 + asr-partial/asr-final）

async function postJSON(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown error');
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function putJSON(url, body) {
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => 'unknown error');
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function getJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// 词库分析（原 window.api.analyzeText 同构）
async function analyzeText(text) {
  try {
    return await postJSON('/api/analyze', { text });
  } catch (e) {
    console.error('[api] analyzeText 失败:', e);
    return null;
  }
}

// 设置
async function getSettings() {
  try { return await getJSON('/api/settings'); } catch (e) { console.error(e); return null; }
}
async function saveSettings(settings) {
  return putJSON('/api/settings', settings);
}
async function testLLMConnection(settings) {
  return postJSON('/api/settings/test-llm', settings);
}

// AI 实时反馈 & 报告（Phase 3 真实实现）
async function getRealtimeFeedback(text) {
  try {
    return await postJSON('/api/feedback', { text });
  } catch (e) {
    return { success: false, feedback: null, error: e.message };
  }
}
async function getFinalReport(data) {
  try {
    return await postJSON('/api/report', data);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 保存文件（浏览器原生下载，替代 Electron saveFile）
function saveFile(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return Promise.resolve({ success: true });
}

// 设置页/报告页窗口（WebUI 改为同页弹窗或跳转，占位）
function openSettings() {
  // 相对路径（兼容 nginx 子目录部署 /expression-trainer/ 前缀）
  window.location.href = 'settings.html';
}
function openPromptEditor() {
  // 相对路径（兼容 nginx 子目录部署 /expression-trainer/ 前缀）
  window.location.href = 'prompt-editor.html';
}

// 录制相关（Phase 2 实现），当前返回 noop 占位
async function initASR() { return { success: true }; }
async function feedAudio() { return null; }
async function stopASR() { return { success: true }; }

// ===== WebSocket 会话（Phase 2）=====
// 内部协议（前后端，与 FunASR 解耦）：
//   前端→后端：{type:'start'} / binary(WAV/PCM帧) / {type:'stop'}
//   后端→前端：{type:'asr-partial', text} / {type:'asr-final', text, analysis} / {type:'error', message}
let ws = null;
let reconnectAttempts = 0;
const wsHandlers = {}; // { onPartial, onFinal, onError, onOpen, onClose }

function connectWS(handlers = {}) {
  Object.assign(wsHandlers, handlers);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    reconnectAttempts = 0;
    if (wsHandlers.onOpen) wsHandlers.onOpen();
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return; // 忽略二进制（本项目后端不发二进制下行）
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'asr-partial' && wsHandlers.onPartial) wsHandlers.onPartial(msg.text);
    else if (msg.type === 'asr-final' && wsHandlers.onFinal) wsHandlers.onFinal(msg);
    else if (msg.type === 'error' && wsHandlers.onError) wsHandlers.onError(msg.message);
  };
  ws.onclose = () => {
    if (wsHandlers.onClose) wsHandlers.onClose();
    // 自动重连（指数退避 1s/2s/4s/8s 封顶），重连后不自动恢复会话（需用户重新开始）
    if (reconnectAttempts < 10) {
      reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 8000);
      setTimeout(() => connectWS(wsHandlers), delay);
    }
  };
  ws.onerror = () => { /* onclose 触发重连 */ };
}

function wsReady() { return ws && ws.readyState === WebSocket.OPEN; }

function wsSendStart() { if (wsReady()) ws.send(JSON.stringify({ type: 'start' })); }
function wsSendStop() { if (wsReady()) ws.send(JSON.stringify({ type: 'stop' })); }
function wsSendAudio(chunk) { if (wsReady()) ws.send(chunk); } // chunk: ArrayBuffer

// 暴露为全局 api（与原来的 window.api 同名）
window.api = {
  analyzeText,
  getSettings,
  saveSettings,
  testLLMConnection,
  getRealtimeFeedback,
  getFinalReport,
  saveFile,
  openSettings,
  openPromptEditor,
  initASR,
  feedAudio,
  stopASR,
  // WS 会话（Phase 2）
  connectWS,
  wsSendStart,
  wsSendStop,
  wsSendAudio,
};