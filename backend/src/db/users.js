'use strict';
const { pool } = require('./index');

// ─── Find user by email ───────────────────────────────────────────────────────
const findUserByEmail = async (email) => {
  const result = await pool.query(
    `SELECT u.*, w.name as workspace_name, w.slug as workspace_slug
     FROM users u
     LEFT JOIN workspaces w ON w.id = u.workspace_id
     WHERE u.email = $1 AND u.is_active = true
     LIMIT 1`,
    [email.toLowerCase().trim()]
  );
  return result.rows[0] || null;
};

// ─── Find user by ID ──────────────────────────────────────────────────────────
const findUserById = async (id) => {
  const result = await pool.query(
    `SELECT u.*, w.name as workspace_name, w.slug as workspace_slug
     FROM users u
     LEFT JOIN workspaces w ON w.id = u.workspace_id
     WHERE u.id = $1 AND u.is_active = true
     LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
};

// ─── Create user ──────────────────────────────────────────────────────────────
const createUser = async ({ workspaceId, email, passwordHash, fullName, role }) => {
  const result = await pool.query(
    `INSERT INTO users (workspace_id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, full_name, role, workspace_id, created_at`,
    [workspaceId, email.toLowerCase().trim(), passwordHash, fullName, role || 'tester']
  );
  return result.rows[0];
};

// ─── Update last login ────────────────────────────────────────────────────────
const updateLastLogin = async (userId) => {
  await pool.query(
    `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
    [userId]
  );
};

// ─── Get all users in workspace ───────────────────────────────────────────────
const getUsersByWorkspace = async (workspaceId) => {
  const result = await pool.query(
    `SELECT id, email, full_name, role, is_active, last_login_at, created_at
     FROM users
     WHERE workspace_id = $1
     ORDER BY created_at DESC`,
    [workspaceId]
  );
  return result.rows;
};

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  updateLastLogin,
  getUsersByWorkspace,
};