"use strict";
// backend/src/routes/scenarios.js

const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  getProjectScenarios,
  getScenarioById,
  createScenario,
  updateScenario,
  deleteScenario,
  duplicateScenario,
} = require("../db/scenarios");
const { getSessionDetail } = require("../db/sessions");
const { getScenariosByIds } = require('../db/scenarios');

const router = express.Router();
router.use(requireAuth);

// ─── GET /api/scenarios/project/:projectId ────────────────────────────────────
router.get("/project/:projectId", async (req, res) => {
  try {
    const scenarios = await getProjectScenarios(req.params.projectId);
    res.json({ scenarios });
  } catch (err) {
    console.error("Get scenarios error:", err.message);
    res.status(500).json({ error: "Failed to fetch scenarios" });
  }
});

// ─── GET /api/scenarios/:id ───────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const scenario = await getScenarioById(req.params.id);
    if (!scenario) return res.status(404).json({ error: "Scenario not found" });
    res.json({ scenario });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scenario" });
  }
});

// ─── POST /api/scenarios ──────────────────────────────────────────────────────
router.post("/", requireRole("admin", "project_manager"), async (req, res) => {
  try {
    const { projectId, name, description, expectedOutcome, steps } = req.body;
    if (!projectId || !name)
      return res.status(400).json({ error: "projectId and name are required" });

    const scenario = await createScenario({
      projectId,
      workspaceId: req.user.workspace_id,
      name,
      description,
      expectedOutcome,
      createdBy: req.user.id,
      steps: steps || [],
    });
    res.status(201).json({ scenario });
  } catch (err) {
    console.error("Create scenario error:", err.message);
    res.status(500).json({ error: "Failed to create scenario" });
  }
});

// ─── POST /api/scenarios/from-session/:sessionId ─────────────────────────────
// Build a scenario from a completed session's page_answered events
router.post(
  "/from-session/:sessionId",
  requireRole("admin", "project_manager"),
  async (req, res) => {
    try {
      const {
        name,
        description,
        expectedOutcome,
        projectId,
        selectedPageIndices,
      } = req.body;
      if (!name || !projectId)
        return res
          .status(400)
          .json({ error: "name and projectId are required" });

      const detail = await getSessionDetail(req.params.sessionId);
      if (!detail) return res.status(404).json({ error: "Session not found" });

      // Extract page_answered events
      const pageEvents = (detail.events || [])
        .filter((e) => e.event_type === "page_answered")
        .map((e) => ({
          ...e,
          payload:
            typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
        }));

      // Build steps from page events
      const steps = [];
      pageEvents.forEach((ev, i) => {
        // Skip pages not selected by user (if selectedPageIndices provided)
        if (selectedPageIndices && !selectedPageIndices.includes(i)) return;

        // Skip exit pages
        if (ev.payload?.isExitPage) return;

        const options = ev.payload?.options || [];
        const questions = ev.payload?.questions || [];
        const questionText = questions[0] || "";

        // Detect grid: multiple radio groups on same page
        const radioGroups = options.filter(
          (o) => o.type === "radio" && o.selected,
        );
        const isGrid = radioGroups.length > 1;

        if (isGrid) {
          const rowSelections = radioGroups.map((optGroup) => {
            const idx = (optGroup.options || []).indexOf(optGroup.selected);
            return {
              row: optGroup.rowLabel || null,
              col: idx >= 0 ? idx + 1 : 1,
              answer: optGroup.selected,
            };
          });
          steps.push({
            when_type: questionText ? "question_contains" : "page_number",
            when_value: questionText
              ? questionText.slice(0, 120)
              : String(i + 1),
            conditions: [],
            action: "select_grid",
            action_values: rowSelections.map((r) => r.col),
            action_mode: null,
            action_text: JSON.stringify(rowSelections),
            duration_s: null,
          });
        } else {
          options.forEach((optGroup) => {
            if (
              !optGroup.selected ||
              (Array.isArray(optGroup.selected) &&
                optGroup.selected.length === 0)
            )
              return;
            let action = "select_exact";
            let actionValues = [];
            if (optGroup.type === "radio" && optGroup.selected) {
              const idx = (optGroup.options || []).indexOf(optGroup.selected);
              actionValues = idx >= 0 ? [idx + 1] : [optGroup.selected];
              action = "select_exact";
            } else if (
              optGroup.type === "checkbox" &&
              optGroup.selected?.length > 0
            ) {
              actionValues = optGroup.selected.map((s) => {
                const idx = (optGroup.options || []).indexOf(s);
                return idx >= 0 ? idx + 1 : s;
              });
              action = "select_one_of";
            } else if (optGroup.type === "select" && optGroup.selected) {
              const idx = (optGroup.options || []).indexOf(optGroup.selected);
              actionValues = idx >= 0 ? [idx + 1] : [optGroup.selected];
              action = "select_exact";
            } else if (optGroup.type === "open-end" && optGroup.selected) {
              action = "open_end";
              actionValues = [];
            }
            if (action === "open_end") {
              steps.push({
                when_type: questionText ? "question_contains" : "page_number",
                when_value: questionText || String(i + 1),
                conditions: [],
                action: "open_end",
                action_values: [],
                action_mode: "persona_ai",
                action_text: null,
                duration_s: null,
              });
            } else {
              steps.push({
                when_type: questionText ? "question_contains" : "page_number",
                when_value: questionText
                  ? questionText.slice(0, 120)
                  : String(i + 1),
                conditions: [],
                action,
                action_values: actionValues,
                action_mode: null,
                action_text: null,
                duration_s: null,
              });
            }
          });
        }
      });

      const scenario = await createScenario({
        projectId,
        workspaceId: req.user.workspace_id,
        name,
        description:
          description ||
          `Created from session ${req.params.sessionId.slice(0, 8)}`,
        expectedOutcome: expectedOutcome || detail.session?.outcome || "any",
        sourceSessionId: req.params.sessionId,
        createdBy: req.user.id,
        steps,
      });

      res.status(201).json({ scenario });
    } catch (err) {
      console.error("Create from session error:", err.message);
      res
        .status(500)
        .json({ error: `Failed to create scenario: ${err.message}` });
    }
  },
);

