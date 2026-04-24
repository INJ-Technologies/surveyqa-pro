'use strict';
const fs = require('fs');

const read = (path, fallback = '') => {
  try { return fs.readFileSync(path, 'utf8').trim(); } catch { return fallback; }
};

// ─── Decodo (formerly Smartproxy) residential proxy config ───────────────────
const getDecodoProxy = (country = null, sessionId = null) => {
  const user = read('/run/secrets/decodo_proxy_user', process.env.DECODO_USER || '');
  const pass = read('/run/secrets/decodo_proxy_pass', process.env.DECODO_PASS || '');

  if (!user || !pass) {
    console.warn('[Proxy] Decodo credentials not configured — running without proxy');
    return null;
  }

  // Build username with optional country and session ID
  // Format: user-{user}-sessionduration-60[-country-{cc}][-session-{id}]
  let username = user; // e.g. user-INJTechnologies-sessionduration-60

  if (country) {
    username += `-country-${country.toLowerCase()}`;
  }

  if (sessionId) {
    // Use session ID to ensure each concurrent session gets a unique IP
    username += `-session-${sessionId}`;
  }

  return {
    server:   'http://gate.decodo.com:10001',
    username,
    password: pass,
  };
};

// ─── Get proxy for a session ──────────────────────────────────────────────────
const getProxyForSession = (provider, country, sessionId) => {
  switch (provider) {
    case 'decodo':
    case 'smartproxy':
      return getDecodoProxy(country, sessionId);
    default:
      return getDecodoProxy(country, sessionId);
  }
};

module.exports = { getDecodoProxy, getProxyForSession };