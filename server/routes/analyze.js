// POST /api/analyze — 词库分析（复用 lib/lexicon.js，零改动）
const { Router } = require('express');
const router = Router();

const { loadLexicon, analyzeText } = require('../../lib/lexicon');

// 文本长度上限（字符）：词库匹配 O(词数×词长)，超长文本防 CPU 滥用
const MAX_TEXT_CHARS = 200000;

// 确保词库已加载（幂等）
loadLexicon();

router.post('/analyze', (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text 不能为空' });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return res.status(413).json({ error: `文本过长（上限 ${MAX_TEXT_CHARS} 字符）` });
  }
  try {
    const analysis = analyzeText(text);
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: `词库分析失败: ${e.message}` });
  }
});

module.exports = router;