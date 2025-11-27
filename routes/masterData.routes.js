const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const { addBarcodeValidation } = require('../middleware/validation.middleware');

/**
 * GET /api/master-data/barcodes
 * Get all barcodes/stock master data
 */
router.get('/barcodes', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    // Build search condition
    let searchCondition = '';
    let params = {};

    if (search) {
      searchCondition = `WHERE original_barcode LIKE @search OR brand LIKE @search OR model LIKE @search`;
      params.search = `%${search}%`;
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM dbo.stock ${searchCondition}`,
      params
    );
    const total = countResult.recordset[0].total;

    // Get data
    params.offset = offsetNum;
    params.limit = limitNum;

    const result = await query(`
      SELECT 
        stock_id,
        warehouse_id,
        original_barcode,
        brand,
        model,
        color,
        size,
        quantity,
        status,
        CONVERT(varchar, created_at, 120) as created_at
      FROM dbo.stock
      ${searchCondition}
      ORDER BY stock_id DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

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
    console.error('Get barcodes error:', err);
    res.status(500).json({ error: 'Failed to fetch barcodes' });
  }
});

/**
 * GET /api/master-data/filter-options
 * Get unique values untuk filter dropdown
 */
router.get('/filter-options', verifyToken, async (req, res) => {
  try {
    // Get unique brands
    const brandsResult = await query(`
      SELECT DISTINCT brand FROM dbo.stock WHERE brand IS NOT NULL AND brand != ''
      ORDER BY brand
    `);

    // Get unique models
    const modelsResult = await query(`
      SELECT DISTINCT model FROM dbo.stock WHERE model IS NOT NULL AND model != ''
      ORDER BY model
    `);

    // Get unique colors
    const colorsResult = await query(`
      SELECT DISTINCT color FROM dbo.stock WHERE color IS NOT NULL AND color != ''
      ORDER BY color
    `);

    // Get unique sizes
    const sizesResult = await query(`
      SELECT DISTINCT size FROM dbo.stock WHERE size IS NOT NULL AND size != ''
      ORDER BY size
    `);

    // Get unique users
    const usersResult = await query(`
      SELECT DISTINCT username FROM dbo.users WHERE username IS NOT NULL
      ORDER BY username
    `);

    res.json({
      brands: brandsResult.recordset.map(r => r.brand),
      models: modelsResult.recordset.map(r => r.model),
      colors: colorsResult.recordset.map(r => r.color),
      sizes: sizesResult.recordset.map(r => r.size),
      users: usersResult.recordset.map(r => r.username),
      statuses: ['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED']
    });

  } catch (err) {
    console.error('Get filter options error:', err);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

/**
 * POST /api/master-data/barcode
 * Create new barcode/stock item (SERVER, IT only)
 */
router.post('/barcode', verifyToken, verifyRole(['SERVER', 'IT']), addBarcodeValidation, async (req, res) => {
  try {
    const { original_barcode, brand, model, color, size, warehouse_id = 1 } = req.body;

    // Check if barcode already exists
    const existingBarcode = await query(
      'SELECT stock_id FROM dbo.stock WHERE original_barcode = @barcode',
      { barcode: original_barcode }
    );

    if (existingBarcode.recordset.length > 0) {
      return res.status(400).json({ error: 'Barcode already exists' });
    }

    // Insert new barcode
    await query(`
      INSERT INTO dbo.stock 
      (warehouse_id, original_barcode, brand, model, color, size, quantity, status, created_at)
      VALUES (@warehouse_id, @barcode, @brand, @model, @color, @size, 0, 'AVAILABLE', GETDATE())
    `, {
      warehouse_id,
      barcode: original_barcode,
      brand,
      model,
      color,
      size
    });

    res.status(201).json({
      message: 'Barcode added successfully',
      data: {
        original_barcode,
        brand,
        model,
        color,
        size
      }
    });

  } catch (err) {
    console.error('Add barcode error:', err);
    res.status(500).json({ error: 'Failed to add barcode' });
  }
});

/**
 * GET /api/master-data/barcode/:id
 * Get specific barcode detail
 */
router.get('/barcode/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        stock_id,
        warehouse_id,
        original_barcode,
        brand,
        model,
        color,
        size,
        quantity,
        status,
        CONVERT(varchar, created_at, 120) as created_at
      FROM dbo.stock
      WHERE stock_id = @stock_id
    `, { stock_id: parseInt(id) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Barcode not found' });
    }

    res.json(result.recordset[0]);

  } catch (err) {
    console.error('Get barcode detail error:', err);
    res.status(500).json({ error: 'Failed to fetch barcode' });
  }
});

/**
 * PUT /api/master-data/barcode/:id
 * Update barcode (SERVER, IT only)
 */
router.put('/barcode/:id', verifyToken, verifyRole(['SERVER', 'IT']), async (req, res) => {
  try {
    const { id } = req.params;
    const { brand, model, color, size, status } = req.body;

    // Validate input
    if (!brand && !model && !color && !size && !status) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check if barcode exists
    const existing = await query(
      'SELECT stock_id FROM dbo.stock WHERE stock_id = @stock_id',
      { stock_id: parseInt(id) }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Barcode not found' });
    }

    // Build update query
    let updateFields = [];
    let params = { stock_id: parseInt(id) };

    if (brand) {
      updateFields.push('brand = @brand');
      params.brand = brand;
    }

    if (model) {
      updateFields.push('model = @model');
      params.model = model;
    }

    if (color) {
      updateFields.push('color = @color');
      params.color = color;
    }

    if (size) {
      updateFields.push('size = @size');
      params.size = size;
    }

    if (status) {
      updateFields.push('status = @status');
      params.status = status;
    }

    // Execute update
    await query(`
      UPDATE dbo.stock 
      SET ${updateFields.join(', ')}
      WHERE stock_id = @stock_id
    `, params);

    res.json({ message: 'Barcode updated successfully' });

  } catch (err) {
    console.error('Update barcode error:', err);
    res.status(500).json({ error: 'Failed to update barcode' });
  }
});

/**
 * DELETE /api/master-data/barcode/:id
 * Delete barcode (SERVER only)
 */
router.delete('/barcode/:id', verifyToken, verifyRole(['SERVER']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if barcode exists
    const existing = await query(
      'SELECT original_barcode FROM dbo.stock WHERE stock_id = @stock_id',
      { stock_id: parseInt(id) }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: 'Barcode not found' });
    }

    const barcode = existing.recordset[0].original_barcode;

    // Delete barcode
    await query(
      'DELETE FROM dbo.stock WHERE stock_id = @stock_id',
      { stock_id: parseInt(id) }
    );

    res.json({
      message: 'Barcode deleted successfully',
      deleted_barcode: barcode
    });

  } catch (err) {
    console.error('Delete barcode error:', err);
    res.status(500).json({ error: 'Failed to delete barcode' });
  }
});

module.exports = router;