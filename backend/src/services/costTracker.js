'use strict';
const { pool } = require('../db/index');

// ─── Calculate cost for a single AI call ─────────────────────────────────────
const calculateCallCost = (inputTokens, outputTokens, model) => {
  const inputCost  = (inputTokens  / 1_000_000) * parseFloat(model.input_price_per_1m  || 0);
  const outputCost = (outputTokens / 1_000_000) * parseFloat(model.output_price_per_1m || 0);
  return {
    input_tokens:  inputTokens,
    output_tokens: outputTokens,
    cost_usd:      inputCost + outputCost,
    input_cost:    inputCost,
    output_cost:   outputCost,
  };
};

// ─── Record cost after a single AI call ──────────────────────────────────────
// Called after EVERY question is answered by AI
const recordAICall = async ({ sessionId, usage, model }) => {
  if (!usage || !sessionId) return null;

  const inputTokens  = usage.prompt_tokens     || usage.input_tokens     || 0;
  const outputTokens = usage.completion_tokens || usage.output_tokens    || 0;

  if (inputTokens === 0 && outputTokens === 0) return null;

  const cost = calculateCallCost(inputTokens, outputTokens, model);

  // Atomically increment session running totals — safe for parallel sessions
  await pool.query(
    `UPDATE sessions SET
       input_tokens_total  = COALESCE(input_tokens_total,  0) + $1,
       output_tokens_total = COALESCE(output_tokens_total, 0) + $2,
       ai_calls_count      = COALESCE(ai_calls_count,      0) + 1,
       ai_cost_usd         = COALESCE(ai_cost_usd,         0) + $3,
       model_used          = $4
     WHERE id = $5`,
    [inputTokens, outputTokens, cost.cost_usd, model.model_id || model.id, sessionId]
  );

  return cost;
};

// ─── Get running cost totals for a session ────────────────────────────────────
const getSessionCost = async (sessionId) => {
  const { rows } = await pool.query(
    `SELECT
       input_tokens_total,
       output_tokens_total,
       ai_calls_count,
       ai_cost_usd,
       model_used
     FROM sessions WHERE id = $1`,
    [sessionId]
  );
  return rows[0] || null;
};

// ─── Calculate project-level cost summary ─────────────────────────────────────
const getProjectCostSummary = async (projectId) => {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                              AS total_sessions,
       SUM(ai_calls_count)                   AS total_ai_calls,
       SUM(input_tokens_total)               AS total_input_tokens,
       SUM(output_tokens_total)              AS total_output_tokens,
       SUM(ai_cost_usd)                      AS total_ai_cost,
       AVG(ai_cost_usd)                      AS avg_cost_per_session,
       AVG(input_tokens_total)               AS avg_input_tokens,
       AVG(output_tokens_total)              AS avg_output_tokens,
       AVG(ai_calls_count)                   AS avg_calls_per_session,
       MIN(ai_cost_usd)                      AS min_session_cost,
       MAX(ai_cost_usd)                      AS max_session_cost,
       MODE() WITHIN GROUP (ORDER BY model_used) AS primary_model
     FROM sessions
     WHERE project_id = $1
       AND status IN ('completed','terminated')
       AND ai_cost_usd > 0`,
    [projectId]
  );
  return rows[0] || {};
};

module.exports = { calculateCallCost, recordAICall, getSessionCost, getProjectCostSummary };