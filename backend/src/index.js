'use strict';
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const { testConnection } = require('./db/index');
const { migrate } = require('./db/migrate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── Docker Secret Reader ─────────────────────────────────────────────────
const readSecret = (name) => {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return null;
  }
};

// ─── Routes ──────────────────────────────────────────────────────────────

app.get('/api', (req, res) => {
  res.json({ message: 'SurveyQA Pro API', version: '1.0.0' });
});

app.get('/api/health', async (req, res) => {
  // Test live DB connection on each health check
  let dbStatus = false;
  try {
    const { pool } = require('./db/index');
    await pool.query('SELECT 1');
    dbStatus = true;
  } catch {
    dbStatus = false;
  }

  res.json({
    status: dbStatus ? 'ok' : 'degraded',
    service: 'surveyqa-backend',
    version: '1.0.0',
    time: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database:  dbStatus                            ? '✅ connected' : '❌ failed',
      jwt:       readSecret('surveyqa_jwt_secret')   ? '✅ loaded'    : '❌ missing',
      anthropic: readSecret('anthropic_api_key')     ? '✅ loaded'    : '❌ missing',
      redis:     readSecret('redis_password_secret') ? '✅ loaded'    : '❌ missing',
    }
  });
});

// ─── Startup ─────────────────────────────────────────────────────────────

const start = async () => {

  console.log('═══════════════════════════════════════════');
  console.log('        SurveyQA Pro — Backend');
  console.log('═══════════════════════════════════════════');
  console.log(`  Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Port        : ${PORT}`);

  // 1. Test DB connection (retry up to 10 times — Swarm starts containers in parallel)
  let connected = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    console.log(`  DB connect attempt ${attempt}/10...`);
    connected = await testConnection();
    if (connected) break;
    await new Promise(r => setTimeout(r, 3000)); // wait 3s between retries
  }

  if (!connected) {
    console.error('❌ Could not connect to database after 10 attempts. Exiting.');
    process.exit(1);
  }

  // 2. Run migrations (safe to run every time — uses IF NOT EXISTS)
  await migrate();

  // 3. Start HTTP server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend ready on port ${PORT}`);
    console.log('═══════════════════════════════════════════');
  });
};

start().catch(err => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});