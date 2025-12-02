const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * GET /api/stocks
 * Get all stocks - Using master_database JOIN with stok summary
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    console.log('📦 Stock request:', { page: pageNum, limit: limitNum, search });

    // Build search condition
    let searchCondition = '';
    let params = { offset: offsetNum, limit: limitNum };

    if (search && search.trim() !== '') {
      searchCondition = `WHERE (
        m.model LIKE @search OR 
        m.color LIKE @search OR 
        m.brand LIKE @search OR
        m.production LIKE @search OR
        m.item LIKE @search
      )`;
      params.search = `%${search.trim()}%`;
    }

    // Count total
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM [Backup_hskpro].[dbo].[master_database] m
      ${searchCondition}
    `;
    
    const countResult = await query(
      countQuery,
      search && search.trim() !== '' ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data dengan ROW_NUMBER untuk pagination
    const dataQuery = `
      WITH StockData AS (
        SELECT 
          ROW_NUMBER() OVER (ORDER BY m.model, m.color, m.size) as row_num,
          m.model,
          m.size,
          m.color,
          m.brand,
          m.item,
          m.production,
          ISNULL(m.stock, 0) as stock_akhir,
          
          -- Calculate percentage dari max stock
          CAST(
            ISNULL(m.stock, 0) * 100.0 / 
            NULLIF((SELECT MAX(stock) FROM [Backup_hskpro].[dbo].[master_database]), 0)
          AS DECIMAL(5,2)) as [percentage],
          
          -- Status based on stock
          CASE 
            WHEN ISNULL(m.stock, 0) > 100 THEN 'AVAILABLE'
            WHEN ISNULL(m.stock, 0) > 0 AND ISNULL(m.stock, 0) <= 100 THEN 'LOW_STOCK'
            ELSE 'OUT_OF_STOCK'
          END as [status],
          
          -- Production status: Check if model has receiving in last month
          CASE
            WHEN EXISTS (
              SELECT 1 FROM [Backup_hskpro].[dbo].[data_receiving] dr
              WHERE dr.model = m.model 
              AND dr.date_time >= DATEADD(MONTH, -1, GETDATE())
            ) THEN 'RUN'
            ELSE 'STOP'
          END AS status_production
          
        FROM [Backup_hskpro].[dbo].[master_database] m
        ${searchCondition}
      )
      SELECT 
        row_num as no,
        model,
        size,
        color,
        brand,
        item,
        production,
        stock_akhir,
        [percentage],
        [status],
        status_production
      FROM StockData
      WHERE row_num > @offset AND row_num <= (@offset + @limit)
      ORDER BY row_num
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
 * Get warehouse statistics
 */
router.get('/warehouse-stats', verifyToken, async (req, res) => {
  try {
    console.log('📊 Fetching warehouse stats...');
    
    const result = await query(`
      SELECT 
        ISNULL((SELECT SUM(stock) FROM [Backup_hskpro].[dbo].[master_database]), 0) as first_stock,
        ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[data_receiving] 
                WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving,
        ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[data_shipping] 
                WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping,
        ISNULL((SELECT SUM(stock) FROM [Backup_hskpro].[dbo].[master_database]), 0) as warehouse_stock
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
        SELECT CAST(date_time AS DATE) as date, COUNT(*) as receiving
        FROM [Backup_hskpro].[dbo].[data_receiving]
        WHERE date_time >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
        GROUP BY CAST(date_time AS DATE)
      ) r ON d.date = r.date
      LEFT JOIN (
        SELECT CAST(date_time AS DATE) as date, COUNT(*) as shipping
        FROM [Backup_hskpro].[dbo].[data_shipping]
        WHERE date_time >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
        GROUP BY CAST(date_time AS DATE)
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

module.exports = router;