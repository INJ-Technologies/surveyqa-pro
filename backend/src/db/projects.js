'use strict';
const { pool } = require('./index');

// ─── Get all projects for a workspace ────────────────────────────────────────
const getProjects = async (workspaceId) => {
  const result = await pool.query(
    `SELECT
       p.*,
       u.full_name                                               AS owner_name,
       (SELECT COUNT(*) FROM sessions s
        WHERE s.project_id = p.id)::int                         AS session_count,
       (SELECT COUNT(*) FROM sessions s
        WHERE s.project_id = p.id
          AND s.outcome = 'completed')::int                     AS total_completes,
       (SELECT COALESCE(SUM(target), 0) FROM quota_cells qc
        WHERE qc.project_id = p.id)::int                        AS total_target
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.workspace_id = $1
     ORDER BY p.created_at DESC`,
    [workspaceId]
  );
  return result.rows;
};

// ─── Get single project ───────────────────────────────────────────────────────
const getProjectById = async (projectId, workspaceId) => {
  const result = await pool.query(
    `SELECT
       p.*,
       u.full_name                                               AS owner_name,
       (SELECT COUNT(*) FROM sessions s
        WHERE s.project_id = p.id)::int                         AS session_count,
       (SELECT COUNT(*) FROM sessions s
        WHERE s.project_id = p.id
          AND s.outcome = 'completed')::int                     AS total_completes,
       (SELECT COALESCE(SUM(target), 0) FROM quota_cells qc
        WHERE qc.project_id = p.id)::int                        AS total_target
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.id = $1
       AND p.workspace_id = $2`,
    [projectId, workspaceId]
  );
  return result.rows[0] || null;
};

// ─── Get project surveys ──────────────────────────────────────────────────────
const getProjectSurveys = async (projectId) => {
  const result = await pool.query(
    `SELECT * FROM project_surveys WHERE project_id = $1 ORDER BY created_at`,
    [projectId]
  );
  return result.rows;
};

// ─── Sync quota cells from survey countries + allocations ─────────────────────
const syncQuotaFromSurveys = async (client, projectId, surveys) => {
  try {
    // Get or create active quota plan
    let planResult = await client.query(
      `SELECT id FROM quota_plans WHERE project_id = $1 AND is_active = true LIMIT 1`,
      [projectId]
    );
    let planId;
    if (planResult.rows.length === 0) {
      const np = await client.query(
        `INSERT INTO quota_plans (project_id) VALUES ($1) RETURNING id`,
        [projectId]
      );
      planId = np.rows[0].id;
    } else {
      planId = planResult.rows[0].id;
    }

    // Remove all existing Country-dimension cells for this project
    await client.query(
      `DELETE FROM quota_cells WHERE project_id = $1 AND dimensions ? 'Country'`,
      [projectId]
    );

    // Insert one cell per country per survey
    for (const survey of surveys) {
      if (!survey.url) continue;
      const countries = Array.isArray(survey.countries) ? survey.countries
        : (survey.countries || '').split(',').map(c => c.trim()).filter(Boolean);
      const target = parseInt(survey.allocation) || 0;
      for (const country of countries) {
        await client.query(
          `INSERT INTO quota_cells (quota_plan_id, project_id, label, dimensions, target)
           VALUES ($1, $2, $3, $4, $5)`,
          [planId, projectId, country, JSON.stringify({ Country: country }), target]
        );
      }
    }
    console.log(`[Quota] Synced ${surveys.length} survey(s) → quota cells for project ${projectId}`);
  } catch (e) {
    console.warn('[Quota] Sync from surveys failed:', e.message);
  }
};

