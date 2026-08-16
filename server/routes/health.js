// GET /api/health — 健康检查
const { Router } = require('express');
const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

module.exports = router;