const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const XLSX = require('xlsx');

/**
 * GET /api/receiving/history
 * ✅ Get last 10 receiving records untuk current user
 */
router.get('/history', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    
    console.log('📋 Fetching receiving history for:', username);

    const result = await query(`
      SELECT TOP 10
        original_barcode,
        brand,
        color,
        size,
        four_digit,
        unit,
        quantity,
        production,
        model,
        model_code,
        item,
        CONVERT(varchar, date_time, 120) as date_time,
        scan_no,
        username,
        description
      FROM [Backup_hskpro].[dbo].[receiving]
      WHERE username = @username
      ORDER BY date_time DESC
    `, { username });

    console.log(`✅ Found ${result.recordset.length} receiving records`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (err) {
    console.error('❌ Get receiving history error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch receiving history',
      message: err.message 
    });
  }
});

/**
 * ✅ NEW: GET /api/receiving/today
 * Get ALL receiving scans for TODAY (like dashboard)
 * Supports pagination via query params
 */
router.get('/today', verifyToken, async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 100;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    console.log('📋 Fetching TODAY receiving scans...', { page: pageNum, limit: limitNum });

    // Get total count for today
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM [Backup_hskpro].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)
    `);
    const total = countResult.recordset[0].total;

    // Get paginated data
    const result = await query(`
      SELECT
        CONVERT(varchar, date_time, 120) as date_time,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        scan_no
      FROM [Backup_hskpro].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY date_time DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { offset, limit: limitNum });

    console.log(`✅ Found ${result.recordset.length} receiving scans (Page ${pageNum}, Total: ${total})`);

    res.json({
      success: true,
      data: result.recordset,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (err) {
    console.error('❌ Get today receiving error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch today receiving',
      message: err.message 
    });
  }
});

/**
 * POST /api/receiving/scan
 * ✅ Scan barcode untuk receiving
 */
