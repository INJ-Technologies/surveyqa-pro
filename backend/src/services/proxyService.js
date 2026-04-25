'use strict';

const fs = require('fs');

const read = (filePath, fallback = '') => {
  try { return fs.readFileSync(filePath, 'utf8').trim(); } catch { return fallback; }
};

// ─── Load credentials once at startup ────────────────────────────────────────
const DECODO_USER_RAW = read('/run/secrets/decodo_proxy_user', process.env.DECODO_USER || '');
const DECODO_PASS     = read('/run/secrets/decodo_proxy_pass', process.env.DECODO_PASS || '');

// ─── Strip sessionduration from the stored secret if present ─────────────────
// Secret may be stored as "user-INJTechnologies-sessionduration-60"
// We need just "user-INJTechnologies" so we can rebuild the full username
// in the correct parameter order: country → sessionduration → session
const DECODO_USER = DECODO_USER_RAW.replace(/-sessionduration-\d+/gi, '').trim();

console.log(`[Proxy] Raw user from secret: ${DECODO_USER_RAW ? DECODO_USER_RAW.slice(0, 40) + '...' : 'MISSING'}`);
console.log(`[Proxy] Base user (cleaned):  ${DECODO_USER || 'MISSING'}`);
console.log(`[Proxy] Pass loaded:          ${DECODO_PASS ? '***set***' : 'MISSING'}`);

const isProxyConfigured = () => {
  if (!DECODO_USER || !DECODO_PASS) {
    console.warn('[Proxy] Credentials missing — running without proxy');
    return false;
  }
  return true;
};

// ─── Build Decodo proxy config ────────────────────────────────────────────────
// Confirmed working format (from curl test):
//   user-INJTechnologies-country-us-sessionduration-60
// on port 10000 (rotating with country targeting)
//
// Parameter order matters:
//   {base}-country-{cc}-sessionduration-{N}-session-{id}
const getDecodoProxy = (options = {}) => {
  const { country = null, sessionId = null, sessionDuration = 60 } = options;

  if (!isProxyConfigured()) return null;

  let username = DECODO_USER; // e.g. "user-INJTechnologies"

  // 1. Country — must come first
  if (country && country.trim()) {
    username += `-country-${country.toLowerCase().trim()}`;
  }

  // 2. Session duration — always include
  username += `-sessionduration-${sessionDuration}`;

  // 3. Session ID — for IP stickiness within a session
  if (sessionId && sessionId.trim()) {
    username += `-session-${sessionId.trim()}`;
  }

  // Port 10000 = rotating + country targeting (confirmed working)
  // Port 10001 = sticky only, no country targeting on this plan
  const server = country
    ? 'http://gate.decodo.com:10000'
    : 'http://gate.decodo.com:10001';

  console.log(`[Proxy] Built username: ${username}`);
  console.log(`[Proxy] Server:         ${server}`);
  console.log(`[Proxy] Country:        ${country || 'none'}`);

  return { server, username, password: DECODO_PASS };
};

const getProxyForSession = (provider = 'decodo', options = {}) => {
  switch ((provider || 'decodo').toLowerCase()) {
    case 'decodo':
    case 'smartproxy':
      return getDecodoProxy(options);
    default:
      console.warn(`[Proxy] Unknown provider "${provider}" — defaulting to Decodo`);
      return getDecodoProxy(options);
  }
};

module.exports = { getDecodoProxy, getProxyForSession };