'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// ANOMALY MONITOR — Watches session health in real time.
// Auto-stops if cost exceeds budget, termination rate is too high,
// or same page is failing repeatedly across sessions.
// ══════════════════════════════════════════════════════════════════════════════

const { pool } = require('../../backend/src/db/index');

// ── Check project-level anomalies before launching a session ──────────────────
const preSessionAnomalyCheck = async (projectId) => {
  const warnings = [];
  try {
    // 1. Check termination rate of last 10 sessions
    const recentResult = await pool.query(
      `SELECT outcome, COUNT(*) as cnt FROM sessions
       WHERE project_id = $1 AND status IN ('completed','terminated','over_quota','error')
       AND created_at > NOW() - INTERVAL '2 hours'
       GROUP BY outcome`,
      [projectId]
    );
    const outcomes = {};
    let total = 0;
    for (const row of recentResult.rows) {
      outcomes[row.outcome] = parseInt(row.cnt);
      total += parseInt(row.cnt);
    }
    if (total >= 5) {
      const terminateRate = ((outcomes.terminated || 0) + (outcomes.over_quota || 0)) / total;
      if (terminateRate > 0.7) {
        warnings.push({
          type: 'HIGH_TERMINATION_RATE',
          severity: 'critical',
          detail: `${Math.round(terminateRate * 100)}% of recent sessions terminated — screener may be blocking all sessions`,
        });
      }
    }

    // 2. Check total AI cost vs budget
    const budgetResult = await pool.query(
      `SELECT p.budget_ai, COALESCE(SUM(s.ai_cost_usd), 0) as spent
       FROM projects p
       LEFT JOIN sessions s ON s.project_id = p.id
       WHERE p.id = $1 GROUP BY p.budget_ai`,
      [projectId]
    );
    if (budgetResult.rows[0]) {
      const { budget_ai, spent } = budgetResult.rows[0];
      if (budget_ai && parseFloat(spent) >= parseFloat(budget_ai) * 0.9) {
        warnings.push({
          type: 'AI_BUDGET_NEAR_LIMIT',
          severity: 'critical',
          detail: `AI spend $${parseFloat(spent).toFixed(2)} is 90%+ of $${budget_ai} budget`,
        });
      }
    }

    // 3. Check if all quota cells are filled
    const quotaResult = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'open') as open_cells,
              COUNT(*) as total_cells
       FROM quota_cells WHERE project_id = $1`,
      [projectId]
    );
    if (quotaResult.rows[0]?.total_cells > 0 && quotaResult.rows[0]?.open_cells === '0') {
      warnings.push({
        type: 'ALL_QUOTAS_FILLED',
        severity: 'critical',
        detail: 'All quota cells are filled — no more sessions needed',
      });
    }

  } catch (e) {
    console.warn('[Anomaly] Pre-session check failed:', e.message);
  }

  return warnings;
};

// ── Log anomaly to DB ─────────────────────────────────────────────────────────
const logAnomaly = async (projectId, sessionId, type, details, severity = 'warning') => {
  try {
    await pool.query(
      `INSERT INTO session_anomalies (project_id, session_id, anomaly_type, details, severity)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, sessionId, type, JSON.stringify(details), severity]
    );
  } catch {}
};

// ── Per-page straight-line detection ─────────────────────────────────────────
const detectStraightLine = (pageHistory) => {
  const gridPages = [];
  const pageGroups = {};
  for (const h of pageHistory) {
    if (!pageGroups[h.page]) pageGroups[h.page] = [];
    pageGroups[h.page].push(h.answer);
  }
  let straightLineCount = 0;
  let gridPageCount = 0;
  for (const [, answers] of Object.entries(pageGroups)) {
    if (answers.length < 3) continue;
    gridPageCount++;
    const unique = new Set(answers);
    if (unique.size === 1) straightLineCount++;
  }
  if (gridPageCount === 0) return 0;
  return Math.round((straightLineCount / gridPageCount) * 100);
};

// ── Open-end quality score ────────────────────────────────────────────────────
const scoreOpenEnds = (pageHistory) => {
  const openEnds = pageHistory.filter(h => h.type === 'open-end');
  if (openEnds.length === 0) return null;
  let score = 0;
  for (const oe of openEnds) {
    const text = oe.answer || '';
    const words = text.split(/\s+/).filter(Boolean).length;
    const unique = new Set(text.toLowerCase().split(/\s+/)).size;
    const diversity = words > 0 ? unique / words : 0;
    // Word count score (0-40)
    const wordScore = Math.min(40, words * 2);
    // Lexical diversity score (0-40)
    const diversityScore = Math.round(diversity * 40);
    // No filler phrases (0-20)
    const hasFillers = /great question|certainly|as an ai|it is important to note|as a professional/i.test(text);
    const fillerScore = hasFillers ? 0 : 20;
    score += wordScore + diversityScore + fillerScore;
  }
  return Math.min(100, Math.round(score / openEnds.length));
};

module.exports = { preSessionAnomalyCheck, logAnomaly, detectStraightLine, scoreOpenEnds };