router.post('/scan', verifyToken, async (req, res) => {
  try {
    const { barcode } = req.body;
    const username = req.user.username;
    const position = req.user.position;

    console.log('📷 Scan receiving:', { barcode, username, position });

    if (!barcode || barcode.trim() === '') {
      console.warn('❌ Barcode empty');
      return res.status(400).json({ 
        success: false,
        error: 'BARCODE_REQUIRED',
        message: 'Barcode harus diisi' 
      });
    }

    // 1. CHECK MAINTENANCE TIME
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const currentTime = hours * 3600 + minutes * 60 + seconds;
    const maintenanceStart = 7 * 3600 + 30 * 60 + 0;
    const maintenanceEnd = 7 * 3600 + 30 * 60 + 6;

    if (currentTime >= maintenanceStart && currentTime <= maintenanceEnd) {
      console.warn('⚠️ Maintenance time - Transaction blocked');
      return res.status(503).json({
        success: false,
        error: 'SYSTEM_MAINTENANCE',
        message: 'Harap tidak melakukan transaksi, sedang proses perpindahan data'
      });
    }

    // 2. VALIDASI POSITION
    if (position !== 'RECEIVING' && position !== 'IT') {
      console.warn(`❌ Invalid position: ${position}`);
      return res.status(403).json({
        success: false,
        error: 'INVALID_POSITION',
        message: 'Username tidak sesuai - Harus posisi RECEIVING atau IT'
      });
    }

    // 3. CARI BARCODE DI MASTER_DATABASE
    console.log('🔍 Searching barcode in master_database:', barcode);
    
    const masterData = await query(`
      SELECT 
        original_barcode,
        brand,
        color,
        size,
        four_digit,
        unit,
        quantity,
        production,
        model,
        model_code,
        item
      FROM [Backup_hskpro].[dbo].[master_database]
      WHERE original_barcode = @barcode
    `, { barcode: barcode.trim() });

    if (masterData.recordset.length === 0) {
      console.warn(`❌ Barcode not found: ${barcode}`);
      return res.status(404).json({
        success: false,
        error: 'BARCODE_NOT_FOUND',
        message: 'Data Gagal Diinputkan - Barcode tidak ditemukan di master database'
      });
    }

    const data = masterData.recordset[0];

    // 4. GET USER DESCRIPTION
    const userData = await query(
      'SELECT description FROM [Backup_hskpro].[dbo].[users] WHERE username = @username',
      { username }
    );
    const description = userData.recordset[0]?.description || '';

    // 5. GENERATE SCAN_NO
    const today = new Date().toISOString().slice(0, 10);
    const scanNoResult = await query(`
      SELECT ISNULL(MAX(scan_no), 0) as max_scan_no
      FROM [Backup_hskpro].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = @today
    `, { today });
    
    const scan_no = scanNoResult.recordset[0].max_scan_no + 1;

    // 6. UPDATE MASTER_DATABASE STOCK (ADD QUANTITY)
    await query(`
      UPDATE [Backup_hskpro].[dbo].[master_database]
      SET stock = stock + @quantity
      WHERE original_barcode = @barcode
    `, {
      quantity: data.quantity,
      barcode: barcode.trim()
    });

    console.log(`✅ Master database stock updated: +${data.quantity}`);

    // 6B. INSERT KE TABLE RECEIVING (log transaction)
    await query(`
      INSERT INTO [Backup_hskpro].[dbo].[receiving]
      (original_barcode, brand, color, size, four_digit, unit, quantity, 
       production, model, model_code, item, date_time, scan_no, username, description)
      VALUES 
      (@original_barcode, @brand, @color, @size, @four_digit, @unit, @quantity,
       @production, @model, @model_code, @item, GETDATE(), @scan_no, @username, @description)
    `, {
      original_barcode: data.original_barcode,
      brand: data.brand,
      color: data.color,
      size: data.size,
      four_digit: data.four_digit || '',
      unit: data.unit,
      quantity: data.quantity,
      production: data.production,
      model: data.model,
      model_code: data.model_code || '',
      item: data.item,
      scan_no,
      username,
      description
    });

    console.log(`✅ Scan receiving berhasil: ${barcode}, scan_no: ${scan_no}`);

    // 7. SOCKET.IO EMIT - BROADCAST UPDATE TO ALL CONNECTED CLIENTS
    const io = req.app.get('io');
    if (io) {
      // Get updated warehouse stats with quantities
      const statsResult = await query(`
        SELECT 
          ISNULL((SELECT SUM(stock) FROM [Backup_hskpro].[dbo].[master_database]), 0) as warehouse_stock,
          ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[receiving] 
                  WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_count,
          ISNULL((SELECT SUM(quantity) FROM [Backup_hskpro].[dbo].[receiving] 
                  WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_qty,
          ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[shipping] 
                  WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_count,
          ISNULL((SELECT SUM(quantity) FROM [Backup_hskpro].[dbo].[shipping] 
                  WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_qty
      `);
      
      const stats = statsResult.recordset[0] || {};
      
      // Get first_stock from yesterday's stok table
      const firstStockResult = await query(`
        SELECT TOP 1 ISNULL(stock_akhir, 0) as first_stock
        FROM [Backup_hskpro].[dbo].[stok]
        WHERE CAST(date AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
        ORDER BY date DESC
      `);
      
      const firstStock = firstStockResult.recordset.length > 0 ? firstStockResult.recordset[0].first_stock : stats.warehouse_stock;

      // Get updated warehouse items (for chart warehouse real-time update) - with DETAILED format
      const totalStock = await query(`
        SELECT ISNULL(SUM(stock), 0) as total FROM [Backup_hskpro].[dbo].[master_database]
      `);
      const totalWarehouseStock = totalStock.recordset[0]?.total || 0;

      const itemsResult = await query(`
        SELECT 
          item,
          ISNULL(SUM(stock), 0) as total,
          CASE 
            WHEN @totalStock = 0 THEN 0
            ELSE CAST(ISNULL(SUM(stock), 0) * 100.0 / @totalStock AS DECIMAL(5, 2))
          END as status
        FROM [Backup_hskpro].[dbo].[master_database]
        GROUP BY item
        ORDER BY total DESC
      `, { totalStock: totalWarehouseStock });

      const warehouseItems = itemsResult.recordset || [];

      console.log('📦 Warehouse items fetched:', warehouseItems.length, 'items');
      console.log('📦 Total warehouse stock:', totalWarehouseStock);
      warehouseItems.forEach(item => {
        console.log(`  - ${item.item}: ${item.total} unit (${item.status}%)`);
      });

      // Emit comprehensive update event
      io.emit('dashboard:update', {
        type: 'RECEIVING',
        barcode: data.original_barcode,
        model: data.model,
        color: data.color,
        size: data.size,
        item: data.item,
        quantity: data.quantity,
        username,
        scan_no,
        timestamp: new Date().toISOString(),
        // Include stats for stats update
        firstStock: firstStock || 0,
        warehouseStock: stats.warehouse_stock || 0,
        receivingCount: stats.receiving_count || 0,
        receivingQty: stats.receiving_qty || 0,
        shippingCount: stats.shipping_count || 0,
        shippingQty: stats.shipping_qty || 0,
        // Include warehouse items for chart warehouse update
        warehouseItems: warehouseItems
      });
      
      console.log('📡 Emitted dashboard:update event with:');
      console.log('   - warehouseItems count:', warehouseItems.length);
      console.log('   - warehouseStock:', stats.warehouse_stock);
      console.log('   - receivingCount:', stats.receiving_count);
    }

    // 8. RESPONSE
    res.status(201).json({
      success: true,
      message: 'Data Berhasil Diinputkan',
      data: {
        scan_no,
        original_barcode: data.original_barcode,
        model: data.model,
        color: data.color,
        size: data.size,
        quantity: data.quantity,
        date_time: new Date().toISOString(),
        username
      }
    });

  } catch (err) {
    console.error('❌ Scan receiving error:', err);
    res.status(500).json({ 
      success: false,
      error: 'SCAN_FAILED',
      message: 'Gagal melakukan scan',
      details: err.message 
    });
  }
});

