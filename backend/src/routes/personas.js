'use strict';
const express = require('express');
const {
  getPersonas, getPersonaById,
  createPersona, updatePersona, deletePersona,
} = require('../db/personas');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/personas ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const personas = await getPersonas(req.user.workspace_id);
    res.json({ personas });
  } catch (err) {
    console.error('Get personas error:', err.message);
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

// ─── GET /api/personas/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const persona = await getPersonaById(req.params.id, req.user.workspace_id);
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    res.json({ persona });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch persona' });
  }
});

// ─── POST /api/personas ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Persona name is required' });

    const persona = await createPersona({
      workspaceId: req.user.workspace_id,
      createdBy:   req.user.id,
      ...req.body,
    });
    res.status(201).json({ message: 'Persona created', persona });
  } catch (err) {
    console.error('Create persona error:', err.message);
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

// ─── PATCH /api/personas/:id ──────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    const persona = await updatePersona(
      req.params.id, req.user.workspace_id, req.body
    );
    if (!persona) return res.status(404).json({ error: 'Persona not found' });
    res.json({ message: 'Persona updated', persona });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

// ─── DELETE /api/personas/:id ─────────────────────────────────────────────────
router.delete('/:id', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const deleted = await deletePersona(req.params.id, req.user.workspace_id);
    if (!deleted) return res.status(404).json({ error: 'Persona not found' });
    res.json({ message: 'Persona deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

module.exports = router;