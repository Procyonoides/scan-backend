const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT TOP 1 SUM(quantity) as total FROM dbo.stock
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/warehouse-stats', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        (SELECT SUM(quantity) FROM dbo.stock) as first_stock,
        (SELECT COUNT(*) FROM dbo.receiving WHERE status = 'IN') as receiving,
        (SELECT COUNT(*) FROM dbo.shipping WHERE status = 'OUT') as shipping,
        (SELECT SUM(quantity) FROM dbo.stock) as warehouse_stock
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/chart-data', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT TOP 7
        CONVERT(DATE, scan_date) as date,
        COUNT(CASE WHEN scan_type = 'RECEIVING' THEN 1 END) as receiving,
        COUNT(CASE WHEN scan_type = 'SHIPPING' THEN 1 END) as shipping
      FROM dbo.scan_history
      GROUP BY CONVERT(DATE, scan_date)
      ORDER BY date DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;