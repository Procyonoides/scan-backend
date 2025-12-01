const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * GET /api/dashboard/stats
 * Get all dashboard statistics
 */
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        ISNULL((SELECT SUM(quantity) FROM dbo.stock), 0) as first_stock,
        ISNULL((SELECT COUNT(*) FROM dbo.receiving WHERE CAST(scan_date AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving,
        ISNULL((SELECT COUNT(*) FROM dbo.shipping WHERE CAST(scan_date AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping,
        ISNULL((SELECT SUM(quantity) FROM dbo.stock), 0) as warehouse_stock
    `);
    
    console.log('✅ Dashboard stats:', result.recordset[0]);
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('❌ Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

/**
 * GET /api/dashboard/chart
 * Get chart data for last 7 days
 */
router.get('/chart', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      WITH Last7Days AS (
        SELECT CAST(DATEADD(day, -number, GETDATE()) AS DATE) as date
        FROM master.dbo.spt_values
        WHERE type = 'P' AND number BETWEEN 0 AND 6
      )
      SELECT 
        CONVERT(VARCHAR, d.date, 23) as date,
        ISNULL(r.receiving, 0) as receiving,
        ISNULL(s.shipping, 0) as shipping
      FROM Last7Days d
      LEFT JOIN (
        SELECT CAST(scan_date AS DATE) as date, COUNT(*) as receiving
        FROM dbo.receiving
        WHERE scan_date >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
        GROUP BY CAST(scan_date AS DATE)
      ) r ON d.date = r.date
      LEFT JOIN (
        SELECT CAST(scan_date AS DATE) as date, COUNT(*) as shipping
        FROM dbo.shipping
        WHERE scan_date >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
        GROUP BY CAST(scan_date AS DATE)
      ) s ON d.date = s.date
      ORDER BY d.date ASC
    `);
    
    console.log('✅ Dashboard chart data:', result.recordset);
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Dashboard chart error:', err);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

module.exports = router;