// ─── Create project ───────────────────────────────────────────────────────────
const createProject = async ({
  workspaceId, ownerId, name, clientName, referenceId,
  description, surveyPlatform, targetCompletes, targetLoi,
  aiModeOpenend, aiModeImage, aiStrategy, proxyProvider,
  concurrentSessions, startDate, endDate, surveys
}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const projResult = await client.query(
      `INSERT INTO projects (
         workspace_id, owner_id, name, client_name, reference_id,
         description, survey_platform, target_completes, target_loi_minutes,
         ai_mode_openend, ai_mode_image, ai_strategy, proxy_provider,
         concurrent_sessions, start_date, end_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        workspaceId, ownerId, name, clientName || null, referenceId || null,
        description || null, surveyPlatform || 'unknown',
        targetCompletes || 0, targetLoi || 15,
        aiModeOpenend || 'ai', aiModeImage || 'ai',
        aiStrategy || 'persona_true', proxyProvider || 'brightdata',
        concurrentSessions || 5,
        startDate || null, endDate || null,
      ]
    );
    const project = projResult.rows[0];

    if (surveys && surveys.length > 0) {
      for (const survey of surveys) {
        await client.query(
          `INSERT INTO project_surveys
             (project_id, label, url, countries, languages, allocation)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            project.id,
            survey.label || 'Main',
            survey.url,
            survey.countries || [],
            survey.languages || [],
            survey.allocation || 100,
          ]
        );
      }
    }

    // Sync quota cells from survey countries
    await syncQuotaFromSurveys(client, project.id, surveys);

    await client.query(
      `INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id)
       VALUES ($1, $2, 'create', 'project', $3)`,
      [workspaceId, ownerId, project.id]
    );

    await client.query('COMMIT');
    return project;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Update project (including survey URLs) ───────────────────────────────────
