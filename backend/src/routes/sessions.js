"use strict";
const express = require("express");
const path    = require("path");
const fs      = require("fs");
const { pool } = require('../db');
const { requireAuth, requireRole } = require("../middleware/auth");
const { createSession, getLiveSessions, getSessionDetail } = require("../db/sessions");
const { sessionQueue }   = require("../queues/index");
const { getProjectById, getProjectSurveys } = require("../db/projects");

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
    const { projectId, personaIds = [], count = 1, proxyCountry } = req.body;

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

    const sessionLimit = Math.min(parseInt(count) || 1, 20);
    const created = [];

    for (let i = 0; i < sessionLimit; i++) {
      const personaId = personaIds.length > 0 ? personaIds[i % personaIds.length] : null;

      // Round-robin country per session
      const country = countryList.length > 0
        ? countryList[i % countryList.length]
        : null;

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
      });

      await sessionQueue.add('run-session', {
        sessionId:     session.id,
        projectId,
        personaId,
        surveyUrl:     finalUrl,
        responseId,
        proxyProvider: project.proxy_provider || 'decodo',
        proxyCountry:  country,
        deviceType:    project.device_type    || 'desktop',
        aiStrategy:    project.ai_strategy    || 'persona_true',
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

module.exports = router;