'use strict';
const { pool } = require('./index');

const getActiveModels = async (workspaceId) => {
  const { rows } = await pool.query(
    `SELECT * FROM ai_models
     WHERE workspace_id = $1 AND is_active = true
     ORDER BY is_default DESC, created_at ASC`,
    [workspaceId]
  );
  return rows;
};

const getModelById = async (id, workspaceId) => {
  const { rows } = await pool.query(
    `SELECT * FROM ai_models WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
  return rows[0] || null;
};

const getDefaultModel = async (workspaceId) => {
  const { rows } = await pool.query(
    `SELECT * FROM ai_models
     WHERE workspace_id = $1 AND is_default = true AND is_active = true
     LIMIT 1`,
    [workspaceId]
  );
  return rows[0] || null;
};

const activateModel = async ({
  workspaceId, modelId, displayName, provider,
  inputPricePer1m, outputPricePer1m, reasoningPricePer1m,
  contextLength, supportsReasoning, reasoningLevel, notes,
}) => {
  const existing = await pool.query(
    `SELECT id FROM ai_models WHERE workspace_id = $1 AND model_id = $2`,
    [workspaceId, modelId]
  );
  if (existing.rows.length > 0) {
    throw new Error('Model already activated. Use update to modify it.');
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM ai_models WHERE workspace_id = $1 AND is_active = true`,
    [workspaceId]
  );
  const isFirst = parseInt(countResult.rows[0].count) === 0;

  const { rows } = await pool.query(
    `INSERT INTO ai_models (
      workspace_id, model_id, display_name, provider,
      input_price_per_1m, output_price_per_1m, reasoning_price_per_1m,
      context_length, supports_reasoning, reasoning_level, notes, is_default
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *`,
    [
      workspaceId, modelId, displayName, provider,
      inputPricePer1m, outputPricePer1m, reasoningPricePer1m || 0,
      contextLength, supportsReasoning, reasoningLevel, notes, isFirst,
    ]
  );
  return rows[0];
};

const updateModel = async (id, workspaceId, fields) => {
  const allowed = [
    'display_name', 'notes', 'reasoning_level',
    'input_price_per_1m', 'output_price_per_1m', 'reasoning_price_per_1m',
  ];
  const updates = [];
  const values  = [];
  let   idx     = 1;

  for (const [key, val] of Object.entries(fields)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowed.includes(col)) {
      updates.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }
  if (updates.length === 0) return null;

  values.push(id, workspaceId);
  const { rows } = await pool.query(
    `UPDATE ai_models SET ${updates.join(', ')}, updated_at = NOW()
     WHERE id = $${idx++} AND workspace_id = $${idx}
     RETURNING *`,
    values
  );
  return rows[0] || null;
};

const setDefaultModel = async (id, workspaceId) => {
  await pool.query(
    `UPDATE ai_models SET is_default = false WHERE workspace_id = $1`,
    [workspaceId]
  );
  await pool.query(
    `UPDATE ai_models SET is_default = true WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
};

const deactivateModel = async (id, workspaceId) => {
  await pool.query(
    `UPDATE ai_models SET is_active = false, is_default = false
     WHERE id = $1 AND workspace_id = $2`,
    [id, workspaceId]
  );
};

module.exports = {
  getActiveModels, getModelById, getDefaultModel,
  activateModel, updateModel, setDefaultModel, deactivateModel,
};