const updateProject = async (id, workspaceId, updates) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Build dynamic SET clause for projects table ──
    const ALLOWED_COLS = {
      name:               'name',
      clientName:         'client_name',
      referenceId:        'reference_id',
      description:        'description',
      surveyPlatform:     'survey_platform',
      status:             'status',
      targetCompletes:    'target_completes',
      targetLoi:          'target_loi_minutes',
      aiModeOpenend:      'ai_mode_openend',
      aiModeImage:        'ai_mode_image',
      aiStrategy:         'ai_strategy',
      proxyProvider:      'proxy_provider',
      concurrentSessions: 'concurrent_sessions',
      startDate:          'start_date',
      endDate:            'end_date',
    };

    const fields = [];
    const values = [];
    let   idx    = 1;

    for (const [jsKey, col] of Object.entries(ALLOWED_COLS)) {
      if (jsKey in updates) {
        fields.push(`${col} = $${idx++}`);
        values.push(updates[jsKey] === '' ? null : updates[jsKey]);
      }
    }

    let project = null;

    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(id, workspaceId);

      const result = await client.query(
        `UPDATE projects SET ${fields.join(', ')}
         WHERE id = $${idx++} AND workspace_id = $${idx}
         RETURNING *`,
        values
      );
      project = result.rows[0] || null;
    } else {
      // No project fields to update — just fetch current
      const result = await client.query(
        `SELECT * FROM projects WHERE id = $1 AND workspace_id = $2`,
        [id, workspaceId]
      );
      project = result.rows[0] || null;
    }

    if (!project) {
      await client.query('ROLLBACK');
      return null;
    }

    // ── Update survey URLs if provided ──────────────────────────────────────
    if (updates.surveys && Array.isArray(updates.surveys)) {
      // Delete all existing surveys for this project
      await client.query(
        `DELETE FROM project_surveys WHERE project_id = $1`,
        [id]
      );

      // Re-insert the updated list
      for (const survey of updates.surveys) {
        if (!survey.url) continue; // skip empty URLs
        await client.query(
          `INSERT INTO project_surveys
             (project_id, label, url, countries, languages, allocation)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            survey.label    || 'Main',
            survey.url,
            Array.isArray(survey.countries) ? survey.countries : [],
            Array.isArray(survey.languages) ? survey.languages : [],
            parseInt(survey.allocation) || 100,
          ]
        );
      }
    }

    // Sync quota cells from survey countries (only when surveys were updated)
    if (updates.surveys && Array.isArray(updates.surveys) && updates.surveys.length > 0) {
      await syncQuotaFromSurveys(client, id, updates.surveys);
    }

    await client.query('COMMIT');
    return project;

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Delete project ───────────────────────────────────────────────────────────
const deleteProject = async (id, workspaceId) => {
  const result = await pool.query(
    `DELETE FROM projects WHERE id = $1 AND workspace_id = $2 RETURNING id`,
    [id, workspaceId]
  );
  return result.rows[0] || null;
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────
const getDashboardStats = async (workspaceId) => {
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT p.id)                                        as total_projects,
       COUNT(DISTINCT pe.id)                                       as total_personas,
       COUNT(DISTINCT s.id)                                        as total_sessions,
       COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'completed') as completed_sessions,
       COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active')    as active_projects
     FROM projects p
     LEFT JOIN personas pe ON pe.workspace_id = p.workspace_id
     LEFT JOIN sessions s  ON s.project_id    = p.id
     WHERE p.workspace_id = $1`,
    [workspaceId]
  );
  return result.rows[0];
};

// ─── Get session stats for a project ─────────────────────────────────────────
const getProjectSessionStats = async (projectId) => {
  const result = await pool.query(
    `SELECT
       COUNT(*)                                                     as total,
       COUNT(*) FILTER (WHERE status = 'completed')                 as completed,
       COUNT(*) FILTER (WHERE status = 'terminated')                as terminated,
       COUNT(*) FILTER (WHERE status IN ('error','flagged'))        as errors,
       COUNT(*) FILTER (WHERE status IN ('queued','initialising','in_progress')) as active,
       COUNT(*) FILTER (WHERE status = 'over_quota')                as over_quota,
       ROUND(AVG(total_duration_s) FILTER (WHERE total_duration_s IS NOT NULL)) as avg_duration,
       ROUND(AVG(quality_score)    FILTER (WHERE quality_score    IS NOT NULL), 1) as avg_quality
     FROM sessions
     WHERE project_id = $1`,
    [projectId]
  );
  return result.rows[0];
};

// ─── Get all sessions for a project ──────────────────────────────────────────
const getProjectSessions = async (projectId, { status, outcome, country, limit = 20, offset = 0 } = {}) => {
  const conditions = ['s.project_id = $1'];
  const values     = [projectId];
  let   idx        = 2;
 
  if (status)  { conditions.push(`s.status = $${idx++}`);        values.push(status); }
  if (outcome) { conditions.push(`s.outcome = $${idx++}`);       values.push(outcome); }
  if (country) { conditions.push(`s.proxy_country ILIKE $${idx++}`); values.push(country); }
 
  // Count query for pagination
  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM sessions s WHERE ${conditions.join(' AND ')}`,
    values
  );
  const total = parseInt(countResult.rows[0].total) || 0;
 
  values.push(limit, offset);
 
  const result = await pool.query(
    `SELECT
      s.id, s.status, s.outcome, s.proxy_country, s.proxy_provider,
      s.device_type, s.browser_type, s.ai_strategy,
      s.total_duration_s, s.quality_score, s.question_count,
      s.redirect_type, s.error_log,
      s.response_id,
      s.internal_testing,
      s.started_at, s.completed_at, s.created_at,
      p.name as persona_name,
      (SELECT se.payload->>'scenarioName'
        FROM session_events se
        WHERE se.session_id = s.id
          AND se.event_type = 'scenario_assigned'
        LIMIT 1) as scenario_name,
      (SELECT se.payload->>'ip'
        FROM session_events se
        WHERE se.session_id = s.id
          AND se.event_type = 'ip_assigned'
        LIMIT 1) as ip_address
    FROM sessions s
    LEFT JOIN personas p ON p.id = s.persona_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.created_at DESC
    LIMIT $${idx++} OFFSET $${idx}`,
    values
  );
 
  return { sessions: result.rows, total };
};

// ─── Get cost summary for a project ──────────────────────────────────────────
const getProjectCostSummary = async (projectId) => {
  const result = await pool.query(
    `SELECT
       p.budget_proxy,
       p.budget_ai,
       p.target_completes,
       COUNT(s.id)                                              as total_sessions,
       COUNT(s.id) FILTER (WHERE s.status = 'completed')       as completed_sessions,
       COUNT(s.id) FILTER (WHERE s.status = 'terminated')      as terminated_sessions,
       COUNT(s.id) FILTER (WHERE s.status IN ('error','flagged')) as error_sessions,
       COUNT(s.id) FILTER (WHERE s.status IN ('queued','initialising','in_progress')) as active_sessions,
       ROUND(AVG(s.total_duration_s) FILTER (WHERE s.total_duration_s IS NOT NULL)) as avg_duration_s,
       ROUND(AVG(s.quality_score)    FILTER (WHERE s.quality_score    IS NOT NULL), 1) as avg_quality
     FROM projects p
     LEFT JOIN sessions s ON s.project_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [projectId]
  );
  return result.rows[0] || null;
};

module.exports = {
  getProjects,
  getProjectById,
  getProjectSurveys,
  createProject,
  updateProject,
  deleteProject,
  getDashboardStats,
  getProjectSessionStats,
  getProjectSessions,
  getProjectCostSummary,
  syncQuotaFromSurveys,
};