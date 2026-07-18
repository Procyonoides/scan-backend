const express = require('express');
const router = express.Router();
const { query, dbName } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const XLSX = require('xlsx');

router.get('/history', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const result = await query(`
      SELECT TOP 10
        original_barcode, brand, color, size, four_digit, unit, quantity,
        production, model, model_code, item,
        CONVERT(varchar, date_time, 120) as date_time,
        scan_no, username, description
      FROM [${dbName}].[dbo].[receiving]
      WHERE username = @username
      ORDER BY date_time DESC
    `, { username });
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch receiving history', message: err.message });
  }
});

router.get('/today', verifyToken, async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 100;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    const countResult = await query(`SELECT COUNT(*) as total FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)`);
    const total = countResult.recordset[0].total;
    const result = await query(`
      SELECT CONVERT(varchar, date_time, 120) as date_time, original_barcode, model, color, size, quantity, username, scan_no
      FROM [${dbName}].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY date_time DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { offset, limit: limitNum });
    res.json({ success: true, data: result.recordset, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch today receiving', message: err.message });
  }
});

router.post('/scan', verifyToken, async (req, res) => {
  try {
    const { barcode } = req.body;
    const username = req.user.username;
    const position = req.user.position;
    if (!barcode || barcode.trim() === '') return res.status(400).json({ success: false, message: 'Barcode harus diisi' });
    const now = new Date();
    const currentTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    if (currentTime >= 27000 && currentTime <= 27006) return res.status(503).json({ success: false, message: 'Harap tidak melakukan transaksi, sedang proses perpindahan data' });
    if (position !== 'RECEIVING' && position !== 'IT') return res.status(403).json({ success: false, message: 'Username tidak sesuai' });
    const masterData = await query(`SELECT original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`, { barcode: barcode.trim() });
    if (masterData.recordset.length === 0) return res.status(404).json({ success: false, message: 'Barcode tidak ditemukan' });
    const data = masterData.recordset[0];
    const userData = await query(`SELECT description FROM [${dbName}].[dbo].[users] WHERE username = @username`, { username });
    const description = userData.recordset[0]?.description || '';
    const today = new Date().toISOString().slice(0, 10);
    const scanNoResult = await query(`SELECT ISNULL(MAX(scan_no), 0) as max_scan_no FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = @today`, { today });
    const scan_no = scanNoResult.recordset[0].max_scan_no + 1;
    await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock = stock + @quantity WHERE original_barcode = @barcode`, { quantity: data.quantity, barcode: barcode.trim() });
    await query(`INSERT INTO [${dbName}].[dbo].[receiving] (original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, date_time, scan_no, username, description) VALUES (@original_barcode, @brand, @color, @size, @four_digit, @unit, @quantity, @production, @model, @model_code, @item, GETDATE(), @scan_no, @username, @description)`, { ...data, scan_no, username, description });
    const io = req.app.get('io');
    if (io) io.emit('dashboard:update', { type: 'RECEIVING', ...data, username, scan_no, timestamp: new Date().toISOString() });
    res.status(201).json({ success: true, message: 'Data Berhasil Diinputkan', data: { scan_no, original_barcode: data.original_barcode, model: data.model, color: data.color, size: data.size, quantity: data.quantity, date_time: new Date().toISOString(), username } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal melakukan scan', details: err.message });
  }
});

