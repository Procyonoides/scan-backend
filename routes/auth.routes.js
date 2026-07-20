const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const { writeLog, readLogs } = require('../utils/actAsLogger');
const { verifyLogin } = require('../utils/password');

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
 * Login endpoint. Database stays plain-text (shared with the central
 * system, never modified here) - a local file-based hash cache is used
 * for faster/safer verification on this app's side. See utils/password.js.
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

    // Verify password - checks local hash cache first, falls back to the
    // database's plain-text value (never modifies the database itself,
    // since it's shared with the central/pusat system).
    const passwordMatches = await verifyLogin(username, password, user.password);
    if (!passwordMatches) {
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
 * POST /api/auth/act-as/:userId
 * IT-only: temporarily get a session token for another user's account,
 * WITHOUT knowing or resetting their password. Every state-changing
 * request made with the resulting token is auto-logged (see
 * middleware/auth.middleware.js + utils/actAsLogger.js) so there is a
 * clear audit trail of what IT did on someone else's behalf.
 */
router.post('/act-as/:userId', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);

    const result = await query(
      `SELECT id_user, username, position, description FROM dbo.users WHERE id_user = @id_user`,
      { id_user: targetId }
    );

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const target = result.recordset[0];

    if (target.position === 'IT') {
      return res.status(403).json({ success: false, error: 'Tidak bisa Act-as akun IT lain' });
    }

    // Short-lived token (2 hours) - Act-as is meant for a quick urgent task,
    // not a full shift, so it should expire faster than a normal login.
    const token = jwt.sign(
      {
        id_user: target.id_user,
        username: target.username,
        position: target.position,
        actingAs: true,
        realUsername: req.user.username,
        realPosition: req.user.position
      },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    writeLog({
      event: 'SESSION_START',
      realUser: req.user.username,
      realPosition: req.user.position,
      actingAsUser: target.username,
      actingAsPosition: target.position
    });

    console.log(`🎭 ${req.user.username} (IT) is now acting as ${target.username}`);

    res.json({
      success: true,
      token,
      user: {
        id_user: target.id_user,
        username: target.username,
        position: target.position,
        description: target.description,
        permissions: rolePermissions[target.position] || [],
        actingAs: true,
        realUsername: req.user.username
      }
    });
  } catch (err) {
    console.error('❌ Act-as error:', err);
    res.status(500).json({ success: false, error: 'Failed to act as user', message: err.message });
  }
});

/**
 * POST /api/auth/exit-act-as
 * Just logs that the Act-as session ended. The frontend handles actually
 * switching back to the IT user's own stored token - a JWT can't be
 * "ended" server-side, so this is purely for the audit trail.
 */
router.post('/exit-act-as', verifyToken, (req, res) => {
  if (req.user.actingAs) {
    writeLog({
      event: 'SESSION_END',
      realUser: req.user.realUsername,
      realPosition: req.user.realPosition,
      actingAsUser: req.user.username,
      actingAsPosition: req.user.position
    });
    console.log(`🎭 ${req.user.realUsername} exited Act-as session (was: ${req.user.username})`);
  }
  res.json({ success: true });
});

/**
 * GET /api/auth/act-as-logs
 * IT-only: read the audit trail. Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD.
 */
router.get('/act-as-logs', verifyToken, verifyRole(['IT']), (req, res) => {
  try {
    const { from, to } = req.query;
    const logs = readLogs({ from, to });
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('❌ Read act-as logs error:', err);
    res.status(500).json({ success: false, error: 'Failed to read logs', message: err.message });
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