'use strict';
const { Queue } = require('bullmq');
const fs = require('fs');

// ─── Read Redis host from Docker secret or env ────────────────────────────────
const getRedisHost = () => {
  try { return fs.readFileSync('/run/secrets/redis_host', 'utf8').trim(); } catch {}
  return process.env.REDIS_HOST || 'injtech_base_redis';
};

const connection = {
  host: getRedisHost(),
  port: parseInt(process.env.REDIS_PORT) || 6379,
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