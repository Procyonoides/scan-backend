const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * Middleware untuk log semua request
 */
router.use((req, res, next) => {
  console.log(`📊 Dashboard request: ${req.method} ${req.path}`);
  console.log(`🔑 Token present: ${!!req.headers.authorization}`);
  next();
});

/**
 * GET /api/dashboard/warehouse-stats
 * Get warehouse statistics (First Stock, Receiving, Shipping, Warehouse Stock)
 */
router.get('/warehouse-stats', verifyToken, async (req, res) => {
  try {
    console.log('📦 Fetching warehouse stats...');
    
    const result = await query(`
      SELECT 
        ISNULL((SELECT SUM(quantity) FROM dbo.stock), 0) as first_stock,
        ISNULL((SELECT COUNT(*) FROM dbo.receiving 
                WHERE CAST(scan_date AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving,
        ISNULL((SELECT COUNT(*) FROM dbo.shipping 
                WHERE CAST(scan_date AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping,
        ISNULL((SELECT SUM(quantity) FROM dbo.stock), 0) as warehouse_stock
    `);
    
    console.log('✅ Warehouse stats:', result.recordset[0]);
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('❌ Warehouse stats error:', err);
    res.status(500).json({ error: 'Failed to fetch warehouse stats', message: err.message });
  }
});

/**
 * GET /api/dashboard/daily-chart
 * Get chart data untuk 7 hari terakhir
 */
router.get('/daily-chart', verifyToken, async (req, res) => {
  try {
    console.log('📈 Fetching daily chart...');
    
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
    
    console.log('✅ Daily chart data:', result.recordset.length, 'records');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Daily chart error:', err);
    res.status(500).json({ error: 'Failed to fetch chart data', message: err.message });
  }
});

/**
 * GET /api/dashboard/shift-scan
 * Get scan data by shift (yesterday)
 */
router.get('/shift-scan', verifyToken, async (req, res) => {
  try {
    console.log('👥 Fetching shift scan...');
    
    const result = await query(`
      WITH YesterdayScans AS (
        SELECT username, COUNT(*) as total
        FROM (
          SELECT username FROM dbo.receiving 
          WHERE CAST(scan_date AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
          UNION ALL
          SELECT username FROM dbo.shipping 
          WHERE CAST(scan_date AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
        ) combined
        GROUP BY username
      ),
      TotalScans AS (
        SELECT SUM(total) as grand_total FROM YesterdayScans
      )
      SELECT 
        y.username,
        y.total,
        CAST((y.total * 100.0 / NULLIF(t.grand_total, 0)) AS DECIMAL(5,2)) as percent,
        CAST((y.total * 100.0 / NULLIF(t.grand_total, 0)) AS INT) as status
      FROM YesterdayScans y
      CROSS JOIN TotalScans t
      ORDER BY y.total DESC
    `);
    
    console.log('✅ Shift scan data:', result.recordset.length, 'records');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Shift scan error:', err);
    res.status(500).json({ error: 'Failed to fetch shift scan data', message: err.message });
  }
});

/**
 * GET /api/dashboard/warehouse-items
 * Get warehouse items breakdown
 */
router.get('/warehouse-items', verifyToken, async (req, res) => {
  try {
    console.log('📦 Fetching warehouse items...');
    
    const result = await query(`
      WITH ItemTotals AS (
        SELECT 
          UPPER(ISNULL(brand, 'UNKNOWN')) as item,
          SUM(quantity) as total
        FROM dbo.stock
        GROUP BY UPPER(ISNULL(brand, 'UNKNOWN'))
      ),
      GrandTotal AS (
        SELECT SUM(quantity) as grand_total FROM dbo.stock
      )
      SELECT 
        i.item,
        i.total,
        CAST((i.total * 100.0 / NULLIF(g.grand_total, 0)) AS INT) as status
      FROM ItemTotals i
      CROSS JOIN GrandTotal g
      WHERE i.item IN ('IP', 'PHYLON', 'BLOKER', 'PAINT', 'RUBBER', 'GOODSOLE')
      ORDER BY i.total DESC
    `);
    
    console.log('✅ Warehouse items:', result.recordset.length, 'items');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Warehouse items error:', err);
    res.status(500).json({ error: 'Failed to fetch warehouse items', message: err.message });
  }
});

/**
 * GET /api/dashboard/receiving-list
 * Get latest receiving scans
 */
router.get('/receiving-list', verifyToken, async (req, res) => {
  try {
    console.log('📥 Fetching receiving list...');
    
    const result = await query(`
      SELECT TOP 10
        CONVERT(varchar, scan_date, 120) as date_time,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        receiving_id as scan_no
      FROM dbo.receiving
      ORDER BY scan_date DESC
    `);
    
    console.log('✅ Receiving list:', result.recordset.length, 'items');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Receiving list error:', err);
    res.status(500).json({ error: 'Failed to fetch receiving list', message: err.message });
  }
});

/**
 * GET /api/dashboard/shipping-list
 * Get latest shipping scans
 */
router.get('/shipping-list', verifyToken, async (req, res) => {
  try {
    console.log('📤 Fetching shipping list...');
    
    const result = await query(`
      SELECT TOP 10
        CONVERT(varchar, scan_date, 120) as date_time,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        shipping_id as scan_no
      FROM dbo.shipping
      ORDER BY scan_date DESC
    `);
    
    console.log('✅ Shipping list:', result.recordset.length, 'items');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Shipping list error:', err);
    res.status(500).json({ error: 'Failed to fetch shipping list', message: err.message });
  }
});

module.exports = router;