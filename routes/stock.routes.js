const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

/**
 * GET /api/stocks
 * Get all stocks with search and pagination
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', status = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    // Build WHERE conditions
    let whereConditions = [];
    let params = { offset: offsetNum, limit: limitNum };

    if (search) {
      whereConditions.push(`(
        original_barcode LIKE @search OR 
        brand LIKE @search OR 
        model LIKE @search OR 
        color LIKE @search
      )`);
      params.search = `%${search}%`;
    }

    if (status) {
      if (status === 'AVAILABLE') {
        whereConditions.push('quantity > 100');
      } else if (status === 'LOW_STOCK') {
        whereConditions.push('quantity > 0 AND quantity <= 100');
      } else if (status === 'OUT_OF_STOCK') {
        whereConditions.push('quantity = 0');
      }
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM dbo.stok ${whereClause}`,
      search ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data
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
        status,
        CASE 
          WHEN quantity > 100 THEN 'AVAILABLE'
          WHEN quantity > 0 AND quantity <= 100 THEN 'LOW_STOCK'
          ELSE 'OUT_OF_STOCK'
        END as computed_status
      FROM dbo.stok
      ${whereClause}
      ORDER BY stock_id DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    console.log(`✅ Found ${result.recordset.length} stocks`);

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
    const result = await query(`
      SELECT 
        ISNULL((SELECT SUM(quantity) FROM dbo.stok), 0) as first_stock,
        ISNULL((SELECT COUNT(*) FROM dbo.receiving 
                WHERE CAST(scan_date AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving,
        ISNULL((SELECT COUNT(*) FROM dbo.shipping 
                WHERE CAST(scan_date AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping,
        ISNULL((SELECT SUM(quantity) FROM dbo.stok), 0) as warehouse_stock
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
 * GET /api/stocks/:id
 * Get specific stock by ID
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

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
      FROM dbo.stok
      WHERE stock_id = @stock_id
    `, { stock_id: parseInt(id) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Stock not found' });
    }

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