/**
 * POST /api/receiving/batch-scan
 * ✅ Batch scan - insert multiple records in 1 request
 */
router.post('/batch-scan', verifyToken, async (req, res) => {
  try {
    const { barcode, batchCount } = req.body;
    const username = req.user.username;
    const position = req.user.position;

    if (!barcode || barcode.trim() === '') {
      return res.status(400).json({ success: false, error: 'BARCODE_REQUIRED', message: 'Barcode harus diisi' });
    }
    if (!batchCount || batchCount < 1 || batchCount > 1000) {
      return res.status(400).json({ success: false, error: 'INVALID_BATCH_COUNT', message: 'Batch count harus 1-1000' });
    }

    const now = new Date();
    const currentTime = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    if (currentTime >= 27000 && currentTime <= 27006) {
      return res.status(503).json({ success: false, error: 'SYSTEM_MAINTENANCE', message: 'Harap tidak melakukan transaksi, sedang proses perpindahan data' });
    }

    if (position !== 'RECEIVING' && position !== 'IT') {
      return res.status(403).json({ success: false, error: 'INVALID_POSITION', message: 'Username tidak sesuai - Harus posisi RECEIVING atau IT' });
    }

    const masterData = await query(`SELECT original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item FROM [Backup_hskpro].[dbo].[master_database] WHERE original_barcode = @barcode`, { barcode: barcode.trim() });

    if (masterData.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'BARCODE_NOT_FOUND', message: 'Data Gagal Diinputkan - Barcode tidak ditemukan di master database' });
    }

    const data = masterData.recordset[0];
    const userData = await query('SELECT description FROM [Backup_hskpro].[dbo].[users] WHERE username = @username', { username });
    const description = userData.recordset[0]?.description || '';

    const today = new Date().toISOString().slice(0, 10);
    const scanNoResult = await query(`SELECT ISNULL(MAX(scan_no), 0) as max_scan_no FROM [Backup_hskpro].[dbo].[receiving] WHERE CAST(date_time AS DATE) = @today`, { today });
    let scan_no = scanNoResult.recordset[0].max_scan_no + 1;

    const totalQuantity = data.quantity * batchCount;
    await query(`UPDATE [Backup_hskpro].[dbo].[master_database] SET stock = stock + @quantity WHERE original_barcode = @barcode`, { quantity: totalQuantity, barcode: barcode.trim() });

    let valuesParts = [];
    for (let i = 0; i < batchCount; i++) {
      valuesParts.push(`('${data.original_barcode}', '${data.brand}', '${data.color}', '${data.size}', '${data.four_digit || ''}', '${data.unit}', ${data.quantity}, '${data.production}', '${data.model}', '${data.model_code || ''}', '${data.item}', GETDATE(), ${scan_no + i}, '${username}', '${description}')`);
    }

    await query(`INSERT INTO [Backup_hskpro].[dbo].[receiving] (original_barcode, brand, color, size, four_digit, unit, quantity, production, model, model_code, item, date_time, scan_no, username, description) VALUES ${valuesParts.join(',')}`);

    const statsResult = await query(`SELECT ISNULL((SELECT SUM(stock) FROM [Backup_hskpro].[dbo].[master_database]), 0) as warehouse_stock, ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[receiving] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as receiving_count, ISNULL((SELECT COUNT(*) FROM [Backup_hskpro].[dbo].[shipping] WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)), 0) as shipping_count`);
    const stats = statsResult.recordset[0] || {};

    const totalStock = await query(`SELECT ISNULL(SUM(stock), 0) as total FROM [Backup_hskpro].[dbo].[master_database]`);
    const totalWarehouseStock = totalStock.recordset[0]?.total || 0;

    const itemsResult = await query(`SELECT item, ISNULL(SUM(stock), 0) as total, CASE WHEN @totalStock = 0 THEN 0 ELSE CAST(ISNULL(SUM(stock), 0) * 100.0 / @totalStock AS DECIMAL(5, 2)) END as status FROM [Backup_hskpro].[dbo].[master_database] GROUP BY item ORDER BY total DESC`, { totalStock: totalWarehouseStock });
    const warehouseItems = itemsResult.recordset || [];

    const io = req.app.get('io');
    if (io) {
      io.emit('dashboard:update', { type: 'RECEIVING_BATCH', barcode: data.original_barcode, batchCount, totalQuantity, scanNoRange: `${scan_no}-${scan_no + batchCount - 1}`, username, timestamp: new Date().toISOString(), warehouseStock: stats.warehouse_stock || 0, receivingCount: stats.receiving_count || 0, shippingCount: stats.shipping_count || 0, warehouseItems });
    }

    res.status(201).json({ success: true, message: `Batch scan berhasil: ${batchCount} data diinputkan untuk barcode ${data.original_barcode}`, data: { batchCount, scanNoRange: `${scan_no}-${scan_no + batchCount - 1}`, original_barcode: data.original_barcode, model: data.model, color: data.color, size: data.size, quantity: data.quantity, totalQuantity, date_time: new Date().toISOString(), username } });

  } catch (err) {
    console.error('❌ Batch scan error:', err);
    res.status(500).json({ success: false, error: 'BATCH_SCAN_FAILED', message: 'Gagal melakukan batch scan', details: err.message });
  }
});

