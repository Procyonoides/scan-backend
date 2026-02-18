const express = require('express');
const router = express.Router();
const { query, dbName } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

// ==================== MODEL ROUTES ====================

/**
 * GET /api/options/models
 * Get all models with pagination
 */
router.get('/models', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    console.log('📋 Fetching models with pagination:', { page: pageNum, limit: limitNum, search });

    let searchCondition = '';
    let params = { offset: offsetNum, limit: limitNum };

    if (search && search.trim() !== '') {
      searchCondition = `WHERE model_code LIKE @search OR model LIKE @search`;
      params.search = `%${search.trim()}%`;
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM [${dbName}].[dbo].[list_model] ${searchCondition}`,
      search && search.trim() !== '' ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data with pagination
    const result = await query(`
      SELECT model_code, model
      FROM [${dbName}].[dbo].[list_model]
      ${searchCondition}
      ORDER BY model_code
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    console.log(`✅ Found ${result.recordset.length} models (Total: ${total})`);

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
    console.error('❌ Get models error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch models',
      message: err.message
    });
  }
});

/**
 * POST /api/options/models
 * Create new model (IT only)
 */
router.post('/models', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { model_code, model } = req.body;

    if (!model_code || !model) {
      return res.status(400).json({
        success: false,
        error: 'Model code and model name are required'
      });
    }

    console.log('📝 Creating model:', model_code);

    // Check if model_code exists
    const existing = await query(
      'SELECT model_code FROM [${dbName}].[dbo].[list_model] WHERE model_code = @code',
      { code: model_code }
    );

    if (existing.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Model code already exists'
      });
    }

    // Insert
    await query(`
      INSERT INTO [${dbName}].[dbo].[list_model] (model_code, model)
      VALUES (@code, @model)
    `, { code: model_code, model });

    console.log('✅ Model created:', model_code);
    res.status(201).json({
      success: true,
      message: 'Model created successfully'
    });
  } catch (err) {
    console.error('❌ Create model error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to create model',
      message: err.message
    });
  }
});

/**
 * PUT /api/options/models/:code
 * Update model (IT only)
 */
router.put('/models/:code', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { code } = req.params;
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({
        success: false,
        error: 'Model name is required'
      });
    }

    console.log('📝 Updating model:', code);

    // Check if exists
    const existing = await query(
      'SELECT model_code FROM [${dbName}].[dbo].[list_model] WHERE model_code = @code',
      { code }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Model not found'
      });
    }

    // Update
    await query(`
      UPDATE [${dbName}].[dbo].[list_model]
      SET model = @model
      WHERE model_code = @code
    `, { code, model });

    console.log('✅ Model updated:', code);
    res.json({
      success: true,
      message: 'Model updated successfully'
    });
  } catch (err) {
    console.error('❌ Update model error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update model',
      message: err.message
    });
  }
});

/**
 * DELETE /api/options/models/:code
 * Delete model (IT only)
 */
router.delete('/models/:code', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { code } = req.params;

    console.log('🗑️ Deleting model:', code);

    // Check if exists
    const existing = await query(
      'SELECT model_code FROM [${dbName}].[dbo].[list_model] WHERE model_code = @code',
      { code }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Model not found'
      });
    }

    // Delete
    await query(
      'DELETE FROM [${dbName}].[dbo].[list_model] WHERE model_code = @code',
      { code }
    );

    console.log('✅ Model deleted:', code);
    res.json({
      success: true,
      message: 'Model deleted successfully'
    });
  } catch (err) {
    console.error('❌ Delete model error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete model',
      message: err.message
    });
  }
});

/**
 * POST /api/options/models/batch-delete
 * Batch delete models (IT only)
 */
router.post('/models/batch-delete', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { codes } = req.body;

    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Codes array is required'
      });
    }

    console.log('🗑️ Batch deleting models:', codes.length);

    // SQL Server doesn't support arrays directly in IN clause easily with mssql library mapping
    // We'll construct the query dynamically with parameters
    const params = {};
    const placeholders = codes.map((code, i) => {
      const paramName = `code${i}`;
      params[paramName] = code;
      return `@${paramName}`;
    }).join(',');

    await query(
      `DELETE FROM [${dbName}].[dbo].[list_model] WHERE model_code IN (${placeholders})`,
      params
    );

    console.log(`✅ Batch deleted ${codes.length} models`);
    res.json({
      success: true,
      message: `${codes.length} models deleted successfully`,
      count: codes.length
    });
  } catch (err) {
    console.error('❌ Batch delete models error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to batch delete models',
      message: err.message
    });
  }
});

