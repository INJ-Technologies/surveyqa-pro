'use strict';
const { pool } = require('./index');

// ─── Create a new session ─────────────────────────────────────────────────────
const createSession = async ({
  projectId, workspaceId, personaId,
  surveyUrl, surveyLabel, responseId,
  proxyCountry, proxyProvider,
  deviceType, browserType, aiStrategy, internalTesting = false,
}) => {
  try {
    // In the INSERT query, add internal_testing to columns and values:
    const result = await pool.query(
      `INSERT INTO sessions (
        project_id, workspace_id, persona_id, survey_url, survey_label,
        response_id, proxy_country, proxy_provider, device_type,
        browser_type, ai_strategy, internal_testing, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued')
      RETURNING *`,
      [
        projectId, workspaceId, personaId || null, surveyUrl, surveyLabel || null,
        responseId, proxyCountry || null, proxyProvider || null, deviceType || null,
        browserType || null, aiStrategy || null, internalTesting || false,
      ]
    );
    return result.rows[0];
  } catch (err) {
    // Backward compatible insert for DBs missing the newer columns.
    const msg = (err && err.message) || '';
    if (!msg.includes('workspace_id') && !msg.includes('survey_url') && !msg.includes('response_id')) {
      throw err;
    }

    const result = await pool.query(
      `INSERT INTO sessions (
         project_id, persona_id,
         proxy_country, proxy_provider,
         device_type, browser_type,
         ai_strategy, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'queued')
       RETURNING *`,
      [
        projectId, personaId || null,
        proxyCountry || null, proxyProvider || 'decodo',
        deviceType || 'desktop', browserType || 'chrome',
        aiStrategy || 'persona_true',
      ]
    );
    return result.rows[0];
  }
};

// ─── Update session status ────────────────────────────────────────────────────
const updateSessionStatus = async (id, status, extra = {}) => {
  const updates = { status };
  if (status === 'in_progress') updates.started_at = new Date();
  if (['completed','terminated','over_quota','error'].includes(status)) {
    updates.completed_at = new Date();
  }
  Object.assign(updates, extra);

  const fields = Object.keys(updates).map((k, i) => `${toCol(k)} = $${i + 2}`);
  const values = Object.values(updates);

  await pool.query(
    `UPDATE sessions SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...values]
  );
};

const toCol = (key) => key.replace(/([A-Z])/g, '_$1').toLowerCase();

// ─── Log a session event ──────────────────────────────────────────────────────
const logSessionEvent = async (sessionId, eventType, payload = {}) => {
  try {
    await pool.query(
      `INSERT INTO session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [sessionId, eventType, JSON.stringify(payload)]
    );
  } catch (err) {
    // Backward compatible with older schema using "details" instead of "payload".
    const msg = (err && err.message) || '';
    if (!msg.includes('payload') && !msg.includes('session_events')) throw err;
    await pool.query(
      `INSERT INTO session_events (session_id, event_type, details)
       VALUES ($1, $2, $3)`,
      [sessionId, eventType, JSON.stringify(payload)]
    );
  }
};

// ─── Log a session answer ─────────────────────────────────────────────────────
const logSessionAnswer = async ({
  sessionId, questionId, questionType,
  questionText, answerValue, answerText,
  timeTakenMs, aiGenerated,
}) => {
  await pool.query(
    `INSERT INTO session_answers (
       session_id, question_id, question_type,
       question_text, answer_value, answer_text,
       time_taken_ms, ai_generated
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      sessionId, questionId || null, questionType || null,
      questionText || null, answerValue || null, answerText || null,
      timeTakenMs || null, aiGenerated || false,
    ]
  );
};

// ─── IP tracking ──────────────────────────────────────────────────────────────
const isIPUsedInProject = async (projectId, ipAddress) => {
  const result = await pool.query(
    `SELECT id FROM proxy_used_ips WHERE project_id = $1 AND ip_address = $2`,
    [projectId, ipAddress]
  );
  return result.rows.length > 0;
};

const recordUsedIP = async (projectId, sessionId, ipAddress) => {
  try {
    await pool.query(
      `INSERT INTO proxy_used_ips (project_id, session_id, ip_address)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [projectId, sessionId, ipAddress]
    );
  } catch (err) {
    // Backward compatible with older schema missing session_id.
    const msg = (err && err.message) || '';
    if (!msg.includes('session_id') && !msg.includes('proxy_used_ips')) throw err;
    await pool.query(
      `INSERT INTO proxy_used_ips (project_id, ip_address)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [projectId, ipAddress]
    );
  }
};

// ─── Save trace path ──────────────────────────────────────────────────────────
const saveTracePath = async (sessionId, tracePath) => {
  try {
    await pool.query(
      `UPDATE sessions SET trace_path = $1, updated_at = NOW() WHERE id = $2`,
      [tracePath, sessionId]
    );
  } catch (err) {
    const msg = (err && err.message) || '';
    if (!msg.includes('trace_path') && !msg.includes('sessions')) throw err;
    // Ignore if column doesn't exist (older DB schema).
  }
};

// ─── Get live sessions ────────────────────────────────────────────────────────
const getLiveSessions = async (projectId) => {
  const result = await pool.query(
    `SELECT s.*, p.name as persona_name
     FROM sessions s
     LEFT JOIN personas p ON p.id = s.persona_id
     WHERE s.project_id = $1
     AND s.status IN ('queued','initialising','in_progress')
     ORDER BY s.created_at DESC`,
    [projectId]
  );
  return result.rows;
};

// ─── Get full session detail ──────────────────────────────────────────────────
const getSessionDetail = async (sessionId) => {
  const sessionResult = await pool.query(
    `SELECT s.*,
            p.name             as persona_name,
            p.country          as persona_country,
            p.device_type      as persona_device,
            p.behavioural_attrs as persona_attrs
     FROM sessions s
     LEFT JOIN personas p ON p.id = s.persona_id
     WHERE s.id = $1`,
    [sessionId]
  );
  if (!sessionResult.rows[0]) return null;
  const session = sessionResult.rows[0];

  const eventsResult = await pool.query(
    `SELECT * FROM session_events WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );

  const answersResult = await pool.query(
    `SELECT * FROM session_answers WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );

  const events = (eventsResult.rows || []).map((e) => ({
    ...e,
    payload: e.payload ?? e.details ?? {},
  }));

  return { session, events, answers: answersResult.rows };
};

module.exports = {
  createSession, updateSessionStatus, logSessionEvent,
  logSessionAnswer, isIPUsedInProject, recordUsedIP,
  saveTracePath, getLiveSessions, getSessionDetail,
};
