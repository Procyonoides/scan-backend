const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { verifyToken, verifyRole } = require('../middleware/auth.middleware');
const bcrypt = require('bcryptjs');
const { 
  createUserValidation, 
  updateUserValidation 
} = require('../middleware/validation.middleware');

/**
 * GET /api/users
 * Get all users (SERVER, IT only)
 */
router.get('/', verifyToken, verifyRole(['SERVER', 'IT']), async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        user_id, 
        username, 
        email, 
        full_name, 
        role, 
        status,
        last_login,
        CONVERT(varchar, created_at, 120) as created_at
      FROM dbo.users
      ORDER BY user_id DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/users/:id
 * Get single user by ID
 */
router.get('/:id', verifyToken, verifyRole(['SERVER', 'IT']), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT 
        user_id, 
        username, 
        email, 
        full_name, 
        role, 
        status,
        last_login,
        CONVERT(varchar, created_at, 120) as created_at
      FROM dbo.users
      WHERE user_id = @user_id
    `, { user_id: parseInt(id) });

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * POST /api/users
 * Create new user (SERVER, IT only)
 */
router.post('/', verifyToken, verifyRole(['SERVER', 'IT']), createUserValidation, async (req, res) => {
  try {
    const { username, password, email, full_name, role } = req.body;

    // Check if username already exists
    const existingUser = await query(
      'SELECT user_id FROM dbo.users WHERE username = @username',
      { username }
    );

    if (existingUser.recordset.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Check if email already exists
    const existingEmail = await query(
      'SELECT user_id FROM dbo.users WHERE email = @email',
      { email }
    );

    if (existingEmail.recordset.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    await query(`
      INSERT INTO dbo.users (username, password, email, full_name, role, status, created_at)
      VALUES (@username, @password, @email, @full_name, @role, 'ACTIVE', GETDATE())
    `, { 
      username, 
      password: hashedPassword, 
      email, 
      full_name, 
      role 
    });

    res.status(201).json({ 
      message: 'User created successfully',
      user: { username, email, full_name, role }
    });

  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PUT /api/users/:id
 * Update user (SERVER, IT only)
 */
router.put('/:id', verifyToken, verifyRole(['SERVER', 'IT']), updateUserValidation, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, full_name, role, status } = req.body;
    const userId = parseInt(id);

    // Check if user exists
    const existingUser = await query(
      'SELECT user_id FROM dbo.users WHERE user_id = @user_id',
      { user_id: userId }
    );

    if (existingUser.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build dynamic update query
    let updateFields = [];
    let params = { user_id: userId };

    if (email) {
      // Check if email already exists for another user
      const emailCheck = await query(
        'SELECT user_id FROM dbo.users WHERE email = @email AND user_id != @user_id',
        { email, user_id: userId }
      );
      if (emailCheck.recordset.length > 0) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      updateFields.push('email = @email');
      params.email = email;
    }

    if (full_name) {
      updateFields.push('full_name = @full_name');
      params.full_name = full_name;
    }

    if (role) {
      updateFields.push('role = @role');
      params.role = role;
    }

    if (status) {
      updateFields.push('status = @status');
      params.status = status;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Execute update
    await query(`
      UPDATE dbo.users 
      SET ${updateFields.join(', ')}
      WHERE user_id = @user_id
    `, params);

    res.json({ 
      message: 'User updated successfully',
      user_id: userId
    });

  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /api/users/:id
 * Delete user (SERVER only)
 */
router.delete('/:id', verifyToken, verifyRole(['SERVER']), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = parseInt(id);

    // Prevent deleting yourself
    if (req.user.user_id === userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if user exists
    const existingUser = await query(
      'SELECT user_id, username FROM dbo.users WHERE user_id = @user_id',
      { user_id: userId }
    );

    if (existingUser.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = existingUser.recordset[0].username;

    // Delete user
    await query(
      'DELETE FROM dbo.users WHERE user_id = @user_id',
      { user_id: userId }
    );

    res.json({ 
      message: 'User deleted successfully',
      deleted_user: username
    });

  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * PUT /api/users/:id/password
 * Change user password
 */
router.put('/:id/password', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { current_password, new_password, confirm_password } = req.body;
    const userId = parseInt(id);

    // User can only change their own password, or admin can change any
    if (req.user.user_id !== userId && req.user.role !== 'SERVER') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Validate new password
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Get current password hash
    const userResult = await query(
      'SELECT password FROM dbo.users WHERE user_id = @user_id',
      { user_id: userId }
    );

    if (userResult.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If user is changing their own password, verify current password
    if (req.user.user_id === userId) {
      const isPasswordValid = await bcrypt.compare(current_password, userResult.recordset[0].password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await query(
      'UPDATE dbo.users SET password = @password WHERE user_id = @user_id',
      { password: hashedPassword, user_id: userId }
    );

    res.json({ message: 'Password updated successfully' });

  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;