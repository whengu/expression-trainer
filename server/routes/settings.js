// GET/PUT /api/settings + POST /api/settings/test-llm
// key 脱敏：只回显后 4 位；写入走 config/settings.json（项目目录内）
const { Router } = require('express');
const router = Router();

const { getConfig, saveSettings } = require('../config');
const { testConnection } = require('../llm/client');

// 脱敏：密钥只回显后 4 位，空则保留空
function mask(key) {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return '****' + key.slice(-4);
}

function maskSettings(cfg) {
  const llm = { provider: cfg.llm.provider, providers: {} };
  for (const [name, p] of Object.entries(cfg.llm.providers || {})) {
    llm.providers[name] = { ...p, apiKey: mask(p.apiKey) };
  }
  const asr = {
    provider: cfg.asr.provider,
    funasr: { wsUrl: cfg.asr.funasr?.wsUrl || '', token: cfg.asr.funasr?.token ? mask(cfg.asr.funasr.token) : '' },
    funasrV2: { wsUrl: cfg.asr.funasrV2?.wsUrl || '', token: cfg.asr.funasrV2?.token ? mask(cfg.asr.funasrV2.token) : '' },
  };
  return { llm, asr, feedback: cfg.feedback, server: cfg.server };
}

router.get('/settings', (req, res) => {
  res.json(maskSettings(getConfig()));
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  const cfg = getConfig();
  const next = { ...cfg };

  // 只允许更新已知段；密钥若为 masked 值（****xxx）则不覆盖
  if (body.llm) {
    next.llm = next.llm || {};
    if (body.llm.provider) next.llm.provider = body.llm.provider;
    next.llm.providers = next.llm.providers || {};
    for (const [name, p] of Object.entries(body.llm.providers || {})) {
      const cur = next.llm.providers[name] || {};
      next.llm.providers[name] = {
        ...cur,
        ...p,
        apiKey: p.apiKey && !p.apiKey.startsWith('****') ? p.apiKey : cur.apiKey,
      };
    }
  }
  if (body.asr) {
    next.asr = next.asr || {};
    if (body.asr.provider) next.asr.provider = body.asr.provider;
    // 显式提交的块才更新；未提交的块原样保留（防止 funasr ↔ funasrV2 互切双向清空，审查 P0-3）
    for (const key of ['funasr', 'funasrV2']) {
      const src = body.asr?.[key];
      if (!src) continue;
      const cur = next.asr[key] || {};
      next.asr[key] = {
        ...cur,
        wsUrl: typeof src.wsUrl === 'string' ? src.wsUrl.trim() : cur.wsUrl,
        token: src.token && !src.token.startsWith('****') ? src.token : (cur.token || ''),
      };
    }
  }
  if (body.feedback) {
    next.feedback = { ...(next.feedback || {}), ...body.feedback };
  }
  if (body.server) {
    next.server = { ...(next.server || {}), ...body.server };
  }

  saveSettings(next);
  res.json(maskSettings(getConfig()));
});

// 测试 LLM 连通性（嵌套结构：llm.providers.<provider>）
router.post('/settings/test-llm', async (req, res) => {
  const body = req.body || {};
  const cfg = getConfig();
  const provider = body.provider || cfg.llm.provider || 'deepseek';
  const providers = cfg.llm.providers || {};

  // 构造嵌套 llm 配置供 testConnection 使用
  let llmConfig;
  if (body.provider && body.apiKey && !body.apiKey.startsWith('****')) {
    // 设置页未保存前测试：用提交的值
    if (body.provider === 'custom') {
      llmConfig = { provider: 'custom', providers: { custom: { apiKey: body.apiKey, baseUrl: body.baseUrl, customModel: body.model } } };
    } else {
      llmConfig = { provider: body.provider, providers: { [body.provider]: { apiKey: body.apiKey, model: body.model } } };
    }
  } else {
    // 用已保存配置测试
    llmConfig = { provider, providers };
  }

  const result = await testConnection(llmConfig);
  res.json(result);
});

module.exports = router;