// ─── PATCH /api/scenarios/:id ─────────────────────────────────────────────────
router.patch(
  "/:id",
  requireRole("admin", "project_manager"),
  async (req, res) => {
    try {
      const { name, description, expectedOutcome, isActive, steps } = req.body;
      const scenario = await updateScenario(req.params.id, {
        name,
        description,
        expectedOutcome,
        isActive,
        steps,
      });
      res.json({ scenario });
    } catch (err) {
      console.error("Update scenario error:", err.message);
      res.status(500).json({ error: "Failed to update scenario" });
    }
  },
);

// ─── POST /api/scenarios/:id/duplicate ───────────────────────────────────────
router.post(
  "/:id/duplicate",
  requireRole("admin", "project_manager"),
  async (req, res) => {
    try {
      const scenario = await duplicateScenario(req.params.id, req.user.id);
      res.status(201).json({ scenario });
    } catch (err) {
      res.status(500).json({ error: "Failed to duplicate scenario" });
    }
  },
);

// ─── DELETE /api/scenarios/:id ───────────────────────────────────────────────
router.delete(
  "/:id",
  requireRole("admin", "project_manager"),
  async (req, res) => {
    try {
      await deleteScenario(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete scenario" });
    }
  },
);

// ─── GET /api/scenarios/country-logic/:projectId ──────────────────────────────
// Check if a Country Logic scenario exists for a project
router.get('/country-logic/:projectId', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, country_mapping FROM scenarios
       WHERE project_id = $1 AND name = 'Country Logic' AND is_active = true
       LIMIT 1`,
      [req.params.projectId]
    );
    const scenario = result.rows[0] || null;
    if (scenario && typeof scenario.country_mapping === 'string') {
      scenario.country_mapping = JSON.parse(scenario.country_mapping);
    }
    res.json({ exists: !!scenario, scenario });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check country logic' });
  }
});

// ─── POST /api/scenarios/country-logic ────────────────────────────────────────
// Create a Country Logic scenario from a session page
router.post('/country-logic', requireRole('admin', 'project_manager'), async (req, res) => {
  try {
    const { projectId, questionContains, mappings } = req.body;
    if (!projectId || !questionContains || !mappings?.length) {
      return res.status(400).json({ error: 'projectId, questionContains and mappings are required' });
    }
    // Check if Country Logic already exists
    const existing = await pool.query(
      `SELECT id FROM scenarios WHERE project_id = $1 AND name = 'Country Logic'`,
      [projectId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Country Logic scenario already exists for this project. Delete it first.' });
    }
    const scenario = await createScenario({
      projectId,
      workspaceId: req.user.workspace_id,
      name: 'Country Logic',
      description: `Auto-generated country routing. Question: "${questionContains}"`,
      expectedOutcome: 'any',
      createdBy: req.user.id,
      steps: [],
      countryMapping: { questionContains, mappings },
    });
    // Add to project_scenarios
    await pool.query(
      `INSERT INTO project_scenarios (project_id, scenario_id, is_active) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
      [projectId, scenario.id]
    );
    res.json({ scenario });
  } catch (err) {
    console.error('Create country logic error:', err);
    res.status(500).json({ error: 'Failed to create country logic scenario' });
  }
});

module.exports = router;
