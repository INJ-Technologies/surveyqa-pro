"use strict";
const { Worker } = require("bullmq");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const { connection } = require("../../backend/src/queues/index");
const {
  updateSessionStatus,
  logSessionEvent,
  recordUsedIP,
  saveTracePath,
} = require("../../backend/src/db/sessions");
const {
  getProxyForSession,
} = require("../../backend/src/services/proxyService");
const {
  detectOutcome,
  detectOutcomeFromPage,
  answerPage,
  clickNext,
  capturePageOptions,
  isHintText,
} = require("../../backend/src/services/decipherEngine");
const { pool } = require("../../backend/src/db/index");
const { getActiveScenarios } = require("../../backend/src/db/scenarios");

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 5;
const MAX_PAGES = 50;
const TRACES_DIR = process.env.TRACES_DIR || "/app/traces";
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || "/app/screenshots";

[TRACES_DIR, SCREENSHOTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`[Worker] Starting — concurrency: ${CONCURRENCY}`);
console.log(`[Worker] Screenshots: ${SCREENSHOTS_DIR}`);
console.log(`[Worker] Traces:      ${TRACES_DIR}`);

// ─── Load persona ─────────────────────────────────────────────────────────────
const getPersona = async (personaId) => {
  if (!personaId) return null;
  try {
    const result = await pool.query(`SELECT * FROM personas WHERE id = $1`, [personaId]);
    return result.rows[0] || null;
  } catch {
    return null;
  }
};

// ─── Build human-readable answer summary ─────────────────────────────────────
const buildAnswerSummary = (pageOptions, answersGiven) => {
  const summary = [];
  for (const opt of pageOptions || []) {
    if (opt.type === "radio" && opt.selected) {
      const totalOpts = opt.options?.length || 0;
      const selIdx = opt.options?.indexOf(opt.selected);
      const selNum = selIdx >= 0 ? selIdx + 1 : "?";
      summary.push({ type: "radio", label: `Selected: ${opt.selected}`, detail: `Option ${selNum} of ${totalOpts}`, options: opt.options || [], selected: opt.selected });
    } else if (opt.type === "checkbox" && opt.selected?.length > 0) {
      summary.push({ type: "checkbox", label: `Selected ${opt.selected.length} of ${opt.options?.length || "?"}`, detail: opt.selected.join(", "), options: opt.options || [], selected: opt.selected });
    } else if (opt.type === "select" && opt.selected) {
      summary.push({ type: "select", label: `Selected: ${opt.selected}`, options: opt.options || [], selected: opt.selected });
    }
  }
  for (const ans of answersGiven || []) {
    if (ans?.type === "open-end" && ans.text) summary.push({ type: "open-end", label: "Typed response", detail: ans.text });
    if (ans?.type === "numeric" && ans.values?.length > 0) summary.push({ type: "numeric", label: "Entered value", detail: ans.values.join(", ") });
  }
  return summary;
};

// ─── Screenshot with retry ────────────────────────────────────────────────────
// Takes screenshot, retrying once after a short wait if the page is mid-navigate.
const takeScreenshot = async (page, screenshotPath, currentUrl) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // If URL has changed from when we started the page, capture what we have
      await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 8000 });
      return true;
    } catch (e) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.warn(`[Worker] Screenshot failed after 3 attempts: ${e.message}`);
        return false;
      }
    }
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO ENGINE
// ══════════════════════════════════════════════════════════════════════════════

