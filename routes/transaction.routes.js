const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM dbo.report_cache
      ORDER BY created_at DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;