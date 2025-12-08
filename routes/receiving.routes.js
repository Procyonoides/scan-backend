const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const { scanReceivingValidation } = require('../middleware/validation.middleware');

/**
 * GET /api/receiving
 * Get receiving history dengan pagination
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    const countResult = await query('SELECT COUNT(*) as total FROM dbo.receiving');
    const total = countResult.recordset[0].total;

    const result = await query(`
      SELECT 
        receiving_id,
        warehouse_id,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        status,
        CONVERT(varchar, scan_date, 120) as scan_date
      FROM dbo.receiving
      ORDER BY scan_date DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { 
      offset: offsetNum, 
      limit: limitNum 
    });

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
    console.error('Get receiving error:', err);
    res.status(500).json({ error: 'Failed to fetch receiving data' });
  }
});

/**
 * POST /api/receiving/scan
 * Record receiving scan (RECEIVING, SERVER, IT only)
 * ✅ WITH SOCKET.IO EMIT
 */
router.post('/scan', verifyToken, verifyRole(['RECEIVING', 'SERVER', 'IT']), scanReceivingValidation, async (req, res) => {
  try {
    const { original_barcode, model, color, size, quantity, warehouse_id } = req.body;

    // Insert receiving record
    const result = await query(`
      INSERT INTO dbo.receiving 
      (warehouse_id, original_barcode, model, color, size, quantity, username, status, scan_date)
      OUTPUT INSERTED.*
      VALUES (@warehouse_id, @barcode, @model, @color, @size, @quantity, @username, 'IN', GETDATE())
    `, {
      warehouse_id,
      barcode: original_barcode,
      model: model || 'N/A',
      color: color || 'N/A',
      size: size || 'N/A',
      quantity: parseInt(quantity),
      username: req.user.username
    });

    const newReceiving = result.recordset[0];

    // Update stock quantity
    try {
      await query(`
        UPDATE dbo.stock 
        SET quantity = quantity + @quantity
        WHERE original_barcode = @barcode
      `, {
        quantity: parseInt(quantity),
        barcode: original_barcode
      });
    } catch (updateErr) {
      console.warn('Stock update failed:', updateErr);
    }

    // ============ EMIT SOCKET.IO EVENT ============
    const io = req.app.get('io');
    io.emit('dashboard:update', {
      type: 'RECEIVING',
      receiving_id: newReceiving.receiving_id,
      barcode: original_barcode,
      model: model || 'N/A',
      color: color || 'N/A',
      size: size || 'N/A',
      quantity: parseInt(quantity),
      username: req.user.username,
      timestamp: new Date().toISOString()
    });

    console.log('🔔 Dashboard update emitted: RECEIVING');

    res.status(201).json({ 
      message: 'Receiving recorded successfully',
      data: {
        receiving_id: newReceiving.receiving_id,
        barcode: original_barcode,
        quantity,
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Record receiving error:', err);
    res.status(500).json({ error: 'Failed to record receiving' });
  }
});

/**
 * GET /api/receiving/history
 * ✅ SESUAI PHP: model_scan.php line 115-125 (fetchdatar)
 * Get last 10 receiving records untuk current user
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
 * GET /api/receiving/:id
 * Get specific receiving record
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

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
      WHERE scan_no = @scan_no
    `, { scan_no: parseInt(id) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Receiving record not found' });
    }

    res.json(result.recordset[0]);

  } catch (err) {
    console.error('Get receiving detail error:', err);
    res.status(500).json({ error: 'Failed to fetch receiving record' });
  }
});

/**
 * PUT /api/receiving/:id
 * Update receiving record (SERVER, IT only)
 */
router.put('/:id', verifyToken, verifyRole(['SERVER', 'IT']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, quantity } = req.body;

    if (!status && !quantity) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (status && !['IN', 'OUT', 'PENDING', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const existing = await query(
      'SELECT receiving_id FROM dbo.receiving WHERE receiving_id = @receiving_id',
      { receiving_id: parseInt(id) }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Receiving record not found' });
    }

    let updateFields = [];
    let params = { receiving_id: parseInt(id) };

    if (status) {
      updateFields.push('status = @status');
      params.status = status;
    }

    if (quantity) {
      updateFields.push('quantity = @quantity');
      params.quantity = parseInt(quantity);
    }

    await query(`
      UPDATE dbo.receiving 
      SET ${updateFields.join(', ')}
      WHERE receiving_id = @receiving_id
    `, params);

    res.json({ message: 'Receiving record updated successfully' });

  } catch (err) {
    console.error('Update receiving error:', err);
    res.status(500).json({ error: 'Failed to update receiving record' });
  }
});

/**
 * POST /api/receiving/scan
 * ✅ SESUAI PHP: controller_scan.php line 264-399 (getscanrec)
 * Scan barcode untuk receiving dengan validasi:
 * 1. Cek maintenance time (07:30:00 - 07:30:06)
 * 2. Validasi position user harus RECEIVING
 * 3. Cari barcode di master_database
 * 4. Generate scan_no otomatis (max + 1 untuk hari ini)
 * 5. Insert ke table receiving dengan semua data dari master_database
 */
router.post('/scan', verifyToken, async (req, res) => {
  try {
    const { barcode } = req.body;
    const username = req.user.username;
    const position = req.user.position;

    console.log('📷 Scan receiving:', { barcode, username, position });

    // Validasi input
    if (!barcode || barcode.trim() === '') {
      console.warn('❌ Barcode empty');
      return res.status(400).json({ 
        success: false,
        error: 'BARCODE_REQUIRED',
        message: 'Barcode harus diisi' 
      });
    }

    // 1. CHECK MAINTENANCE TIME (07:30:00 - 07:30:06)
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const currentTime = hours * 3600 + minutes * 60 + seconds;
    const maintenanceStart = 7 * 3600 + 30 * 60 + 0; // 07:30:00
    const maintenanceEnd = 7 * 3600 + 30 * 60 + 6;   // 07:30:06

    if (currentTime >= maintenanceStart && currentTime <= maintenanceEnd) {
      console.warn('⚠️ Maintenance time - Transaction blocked');
      return res.status(503).json({
        success: false,
        error: 'SYSTEM_MAINTENANCE',
        message: 'Harap tidak melakukan transaksi, sedang proses perpindahan data'
      });
    }

    // 2. VALIDASI POSITION (harus RECEIVING atau IT)
    if (position !== 'RECEIVING' && position !== 'IT') {
      console.warn(`❌ Invalid position: ${position}`);
      return res.status(403).json({
        success: false,
        error: 'INVALID_POSITION',
        message: 'Username tidak sesuai - Harus posisi RECEIVING'
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

    console.log('🔍 Master data result:', masterData.recordset.length, 'rows');

    if (masterData.recordset.length === 0) {
      console.warn(`❌ Barcode not found in master_database: ${barcode}`);
      return res.status(404).json({
        success: false,
        error: 'BARCODE_NOT_FOUND',
        message: 'Data Gagal Diinputkan - Barcode tidak ditemukan di master database'
      });
    }

    const data = masterData.recordset[0];
    console.log('✅ Barcode found:', data);

    // 4. GET USER DESCRIPTION
    const userData = await query(
      'SELECT description FROM [Backup_hskpro].[dbo].[users] WHERE username = @username',
      { username }
    );
    const description = userData.recordset[0]?.description || '';
    console.log('👤 User description:', description);

    // 5. GENERATE SCAN_NO (MAX + 1 untuk hari ini)
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    console.log('📅 Today:', today);
    
    const scanNoResult = await query(`
      SELECT ISNULL(MAX(scan_no), 0) as max_scan_no
      FROM [Backup_hskpro].[dbo].[receiving]
      WHERE CAST(date_time AS DATE) = @today
    `, { today });
    
    const scan_no = scanNoResult.recordset[0].max_scan_no + 1;
    console.log('🔢 New scan_no:', scan_no);

    // 6. INSERT KE TABLE RECEIVING
    console.log('💾 Inserting to receiving table...');
    
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

    // 7. SOCKET.IO EMIT (optional)
    const io = req.app.get('io');
    if (io) {
      io.emit('dashboard:update', {
        type: 'RECEIVING',
        barcode: data.original_barcode,
        model: data.model,
        color: data.color,
        size: data.size,
        quantity: data.quantity,
        username,
        scan_no,
        timestamp: new Date().toISOString()
      });
      console.log('📡 Socket.IO event emitted');
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
    console.error('❌ Error stack:', err.stack);
    res.status(500).json({ 
      success: false,
      error: 'SCAN_FAILED',
      message: 'Gagal melakukan scan',
      details: err.message 
    });
  }
});

module.exports = router;