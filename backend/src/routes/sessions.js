'use strict';
const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createSession, getLiveSessions } = require('../db/sessions');
const { sessionQueue } = require('../queues/index');
const { getProjectById, getProjectSurveys } = require('../db/projects');

const router = express.Router();
router.use(requireAuth);

// ─── Generate unique 12-char alphanumeric response ID ─────────────────────────
const generateResponseId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// ─── POST /api/sessions/trigger ───────────────────────────────────────────────
router.post('/trigger', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const {
      projectId,
      personaIds    = [],
      count         = 1,
      proxyCountry,
      usePersonaDevice = true,
    } = req.body;

    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    // Load project
    const project = await getProjectById(projectId, req.user.workspace_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Load surveys
    const surveys = await getProjectSurveys(projectId);
    if (!surveys.length) return res.status(400).json({ error: 'No survey URLs configured for this project' });

    // Pick survey — prefer Main, fallback to first
    const survey = surveys.find(s => s.label === 'Main') || surveys[0];
    if (!survey.url) return res.status(400).json({ error: 'Survey URL is empty' });

    const sessionLimit = Math.min(parseInt(count) || 1, 20); // hard cap at 20
    const created = [];

    for (let i = 0; i < sessionLimit; i++) {
      // Round-robin personas if multiple provided
      const personaId = personaIds.length > 0
        ? personaIds[i % personaIds.length]
        : null;

      // Generate unique 12-char response ID
      const responseId = generateResponseId();

      // Replace 'identifier' placeholder in survey URL with the response ID
      const finalUrl = survey.url.replace(/identifier/gi, responseId);

      // Determine country — from trigger request, then survey config, then null
      const country = proxyCountry || (survey.countries?.[0]) || null;

      // Create session DB record
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

      // Enqueue BullMQ job
      await sessionQueue.add('run-session', {
        sessionId:    session.id,
        projectId,
        personaId,
        surveyUrl:    finalUrl,
        responseId,
        proxyProvider: project.proxy_provider || 'decodo',
        proxyCountry:  country,
        deviceType:    project.device_type || 'desktop',
        aiStrategy:    project.ai_strategy || 'persona_true',
      }, {
        jobId:    `session-${session.id}`,
        priority: 1,
      });

      created.push({
        ...session,
        response_id: responseId,
        final_url:   finalUrl,
      });
    }

    console.log(`[Sessions] Queued ${created.length} session(s) for project ${projectId}`);

    res.status(201).json({
      message:  `${created.length} session(s) queued successfully`,
      sessions: created,
    });

  } catch (err) {
    console.error('Trigger sessions error:', err.message);
    res.status(500).json({ error: 'Failed to trigger sessions' });
  }
});

// ─── GET /api/sessions/live/:projectId ────────────────────────────────────────
router.get('/live/:projectId', async (req, res) => {
  try {
    const sessions = await getLiveSessions(req.params.projectId);
    res.json({ sessions });
  } catch (err) {
    console.error('Live sessions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch live sessions' });
  }
});

module.exports = router;