"use strict";
const express = require("express");
const path    = require("path");
const fs      = require("fs");
const { pool } = require('../db');
const { requireAuth, requireRole } = require("../middleware/auth");
const { createSession, getLiveSessions, getSessionDetail } = require("../db/sessions");
const { sessionQueue }   = require("../queues/index");
const { getProjectById, getProjectSurveys } = require("../db/projects");
const { getScenariosByIds } = require('../db/scenarios');
const { getDefaultProvider } = require('../db/ai_providers');

// ── Quota-aware randomised session distribution ───────────────────────────────
const shuffleArray = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const buildCountryDistribution = async (countryList, projectId, sessionLimit) => {
  if (countryList.length === 0) return Array(sessionLimit).fill(null);
  if (countryList.length === 1) return Array(sessionLimit).fill(countryList[0]);

  try {
    const quotaResult = await pool.query(
      `SELECT dimensions->>'Country' as country,
              target,
              COALESCE(current_count, 0) as current_count,
              status
       FROM quota_cells
       WHERE project_id = $1 AND dimensions ? 'Country'`,
      [projectId]
    );

    if (quotaResult.rows.length > 0) {
      const remaining = {};
      for (const row of quotaResult.rows) {
        const c = (row.country || '').toUpperCase();
        if (!countryList.includes(c)) continue;
        if (row.status === 'filled') continue;
        const rem = Math.max(0, parseInt(row.target || 0) - parseInt(row.current_count || 0));
        if (rem > 0) remaining[c] = (remaining[c] || 0) + rem;
      }

      const activeEntries = Object.entries(remaining);
      if (activeEntries.length > 0) {
        const totalRemaining = activeEntries.reduce((s, [, r]) => s + r, 0);
        const allocated = [];

        for (const [country, rem] of activeEntries) {
          const share = Math.max(1, Math.round((rem / totalRemaining) * sessionLimit));
          for (let i = 0; i < share; i++) allocated.push(country);
        }

        // Trim or pad to exact sessionLimit
        while (allocated.length < sessionLimit) {
          allocated.push(activeEntries[allocated.length % activeEntries.length][0]);
        }
        allocated.length = sessionLimit;

        console.log(`[Trigger] Quota-aware distribution: ${activeEntries.map(([c, r]) => `${c}:${r} remaining`).join(', ')}`);
        return shuffleArray(allocated);
      }
    }
  } catch (e) {
    console.warn('[Trigger] Quota distribution failed, using random fallback:', e.message);
  }

  // Fallback: equal-weight random (not round-robin)
  const fallback = Array.from({ length: sessionLimit }, (_, i) => countryList[i % countryList.length]);
  return shuffleArray(fallback);
};

const router = express.Router();

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || "/app/screenshots";

// ─── PUBLIC: Screenshot serving ───────────────────────────────────────────────
router.get("/:id/screenshot/:filename", (req, res) => {
  try {
    const filePath = path.join(SCREENSHOTS_DIR, req.params.id, req.params.filename);
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "Screenshot not found" });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to serve screenshot" });
  }
});

router.use(requireAuth);

// ─── Generate 12-char alphanumeric response ID ────────────────────────────────
const generateResponseId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 12; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

// ─── Find the best survey URL for a given country code ───────────────────────
// Matches country code against survey.countries array.
// Falls back to Main survey if no match found.
const getSurveyForCountry = (surveys, countryCode) => {
  if (!countryCode) {
    return surveys.find(s => s.label === 'Main') || surveys[0];
  }
  const code = countryCode.toUpperCase();

  // Find survey whose countries list includes this country
  const match = surveys.find(sv => {
    const codes = Array.isArray(sv.countries)
      ? sv.countries
      : (sv.countries || '').split(',').map(c => c.trim()).filter(Boolean);
    return codes.some(c => c.toUpperCase() === code);
  });

  // Fall back to Main or first survey if no country match
  return match || surveys.find(s => s.label === 'Main') || surveys[0];
};

