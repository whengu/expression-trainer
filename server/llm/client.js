// server/llm/client.js — LLM 客户端（WebUI 版）
// 由原版 lib/ai-feedback.js 迁移改造：
//   - 删除 ollama（铁律：模型不在本地跑）
//   - 适配嵌套配置结构 config.llm.providers.{provider}
//   - 支持 deepseek / openai / custom（OpenAI 兼容）
// 保留 sendFeedback / sendReport / testConnection / formatFeedback

const { getRealtimePrompt, getReportPrompt } = require('../../lib/prompts');

const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
};

// 从嵌套设置中取当前 provider 的 { endpoint, apiKey, model }
function getProviderConfig(llmConfig) {
  const provider = llmConfig.provider || 'deepseek';
  const providers = llmConfig.providers || {};
  const p = providers[provider] || {};

  switch (provider) {
    case 'openai':
      return { endpoint: PROVIDER_ENDPOINTS.openai, apiKey: p.apiKey || '', model: p.model || 'gpt-4o-mini' };
    case 'deepseek':
      return { endpoint: PROVIDER_ENDPOINTS.deepseek, apiKey: p.apiKey || '', model: p.model || 'deepseek-chat' };
    case 'custom': {
      const base = (p.baseUrl || '').replace(/\/+$/, '');
      return { endpoint: base ? `${base}/chat/completions` : '', apiKey: p.apiKey || '', model: p.customModel || p.model || '' };
    }
    default:
      throw new Error(`未知的 provider: ${provider}`);
  }
}

// 校验 endpoint 只允许 http/https，防 SSRF（管理员可配置，但仍防御）
function assertSafeEndpoint(endpoint) {
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new Error(`非法端点地址: ${endpoint}（仅允许 http/https）`);
  }
}

// 兼容解析 OpenAI 兼容响应：
// 有些网关（9Router 类）即使不请求 stream 也返回 text/event-stream，body 形如
//   '{"choices":[...]}\ndata: [DONE]'
// 这里截取首个完整 JSON 对象（遇 'data: [DONE]' 或解析成功即停），纯 JSON 也兼容。
function parseChatResponse(text) {
  const trimmed = (text || '').trim();
  // 尝试整体 JSON.parse
  try { return JSON.parse(trimmed); } catch {}

  // SSE 格式：取第一个 'data:' 前的内容，通常是完整 JSON
  const dataIdx = trimmed.indexOf('data:');
  if (dataIdx > 0) {
    const head = trimmed.slice(0, dataIdx).trim();
    try { return JSON.parse(head); } catch {}
  }

  // 尝试逐行找完整 JSON（兼容多帧 SSE 未实现流解析时至少能取到首帧）
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (l.startsWith('data:') && l !== 'data: [DONE]') {
      try { return JSON.parse(l.slice(5).trim()); } catch {}
    }
  }
  throw new Error(`无法解析模型响应（非标准 JSON/SSE）: ${text.slice(0, 300)}`);
}

// 发送请求到 OpenAI 兼容接口
async function callAPI(endpoint, apiKey, model, messages, maxTokens = 200) {
  assertSafeEndpoint(endpoint);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7, stream: false }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败 (${response.status}): ${error}`);
  }

  const raw = await response.text();
  let data;
  try {
    data = parseChatResponse(raw);
  } catch (e) {
    throw new Error(`模型响应解析失败: ${e.message}`);
  }
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error(`模型响应缺少 choices: ${raw.slice(0, 300)}`);
  }
  return data.choices[0].message.content;
}

// 发送实时反馈请求（每阈值触发）
async function sendFeedback(text, llmConfig, customPrompt) {
  const config = getProviderConfig(llmConfig);
  const prompt = getRealtimePrompt(text, null, customPrompt);
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
  return callAPI(config.endpoint, config.apiKey, config.model, messages, 150);
}

// 发送结束报告请求
async function sendReport(fullText, stats, llmConfig, customPrompt) {
  const config = getProviderConfig(llmConfig);
  const prompt = getReportPrompt(fullText, stats, customPrompt);
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
  return callAPI(config.endpoint, config.apiKey, config.model, messages, 8192);
}

// 将AI返回的纯文本反馈格式化为HTML
function formatFeedback(text) {
  return text
    .replace(/→/g, '<span class="suggestion"> → </span>')
    .replace(/⚠️/g, '<span class="issue">⚠️</span>')
    .replace(/✓/g, '<span class="suggestion">✓</span>')
    .replace(/\n/g, '<br>');
}

// 测试 LLM 连通性
async function testConnection(llmConfig) {
  let config;
  try {
    config = getProviderConfig(llmConfig);
  } catch (e) {
    return { success: false, error: e.message };
  }
  if (!config.endpoint) {
    return { success: false, error: '端点地址未配置' };
  }
  if (!config.apiKey) {
    return { success: false, error: 'API Key 未配置' };
  }

  const messages = [{ role: 'user', content: 'OK' }];
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages, max_tokens: 2, temperature: 0 }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => '未知错误');
      return { success: false, error: `API 请求失败 (${response.status}): ${error}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: `连接失败: ${error.message}` };
  }
}

module.exports = { sendFeedback, sendReport, testConnection, formatFeedback, getProviderConfig };