// ==================== SIZE ROUTES ====================

/**
 * GET /api/options/sizes
 * Get all sizes with pagination
 */
router.get('/sizes', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    console.log('📋 Fetching sizes with pagination:', { page: pageNum, limit: limitNum, search });

    let searchCondition = '';
    let params = { offset: offsetNum, limit: limitNum };

    if (search && search.trim() !== '') {
      searchCondition = `WHERE size_code LIKE @search OR size LIKE @search`;
      params.search = `%${search.trim()}%`;
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM [${dbName}].[dbo].[list_size] ${searchCondition}`,
      search && search.trim() !== '' ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data with pagination
    const result = await query(`
      SELECT size_code, size
      FROM [${dbName}].[dbo].[list_size]
      ${searchCondition}
      ORDER BY size_code
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    console.log(`✅ Found ${result.recordset.length} sizes (Total: ${total})`);

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
    console.error('❌ Get sizes error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sizes',
      message: err.message
    });
  }
});

/**
 * POST /api/options/sizes
 * Create new size (IT only)
 */
router.post('/sizes', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { size_code, size } = req.body;

    if (!size_code || !size) {
      return res.status(400).json({
        success: false,
        error: 'Size code and size are required'
      });
    }

    console.log('📝 Creating size:', size_code);

    const existing = await query(
      'SELECT size_code FROM [${dbName}].[dbo].[list_size] WHERE size_code = @code',
      { code: size_code }
    );

    if (existing.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Size code already exists'
      });
    }

    await query(`
      INSERT INTO [${dbName}].[dbo].[list_size] (size_code, size)
      VALUES (@code, @size)
    `, { code: size_code, size });

    console.log('✅ Size created:', size_code);
    res.status(201).json({
      success: true,
      message: 'Size created successfully'
    });
  } catch (err) {
    console.error('❌ Create size error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to create size',
      message: err.message
    });
  }
});

/**
 * PUT /api/options/sizes/:code
 * Update size (IT only)
 */
router.put('/sizes/:code', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { code } = req.params;
    const { size } = req.body;

    if (!size) {
      return res.status(400).json({
        success: false,
        error: 'Size is required'
      });
    }

    console.log('📝 Updating size:', code);

    const existing = await query(
      'SELECT size_code FROM [${dbName}].[dbo].[list_size] WHERE size_code = @code',
      { code }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Size not found'
      });
    }

    await query(`
      UPDATE [${dbName}].[dbo].[list_size]
      SET size = @size
      WHERE size_code = @code
    `, { code, size });

    console.log('✅ Size updated:', code);
    res.json({
      success: true,
      message: 'Size updated successfully'
    });
  } catch (err) {
    console.error('❌ Update size error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update size',
      message: err.message
    });
  }
});

/**
 * DELETE /api/options/sizes/:code
 * Delete size (IT only)
 */
router.delete('/sizes/:code', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { code } = req.params;

    console.log('🗑️ Deleting size:', code);

    const existing = await query(
      'SELECT size_code FROM [${dbName}].[dbo].[list_size] WHERE size_code = @code',
      { code }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Size not found'
      });
    }

    await query(
      'DELETE FROM [${dbName}].[dbo].[list_size] WHERE size_code = @code',
      { code }
    );

    console.log('✅ Size deleted:', code);
    res.json({
      success: true,
      message: 'Size deleted successfully'
    });
  } catch (err) {
    console.error('❌ Delete size error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete size',
      message: err.message
    });
  }
});

/**
 * POST /api/options/sizes/batch-delete
 * Batch delete sizes (IT only)
 */
router.post('/sizes/batch-delete', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { codes } = req.body;

    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Codes array is required'
      });
    }

    console.log('🗑️ Batch deleting sizes:', codes.length);

    const params = {};
    const placeholders = codes.map((code, i) => {
      const paramName = `code${i}`;
      params[paramName] = code;
      return `@${paramName}`;
    }).join(',');

    await query(
      `DELETE FROM [${dbName}].[dbo].[list_size] WHERE size_code IN (${placeholders})`,
      params
    );

    console.log(`✅ Batch deleted ${codes.length} sizes`);
    res.json({
      success: true,
      message: `${codes.length} sizes deleted successfully`,
      count: codes.length
    });
  } catch (err) {
    console.error('❌ Batch delete sizes error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to batch delete sizes',
      message: err.message
    });
  }
});

// ==================== PRODUCTION ROUTES ====================

/**
 * GET /api/options/productions
 * Get all productions with pagination
 */
