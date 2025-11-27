const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

router.get('/daily', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        scan_date,
        COUNT(*) as total_scans,
        SUM(CASE WHEN scan_type = 'RECEIVING' THEN 1 ELSE 0 END) as receiving_count,
        SUM(CASE WHEN scan_type = 'SHIPPING' THEN 1 ELSE 0 END) as shipping_count
      FROM dbo.scan_history
      WHERE CAST(scan_date AS DATE) = CAST(GETDATE() AS DATE)
      GROUP BY scan_date
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monthly', verifyToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        YEAR(scan_date) as year,
        MONTH(scan_date) as month,
        COUNT(*) as total_scans,
        SUM(CASE WHEN scan_type = 'RECEIVING' THEN 1 ELSE 0 END) as receiving_count,
        SUM(CASE WHEN scan_type = 'SHIPPING' THEN 1 ELSE 0 END) as shipping_count
      FROM dbo.scan_history
      GROUP BY YEAR(scan_date), MONTH(scan_date)
      ORDER BY year DESC, month DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;