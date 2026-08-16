// POST /api/feedback — 实时 AI 反馈（LLM）
const { Router } = require('express');
const router = Router();

const { getConfig } = require('../config');
const { sendFeedback } = require('../llm/client');

const MAX_TEXT_CHARS = 200000;

router.post('/feedback', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: '缺少文本' });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return res.status(413).json({ success: false, error: `文本过长（上限 ${MAX_TEXT_CHARS} 字符）` });
  }

  const config = getConfig();
  const llm = config.llm || {};
  const customPrompt = config.prompts?.realtime || undefined;

  try {
    // 未配置 key 时给可读提示
    const provider = llm.provider || 'deepseek';
    if (!(llm.providers && llm.providers[provider] && llm.providers[provider].apiKey)) {
      return res.status(200).json({ success: false, feedback: null, error: `LLM (${provider}) 未配置 API Key，请在设置中配置` });
    }
    const feedback = await sendFeedback(text.slice(-600), llm, customPrompt); // 只取最近 600 字控制 token
    res.json({ success: true, feedback });
  } catch (e) {
    console.error('[feedback] 生成失败:', e.message);
    res.status(200).json({ success: false, feedback: null, error: `反馈生成失败: ${e.message}` });
  }
});

module.exports = router;