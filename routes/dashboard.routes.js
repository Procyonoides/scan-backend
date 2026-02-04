const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * GET /api/dashboard/warehouse-stats
 * ✅ SESUAI PHP: controller_monitoring.php line 874-890
 * Data dari table stok untuk hari ini, atau calculate jika belum ada
 */
router.get('/warehouse-stats', verifyToken, async (req, res) => {
  try {
    console.log('📦 Fetching warehouse stats...');
    
    // Get scan counts and total quantities for today
    const scanResult = await query(`
      SELECT 
        ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_count,
        ISNULL((SELECT SUM(quantity) FROM [Backup_hskpro].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_qty,
        ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_count,
        ISNULL((SELECT SUM(quantity) FROM [Backup_hskpro].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_qty
    `);
    
    const scanStats = scanResult.recordset[0] || {};
    
    // PHP: Mengambil data dari table stok untuk hari ini
    const result = await query(`
      SELECT TOP 1
        ISNULL(stock_awal, 0) as first_stock,
        ISNULL(receiving, 0) as receiving,
        ISNULL(shipping, 0) as shipping,
        ISNULL(stock_akhir, 0) as warehouse_stock
      FROM [Backup_hskpro].[dbo].[stok]
      WHERE CAST(date AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY date DESC
    `);
    
    if (result.recordset.length === 0) {
      console.warn('⚠️ No stok data for today, calculating from master_database & transaction tables');
      
      // Get yesterday's warehouse stock as first_stock
      const firstStockResult = await query(`
        SELECT TOP 1 ISNULL(stock_akhir, 0) as first_stock
        FROM [Backup_hskpro].[dbo].[stok]
        WHERE CAST(date AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
        ORDER BY date DESC
      `);
      
      const firstStock = firstStockResult.recordset.length > 0 ? firstStockResult.recordset[0].first_stock : 0;
      
      // Calculate warehouse stock from master_database if no stok record exists
      const warehouseStockResult = await query(`
        SELECT ISNULL(SUM(stock), 0) as warehouse_stock
        FROM [Backup_hskpro].[dbo].[master_database]
      `);
      
      const warehouseStock = warehouseStockResult.recordset[0]?.warehouse_stock || 0;
      
      const response = {
        first_stock: firstStock,
        receiving: scanStats.receiving_count,
        receiving_qty: scanStats.receiving_qty,
        shipping: scanStats.shipping_count,
        shipping_qty: scanStats.shipping_qty,
        warehouse_stock: warehouseStock
      };
      
      console.log('✅ Warehouse stats (calculated):', response);
      return res.json(response);
    }
    
    // If stok record exists, use actual scan counts and quantities
    const response = {
      first_stock: result.recordset[0].first_stock,
      receiving: scanStats.receiving_count,
      receiving_qty: scanStats.receiving_qty,
      shipping: scanStats.shipping_count,
      shipping_qty: scanStats.shipping_qty,
      warehouse_stock: result.recordset[0].warehouse_stock
    };
    
    console.log('✅ Warehouse stats:', response);
    res.json(response);
  } catch (err) {
    console.error('❌ Warehouse stats error:', err);
    res.status(500).json({ error: 'Failed to fetch warehouse stats', message: err.message });
  }
});

/**
 * GET /api/dashboard/daily-chart
 * ✅ SESUAI PHP: model_monitoring.php line 148-154 (get_data_daily)
 * Chart TOP 7 hari dari table stok, ORDER BY date DESC
 */