// ─── Load the scenario assigned to this session (round-robin) ─────────────────
const loadSessionScenario = async (projectId, sessionId, scenarioIds = null) => {
  try {
    let scenarios = await getActiveScenarios(projectId);
    if (!scenarios || scenarios.length === 0) return null;
    // Filter to only user-selected scenarios if provided
    if (scenarioIds && scenarioIds.length > 0) {
      scenarios = scenarios.filter(s => scenarioIds.includes(s.id));
    }
    if (scenarios.length === 0) return null;

    // Determine session position for round-robin
    const posResult = await pool.query(
      `SELECT COUNT(*) AS pos FROM sessions
       WHERE project_id = $1 AND created_at <= (SELECT created_at FROM sessions WHERE id = $2)`,
      [projectId, sessionId]
    );
    const pos = Math.max(0, parseInt(posResult.rows[0]?.pos || 1) - 1);
    const scenario = scenarios[pos % scenarios.length];

    // Ensure steps are loaded (getActiveScenarios may return them as json_agg)
    let steps = scenario.steps;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      const stepsResult = await pool.query(
        `SELECT * FROM scenario_steps WHERE scenario_id = $1 ORDER BY step_order ASC`,
        [scenario.id]
      );
      steps = stepsResult.rows.map(r => ({
        ...r,
        conditions:    typeof r.conditions    === "string" ? JSON.parse(r.conditions)    : r.conditions    || [],
        action_values: typeof r.action_values === "string" ? JSON.parse(r.action_values) : r.action_values || [],
      }));
    }

    console.log(`[Scenario] Assigned: "${scenario.name}" (${steps.length} steps) → session ${sessionId.slice(0,8)}`);
    return { ...scenario, steps };
  } catch (e) {
    console.warn("[Scenario] Could not load scenario:", e.message);
    return null;
  }
};

// ─── Match a scenario step against the current page ───────────────────────────
const matchStep = (step, questionsOnPage, pageNum) => {
  const { when_type, when_value } = step;
  if (when_type === "always") return true;
  if (when_type === "page_number") return parseInt(when_value) === pageNum;
  if (when_type === "question_contains") {
    const needle = (when_value || "").toLowerCase();
    return questionsOnPage.some(q => q.toLowerCase().includes(needle));
  }
  if (when_type === "question_position") {
    return questionsOnPage.length >= parseInt(when_value || 1);
  }
  return false;
};

