'use strict';
const { pool } = require('./index');

// ─── Get quota plan for a project ────────────────────────────────────────────
const getQuotaPlan = async (projectId) => {
  const plan = await pool.query(
    `SELECT * FROM quota_plans WHERE project_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  );
  if (!plan.rows[0]) return null;

  const cells = await pool.query(
    `SELECT * FROM quota_cells WHERE quota_plan_id = $1 ORDER BY created_at`,
    [plan.rows[0].id]
  );

  return { plan: plan.rows[0], cells: cells.rows };
};

// Clear quota plan for a project (disable all active plans)
const clearQuotaPlan = async (projectId) => {
  await pool.query(
    `UPDATE quota_plans SET is_active = false WHERE project_id = $1`,
    [projectId]
  );
  return { plan: null, cells: [] };
};

// ─── Save quota plan (create or replace) ─────────────────────────────────────
const saveQuotaPlan = async (projectId, userId, dimensions) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Deactivate existing plans
    await client.query(
      `UPDATE quota_plans SET is_active = false WHERE project_id = $1`,
      [projectId]
    );

    // Create new plan
    const planResult = await client.query(
      `INSERT INTO quota_plans (project_id, created_by, is_active)
       VALUES ($1, $2, true) RETURNING *`,
      [projectId, userId]
    );
    const plan = planResult.rows[0];

    // Insert cells for each dimension value
    const cells = [];
    for (const dim of dimensions) {
      for (const value of dim.values) {
        const cellResult = await client.query(
          `INSERT INTO quota_cells
             (quota_plan_id, project_id, label, dimensions, target, minimum, quota_type, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
           RETURNING *`,
          [
            plan.id, projectId,
            `${dim.name}: ${value.label}`,
            JSON.stringify({ [dim.name]: value.label }),
            parseInt(value.target) || 0,
            parseInt(value.minimum) || 0,
            value.quotaType || 'hard',
          ]
        );
        cells.push(cellResult.rows[0]);
      }
    }

    await client.query('COMMIT');
    return { plan, cells };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Update cell count (called when session completes) ────────────────────────
const incrementQuotaCell = async (cellId) => {
  const result = await pool.query(
    `UPDATE quota_cells
     SET current_count = current_count + 1,
         status = CASE WHEN current_count + 1 >= target THEN 'filled' ELSE status END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [cellId]
  );
  return result.rows[0];
};

module.exports = { getQuotaPlan, saveQuotaPlan, clearQuotaPlan, incrementQuotaCell };
