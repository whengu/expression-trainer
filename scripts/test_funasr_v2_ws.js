// scripts/test_funasr_v2_ws.js — FunASR v2（10095 新版实时协议）验证脚本
// 依据设计文档 docs/ASR_FUNASR_V2_SWITCH.md §8.3/§8.4：
//   1) 连接路由：直接连接 ws://192.168.156.68:10095，验证新版 START/STOP 协议
//   2) 新版识别链路：START → 音频（示例 PCM 或静音 PCM）→ STOP
//      - 断言收到 is_final:true 且 sentences 拼接非空（覆盖 P0-1 空文本过滤回归）
//      - 断言收到 stopped 事件，且 stopped 后、15s 兜底超时前连接正常关闭（覆盖 P0-2 等待语义）
//   3) 回环测试：通过本项目 server 的 /ws（provider=funasr-v2）验证 handleStart 路由
// 用法：node scripts/test_funasr_v2_ws.js [wsUrl] [envServerWs]
//   wsample 省略或空 → 用静音 PCM（Buffer.alloc(32000)，1s @16k）退化链路测试
// 运行前提：暂不要求 server 在跑（直连测试无需 server）；回环测试需要 server 已设置 provider=funasr-v2
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const { createFunasrV2Session, wavToPcm } = require('../server/asr/client');

const ASR_V2_URL = process.env.ASR_V2_URL || 'ws://192.168.156.68:10095';
const args = process.argv.slice(2);
const audioPath = args[0] || '';
const loopbackWs = args[1] || ''; // 例如 ws://127.0.0.1:3000/ws（配合 server provider=funasr-v2）

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// 找本地音频样例：参数指定 → scripts/ → 工作区可能位置
function findAudio() {
  if (audioPath && fs.existsSync(audioPath)) return audioPath;
  const candidates = [
    path.join(__dirname, 'zh_test.pcm'),
    path.join(__dirname, 'zh_test.wav'),
    path.join(__dirname, 'sample.pcm'),
    path.join(__dirname, 'sample.wav'),
    'D:/myagent/workspace/zh_test.pcm',
    'D:/myagent/workspace/ws_test_client/zh_test.pcm',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return '';
}

function makeSilencePcm(seconds = 1) {
  // 1 秒 16k mono 16bit 静音 = 32000 字节
  return Buffer.alloc(seconds * 16000 * 2, 0);
}

// —— 测试 1：直连 10095 协议链路（真实音频 or 静音退化）——
async function testDirect() {
  console.log('\n=== 测试 1：直连 10095 新版协议链路 ===');
  const audioFile = findAudio();
  const useReal = !!audioFile;
  console.log(`音频来源: ${useReal ? audioFile : '无本地样例 → 推送 1s 静音 PCM（Buffer.alloc(32000)，退化链路测试）'}`);

  await new Promise((resolve) => {
    const events = [];
    let finalText = '';
    let partialCount = 0;
    let stoppedAt = null;
    let closedAt = null;
    const t0 = Date.now();

    const ws = new WebSocket(ASR_V2_URL);
    const timeout = setTimeout(() => {
      console.log(`  ❌ 直连 30s 超时（events: ${JSON.stringify(events)}）`);
      fail++;
      try { ws.close(); } catch {}
      resolve();
    }, 30000);

    ws.on('open', () => {
      events.push('open');
      ws.send('START');
      ws.send('LANGUAGE:中文');
      setTimeout(() => {
        let audio;
        if (useReal) {
          const raw = fs.readFileSync(audioFile);
          audio = raw.toString('latin1').startsWith('RIFF') ? wavToPcm(raw) : raw;
        } else {
          audio = makeSilencePcm(1);
        }
        ws.send(audio, { binary: true });
        events.push('audio-sent');
        setTimeout(() => {
          events.push('stop-sent');
          ws.send('STOP');
        }, 300);
      }, 300);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) { events.push('binary'); return; }
      let m;
      try { m = JSON.parse(data.toString('utf8')); } catch { return; }
      events.push(m.event || (m.is_final ? 'is_final' : 'partial'));
      if (m.event === 'error') { events.push('ERROR:' + (m.error || '')); }
      if (m.event === 'stopped') { stoppedAt = Date.now(); }
      if (m.is_final === true && Array.isArray(m.sentences)) {
        const t = m.sentences.map(s => (s && s.text) || '').join('').trim();
        if (t) finalText = t;
      }
      if (typeof m.partial === 'string' && m.partial) partialCount++;
    });

    ws.on('error', (e) => { events.push('ws-error:' + e.message); });
    ws.on('close', () => { closedAt = Date.now(); });

    // 关闭等待：等 stopped 后再延 1s（模拟协议方正常收尾），看连接是否正常关闭
    const waitStopped = setInterval(() => {
      if (stoppedAt && !closedAt && Date.now() - stoppedAt > 1000) {
        events.push('client-close');
        try { ws.close(); } catch {}
      }
      if (closedAt || !stoppedAt && Date.now() - t0 > 25000) {
        clearInterval(waitStopped);
        clearTimeout(timeout);
        const dt = closedAt ? (closedAt - t0) : null;
        console.log(`事件序列: ${events.join(' → ')}`);
        assert('收到 started 事件', events.includes('started'), events.join(','));
        if (useReal) {
          assert('收到 is_final 且 sentences 拼接非空（P0-1 空文本过滤）', !!finalText && finalText.length > 0, `finalText=${finalText}`);
          assert('收到 stopped 事件', stoppedAt != null);
        } else {
          // 静音退化：服务端可能不产生任何定稿句（静音无识别结果），只断言协议生命周期
          assert('收到 started 事件', events.includes('started'));
          assert('收到 stopped 事件', stoppedAt != null, `events=${events.join(',')}`);
        }
        assert('stopped 后连接在 15s 兜底超时内关闭（P0-2 等待语义）', closedAt != null && (closedAt - t0) < 15000, `closedAt=${closedAt}, elapsed=${closedAt ? closedAt - t0 : 'n/a'}ms`);
        resolve();
      }
    }, 200);
  });
  return { useReal };
}

