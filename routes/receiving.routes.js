const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(`
      SELECT * FROM dbo.receiving
      ORDER BY scan_date DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `, { offset: parseInt(offset), limit: parseInt(limit) });

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan', verifyToken, verifyRole(['RECEIVING']), async (req, res) => {
  try {
    const { original_barcode, model, color, size, quantity, warehouse_id } = req.body;

    await query(`
      INSERT INTO dbo.receiving 
      (warehouse_id, original_barcode, model, color, size, quantity, username, status)
      VALUES (@warehouse_id, @barcode, @model, @color, @size, @quantity, @username, 'IN')
    `, {
      warehouse_id,
      barcode: original_barcode,
      model,
      color,
      size,
      quantity,
      username: req.user.username
    });

    res.json({ message: 'Receiving recorded successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;