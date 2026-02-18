const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { query, dbName } = require('../config/database');
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

    if (!tipe) {
      return res.status(400).json({ success: false, error: 'Transaction type (tipe) is required' });
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
      FROM [${dbName}].[dbo].[${tableName}]
      ${whereClause}
      ORDER BY date_time DESC
    `, params);

    res.json({ success: true, data: result.recordset });

  } catch (err) {
    console.error('❌ Daily report error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch daily report', message: err.message });
  }
});

/**
 * GET /api/reports/monthly
 * Get monthly report (summary by model, color, size)
 */
router.get('/monthly', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;

    if (!tipe) {
      return res.status(400).json({ success: false, error: 'Transaction type (tipe) is required' });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    let conditions = ["description IN ('INCOME', 'SAMPLE')"];
    let params = {};

    if (tanggal1 && tanggal2) {
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
      FROM [${dbName}].[dbo].[${tableName}]
      ${whereClause}
      GROUP BY production, brand, model, color, size, description
      ORDER BY model, color, size
    `, params);

    res.json({ success: true, data: result.recordset });

  } catch (err) {
    console.error('❌ Monthly report error:', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

/**
 * GET /api/reports/filter-options
 */
router.get('/filter-options', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const modelsResult = await query(`SELECT DISTINCT model_code, model FROM [${dbName}].[dbo].[list_model] ORDER BY model`);
    const colorsResult = await query(`SELECT DISTINCT color FROM [${dbName}].[dbo].[master_database] WHERE color IS NOT NULL AND color != '' ORDER BY color`);
    const sizesResult = await query(`SELECT DISTINCT size FROM [${dbName}].[dbo].[list_size] ORDER BY size`);
    const usersResult = await query(`SELECT DISTINCT username FROM [${dbName}].[dbo].[users] WHERE position IN ('RECEIVING', 'SHIPPING', 'IT') ORDER BY username`);

    res.json({
      success: true,
      models: modelsResult.recordset,
      colors: colorsResult.recordset.map(r => r.color),
      sizes: sizesResult.recordset.map(r => r.size),
      users: usersResult.recordset.map(r => r.username)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch filter options' });
  }
});

/**
 * GET /api/reports/daily/export
 * Export daily report to XLSX
 */
router.get('/daily/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;
    if (!tipe) return res.status(400).json({ success: false, error: 'Type required' });

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    let conditions = [];
    let params = {};
    if (tanggal1 && tanggal2) {
      conditions.push('date_time >= @start_date AND date_time <= @end_date');
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }

    if (model && model !== 'n') { conditions.push('model_code = @model'); params.model = model; }
    if (color && color !== 'n') { conditions.push('color = @color'); params.color = color.replace(/_/g, ' '); }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await query(`
      SELECT 
        scan_no as [SCAN NO],
        CONVERT(varchar, date_time, 120) as [DATE/TIME],
        production as [PRODUCTION],
        brand as [BRAND],
        model as [MODEL],
        color as [COLOR],
        size as [SIZE],
        quantity as [QUANTITY],
        username as [USERNAME],
        description as [DESCRIPTION]
      FROM [${dbName}].[dbo].[${tableName}]
      ${whereClause}
      ORDER BY date_time DESC
    `, params);

    const nowTime = new Date().toLocaleTimeString('id-ID');
    const username = req.user.username;

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const grandTotal = data.reduce((sum, row) => sum + (parseInt(row.QUANTITY) || 0), 0);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([]);

    XLSX.utils.sheet_add_aoa(ws, [
      [`DETAIL DAILY ${tipe.toUpperCase()} DATE ${tanggal1} to ${tanggal2} TIME ${nowTime}`],
      [`USERNAME: ${username}`],
      []
    ], { origin: 'A1' });

    XLSX.utils.sheet_add_json(ws, data, { origin: 'A4', skipHeader: false });

    // GRAND TOTAL row
    XLSX.utils.sheet_add_aoa(ws, [[null, null, null, null, null, null, null, 'GRAND TOTAL', grandTotal]], { origin: `A${data.length + 5}` });

    ws['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 32 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 10 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Daily Report');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Detail_Daily_${tipe.toUpperCase()}_${tanggal1}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/monthly/export
 * Export monthly report to XLSX
 */
router.get('/monthly/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;
    if (!tipe) return res.status(400).json({ success: false, error: 'Type required' });

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    let conditions = ["description IN ('INCOME', 'SAMPLE')"];
    let params = {};
    if (tanggal1 && tanggal2) {
      conditions.push('date_time >= @start_date AND date_time <= @end_date');
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await query(`
      SELECT 
        production as [PRODUCTION],
        brand as [BRAND],
        model as [MODEL],
        color as [COLOR],
        size as [SIZE],
        description as [DESCRIPTION],
        SUM(quantity) as [TOTAL]
      FROM [${dbName}].[dbo].[${tableName}]
      ${whereClause}
      GROUP BY production, brand, model, color, size, description
      ORDER BY model, color, size
    `, params);

    const nowTime = new Date().toLocaleTimeString('id-ID');
    const username = req.user.username;

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const grandTotal = data.reduce((sum, row) => sum + (parseInt(row.TOTAL) || 0), 0);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([]);

    XLSX.utils.sheet_add_aoa(ws, [
      [`DETAIL MONTHLY ${tipe.toUpperCase()} DATE ${tanggal1} to ${tanggal2} TIME ${nowTime}`],
      [`USERNAME: ${username}`],
      []
    ], { origin: 'A1' });

    XLSX.utils.sheet_add_json(ws, data, { origin: 'A4', skipHeader: false });

    XLSX.utils.sheet_add_aoa(ws, [[null, null, null, null, null, 'GRAND TOTAL', grandTotal]], { origin: `A${data.length + 5}` });

    ws['!cols'] = [
      { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 32 }, { wch: 10 }, { wch: 20 }, { wch: 10 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Report');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Detail_Monthly_${tipe.toUpperCase()}_${tanggal1}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/summary/export
 * Export summary report with sizes as columns (PIVOT/MATRIX)
 * ✅ SESUAI PHP: excel_summary.php
 */
router.get('/summary/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, tanggal1, tanggal2 } = req.query;

    if (!tipe) return res.status(400).json({ success: false, error: 'Type required' });

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    let params = {};
    let whereClause = '';

    if (tanggal1 && tanggal2) {
      whereClause = 'WHERE date_time >= @start_date AND date_time <= @end_date';
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }
    const nowTime = new Date().toLocaleTimeString('id-ID');
    const username = req.user.username;

    const sizes = ['10K', '10TK', '11K', '11TK', '12K', '12TK', '13K', '13TK', '1', '1T', '2', '2T', '3', '3T', '4', '4T', '5', '5T', '6', '6T', '7', '7T', '8', '8T', '9', '9T', '10', '10T', '11', '11T', '12', '12T', '13', '13T', '14', '14T', '15', '15T', '16', '16T', '17', '17T', '18', '18T'];
    let pivotSelect = sizes.map((s, i) => `SUM(CASE WHEN size = '${s}' THEN quantity ELSE 0 END) AS [size_${i + 1}]`).join(', ');

    const sql = `
      SELECT 'X' AS model, 'X' AS color, 'GRAND TOTAL' AS description, ${pivotSelect}, SUM(quantity) AS TOTAL 
      FROM [${dbName}].[dbo].[${tableName}] ${whereClause}
      UNION ALL
      SELECT model, color, description, ${pivotSelect}, SUM(quantity) AS TOTAL 
      FROM [${dbName}].[dbo].[${tableName}] ${whereClause}
      GROUP BY model, color, description 
      ORDER BY model ASC, color ASC, description ASC
    `;

    const result = await query(sql, params);
    const rawData = result.recordset;

    if (rawData.length <= 1 && rawData[0].TOTAL === null) return res.status(404).json({ success: false, error: 'No data' });

    const formattedData = rawData.map(row => {
      const obj = { 'MODEL': row.model, 'COLOR': row.color, 'DESCRIPTION': row.description };
      sizes.forEach((s, i) => { obj[s] = row[`size_${i + 1}`] || ''; });
      obj['TOTAL'] = row.TOTAL;
      return obj;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([]);

    XLSX.utils.sheet_add_aoa(ws, [
      [`SUMMARY ${tipe.toUpperCase()} DATE ${tanggal1} to ${tanggal2} TIME ${nowTime}`],
      [`USERNAME: ${username}`],
      []
    ], { origin: 'A1' });

    XLSX.utils.sheet_add_json(ws, formattedData, { origin: 'A4', skipHeader: false });

    ws['!cols'] = [{ wch: 40 }, { wch: 32 }, { wch: 25 }, ...sizes.map(() => ({ wch: 7 })), { wch: 10 }];

    XLSX.utils.book_append_sheet(wb, ws, 'Summary Matrix');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Summary_${tipe.toUpperCase()}_${tanggal1}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/hourly/export
 */
router.get('/hourly/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, tanggal1, tanggal2, jam1, jam2 } = req.query;
    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';

    const result = await query(`
      SELECT 
        CONVERT(varchar, date_time, 120) as [DATE/TIME],
        production as [PRODUCTION],
        brand as [BRAND],
        model as [MODEL],
        color as [COLOR],
        size as [SIZE],
        quantity as [QUANTITY],
        username as [USERNAME],
        description as [DESCRIPTION],
        scan_no as [SCAN NO]
      FROM [${dbName}].[dbo].[${tableName}]
      WHERE date_time >= @start AND date_time <= @end
      ORDER BY date_time DESC
    `, { start: `${tanggal1} ${jam1}`, end: `${tanggal2} ${jam2}` });

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([]);

    XLSX.utils.sheet_add_aoa(ws, [
      [`HOURLY REPORT ${tipe.toUpperCase()} DATE ${tanggal1} to ${tanggal2} TIME ${jam1} to ${jam2}`],
      [`USERNAME: ${req.user.username}`],
      []
    ], { origin: 'A1' });

    XLSX.utils.sheet_add_json(ws, data, { origin: 'A4', skipHeader: false });

    ws['!cols'] = [
      { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 40 }, { wch: 32 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Hourly Report');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Hourly_Report.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;