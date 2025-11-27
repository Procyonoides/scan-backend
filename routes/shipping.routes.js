const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const { scanShippingValidation } = require('../middleware/validation.middleware');

/**
 * GET /api/shipping
 * Get shipping history dengan pagination
 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    // Validate pagination params
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    // Get total count
    const countResult = await query('SELECT COUNT(*) as total FROM dbo.shipping');
    const total = countResult.recordset[0].total;

    // Get data
    const result = await query(`
      SELECT 
        shipping_id,
        warehouse_id,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        status,
        CONVERT(varchar, scan_date, 120) as scan_date
      FROM dbo.shipping
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
    console.error('Get shipping error:', err);
    res.status(500).json({ error: 'Failed to fetch shipping data' });
  }
});

/**
 * POST /api/shipping/scan
 * Record shipping scan (SHIPPING, SERVER, IT only)
 */
router.post('/scan', verifyToken, verifyRole(['SHIPPING', 'SERVER', 'IT']), scanShippingValidation, async (req, res) => {
  try {
    const { original_barcode, model, color, size, quantity, warehouse_id } = req.body;

    // Insert shipping record
    const result = await query(`
      INSERT INTO dbo.shipping 
      (warehouse_id, original_barcode, model, color, size, quantity, username, status, scan_date)
      VALUES (@warehouse_id, @barcode, @model, @color, @size, @quantity, @username, 'OUT', GETDATE())
    `, {
      warehouse_id,
      barcode: original_barcode,
      model: model || 'N/A',
      color: color || 'N/A',
      size: size || 'N/A',
      quantity: parseInt(quantity),
      username: req.user.username
    });

    // Update stock quantity (decrease)
    try {
      await query(`
        UPDATE dbo.stock 
        SET quantity = CASE 
          WHEN (quantity - @quantity) < 0 THEN 0 
          ELSE quantity - @quantity 
        END
        WHERE original_barcode = @barcode
      `, {
        quantity: parseInt(quantity),
        barcode: original_barcode
      });
    } catch (updateErr) {
      console.warn('Stock update failed (table might not exist):', updateErr);
    }

    res.status(201).json({ 
      message: 'Shipping recorded successfully',
      data: {
        barcode: original_barcode,
        quantity,
        timestamp: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Record shipping error:', err);
    res.status(500).json({ error: 'Failed to record shipping' });
  }
});

/**
 * GET /api/shipping/:id
 * Get specific shipping record
 */
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        shipping_id,
        warehouse_id,
        original_barcode,
        model,
        color,
        size,
        quantity,
        username,
        status,
        CONVERT(varchar, scan_date, 120) as scan_date
      FROM dbo.shipping
      WHERE shipping_id = @shipping_id
    `, { shipping_id: parseInt(id) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Shipping record not found' });
    }

    res.json(result.recordset[0]);

  } catch (err) {
    console.error('Get shipping detail error:', err);
    res.status(500).json({ error: 'Failed to fetch shipping record' });
  }
});

/**
 * PUT /api/shipping/:id
 * Update shipping record (SERVER, IT only)
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
      'SELECT shipping_id FROM dbo.shipping WHERE shipping_id = @shipping_id',
      { shipping_id: parseInt(id) }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Shipping record not found' });
    }

    // Build update query
    let updateFields = [];
    let params = { shipping_id: parseInt(id) };

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
      UPDATE dbo.shipping 
      SET ${updateFields.join(', ')}
      WHERE shipping_id = @shipping_id
    `, params);

    res.json({ message: 'Shipping record updated successfully' });

  } catch (err) {
    console.error('Update shipping error:', err);
    res.status(500).json({ error: 'Failed to update shipping record' });
  }
});

module.exports = router;