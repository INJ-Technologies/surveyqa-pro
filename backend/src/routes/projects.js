'use strict';
const express = require('express');
const {
  getProjects, getProjectById, getProjectSurveys,
  createProject, updateProject, deleteProject,
  getDashboardStats,
  getProjectSessionStats,
  getProjectSessions,
  getProjectCostSummary,
} = require('../db/projects');
const { requireAuth, requireRole } = require('../middleware/auth');

const { pool } = require('../db');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/projects ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const projects = await getProjects(req.user.workspace_id);
    res.json({ projects });
  } catch (err) {
    console.error('Get projects error:', err.message);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// ─── GET /api/projects/stats ──────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const stats = await getDashboardStats(req.user.workspace_id);
    res.json({ stats });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /api/projects/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const project = await getProjectById(req.params.id, req.user.workspace_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const surveys = await getProjectSurveys(req.params.id);
    res.json({ project, surveys });
  } catch (err) {
    console.error('Get project error:', err.message);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// ─── GET /api/projects/:id/sessions ──────────────────────────────────────────
router.get('/:id/sessions', async (req, res) => {
  try {
    const { status, outcome, country, limit, offset } = req.query;
    const result = await getProjectSessions(req.params.id, {
      status, outcome, country,
      limit:  parseInt(limit)  || 20,
      offset: parseInt(offset) || 0,
    });
    const stats = await getProjectSessionStats(req.params.id);
    res.json({
      sessions: result.sessions,
      stats,
      total: result.total,
    });
  } catch (err) {
    console.error('Get sessions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ─── GET /api/projects/:id/costs ─────────────────────────────────────────────
router.get('/:id/costs', async (req, res) => {
  try {
    const summary = await getProjectCostSummary(req.params.id);
    res.json({ summary });
  } catch (err) {
    console.error('Get costs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cost summary' });
  }
});

// ─── POST /api/projects ───────────────────────────────────────────────────────
router.post('/', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const {
      name, clientName, referenceId, description,
      surveyPlatform, targetCompletes, targetLoi,
      aiModeOpenend, aiModeImage, aiStrategy,
      proxyProvider, concurrentSessions,
      startDate, endDate, surveys,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Project name is required' });
    if (!surveys || surveys.length === 0)
      return res.status(400).json({ error: 'At least one survey URL is required' });
    for (const s of surveys) {
      if (!s.url) return res.status(400).json({ error: 'Survey URL is required' });
    }

    const project = await createProject({
      workspaceId: req.user.workspace_id,
      ownerId:     req.user.id,
      name, clientName, referenceId, description,
      surveyPlatform, targetCompletes, targetLoi,
      aiModeOpenend, aiModeImage, aiStrategy,
      proxyProvider, concurrentSessions,
      startDate, endDate, surveys,
    });

    res.status(201).json({ message: 'Project created', project });
  } catch (err) {
    console.error('Create project error:', err.message);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ─── PATCH /api/projects/:id ──────────────────────────────────────────────────
router.patch('/:id', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const project = await updateProject(
      req.params.id, req.user.workspace_id, req.body
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project updated', project });
  } catch (err) {
    console.error('Update project error:', err.message);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// ─── DELETE /api/projects/:id ─────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const deleted = await deleteProject(req.params.id, req.user.workspace_id);
    if (!deleted) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error('Delete project error:', err.message);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ─── GET /api/projects/:id/personas — list assigned personas ─────────────────
router.get('/:id/personas', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pp.id AS assignment_id, pp.persona_id, pp.rotation_order,
              p.name, p.country, p.language, p.gender, p.age_min, p.age_max,
              p.device_type, p.tags, p.behavioural_attrs, p.ai_generated
       FROM project_personas pp
       JOIN personas p ON p.id = pp.persona_id
       WHERE pp.project_id = $1 AND pp.is_active = true
       ORDER BY pp.rotation_order ASC, pp.created_at ASC`,
      [req.params.id]
    );
    res.json({ personas: rows });
  } catch (err) {
    console.error('Get project personas error:', err.message);
    res.status(500).json({ error: 'Failed to fetch project personas' });
  }
});

// ─── POST /api/projects/:id/personas — assign persona to project ──────────────
router.post('/:id/personas', requireAuth, requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const { personaId } = req.body;
    if (!personaId) return res.status(400).json({ error: 'personaId is required' });

    // Check persona belongs to same workspace
    const pCheck = await pool.query(
      `SELECT id FROM personas WHERE id = $1 AND workspace_id = $2`,
      [personaId, req.user.workspace_id]
    );
    if (pCheck.rows.length === 0) return res.status(404).json({ error: 'Persona not found' });

    // Get next rotation order
    const orderRes = await pool.query(
      `SELECT COALESCE(MAX(rotation_order), -1) + 1 AS next_order
       FROM project_personas WHERE project_id = $1`,
      [req.params.id]
    );
    const nextOrder = parseInt(orderRes.rows[0].next_order) || 0;

    const { rows } = await pool.query(
      `INSERT INTO project_personas (project_id, persona_id, rotation_order, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (project_id, persona_id)
         DO UPDATE SET is_active = true, rotation_order = $3
       RETURNING *`,
      [req.params.id, personaId, nextOrder]
    );
    res.status(201).json({ assignment: rows[0] });
  } catch (err) {
    console.error('Assign persona error:', err.message);
    res.status(500).json({ error: 'Failed to assign persona' });
  }
});

// ─── DELETE /api/projects/:id/personas/:pid — remove persona from project ─────
router.delete('/:id/personas/:pid', requireAuth, requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    await pool.query(
      `UPDATE project_personas SET is_active = false
       WHERE project_id = $1 AND persona_id = $2`,
      [req.params.id, req.params.pid]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove persona' });
  }
});

// ─── PATCH /api/projects/:id/persona-rotation — update rotation strategy ──────
router.patch('/:id/persona-rotation', requireAuth, requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const { strategy } = req.body;
    const valid = ['random', 'round_robin', 'weighted'];
    if (!valid.includes(strategy)) return res.status(400).json({ error: 'Invalid rotation strategy' });

    const { rows } = await pool.query(
      `UPDATE projects SET persona_rotation = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3 RETURNING *`,
      [strategy, req.params.id, req.user.workspace_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json({ project: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update persona rotation' });
  }
});

module.exports = router;