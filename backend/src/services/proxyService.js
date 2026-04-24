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
  const {
    country = null,          // e.g. "US", "IN"
    sessionId = null,        // unique session id
    sessionDuration = 60     // seconds (optional)
  } = options;

  if (!isProxyConfigured()) return null;

  let username = DECODO_USER;

  // Ensure session duration exists (recommended)
  if (sessionDuration) {
    username += `-sessionduration=${sessionDuration}`;
  }

  // Country targeting
  if (country) {
    username += `-country=${country.toLowerCase()}`;
  }

  // Sticky session
  if (sessionId) {
    username += `-session=${sessionId}`;
  }

  return {
    server: 'http://gate.decodo.com:10001',
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