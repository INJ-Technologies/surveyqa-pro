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

// ─── Read Redis host from Docker secret or env ────────────────────────────────
const getRedisHost = () => {
  const secretHost = readSecret('redis_host');
  if (secretHost) return secretHost;
  return process.env.REDIS_HOST || 'injtech_base_redis';
};

const getRedisUsername = () => {
  const secretUser = readSecret('redis_username');
  if (secretUser) return secretUser;
  return process.env.REDIS_USERNAME || null;
};

const getRedisPassword = () => {
  const secretPass =
    readSecret('redis_password_secret') ||
    readSecret('redis_password') ||
    readSecret('redis_pass');
  if (secretPass) return secretPass;

  const envPass = (process.env.REDIS_PASSWORD || '').trim();
  return envPass ? envPass : null;
};

const redisUsername = getRedisUsername();
const redisPassword = getRedisPassword();

const connection = {
  host: getRedisHost(),
  port: parseInt(process.env.REDIS_PORT) || 6379,
  ...(redisUsername ? { username: redisUsername } : {}),
  ...(redisPassword ? { password: redisPassword } : {}),
};

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
