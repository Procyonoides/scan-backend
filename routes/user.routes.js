const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const { verifyLogin, cacheNewPassword } = require('../utils/password');

/**
 * GET /api/users
 * Get all users (IT only) - Updated to include password
 */
router.get('/', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    console.log('📋 Fetching all users...');
    
    const result = await query(`
      SELECT 
        id_user,
        username,
        password,
        position,
        description
      FROM dbo.users
      ORDER BY id_user DESC
    `);
    
    console.log(`✅ Found ${result.recordset.length} users`);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Get users error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch users',
      message: err.message 
    });
  }
});

/**
 * GET /api/users/:id
 * Get single user by ID
 */
router.get('/:id', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📋 Fetching user ID: ${id}`);

    const result = await query(`
      SELECT 
        id_user,
        username,
        position,
        description
      FROM dbo.users
      WHERE id_user = @id_user
    `, { id_user: parseInt(id) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.recordset[0];
    
    res.json({
      id_user: user.id_user,
      user_id: user.id_user,
      username: user.username,
      position: user.position,
      description: user.description,
      email: null,
      full_name: null,
      status: 'ACTIVE'
    });
  } catch (err) {
    console.error('❌ Get user error:', err);
    res.status(500).json({ 
      error: 'Failed to fetch user',
      message: err.message 
    });
  }
});

/**
 * POST /api/users
 * Create new user (IT only) - Plain text password
 */
router.post('/', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { username, password, position, description } = req.body;

    console.log('📝 Creating new user:', username);

    // Validate required fields
    if (!username || !password || !position) {
      return res.status(400).json({ 
        error: 'Username, password, and position are required' 
      });
    }

    // Validate position
    const validPositions = ['IT', 'MANAGEMENT', 'RECEIVING', 'SHIPPING', 'SERVER'];
    if (!validPositions.includes(position)) {
      return res.status(400).json({ 
        error: 'Invalid position. Must be one of: ' + validPositions.join(', ') 
      });
    }

    // Check if username already exists
    const existingUser = await query(
      'SELECT id_user FROM dbo.users WHERE username = @username',
      { username }
    );

    if (existingUser.recordset.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Insert user with plain text password - dbo.users is shared with the
    // central system and must stay untouched/plain text. We still cache
    // a local hash so this app's own login can use it right away.
    await query(`
      INSERT INTO dbo.users (username, password, position, description)
      VALUES (@username, @password, @position, @description)
    `, { 
      username,
      password,
      position,
      description: description || ''
    });
    await cacheNewPassword(username, password);

    console.log('✅ User created successfully:', username);

    res.status(201).json({ 
      success: true,
      message: 'User created successfully',
      user: { username, position }
    });

  } catch (err) {
    console.error('❌ Create user error:', err);
    res.status(500).json({ 
      error: 'Failed to create user',
      message: err.message 
    });
  }
});

/**
 * PUT /api/users/:id
 * Update user (IT only) - Supports password update
 */
router.put('/:id', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { id } = req.params;
    const { position, description, password } = req.body;

    console.log(`📝 Updating user ID: ${id}`);
    console.log(`📋 Request body:`, req.body);

    const userId = parseInt(id);

    // Check if user exists
    const existingUser = await query(
      'SELECT id_user, username FROM dbo.users WHERE id_user = @id_user',
      { id_user: userId }
    );

    if (existingUser.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`👤 Updating user: ${existingUser.recordset[0].username}`);

    // Build dynamic update query
    let updateFields = [];
    let params = { id_user: userId };

    if (position) {
      const validPositions = ['IT', 'MANAGEMENT', 'RECEIVING', 'SHIPPING', 'SERVER'];
      if (!validPositions.includes(position)) {
        return res.status(400).json({ error: 'Invalid position' });
      }
      updateFields.push('position = @position');
      params.position = position;
      console.log(`✏️ Updating position to: ${position}`);
    }

    if (description !== undefined) {
      updateFields.push('description = @description');
      params.description = description;
      console.log(`✏️ Updating description to: ${description}`);
    }

    // CRITICAL: Check password explicitly
    let passwordToCache = null;
    if (password !== undefined && password !== null && password !== '') {
      const passwordStr = String(password).trim();
      if (passwordStr.length > 0) {
        if (passwordStr.length < 3) {
          return res.status(400).json({ error: 'Password must be at least 3 characters' });
        }
        updateFields.push('password = @password');
        params.password = passwordStr; // plain text - dbo.users is shared with the central system
        passwordToCache = passwordStr;
        console.log(`🔐 Password will be updated (length: ${passwordStr.length})`);
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    console.log(`📝 SQL Update fields: ${updateFields.join(', ')}`);

    // Execute update
    const result = await query(`
      UPDATE dbo.users 
      SET ${updateFields.join(', ')}
      WHERE id_user = @id_user
    `, params);

    console.log(`✅ Update executed. Rows affected: ${result.rowsAffected}`);

    if (passwordToCache) {
      await cacheNewPassword(existingUser.recordset[0].username, passwordToCache);
    }

    res.json({ 
      success: true,
      message: 'User updated successfully',
      user_id: userId,
      updated_fields: updateFields
    });

  } catch (err) {
    console.error('❌ Update user error:', err);
    res.status(500).json({ 
      error: 'Failed to update user',
      message: err.message 
    });
  }
});

/**
 * DELETE /api/users/:id
 * Delete user (IT only)
 */
router.delete('/:id', verifyToken, verifyRole(['IT']), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id);

    console.log(`🗑️ Deleting user ID: ${id}`);

    // Prevent deleting yourself
    if (req.user.id_user === userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if user exists
    const existingUser = await query(
      'SELECT id_user, username FROM dbo.users WHERE id_user = @id_user',
      { id_user: userId }
    );

    if (existingUser.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = existingUser.recordset[0].username;

    // Delete user
    await query(
      'DELETE FROM dbo.users WHERE id_user = @id_user',
      { id_user: userId }
    );

    console.log(`✅ User deleted successfully: ${username}`);

    res.json({ 
      success: true,
      message: 'User deleted successfully',
      deleted_user: username
    });

  } catch (err) {
    console.error('❌ Delete user error:', err);
    res.status(500).json({ 
      error: 'Failed to delete user',
      message: err.message 
    });
  }
});

/**
 * PUT /api/users/:id/password
 * Change user password (IT only or own password)
 */
router.put('/:id/password', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { current_password, new_password, confirm_password } = req.body;
    const userId = parseInt(id);

    console.log(`🔐 Password change request for user ID: ${id}`);

    // User can only change their own password, or IT can change any
    if (req.user.id_user !== userId && req.user.position !== 'IT') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Validate new password
    if (!new_password || new_password.length < 3) {
      return res.status(400).json({ error: 'Password must be at least 3 characters' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Get current password
    const userResult = await query(
      'SELECT username, password FROM dbo.users WHERE id_user = @id_user',
      { id_user: userId }
    );

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const targetUsername = userResult.recordset[0].username;

    // If user is changing their own password, verify current password
    if (req.user.id_user === userId) {
      const currentMatches = await verifyLogin(targetUsername, current_password, userResult.recordset[0].password);
      if (!currentMatches) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    // Update password - plain text to the shared database (as always),
    // plus refresh our own local hash cache for fast/safe verification.
    await query(
      'UPDATE dbo.users SET password = @password WHERE id_user = @id_user',
      { password: new_password, id_user: userId }
    );
    await cacheNewPassword(targetUsername, new_password);

    console.log(`✅ Password updated successfully for user ID: ${id}`);

    res.json({ 
      success: true,
      message: 'Password updated successfully' 
    });

  } catch (err) {
    console.error('❌ Change password error:', err);
    res.status(500).json({ 
      error: 'Failed to change password',
      message: err.message 
    });
  }
});

module.exports = router;