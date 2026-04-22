'use strict';
const { Worker } = require('bullmq');
const fs = require('fs');

// ─── Docker Secret Reader ────────────────────────────────────────────────────
const readSecret = (name) => {
  const path = `/run/secrets/${name}`;
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
};

// ─── Config ──────────────────────────────────────────────────────────────────
const redisConfig = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     parseInt(process.env.REDIS_PORT || '6379'),
  password: readSecret('redis_password_secret'),
};

console.log('═══════════════════════════════════════');
console.log('  SurveyQA Pro — Workers Starting');
console.log('═══════════════════════════════════════');
console.log(`  Redis : ${redisConfig.host}:${redisConfig.port}`);
console.log(`  Auth  : ${redisConfig.password ? '✅ password loaded' : '⚠️  no password'}`);
console.log('═══════════════════════════════════════');

// ─── Worker ──────────────────────────────────────────────────────────────────
const worker = new Worker(
  'survey-sessions',
  async (job) => {
    console.log(`[Job ${job.id}] Starting — type: ${job.name}`);
    // Phase 2: Playwright browser automation goes here
    console.log(`[Job ${job.id}] Payload:`, JSON.stringify(job.data, null, 2));
  },
  {
    connection: redisConfig,
    concurrency: 5,
  }
);

worker.on('completed', (job) => {
  console.log(`[Job ${job.id}] ✅ Completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Job ${job.id}] ❌ Failed: ${err.message}`);
});

worker.on('error', (err) => {
  console.error('Worker error:', err.message);
});

console.log('✅ Workers ready — listening on queue: survey-sessions');