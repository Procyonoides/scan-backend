const express = require('express');
const router = express.Router();
const { query, dbName } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const multer = require('multer');
const XLSX = require('xlsx');

/**
 * GET /api/master-data/barcodes
 * Get all barcodes with pagination and search
 */
router.get('/barcodes', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
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
      `SELECT COUNT(*) as total FROM [${dbName}].[dbo].[master_database] ${searchCondition}`,
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
      FROM [${dbName}].[dbo].[master_database]
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
router.get('/barcode/:barcode', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
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
      FROM [${dbName}].[dbo].[master_database]
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
      `SELECT original_barcode FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`,
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
      INSERT INTO [${dbName}].[dbo].[master_database]
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
      `SELECT original_barcode FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`,
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
      UPDATE [${dbName}].[dbo].[master_database]
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
      `SELECT original_barcode FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`,
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
      `DELETE FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`,
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
 * POST /api/master-data/batch-delete
 * Delete multiple barcodes at once (IT only)
 */
router.post('/batch-delete', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { barcodes } = req.body;

    // Validate input
    if (!barcodes || !Array.isArray(barcodes) || barcodes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input. Expected array of barcodes'
      });
    }

    if (barcodes.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Too many barcodes. Maximum 100 barcodes per batch'
      });
    }

    console.log(`🗑️ Batch delete request: ${barcodes.length} barcodes`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const deletedBarcodes = [];

    // Process each barcode
    for (const barcode of barcodes) {
      try {
        // Check if barcode exists
        const existing = await query(
          `SELECT original_barcode FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`,
          { barcode: barcode.trim() }
        );

        if (existing.recordset.length === 0) {
          errors.push(`Barcode ${barcode} not found`);
          errorCount++;
          continue;
        }

        // Delete barcode
        await query(
          `DELETE FROM [${dbName}].[dbo].[master_database] WHERE original_barcode = @barcode`,
          { barcode: barcode.trim() }
        );

        deletedBarcodes.push(barcode);
        successCount++;
      } catch (err) {
        errors.push(`${barcode}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`✅ Batch delete complete: ${successCount} deleted, ${errorCount} errors`);

    res.json({
      success: true,
      message: `Batch delete completed: ${successCount} barcodes deleted, ${errorCount} errors`,
      successCount,
      errorCount,
      deletedBarcodes,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error('Batch delete error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to batch delete barcodes',
      message: err.message
    });
  }
});

/**
 * GET /api/master-data/filter-options
 * Get dropdown options including size map from database
 */
router.get('/filter-options', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    console.log('📡 Loading filter options with size map from database...');

    // Get models
    const modelsResult = await query(`
      SELECT DISTINCT model FROM [${dbName}].[dbo].[list_model] ORDER BY model
    `);

    // Get sizes with four_digit mapping
    const sizesResult = await query(`
      SELECT size, size_code as four_digit 
      FROM [${dbName}].[dbo].[list_size] 
      ORDER BY size
    `);

    // Get productions
    const productionsResult = await query(`
      SELECT DISTINCT production FROM [${dbName}].[dbo].[list_production] ORDER BY production
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
router.get('/model-code/:model', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { model } = req.params;

    const result = await query(`
      SELECT model_code FROM [${dbName}].[dbo].[list_model] WHERE model = @model
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

// ==================== FILE UPLOAD ENDPOINTS ====================

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only Excel (.xlsx, .xls) and CSV files are allowed.'));
    }
  }
});

/**
 * POST /api/master-data/reset-stock
 * Reset all stock to 0
 * ✅ SESUAI PHP: controller_monitoring->resets()
 */
router.post('/reset-stock', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    console.log('🔄 Resetting all stock values to 0');

    await query(`
      UPDATE [${dbName}].[dbo].[master_database] 
      SET stock = 0
    `);

    console.log('✅ Stock reset successful');

    res.json({
      success: true,
      message: 'All stock values have been reset to 0'
    });

  } catch (err) {
    console.error('❌ Reset stock error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to reset stock',
      message: err.message
    });
  }
});

/**
 * POST /api/master-data/import-barcode
 * Import barcodes from Excel file
 */
router.post('/import-barcode', verifyToken, verifyRole(['IT']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    console.log('📥 Importing barcodes from file:', req.file.originalname);

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Excel file is empty'
      });
    }

    console.log(`📊 Found ${data.length} records to import`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each row
    for (let i = 0; i < data.length; i++) {
      try {
        const row = data[i];

        // Validate required fields
        if (!row.original_barcode || !row.brand || !row.color || !row.size) {
          errors.push(`Row ${i + 1}: Missing required fields (barcode, brand, color, size)`);
          errorCount++;
          continue;
        }

        // Check if barcode already exists
        const checkResult = await query(`
          SELECT COUNT(*) as count FROM [${dbName}].[dbo].[master_database] 
          WHERE original_barcode = @barcode
        `, { barcode: row.original_barcode.toString().trim() });

        if (checkResult.recordset[0].count > 0) {
          errors.push(`Row ${i + 1}: Barcode ${row.original_barcode} already exists`);
          errorCount++;
          continue;
        }

        // Get model code if model is provided
        let modelCode = '';
        if (row.model) {
          const modelResult = await query(`
            SELECT model_code FROM [${dbName}].[dbo].[list_model] WHERE model = @model
          `, { model: row.model.toString().trim() });
          modelCode = modelResult.recordset[0]?.model_code || '';
        }

        // Insert barcode
        await query(`
          INSERT INTO [${dbName}].[dbo].[master_database]
          (original_barcode, brand, color, size, four_digit, unit, quantity, 
           production, model, model_code, item, username, date_time, stock)
          VALUES 
          (@barcode, @brand, @color, @size, @four_digit, @unit, @quantity,
           @production, @model, @model_code, @item, @username, GETDATE(), @stock)
        `, {
          barcode: row.original_barcode.toString().trim(),
          brand: (row.brand || '').toString().trim().toUpperCase(),
          color: (row.color || '').toString().trim().toUpperCase(),
          size: (row.size || '').toString().trim(),
          four_digit: (row.four_digit || '').toString().trim(),
          unit: (row.unit || 'PCS').toString().trim(),
          quantity: parseInt(row.quantity || 0),
          production: (row.production || '').toString().trim(),
          model: (row.model || '').toString().trim(),
          model_code: modelCode,
          item: (row.item || '').toString().trim(),
          username: req.user.username,
          stock: parseInt(row.stock || 0)
        });

        successCount++;
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`✅ Import complete: ${successCount} success, ${errorCount} errors`);

    res.json({
      success: true,
      message: `Import completed: ${successCount} records imported, ${errorCount} errors`,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error('❌ Import barcode error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to import barcodes',
      message: err.message
    });
  }
});

/**
 * POST /api/master-data/import-stock-opname
 * Import stock opname data from Excel file
 * ✅ Hanya extract column A (original_barcode) dan N (stock)
 */
router.post('/import-stock-opname', verifyToken, verifyRole(['IT']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    console.log('📥 Importing stock opname from file:', req.file.originalname);

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Excel file is empty'
      });
    }

    console.log(`📊 Found ${data.length} records to process`);
    console.log('📋 First row keys:', Object.keys(data[0]));
    console.log('📋 First row data:', data[0]);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each row
    for (let i = 0; i < data.length; i++) {
      try {
        const row = data[i];

        // ✅ Get column A (original_barcode) dan stock column (flexible: can be C, N, or any column)
        // Excel data will be parsed with headers, so we need to check the actual keys
        const keys = Object.keys(row);

        // Try to find barcode column (could be 'A', 'original_barcode', or first column)
        let barcode = row['A'] || row['original_barcode'] || row[keys[0]];

        // Try to find stock column (multiple fallbacks: N, C, stock, Stock)
        let stock = row['N'] || row['C'] || row['stock'] || row['Stock'] || row[keys[1]] || row[keys[2]];

        if (!barcode) {
          errors.push(`Row ${i + 1}: Missing barcode in column A`);
          errorCount++;
          continue;
        }

        if (stock === undefined || stock === null || stock === '') {
          errors.push(`Row ${i + 1}: Missing stock value. Expected in column C, N, or with header "stock". Row data: ${JSON.stringify(row)}`);
          errorCount++;
          continue;
        }

        barcode = barcode.toString().trim();
        stock = parseInt(stock) || 0;

        // Check if barcode exists
        const checkResult = await query(`
          SELECT COUNT(*) as count FROM [${dbName}].[dbo].[master_database] 
          WHERE original_barcode = @barcode
        `, { barcode });

        if (checkResult.recordset[0].count === 0) {
          errors.push(`Row ${i + 1}: Barcode ${barcode} not found in system`);
          errorCount++;
          continue;
        }

        // Update stock untuk barcode tersebut
        await query(`
          UPDATE [${dbName}].[dbo].[master_database]
          SET stock = @stock
          WHERE original_barcode = @barcode
        `, {
          barcode,
          stock
        });

        console.log(`✅ Updated stock for ${barcode}: ${stock}`);
        successCount++;
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err.message}`);
        errorCount++;
        console.error(`❌ Row ${i + 1} error:`, err.message);
      }
    }

    console.log(`✅ Stock opname import complete: ${successCount} success, ${errorCount} errors`);
    if (errors.length > 0) {
      console.log('📋 Errors:', errors);
    }

    res.json({
      success: true,
      message: `Import completed: ${successCount} barcodes updated, ${errorCount} errors`,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error('❌ Import stock opname error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to import stock opname',
      message: err.message
    });
  }
});

// ==================== OPERATION ENDPOINTS ====================

/**
 * GET /api/master-data/records
 * Get transaction records from data_receiving or data_shipping
 */
router.get('/records', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { type, startDate, endDate, username, scanNo, page = 1, limit = 50 } = req.query;

    if (!type || !['receiving', 'shipping'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid record type' });
    }

    const archiveTable = type === 'receiving' ? 'data_receiving' : 'data_shipping';
    const backupTable = type === 'receiving' ? 'backup_receiving' : 'backup_shipping';

    const columns = 'original_barcode, brand, model, color, size, quantity, username, description, scan_no, date_time';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const baseSubquery = `
      SELECT ${columns} FROM [${dbName}].[dbo].[${type}]
      UNION ALL
      SELECT ${columns} FROM [${dbName}].[dbo].[${archiveTable}]
      UNION ALL
      SELECT ${columns} FROM [${dbName}].[dbo].[${backupTable}]
    `;

    let whereClause = ' WHERE 1=1';
    const params = { limit: parseInt(limit), offset: parseInt(offset) };

    if (startDate && endDate) {
      whereClause += ` AND date_time BETWEEN @startDate AND @endDate`;
      params.startDate = `${startDate} 00:00:00`;
      params.endDate = `${endDate} 23:59:59`;
    }

    if (username) {
      whereClause += ` AND username = @username`;
      params.username = username;
    }

    if (scanNo) {
      whereClause += ` AND scan_no = @scanNo`;
      params.scanNo = scanNo;
    }

    // 1. Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${baseSubquery}) as records ${whereClause}`;
    const countResult = await query(countQuery, params);
    const total = countResult.recordset[0].total;

    // 2. Get paginated data
    const dataQuery = `
      SELECT original_barcode, brand, model, color, size, quantity, username, 
             description, scan_no, CONVERT(varchar, date_time, 120) as date_time
      FROM (${baseSubquery}) as combined_records
      ${whereClause}
      ORDER BY date_time DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `;

    console.log(`📡 Fetching records for type: ${type} (Page: ${page}, Limit: ${limit}, Total: ${total})`);

    const result = await query(dataQuery, params);

    res.json({
      success: true,
      data: result.recordset,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit)
    });

  } catch (err) {
    console.error('Get records error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch records', message: err.message });
  }
});

