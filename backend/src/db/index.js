'use strict';
const { Pool } = require('pg');
const fs = require('fs');

const readSecret = (name) => {
  const path = `/run/secrets/${name}`;
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
};

const pool = new Pool({
  host:     readSecret('db_host')              || process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT       || '5432'),
  database: readSecret('surveyqa_db_name')     || process.env.DB_NAME     || 'injtech_surveyqa_db',
  user:     readSecret('surveyqa_db_user')     || process.env.DB_USER     || 'injtech_surveyqa_admin',
  password: readSecret('surveyqa_db_password') || process.env.DB_PASSWORD || '',
  max: 10,                // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// Test connection
const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as time, current_database() as db');
    client.release();
    console.log(`✅ PostgreSQL connected — DB: ${result.rows[0].db} — Time: ${result.rows[0].time}`);
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    return false;
  }
};

module.exports = { pool, testConnection };