/**
 * PUT /api/receiving/:id
 * ✅ Edit receiving scan data
 */
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { 
      original_barcode, brand, color, size, four_digit, unit, quantity, 
      production, model, model_code, item, description 
    } = req.body;
    const { id } = req.params;
    const username = req.user.username;

    console.log('✏️ Editing receiving scan:', { id, original_barcode, username });

    // Parse id format: "date_time|scan_no|username"
    const parts = id.split('|');
    if (parts.length !== 3) {
      return res.status(400).json({
        success: false,
        error: 'Invalid scan ID format'
      });
    }

    const [date_time, scan_no, original_username] = parts;

    // Verify user can only edit their own scans or IT can edit any
    if (req.user.position !== 'IT' && username !== original_username) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized - Can only edit your own scans'
      });
    }

    // Update receiving
    await query(`
      UPDATE [Backup_hskpro].[dbo].[receiving]
      SET 
        original_barcode = @original_barcode,
        brand = @brand,
        color = @color,
        size = @size,
        four_digit = @four_digit,
        unit = @unit,
        quantity = @quantity,
        production = @production,
        model = @model,
        model_code = @model_code,
        item = @item,
        description = @description
      WHERE date_time = @date_time 
        AND scan_no = @scan_no 
        AND username = @original_username
    `, {
      original_barcode,
      brand: brand || '',
      color: color || '',
      size: size || '',
      four_digit: four_digit || '',
      unit: unit || '',
      quantity: parseInt(quantity) || 0,
      production: production || '',
      model: model || '',
      model_code: model_code || '',
      item: item || '',
      description: description || '',
      date_time,
      scan_no: parseInt(scan_no),
      original_username
    });

    console.log(`✅ Receiving scan updated: ${id}`);

    res.json({
      success: true,
      message: 'Data Berhasil Diperbarui'
    });

  } catch (err) {
    console.error('❌ Edit receiving error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to edit receiving scan',
      message: err.message
    });
  }
});