// ─── Execute a scenario action ────────────────────────────────────────────────
// Returns: array of answers (even empty) = action handled
//          null = fall through to default random answering
const executeScenarioAction = async (page, step) => {
  const { action, action_values, action_mode, action_text, duration_s } = step;
  const vals = Array.isArray(action_values) ? action_values.map(v => parseInt(v)) : [];

  try {
    // ── skip: click next without answering ──────────────────────────────────
    if (action === "skip") {
      console.log("[Scenario] Action: skip");
      return [];
    }

    // ── wait: pause N seconds ───────────────────────────────────────────────
    if (action === "wait") {
      const secs = duration_s || 5;
      console.log(`[Scenario] Action: wait ${secs}s`);
      await page.waitForTimeout(secs * 1000);
      return [];
    }

    // ── back: click back button ─────────────────────────────────────────────
    if (action === "back") {
      console.log("[Scenario] Action: back");
      const backBtn = page.locator('input[value="Back"], button:has-text("Back"), .back-button').first();
      await backBtn.click({ timeout: 5000 }).catch(() => {});
      return [];
    }

    // ── open_end: type specific text ────────────────────────────────────────
    if (action === "open_end") {
      if (action_mode === "specific" && action_text) {
        console.log(`[Scenario] Action: open_end specific → "${action_text.slice(0,40)}"`);
        const fields = await page.locator("textarea, input[type='text']").all();
        for (const field of fields) {
          const visible = await field.isVisible().catch(() => false);
          if (visible) await field.fill(action_text).catch(() => {});
        }
        return [{ type: "open-end", text: action_text }];
      }
      // For persona_ai / predefined — fall through to default
      return null;
    }

    // ── Helpers: get all radio groups in DOM order ───────────────────────────
    const getRadioGroups = async () => {
      const radios = await page.locator("input[type='radio']").all();
      const groupMap = {};
      const groupOrder = [];
      for (const radio of radios) {
        const name = await radio.getAttribute("name").catch(() => null);
        if (!name) continue;
        if (!groupMap[name]) { groupMap[name] = []; groupOrder.push(name); }
        groupMap[name].push(radio);
      }
      return { groupMap, groupOrder };
    };

    // ── select_exact: click specific option position(s) ─────────────────────
    if (action === "select_exact") {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      // Apply to first group (single question)
      const options = groupMap[groupOrder[0]];
      for (const colIdx of vals) {
        const idx = colIdx - 1;
        if (idx >= 0 && idx < options.length) {
          await options[idx].click({ force: true }).catch(() => {});
          console.log(`[Scenario] Action: select_exact → option ${colIdx}`);
        }
      }
      return [{ type: "radio", scenarioControlled: true }];
    }

    // ── select_one_of: pick one randomly from listed positions ───────────────
    if (action === "select_one_of") {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const valid = vals.filter(v => v >= 1 && v <= options.length);
      if (valid.length > 0) {
        const chosen = valid[Math.floor(Math.random() * valid.length)];
        await options[chosen - 1].click({ force: true }).catch(() => {});
        console.log(`[Scenario] Action: select_one_of → picked option ${chosen}`);
      }
      return [{ type: "radio", scenarioControlled: true }];
    }

    // ── select_not_in: avoid listed positions, pick from the rest ───────────
    if (action === "select_not_in") {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const excludeIdxs = new Set(vals.map(v => v - 1));
      const available = options.filter((_, i) => !excludeIdxs.has(i));
      if (available.length > 0) {
        const chosen = available[Math.floor(Math.random() * available.length)];
        await chosen.click({ force: true }).catch(() => {});
        console.log(`[Scenario] Action: select_not_in → picked from ${available.length} available`);
      }
      return [{ type: "radio", scenarioControlled: true }];
    }

    // ── select_random: pick N random options ────────────────────────────────
    if (action === "select_random") {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const maxSel = vals[0] || 1;
      const indices = [...Array(options.length).keys()].sort(() => Math.random() - 0.5).slice(0, maxSel);
      for (const idx of indices) {
        await options[idx].click({ force: true }).catch(() => {});
      }
      console.log(`[Scenario] Action: select_random → picked ${indices.length} option(s)`);
      return [{ type: "radio", scenarioControlled: true }];
    }

    // ── select_grid: per-row selections for matrix questions ─────────────────
    if (action === "select_grid") {
      let rowSelections = [];
      try { rowSelections = JSON.parse(action_text || "[]"); } catch {}
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0 || rowSelections.length === 0) return null;

      for (let ri = 0; ri < rowSelections.length && ri < groupOrder.length; ri++) {
        const sel = rowSelections[ri];
        const options = groupMap[groupOrder[ri]];
        const colIdx = (parseInt(sel.col) || 1) - 1;
        if (colIdx >= 0 && colIdx < options.length) {
          await options[colIdx].click({ force: true }).catch(() => {});
        }
      }
      console.log(`[Scenario] Action: select_grid → ${rowSelections.length} row(s) answered`);
      return [{ type: "grid", scenarioControlled: true }];
    }

    // ── numeric_fill: fill numeric/allocation fields ─────────────────────────
    if (action === "numeric_fill") {
      const min = parseFloat(vals[0] ?? 0);
      const max = parseFloat(vals[1] ?? 100);
      const roundTo = parseFloat(action_text) || 1;
      const inputs = await page.locator("input[type='number'], input[type='text'][class*='num'], input[class*='number']").all();
      const results = [];
      for (const input of inputs) {
        const visible = await input.isVisible().catch(() => false);
        if (!visible) continue;
        const raw = min + Math.random() * (max - min);
        const rounded = Math.round(raw / roundTo) * roundTo;
        await input.fill(String(rounded)).catch(() => {});
        results.push(rounded);
      }
      console.log(`[Scenario] Action: numeric_fill → values: ${results.join(", ")}`);
      return [{ type: "numeric", values: results, scenarioControlled: true }];
    }

  } catch (e) {
    console.warn(`[Scenario] Action "${action}" failed: ${e.message}`);
    return null; // fall through to default
  }

  return null;
};

// ── Find first matching step for this page ────────────────────────────────────
const findMatchingStep = (scenario, questionsOnPage, pageNum) => {
  if (!scenario?.steps?.length) return null;
  for (const step of scenario.steps) {
    if (matchStep(step, questionsOnPage, pageNum)) {
      console.log(`[Scenario] Step matched: WHEN "${step.when_type}" = "${step.when_value}" → THEN "${step.action}"`);
      return step;
    }
  }
  return null;
};

