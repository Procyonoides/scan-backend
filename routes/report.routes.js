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

    // Tentukan table berdasarkan tipe
    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    
    // Build WHERE conditions
    let conditions = [];
    let params = {};

    // ✅ CRITICAL: Gunakan format date yang tepat seperti di PHP
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      // PHP: date_time >= '$tanggal1 07:30:00' AND date_time <= '$tanggal2 07:29:59'
      conditions.push('date_time >= @start_date');
      conditions.push('date_time <= @end_date');
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

    // ✅ Query sesuai dengan PHP
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
    // ✅ CRITICAL: PHP filter INCOME dan SAMPLE saja
    let conditions = ["description IN ('INCOME', 'SAMPLE')"];
    let params = {};
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('date_time >= @start_date');
      conditions.push('date_time <= @end_date');
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

    // ✅ Monthly report: GROUP BY production, brand, model, color, size, description
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

    // Get colors dari master_database
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

    // Get users (hanya RECEIVING, SHIPPING, IT)
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
 * ✅ SESUAI PHP: excel_detail_daily.php
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
      conditions.push('date_time >= @start_date');
      conditions.push('date_time <= @end_date');
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

    // Calculate grand total
    const grandTotal = result.recordset.reduce((sum, row) => sum + row.quantity, 0);

    // Simple CSV export sesuai PHP format
    const csv = [
      'SCAN NO,DATE/TIME,PRODUCTION,BRAND,MODEL,COLOR,SIZE,QUANTITY,USERNAME,DESCRIPTION',
      ...result.recordset.map(row => 
        `${row.scan_no},"${row.date_time}","${row.production}","${row.brand}","${row.model}","${row.color}","${row.size}",${row.quantity},"${row.username}","${row.description}"`
      ),
      `,,,,,,,,,GRAND TOTAL: ${grandTotal}`
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=Detail_Daily_${tipe.toUpperCase()}_${tanggal1}_to_${tanggal2}.csv`);
    res.send('\uFEFF' + csv); // Add BOM for Excel UTF-8

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
 * ✅ SESUAI PHP: excel_detail_monthly.php
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
    
    let conditions = ["description IN ('INCOME', 'SAMPLE')"];
    let params = {};
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      conditions.push('date_time >= @start_date');
      conditions.push('date_time <= @end_date');
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

    // Calculate grand total
    const grandTotal = result.recordset.reduce((sum, row) => sum + row.total, 0);

    // Simple CSV export sesuai PHP format
    const csv = [
      'NO,PRODUCTION,BRAND,MODEL,COLOR,SIZE,DESCRIPTION,TOTAL',
      ...result.recordset.map(row => 
        `${row.no},"${row.production}","${row.brand}","${row.model}","${row.color}","${row.size}","${row.description}",${row.total}`
      ),
      `,,,,,,GRAND TOTAL,${grandTotal}`
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=Detail_Monthly_${tipe.toUpperCase()}_${tanggal1}_to_${tanggal2}.csv`);
    res.send('\uFEFF' + csv); // Add BOM for Excel UTF-8

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
 * GET /api/reports/summary/export
 * Export summary report with sizes as columns (PIVOT)
 * ✅ SESUAI PHP: excel_summary_daily.php & excel_summary_monthly.php
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
    let whereClause = '';
    
    if (tanggal1 && tanggal1 !== 'n' && tanggal2 && tanggal2 !== 'n') {
      whereClause = 'WHERE date_time >= @start_date AND date_time <= @end_date';
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }

    // Query PIVOT untuk size sebagai kolom (sesuai PHP)
    const result = await query(`
      -- Grand Total Row First
      SELECT 'X' AS model, 'X' AS color, 'GRAND TOTAL' AS description, 
        SUM(CASE WHEN size = '10K' THEN quantity END) AS size_10K, 
        SUM(CASE WHEN size = '10TK' THEN quantity END) AS size_10TK,
        SUM(CASE WHEN size = '11K' THEN quantity END) AS size_11K,
        SUM(CASE WHEN size = '11TK' THEN quantity END) AS size_11TK,
        SUM(CASE WHEN size = '12K' THEN quantity END) AS size_12K,
        SUM(CASE WHEN size = '12TK' THEN quantity END) AS size_12TK,
        SUM(CASE WHEN size = '13K' THEN quantity END) AS size_13K,
        SUM(CASE WHEN size = '13TK' THEN quantity END) AS size_13TK,
        SUM(CASE WHEN size = '1' THEN quantity END) AS size_1,
        SUM(CASE WHEN size = '1T' THEN quantity END) AS size_1T,
        SUM(CASE WHEN size = '2' THEN quantity END) AS size_2,
        SUM(CASE WHEN size = '2T' THEN quantity END) AS size_2T,
        SUM(CASE WHEN size = '3' THEN quantity END) AS size_3,
        SUM(CASE WHEN size = '3T' THEN quantity END) AS size_3T,
        SUM(CASE WHEN size = '4' THEN quantity END) AS size_4,
        SUM(CASE WHEN size = '4T' THEN quantity END) AS size_4T,
        SUM(CASE WHEN size = '5' THEN quantity END) AS size_5,
        SUM(CASE WHEN size = '5T' THEN quantity END) AS size_5T,
        SUM(CASE WHEN size = '6' THEN quantity END) AS size_6,
        SUM(CASE WHEN size = '6T' THEN quantity END) AS size_6T,
        SUM(CASE WHEN size = '7' THEN quantity END) AS size_7,
        SUM(CASE WHEN size = '7T' THEN quantity END) AS size_7T,
        SUM(CASE WHEN size = '8' THEN quantity END) AS size_8,
        SUM(CASE WHEN size = '8T' THEN quantity END) AS size_8T,
        SUM(CASE WHEN size = '9' THEN quantity END) AS size_9,
        SUM(CASE WHEN size = '9T' THEN quantity END) AS size_9T,
        SUM(CASE WHEN size = '10' THEN quantity END) AS size_10,
        SUM(CASE WHEN size = '10T' THEN quantity END) AS size_10T,
        SUM(CASE WHEN size = '11' THEN quantity END) AS size_11,
        SUM(CASE WHEN size = '11T' THEN quantity END) AS size_11T,
        SUM(CASE WHEN size = '12' THEN quantity END) AS size_12,
        SUM(CASE WHEN size = '12T' THEN quantity END) AS size_12T,
        SUM(CASE WHEN size = '13' THEN quantity END) AS size_13,
        SUM(CASE WHEN size = '13T' THEN quantity END) AS size_13T,
        SUM(CASE WHEN size = '14' THEN quantity END) AS size_14,
        SUM(CASE WHEN size = '14T' THEN quantity END) AS size_14T,
        SUM(CASE WHEN size = '15' THEN quantity END) AS size_15,
        SUM(CASE WHEN size = '15T' THEN quantity END) AS size_15T,
        SUM(CASE WHEN size = '16' THEN quantity END) AS size_16,
        SUM(CASE WHEN size = '16T' THEN quantity END) AS size_16T,
        SUM(CASE WHEN size = '17' THEN quantity END) AS size_17,
        SUM(CASE WHEN size = '17T' THEN quantity END) AS size_17T,
        SUM(CASE WHEN size = '18' THEN quantity END) AS size_18,
        SUM(CASE WHEN size = '18T' THEN quantity END) AS size_18T,
        SUM(quantity) AS TOTAL 
      FROM [Backup_hskpro].[dbo].[${tableName}]
      ${whereClause}
      
      UNION ALL
      
      -- Detail Rows
      SELECT model, color, description,
        SUM(CASE WHEN size = '10K' THEN quantity END) AS size_10K,
        SUM(CASE WHEN size = '10TK' THEN quantity END) AS size_10TK,
        SUM(CASE WHEN size = '11K' THEN quantity END) AS size_11K,
        SUM(CASE WHEN size = '11TK' THEN quantity END) AS size_11TK,
        SUM(CASE WHEN size = '12K' THEN quantity END) AS size_12K,
        SUM(CASE WHEN size = '12TK' THEN quantity END) AS size_12TK,
        SUM(CASE WHEN size = '13K' THEN quantity END) AS size_13K,
        SUM(CASE WHEN size = '13TK' THEN quantity END) AS size_13TK,
        SUM(CASE WHEN size = '1' THEN quantity END) AS size_1,
        SUM(CASE WHEN size = '1T' THEN quantity END) AS size_1T,
        SUM(CASE WHEN size = '2' THEN quantity END) AS size_2,
        SUM(CASE WHEN size = '2T' THEN quantity END) AS size_2T,
        SUM(CASE WHEN size = '3' THEN quantity END) AS size_3,
        SUM(CASE WHEN size = '3T' THEN quantity END) AS size_3T,
        SUM(CASE WHEN size = '4' THEN quantity END) AS size_4,
        SUM(CASE WHEN size = '4T' THEN quantity END) AS size_4T,
        SUM(CASE WHEN size = '5' THEN quantity END) AS size_5,
        SUM(CASE WHEN size = '5T' THEN quantity END) AS size_5T,
        SUM(CASE WHEN size = '6' THEN quantity END) AS size_6,
        SUM(CASE WHEN size = '6T' THEN quantity END) AS size_6T,
        SUM(CASE WHEN size = '7' THEN quantity END) AS size_7,
        SUM(CASE WHEN size = '7T' THEN quantity END) AS size_7T,
        SUM(CASE WHEN size = '8' THEN quantity END) AS size_8,
        SUM(CASE WHEN size = '8T' THEN quantity END) AS size_8T,
        SUM(CASE WHEN size = '9' THEN quantity END) AS size_9,
        SUM(CASE WHEN size = '9T' THEN quantity END) AS size_9T,
        SUM(CASE WHEN size = '10' THEN quantity END) AS size_10,
        SUM(CASE WHEN size = '10T' THEN quantity END) AS size_10T,
        SUM(CASE WHEN size = '11' THEN quantity END) AS size_11,
        SUM(CASE WHEN size = '11T' THEN quantity END) AS size_11T,
        SUM(CASE WHEN size = '12' THEN quantity END) AS size_12,
        SUM(CASE WHEN size = '12T' THEN quantity END) AS size_12T,
        SUM(CASE WHEN size = '13' THEN quantity END) AS size_13,
        SUM(CASE WHEN size = '13T' THEN quantity END) AS size_13T,
        SUM(CASE WHEN size = '14' THEN quantity END) AS size_14,
        SUM(CASE WHEN size = '14T' THEN quantity END) AS size_14T,
        SUM(CASE WHEN size = '15' THEN quantity END) AS size_15,
        SUM(CASE WHEN size = '15T' THEN quantity END) AS size_15T,
        SUM(CASE WHEN size = '16' THEN quantity END) AS size_16,
        SUM(CASE WHEN size = '16T' THEN quantity END) AS size_16T,
        SUM(CASE WHEN size = '17' THEN quantity END) AS size_17,
        SUM(CASE WHEN size = '17T' THEN quantity END) AS size_17T,
        SUM(CASE WHEN size = '18' THEN quantity END) AS size_18,
        SUM(CASE WHEN size = '18T' THEN quantity END) AS size_18T,
        SUM(quantity) AS TOTAL 
      FROM [Backup_hskpro].[dbo].[${tableName}]
      ${whereClause}
      GROUP BY model, color, description 
      ORDER BY model, color, description ASC
    `, params);

    // Generate CSV with all size columns
    const headers = [
      'MODEL', 'COLOR', 'DESCRIPTION',
      '10K', '10TK', '11K', '11TK', '12K', '12TK', '13K', '13TK',
      '1', '1T', '2', '2T', '3', '3T', '4', '4T', '5', '5T',
      '6', '6T', '7', '7T', '8', '8T', '9', '9T',
      '10', '10T', '11', '11T', '12', '12T', '13', '13T',
      '14', '14T', '15', '15T', '16', '16T', '17', '17T', '18', '18T',
      'TOTAL'
    ];

    const csv = [
      headers.join(','),
      ...result.recordset.map(row => {
        const values = [
          row.model,
          row.color,
          row.description,
          row.size_10K || '',
          row.size_10TK || '',
          row.size_11K || '',
          row.size_11TK || '',
          row.size_12K || '',
          row.size_12TK || '',
          row.size_13K || '',
          row.size_13TK || '',
          row.size_1 || '',
          row.size_1T || '',
          row.size_2 || '',
          row.size_2T || '',
          row.size_3 || '',
          row.size_3T || '',
          row.size_4 || '',
          row.size_4T || '',
          row.size_5 || '',
          row.size_5T || '',
          row.size_6 || '',
          row.size_6T || '',
          row.size_7 || '',
          row.size_7T || '',
          row.size_8 || '',
          row.size_8T || '',
          row.size_9 || '',
          row.size_9T || '',
          row.size_10 || '',
          row.size_10T || '',
          row.size_11 || '',
          row.size_11T || '',
          row.size_12 || '',
          row.size_12T || '',
          row.size_13 || '',
          row.size_13T || '',
          row.size_14 || '',
          row.size_14T || '',
          row.size_15 || '',
          row.size_15T || '',
          row.size_16 || '',
          row.size_16T || '',
          row.size_17 || '',
          row.size_17T || '',
          row.size_18 || '',
          row.size_18T || '',
          row.TOTAL || 0
        ];
        return values.join(',');
      })
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=Summary_${tipe.toUpperCase()}_${tanggal1}_to_${tanggal2}.csv`);
    res.send('\uFEFF' + csv); // Add BOM for Excel UTF-8

  } catch (err) {
    console.error('❌ Export summary report error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export summary report', 
      message: err.message 
    });
  }
});

/**
 * GET /api/reports/hourly
 * Hourly report - untuk print hourly summary
 * ✅ SESUAI PHP: report_item.php (ekspor_hour)
 */
router.get('/hourly/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, tanggal1, tanggal2, jam1, jam2, model, color, size, user } = req.query;

    if (!tipe) {
      return res.status(400).json({
        success: false,
        error: 'Transaction type is required'
      });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    
    let conditions = [];
    let params = {};
    
    // Filter by date and hour range
    if (tanggal1 && tanggal2 && jam1 && jam2) {
      conditions.push('date_time >= @start_datetime');
      conditions.push('date_time <= @end_datetime');
      params.start_datetime = `${tanggal1} ${jam1}`;
      params.end_datetime = `${tanggal2} ${jam2}`;
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

    // Generate CSV
    const csv = [
      'DATE/TIME,PRODUCTION,BRAND,MODEL,COLOR,SIZE,QUANTITY,USERNAME,DESCRIPTION,SCAN NO',
      ...result.recordset.map(row => 
        `"${row.date_time}","${row.production}","${row.brand}","${row.model}","${row.color}","${row.size}",${row.quantity},"${row.username}","${row.description}",${row.scan_no}`
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=Hourly_Report_${tipe.toUpperCase()}_${tanggal1}_${jam1}_to_${tanggal2}_${jam2}.csv`);
    res.send('\uFEFF' + csv);

  } catch (err) {
    console.error('❌ Export hourly report error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export hourly report', 
      message: err.message 
    });
  }
});

module.exports = router;