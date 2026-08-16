// POST /api/report — 结束报告生成（LLM 真实实现）
const { Router } = require('express');
const router = Router();

const { getConfig } = require('../config');
const { sendReport } = require('../llm/client');

const MAX_TEXT_CHARS = 200000;

router.post('/report', async (req, res) => {
  const { fullText, stats } = req.body || {};
  if (!fullText || !fullText.trim()) {
    return res.status(400).json({ success: false, error: '缺少原文' });
  }
  if (fullText.length > MAX_TEXT_CHARS) {
    return res.status(413).json({ success: false, error: `文本过长（上限 ${MAX_TEXT_CHARS} 字符）` });
  }

  const config = getConfig();
  const llm = config.llm || {};
  const customPrompt = config.prompts?.report || undefined;

  try {
    const provider = llm.provider || 'deepseek';
    if (!(llm.providers && llm.providers[provider] && llm.providers[provider].apiKey)) {
      return res.status(200).json({ success: false, report: null, error: `LLM (${provider}) 未配置 API Key，请在设置中配置` });
    }
    const report = await sendReport(fullText, stats, llm, customPrompt);
    res.json({ success: true, report });
  } catch (e) {
    console.error('[report] 生成失败:', e.message);
    res.status(200).json({ success: false, report: null, error: `报告生成失败: ${e.message}` });
  }
});

module.exports = router;