// ─── Main session processor ───────────────────────────────────────────────────
const processSession = async (job) => {
  const {
    sessionId,
    projectId,
    personaId,
    surveyUrl,
    responseId,
    proxyProvider,
    proxyCountry,
    deviceType,
    scenarioIds,
  } = job.data;

  console.log(`[Worker] Session ${sessionId} | Country: ${proxyCountry} | ResponseID: ${responseId}`);

  await updateSessionStatus(sessionId, "initialising");
  await logSessionEvent(sessionId, "worker_started", { jobId: job.id, responseId });

  const persona = await getPersona(personaId);
  const readingSpeed = persona?.behavioural_attrs?.readingSpeed || "normal";
  const deviceOs = persona?.behavioural_attrs?.deviceOs || "windows";

  // ── Load scenario for this session ─────────────────────────────────────────
  const scenario = await loadSessionScenario(projectId, sessionId, scenarioIds);
  if (scenario) {
    await logSessionEvent(sessionId, "scenario_assigned", {
      scenarioId:   scenario.id,
      scenarioName: scenario.name,
      stepCount:    scenario.steps?.length || 0,
    });
  }

  const viewports = {
    desktop: { width: 1366, height: 768 },
    mobile:  { width: 390,  height: 844  },
    tablet:  { width: 820,  height: 1180 },
  };
  const viewport = viewports[deviceType] || viewports.desktop;

  const userAgents = {
    "desktop-windows": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "desktop-macos":   "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "mobile-android":  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "mobile-ios":      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  };
  const uaKey = `${deviceType || "desktop"}-${deviceOs.toLowerCase()}`;
  const userAgent = userAgents[uaKey] || userAgents["desktop-windows"];

  // ── Proxy ─────────────────────────────────────────────────────────────────
  const proxySessionId = sessionId.slice(0, 8);
  const proxy = await getProxyForSession(proxyProvider || "decodo", {
    country: proxyCountry || null,
    sessionId: proxySessionId,
  });

  if (proxy) {
    console.log(`[Proxy] Server:   ${proxy.server}`);
    console.log(`[Proxy] Username: ${proxy.username}`);
    console.log(`[Proxy] Country:  ${proxyCountry || "none"}`);
  } else {
    console.log("[Proxy] DIRECT — no proxy configured");
  }

  const launchOptions = {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    }),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  };
  if (proxy) launchOptions.proxy = proxy;

  const sessionScreenshotsDir = path.join(SCREENSHOTS_DIR, sessionId);
  fs.mkdirSync(sessionScreenshotsDir, { recursive: true });

  let browser, context, page;
  let outcome = null;
  let errorMessage = null;
  let pageCount = 0;
  let questionCount = 0;
  const startTime = Date.now();
  const tracePath = path.join(TRACES_DIR, `${sessionId}.zip`);
  const pages = [];

  try {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({ viewport, userAgent, locale: "en-US", timezoneId: "Asia/Kolkata" });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver",  { get: () => undefined });
      Object.defineProperty(navigator, "plugins",    { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages",  { get: () => ["en-US", "en"] });
    });

    await context.tracing.start({ screenshots: true, snapshots: true, title: `Session ${sessionId}` });
    page = await context.newPage();

    // ── IP check ─────────────────────────────────────────────────────────────
    try {
      const ipRes = await page.goto("https://api.ipify.org?format=json", { timeout: 12000 });
      const ipData = await ipRes.json();
      if (ipData?.ip) {
        await recordUsedIP(projectId, sessionId, ipData.ip);
        await logSessionEvent(sessionId, "ip_assigned", { ip: ipData.ip, country: proxyCountry });
        console.log(`[Worker] IP: ${ipData.ip} (requested: ${proxyCountry})`);
      }
    } catch (e) {
      await logSessionEvent(sessionId, "ip_check_failed", { error: e.message });
    }

    await updateSessionStatus(sessionId, "in_progress");
    await logSessionEvent(sessionId, "browser_launched", {
      proxy: proxy ? `decodo-${proxyCountry}` : "direct",
      responseId,
      surveyUrl,
      scenarioName: scenario?.name || null,
    });

    console.log(`[Worker] Navigating to: ${surveyUrl}`);
    await page.goto(surveyUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await logSessionEvent(sessionId, "survey_loaded", { url: surveyUrl, responseId });

    // ── Main survey loop ──────────────────────────────────────────────────────
    while (pageCount < MAX_PAGES) {
      pageCount++;
      const currentUrl = page.url();
      const pageStart = Date.now();

      console.log(`[Worker] Page ${pageCount}: ${currentUrl}`);

      // Check URL for outcome
      outcome = detectOutcome(currentUrl);
      if (outcome) {
        await logSessionEvent(sessionId, "redirect_detected", { url: currentUrl, outcome });
        break;
      }

      // Scan page content for Decipher exit pages
      const contentOutcome = await detectOutcomeFromPage(page);
      if (contentOutcome) {
        outcome = contentOutcome;
        console.log(`[Worker] Exit page detected from content: ${outcome}`);

        const exitFilename = `page_${pageCount}.png`;
        const exitPath = path.join(sessionScreenshotsDir, exitFilename);
        await takeScreenshot(page, exitPath, currentUrl);

        await logSessionEvent(sessionId, "page_answered", {
          page: pageCount, url: currentUrl,
          title: await page.title().catch(() => "Exit Page"),
          questions: [], options: [], answers: [], answerSummary: [],
          timeTaken: 0,
          screenshot: `${sessionId}/${exitFilename}`,
          isExitPage: true, exitOutcome: contentOutcome,
        });
        await logSessionEvent(sessionId, "redirect_detected", {
          url: currentUrl, outcome, detectedBy: "page_content",
          screenshot: `${sessionId}/${exitFilename}`,
        });
        break;
      }

      // ── Capture question text BEFORE answering ────────────────────────────
      let pageTitle = "";
      let questionsOnPage = [];
      try {
        pageTitle = await page.title();
        const rawTexts = await page.evaluate(() => {
          const selectors = [".qtext", ".question-text", ".qtitle", '[class*="qtext"]', '[class*="question-title"]', "legend", "h2", "h3"];
          const found = new Set();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => {
              const text = (el.innerText || el.textContent || "").trim();
              if (text) found.add(text);
            });
            if (found.size >= 8) break;
          }
          return [...found];
        });
        questionsOnPage = rawTexts.filter(t => !isHintText(t)).slice(0, 5);
      } catch {}

      // ── Screenshot BEFORE answering (captures the clean page state) ───────
      // This ensures we always get a screenshot even on timer pages that
      // auto-advance before we can screenshot after answering.
      const screenshotFilename = `page_${pageCount}.png`;
      const screenshotPath = path.join(sessionScreenshotsDir, screenshotFilename);
      const screenshotBeforeTaken = await takeScreenshot(page, screenshotPath, currentUrl);

      // ── Capture options BEFORE answering ──────────────────────────────────
      const pageOptionsBefore = await capturePageOptions(page);

      // ── Scenario step matching ────────────────────────────────────────────
      let answersGiven = null;
      let scenarioStepUsed = null;

      if (scenario) {
        const matchedStep = findMatchingStep(scenario, questionsOnPage, pageCount);
        if (matchedStep) {
          scenarioStepUsed = matchedStep.action;
          answersGiven = await executeScenarioAction(page, matchedStep);
          if (answersGiven === null) {
            console.log(`[Scenario] Action "${matchedStep.action}" returned null — falling through to default`);
          }
        }
      }

      // ── Default random answering (fallback when no scenario match) ────────
      if (answersGiven === null) {
        answersGiven = await answerPage(page, persona, readingSpeed);
        questionCount++;
      }

      await page.waitForTimeout(800);

      // ── Capture options AFTER answering ───────────────────────────────────
      const pageOptionsAfter = await capturePageOptions(page);

      // ── Screenshot AFTER answering (overwrites pre-answer screenshot) ─────
      // This captures the selected state. If the page has auto-navigated
      // (timer pages), the pre-answer screenshot already exists as fallback.
      await takeScreenshot(page, screenshotPath, currentUrl);

      const pageTime = Math.round((Date.now() - pageStart) / 1000);
      const answerSummary = buildAnswerSummary(pageOptionsAfter, answersGiven);

      pages.push({
        pageNum: pageCount, url: currentUrl, title: pageTitle,
        questions: questionsOnPage, options: pageOptionsAfter,
        answers: answersGiven, answerSummary,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
        scenarioStep: scenarioStepUsed || null,
      });

      await logSessionEvent(sessionId, "page_answered", {
        page: pageCount, url: currentUrl, title: pageTitle,
        questions: questionsOnPage, options: pageOptionsAfter,
        answers: answersGiven, answerSummary,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
        scenarioStep: scenarioStepUsed || null,
      });

      // ── Click next ────────────────────────────────────────────────────────
      const clicked = await clickNext(page);
      if (!clicked) {
        console.log(`[Worker] No next button on page ${pageCount}`);
        const noNextOutcome = await detectOutcomeFromPage(page);
        outcome = noNextOutcome || detectOutcome(page.url()) || "completed";
        console.log(`[Worker] No next button — outcome: ${outcome}`);
        break;
      }

      try {
        await page.waitForNavigation({ timeout: 15000, waitUntil: "domcontentloaded" });
      } catch {
        await page.waitForTimeout(3000);
      }

      const newUrl = page.url();
      outcome = detectOutcome(newUrl);

      if (!outcome) {
        await page.waitForTimeout(1500);
        outcome = await detectOutcomeFromPage(page);
        if (outcome) console.log(`[Worker] Outcome from page content after nav: ${outcome}`);
      }

      if (outcome) {
        const finalNum = pageCount + 1;
        const finalFilename = `page_${finalNum}.png`;
        const finalPath = path.join(sessionScreenshotsDir, finalFilename);
        await takeScreenshot(page, finalPath, newUrl);

        await logSessionEvent(sessionId, "page_answered", {
          page: finalNum, url: newUrl,
          title: await page.title().catch(() => "Exit Page"),
          questions: [], options: [], answers: [], answerSummary: [],
          timeTaken: 0,
          screenshot: `${sessionId}/${finalFilename}`,
          isExitPage: true, exitOutcome: outcome,
        });
        await logSessionEvent(sessionId, "redirect_detected", {
          url: newUrl, outcome,
          screenshot: `${sessionId}/${finalFilename}`,
        });
        break;
      }
    }

    if (!outcome) outcome = pageCount >= MAX_PAGES ? "error" : "completed";
  } catch (err) {
    outcome = "error";
    errorMessage = err?.stack || err?.message || String(err);
    await logSessionEvent(sessionId, "error", { message: err?.message, stack: err?.stack });
    console.error(`[Worker] Session ${sessionId} error:`, err.message);
  } finally {
    try {
      if (context) {
        await context.tracing.stop({ path: tracePath });
        await saveTracePath(sessionId, tracePath);
      }
    } catch {}
    try { await browser?.close(); } catch {}
  }

  const durationS = Math.round((Date.now() - startTime) / 1000);
  await updateSessionStatus(sessionId, outcome, {
    outcome,
    totalDurationS: durationS,
    questionCount,
    redirectType: outcome,
    ...(errorMessage ? { errorLog: errorMessage.slice(0, 2000) } : {}),
  });

  await logSessionEvent(sessionId, "session_complete", {
    outcome, durationS, pageCount, questionCount, responseId,
    screenshotsCount: pages.length,
    scenarioName: scenario?.name || null,
  });

  console.log(`[Worker] Session ${sessionId} → ${outcome} | ${durationS}s | ${pageCount} pages | scenario: ${scenario?.name || "none"}`);
  return { sessionId, outcome, durationS, responseId };
};

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker("survey-sessions", processSession, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on("completed", (job, result) =>
  console.log(`[Worker] Job ${job.id} done — ${result.outcome}`)
);
worker.on("failed", (job, err) =>
  console.error(`[Worker] Job ${job.id} failed:`, err.message)
);
worker.on("error", (err) => console.error("[Worker] Error:", err));

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

console.log("[Worker] Ready and listening for jobs...");