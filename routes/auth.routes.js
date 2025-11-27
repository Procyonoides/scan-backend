const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { loginValidation } = require('../middleware/validation.middleware');

/**
 * Role-based permissions mapping
 */
const rolePermissions = {
  'SERVER': ['read_all', 'write_all', 'delete_all', 'admin', 'manage_users', 'manage_master_data'],
  'IT': ['read_all', 'write_all', 'delete_all', 'manage_users', 'manage_master_data'],
  'MANAGEMENT': ['read_all', 'view_reports'],
  'RECEIVING': ['read', 'receive_scan', 'view_stock'],
  'SHIPPING': ['read', 'shipping_scan', 'view_stock']
};

/**
 * POST /api/auth/login
 * Login endpoint dengan role-based response
 */
router.post('/login', loginValidation, async (req, res) => {
  try {
    const { username, password } = req.body;

    // Cari user di database
    const result = await query(
      'SELECT user_id, username, password, role, full_name, email FROM dbo.users WHERE username = @username AND status = @status',
      { username, status: 'ACTIVE' }
    );

    if (result.recordset.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.recordset[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        user_id: user.user_id, 
        username: user.username, 
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' } // Changed from 24h untuk security
    );

    // Update last_login
    await query(
      'UPDATE dbo.users SET last_login = GETDATE() WHERE user_id = @user_id',
      { user_id: user.user_id }
    );

    // Prepare response dengan permissions
    res.json({
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        permissions: rolePermissions[user.role] || []
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh token endpoint (untuk future implementation)
 */
router.post('/refresh', (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Verify token (even if expired)
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    
    // Generate new token
    const newToken = jwt.sign(
      { 
        user_id: decoded.user_id, 
        username: decoded.username, 
        role: decoded.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token: newToken });

  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * GET /api/auth/verify
 * Verify token validity
 */
router.get('/verify', (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ valid: false, error: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true });

  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

module.exports = router;