/**
 * DELETE /api/receiving/:id
 * ✅ Delete receiving scan data
 */
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;

    console.log('🗑️ Deleting receiving scan:', { id, username });

    // Parse id format: "date_time|scan_no|username"
    const parts = id.split('|');
    if (parts.length !== 3) {
      return res.status(400).json({
        success: false,
        error: 'Invalid scan ID format'
      });
    }

    const [date_time, scan_no, original_username] = parts;

    // Verify user can only delete their own scans or IT can delete any
    if (req.user.position !== 'IT' && username !== original_username) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized - Can only delete your own scans'
      });
    }

    // Get scan data before deleting (to reverse stock)
    const scanData = await query(`
      SELECT quantity FROM [Backup_hskpro].[dbo].[receiving]
      WHERE date_time = @date_time 
        AND scan_no = @scan_no 
        AND username = @original_username
    `, {
      date_time,
      scan_no: parseInt(scan_no),
      original_username
    });

    if (scanData.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Scan not found'
      });
    }

    const quantity = scanData.recordset[0].quantity;

    // Get barcode to reverse stock
    const barcodeData = await query(`
      SELECT original_barcode FROM [Backup_hskpro].[dbo].[receiving]
      WHERE date_time = @date_time 
        AND scan_no = @scan_no 
        AND username = @original_username
    `, {
      date_time,
      scan_no: parseInt(scan_no),
      original_username
    });

    if (barcodeData.recordset.length > 0) {
      const barcode = barcodeData.recordset[0].original_barcode;

      // Reverse stock update
      await query(`
        UPDATE [Backup_hskpro].[dbo].[master_database]
        SET stock = stock - @quantity
        WHERE original_barcode = @barcode
      `, {
        quantity,
        barcode
      });

      console.log(`✅ Stock reversed for ${barcode}: -${quantity}`);
    }

    // Delete receiving record
    await query(`
      DELETE FROM [Backup_hskpro].[dbo].[receiving]
      WHERE date_time = @date_time 
        AND scan_no = @scan_no 
        AND username = @original_username
    `, {
      date_time,
      scan_no: parseInt(scan_no),
      original_username
    });

    console.log(`✅ Receiving scan deleted: ${id}`);

    res.json({
      success: true,
      message: 'Data Berhasil Dihapus'
    });

  } catch (err) {
    console.error('❌ Delete receiving error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete receiving scan',
      message: err.message
    });
  }
});

/**
 * GET /api/receiving/all
 * ✅ Get all receiving scans for today (for IT users)
 */