router.put('/record', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { type, dateTime, scanNo, oldUsername, quantity, username, description } = req.body;

    if (!type || !['receiving', 'shipping'].includes(type) || !dateTime || !scanNo || !oldUsername) {
      return res.status(400).json({ success: false, error: 'Missing unique identifiers (type, dateTime, scanNo, oldUsername)' });
    }

    const activeTable = type;
    const archiveTable = type === 'receiving' ? 'data_receiving' : 'data_shipping';
    const backupTable = type === 'receiving' ? 'backup_receiving' : 'backup_shipping';

    const updateSql = `
      SET quantity = @quantity,
          username = @username,
          description = @description
      WHERE date_time = @dateTime AND scan_no = @scanNo AND username = @oldUsername
    `;

    const params = {
      dateTime,
      scanNo: parseInt(scanNo),
      oldUsername,
      quantity: parseInt(quantity),
      username,
      description
    };

    // Update in all tiers (one will have it)
    await query(`UPDATE [${dbName}].[dbo].[${activeTable}] ${updateSql}`, params);
    await query(`UPDATE [${dbName}].[dbo].[${archiveTable}] ${updateSql}`, params);
    await query(`UPDATE [${dbName}].[dbo].[${backupTable}] ${updateSql}`, params);

    res.json({ success: true, message: 'Record updated successfully' });

  } catch (err) {
    console.error('Update record error:', err);
    res.status(500).json({ success: false, error: 'Failed to update record', message: err.message });
  }
});

