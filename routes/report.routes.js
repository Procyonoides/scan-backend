const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

/**
 * GET /api/reports/daily
 * Get daily report with filters
 * ✅ SESUAI PHP: view_daily_it.php & view_daily_management.php
 */
router.get('/daily', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { 
      tipe,      // 'receiving' atau 'shipping'
      model, 
      color, 
      size, 
      user, 
      tanggal1,  // start date
      tanggal2   // end date
    } = req.query;

    console.log('📊 Daily Report Request:', req.query);

    // Build WHERE conditions
    let conditions = [];
    let params = {};

    if (tipe) {
      // Pilih table berdasarkan tipe
      const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
      
      // Build conditions
      if (model && model !== 'n') {
        conditions.push('model_code = @model');
        params.model = model;
      }
      
      if (color && color !== 'n') {
        conditions.push('color = @color');
        params.color = color.replace(/_/g, ' ');
      }
      
      if (size && size !== 'n') {
        conditions.push('size = @size');
        params.size = size.replace(/_/g, ' ');
      }
      
      if (user && user !== 'n') {
        conditions.push('username = @user');
        params.user = user;
      }
      
      if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
        conditions.push('CAST(date_time AS DATE) >= @tanggal1');
        conditions.push('CAST(date_time AS DATE) <= @tanggal2');
        params.tanggal1 = tanggal1;
        params.tanggal2 = tanggal2;
      }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const result = await query(`
        SELECT 
          CONVERT(varchar, date_time, 120) as date_time,
          production,
          brand,
          model,
          color,
          size,
          quantity,
          username,
          description,
          scan_no
        FROM [Backup_hskpro].[dbo].[${tableName}]
        ${whereClause}
        ORDER BY date_time DESC
      `, params);

      console.log('✅ Daily report data:', result.recordset.length, 'records');
      
      res.json({
        success: true,
        data: result.recordset,
        filters: {
          tipe,
          model,
          color,
          size,
          user,
          tanggal1,
          tanggal2
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Transaction type (tipe) is required'
      });
    }

  } catch (err) {
    console.error('❌ Daily report error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch daily report', 
      message: err.message 
    });
  }
});

/**
 * GET /api/reports/monthly
 * Get monthly report (summary by model, color, size)
 * ✅ SESUAI PHP: view_monthly_it.php & view_monthly_management.php
 */
router.get('/monthly', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { 
      tipe,
      model, 
      color, 
      size, 
      user, 
      tanggal1,
      tanggal2
    } = req.query;

    console.log('📊 Monthly Report Request:', req.query);

    if (!tipe) {
      return res.status(400).json({
        success: false,
        error: 'Transaction type (tipe) is required'
      });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    
    // Build WHERE conditions
    let conditions = [];
    let params = {};
    
    if (model && model !== 'n') {
      conditions.push('model_code = @model');
      params.model = model;
    }
    
    if (color && color !== 'n') {
      conditions.push('color = @color');
      params.color = color.replace(/_/g, ' ');
    }
    
    if (size && size !== 'n') {
      conditions.push('size = @size');
      params.size = size.replace(/_/g, ' ');
    }
    
    if (user && user !== 'n') {
      conditions.push('username = @user');
      params.user = user;
    }
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('CAST(date_time AS DATE) >= @tanggal1');
      conditions.push('CAST(date_time AS DATE) <= @tanggal2');
      params.tanggal1 = tanggal1;
      params.tanggal2 = tanggal2;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Monthly report: GROUP BY production, brand, model, color, size, description
    const result = await query(`
      SELECT 
        ROW_NUMBER() OVER (ORDER BY model, color, size) as no,
        production,
        brand,
        model,
        color,
        size,
        description,
        SUM(quantity) as total
      FROM [Backup_hskpro].[dbo].[${tableName}]
      ${whereClause}
      GROUP BY production, brand, model, color, size, description
      ORDER BY model, color, size
    `, params);

    console.log('✅ Monthly report data:', result.recordset.length, 'records');
    
    res.json({
      success: true,
      data: result.recordset,
      filters: {
        tipe,
        model,
        color,
        size,
        user,
        tanggal1,
        tanggal2
      }
    });

  } catch (err) {
    console.error('❌ Monthly report error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch monthly report', 
      message: err.message 
    });
  }
});

/**
 * GET /api/reports/filter-options
 * Get dropdown options for filters
 */
