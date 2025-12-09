const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

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
 * POST /api/receiving/scan
 * ✅ SESUAI PHP: controller_scan.php line 264-399 (getscanrec)
 * Scan barcode untuk receiving dengan validasi:
 * 1. Cek maintenance time (07:30:00 - 07:30:06)
 * 2. Validasi position user harus RECEIVING atau IT
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

/**
 * DELETE /api/receiving/:date/:scan/:user
 * Delete receiving record (IT, MANAGEMENT only)
 */
router.delete('/:date/:scan/:user', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { date, scan, user } = req.params;

    console.log('🗑️ Delete receiving:', { date, scan, user });

    // Check if record exists
    const existing = await query(
      'SELECT scan_no FROM [Backup_hskpro].[dbo].[receiving] WHERE date_time = @date AND scan_no = @scan AND username = @user',
      { date, scan: parseInt(scan), user }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Record not found'
      });
    }

    // Delete record
    await query(
      'DELETE FROM [Backup_hskpro].[dbo].[receiving] WHERE date_time = @date AND scan_no = @scan AND username = @user',
      { date, scan: parseInt(scan), user }
    );

    console.log('✅ Receiving record deleted');

    res.json({
      success: true,
      message: 'Record deleted successfully'
    });

  } catch (err) {
    console.error('❌ Delete receiving error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete record',
      message: err.message
    });
  }
});

module.exports = router;