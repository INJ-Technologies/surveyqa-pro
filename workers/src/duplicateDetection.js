'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// DUPLICATE DETECTION — Prevents same IP and same response pattern
// being submitted more than once for a project.
// ══════════════════════════════════════════════════════════════════════════════

const { pool } = require('../../backend/src/db/index');
const crypto = require('crypto');

// ── Check if IP already used for this project ─────────────────────────────────
const checkDuplicateIP = async (projectId, ipAddress) => {
  if (!ipAddress || !projectId) return false;
  try {
    const r = await pool.query(
      `SELECT id FROM proxy_used_ips WHERE project_id = $1 AND ip_address = $2 LIMIT 1`,
      [projectId, ipAddress]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
};

// ── Build response fingerprint from page answers ──────────────────────────────
// Fingerprint = hash of first 10 radio/checkbox answers in order
// Identical respondents will share fingerprints
const buildResponseFingerprint = (pageHistory) => {
  if (!pageHistory || pageHistory.length === 0) return null;
  const answers = pageHistory
    .filter(h => h.type === 'radio' || h.type === 'checkbox')
    .slice(0, 15)
    .map(h => `${h.page}:${h.answer.slice(0, 50)}`)
    .join('|');
  if (!answers) return null;
  return crypto.createHash('md5').update(answers).digest('hex');
};

// ── Check if fingerprint already exists ──────────────────────────────────────
const checkDuplicateFingerprint = async (projectId, fingerprint) => {
  if (!fingerprint || !projectId) return false;
  try {
    const r = await pool.query(
      `SELECT id FROM response_fingerprints WHERE project_id = $1 AND fingerprint = $2 LIMIT 1`,
      [projectId, fingerprint]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
};

// ── Store fingerprint at session end ─────────────────────────────────────────
const storeResponseFingerprint = async (projectId, sessionId, fingerprint, pageCount) => {
  if (!fingerprint || !projectId) return;
  try {
    await pool.query(
      `INSERT INTO response_fingerprints (project_id, session_id, fingerprint, page_count)
       VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, fingerprint) DO NOTHING`,
      [projectId, sessionId, fingerprint, pageCount]
    );
  } catch {}
};

module.exports = { checkDuplicateIP, buildResponseFingerprint, checkDuplicateFingerprint, storeResponseFingerprint };