// ─── POST /api/sessions/trigger ───────────────────────────────────────────────
router.post('/trigger', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const { projectId, personaIds = [], count = 1, proxyCountry, scenarioIds, internalTesting = false, aiProviderId } = req.body;

    if (!projectId)
      return res.status(400).json({ error: 'projectId is required' });

    const project = await getProjectById(projectId, req.user.workspace_id);
    if (!project)
      return res.status(404).json({ error: 'Project not found' });

    const surveys = await getProjectSurveys(projectId);
    if (!surveys.length)
      return res.status(400).json({ error: 'No survey URLs configured' });

    // ── Parse country list ────────────────────────────────────────────────────
    let countryList = [];
    if (Array.isArray(proxyCountry)) {
      countryList = proxyCountry.map(c => c.trim().toUpperCase()).filter(Boolean);
    } else if (typeof proxyCountry === 'string' && proxyCountry.trim()) {
      countryList = proxyCountry
        .split(/[,\s]+/)
        .map(c => c.trim().toUpperCase())
        .filter(Boolean);
    }

    // ── Country Logic filter — restrict to mapped countries only ─────────────
    if (scenarioIds && scenarioIds.length > 0) {
      try {
        const selectedScenarios = await getScenariosByIds(scenarioIds);
        const countryLogic = selectedScenarios.find(s =>
          s.name === 'Country Logic' && s.country_mapping?.mappings?.length > 0
        );
        if (countryLogic) {
          const mappedCountries = countryLogic.country_mapping.mappings.map(m => m.country.toUpperCase());
          if (countryList.length > 0) {
            countryList = countryList.filter(c => mappedCountries.includes(c.toUpperCase()));
          } else {
            countryList = mappedCountries;
          }
          console.log(`[Trigger] Country Logic applied — allowed: ${countryList.join(', ')}`);
        }
      } catch (e) {
        console.warn('[Trigger] Could not apply country logic:', e.message);
      }
    }

    // Fall back to countries from all surveys if none explicitly provided
    if (countryList.length === 0) {
      const allSurveyCodes = new Set();
      surveys.forEach(sv => {
        const codes = Array.isArray(sv.countries)
          ? sv.countries
          : (sv.countries || '').split(',').map(c => c.trim()).filter(Boolean);
        codes.forEach(c => c && allSurveyCodes.add(c.toUpperCase()));
      });
      countryList = [...allSurveyCodes];
    }

    const sessionLimit = Math.min(parseInt(count) || 1, 100);
    const created = [];

    // Quota-aware randomised country distribution
    const distributedCountries = await buildCountryDistribution(countryList, projectId, sessionLimit);

    for (let i = 0; i < sessionLimit; i++) {
      const personaId = personaIds.length > 0 ? personaIds[i % personaIds.length] : null;
      const country = distributedCountries[i] || null;

      // Pick the survey URL that matches this country
      const survey = getSurveyForCountry(surveys, country);

      if (!survey?.url) {
        console.warn(`[Sessions] No survey URL found for country ${country} — skipping`);
        continue;
      }

      const responseId = generateResponseId();
      const finalUrl   = survey.url.replace(/identifier/gi, responseId);

      console.log(`[Sessions] Session ${i + 1}/${sessionLimit} → country: ${country || 'none'} | survey: ${survey.label} | url: ${finalUrl.slice(0, 60)}...`);

      const session = await createSession({
        projectId,
        workspaceId:   req.user.workspace_id,
        personaId,
        surveyUrl:     finalUrl,
        surveyLabel:   survey.label,
        responseId,
        proxyCountry:  country,
        proxyProvider: project.proxy_provider || 'decodo',
        deviceType:    project.device_type    || 'desktop',
        browserType:   'chrome',
        aiStrategy:    project.ai_strategy    || 'persona_true',
        internalTesting: internalTesting || false,   // ← ADD THIS
      });

      // Resolve AI provider ID: explicit selection > project default > workspace default
      let resolvedProviderId = aiProviderId || null;
      if (!resolvedProviderId) {
        const defaultProv = await getDefaultProvider(req.user.workspace_id);
        resolvedProviderId = defaultProv?.id || null;
      }

      await sessionQueue.add('run-session', {
        sessionId:       session.id,
        projectId,
        scenarioIds:     scenarioIds || null,
        internalTesting: internalTesting || false,
        personaId,
        surveyUrl:       finalUrl,
        responseId,
        proxyProvider:   project.proxy_provider || 'decodo',
        proxyCountry:    country,
        deviceType:      project.device_type    || 'desktop',
        aiStrategy:      project.ai_strategy    || 'persona_true',
        aiProviderId:    resolvedProviderId,
      }, { jobId: `session-${session.id}`, priority: 1 });

      created.push(session);
    }

    console.log(`[Sessions] Queued ${created.length} session(s) — countries: ${countryList.join(', ') || 'none'}`);
    res.status(201).json({
      message:  `${created.length} session(s) queued`,
      sessions: created,
    });

  } catch (err) {
    console.error('Trigger sessions error:', err.message);
    res.status(500).json({ error: `Failed to trigger sessions: ${err.message}` });
  }
});