router.post('/batch-scan', verifyToken, async (req, res) => {
  try {
    const { barcode, batchCount } = req.body;
    const username = req.user.username;
    const position = req.user.position;
    if (!barcode || barcode.trim() === '') return res.status(400).json({ success: false, error: 'BARCODE_REQUIRED', message: 'Barcode harus diisi' });
    if (!batchCount || batchCount < 1 || batchCount > 1000) return res.status(400).json({ success: false, error: 'INVALID_BATCH_COUNT', message: 'Batch count harus 1-1000' });
    const now = new Date();
    const currentTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    if (currentTime >= 27000 && currentTime <= 27006) return res.status(503).json({ success: false, error: 'SYSTEM_MAINTENANCE', message: 'Harap tidak melakukan transaksi, sedang proses perpindahan data' });
    if (position !== 'RECEIVING' && position !== 'IT') return res.status(403).json({ success: false, error: 'INVALID_POSITION', message: 'Username tidak sesuai - Harus posisi RECEIVING atau IT' });
    const masterData = await query(`SELECT original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`, { barcode: barcode.trim() });
    if (masterData.recordset.length === 0) return res.status(404).json({ success: false, error: 'BARCODE_NOT_FOUND', message: 'Data Gagal Diinputkan - Barcode tidak ditemukan di master database' });
    const data = masterData.recordset[0];
    const userData = await query(`SELECT description FROM [${dbName}].[dbo].[users] WHERE username = @username`, { username });
    const description = userData.recordset[0]?.description || '';
    const today = new Date().toISOString().slice(0, 10);
    const scanNoResult = await query(`SELECT ISNULL(MAX(scan_no), 0) as max_scan_no FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = @today`, { today });
    let scan_no = scanNoResult.recordset[0].max_scan_no + 1;
    const totalQuantity = data.quantity * batchCount;
    await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock = stock + @quantity WHERE original_barcode = @barcode`, { quantity: totalQuantity, barcode: barcode.trim() });
    let valuesParts = [];
    for (let i = 0; i < batchCount; i++) {
      valuesParts.push(`('${data.original_barcode}', '${data.brand}', '${data.color}', '${data.size}', '${data.four_digit || ''}', '${data.unit}', ${data.quantity}, '${data.production}', '${data.model}', '${data.model_code || ''}', '${data.item}', GETDATE(), ${scan_no + i}, '${username}', '${description}')`);
    }
    await query(`INSERT INTO [${dbName}].[dbo].[receiving] (original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, date_time, scan_no, username, description) VALUES ${valuesParts.join(',')}`);
    const io = req.app.get('io');
    if (io) io.emit('dashboard:update', { type: 'RECEIVING_BATCH', barcode: data.original_barcode, batchCount, totalQuantity, scanNoRange: `${scan_no}-${scan_no + batchCount - 1}`, username, timestamp: new Date().toISOString() });
    res.status(201).json({ success: true, message: `Batch scan berhasil: ${batchCount} data diinputkan`, data: { batchCount, scanNoRange: `${scan_no}-${scan_no + batchCount - 1}`, original_barcode: data.original_barcode, model: data.model, color: data.color, size: data.size, quantity: data.quantity, totalQuantity, date_time: new Date().toISOString(), username } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'BATCH_SCAN_FAILED', message: 'Gagal melakukan batch scan', details: err.message });
  }
});

router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, description } = req.body;
    const { id } = req.params;
    const username = req.user.username;
    const parts = id.split('|');
    if (parts.length !== 3) return res.status(400).json({ success: false, error: 'Invalid scan ID format' });
    const [date_time, scan_no, original_username] = parts;
    if (req.user.position !== 'IT' && username !== original_username) return res.status(403).json({ success: false, error: 'Unauthorized' });
    await query(`UPDATE [${dbName}].[dbo].[receiving] SET original_barcode=@original_barcode, brand=@brand, color=@color, size=@size, four_digit=@four_digit, unit=@unit, quantity=@quantity, production=@production, model=@model, model_code=@model_code, item=@item, description=@description WHERE date_time=@date_time AND scan_no=@scan_no AND username=@original_username`, { original_barcode, brand: brand || '', color: color || '', size: size || '', four_digit: four_digit || '', unit: unit || '', quantity: parseInt(quantity) || 0, production: production || '', model: model || '', model_code: model_code || '', item: item || '', description: description || '', date_time, scan_no: parseInt(scan_no), original_username });
    res.json({ success: true, message: 'Data Berhasil Diperbarui' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to edit receiving scan', message: err.message });
  }
});

router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const parts = id.split('|');
    if (parts.length !== 3) return res.status(400).json({ success: false, error: 'Invalid scan ID format' });
    const [date_time, scan_no, original_username] = parts;
    if (req.user.position !== 'IT' && username !== original_username) return res.status(403).json({ success: false, error: 'Unauthorized' });
    const scanData = await query(`SELECT quantity, original_barcode FROM [${dbName}].[dbo].[receiving] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@original_username`, { date_time, scan_no: parseInt(scan_no), original_username });
    if (scanData.recordset.length === 0) return res.status(404).json({ success: false, error: 'Scan not found' });
    const { quantity, original_barcode: barcode } = scanData.recordset[0];
    await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock=stock-@quantity WHERE original_barcode=@barcode`, { quantity, barcode });
    await query(`DELETE FROM [${dbName}].[dbo].[receiving] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@original_username`, { date_time, scan_no: parseInt(scan_no), original_username });
    res.json({ success: true, message: 'Data Berhasil Dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete receiving scan', message: err.message });
  }
});