router.get('/filter-options', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    console.log('📡 Loading report filter options...');

    // Get models
    const modelsResult = await query(`
      SELECT DISTINCT model_code, model 
      FROM [Backup_hskpro].[dbo].[list_model] 
      ORDER BY model
    `);

    // Get colors
    const colorsResult = await query(`
      SELECT DISTINCT color 
      FROM [Backup_hskpro].[dbo].[master_database] 
      WHERE color IS NOT NULL AND color != ''
      ORDER BY color
    `);

    // Get sizes
    const sizesResult = await query(`
      SELECT DISTINCT size 
      FROM [Backup_hskpro].[dbo].[list_size] 
      ORDER BY size
    `);

    // Get users
    const usersResult = await query(`
      SELECT DISTINCT username 
      FROM [Backup_hskpro].[dbo].[users] 
      WHERE position IN ('RECEIVING', 'SHIPPING', 'IT')
      ORDER BY username
    `);

    res.json({
      success: true,
      models: modelsResult.recordset,
      colors: colorsResult.recordset.map(r => r.color),
      sizes: sizesResult.recordset.map(r => r.size),
      users: usersResult.recordset.map(r => r.username)
    });

  } catch (err) {
    console.error('❌ Get filter options error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch filter options', 
      message: err.message 
    });
  }
});

/**
 * GET /api/reports/daily/export
 * Export daily report to Excel
 */
router.get('/daily/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;

    if (!tipe) {
      return res.status(400).json({
        success: false,
        error: 'Transaction type is required'
      });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    
    let conditions = [];
    let params = {};
    
    if (model && model !== 'n') {
      conditions.push('model_code = @model');
      params.model = model;
    }
    
    if (color && color !== 'n') {
      conditions.push('color = @color');
      params.color = color.replace(/_/g, ' ');
    }
    
    if (size && size !== 'n') {
      conditions.push('size = @size');
      params.size = size.replace(/_/g, ' ');
    }
    
    if (user && user !== 'n') {
      conditions.push('username = @user');
      params.user = user;
    }
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('CAST(date_time AS DATE) >= @tanggal1');
      conditions.push('CAST(date_time AS DATE) <= @tanggal2');
      params.tanggal1 = tanggal1;
      params.tanggal2 = tanggal2;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await query(`
      SELECT 
        scan_no,
        CONVERT(varchar, date_time, 120) as date_time,
        production,
        brand,
        model,
        color,
        size,
        quantity,
        username,
        description
      FROM [Backup_hskpro].[dbo].[${tableName}]
      ${whereClause}
      ORDER BY date_time DESC
    `, params);

    // Simple CSV export
    const csv = [
      'SCAN NO,DATE/TIME,PRODUCTION,BRAND,MODEL,COLOR,SIZE,QUANTITY,USERNAME,DESCRIPTION',
      ...result.recordset.map(row => 
        `${row.scan_no},"${row.date_time}","${row.production}","${row.brand}","${row.model}","${row.color}","${row.size}",${row.quantity},"${row.username}","${row.description}"`
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Daily_Report_${tipe}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);

  } catch (err) {
    console.error('❌ Export daily report error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export daily report', 
      message: err.message 
    });
  }
});

/**
 * GET /api/reports/monthly/export
 * Export monthly report to Excel
 */
router.get('/monthly/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;

    if (!tipe) {
      return res.status(400).json({
        success: false,
        error: 'Transaction type is required'
      });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    
    let conditions = [];
    let params = {};
    
    if (model && model !== 'n') {
      conditions.push('model_code = @model');
      params.model = model;
    }
    
    if (color && color !== 'n') {
      conditions.push('color = @color');
      params.color = color.replace(/_/g, ' ');
    }
    
    if (size && size !== 'n') {
      conditions.push('size = @size');
      params.size = size.replace(/_/g, ' ');
    }
    
    if (user && user !== 'n') {
      conditions.push('username = @user');
      params.user = user;
    }
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('CAST(date_time AS DATE) >= @tanggal1');
      conditions.push('CAST(date_time AS DATE) <= @tanggal2');
      params.tanggal1 = tanggal1;
      params.tanggal2 = tanggal2;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const result = await query(`
      SELECT 
        ROW_NUMBER() OVER (ORDER BY model, color, size) as no,
        production,
        brand,
        model,
        color,
        size,
        description,
        SUM(quantity) as total
      FROM [Backup_hskpro].[dbo].[${tableName}]
      ${whereClause}
      GROUP BY production, brand, model, color, size, description
      ORDER BY model, color, size
    `, params);

    // Simple CSV export
    const csv = [
      'NO,PRODUCTION,BRAND,MODEL,COLOR,SIZE,DESCRIPTION,TOTAL',
      ...result.recordset.map(row => 
        `${row.no},"${row.production}","${row.brand}","${row.model}","${row.color}","${row.size}","${row.description}",${row.total}`
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Monthly_Report_${tipe}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);

  } catch (err) {
    console.error('❌ Export monthly report error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export monthly report', 
      message: err.message 
    });
  }
});

module.exports = router;