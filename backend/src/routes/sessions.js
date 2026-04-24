"use strict";
const express = require("express");
const path = require("path");
const fs = require("fs");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  createSession,
  getLiveSessions,
  getSessionDetail,
} = require("../db/sessions");
const { sessionQueue } = require("../queues/index");
const { getProjectById, getProjectSurveys } = require("../db/projects");

const router = express.Router();
router.use(requireAuth);

const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || "/app/screenshots";

// ─── Generate 12-char alphanumeric response ID ────────────────────────────────
const generateResponseId = () => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 12; i++)
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
};

// ─── POST /api/sessions/trigger ───────────────────────────────────────────────
router.post(
  "/trigger",
  requireRole("admin", "project_manager"),
  async (req, res) => {
    try {
      const { projectId, personaIds = [], count = 1, proxyCountry } = req.body;

      if (!projectId)
        return res.status(400).json({ error: "projectId is required" });

      const project = await getProjectById(projectId, req.user.workspace_id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const surveys = await getProjectSurveys(projectId);
      if (!surveys.length)
        return res.status(400).json({ error: "No survey URLs configured" });

      const survey = surveys.find((s) => s.label === "Main") || surveys[0];
      if (!survey.url)
        return res.status(400).json({ error: "Survey URL is empty" });

      const sessionLimit = Math.min(parseInt(count) || 1, 20);
      const created = [];

      for (let i = 0; i < sessionLimit; i++) {
        const personaId =
          personaIds.length > 0 ? personaIds[i % personaIds.length] : null;
        const responseId = generateResponseId();
        const finalUrl = survey.url.replace(/identifier/gi, responseId);
        const country = proxyCountry || survey.countries?.[0] || null;

        const session = await createSession({
          projectId,
          workspaceId: req.user.workspace_id,
          personaId,
          surveyUrl: finalUrl,
          surveyLabel: survey.label,
          responseId,
          proxyCountry: country,
          proxyProvider: project.proxy_provider || "decodo",
          deviceType: project.device_type || "desktop",
          browserType: "chrome",
          aiStrategy: project.ai_strategy || "persona_true",
        });

        await sessionQueue.add(
          "run-session",
          {
            sessionId: session.id,
            projectId,
            personaId,
            surveyUrl: finalUrl,
            responseId,
            proxyProvider: project.proxy_provider || "decodo",
            proxyCountry: country,
            deviceType: project.device_type || "desktop",
            aiStrategy: project.ai_strategy || "persona_true",
          },
          { jobId: `session-${session.id}`, priority: 1 },
        );

        created.push(session);
      }

      console.log(
        `[Sessions] Queued ${created.length} session(s) for project ${projectId}`,
      );
      res
        .status(201)
        .json({
          message: `${created.length} session(s) queued`,
          sessions: created,
        });
    } catch (err) {
      console.error("Trigger sessions error:", err.message);
      res.status(500).json({ error: "Failed to trigger sessions" });
    }
  },
);

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

// ─── GET /api/sessions/:id/screenshot/:filename — Serve screenshot ────────────
router.get("/:id/screenshot/:filename", (req, res) => {
  try {
    const filePath = path.join(
      SCREENSHOTS_DIR,
      req.params.id,
      req.params.filename,
    );
    if (!fs.existsSync(filePath))
      return res.status(404).json({ error: "Screenshot not found" });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to serve screenshot" });
  }
});

module.exports = router;
