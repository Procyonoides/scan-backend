const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await query(
      'SELECT user_id, username, password, role, full_name FROM dbo.users WHERE username = @username AND status = @status',
      { username, status: 'ACTIVE' }
    );

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.recordset[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update last_login
    await query(
      'UPDATE dbo.users SET last_login = GETDATE() WHERE user_id = @user_id',
      { user_id: user.user_id }
    );

    res.json({
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role,
        full_name: user.full_name
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;