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

    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('CAST(date_time AS DATE) >= @tanggal1');
      conditions.push('CAST(date_time AS DATE) <= @tanggal2');
      params.tanggal1 = tanggal1;
      params.tanggal2 = tanggal2;
    }
    
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
    let conditions = ['description IN (\'INCOME\', \'SAMPLE\')'];
    let params = {};
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('date_time BETWEEN @start_date AND @end_date');
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }
    
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
 * Export daily report to CSV
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
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('date_time BETWEEN @start_date AND @end_date');
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }
    
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
 * Export monthly report to CSV
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
    
    let conditions = ['description IN (\'INCOME\', \'SAMPLE\')'];
    let params = {};
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('date_time BETWEEN @start_date AND @end_date');
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }
    
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

/**
 * ✅ NEW: GET /api/reports/summary
 * Print summary with size as columns (like PHP excel_summary_daily)
 */
router.get('/summary/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, tanggal1, tanggal2 } = req.query;

    if (!tipe) {
      return res.status(400).json({
        success: false,
        error: 'Transaction type is required'
      });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    
    let params = {};
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }

    // Query PIVOT untuk size sebagai kolom
    const result = await query(`
      SELECT 'X' AS model, 'X' AS color, 'GRAND TOTAL' AS description, 
        SUM(CASE WHEN size = '10K' THEN quantity END) AS 'size_10K', 
        SUM(CASE WHEN size = '10TK' THEN quantity END) AS 'size_10TK',
        SUM(CASE WHEN size = '11K' THEN quantity END) AS 'size_11K',
        SUM(CASE WHEN size = '11TK' THEN quantity END) AS 'size_11TK',
        SUM(CASE WHEN size = '12K' THEN quantity END) AS 'size_12K',
        SUM(CASE WHEN size = '12TK' THEN quantity END) AS 'size_12TK',
        SUM(CASE WHEN size = '13K' THEN quantity END) AS 'size_13K',
        SUM(CASE WHEN size = '13TK' THEN quantity END) AS 'size_13TK',
        SUM(CASE WHEN size = '1' THEN quantity END) AS 'size_1',
        SUM(CASE WHEN size = '1T' THEN quantity END) AS 'size_1T',
        SUM(CASE WHEN size = '2' THEN quantity END) AS 'size_2',
        SUM(CASE WHEN size = '2T' THEN quantity END) AS 'size_2T',
        SUM(CASE WHEN size = '3' THEN quantity END) AS 'size_3',
        SUM(CASE WHEN size = '3T' THEN quantity END) AS 'size_3T',
        SUM(CASE WHEN size = '4' THEN quantity END) AS 'size_4',
        SUM(CASE WHEN size = '4T' THEN quantity END) AS 'size_4T',
        SUM(CASE WHEN size = '5' THEN quantity END) AS 'size_5',
        SUM(CASE WHEN size = '5T' THEN quantity END) AS 'size_5T',
        SUM(CASE WHEN size = '6' THEN quantity END) AS 'size_6',
        SUM(CASE WHEN size = '6T' THEN quantity END) AS 'size_6T',
        SUM(CASE WHEN size = '7' THEN quantity END) AS 'size_7',
        SUM(CASE WHEN size = '7T' THEN quantity END) AS 'size_7T',
        SUM(CASE WHEN size = '8' THEN quantity END) AS 'size_8',
        SUM(CASE WHEN size = '8T' THEN quantity END) AS 'size_8T',
        SUM(CASE WHEN size = '9' THEN quantity END) AS 'size_9',
        SUM(CASE WHEN size = '9T' THEN quantity END) AS 'size_9T',
        SUM(CASE WHEN size = '10' THEN quantity END) AS 'size_10',
        SUM(CASE WHEN size = '10T' THEN quantity END) AS 'size_10T',
        SUM(CASE WHEN size = '11' THEN quantity END) AS 'size_11',
        SUM(CASE WHEN size = '11T' THEN quantity END) AS 'size_11T',
        SUM(CASE WHEN size = '12' THEN quantity END) AS 'size_12',
        SUM(CASE WHEN size = '12T' THEN quantity END) AS 'size_12T',
        SUM(CASE WHEN size = '13' THEN quantity END) AS 'size_13',
        SUM(CASE WHEN size = '13T' THEN quantity END) AS 'size_13T',
        SUM(quantity) AS TOTAL 
      FROM [Backup_hskpro].[dbo].[${tableName}]
      WHERE date_time BETWEEN @start_date AND @end_date
      UNION ALL
      SELECT model, color, description,
        SUM(CASE WHEN size = '10K' THEN quantity END) AS 'size_10K',
        SUM(CASE WHEN size = '10TK' THEN quantity END) AS 'size_10TK',
        SUM(CASE WHEN size = '11K' THEN quantity END) AS 'size_11K',
        SUM(CASE WHEN size = '11TK' THEN quantity END) AS 'size_11TK',
        SUM(CASE WHEN size = '12K' THEN quantity END) AS 'size_12K',
        SUM(CASE WHEN size = '12TK' THEN quantity END) AS 'size_12TK',
        SUM(CASE WHEN size = '13K' THEN quantity END) AS 'size_13K',
        SUM(CASE WHEN size = '13TK' THEN quantity END) AS 'size_13TK',
        SUM(CASE WHEN size = '1' THEN quantity END) AS 'size_1',
        SUM(CASE WHEN size = '1T' THEN quantity END) AS 'size_1T',
        SUM(CASE WHEN size = '2' THEN quantity END) AS 'size_2',
        SUM(CASE WHEN size = '2T' THEN quantity END) AS 'size_2T',
        SUM(CASE WHEN size = '3' THEN quantity END) AS 'size_3',
        SUM(CASE WHEN size = '3T' THEN quantity END) AS 'size_3T',
        SUM(CASE WHEN size = '4' THEN quantity END) AS 'size_4',
        SUM(CASE WHEN size = '4T' THEN quantity END) AS 'size_4T',
        SUM(CASE WHEN size = '5' THEN quantity END) AS 'size_5',
        SUM(CASE WHEN size = '5T' THEN quantity END) AS 'size_5T',
        SUM(CASE WHEN size = '6' THEN quantity END) AS 'size_6',
        SUM(CASE WHEN size = '6T' THEN quantity END) AS 'size_6T',
        SUM(CASE WHEN size = '7' THEN quantity END) AS 'size_7',
        SUM(CASE WHEN size = '7T' THEN quantity END) AS 'size_7T',
        SUM(CASE WHEN size = '8' THEN quantity END) AS 'size_8',
        SUM(CASE WHEN size = '8T' THEN quantity END) AS 'size_8T',
        SUM(CASE WHEN size = '9' THEN quantity END) AS 'size_9',
        SUM(CASE WHEN size = '9T' THEN quantity END) AS 'size_9T',
        SUM(CASE WHEN size = '10' THEN quantity END) AS 'size_10',
        SUM(CASE WHEN size = '10T' THEN quantity END) AS 'size_10T',
        SUM(CASE WHEN size = '11' THEN quantity END) AS 'size_11',
        SUM(CASE WHEN size = '11T' THEN quantity END) AS 'size_11T',
        SUM(CASE WHEN size = '12' THEN quantity END) AS 'size_12',
        SUM(CASE WHEN size = '12T' THEN quantity END) AS 'size_12T',
        SUM(CASE WHEN size = '13' THEN quantity END) AS 'size_13',
        SUM(CASE WHEN size = '13T' THEN quantity END) AS 'size_13T',
        SUM(quantity) AS TOTAL 
      FROM [Backup_hskpro].[dbo].[${tableName}]
      WHERE date_time BETWEEN @start_date AND @end_date
      GROUP BY model, color, description 
      ORDER BY model, color, description ASC
    `, params);

    // Generate CSV with all size columns
    const headers = ['MODEL', 'COLOR', 'DESCRIPTION', '10K', '10TK', '11K', '11TK', '12K', '12TK', 
                     '13K', '13TK', '1', '1T', '2', '2T', '3', '3T', '4', '4T', '5', '5T',
                     '6', '6T', '7', '7T', '8', '8T', '9', '9T', '10', '10T', '11', '11T',
                     '12', '12T', '13', '13T', 'TOTAL'];

    const csv = [
      headers.join(','),
      ...result.recordset.map(row => {
        const values = [
          row.model,
          row.color,
          row.description,
          row.size_10K || 0,
          row.size_10TK || 0,
          row.size_11K || 0,
          row.size_11TK || 0,
          row.size_12K || 0,
          row.size_12TK || 0,
          row.size_13K || 0,
          row.size_13TK || 0,
          row.size_1 || 0,
          row.size_1T || 0,
          row.size_2 || 0,
          row.size_2T || 0,
          row.size_3 || 0,
          row.size_3T || 0,
          row.size_4 || 0,
          row.size_4T || 0,
          row.size_5 || 0,
          row.size_5T || 0,
          row.size_6 || 0,
          row.size_6T || 0,
          row.size_7 || 0,
          row.size_7T || 0,
          row.size_8 || 0,
          row.size_8T || 0,
          row.size_9 || 0,
          row.size_9T || 0,
          row.size_10 || 0,
          row.size_10T || 0,
          row.size_11 || 0,
          row.size_11T || 0,
          row.size_12 || 0,
          row.size_12T || 0,
          row.size_13 || 0,
          row.size_13T || 0,
          row.TOTAL || 0
        ];
        return values.join(',');
      })
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Summary_Report_${tipe}_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);

  } catch (err) {
    console.error('❌ Export summary report error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export summary report', 
      message: err.message 
    });
  }
});

module.exports = router;