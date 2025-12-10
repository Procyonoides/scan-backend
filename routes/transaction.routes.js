const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

/**
 * GET /api/transactions
 * Get all transactions with pagination
 * ✅ SESUAI PHP: controller_monitoring.php - transaction()
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    console.log('📋 Fetching transactions with pagination:', { page: pageNum, limit: limitNum, search });

    let searchCondition = '';
    let params = { offset: offsetNum, limit: limitNum };

    if (search && search.trim() !== '') {
      searchCondition = `WHERE CONVERT(VARCHAR, date, 23) LIKE @search`;
      params.search = `%${search.trim()}%`;
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM [Backup_hskpro].[dbo].[stok] ${searchCondition}`,
      search && search.trim() !== '' ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data with pagination
    const result = await query(`
      SELECT 
        no,
        stock_awal,
        receiving,
        shipping,
        stock_akhir,
        CONVERT(VARCHAR, date, 23) as date
      FROM [Backup_hskpro].[dbo].[stok]
      ${searchCondition}
      ORDER BY date DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);
    
    console.log(`✅ Found ${result.recordset.length} transactions (Total: ${total})`);
    
    res.json({
      success: true,
      data: result.recordset,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    console.error('❌ Get transactions error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch transactions',
      message: err.message 
    });
  }
});

/**
 * GET /api/transactions/:no
 * Get single transaction detail
 */
router.get('/:no', verifyToken, async (req, res) => {
  try {
    const { no } = req.params;
    console.log(`📋 Fetching transaction no: ${no}`);

    const result = await query(`
      SELECT 
        no,
        stock_awal,
        receiving,
        shipping,
        stock_akhir,
        CONVERT(VARCHAR, date, 23) as date
      FROM [Backup_hskpro].[dbo].[stok]
      WHERE no = @no
    `, { no: parseInt(no) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Transaction not found' 
      });
    }

    res.json({
      success: true,
      data: result.recordset[0]
    });
  } catch (err) {
    console.error('❌ Get transaction detail error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch transaction',
      message: err.message 
    });
  }
});

/**
 * PUT /api/transactions/:no
 * Update transaction (IT only)
 * ✅ SESUAI PHP: controller_monitoring.php - edit_transaction()
 */
router.put('/:no', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { no } = req.params;
    const { stock_awal, receiving, shipping, stock_akhir } = req.body;

    console.log(`📝 Updating transaction no: ${no}`);

    // Check if exists
    const existing = await query(
      'SELECT no FROM [Backup_hskpro].[dbo].[stok] WHERE no = @no',
      { no: parseInt(no) }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Transaction not found' 
      });
    }

    // Build update query
    let updateFields = [];
    let params = { no: parseInt(no) };

    if (stock_awal !== undefined) {
      updateFields.push('stock_awal = @stock_awal');
      params.stock_awal = parseInt(stock_awal);
    }
    if (receiving !== undefined) {
      updateFields.push('receiving = @receiving');
      params.receiving = parseInt(receiving);
    }
    if (shipping !== undefined) {
      updateFields.push('shipping = @shipping');
      params.shipping = parseInt(shipping);
    }
    if (stock_akhir !== undefined) {
      updateFields.push('stock_akhir = @stock_akhir');
      params.stock_akhir = parseInt(stock_akhir);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No fields to update' 
      });
    }

    // Execute update
    await query(`
      UPDATE [Backup_hskpro].[dbo].[stok]
      SET ${updateFields.join(', ')}
      WHERE no = @no
    `, params);

    console.log(`✅ Transaction updated: ${no}`);

    res.json({ 
      success: true,
      message: 'Transaction updated successfully' 
    });
  } catch (err) {
    console.error('❌ Update transaction error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update transaction',
      message: err.message 
    });
  }
});

/**
 * DELETE /api/transactions/:no
 * Delete transaction (IT only)
 * ✅ SESUAI PHP: controller_monitoring.php - delete_transaction()
 */
router.delete('/:no', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { no } = req.params;

    console.log(`🗑️ Deleting transaction no: ${no}`);

    // Check if exists
    const existing = await query(
      'SELECT no FROM [Backup_hskpro].[dbo].[stok] WHERE no = @no',
      { no: parseInt(no) }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Transaction not found' 
      });
    }

    // Delete
    await query(
      'DELETE FROM [Backup_hskpro].[dbo].[stok] WHERE no = @no',
      { no: parseInt(no) }
    );

    console.log(`✅ Transaction deleted: ${no}`);

    res.json({ 
      success: true,
      message: 'Transaction deleted successfully' 
    });
  } catch (err) {
    console.error('❌ Delete transaction error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete transaction',
      message: err.message 
    });
  }
});

/**
 * GET /api/transactions/export/excel
 * Export transactions to Excel
 * ✅ SESUAI PHP: controller_monitoring.php - print_transaction()
 */
router.get('/export/excel', verifyToken, async (req, res) => {
  try {
    console.log('📤 Exporting transactions to Excel...');

    const result = await query(`
      SELECT 
        no,
        stock_awal,
        receiving,
        shipping,
        stock_akhir,
        CONVERT(VARCHAR, date, 23) as date
      FROM [Backup_hskpro].[dbo].[stok]
      ORDER BY date ASC
    `);

    // Simple CSV export (dapat diganti dengan library Excel seperti exceljs)
    const csv = [
      'NO,DATE/TIME,FIRST STOCK,RECEIVING,SHIPPING,WAREHOUSE STOCK',
      ...result.recordset.map(row => 
        `${row.no},${row.date},${row.stock_awal},${row.receiving},${row.shipping},${row.stock_akhir}`
      )
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=Transaction_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);

    console.log('✅ Excel export completed');
  } catch (err) {
    console.error('❌ Export transactions error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to export transactions',
      message: err.message 
    });
  }
});

module.exports = router;