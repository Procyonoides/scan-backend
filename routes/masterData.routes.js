const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

/**
 * GET /api/master-data/barcodes
 * Get all barcodes with pagination and search
 */
router.get('/barcodes', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    let searchCondition = '';
    let params = { offset: offsetNum, limit: limitNum };

    if (search) {
      searchCondition = `WHERE original_barcode LIKE @search 
                         OR brand LIKE @search 
                         OR model LIKE @search 
                         OR color LIKE @search`;
      params.search = `%${search}%`;
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM [Backup_hskpro].[dbo].[master_database] ${searchCondition}`,
      search ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data
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
        username,
        CONVERT(varchar, date_time, 120) as date_time,
        stock
      FROM [Backup_hskpro].[dbo].[master_database]
      ${searchCondition}
      ORDER BY date_time DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

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
    console.error('Get barcodes error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch barcodes', 
      message: err.message 
    });
  }
});

/**
 * GET /api/master-data/barcode/:barcode
 * Get specific barcode detail
 */
router.get('/barcode/:barcode', verifyToken, async (req, res) => {
  try {
    const { barcode } = req.params;

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
        username,
        CONVERT(varchar, date_time, 120) as date_time,
        stock
      FROM [Backup_hskpro].[dbo].[master_database]
      WHERE original_barcode = @barcode
    `, { barcode });

    if (result.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Barcode not found' 
      });
    }

    res.json({
      success: true,
      data: result.recordset[0]
    });

  } catch (err) {
    console.error('Get barcode detail error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch barcode', 
      message: err.message 
    });
  }
});

/**
 * POST /api/master-data/barcode
 * Create new barcode (IT only)
 */
router.post('/barcode', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const {
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
    } = req.body;

    // Validate required fields
    if (!original_barcode || !brand || !color || !size || !unit || !production || !model || !item) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields' 
      });
    }

    // Check if barcode already exists
    const existingBarcode = await query(
      'SELECT original_barcode FROM [Backup_hskpro].[dbo].[master_database] WHERE original_barcode = @barcode',
      { barcode: original_barcode }
    );

    if (existingBarcode.recordset.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Barcode already exists' 
      });
    }

    // Insert new barcode
    await query(`
      INSERT INTO [Backup_hskpro].[dbo].[master_database]
      (original_barcode, brand, color, size, four_digit, unit, quantity, 
       production, model, model_code, item, username, date_time, stock)
      VALUES 
      (@barcode, @brand, @color, @size, @four_digit, @unit, @quantity,
       @production, @model, @model_code, @item, @username, GETDATE(), 0)
    `, {
      barcode: original_barcode,
      brand,
      color,
      size,
      four_digit: four_digit || '',
      unit,
      quantity: parseInt(quantity) || 0,
      production,
      model,
      model_code: model_code || '',
      item,
      username: req.user.username
    });

    res.status(201).json({
      success: true,
      message: 'Barcode added successfully',
      data: { original_barcode }
    });

  } catch (err) {
    console.error('Add barcode error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to add barcode', 
      message: err.message 
    });
  }
});

/**
 * PUT /api/master-data/barcode/:barcode
 * Update barcode (IT only)
 */
router.put('/barcode/:barcode', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { barcode } = req.params;
    const {
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
      stock
    } = req.body;

    // Check if barcode exists
    const existing = await query(
      'SELECT original_barcode FROM [Backup_hskpro].[dbo].[master_database] WHERE original_barcode = @barcode',
      { barcode }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Barcode not found' 
      });
    }

    // Build update query
    let updateFields = [];
    let params = { barcode };

    if (brand !== undefined) {
      updateFields.push('brand = @brand');
      params.brand = brand;
    }
    if (color !== undefined) {
      updateFields.push('color = @color');
      params.color = color;
    }
    if (size !== undefined) {
      updateFields.push('size = @size');
      params.size = size;
    }
    if (four_digit !== undefined) {
      updateFields.push('four_digit = @four_digit');
      params.four_digit = four_digit;
    }
    if (unit !== undefined) {
      updateFields.push('unit = @unit');
      params.unit = unit;
    }
    if (quantity !== undefined) {
      updateFields.push('quantity = @quantity');
      params.quantity = parseInt(quantity);
    }
    if (production !== undefined) {
      updateFields.push('production = @production');
      params.production = production;
    }
    if (model !== undefined) {
      updateFields.push('model = @model');
      params.model = model;
    }
    if (model_code !== undefined) {
      updateFields.push('model_code = @model_code');
      params.model_code = model_code;
    }
    if (item !== undefined) {
      updateFields.push('item = @item');
      params.item = item;
    }
    if (stock !== undefined) {
      updateFields.push('stock = @stock');
      params.stock = parseInt(stock);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No fields to update' 
      });
    }

    // Execute update
    await query(`
      UPDATE [Backup_hskpro].[dbo].[master_database]
      SET ${updateFields.join(', ')},
          username = @username,
          date_time = GETDATE()
      WHERE original_barcode = @barcode
    `, { ...params, username: req.user.username });

    res.json({
      success: true,
      message: 'Barcode updated successfully'
    });

  } catch (err) {
    console.error('Update barcode error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update barcode', 
      message: err.message 
    });
  }
});

