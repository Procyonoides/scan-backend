const express = require('express');
const router = express.Router();
const { query, dbName } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const { getWarehouseStats } = require('../utils/warehouseStats');
const ExcelJS = require('exceljs');

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

router.get('/history', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await query(`SELECT TOP 10 original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, CONVERT(varchar, date_time, 120) as date_time, scan_no, username, description FROM [${dbName}].[dbo].[shipping] WHERE username = @username ORDER BY date_time DESC`, { username });
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch history', message: err.message });
  }
});

router.get('/today', verifyToken, async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 100;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    const countResult = await query(`SELECT COUNT(*) as total FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)`);
    const total = countResult.recordset[0].total;
    const result = await query(`SELECT CONVERT(varchar, date_time, 120) as date_time, original_barcode, model, color, size, quantity, username, scan_no FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE) ORDER BY date_time DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, { offset, limit: limitNum });
    res.json({ success: true, data: result.recordset, pagination: { total, page: pageNum, limit: limitNum } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch today shipping', message: err.message });
  }
});

router.post('/scan', verifyToken, async (req, res) => {
  try {
    const { barcode } = req.body;
    const username = req.user.username;
    const position = req.user.position;
    if (!barcode || barcode.trim() === '') return res.status(400).json({ success: false, message: 'Barcode required' });
    const now = new Date();
    const currentTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    if (currentTime >= 27000 && currentTime <= 27006) return res.status(503).json({ success: false, message: 'Maintenance' });
    if (position !== 'SHIPPING' && position !== 'IT') return res.status(403).json({ success: false, message: 'Invalid position' });
    const masterData = await query(`SELECT original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`, { barcode: barcode.trim() });
    if (masterData.recordset.length === 0) return res.status(404).json({ success: false, message: 'Barcode not found' });
    const data = masterData.recordset[0];
    const userData = await query(`SELECT description FROM [${dbName}].[dbo].[users] WHERE username = @username`, { username });
    const description = userData.recordset[0]?.description || '';
    const today = new Date().toISOString().slice(0, 10);
    const scanNoResult = await query(`SELECT ISNULL(MAX(scan_no), 0) as max_scan_no FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = @today`, { today });
    const scan_no = scanNoResult.recordset[0].max_scan_no + 1;
    await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock=stock-@quantity WHERE original_barcode=@barcode`, { quantity: data.quantity, barcode: barcode.trim() });
    await query(`INSERT INTO [${dbName}].[dbo].[shipping] (original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, date_time, scan_no, username, description) VALUES (@original_barcode, @brand, @color, @size, @four_digit, @unit, @quantity, @production, @model, @model_code, @item, GETDATE(), @scan_no, @username, @description)`, { ...data, scan_no, username, description });
    const io = req.app.get('io');
    if (io) {
      const stats = await getWarehouseStats(query, dbName);
      io.emit('dashboard:update', {
        type: 'SHIPPING',
        ...data,
        barcode: data.original_barcode,
        username,
        scan_no,
        timestamp: new Date().toISOString(),
        firstStock: stats.firstStock,
        warehouseStock: stats.warehouseStock,
        receivingCount: stats.receivingCount,
        receivingQty: stats.receivingQty,
        shippingCount: stats.shippingCount,
        shippingQty: stats.shippingQty,
        warehouseItems: stats.warehouseItems
      });
    }
    res.status(201).json({ success: true, message: 'Success', data: { scan_no, original_barcode: data.original_barcode, model: data.model, color: data.color, size: data.size, quantity: data.quantity, date_time: new Date().toISOString(), username } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error', details: err.message });
  }
});