router.get('/daily-chart', verifyToken, async (req, res) => {
  try {
    console.log('📈 Fetching daily chart from stok table...');
    
    // PHP: SELECT TOP 7, ORDER BY date DESC, lalu di-reverse
    const result = await query(`
      SELECT TOP 7 
        CONVERT(VARCHAR, date, 23) AS date,
        ISNULL(receiving, 0) as receiving,
        ISNULL(shipping, 0) as shipping
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
 * ✅ SESUAI PHP: model_monitoring.php line 240-250 (get_chart_shift)
 * CRITICAL: PHP menggunakan date_time > '$yesterday' (SETELAH kemarin 07:30:00)
 * $yesterday = date('Y-m-d',strtotime("-1 day")) . ' 07:30:00'
 * Jadi query mengambil data dari kemarin 07:30:01 sampai sekarang
 */
router.get('/shift-scan', verifyToken, async (req, res) => {
  try {
    console.log('👥 Fetching shift scan (after yesterday 07:30:00)...');
    
    // Calculate yesterday 07:30:00
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(7, 30, 0, 0);
    const yesterdayStr = yesterday.toISOString().slice(0, 19).replace('T', ' ');
    
    console.log('📅 Yesterday timestamp:', yesterdayStr);
    
    // CRITICAL: PHP pakai date_time > '$yesterday' (greater than, bukan equal)
    // Artinya: data SETELAH kemarin 07:30:00 sampai sekarang
    const result = await query(`
      SELECT 
        username,
        CAST(SUM(quantity) * 100.0 / NULLIF((
          SELECT SUM(quantity) 
          FROM [Backup_hskpro].[dbo].[data_receiving] 
          WHERE date_time > @yesterday
          AND description = 'INCOME' 
          AND production = 'PT HSK REMBANG'
        ), 0) AS DECIMAL(10, 0)) AS status,
        REPLACE(
          CAST(SUM(quantity) * 100.0 / NULLIF((
            SELECT SUM(quantity) 
            FROM [Backup_hskpro].[dbo].[data_receiving] 
            WHERE date_time > @yesterday
            AND description = 'INCOME' 
            AND production = 'PT HSK REMBANG'
          ), 0) AS DECIMAL(10, 2)), 
          '.', ','
        ) AS [percent],
        SUM(quantity) AS total
      FROM [Backup_hskpro].[dbo].[data_receiving]
      WHERE date_time > @yesterday
      AND description = 'INCOME' 
      AND production = 'PT HSK REMBANG'
      GROUP BY username
      ORDER BY username
    `, { yesterday: yesterdayStr });
    
    console.log('✅ Shift scan data:', result.recordset.length, 'records');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Shift scan error:', err);
    res.status(500).json({ error: 'Failed to fetch shift scan data', message: err.message });
  }
});

/**
 * GET /api/dashboard/warehouse-items
 * ✅ SESUAI PHP: model_monitoring.php line 253-259 (get_chart_warehouse)
 * Chart warehouse berdasarkan item dari master_database
 * PHP tidak filter stock > 0, tapi grouping langsung
 */
router.get('/warehouse-items', verifyToken, async (req, res) => {
  try {
    console.log('📦 Fetching warehouse items...');
    
    // CRITICAL: PHP tidak pakai WHERE stock > 0
    // Query langsung GROUP BY item tanpa filter
    const result = await query(`
      SELECT 
        item,
        CAST(SUM(stock) * 100.0 / ISNULL(NULLIF((
          SELECT SUM(stock) FROM [Backup_hskpro].[dbo].[master_database]
        ), 0), 1) AS DECIMAL(10, 0)) AS status,
        SUM(stock) AS total
      FROM [Backup_hskpro].[dbo].[master_database]
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
 * ✅ SESUAI PHP: controller_monitoring.php line 939-943
 * List scan receiving HARI INI (TOP 5 di PHP, TOP 10 di Angular)
 */
router.get('/receiving-list', verifyToken, async (req, res) => {
  try {
    console.log('📥 Fetching receiving list...');
    
    // PHP pakai TOP 5, tapi Angular bisa pakai TOP 10 untuk lebih informatif
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
 * ✅ SESUAI PHP: controller_monitoring.php line 944-948
 * List scan shipping HARI INI (TOP 5 di PHP, TOP 10 di Angular)
 */
router.get('/shipping-list', verifyToken, async (req, res) => {
  try {
    console.log('📤 Fetching shipping list...');
    
    // PHP pakai TOP 5, tapi Angular bisa pakai TOP 10 untuk lebih informatif
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