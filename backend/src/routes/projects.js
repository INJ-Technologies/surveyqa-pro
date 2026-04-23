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
    const sessions = await getProjectSessions(req.params.id, {
      status, outcome, country,
      limit:  parseInt(limit)  || 100,
      offset: parseInt(offset) || 0,
    });
    const stats = await getProjectSessionStats(req.params.id);
    res.json({ sessions, stats });
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

module.exports = router;