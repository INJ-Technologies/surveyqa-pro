'use strict';
const jwt    = require('jsonwebtoken');
const fs     = require('fs');
const { findUserById } = require('../db/users');

const getJwtSecret = () => {
  try {
    return fs.readFileSync('/run/secrets/surveyqa_jwt_secret', 'utf8').trim();
  } catch {
    return process.env.JWT_SECRET || 'dev-secret-change-in-production';
  }
};

// ─── Generate JWT token ───────────────────────────────────────────────────────
const generateToken = (user) => {
  return jwt.sign(
    {
      id:          user.id,
      email:       user.email,
      role:        user.role,
      workspaceId: user.workspace_id,
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
};

// ─── Verify token middleware ──────────────────────────────────────────────────
const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, getJwtSecret());

    // Fetch fresh user from DB on every request
    const user = await findUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    // Attach user to request object for use in routes
    req.user = user;
    next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired — please login again' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── Role guard middleware ────────────────────────────────────────────────────
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied — requires role: ${roles.join(' or ')}`
      });
    }
    next();
  };
};

module.exports = { generateToken, requireAuth, requireRole };