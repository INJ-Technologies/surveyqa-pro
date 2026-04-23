'use strict';
const express = require('express');
const { getQuotaPlan, saveQuotaPlan } = require('../db/quota');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/projects/:id/quota
router.get('/', async (req, res) => {
  try {
    const data = await getQuotaPlan(req.params.id);
    res.json(data || { plan: null, cells: [] });
  } catch (err) {
    console.error('Get quota error:', err.message);
    res.status(500).json({ error: 'Failed to fetch quota plan' });
  }
});

// POST /api/projects/:id/quota
router.post('/', async (req, res) => {
  try {
    const { dimensions } = req.body;
    if (!dimensions || !Array.isArray(dimensions) || dimensions.length === 0) {
      return res.status(400).json({ error: 'At least one dimension is required' });
    }
    const data = await saveQuotaPlan(req.params.id, req.user.id, dimensions);
    res.json({ message: 'Quota plan saved', ...data });
  } catch (err) {
    console.error('Save quota error:', err.message);
    res.status(500).json({ error: 'Failed to save quota plan' });
  }
});

module.exports = router;