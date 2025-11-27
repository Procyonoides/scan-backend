const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');

router.get('/barcodes', verifyToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM dbo.stock');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/barcode', verifyToken, verifyRole(['SERVER', 'IT']), async (req, res) => {
  try {
    const { original_barcode, brand, model, color, size } = req.body;

    await query(`
      INSERT INTO dbo.stock (original_barcode, brand, model, color, size, quantity)
      VALUES (@barcode, @brand, @model, @color, @size, 0)
    `, { barcode: original_barcode, brand, model, color, size });

    res.json({ message: 'Barcode added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;