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
 * GET /api/transactions
 * Get all transactions with pagination
 * ✅ SESUAI PHP: controller_monitoring.php - transaction()
 */
router.get('/', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
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
      `SELECT COUNT(*) as total FROM [${dbName}].[dbo].[stok] ${searchCondition}`,
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
      FROM [${dbName}].[dbo].[stok]
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
router.get('/:no', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
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
      FROM [${dbName}].[dbo].[stok]
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
      `SELECT no FROM [${dbName}].[dbo].[stok] WHERE no = @no`,
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
      UPDATE [${dbName}].[dbo].[stok]
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
      `SELECT no FROM [${dbName}].[dbo].[stok] WHERE no = @no`,
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
      `DELETE FROM [${dbName}].[dbo].[stok] WHERE no = @no`,
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
 * POST /api/transactions/batch-delete
 * Batch delete transactions (IT only)
 */
router.post('/batch-delete', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { nos } = req.body;

    if (!nos || !Array.isArray(nos) || nos.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Transaction numbers array is required'
      });
    }

    console.log('🗑️ Batch deleting transactions:', nos.length);

    const params = {};
    const placeholders = nos.map((no, i) => {
      const paramName = `no${i}`;
      params[paramName] = no;
      return `@${paramName}`;
    }).join(',');

    await query(
      `DELETE FROM [${dbName}].[dbo].[stok] WHERE no IN (${placeholders})`,
      params
    );

    console.log(`✅ Batch deleted ${nos.length} transactions`);
    res.json({
      success: true,
      message: `${nos.length} transactions deleted successfully`,
      count: nos.length
    });
  } catch (err) {
    console.error('❌ Batch delete transactions error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to batch delete transactions',
      message: err.message
    });
  }
});

/**
 * GET /api/transactions/export/excel
 * Export transactions to Excel
 * ✅ SESUAI PHP: controller_monitoring.php - print_transaction()
 */
router.get('/export/excel', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    console.log('📤 Exporting transactions to Excel...');

    const result = await query(`
      SELECT 
        stock_awal,
        receiving,
        shipping,
        stock_akhir,
        CONVERT(VARCHAR, date, 23) as date
      FROM [${dbName}].[dbo].[stok]
      ORDER BY date ASC
    `);

    const data = result.recordset;
    if (data.length === 0) return res.status(404).json({ success: false, error: 'No data' });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Transaction');

    const columns = ['DATE/TIME', 'FIRST STOCK', 'RECEIVING', 'SHIPPING', 'WAREHOUSE STOCK'];
    ws.columns = [{ width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 18 }];

    styleTitle(ws, 'TRANSACTION', columns.length);
    styleHeaderRow(ws, 3, columns);

    data.forEach((row, idx) => {
      const r = 4 + idx;
      styleDataCell(ws.getCell(r, 1), row.date, false);
      styleDataCell(ws.getCell(r, 2), row.stock_awal, true);
      styleDataCell(ws.getCell(r, 3), row.receiving, true);
      styleDataCell(ws.getCell(r, 4), row.shipping, true);
      styleDataCell(ws.getCell(r, 5), row.stock_akhir, true);
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Transaction_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.send(buffer);

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