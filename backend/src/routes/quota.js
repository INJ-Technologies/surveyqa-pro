'use strict';
const express = require('express');
const { getQuotaPlan, saveQuotaPlan, clearQuotaPlan } = require('../db/quota');
const { requireAuth } = require('../middleware/auth');
const { pool } = require('../db/index');

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
    if (!dimensions || !Array.isArray(dimensions)) {
      return res.status(400).json({ error: 'dimensions must be an array' });
    }
    if (dimensions.length === 0) {
      const data = await clearQuotaPlan(req.params.id);
      return res.json({ message: 'Quota plan cleared', ...data });
    }
  
   const data = await saveQuotaPlan(req.params.id, req.user.id, dimensions);

    // ── Sync survey allocations from Country quota cells ──────────────────
    try {
      const projectId = req.params.id;
      const surveysResult = await pool.query(
        `SELECT id, countries FROM project_surveys WHERE project_id = $1`,
        [projectId]
      );
      for (const survey of surveysResult.rows) {
        const countries = Array.isArray(survey.countries) ? survey.countries : [];
        if (countries.length === 0) continue;
        // Use first country's target as the survey allocation
        const cellResult = await pool.query(
          `SELECT target FROM quota_cells WHERE project_id = $1
           AND dimensions->>'Country' = $2 LIMIT 1`,
          [projectId, countries[0]]
        );
        if (cellResult.rows.length > 0) {
          await pool.query(
            `UPDATE project_surveys SET allocation = $1 WHERE id = $2`,
            [cellResult.rows[0].target, survey.id]
          );
        }
      }
      console.log(`[Quota] Synced quota targets → survey allocations for project ${projectId}`);
    } catch (syncErr) {
      console.warn('[Quota] Sync to surveys failed:', syncErr.message);
    }

    res.json({ message: 'Quota plan saved', ...data });
  } catch (err) {
    console.error('Save quota error:', err.message);
    res.status(500).json({ error: 'Failed to save quota plan' });
  }
});

module.exports = router;
