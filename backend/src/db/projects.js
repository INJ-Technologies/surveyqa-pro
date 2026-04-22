'use strict';
const { pool } = require('./index');

// ─── Get all projects for a workspace ────────────────────────────────────────
const getProjects = async (workspaceId) => {
  const result = await pool.query(
    `SELECT 
       p.*,
       u.full_name as owner_name,
       COUNT(DISTINCT s.id) as session_count,
       COUNT(DISTINCT qc.id) as quota_cells_count,
       COALESCE(SUM(qc.current_count), 0) as total_completes
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN sessions s ON s.project_id = p.id
     LEFT JOIN quota_cells qc ON qc.project_id = p.id
     WHERE p.workspace_id = $1
     GROUP BY p.id, u.full_name
     ORDER BY p.created_at DESC`,
    [workspaceId]
  );
  return result.rows;
};

// ─── Get single project ───────────────────────────────────────────────────────
const getProjectById = async (id, workspaceId) => {
  const result = await pool.query(
    `SELECT 
       p.*,
       u.full_name as owner_name,
       COUNT(DISTINCT s.id) as session_count,
       COALESCE(SUM(qc.current_count), 0) as total_completes,
       COALESCE(SUM(qc.target), 0) as total_target
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN sessions s ON s.project_id = p.id
     LEFT JOIN quota_cells qc ON qc.project_id = p.id
     WHERE p.id = $1 AND p.workspace_id = $2
     GROUP BY p.id, u.full_name`,
    [id, workspaceId]
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

    // Create project
    const projResult = await client.query(
      `INSERT INTO projects (
         workspace_id, owner_id, name, client_name, reference_id,
         description, survey_platform, target_completes, target_loi_minutes,
         ai_mode_openend, ai_mode_image, ai_strategy, proxy_provider,
         concurrent_sessions, start_date, end_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        workspaceId, ownerId, name, clientName, referenceId,
        description, surveyPlatform || 'unknown',
        targetCompletes || 0, targetLoi || 15,
        aiModeOpenend || 'ai', aiModeImage || 'ai',
        aiStrategy || 'persona_true', proxyProvider || 'brightdata',
        concurrentSessions || 5,
        startDate || null, endDate || null,
      ]
    );
    const project = projResult.rows[0];

    // Create survey URLs
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

    // Audit log
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

// ─── Update project ───────────────────────────────────────────────────────────
const updateProject = async (id, workspaceId, updates) => {
  const allowed = [
    'name', 'client_name', 'reference_id', 'description',
    'survey_platform', 'status', 'target_completes', 'target_loi_minutes',
    'ai_mode_openend', 'ai_mode_image', 'ai_strategy', 'proxy_provider',
    'concurrent_sessions', 'start_date', 'end_date',
  ];

  const fields = [];
  const values = [];
  let   idx    = 1;

  for (const [key, val] of Object.entries(updates)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowed.includes(col)) {
      fields.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id, workspaceId);

  const result = await pool.query(
    `UPDATE projects SET ${fields.join(', ')}
     WHERE id = $${idx++} AND workspace_id = $${idx}
     RETURNING *`,
    values
  );
  return result.rows[0] || null;
};

// ─── Delete project ───────────────────────────────────────────────────────────
const deleteProject = async (id, workspaceId) => {
  const result = await pool.query(
    `DELETE FROM projects WHERE id = $1 AND workspace_id = $2 RETURNING id`,
    [id, workspaceId]
  );
  return result.rows[0] || null;
};

// ─── Get project stats for dashboard ─────────────────────────────────────────
const getDashboardStats = async (workspaceId) => {
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT p.id)                                          as total_projects,
       COUNT(DISTINCT pe.id)                                         as total_personas,
       COUNT(DISTINCT s.id)                                          as total_sessions,
       COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'completed')   as completed_sessions,
       COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active')      as active_projects
     FROM projects p
     LEFT JOIN personas   pe ON pe.workspace_id = p.workspace_id
     LEFT JOIN sessions   s  ON s.project_id    = p.id
     WHERE p.workspace_id = $1`,
    [workspaceId]
  );
  return result.rows[0];
};

module.exports = {
  getProjects,
  getProjectById,
  getProjectSurveys,
  createProject,
  updateProject,
  deleteProject,
  getDashboardStats,
};