router.get('/productions', verifyToken, verifyRole(['IT', 'MANAGEMENT']), async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offsetNum = (pageNum - 1) * limitNum;

    console.log('📋 Fetching productions with pagination:', { page: pageNum, limit: limitNum, search });

    let searchCondition = '';
    let params = { offset: offsetNum, limit: limitNum };

    if (search && search.trim() !== '') {
      searchCondition = `WHERE production_code LIKE @search OR production LIKE @search`;
      params.search = `%${search.trim()}%`;
    }

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM [${dbName}].[dbo].[list_production] ${searchCondition}`,
      search && search.trim() !== '' ? { search: params.search } : {}
    );
    const total = countResult.recordset[0].total;

    // Get data with pagination
    const result = await query(`
      SELECT production_code, production
      FROM [${dbName}].[dbo].[list_production]
      ${searchCondition}
      ORDER BY production_code
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, params);

    console.log(`✅ Found ${result.recordset.length} productions (Total: ${total})`);

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
    console.error('❌ Get productions error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch productions',
      message: err.message
    });
  }
});

/**
 * POST /api/options/productions
 * Create new production (IT only)
 */
router.post('/productions', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { production_code, production } = req.body;

    if (!production_code || !production) {
      return res.status(400).json({
        success: false,
        error: 'Production code and production are required'
      });
    }

    console.log('📝 Creating production:', production_code);

    const existing = await query(
      'SELECT production_code FROM [${dbName}].[dbo].[list_production] WHERE production_code = @code',
      { code: production_code }
    );

    if (existing.recordset.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Production code already exists'
      });
    }

    await query(`
      INSERT INTO [${dbName}].[dbo].[list_production] (production_code, production)
      VALUES (@code, @production)
    `, { code: production_code, production });

    console.log('✅ Production created:', production_code);
    res.status(201).json({
      success: true,
      message: 'Production created successfully'
    });
  } catch (err) {
    console.error('❌ Create production error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to create production',
      message: err.message
    });
  }
});

/**
 * PUT /api/options/productions/:code
 * Update production (IT only)
 */
router.put('/productions/:code', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { code } = req.params;
    const { production } = req.body;

    if (!production) {
      return res.status(400).json({
        success: false,
        error: 'Production is required'
      });
    }

    console.log('📝 Updating production:', code);

    const existing = await query(
      'SELECT production_code FROM [${dbName}].[dbo].[list_production] WHERE production_code = @code',
      { code }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Production not found'
      });
    }

    await query(`
      UPDATE [${dbName}].[dbo].[list_production]
      SET production = @production
      WHERE production_code = @code
    `, { code, production });

    console.log('✅ Production updated:', code);
    res.json({
      success: true,
      message: 'Production updated successfully'
    });
  } catch (err) {
    console.error('❌ Update production error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update production',
      message: err.message
    });
  }
});

/**
 * DELETE /api/options/productions/:code
 * Delete production (IT only)
 */
router.delete('/productions/:code', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { code } = req.params;

    console.log('🗑️ Deleting production:', code);

    const existing = await query(
      'SELECT production_code FROM [${dbName}].[dbo].[list_production] WHERE production_code = @code',
      { code }
    );

    if (existing.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Production not found'
      });
    }

    await query(
      'DELETE FROM [${dbName}].[dbo].[list_production] WHERE production_code = @code',
      { code }
    );

    console.log('✅ Production deleted:', code);
    res.json({
      success: true,
      message: 'Production deleted successfully'
    });
  } catch (err) {
    console.error('❌ Delete production error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to delete production',
      message: err.message
    });
  }
});

/**
 * POST /api/options/productions/batch-delete
 * Batch delete productions (IT only)
 */
router.post('/productions/batch-delete', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { codes } = req.body;

    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Codes array is required'
      });
    }

    console.log('🗑️ Batch deleting productions:', codes.length);

    const params = {};
    const placeholders = codes.map((code, i) => {
      const paramName = `code${i}`;
      params[paramName] = code;
      return `@${paramName}`;
    }).join(',');

    await query(
      `DELETE FROM [${dbName}].[dbo].[list_production] WHERE production_code IN (${placeholders})`,
      params
    );

    console.log(`✅ Batch deleted ${codes.length} productions`);
    res.json({
      success: true,
      message: `${codes.length} productions deleted successfully`,
      count: codes.length
    });
  } catch (err) {
    console.error('❌ Batch delete productions error:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to batch delete productions',
      message: err.message
    });
  }
});

module.exports = router;