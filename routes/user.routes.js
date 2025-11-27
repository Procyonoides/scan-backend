const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const bcrypt = require('bcryptjs');

router.get('/', verifyToken, verifyRole(['SERVER', 'IT']), async (req, res) => {
  try {
    const result = await query('SELECT user_id, username, email, full_name, role, status FROM dbo.users');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', verifyToken, verifyRole(['SERVER', 'IT']), async (req, res) => {
  try {
    const { username, password, email, full_name, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    await query(`
      INSERT INTO dbo.users (username, password, email, full_name, role, status)
      VALUES (@username, @password, @email, @full_name, @role, 'ACTIVE')
    `, { username, password: hashedPassword, email, full_name, role });

    res.json({ message: 'User created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;