router.post('/batch-scan', verifyToken, async (req, res) => {
  try {
    const { barcode, batchCount } = req.body;
    const username = req.user.username;
    const position = req.user.position;
    if (!barcode || barcode.trim() === '') return res.status(400).json({ success: false, message: 'Barcode required' });
    const masterData = await query(`SELECT original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, stock FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`, { barcode: barcode.trim() });
    if (masterData.recordset.length === 0) return res.status(404).json({ success: false, message: 'Barcode not found' });
    const data = masterData.recordset[0];
    const totalQuantity = data.quantity * batchCount;
    if (data.stock < totalQuantity) return res.status(400).json({ success: false, message: 'Insufficient stock' });
    const userData = await query(`SELECT description FROM [${dbName}].[dbo].[users] WHERE username = @username`, { username });
    const description = userData.recordset[0]?.description || '';
    const today = new Date().toISOString().slice(0, 10);
    const scanNoResult = await query(`SELECT ISNULL(MAX(scan_no), 0) as max_scan_no FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = @today`, { today });
    let scan_no = scanNoResult.recordset[0].max_scan_no + 1;
    await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock=stock-@quantity WHERE original_barcode=@barcode`, { quantity: totalQuantity, barcode: barcode.trim() });
    let valuesParts = [];
    for (let i = 0; i < batchCount; i++) {
      valuesParts.push(`('${data.original_barcode}', '${data.brand}', '${data.color}', '${data.size}', '${data.four_digit || ''}', '${data.unit}', ${data.quantity}, '${data.production}', '${data.model}', '${data.model_code || ''}', '${data.item}', GETDATE(), ${scan_no + i}, '${username}', '${description}')`);
    }
    await query(`INSERT INTO [${dbName}].[dbo].[shipping] (original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, date_time, scan_no, username, description) VALUES ${valuesParts.join(',')}`);
    const io = req.app.get('io');
    if (io) {
      const stats = await getWarehouseStats(query, dbName);
      io.emit('dashboard:update', {
        type: 'SHIPPING_BATCH',
        ...data,
        barcode: data.original_barcode,
        batchCount,
        totalQuantity,
        username,
        timestamp: new Date().toISOString(),
        firstStock: stats.firstStock,
        warehouseStock: stats.warehouseStock,
        receivingCount: stats.receivingCount,
        receivingQty: stats.receivingQty,
        shippingCount: stats.shippingCount,
        shippingQty: stats.shippingQty,
        warehouseItems: stats.warehouseItems
      });
    }
    res.status(201).json({ success: true, message: 'Batch success' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error', details: err.message });
  }
});

router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, description } = req.body;
    const { id } = req.params;
    const parts = id.split('|');
    if (parts.length !== 3) return res.status(400).json({ success: false, error: 'Invalid ID' });
    await query(`UPDATE [${dbName}].[dbo].[shipping] SET original_barcode=@original_barcode, brand=@brand, color=@color, size=@size, four_digit=@four_digit, unit=@unit, quantity=@quantity, production=@production, model=@model, model_code=@model_code, item=@item, description=@description WHERE date_time=@date_time AND scan_no=@scan_no AND username=@username`, { original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, description, date_time: parts[0], scan_no: parts[1], username: parts[2] });
    res.json({ success: true, message: 'Updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error', details: err.message });
  }
});

router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const parts = id.split('|');
    if (parts.length !== 3) return res.status(400).json({ success: false, error: 'Invalid ID' });
    const scanData = await query(`SELECT quantity, original_barcode FROM [${dbName}].[dbo].[shipping] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@username`, { date_time: parts[0], scan_no: parts[1], username: parts[2] });
    if (scanData.recordset.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
    await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock=stock+@quantity WHERE original_barcode=@barcode`, { quantity: scanData.recordset[0].quantity, barcode: scanData.recordset[0].original_barcode });
    await query(`DELETE FROM [${dbName}].[dbo].[shipping] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@username`, { date_time: parts[0], scan_no: parts[1], username: parts[2] });
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error', details: err.message });
  }
});

router.post('/batch-delete', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { ids } = req.body;
    let successCount = 0;
    for (const id of ids) {
      const parts = id.split('|');
      if (parts.length !== 3) continue;
      const scanData = await query(`SELECT quantity, original_barcode FROM [${dbName}].[dbo].[shipping] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@username`, { date_time: parts[0], scan_no: parts[1], username: parts[2] });
      if (scanData.recordset.length > 0) {
        await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock=stock+@quantity WHERE original_barcode=@barcode`, { quantity: scanData.recordset[0].quantity, barcode: scanData.recordset[0].original_barcode });
        await query(`DELETE FROM [${dbName}].[dbo].[shipping] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@username`, { date_time: parts[0], scan_no: parts[1], username: parts[2] });
        successCount++;
      }
    }
    res.json({ success: true, message: `${successCount} deleted` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error', details: err.message });
  }
});

router.get('/all', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const result = await query(`SELECT *, CONVERT(varchar, date_time, 120) as date_time FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE) ORDER BY date_time DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, { offset, limit });
    const totalResult = await query(`SELECT COUNT(*) as total FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)`);
    res.json({ success: true, data: result.recordset, pagination: { total: totalResult.recordset[0].total, page, limit } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error', details: err.message });
  }
});

/**
 * GET /api/shipping/print-detail
 * ✅ Export today's shipping scans to Excel (Detail Report)
 */
