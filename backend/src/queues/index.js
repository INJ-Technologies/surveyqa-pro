'use strict';
const { Queue } = require('bullmq');
const fs = require('fs');

const readSecret = (name) => {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return null;
  }
};

const readFileTrim = (filePath) => {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
};

const readEnvTrim = (...keys) => {
  for (const key of keys) {
    const value = (process.env[key] || '').trim();
    if (value) return value;
  }
  return null;
};

// ─── Read Redis host from Docker secret or env ────────────────────────────────
const getRedisHost = () => {
  const fromFile = readFileTrim(process.env.REDIS_HOST_FILE);
  if (fromFile) return fromFile;
  const secretHost = readSecret('redis_host');
  if (secretHost) return secretHost;
  return readEnvTrim('REDIS_HOST') || 'injtech_base_redis';
};

const getRedisUsername = () => {
  const fromFile = readFileTrim(process.env.REDIS_USERNAME_FILE);
  if (fromFile) return fromFile;
  const secretUser = readSecret('redis_username');
  if (secretUser) return secretUser;
  return (
    readEnvTrim('REDIS_USERNAME', 'REDIS_USER', 'REDISUSER', 'redis_username') ||
    null
  );
};

const getRedisPassword = () => {
  const fromFile = readFileTrim(process.env.REDIS_PASSWORD_FILE);
  if (fromFile) return fromFile;

  const secretPass =
    readSecret('redis_password_secret') ||
    readSecret('redis_password') ||
    readSecret('redis_pass');
  if (secretPass) return secretPass;

  const envPass = readEnvTrim(
    'REDIS_PASSWORD',
    'REDIS_PASS',
    'REDIS_AUTH',
    'REDIS_PASSWORD_SECRET',
    'redis_password_secret',
  );
  return envPass ? envPass : null;
};

const redisUsername = getRedisUsername();
const redisPassword = getRedisPassword();
const redisHost = getRedisHost();
const redisPortString =
  readFileTrim(process.env.REDIS_PORT_FILE) ||
  readSecret('redis_port') ||
  readEnvTrim('REDIS_PORT', 'redis_port');
const redisPort = parseInt(redisPortString, 10) || 6379;

const connection = {
  host: redisHost,
  port: redisPort,
  ...(redisUsername ? { username: redisUsername } : {}),
  ...(redisPassword ? { password: redisPassword } : {}),
};

console.log(
  `[Redis] host=${connection.host} port=${connection.port} username=${redisUsername ? 'set' : 'none'} password=${redisPassword ? 'set' : 'none'}`,
);

if (!redisPassword) {
  console.warn(
    `[Redis] No password configured (host=${connection.host} port=${connection.port}). If your Redis requires auth, set REDIS_PASSWORD (or mount /run/secrets/redis_password_secret).`,
  );
}

// ─── Session queue ────────────────────────────────────────────────────────────
const sessionQueue = new Queue('survey-sessions', {
  connection,
  defaultJobOptions: {
    attempts:    3,
    backoff:     { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 200 },
  },
});

module.exports = { sessionQueue, connection };