/**
 * DELETE /api/master-data/record/:no
 * Delete a specific transaction record (IT only)
 */
router.delete('/record', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { type, dateTime, scanNo, username } = req.query;

    if (!type || !['receiving', 'shipping'].includes(type) || !dateTime || !scanNo || !username) {
      return res.status(400).json({ success: false, error: 'Missing unique identifiers' });
    }

    const activeTable = type;
    const archiveTable = type === 'receiving' ? 'data_receiving' : 'data_shipping';
    const backupTable = type === 'receiving' ? 'backup_receiving' : 'backup_shipping';

    const deleteSql = `WHERE date_time = @dateTime AND scan_no = @scanNo AND username = @username`;
    const params = { dateTime, scanNo: parseInt(scanNo), username };

    await query(`DELETE FROM [${dbName}].[dbo].[${activeTable}] ${deleteSql}`, params);
    await query(`DELETE FROM [${dbName}].[dbo].[${archiveTable}] ${deleteSql}`, params);
    await query(`DELETE FROM [${dbName}].[dbo].[${backupTable}] ${deleteSql}`, params);

    res.json({ success: true, message: 'Record deleted successfully' });

  } catch (err) {
    console.error('Delete record error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete record', message: err.message });
  }
});

/**
 * POST /api/master-data/backup
 * Move old records to backup tables (IT only)
 */