// ─── GET /api/sessions/live/:projectId ────────────────────────────────────────
router.get("/live/:projectId", async (req, res) => {
  try {
    const sessions = await getLiveSessions(req.params.projectId);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch live sessions" });
  }
});

// ─── GET /api/sessions/:id — Full session detail ──────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const detail = await getSessionDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: "Session not found" });
    res.json(detail);
  } catch (err) {
    console.error("Get session detail error:", err.message);
    res.status(500).json({ error: "Failed to fetch session detail" });
  }
});

// ─── DELETE /api/sessions/project/:projectId/all — Admin only ─────────────────
router.delete('/project/:projectId/all', requireRole('admin'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const result = await pool.query(
      `DELETE FROM sessions WHERE project_id = $1 RETURNING id`,
      [projectId]
    );
    res.json({ deleted: result.rowCount, message: `${result.rowCount} session(s) deleted` });
  } catch (err) {
    console.error('Clear sessions error:', err);
    res.status(500).json({ error: 'Failed to clear sessions' });
  }
});

// ─── POST /api/sessions/project/:projectId/stop ───────────────────────────────
// Stop all queued and in-progress sessions
router.post('/project/:projectId/stop', requireRole('admin', 'project_manager'), async (req, res) => {
  const { projectId } = req.params;
  try {
    // Mark all queued/in_progress sessions as stopped in DB
    const result = await pool.query(
      `UPDATE sessions
       SET status = 'terminated', outcome = 'error',
           error_log = 'Manually stopped by user',
           updated_at = NOW()
       WHERE project_id = $1
         AND status IN ('queued', 'initialising', 'in_progress')
       RETURNING id`,
      [projectId]
    );
    const stoppedIds = result.rows.map(r => r.id);

    // Drain all waiting jobs from the queue for this project
    try {
      const { queue } = require('../queues/index');
      const waiting = await queue.getJobs(['waiting', 'delayed']);
      let drained = 0;
      for (const job of waiting) {
        if (job.data?.projectId === projectId) {
          await job.remove().catch(() => {});
          drained++;
        }
      }
      console.log(`[Stop] Drained ${drained} queued jobs for project ${projectId}`);
    } catch (qErr) {
      console.warn('[Stop] Could not drain queue jobs:', qErr.message);
    }

    res.json({ stopped: stoppedIds.length, message: `${stoppedIds.length} session(s) stopped` });
  } catch (err) {
    console.error('Stop sessions error:', err);
    res.status(500).json({ error: 'Failed to stop sessions' });
  }
});

// ─── POST /api/sessions/:id/stop — terminate single session ──────────────────
router.post('/:id/stop', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE sessions SET status = 'error', outcome = 'error',
       error_log = 'Manually stopped by user', completed_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Session stopped' });
  } catch (err) {
    console.error('Stop session error:', err.message);
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

// ─── DELETE /api/sessions/:id — delete single session ────────────────────────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [req.params.id]);
    res.json({ message: 'Session deleted' });
  } catch (err) {
    console.error('Delete session error:', err.message);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

module.exports = router;