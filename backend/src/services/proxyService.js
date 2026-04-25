'use strict';

const fs  = require('fs');
const { pool } = require('../db/index');

const read = (filePath, fallback = '') => {
  try { return fs.readFileSync(filePath, 'utf8').trim(); } catch { return fallback; }
};

const DECODO_USER_RAW = read('/run/secrets/decodo_proxy_user', process.env.DECODO_USER || '');
const DECODO_PASS     = read('/run/secrets/decodo_proxy_pass', process.env.DECODO_PASS || '');

// Strip any sessionduration already in the secret so we rebuild it correctly
const DECODO_USER = DECODO_USER_RAW.replace(/-sessionduration-\d+/gi, '').trim();

console.log(`[Proxy] Base user: ${DECODO_USER || 'MISSING'}`);
console.log(`[Proxy] Pass:      ${DECODO_PASS ? '***set***' : 'MISSING'}`);

const isProxyConfigured = () => {
  if (!DECODO_USER || !DECODO_PASS) {
    console.warn('[Proxy] Credentials missing — running without proxy');
    return false;
  }
  return true;
};

// ─── Look up country config from DB ──────────────────────────────────────────
const getCountryConfig = async (code) => {
  if (!code) return null;
  try {
    const result = await pool.query(
      `SELECT code, endpoint, port FROM proxy_countries WHERE code = $1 AND status = 1`,
      [code.toUpperCase()]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.warn(`[Proxy] DB lookup failed for country ${code}:`, err.message);
    return null;
  }
};

// ─── Build Decodo proxy config using country-specific endpoint ────────────────
//
// Two connection modes depending on country:
//
// Mode A — Country has own endpoint (e.g. fr.decodo.com:40000):
//   server:   http://fr.decodo.com:40000
//   username: user-INJTechnologies-sessionduration-60-session-{id}
//   (no country in username — endpoint already targets the country)
//
// Mode B — Country uses gate.decodo.com:10000:
//   server:   http://gate.decodo.com:10000
//   username: user-INJTechnologies-country-{cc}-sessionduration-60-session-{id}
//
const getDecodoProxy = async (options = {}) => {
  const { country = null, sessionId = null, sessionDuration = 60 } = options;

  if (!isProxyConfigured()) return null;

  let server, username;

  if (country) {
    const cfg = await getCountryConfig(country);

    if (cfg && cfg.endpoint && cfg.port) {
      const isGate = cfg.endpoint === 'gate.decodo.com';

      if (isGate) {
        // Mode B — use gate with country in username
        server   = `http://gate.decodo.com:${cfg.port}`;
        username = DECODO_USER;
        username += `-country-${country.toLowerCase()}`;
        username += `-sessionduration-${sessionDuration}`;
        if (sessionId) username += `-session-${sessionId}`;
      } else {
        // Mode A — use country-specific endpoint, no country in username
        server   = `http://${cfg.endpoint}:${cfg.port}`;
        username = DECODO_USER;
        username += `-sessionduration-${sessionDuration}`;
        if (sessionId) username += `-session-${sessionId}`;
      }

      console.log(`[Proxy] Mode: ${isGate ? 'B (gate+country)' : 'A (dedicated endpoint)'}`);
    } else {
      // Country not found in DB — fallback to gate with country param
      console.warn(`[Proxy] Country ${country} not found in DB — using gate fallback`);
      server   = 'http://gate.decodo.com:10000';
      username = DECODO_USER;
      username += `-country-${country.toLowerCase()}`;
      username += `-sessionduration-${sessionDuration}`;
      if (sessionId) username += `-session-${sessionId}`;
    }
  } else {
    // No country — use sticky session on gate
    server   = 'http://gate.decodo.com:10001';
    username = DECODO_USER;
    username += `-sessionduration-${sessionDuration}`;
    if (sessionId) username += `-session-${sessionId}`;
  }

  console.log(`[Proxy] Server:   ${server}`);
  console.log(`[Proxy] Username: ${username}`);
  console.log(`[Proxy] Country:  ${country || 'none'}`);
  console.log(`[Proxy] TEST CMD: curl -x "http://${username}:PASS@${server.replace('http://', '')}" https://ip.decodo.com/json`);

  return { server, username, password: DECODO_PASS };
};

// ─── Sync wrapper for non-async callers — returns promise ────────────────────
const getProxyForSession = (provider = 'decodo', options = {}) => {
  const p = (provider || 'decodo').toLowerCase();
  if (p === 'decodo' || p === 'smartproxy') {
    return getDecodoProxy(options); // returns Promise
  }
  console.warn(`[Proxy] Unknown provider "${provider}" — defaulting to Decodo`);
  return getDecodoProxy(options);
};

module.exports = { getDecodoProxy, getProxyForSession };