router.post('/backup', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { type } = req.body;
    if (!type || !['receiving', 'shipping'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid type' });
    }

    const activeTable = type === 'receiving' ? 'data_receiving' : 'data_shipping';
    const backupTable = type === 'receiving' ? 'backup_receiving' : 'backup_shipping';

    // Backup date: Start of current year 07:30:00
    const backupDate = `${new Date().getFullYear()}-01-01 07:30:00`;

    console.log(`📦 Archiving ${type} data older than ${backupDate}`);

    // Insert into backup table
    await query(`
      INSERT INTO [${dbName}].[dbo].[${backupTable}]
      SELECT * FROM [${dbName}].[dbo].[${activeTable}]
      WHERE date_time < @backupDate
    `, { backupDate });

    // Delete from active table
    const deleteResult = await query(`
      DELETE FROM [${dbName}].[dbo].[${activeTable}]
      WHERE date_time < @backupDate
    `, { backupDate });

    res.json({
      success: true,
      message: `Archived ${deleteResult.rowsAffected[0]} records to ${backupTable}`
    });

  } catch (err) {
    console.error('Backup error:', err);
    res.status(500).json({ success: false, error: 'Backup failed', message: err.message });
  }
});

/**
 * POST /api/master-data/duplicate
 * Remove duplicate records from data_receiving or data_shipping (IT only)
 */
router.post('/duplicate', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { type, startDate, endDate } = req.body;
    if (!type || !['receiving', 'shipping'].includes(type) || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Missing type, startDate, or endDate' });
    }

    const tableName = type === 'receiving' ? 'data_receiving' : 'data_shipping';
    const startRange = `${startDate} 07:00:00`;
    const endRange = `${endDate} 06:59:59`;

    console.log(`🧹 Deduplicating ${type} records between ${startRange} and ${endRange}`);

    // Single atomic statement - no temp table, no risk of the delete
    // and re-insert landing on different pooled connections (which was
    // the old approach's danger: the delete could succeed while the
    // re-insert from a #temp table silently failed on a different
    // connection, permanently losing the data).
    const result = await query(`
      WITH cte AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY original_barcode, brand, color, size, four_digit, unit, quantity,
                       production, model, model_code, item, date_time, scan_no, username, description
          ORDER BY (SELECT NULL)
        ) AS rn
        FROM [${dbName}].[dbo].[${tableName}]
        WHERE date_time BETWEEN @startRange AND @endRange
      )
      DELETE FROM cte WHERE rn > 1
    `, { startRange, endRange });

    res.json({ success: true, message: `Deduplication complete. Removed ${result.rowsAffected[0]} duplicate row(s).` });

  } catch (err) {
    console.error('Duplicate error:', err);
    res.status(500).json({ success: false, error: 'Deduplication failed', message: err.message });
  }
});

module.exports = router;