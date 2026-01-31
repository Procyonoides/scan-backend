const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

/**
 * GET /api/shipping/history
 * ✅ Get last 10 shipping records untuk current user
 */
router.get('/history', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    
    console.log('📋 Fetching shipping history for:', username);

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
      FROM [Backup_hskpro].[dbo].[shipping]
      WHERE username = @username
      ORDER BY date_time DESC
    `, { username });

    console.log(`✅ Found ${result.recordset.length} shipping records`);

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (err) {
    console.error('❌ Get shipping history error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch shipping history',
      message: err.message 
    });
  }
});

/**
 * ✅ NEW: GET /api/shipping/today
 * Get ALL shipping scans for TODAY (like dashboard)
 * Supports pagination via query params
 */
router.get('/today', verifyToken, async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 100;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    console.log('📋 Fetching TODAY shipping scans...', { page: pageNum, limit: limitNum });

    // Get total count for today
    const countResult = await query(`
      SELECT COUNT(*) as total
      FROM [Backup_hskpro].[dbo].[shipping]
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
      FROM [Backup_hskpro].[dbo].[shipping]
      WHERE CAST(date_time AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY date_time DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { offset, limit: limitNum });

    console.log(`✅ Found ${result.recordset.length} shipping scans (Page ${pageNum}, Total: ${total})`);

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
    console.error('❌ Get today shipping error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch today shipping',
      message: err.message 
    });
  }
});

/**
 * POST /api/shipping/scan
 * ✅ Scan barcode untuk shipping
 */
router.post('/scan', verifyToken, async (req, res) => {
  try {
    const { barcode } = req.body;
    const username = req.user.username;
    const position = req.user.position;

    console.log('📷 Scan shipping:', { barcode, username, position });

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
    if (position !== 'SHIPPING' && position !== 'IT') {
      console.warn(`❌ Invalid position: ${position}`);
      return res.status(403).json({
        success: false,
        error: 'INVALID_POSITION',
        message: 'Username tidak sesuai - Harus posisi SHIPPING atau IT'
      });
    }

    // 3. CARI BARCODE DI MASTER_DATABASE
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
      FROM [Backup_hskpro].[dbo].[shipping]
      WHERE CAST(date_time AS DATE) = @today
    `, { today });
    
    const scan_no = scanNoResult.recordset[0].max_scan_no + 1;

    // 6. INSERT KE TABLE SHIPPING
    await query(`
      INSERT INTO [Backup_hskpro].[dbo].[shipping]
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

    console.log(`✅ Scan shipping berhasil: ${barcode}, scan_no: ${scan_no}`);

    // 7. SOCKET.IO EMIT
    const io = req.app.get('io');
    if (io) {
      io.emit('dashboard:update', {
        type: 'SHIPPING',
        barcode: data.original_barcode,
        model: data.model,
        color: data.color,
        size: data.size,
        quantity: data.quantity,
        username,
        scan_no,
        timestamp: new Date().toISOString()
      });
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
    console.error('❌ Scan shipping error:', err);
    res.status(500).json({ 
      success: false,
      error: 'SCAN_FAILED',
      message: 'Gagal melakukan scan',
      details: err.message 
    });
  }
});

module.exports = router;