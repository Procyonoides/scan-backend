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
    const offset = (page - 1) * limit;

    // Validate pagination params
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    // Get total count
    const countResult = await query('SELECT COUNT(*) as total FROM dbo.receiving');
    const total = countResult.recordset[0].total;

    // Get data
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
 */
router.post('/scan', verifyToken, verifyRole(['RECEIVING', 'SERVER', 'IT']), scanReceivingValidation, async (req, res) => {
  try {
    const { original_barcode, model, color, size, quantity, warehouse_id } = req.body;

    // Verify warehouse exists (jika ada table warehouse)
    // const warehouseCheck = await query(
    //   'SELECT warehouse_id FROM dbo.warehouse WHERE warehouse_id = @warehouse_id',
    //   { warehouse_id }
    // );
    // if (warehouseCheck.recordset.length === 0) {
    //   return res.status(400).json({ error: 'Invalid warehouse' });
    // }

    // Insert receiving record
    const result = await query(`
      INSERT INTO dbo.receiving 
      (warehouse_id, original_barcode, model, color, size, quantity, username, status, scan_date)
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

    // Update stock quantity jika ada table yang match
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
      console.warn('Stock update failed (table might not exist):', updateErr);
    }

    res.status(201).json({ 
      message: 'Receiving recorded successfully',
      data: {
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
 * GET /api/receiving/:id
 * Get specific receiving record
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

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
      WHERE receiving_id = @receiving_id
    `, { receiving_id: parseInt(id) });

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

    // Validate input
    if (!status && !quantity) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (status && !['IN', 'OUT', 'PENDING', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Check if record exists
    const existing = await query(
      'SELECT receiving_id FROM dbo.receiving WHERE receiving_id = @receiving_id',
      { receiving_id: parseInt(id) }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Receiving record not found' });
    }

    // Build update query
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

    // Execute update
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

module.exports = router;