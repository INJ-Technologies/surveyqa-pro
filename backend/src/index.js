'use strict';
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── Docker Secret Reader ────────────────────────────────────────────────────
// Reads a value from /run/secrets/<name> — the standard Docker Swarm secret path
const readSecret = (name) => {
  const path = `/run/secrets/${name}`;
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
};

// ─── Config (resolved at startup) ───────────────────────────────────────────
const config = {
  db: {
    host:     readSecret('db_host')            || 'localhost',
    port:     5432,
    database: readSecret('surveyqa_db_name')   || 'injtech_surveyqa_db',
    user:     readSecret('surveyqa_db_user')   || 'injtech_surveyqa_admin',
    password: readSecret('surveyqa_db_password') || '',
  },
  redis: {
    host:     process.env.REDIS_HOST           || 'localhost',
    port:     parseInt(process.env.REDIS_PORT  || '6379'),
    password: readSecret('redis_password_secret'),
  },
  jwt: {
    secret:   readSecret('surveyqa_jwt_secret'),
  },
  anthropic: {
    apiKey:   readSecret('anthropic_api_key'),
  },
};

// Log startup config (never log actual secret values)
console.log('═══════════════════════════════════════');
console.log('  SurveyQA Pro — Backend Starting');
console.log('═══════════════════════════════════════');
console.log(`  Environment : ${process.env.NODE_ENV || 'development'}`);
console.log(`  Port        : ${PORT}`);
console.log(`  DB Host     : ${config.db.host}`);
console.log(`  DB Name     : ${config.db.database}`);
console.log(`  DB User     : ${config.db.user}`);
console.log(`  Redis Host  : ${config.redis.host}:${config.redis.port}`);
console.log(`  JWT Secret  : ${config.jwt.secret ? '✅ loaded' : '❌ missing'}`);
console.log(`  Anthropic   : ${config.anthropic.apiKey ? '✅ loaded' : '❌ missing'}`);
console.log('═══════════════════════════════════════');

// ─── Routes ─────────────────────────────────────────────────────────────────

// Health check — confirms service is running and secrets loaded
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'surveyqa-backend',
    version: '1.0.0',
    time: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    secrets: {
      db:        config.db.password    ? '✅' : '❌',
      jwt:       config.jwt.secret     ? '✅' : '❌',
      anthropic: config.anthropic.apiKey ? '✅' : '❌',
      redis:     config.redis.password ? '✅' : '❌',
    }
  });
});

app.get('/api', (req, res) => {
  res.json({ message: 'SurveyQA Pro API' });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend listening on port ${PORT}`);
});