// —— 测试 2：通过本项目 server /ws 路由（provider=funasr-v2）——
async function testLoopback() {
  console.log('\n=== 测试 2：server /ws 路由（provider=funasr-v2）===');
  if (!loopbackWs) {
    console.log('  ⏭  未提供回环地址，跳过');
    return;
  }
  await new Promise((resolve) => {
    const events = [];
    let gotReady = false;
    const ws = new WebSocket(loopbackWs);
    const timeout = setTimeout(() => { console.log('  ❌ 回环 25s 超时'); fail++; try { ws.close(); } catch {} resolve(); }, 25000);

    ws.on('open', () => {
      events.push('open');
      ws.send(JSON.stringify({ type: 'start' }));
      setTimeout(() => {
        ws.send(makeSilencePcm(1), { binary: true });
        setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), 300);
      }, 300);
    });
    ws.on('error', (e) => events.push('ws-error:' + e.message));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      events.push(m.type + (m.text ? `(${m.text.slice(0, 20)})` : ''));
      if (m.type === 'ready') {
        gotReady = true;
        // ready 后给 3s 观察窗口收集可能的 partial/final/error，然后主动断开收尾
        // （server 端 handleStop 不关浏览器 WS；静音场景 partial/final 被 P0-1 空文本过滤，无事件也属预期）
        setTimeout(() => { try { ws.close(); } catch {} }, 3000);
      }
      if (m.type === 'error') events.push('ERROR:' + m.message);
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      console.log(`事件序列: ${events.join(' → ')}`);
      assert('收到 ready（handleStart 会话创建成功，funasr-v2 路由生效）', gotReady, events.join(','));
      if (gotReady) {
        // 路由已连通 10095 并有真实 ASR 文本（如推送真实语音）→ 直接通过
        assert('无 error 下行（静音场景下 partial/final 被 P0-1 空文本过滤属预期）',
          !events.some(e => e.startsWith('ERROR')), events.join(','));
        // 触发 server 端 createFunasrV2Session.close()（发 STOP → 等 stopped → 关连接）以覆盖关闭路径：
        // 浏览器发 stop 即可；此处事件已收集完毕，主动断开浏览器侧连接收尾
      } else {
        assert('收到 ASR 下行事件或明确错误', false, events.join(','));
      }
      resolve();
    });
  });
}

(async () => {
  console.log('FunASR v2 验证脚本');
  console.log(`目标: ${ASR_V2_URL}`);
  if (await testDirect().then(r => r.useReal)) {
    console.log('\n（真实音频链路，压缩文件不存在则静音退化）');
  }
  await testLoopback();
  console.log(`\n结果: ✅ ${pass} 通过, ❌ ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(2); });