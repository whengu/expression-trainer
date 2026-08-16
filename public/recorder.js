// recorder.js — 浏览器录音模块（Phase 2）
// getUserMedia + Web Audio 16kHz 采集 + 分块编码 → WS 上行
// 音频格式统一约定：16kHz / 单声道 / 16-bit PCM（封装成 WAV 帧发给后端）
// 暴露全局 Recorder 类

class Recorder {
  constructor({ onChunk, onError } = {}) {
    this.onChunk = onChunk; // function(ArrayBuffer wavFrame)
    this.onError = onError;
    this.recording = false;
    this.mediaStream = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.processor = null;
    this.pcmBuffer = new Float32Array(0); // 累计 16k PCM 采样（未发送部分）
  }

  // 启动：请求麦克风 + 建 AudioContext + 开始分块
  async start({ chunkMs = 1000 } = {}) {
    if (this.recording) return;
    // 请求麦克风（浏览器安全上下文要求：localhost/https）
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 显式 16kHz（部分浏览器忽略 sampleRate 构造参数，需重采样兜底）
    const ctx = new AudioContext({ sampleRate: 16000 });
    this.audioContext = ctx;
    this.sourceNode = ctx.createMediaStreamSource(this.mediaStream);

    const samplesPerChunk = Math.round((ctx.sampleRate / 1000) * chunkMs); // 默认 1s
    const blockSize = 4096;

    const processor = ctx.createScriptProcessor(blockSize, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      const input = e.inputBuffer.getChannelData(0);

      // 若实际采样率不是 16k，线性抽取到 16k（兜底重采样）
      let samples = input;
      if (ctx.sampleRate !== 16000) {
        const ratio = ctx.sampleRate / 16000;
        const outLen = Math.floor(input.length / ratio);
        samples = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const srcIdx = Math.min(Math.floor(i * ratio), input.length - 1);
          samples[i] = input[srcIdx];
        }
      }

      // 追加到累计 buffer（避免数组嵌套 + flat 的 TypedArray 陷阱）
      this.pcmBuffer = appendF32(this.pcmBuffer, samples);

      // 攒够一块 → 发送（默认 1s = 16000 采样）
      while (this.pcmBuffer.length >= samplesPerChunk) {
        const frame = this.pcmBuffer.slice(0, samplesPerChunk);
        this.pcmBuffer = this.pcmBuffer.slice(samplesPerChunk);
        const wav = encodeWav(frame, 16000);
        if (this.onChunk) this.onChunk(wav);
      }
    };

    this.processor = processor;
    this.sourceNode.connect(processor);
    processor.connect(ctx.destination); // 必要的 sink 连接（静音输出）

    this.recording = true;
  }

  async stop() {
    this.recording = false;
    this.pcmBuffer = new Float32Array(0);
    if (this.processor) { try { this.processor.disconnect(); } catch {} this.processor = null; }
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch {} this.sourceNode = null; }
    if (this.audioContext) { try { await this.audioContext.close(); } catch {} this.audioContext = null; }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); this.mediaStream = null; }
  }
}

// Float32Array 拼接（返回新数组；不修改入参）
function appendF32(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// Float32Array → WAV（16-bit PCM, mono）
function encodeWav(float32, sampleRate = 16000) {
  const samples = float32.length;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);        // fmt chunk size
  view.setUint16(20, 1, true);         // PCM
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples * 2, true);

  let offset = 44;
  for (let i = 0; i < samples; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return buffer;
}