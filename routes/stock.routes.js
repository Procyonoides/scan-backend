const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

// ✅ FIXED: Get all stocks
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        stock_id,
        warehouse_id,
        original_barcode,
        brand,
        model,
        color,
        size,
        quantity,
        status
      FROM dbo.stock
      ORDER BY stock_id DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: Get warehouse stats
router.get('/warehouse-stats', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        ISNULL((SELECT SUM(quantity) FROM dbo.stock), 0) as first_stock,
        ISNULL((SELECT COUNT(*) FROM dbo.receiving WHERE status = 'IN'), 0) as receiving,
        ISNULL((SELECT COUNT(*) FROM dbo.shipping WHERE status = 'OUT'), 0) as shipping,
        ISNULL((SELECT SUM(quantity) FROM dbo.stock), 0) as warehouse_stock
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: Get chart data with proper date handling
router.get('/chart-data', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      WITH DateRange AS (
        SELECT DISTINCT CAST(scan_date AS DATE) as date
        FROM (
          SELECT scan_date FROM dbo.receiving
          UNION ALL
          SELECT scan_date FROM dbo.shipping
        ) AS combined
        WHERE scan_date >= DATEADD(day, -7, GETDATE())
      )
      SELECT 
        CONVERT(VARCHAR, dr.date, 23) as date,
        ISNULL(r.receiving, 0) as receiving,
        ISNULL(s.shipping, 0) as shipping
      FROM DateRange dr
      LEFT JOIN (
        SELECT CAST(scan_date AS DATE) as date, COUNT(*) as receiving
        FROM dbo.receiving
        WHERE scan_date >= DATEADD(day, -7, GETDATE())
        GROUP BY CAST(scan_date AS DATE)
      ) r ON dr.date = r.date
      LEFT JOIN (
        SELECT CAST(scan_date AS DATE) as date, COUNT(*) as shipping
        FROM dbo.shipping
        WHERE scan_date >= DATEADD(day, -7, GETDATE())
        GROUP BY CAST(scan_date AS DATE)
      ) s ON dr.date = s.date
      ORDER BY dr.date DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;