/**
 * DELETE /api/master-data/barcode/:barcode
 * Delete barcode (IT only)
 */
router.delete('/barcode/:barcode', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { barcode } = req.params;

    // Check if barcode exists
    const existing = await query(
      'SELECT original_barcode FROM [Backup_hskpro].[dbo].[master_database] WHERE original_barcode = @barcode',
      { barcode }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'Barcode not found' 
      });
    }

    // Delete barcode
    await query(
      'DELETE FROM [Backup_hskpro].[dbo].[master_database] WHERE original_barcode = @barcode',
      { barcode }
    );

    res.json({
      success: true,
      message: 'Barcode deleted successfully',
      deleted_barcode: barcode
    });

  } catch (err) {
    console.error('Delete barcode error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete barcode', 
      message: err.message 
    });
  }
});

/**
 * GET /api/master-data/filter-options
 * Get dropdown options including size map from database
 */
router.get('/filter-options', verifyToken, async (req, res) => {
  try {
    console.log('📡 Loading filter options with size map from database...');

    // Get models
    const modelsResult = await query(`
      SELECT DISTINCT model FROM [Backup_hskpro].[dbo].[list_model] ORDER BY model
    `);

    // Get sizes with four_digit mapping
    const sizesResult = await query(`
      SELECT size, size_code as four_digit 
      FROM [Backup_hskpro].[dbo].[list_size] 
      ORDER BY size
    `);

    // Get productions
    const productionsResult = await query(`
      SELECT DISTINCT production FROM [Backup_hskpro].[dbo].[list_production] ORDER BY production
    `);

    // Build size map { size: four_digit }
    const sizeMap = {};
    sizesResult.recordset.forEach(row => {
      sizeMap[row.size] = row.four_digit;
    });

    console.log('✅ Filter options loaded with size map:', {
      models: modelsResult.recordset.length,
      sizes: sizesResult.recordset.length,
      productions: productionsResult.recordset.length,
      sizeMapEntries: Object.keys(sizeMap).length
    });

    res.json({
      success: true,
      models: modelsResult.recordset.map(r => r.model),
      sizes: sizesResult.recordset.map(r => r.size),
      productions: productionsResult.recordset.map(r => r.production),
      sizeMap: sizeMap, // ✅ Send size map from database
      brands: ['ADIDAS', 'NEW BALANCE', 'REEBOK', 'ASICS', 'SPECS', 'OTHER BRAND'],
      units: ['PRS', 'PCS'],
      items: ['IP', 'PHYLON', 'BLOKER', 'PAINT', 'RUBBER', 'GOODSOLE']
    });

  } catch (err) {
    console.error('Get filter options error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch filter options', 
      message: err.message 
    });
  }
});

/**
 * GET /api/master-data/model-code/:model
 * Get model code by model name
 */
router.get('/model-code/:model', verifyToken, async (req, res) => {
  try {
    const { model } = req.params;

    const result = await query(`
      SELECT model_code FROM [Backup_hskpro].[dbo].[list_model] WHERE model = @model
    `, { model });

    if (result.recordset.length === 0) {
      return res.json({ 
        success: true,
        model_code: '' 
      });
    }

    res.json({ 
      success: true,
      model_code: result.recordset[0].model_code 
    });

  } catch (err) {
    console.error('Get model code error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch model code', 
      message: err.message 
    });
  }
});

module.exports = router;