router.get('/all', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const pageNum = (page - 1) * limit;
    const username_filter = req.query.username || ''; // Optional filter by username

    console.log('📋 Fetching ALL receiving scans for TODAY (IT view)');

    let whereClause = 'WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)';
    if (username_filter) {
      whereClause += ` AND username = '${username_filter}'`;
    }

    const result = await query(`
      SELECT 
        original_barcode,
        brand,
        color,
        size,
        four_digit,
        unit,
        quantity,
        production,
        model,
        model_code,
        item,
        CONVERT(varchar, date_time, 120) as date_time,
        scan_no,
        username,
        description
      FROM [Backup_hskpro].[dbo].[receiving]
      ${whereClause}
      ORDER BY date_time DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { 
      offset: pageNum, 
      limit 
    });

    const totalResult = await query(`
      SELECT COUNT(*) as total FROM [Backup_hskpro].[dbo].[receiving]
      ${whereClause}
    `);

    const total = totalResult.recordset[0].total;

    console.log(`✅ Found ${result.recordset.length} records (Total: ${total})`);

    res.json({
      success: true,
      data: result.recordset,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    console.error('❌ Get all receiving error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch receiving scans',
      message: err.message
    });
  }
});

/**
 * GET /api/receiving/export-detail
 * ✅ Export today's receiving scans to Excel (Detail Report)
 */
router.get('/export-detail', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const today = new Date().toISOString().slice(0, 10);

    console.log('📊 Exporting receiving detail report for:', username);

    // Get today's scans
    const result = await query(`
      SELECT
        CONVERT(varchar, date_time, 120) as date_time,
        original_barcode,
        brand,
        color,
        size,
        four_digit,
        unit,
        quantity,
        production,
        model,
        model_code,
        item,
        scan_no,
        username,
        description
      FROM [Backup_hskpro].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = @today
      ORDER BY date_time DESC
    `, { today });

    const data = result.recordset;

    if (data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data to export'
      });
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 20 }, // date_time
      { wch: 15 }, // original_barcode
      { wch: 15 }, // brand
      { wch: 12 }, // color
      { wch: 10 }, // size
      { wch: 12 }, // four_digit
      { wch: 10 }, // unit
      { wch: 10 }, // quantity
      { wch: 15 }, // production
      { wch: 12 }, // model
      { wch: 12 }, // model_code
      { wch: 12 }, // item
      { wch: 10 }, // scan_no
      { wch: 12 }, // username
      { wch: 20 }  // description
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Receiving Detail');

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    console.log(`✅ Exported ${data.length} records for detail report`);

    // Send file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Receiving_Detail_${today}.xlsx"`);
    res.send(buffer);

  } catch (err) {
    console.error('❌ Export detail error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to export receiving detail',
      message: err.message
    });
  }
});

/**
 * GET /api/receiving/export-summary
 * ✅ Export today's receiving summary (by user) to Excel
 */
router.get('/export-summary', verifyToken, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    console.log('📊 Exporting receiving summary report');

    // Get summary grouped by user
    const result = await query(`
      SELECT
        username,
        COUNT(*) as total_scans,
        SUM(CAST(quantity AS INT)) as total_quantity,
        MIN(CONVERT(varchar, date_time, 120)) as first_scan,
        MAX(CONVERT(varchar, date_time, 120)) as last_scan
      FROM [Backup_hskpro].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = @today
      GROUP BY username
      ORDER BY COUNT(*) DESC
    `, { today });

    const data = result.recordset;

    if (data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data to export'
      });
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
      { wch: 15 }, // username
      { wch: 15 }, // total_scans
      { wch: 15 }, // total_quantity
      { wch: 20 }, // first_scan
      { wch: 20 }  // last_scan
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Receiving Summary');

    // Generate buffer
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    console.log(`✅ Exported summary for ${data.length} users`);

    // Send file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Receiving_Summary_${today}.xlsx"`);
    res.send(buffer);

  } catch (err) {
    console.error('❌ Export summary error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to export receiving summary',
      message: err.message
    });
  }
});

module.exports = router;