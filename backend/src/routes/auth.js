'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { pool } = require('../db/index');
const {
  findUserByEmail,
  createUser,
  updateLastLogin,
} = require('../db/users');
const { generateToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// Creates the first admin user + links to default workspace
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    // Validate input
    if (!email || !password || !fullName) {
      return res.status(400).json({
        error: 'email, password, and fullName are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters'
      });
    }

    // Check if user already exists
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Get the default workspace (created during migration)
    const wsResult = await pool.query(
      `SELECT id FROM workspaces WHERE slug = 'inj-technologies' LIMIT 1`
    );

    if (wsResult.rows.length === 0) {
      return res.status(500).json({ error: 'Default workspace not found' });
    }

    const workspaceId = wsResult.rows[0].id;

    // Check if this is the first user — make them admin
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM users WHERE workspace_id = $1`,
      [workspaceId]
    );
    const isFirstUser = parseInt(countResult.rows[0].count) === 0;

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user = await createUser({
      workspaceId,
      email,
      passwordHash,
      fullName,
      role: isFirstUser ? 'admin' : 'tester',
    });

    // Generate token
    const token = generateToken({ ...user, workspace_id: workspaceId });

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: {
        id:          user.id,
        email:       user.email,
        fullName:    user.full_name,
        role:        user.role,
        workspaceId: user.workspace_id,
      }
    });

  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login timestamp
    await updateLastLogin(user.id);

    // Generate token
    const token = generateToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id:            user.id,
        email:         user.email,
        fullName:      user.full_name,
        role:          user.role,
        workspaceId:   user.workspace_id,
        workspaceName: user.workspace_name,
      }
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
// Returns current logged-in user info (requires token)
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id:            req.user.id,
      email:         req.user.email,
      fullName:      req.user.full_name,
      role:          req.user.role,
      workspaceId:   req.user.workspace_id,
      workspaceName: req.user.workspace_name,
      lastLoginAt:   req.user.last_login_at,
    }
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
// JWT is stateless — logout is handled client-side by deleting the token
// This endpoint exists for audit logging purposes
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs (workspace_id, user_id, action, entity_type)
       VALUES ($1, $2, 'logout', 'auth')`,
      [req.user.workspace_id, req.user.id]
    );
  } catch {
    // Non-critical — don't fail logout if audit log fails
  }
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;