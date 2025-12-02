const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * GET /api/stocks
 * Get all stocks with search, filter, and pagination
 * Data dari tabel dbo.stok
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    console.log('📦 Stock request:', { page: pageNum, limit: limitNum, search, status });

    // Build WHERE conditions
    let whereConditions = [];
    let params = { offset: offsetNum, limit: limitNum };

    if (search) {
      whereConditions.push(`(
        model LIKE @search OR 
        color LIKE @search OR 
        brand LIKE @search OR
        production LIKE @search
      )`);
      params.search = `%${search}%`;
    }

    // Status filtering berdasarkan stock_akhir
    if (status) {
      if (status === 'AVAILABLE') {
        whereConditions.push('ISNULL(stock_akhir, 0) > 100');
      } else if (status === 'LOW_STOCK') {
        whereConditions.push('ISNULL(stock_akhir, 0) > 0 AND ISNULL(stock_akhir, 0) <= 100');
      } else if (status === 'OUT_OF_STOCK') {
        whereConditions.push('ISNULL(stock_akhir, 0) = 0');
      }
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM [Backup_hskpro].[dbo].[stok]
      ${whereClause}
    `;
    
    const countResult = await query(
      countQuery,
      search ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data dari tabel stok (menggunakan ROW_NUMBER untuk kompatibilitas)
    const dataQuery = `
      WITH StockData AS (
        SELECT 
          no,
          model,
          [size],
          color,
          brand,
          item,
          production,
          ISNULL(stock_awal, 0) as stock_awal,
          ISNULL(receiving, 0) as receiving,
          ISNULL(shipping, 0) as shipping,
          ISNULL(stock_akhir, 0) as stock_akhir,
          CAST(ISNULL(stock_akhir, 0) * 100.0 / NULLIF(
            (SELECT MAX(stock_akhir) FROM [Backup_hskpro].[dbo].[stok]), 0
          ) AS DECIMAL(5,2)) as [percentage],
          CASE 
            WHEN ISNULL(stock_akhir, 0) > 100 THEN 'AVAILABLE'
            WHEN ISNULL(stock_akhir, 0) > 0 AND ISNULL(stock_akhir, 0) <= 100 THEN 'LOW_STOCK'
            ELSE 'OUT_OF_STOCK'
          END as [status],
          CONVERT(varchar, [date], 120) as [date],
          ROW_NUMBER() OVER (ORDER BY no DESC) as RowNum
        FROM [Backup_hskpro].[dbo].[stok]
        ${whereClause}
      )
      SELECT 
        no, model, [size], color, brand, item, production,
        stock_awal, receiving, shipping, stock_akhir, 
        [percentage], [status], [date]
      FROM StockData
      WHERE RowNum > @offset AND RowNum <= (@offset + @limit)
      ORDER BY no DESC
    `;

    const result = await query(dataQuery, params);

    console.log(`✅ Found ${result.recordset.length} stocks (Total: ${total})`);

    res.json({
      data: result.recordset,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (err) {
    console.error('❌ Get stocks error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch stocks',
      message: err.message 
    });
  }
});

/**
 * GET /api/stocks/warehouse-stats
 * Get warehouse statistics dari tabel stok
 */
router.get('/warehouse-stats', verifyToken, async (req, res) => {
  try {
    console.log('📊 Fetching warehouse stats...');
    
    // Query dari tabel stok
    const result = await query(`
      SELECT 
        ISNULL((SELECT SUM(stock_awal) FROM [Backup_hskpro].[dbo].[stok]), 0) as first_stock,
        ISNULL((SELECT SUM(receiving) FROM [Backup_hskpro].[dbo].[stok]), 0) as receiving,
        ISNULL((SELECT SUM(shipping) FROM [Backup_hskpro].[dbo].[stok]), 0) as shipping,
        ISNULL((SELECT SUM(stock_akhir) FROM [Backup_hskpro].[dbo].[stok]), 0) as warehouse_stock
    `);
    
    console.log('✅ Warehouse stats:', result.recordset[0]);
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('❌ Warehouse stats error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch warehouse stats',
      message: err.message 
    });
  }
});

/**
 * GET /api/stocks/chart-data
 * Get chart data for last 7 days
 */
router.get('/chart-data', verifyToken, async (req, res) => {
  try {
    console.log('📈 Fetching chart data...');
    
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
    
    console.log('✅ Chart data:', result.recordset.length, 'records');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Chart data error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch chart data',
      message: err.message 
    });
  }
});

/**
 * GET /api/stocks/:no
 * Get specific stock by no (primary key)
 */
router.get('/:no', verifyToken, async (req, res) => {
  try {
    const { no } = req.params;

    console.log(`🔍 Fetching stock for no: ${no}`);

    const result = await query(`
      SELECT 
        no,
        model,
        [size],
        color,
        brand,
        item,
        production,
        ISNULL(stock_awal, 0) as stock_awal,
        ISNULL(receiving, 0) as receiving,
        ISNULL(shipping, 0) as shipping,
        ISNULL(stock_akhir, 0) as stock_akhir,
        CAST(ISNULL(stock_akhir, 0) * 100.0 / NULLIF(
          (SELECT MAX(stock_akhir) FROM [Backup_hskpro].[dbo].[stok]), 0
        ) AS DECIMAL(5,2)) as [percentage],
        CASE 
          WHEN ISNULL(stock_akhir, 0) > 100 THEN 'AVAILABLE'
          WHEN ISNULL(stock_akhir, 0) > 0 AND ISNULL(stock_akhir, 0) <= 100 THEN 'LOW_STOCK'
          ELSE 'OUT_OF_STOCK'
        END as [status],
        CONVERT(varchar, [date], 120) as [date]
      FROM [Backup_hskpro].[dbo].[stok]
      WHERE no = @no
    `, { no: parseInt(no) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Stock not found' });
    }

    console.log('✅ Stock found:', result.recordset[0]);
    res.json(result.recordset[0]);

  } catch (err) {
    console.error('❌ Get stock detail error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch stock',
      message: err.message 
    });
  }
});

module.exports = router;