router.get('/print-detail', verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toLocaleTimeString('id-ID');
    const username = req.user.username;

    const result = await query(`
      SELECT
        scan_no as [SCAN NO],
        CONVERT(varchar, date_time, 120) as [DATE/TIME],
        production as [PRODUCTION],
        brand as [BRAND],
        model as [MODEL],
        item as [ITEM],
        color as [COLOR],
        size as [SIZE],
        username as [USERNAME],
        description as [DESCRIPTION],
        quantity as [QUANTITY]
      FROM [${dbName}].[dbo].[shipping]
      WHERE CAST(date_time AS DATE) = @today
      ORDER BY date_time DESC
    `, { today });

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const subtotal = data.reduce((sum, item) => sum + (parseInt(item.QUANTITY) || 0), 0);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Shipping Detail');
    const columns = ['SCAN NO', 'DATE/TIME', 'PRODUCTION', 'BRAND', 'MODEL', 'ITEM', 'COLOR', 'SIZE', 'USERNAME', 'DESCRIPTION', 'QUANTITY'];
    ws.columns = [
      { width: 12 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 35 },
      { width: 20 }, { width: 25 }, { width: 10 }, { width: 15 }, { width: 20 }, { width: 10 }
    ];

    styleTitle(ws, `DETAIL SHIPPING DATE ${today} TIME ${nowTime}`, columns.length);
    ws.getCell(2, 1).value = `USERNAME: ${username}`;
    styleHeaderRow(ws, 3, columns);

    data.forEach((row, idx) => {
      const r = 4 + idx;
      columns.forEach((col, i) => styleDataCell(ws.getCell(r, i + 1), row[col], col === 'SCAN NO' || col === 'SIZE' || col === 'QUANTITY'));
    });

    const footerRow = 4 + data.length;
    styleDataCell(ws.getCell(footerRow, 1), 'GRAND TOTAL', false);
    ws.getCell(footerRow, 1).font = { bold: true };
    const totalCell = ws.getCell(footerRow, columns.length);
    styleDataCell(totalCell, subtotal, true);
    totalCell.font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Shipping_Detail_${today}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/shipping/print-summary
 * ✅ Export today's shipping summary (Matrix/Pivot) to Excel
 * Matches HSKPro: excel_summary.php
 */
router.get('/print-summary', verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toLocaleTimeString('id-ID');
    const username = req.user.username;

    const sizes = ['10K', '10TK', '11K', '11TK', '12K', '12TK', '13K', '13TK', '1', '1T', '2', '2T', '3', '3T', '4', '4T', '5', '5T', '6', '6T', '7', '7T', '8', '8T', '9', '9T', '10', '10T', '11', '11T', '12', '12T', '13', '13T', '14', '14T', '15', '15T', '16', '16T', '17', '17T', '18', '18T'];
    let pivotSelect = sizes.map((s, i) => `SUM(CASE WHEN size = '${s}' THEN quantity ELSE 0 END) AS [size_${i + 1}]`).join(',\n        ');

    const sql = `
      SELECT 'X' AS model, 'X' AS color, 'GRAND TOTAL' AS description, ${pivotSelect}, SUM(quantity) AS TOTAL 
      FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = @today
      UNION ALL 
      SELECT model, color, description, ${pivotSelect}, SUM(quantity) AS TOTAL 
      FROM [${dbName}].[dbo].[shipping] WHERE CAST(date_time AS DATE) = @today
      GROUP BY model, color, description
      ORDER BY model ASC, color ASC, description ASC
    `;

    const result = await query(sql, { today });
    const rawData = result.recordset;

    if (rawData.length <= 1 && rawData[0].TOTAL === null) return res.status(404).json({ success: false, error: 'No data' });

    const formattedRows = rawData.map(row => {
      const rowArr = [row.model, row.color, row.description];
      sizes.forEach((s, i) => rowArr.push(row[`size_${i + 1}`] || ''));
      rowArr.push(row.TOTAL);
      return rowArr;
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Shipping Summary');
    const columns = ['MODEL', 'COLOR', 'DESCRIPTION', ...sizes, 'TOTAL'];
    ws.columns = [
      { width: 40 }, { width: 32 }, { width: 25 },
      ...sizes.map(() => ({ width: 7 })),
      { width: 10 }
    ];

    styleTitle(ws, `SUMMARY SHIPPING DATE ${today} TIME ${nowTime}`, columns.length);
    ws.getCell(2, 1).value = `USERNAME: ${username}`;
    styleHeaderRow(ws, 3, columns);

    formattedRows.forEach((rowArr, idx) => {
      const r = 4 + idx;
      rowArr.forEach((val, i) => styleDataCell(ws.getCell(r, i + 1), val, i >= 3));
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Shipping_Summary_${today}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/move', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const cutoffDate = `${today} 07:30:00`;
    const checkData = await query(`SELECT COUNT(*) as count FROM [${dbName}].[dbo].[shipping] WHERE date_time < @cutoffDate`, { cutoffDate });
    const dataCount = checkData.recordset[0].count;
    if (dataCount === 0) return res.json({ success: true, message: 'No data to move' });
    await query(`INSERT INTO [${dbName}].[dbo].[data_shipping] SELECT * FROM [${dbName}].[dbo].[shipping] WHERE date_time < @cutoffDate`, { cutoffDate });
    await query(`DELETE FROM [${dbName}].[dbo].[shipping] WHERE date_time < @cutoffDate`, { cutoffDate });
    res.json({ success: true, message: `${dataCount} moved` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

module.exports = router;