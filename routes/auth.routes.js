const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

/**
 * Role-based permissions mapping
 */
const rolePermissions = {
  'IT': ['read_all', 'write_all', 'delete_all', 'admin', 'manage_users', 'manage_master_data'],
  'MANAGEMENT': ['read_all', 'view_reports'],
  'RECEIVING': ['read', 'receive_scan', 'view_stock'],
  'SHIPPING': ['read', 'shipping_scan', 'view_stock']
};

/**
 * POST /api/auth/login
 * Login endpoint dengan plain text password
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validasi manual
    if (!username || !password) {
      console.log('❌ Username atau password kosong');
      return res.status(400).json({ 
        success: false,
        error: 'Username dan password harus diisi'
      });
    }

    console.log(`🔐 Login attempt: ${username}`);

    // Cari user di database
    const result = await query(
      `SELECT id_user, username, password, position, description
       FROM dbo.users 
       WHERE username = @username`,
      { username }
    );

    if (result.recordset.length === 0) {
      console.log(`❌ User tidak ditemukan: ${username}`);
      return res.status(401).json({ 
        success: false,
        error: 'Invalid username or password'
      });
    }

    const user = result.recordset[0];

    console.log(`✅ User found: ${user.username}, Position: ${user.position}`);

    // Verify password - Plain text comparison
    if (password !== user.password) {
      console.log(`❌ Password mismatch for user: ${username}`);
      return res.status(401).json({ 
        success: false,
        error: 'Invalid username or password' 
      });
    }

    console.log(`✅ Password valid for user: ${username}`);

    // Generate JWT token
    const token = jwt.sign(
      { 
        id_user: user.id_user, 
        username: user.username, 
        position: user.position 
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    console.log(`✅ Token generated for user: ${username}`);

    // Prepare response dengan permissions
    const responseData = {
      success: true,
      token,
      user: {
        id_user: user.id_user,
        username: user.username,
        position: user.position,
        description: user.description,
        permissions: rolePermissions[user.position] || []
      }
    };

    console.log(`✅ Login successful for user: ${username}\n`);
    res.json(responseData);

  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Login failed',
      message: err.message 
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh token endpoint
 */
router.post('/refresh', (req, res) => {
  try {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false,
        error: 'No token provided' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    
    const newToken = jwt.sign(
      { 
        id_user: decoded.id_user, 
        username: decoded.username, 
        position: decoded.position 
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ 
      success: true,
      token: newToken 
    });

  } catch (err) {
    res.status(401).json({ 
      success: false,
      error: 'Invalid token' 
    });
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
      return res.status(401).json({ 
        success: false,
        valid: false, 
        error: 'No token provided' 
      });
    }

    jwt.verify(token, process.env.JWT_SECRET);
    res.json({ 
      success: true,
      valid: true 
    });

  } catch (err) {
    res.status(401).json({ 
      success: false,
      valid: false, 
      error: 'Invalid or expired token' 
    });
  }
});

module.exports = router;