router.post('/batch-delete', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: 'Invalid input' });
    let successCount = 0;
    const failed = [];
    for (const id of ids) {
      try {
        const parts = id.split('|');
        if (parts.length !== 3) { failed.push({ id, reason: 'Invalid id format' }); continue; }
        const [date_time, scan_no, original_username] = parts;
        const scanData = await query(`SELECT original_barcode, quantity FROM [${dbName}].[dbo].[receiving] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@original_username`, { date_time, scan_no: parseInt(scan_no), original_username });
        if (scanData.recordset.length === 0) { failed.push({ id, reason: 'Scan not found' }); continue; }
        const { original_barcode, quantity } = scanData.recordset[0];
        await query(`UPDATE [${dbName}].[dbo].[master_database] SET stock=stock-@quantity WHERE original_barcode=@barcode`, { quantity, barcode: original_barcode });
        await query(`DELETE FROM [${dbName}].[dbo].[receiving] WHERE date_time=@date_time AND scan_no=@scan_no AND username=@original_username`, { date_time, scan_no: parseInt(scan_no), original_username });
        successCount++;
      } catch (err) {
        console.error(`❌ Batch delete failed for id ${id}:`, err.message);
        failed.push({ id, reason: err.message });
      }
    }
    res.json({ success: true, message: `Batch delete completed: ${successCount} scans deleted`, failedCount: failed.length, failed });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to batch delete', message: err.message });
  }
});

router.get('/all', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const offset = (page - 1) * limit;
    const username_filter = req.query.username || '';
    let whereClause = 'WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)';
    const listParams = { offset, limit };
    if (username_filter) {
      whereClause += ` AND username = @username_filter`;
      listParams.username_filter = username_filter;
    }
    const result = await query(`SELECT *, CONVERT(varchar, date_time, 120) as date_time FROM [${dbName}].[dbo].[receiving] ${whereClause} ORDER BY date_time DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`, listParams);
    const totalResult = await query(`SELECT COUNT(*) as total FROM [${dbName}].[dbo].[receiving] ${whereClause}`, username_filter ? { username_filter } : {});
    const total = totalResult.recordset[0].total;
    res.json({ success: true, data: result.recordset, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch receiving scans', message: err.message });
  }
});

/**
 * GET /api/receiving/print-detail
 * ✅ Export today's receiving detail to Excel
 * Matches HSKPro: excel_detail.php
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
      FROM [${dbName}].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = @today
      ORDER BY date_time DESC
    `, { today });

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const subtotal = data.reduce((sum, item) => sum + (parseInt(item.QUANTITY) || 0), 0);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([]);

    XLSX.utils.sheet_add_aoa(ws, [
      [`DETAIL RECEIVING DATE ${today} TIME ${nowTime}`],
      [`USERNAME: ${username}`],
      []
    ], { origin: 'A1' });

    XLSX.utils.sheet_add_json(ws, data, { origin: 'A4', skipHeader: false });

    XLSX.utils.sheet_add_aoa(ws, [
      ['GRAND TOTAL', null, null, null, null, null, null, null, null, null, subtotal]
    ], { origin: `A${data.length + 5}` });

    ws['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 35 },
      { wch: 20 }, { wch: 25 }, { wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 10 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Receiving Detail');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Receiving_Detail_${today}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/receiving/print-summary
 * ✅ Export today's receiving summary (Matrix/Pivot) to Excel
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
      FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = @today
      UNION ALL 
      SELECT model, color, description, ${pivotSelect}, SUM(quantity) AS TOTAL 
      FROM [${dbName}].[dbo].[receiving] WHERE CAST(date_time AS DATE) = @today
      GROUP BY model, color, description
      ORDER BY model ASC, color ASC, description ASC
    `;

    const result = await query(sql, { today });
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
      [`SUMMARY RECEIVING DATE ${today} TIME ${nowTime}`],
      [`USERNAME: ${username}`],
      []
    ], { origin: 'A1' });

    XLSX.utils.sheet_add_json(ws, formattedData, { origin: 'A4', skipHeader: false });

    // Precise widths based on HSKPro px
    ws['!cols'] = [
      { wch: 40 }, { wch: 32 }, { wch: 25 }, // Model, Color, Desc
      ...sizes.map(() => ({ wch: 7 })),      // Sizes
      { wch: 10 }                            // Total
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Receiving Summary');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Receiving_Summary_${today}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/move', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const cutoffDate = `${today} 07:30:00`;
    const checkData = await query(`SELECT COUNT(*) as count FROM [${dbName}].[dbo].[receiving] WHERE date_time < @cutoffDate`, { cutoffDate });
    const dataCount = checkData.recordset[0].count;
    if (dataCount === 0) return res.json({ success: true, message: 'Tidak ada data untuk dipindahkan', count: 0 });
    await query(`INSERT INTO [${dbName}].[dbo].[data_receiving] SELECT * FROM [${dbName}].[dbo].[receiving] WHERE date_time < @cutoffDate`, { cutoffDate });
    await query(`DELETE FROM [${dbName}].[dbo].[receiving] WHERE date_time < @cutoffDate`, { cutoffDate });
    res.json({ success: true, message: `${dataCount} data berhasil dipindahkan to history`, count: dataCount });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to move data', message: err.message });
  }
});

module.exports = router;