'use strict';
const express    = require('express');
const { pool }   = require('../db/index');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/proxy/countries — returns active countries for the dropdown
router.get('/countries', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT code, country, endpoint, port
       FROM proxy_countries
       WHERE status = 1
       ORDER BY country ASC`
    );
    res.json({ countries: result.rows });
  } catch (err) {
    console.error('Get proxy countries error:', err.message);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

module.exports = router;