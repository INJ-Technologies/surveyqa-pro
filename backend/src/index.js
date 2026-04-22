'use strict';
const express        = require('express');
const cors           = require('cors');
const fs             = require('fs');
const { testConnection } = require('./db/index');
const { migrate }        = require('./db/migrate');

// ─── Routes ──────────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ─── Secret reader ────────────────────────────────────────────────────────────
const readSecret = (name) => {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return null;
  }
};

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    const { pool } = require('./db/index');
    await pool.query('SELECT 1');
    dbOk = true;
  } catch { dbOk = false; }

  res.json({
    status:      dbOk ? 'ok' : 'degraded',
    service:     'surveyqa-backend',
    version:     '1.0.0',
    time:        new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database:  dbOk                                ? '✅ connected' : '❌ failed',
      jwt:       readSecret('surveyqa_jwt_secret')   ? '✅ loaded'    : '❌ missing',
      anthropic: readSecret('anthropic_api_key')     ? '✅ loaded'    : '❌ missing',
      redis:     readSecret('redis_password_secret') ? '✅ loaded'    : '❌ missing',
    }
  });
});

app.get('/api', (req, res) => {
  res.json({ message: 'SurveyQA Pro API', version: '1.0.0' });
});

// ─── Mount routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
const start = async () => {
  console.log('═══════════════════════════════════════════');
  console.log('        SurveyQA Pro — Backend');
  console.log('═══════════════════════════════════════════');
  console.log(`  Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Port        : ${PORT}`);

  // Retry DB connection — Swarm starts containers in parallel
  let connected = false;
  for (let i = 1; i <= 10; i++) {
    console.log(`  DB connect attempt ${i}/10...`);
    connected = await testConnection();
    if (connected) break;
    await new Promise(r => setTimeout(r, 3000));
  }

  if (!connected) {
    console.error('❌ Could not connect to database. Exiting.');
    process.exit(1);
  }

  // Run migrations (safe — uses IF NOT EXISTS)
  await migrate();

  // Start server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend ready on port ${PORT}`);
    console.log('═══════════════════════════════════════════');
  });
};

start().catch(err => {
  console.error('Fatal startup error:', err.message);
  process.exit(1);
});