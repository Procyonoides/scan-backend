const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { query, dbName } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
const THIN_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

function styleTitle(sheet, text, colCount) {
  sheet.mergeCells(1, 1, 1, colCount);
  const cell = sheet.getCell(1, 1);
  cell.value = text;
  cell.font = { name: 'Calibri', size: 14, bold: true };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

function styleHeaderRow(sheet, rowNum, headers) {
  headers.forEach((h, i) => {
    const cell = sheet.getCell(rowNum, i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });
}

function styleDataCell(cell, value, center) {
  cell.value = value;
  cell.font = { name: 'Calibri', size: 12 };
  cell.border = THIN_BORDER;
  if (center) cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

/**
 * GET /api/reports/daily
 */
router.get('/daily', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;

    if (!tipe) {
      return res.status(400).json({ success: false, error: 'Transaction type (tipe) is required' });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    const liveTableName = tipe === 'receiving' ? 'receiving' : 'shipping';
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
      FROM (SELECT * FROM [${dbName}].[dbo].[${tableName}] UNION ALL SELECT * FROM [${dbName}].[dbo].[${liveTableName}]) AS combined_t
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
 */
router.get('/monthly', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;

    if (!tipe) {
      return res.status(400).json({ success: false, error: 'Transaction type (tipe) is required' });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    const liveTableName = tipe === 'receiving' ? 'receiving' : 'shipping';
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
      FROM (SELECT * FROM [${dbName}].[dbo].[${tableName}] UNION ALL SELECT * FROM [${dbName}].[dbo].[${liveTableName}]) AS combined_t
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
 * Format mengikuti application/views/excel_detail_daily.php di sistem lama
 */
router.get('/daily/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;
    if (!tipe) return res.status(400).json({ success: false, error: 'Type required' });

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    const liveTableName = tipe === 'receiving' ? 'receiving' : 'shipping';
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
        scan_no,
        CONVERT(varchar, date_time, 120) as date_time,
        production,
        brand,
        model,
        item,
        color,
        size,
        username,
        description,
        quantity
      FROM (SELECT * FROM [${dbName}].[dbo].[${tableName}] UNION ALL SELECT * FROM [${dbName}].[dbo].[${liveTableName}]) AS combined_t
      ${whereClause}
      ORDER BY date_time DESC
    `, params);

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const grandTotal = data.reduce((sum, row) => sum + (parseInt(row.quantity) || 0), 0);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Daily Report');

    const headers = ['SCAN NO', 'DATE/TIME', 'PRODUCTION', 'BRAND', 'MODEL', 'ITEM', 'COLOR', 'SIZE', 'USERNAME', 'DESCRIPTION', 'QUANTITY'];
    styleTitle(sheet, `DETAIL DAILY ${tipe.toUpperCase()} ${tanggal1} TO ${tanggal2}`, headers.length);
    styleHeaderRow(sheet, 3, headers);

    data.forEach((row, idx) => {
      const r = 4 + idx;
      styleDataCell(sheet.getCell(r, 1), row.scan_no, true);
      styleDataCell(sheet.getCell(r, 2), row.date_time, false);
      styleDataCell(sheet.getCell(r, 3), row.production, false);
      styleDataCell(sheet.getCell(r, 4), row.brand, false);
      styleDataCell(sheet.getCell(r, 5), row.model, false);
      styleDataCell(sheet.getCell(r, 6), row.item, false);
      styleDataCell(sheet.getCell(r, 7), row.color, false);
      styleDataCell(sheet.getCell(r, 8), row.size, true);
      styleDataCell(sheet.getCell(r, 9), row.username, false);
      styleDataCell(sheet.getCell(r, 10), row.description, false);
      styleDataCell(sheet.getCell(r, 11), row.quantity, true);
    });

    const footerRow = 4 + data.length;
    sheet.mergeCells(footerRow, 1, footerRow, 10);
    const labelCell = sheet.getCell(footerRow, 1);
    labelCell.value = 'GRAND TOTAL';
    labelCell.font = { name: 'Calibri', size: 12, bold: true };
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    labelCell.border = THIN_BORDER;

    const totalCell = sheet.getCell(footerRow, 11);
    totalCell.value = grandTotal;
    totalCell.font = { name: 'Calibri', size: 12, bold: true };
    totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totalCell.border = THIN_BORDER;

    sheet.columns = [
      { width: 12 }, { width: 18 }, { width: 15 }, { width: 15 }, { width: 38 },
      { width: 18 }, { width: 30 }, { width: 8 }, { width: 18 }, { width: 18 }, { width: 12 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Detail_Daily_${tipe.toUpperCase()}_${tanggal1}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/monthly/export
 * Format mengikuti application/views/excel_detail_monthly.php di sistem lama
 */
router.get('/monthly/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, model, color, size, user, tanggal1, tanggal2 } = req.query;
    if (!tipe) return res.status(400).json({ success: false, error: 'Type required' });

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    const liveTableName = tipe === 'receiving' ? 'receiving' : 'shipping';
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
        production,
        brand,
        model,
        item,
        color,
        size,
        description,
        SUM(quantity) as total
      FROM (SELECT * FROM [${dbName}].[dbo].[${tableName}] UNION ALL SELECT * FROM [${dbName}].[dbo].[${liveTableName}]) AS combined_t
      ${whereClause}
      GROUP BY production, brand, model, item, color, size, description
      ORDER BY model, color, size
    `, params);

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const grandTotal = data.reduce((sum, row) => sum + (parseInt(row.total) || 0), 0);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Monthly Report');

    const headers = ['NO', 'PRODUCTION', 'BRAND', 'MODEL', 'ITEM', 'COLOR', 'SIZE', 'DESCRIPTION', 'TOTAL'];
    styleTitle(sheet, `DETAIL MONTHLY ${tipe.toUpperCase()} ${tanggal1} TO ${tanggal2}`, headers.length);
    styleHeaderRow(sheet, 3, headers);

    data.forEach((row, idx) => {
      const r = 4 + idx;
      styleDataCell(sheet.getCell(r, 1), idx + 1, true);
      styleDataCell(sheet.getCell(r, 2), row.production, false);
      styleDataCell(sheet.getCell(r, 3), row.brand, false);
      styleDataCell(sheet.getCell(r, 4), row.model, false);
      styleDataCell(sheet.getCell(r, 5), row.item, false);
      styleDataCell(sheet.getCell(r, 6), row.color, false);
      styleDataCell(sheet.getCell(r, 7), row.size, true);
      styleDataCell(sheet.getCell(r, 8), row.description, false);
      styleDataCell(sheet.getCell(r, 9), row.total, true);
    });

    const footerRow = 4 + data.length;
    sheet.mergeCells(footerRow, 1, footerRow, 8);
    const labelCell = sheet.getCell(footerRow, 1);
    labelCell.value = 'GRAND TOTAL';
    labelCell.font = { name: 'Calibri', size: 12, bold: true };
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    labelCell.border = THIN_BORDER;

    const totalCell = sheet.getCell(footerRow, 9);
    totalCell.value = grandTotal;
    totalCell.font = { name: 'Calibri', size: 12, bold: true };
    totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
    totalCell.border = THIN_BORDER;

    sheet.columns = [
      { width: 6 }, { width: 15 }, { width: 15 }, { width: 38 }, { width: 18 },
      { width: 30 }, { width: 8 }, { width: 18 }, { width: 10 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Detail_Monthly_${tipe.toUpperCase()}_${tanggal1}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/summary/export
 * Dipakai bareng oleh Daily Report & Monthly Report — bedanya cuma
 * query param `periode` ('daily' atau 'monthly') buat judulnya.
 * Format mengikuti application/views/excel_summary_daily.php /
 * excel_summary_monthly.php di sistem lama.
 */
router.get('/summary/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, tanggal1, tanggal2, periode } = req.query;

    if (!tipe) return res.status(400).json({ success: false, error: 'Type required' });

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    const liveTableName = tipe === 'receiving' ? 'receiving' : 'shipping';
    let params = {};
    let whereClause = '';

    if (tanggal1 && tanggal2) {
      whereClause = 'WHERE date_time >= @start_date AND date_time <= @end_date';
      params.start_date = `${tanggal1} 07:30:00`;
      params.end_date = `${tanggal2} 07:29:59`;
    }

    const todayDate = new Date().toISOString().split('T')[0];
    const periodeLabel = (periode || 'MONTHLY').toUpperCase();

    const sizes = ['10K', '10TK', '11K', '11TK', '12K', '12TK', '13K', '13TK', '1', '1T', '2', '2T', '3', '3T', '4', '4T', '5', '5T', '6', '6T', '7', '7T', '8', '8T', '9', '9T', '10', '10T', '11', '11T', '12', '12T', '13', '13T', '14', '14T', '15', '15T', '16', '16T', '17', '17T', '18', '18T'];
    let pivotSelect = sizes.map((s, i) => `SUM(CASE WHEN size = '${s}' THEN quantity ELSE 0 END) AS [size_${i + 1}]`).join(', ');

    const sql = `
      SELECT 'X' AS model, 'X' AS color, 'GRAND TOTAL' AS description, ${pivotSelect}, SUM(quantity) AS TOTAL 
      FROM (SELECT * FROM [${dbName}].[dbo].[${tableName}] UNION ALL SELECT * FROM [${dbName}].[dbo].[${liveTableName}]) AS combined_t ${whereClause}
      UNION ALL
      SELECT model, color, description, ${pivotSelect}, SUM(quantity) AS TOTAL 
      FROM (SELECT * FROM [${dbName}].[dbo].[${tableName}] UNION ALL SELECT * FROM [${dbName}].[dbo].[${liveTableName}]) AS combined_t ${whereClause}
      GROUP BY model, color, description 
      ORDER BY model ASC, color ASC, description ASC
    `;

    const result = await query(sql, params);
    const rawData = result.recordset;

    if (rawData.length <= 1 && rawData[0].TOTAL === null) return res.status(404).json({ success: false, error: 'No data' });

    const headers = ['MODEL', 'COLOR', 'DESCRIPTION', ...sizes, 'TOTAL'];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Summary Matrix');

    styleTitle(sheet, `SUMMARY ${periodeLabel} ${tipe.toUpperCase()} ${tanggal1} TO ${tanggal2}`, headers.length);

    const dateCell = sheet.getCell(2, 1);
    dateCell.value = `DATE: ${todayDate}`;
    dateCell.font = { name: 'Calibri', size: 12, bold: true };

    styleHeaderRow(sheet, 4, headers);

    rawData.forEach((row, idx) => {
      const r = 5 + idx;
      styleDataCell(sheet.getCell(r, 1), row.model, false);
      styleDataCell(sheet.getCell(r, 2), row.color, false);
      styleDataCell(sheet.getCell(r, 3), row.description, false);
      sizes.forEach((s, i) => {
        const val = row[`size_${i + 1}`];
        styleDataCell(sheet.getCell(r, 4 + i), val || null, false);
      });
      styleDataCell(sheet.getCell(r, 4 + sizes.length), row.TOTAL, false);
    });

    sheet.columns = [
      { width: 40 }, { width: 32 }, { width: 25 },
      ...sizes.map(() => ({ width: 7 })),
      { width: 10 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Summary_${tipe.toUpperCase()}_${tanggal1}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/hourly/export
 * ⚠️ BELUM disesuaikan — versi lama (hskpro) formatnya beda total (pivot
 * per jam, bukan list transaksi). Belum diubah karena belum diminta.
 */
router.get('/hourly/export', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { tipe, tanggal1, tanggal2 } = req.query;
    if (!tipe || !tanggal1 || !tanggal2) {
      return res.status(400).json({ success: false, error: 'tipe, tanggal1 and tanggal2 are required' });
    }

    const tableName = tipe === 'receiving' ? 'data_receiving' : 'data_shipping';
    const liveTableName = tipe === 'receiving' ? 'receiving' : 'shipping';

    // 24 shift-hour buckets: 07:00 on tanggal1 through 06:00-06:59 on tanggal2
    const hourLabels = [];
    const hourCaseParts = [];
    for (let i = 0; i < 24; i++) {
      const hour = (7 + i) % 24;
      const day = (7 + i) < 24 ? tanggal1 : tanggal2;
      const hourStr = String(hour).padStart(2, '0');
      hourLabels.push(`HOUR ${hourStr}`);
      hourCaseParts.push(
        `SUM(CASE WHEN date_time BETWEEN '${day} ${hourStr}:00:00' AND '${day} ${hourStr}:59:59' THEN quantity ELSE 0 END) as [HOUR ${hourStr}]`
      );
    }

    const result = await query(`
      SELECT item, ${hourCaseParts.join(', ')}, SUM(quantity) as TOTAL
      FROM (SELECT * FROM [${dbName}].[dbo].[${tableName}] WHERE date_time BETWEEN @start AND @end
            UNION ALL
            SELECT * FROM [${dbName}].[dbo].[${liveTableName}] WHERE date_time BETWEEN @start AND @end) AS combined_t
      WHERE production = 'PT HSK REMBANG'
      GROUP BY item
      ORDER BY item ASC
    `, { start: `${tanggal1} 07:00:00`, end: `${tanggal2} 06:59:59` });

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    // Grand total row, summed across all departments/items
    const grandTotalRow = { item: 'GRAND TOTAL' };
    hourLabels.forEach(h => { grandTotalRow[h] = data.reduce((sum, r) => sum + (parseInt(r[h]) || 0), 0); });
    grandTotalRow.TOTAL = data.reduce((sum, r) => sum + (parseInt(r.TOTAL) || 0), 0);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hourly Report');

    const columns = ['ITEM', ...hourLabels, 'TOTAL'];
    ws.columns = [{ width: 18 }, ...hourLabels.map(() => ({ width: 10 })), { width: 12 }];

    styleTitle(ws, `HOURLY ${tipe.toUpperCase()} DATE ${tanggal1} to ${tanggal2}`, columns.length);
    styleHeaderRow(ws, 3, columns);

    data.forEach((row, idx) => {
      const r = 4 + idx;
      styleDataCell(ws.getCell(r, 1), row.item, false);
      hourLabels.forEach((h, i) => styleDataCell(ws.getCell(r, i + 2), row[h] || 0, true));
      styleDataCell(ws.getCell(r, columns.length), row.TOTAL, true);
    });

    const footerRow = 4 + data.length;
    styleDataCell(ws.getCell(footerRow, 1), 'GRAND TOTAL', false);
    ws.getCell(footerRow, 1).font = { bold: true };
    hourLabels.forEach((h, i) => {
      const cell = ws.getCell(footerRow, i + 2);
      styleDataCell(cell, grandTotalRow[h], true);
      cell.font = { bold: true };
    });
    const totalCell = ws.getCell(footerRow, columns.length);
    styleDataCell(totalCell, grandTotalRow.TOTAL, true);
    totalCell.font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Hourly_${tipe.toUpperCase()}_${tanggal1}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;