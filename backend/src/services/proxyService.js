'use strict';

const fs = require('fs');

// ─── Helper: Read secret or fallback ──────────────────────────────────────────
const read = (path, fallback = '') => {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return fallback;
  }
};

// ─── Load Decodo credentials ─────────────────────────────────────────────────
const DECODO_USER =
  read('/run/secrets/decodo_proxy_user', process.env.DECODO_USER || '');

const DECODO_PASS =
  read('/run/secrets/decodo_proxy_pass', process.env.DECODO_PASS || '');

// ─── Validate credentials ────────────────────────────────────────────────────
const isProxyConfigured = () => {
  if (!DECODO_USER || !DECODO_PASS) {
    console.warn('[Proxy] Decodo credentials missing — running without proxy');
    return false;
  }
  return true;
};

// ─── Build Decodo proxy config ───────────────────────────────────────────────
// Docs: username[-country=XX][-session=ID][-sessionduration=seconds]
const getDecodoProxy = (options = {}) => {
  const { country = null, sessionId = null } = options;

  if (!isProxyConfigured()) return null;

  // DECODO_USER already contains sessionduration in the secret
  // e.g. "user-INJTechnologies-sessionduration-60"
  // Decodo format: hyphens NOT equals signs
  let username = DECODO_USER;

  if (country)   username += `-country-${country.toLowerCase()}`;
  if (sessionId) username += `-session-${sessionId}`;

  console.log(`[Proxy] Built username: ${username}`);

  return {
    server:   'http://gate.decodo.com:10001',
    username,
    password: DECODO_PASS,
  };
};

// ─── Generic proxy selector (future extensibility) ────────────────────────────
const getProxyForSession = (provider = 'decodo', options = {}) => {
  switch (provider) {
    case 'decodo':
    case 'smartproxy': // backward compatibility
      return getDecodoProxy(options);

    default:
      console.warn(`[Proxy] Unknown provider "${provider}", defaulting to Decodo`);
      return getDecodoProxy(options);
  }
};

module.exports = {
  getDecodoProxy,
  getProxyForSession,
};