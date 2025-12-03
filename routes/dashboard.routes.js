const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * GET /api/dashboard/warehouse-stats
 * Mengambil statistik warehouse - Data dari table stok untuk hari ini
 */
router.get('/warehouse-stats', verifyToken, async (req, res) => {
  try {
    console.log('📦 Fetching warehouse stats...');
    
    const result = await query(`
      SELECT 
        ISNULL((SELECT stock_awal FROM [Backup_hskpro].[dbo].[stok] 
                WHERE CAST(date AS DATE) = CAST(GETDATE() AS DATE)), 0) as first_stock,
        ISNULL((SELECT receiving FROM [Backup_hskpro].[dbo].[stok] 
                WHERE CAST(date AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving,
        ISNULL((SELECT shipping FROM [Backup_hskpro].[dbo].[stok] 
                WHERE CAST(date AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping,
        ISNULL((SELECT stock_akhir FROM [Backup_hskpro].[dbo].[stok] 
                WHERE CAST(date AS DATE) = CAST(GETDATE() AS DATE)), 0) as warehouse_stock
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
 * Chart data untuk 7 hari terakhir (dari table stok)
 */
router.get('/daily-chart', verifyToken, async (req, res) => {
  try {
    console.log('📈 Fetching daily chart from stok table...');
    
    // Mengambil 7 hari terakhir dari table stok
    const result = await query(`
      SELECT TOP 7 
        CONVERT(VARCHAR, date, 23) AS date,
        receiving,
        shipping
      FROM [Backup_hskpro].[dbo].[stok]
      ORDER BY date DESC
    `);
    
    // Reverse untuk urutan ascending (oldest to newest)
    const reversed = result.recordset.reverse();
    
    console.log('✅ Daily chart data:', reversed.length, 'records');
    res.json(reversed);
  } catch (err) {
    console.error('❌ Daily chart error:', err);
    res.status(500).json({ error: 'Failed to fetch chart data', message: err.message });
  }
});

/**
 * GET /api/dashboard/shift-scan
 * Scan by shift untuk kemarin (dari data_receiving)
 */
router.get('/shift-scan', verifyToken, async (req, res) => {
  try {
    console.log('👥 Fetching shift scan...');
    
    const result = await query(`
      SELECT 
        username,
        CAST(SUM(quantity) * 100.0 / NULLIF((
          SELECT SUM(quantity) 
          FROM [Backup_hskpro].[dbo].[data_receiving] 
          WHERE CAST(date_time AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
          AND description = 'INCOME' 
          AND production = 'PT HSK REMBANG'
        ), 0) AS DECIMAL(10, 0)) AS status,
        REPLACE(
          CAST(SUM(quantity) * 100.0 / NULLIF((
            SELECT SUM(quantity) 
            FROM [Backup_hskpro].[dbo].[data_receiving] 
            WHERE CAST(date_time AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
            AND description = 'INCOME' 
            AND production = 'PT HSK REMBANG'
          ), 0) AS DECIMAL(10, 2)), 
          '.', ','
        ) AS [percent],
        SUM(quantity) AS total
      FROM [Backup_hskpro].[dbo].[data_receiving]
      WHERE CAST(date_time AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
      AND description = 'INCOME' 
      AND production = 'PT HSK REMBANG'
      GROUP BY username
      ORDER BY username
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
 * Chart warehouse berdasarkan item (dari master_database)
 */
router.get('/warehouse-items', verifyToken, async (req, res) => {
  try {
    console.log('📦 Fetching warehouse items...');
    
    const result = await query(`
      SELECT 
        item,
        CAST(SUM(stock) * 100.0 / ISNULL(NULLIF((
          SELECT SUM(stock) FROM [Backup_hskpro].[dbo].[master_database]
        ), 0), 1) AS DECIMAL(10, 0)) AS status,
        SUM(stock) AS total
      FROM [Backup_hskpro].[dbo].[master_database]
      WHERE stock > 0
      GROUP BY item
      ORDER BY total DESC
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
 * List scan receiving hari ini
 */
router.get('/receiving-list', verifyToken, async (req, res) => {
  try {
    console.log('📥 Fetching receiving list...');
    
    const result = await query(`
      SELECT TOP 10
        CONVERT(varchar, date_time, 120) as date_time,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        scan_no
      FROM [Backup_hskpro].[dbo].[receiving]
      ORDER BY date_time DESC
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
 * List scan shipping hari ini
 */
router.get('/shipping-list', verifyToken, async (req, res) => {
  try {
    console.log('📤 Fetching shipping list...');
    
    const result = await query(`
      SELECT TOP 10
        CONVERT(varchar, date_time, 120) as date_time,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        scan_no
      FROM [Backup_hskpro].[dbo].[shipping]
      ORDER BY date_time DESC
    `);
    
    console.log('✅ Shipping list:', result.recordset.length, 'items');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Shipping list error:', err);
    res.status(500).json({ error: 'Failed to fetch shipping list', message: err.message });
  }
});

module.exports = router;