'use strict';
// backend/src/db/scenarios.js

const { pool } = require('./index');

// ─── Get all scenarios for a project ─────────────────────────────────────────
const getProjectScenarios = async (projectId) => {
  const result = await pool.query(
    `SELECT
       s.*,
       u.full_name                                        AS created_by_name,
       sess.id                                            AS source_session_id,
       (SELECT COUNT(*) FROM scenario_steps ss
        WHERE ss.scenario_id = s.id)::int                AS step_count,
       ps.is_active                                       AS project_active
     FROM scenarios s
     LEFT JOIN users u         ON u.id    = s.created_by
     LEFT JOIN sessions sess   ON sess.id = s.source_session_id
     LEFT JOIN project_scenarios ps
                               ON ps.scenario_id = s.id
                               AND ps.project_id = $1
     WHERE s.project_id = $1
     ORDER BY s.created_at DESC`,
    [projectId]
  );
  return result.rows;
};

// ─── Get single scenario with steps ──────────────────────────────────────────
const getScenarioById = async (scenarioId) => {
  const scenario = await pool.query(
    `SELECT s.*, u.full_name AS created_by_name
     FROM scenarios s
     LEFT JOIN users u ON u.id = s.created_by
     WHERE s.id = $1`,
    [scenarioId]
  );
  if (!scenario.rows[0]) return null;

  const steps = await pool.query(
    `SELECT * FROM scenario_steps
     WHERE scenario_id = $1
     ORDER BY step_order ASC`,
    [scenarioId]
  );

  return {
    ...scenario.rows[0],
    steps: steps.rows.map(r => ({
      ...r,
      conditions:    typeof r.conditions    === 'string' ? JSON.parse(r.conditions)    : r.conditions    || [],
      action_values: typeof r.action_values === 'string' ? JSON.parse(r.action_values) : r.action_values || [],
    })),
  };
};

// ─── Create scenario ──────────────────────────────────────────────────────────
const createScenario = async ({ projectId, workspaceId, name, description, expectedOutcome, sourceSessionId, createdBy, steps = [], countryMapping = null }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const scenRes = await client.query(
      `INSERT INTO scenarios
         (project_id, workspace_id, name, description, expected_outcome, source_session_id, created_by, country_mapping)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [projectId, workspaceId, name, description || null, expectedOutcome || 'any', sourceSessionId || null, createdBy,
       countryMapping ? JSON.stringify(countryMapping) : null]
    );
    const scenario = scenRes.rows[0];

    // Insert steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await client.query(
        `INSERT INTO scenario_steps
           (scenario_id, step_order, when_type, when_value, conditions, action, action_values, action_mode, action_text, duration_s)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          scenario.id, i + 1,
          step.when_type, step.when_value || null,
          JSON.stringify(step.conditions    || []),
          step.action,
          JSON.stringify(step.action_values || []),
          step.action_mode  || null,
          step.action_text  || null,
          step.duration_s   || null,
        ]
      );
    }

    // Link to project
    await client.query(
      `INSERT INTO project_scenarios (project_id, scenario_id, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (project_id, scenario_id) DO NOTHING`,
      [projectId, scenario.id]
    );

    await client.query('COMMIT');
    return getScenarioById(scenario.id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Update scenario ──────────────────────────────────────────────────────────
const updateScenario = async (scenarioId, { name, description, expectedOutcome, isActive, steps, countryMapping }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE scenarios SET
         name             = COALESCE($2, name),
         description      = COALESCE($3, description),
         expected_outcome = COALESCE($4, expected_outcome),
         country_mapping  = COALESCE($5, country_mapping),
         updated_at       = NOW()
       WHERE id = $1`,
      [scenarioId, name, description, expectedOutcome, countryMapping !== undefined ? JSON.stringify(countryMapping) : null]
    );

    if (isActive !== undefined) {
      await client.query(
        `UPDATE project_scenarios SET is_active = $2 WHERE scenario_id = $1`,
        [scenarioId, isActive]
      );
    }

    if (steps !== undefined) {
      // Replace all steps
      await client.query(`DELETE FROM scenario_steps WHERE scenario_id = $1`, [scenarioId]);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await client.query(
          `INSERT INTO scenario_steps
             (scenario_id, step_order, when_type, when_value, conditions, action, action_values, action_mode, action_text, duration_s)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            scenarioId, i + 1,
            step.when_type, step.when_value || null,
            JSON.stringify(step.conditions    || []),
            step.action,
            JSON.stringify(step.action_values || []),
            step.action_mode  || null,
            step.action_text  || null,
            step.duration_s   || null,
          ]
        );
      }
    }

    await client.query('COMMIT');
    return getScenarioById(scenarioId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Delete scenario ──────────────────────────────────────────────────────────
const deleteScenario = async (scenarioId) => {
  await pool.query(`DELETE FROM scenarios WHERE id = $1`, [scenarioId]);
};

// ─── Duplicate scenario ───────────────────────────────────────────────────────
const duplicateScenario = async (scenarioId, createdBy) => {
  const original = await getScenarioById(scenarioId);
  if (!original) throw new Error('Scenario not found');
  return createScenario({
    projectId:       original.project_id,
    workspaceId:     original.workspace_id,
    name:            `Copy of ${original.name}`,
    description:     original.description,
    expectedOutcome: original.expected_outcome,
    createdBy,
    steps:           original.steps,
  });
};

// ─── Get active scenarios for a project (used by worker) ─────────────────────
const getActiveScenarios = async (projectId) => {
  const result = await pool.query(
    `SELECT s.*, ss_agg.steps
     FROM scenarios s
     JOIN project_scenarios ps ON ps.scenario_id = s.id AND ps.project_id = $1 AND ps.is_active = true
     LEFT JOIN LATERAL (
       SELECT json_agg(ss ORDER BY ss.step_order) AS steps
       FROM scenario_steps ss WHERE ss.scenario_id = s.id
     ) ss_agg ON true
     WHERE s.project_id = $1 AND s.is_active = true
     ORDER BY s.created_at ASC`,
    [projectId]
  );
  return result.rows;
};

const getScenariosByIds = async (ids) => {
  if (!ids || ids.length === 0) return [];
  const result = await pool.query(
    `SELECT * FROM scenarios WHERE id = ANY($1)`,
    [ids]
  );
  return result.rows.map(r => ({
    ...r,
    country_mapping: typeof r.country_mapping === 'string' ? JSON.parse(r.country_mapping) : r.country_mapping,
  }));
};

module.exports = {
  getProjectScenarios,
  getScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
  duplicateScenario,
  getActiveScenarios,
  getScenariosByIds,
};