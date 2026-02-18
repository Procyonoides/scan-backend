const express = require('express');
const router = express.Router();
const { query, dbName } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

/**
 * ========== STOCK MONITORING LOGIC (dari hskpro) ==========
 * 
 * Table: [stok] - Menyimpan summary stok harian
 * Columns:
 *  - date: Tanggal
 *  - stock_awal: Stok awal hari (first_stock) = stok akhir hari sebelumnya
 *  - receiving: COUNT receiving yang masuk hari ini
 *  - shipping: COUNT shipping yang keluar hari ini
 *  - stock_akhir: Stok akhir hari = stock_awal + receiving - shipping
 * 
 * Dashboard Stats:
 *  1. first_stock: Stock awal hari = kemarin's stock_akhir (jika table stok tidak ada hari ini)
 *  2. receiving: COUNT receiving scans hari ini (real-time dari tabel receiving)
 *  3. shipping: COUNT shipping scans hari ini (real-time dari tabel shipping)
 *  4. warehouse_stock: SUM(stock) dari master_database (current state)
 * 
 * Flow:
 *  - Jika ada stok record untuk hari ini: Gunakan data dari stok table
 *  - Jika belum ada stok record: Hitung dari kemarin's ending stock + today's transactions
 */

/**
 * GET /api/dashboard/warehouse-stats
 * ✅ Stock Monitoring Dashboard
 * first_stock = stok_awal (dari hari kemarin atau dari stok table)
 * receiving = count receiving scans hari ini
 * shipping = count shipping scans hari ini
 * warehouse_stock = SUM(stock) dari master_database
 */
router.get('/warehouse-stats', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    console.log('📦 Fetching warehouse stats...');

    // 1. Get today's scan counts and quantities
    const scanResult = await query(`
      SELECT 
        ISNULL((SELECT COUNT(*) FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_count,
        ISNULL((SELECT SUM(quantity) FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_qty,
        ISNULL((SELECT COUNT(*) FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_count,
        ISNULL((SELECT SUM(quantity) FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_qty
    `);

    const scanStats = scanResult.recordset[0] || {};

    // 2. Try to get today's stok record first
    const stokResult = await query(`
      SELECT TOP 1
        ISNULL(stock_awal, 0) as first_stock,
        ISNULL(stock_akhir, 0) as warehouse_stock
      FROM [${dbName}].[dbo].[stok]
      WHERE CAST(date AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY date DESC
    `);

    let firstStock = 0;
    let warehouseStock = 0;

    if (stokResult.recordset.length > 0) {
      // If stok record exists for today, use it
      firstStock = stokResult.recordset[0].first_stock;
      warehouseStock = stokResult.recordset[0].warehouse_stock;
      console.log('✅ Today stok record found:', { firstStock, warehouseStock });
    } else {
      // If no stok record for today, calculate from yesterday and master_database
      console.warn('⚠️ No stok record for today, calculating from yesterday + master_database');

      // Get yesterday's stock_akhir as today's stock_awal
      const yesterdayResult = await query(`
        SELECT TOP 1 ISNULL(stock_akhir, 0) as yesterday_stock
        FROM [${dbName}].[dbo].[stok]
        WHERE CAST(date AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
        ORDER BY date DESC
      `);

      firstStock = yesterdayResult.recordset.length > 0 ? yesterdayResult.recordset[0].yesterday_stock : 0;

      // Get current warehouse stock from master_database
      const warehouseResult = await query(`
        SELECT ISNULL(SUM(stock), 0) as warehouse_stock
        FROM [${dbName}].[dbo].[master_database]
      `);

      warehouseStock = warehouseResult.recordset[0]?.warehouse_stock || 0;

      console.log('📊 Calculated stats:', { firstStock, warehouseStock, receivingCount: scanStats.receiving_count });
    }

    const response = {
      first_stock: firstStock,
      receiving: scanStats.receiving_count,
      receiving_qty: scanStats.receiving_qty,
      shipping: scanStats.shipping_count,
      shipping_qty: scanStats.shipping_qty,
      warehouse_stock: warehouseStock
    };

    console.log('✅ Final warehouse stats:', response);
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
router.get('/daily-chart', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    console.log('📈 Fetching daily chart from stok table...');

    // PHP: SELECT TOP 7, ORDER BY date DESC, lalu di-reverse
    const result = await query(`
      SELECT TOP 7 
        CONVERT(VARCHAR, date, 23) AS date,
        ISNULL(receiving, 0) as receiving,
        ISNULL(shipping, 0) as shipping
      FROM [${dbName}].[dbo].[stok]
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
router.get('/shift-scan', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
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
          FROM [${dbName}].[dbo].[data_receiving] 
          WHERE date_time > @yesterday
          AND description = 'INCOME' 
          AND production = 'PT HSK REMBANG'
        ), 0) AS DECIMAL(10, 0)) AS status,
        REPLACE(
          CAST(SUM(quantity) * 100.0 / NULLIF((
            SELECT SUM(quantity) 
            FROM [${dbName}].[dbo].[data_receiving] 
            WHERE date_time > @yesterday
            AND description = 'INCOME' 
            AND production = 'PT HSK REMBANG'
          ), 0) AS DECIMAL(10, 2)), 
          '.', ','
        ) AS [percent],
        SUM(quantity) AS total
      FROM [${dbName}].[dbo].[data_receiving]
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
router.get('/warehouse-items', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    console.log('📦 Fetching warehouse items...');

    // CRITICAL: PHP tidak pakai WHERE stock > 0
    // Query langsung GROUP BY item tanpa filter
    const result = await query(`
      SELECT 
        item,
        CAST(SUM(stock) * 100.0 / ISNULL(NULLIF((
          SELECT SUM(stock) FROM [${dbName}].[dbo].[master_database]
        ), 0), 1) AS DECIMAL(10, 0)) AS status,
        SUM(stock) AS total
      FROM [${dbName}].[dbo].[master_database]
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
router.get('/receiving-list', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
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
      FROM [${dbName}].[dbo].[receiving]
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
router.get('/shipping-list', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
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
      FROM [${dbName}].[dbo].[shipping]
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