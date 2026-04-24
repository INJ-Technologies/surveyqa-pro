"use strict";
const { Worker } = require("bullmq");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const { connection } = require("../../backend/src/queues/index");
const {
  updateSessionStatus,
  logSessionEvent,
  logSessionAnswer,
  recordUsedIP,
  saveTracePath,
} = require("../../backend/src/db/sessions");
const {
  getProxyForSession,
} = require("../../backend/src/services/proxyService");
const {
  detectOutcome,
  answerPage,
  clickNext,
} = require("../../backend/src/services/decipherEngine");
const { pool } = require("../../backend/src/db/index");

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 5;
const MAX_PAGES = 50;
const TRACES_DIR = process.env.TRACES_DIR || "/app/traces";
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || "/app/screenshots";

[TRACES_DIR, SCREENSHOTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`[Worker] Starting — concurrency: ${CONCURRENCY}`);

// ─── Load persona ─────────────────────────────────────────────────────────────
const getPersona = async (personaId) => {
  if (!personaId) return null;
  try {
    const result = await pool.query(`SELECT * FROM personas WHERE id = $1`, [
      personaId,
    ]);
    return result.rows[0] || null;
  } catch {
    return null;
  }
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
    aiStrategy,
  } = job.data;

  console.log(`[Worker] Session ${sessionId} | ResponseID: ${responseId}`);

  await updateSessionStatus(sessionId, "initialising");
  await logSessionEvent(sessionId, "worker_started", {
    jobId: job.id,
    responseId,
  });

  const persona = await getPersona(personaId);
  const readingSpeed = persona?.behavioural_attrs?.readingSpeed || "normal";
  const deviceOs = persona?.behavioural_attrs?.deviceOs || "windows";

  const viewports = {
    desktop: { width: 1366, height: 768 },
    mobile: { width: 390, height: 844 },
    tablet: { width: 820, height: 1180 },
  };
  const viewport = viewports[deviceType] || viewports.desktop;

  const userAgents = {
    "desktop-windows":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "desktop-macos":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "mobile-android":
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "mobile-ios":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  };
  const uaKey = `${deviceType}-${deviceOs.toLowerCase()}`;
  const userAgent = userAgents[uaKey] || userAgents["desktop-windows"];

  const proxySessionId = sessionId.slice(0, 8);
  const proxy = getProxyForSession(proxyProvider, proxyCountry, proxySessionId);

  const launchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  };
  if (proxy) launchOptions.proxy = proxy;

  // Session screenshot directory
  const sessionScreenshotsDir = path.join(SCREENSHOTS_DIR, sessionId);
  fs.mkdirSync(sessionScreenshotsDir, { recursive: true });

  let browser, context, page;
  let outcome = null;
  let pageCount = 0;
  let questionCount = 0;
  const startTime = Date.now();
  const tracePath = path.join(TRACES_DIR, `${sessionId}.zip`);
  const pages = []; // store page-level report data

  try {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      viewport,
      userAgent,
      locale: "en-US",
      timezoneId: "Asia/Kolkata",
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // Start trace
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      title: `Session ${sessionId}`,
    });

    page = await context.newPage();

    // Get IP
    try {
      const ipRes = await page.goto("https://api.ipify.org?format=json", {
        timeout: 12000,
      });
      const ipData = await ipRes.json();
      if (ipData?.ip) {
        await recordUsedIP(projectId, sessionId, ipData.ip);
        await logSessionEvent(sessionId, "ip_assigned", {
          ip: ipData.ip,
          country: proxyCountry,
        });
      }
    } catch (e) {
      await logSessionEvent(sessionId, "ip_check_failed", { error: e.message });
    }

    await updateSessionStatus(sessionId, "in_progress");
    await logSessionEvent(sessionId, "browser_launched", {
      proxy: proxy ? "decodo" : "direct",
      responseId,
      surveyUrl,
    });

    // Navigate to survey
    await page.goto(surveyUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await logSessionEvent(sessionId, "survey_loaded", {
      url: surveyUrl,
      responseId,
    });

    // ── Main survey loop ──────────────────────────────────────────────────
    while (pageCount < MAX_PAGES) {
      pageCount++;
      const currentUrl = page.url();
      const pageStart = Date.now();

      // Check for redirect outcome
      outcome = detectOutcome(currentUrl);
      if (outcome) {
        await logSessionEvent(sessionId, "redirect_detected", {
          url: currentUrl,
          outcome,
        });
        break;
      }

      // Screenshot BEFORE answering — captures the question state
      const screenshotPath = path.join(
        sessionScreenshotsDir,
        `page_${pageCount}.png`,
      );
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch {}

      // Extract page title and any visible question text
      let pageTitle = "";
      let questionsOnPage = [];
      try {
        pageTitle = await page.title();
        // Try to extract question text from common Decipher selectors
        questionsOnPage = await page.evaluate(() => {
          const selectors = [
            ".sv_q_title",
            ".survey-question",
            ".question-text",
            ".sv-title",
            "h2",
            "h3",
            "legend",
            '[class*="question"] label',
            '[class*="title"]',
          ];
          const found = [];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            els.forEach((el) => {
              const text = el.innerText?.trim();
              if (
                text &&
                text.length > 5 &&
                text.length < 500 &&
                !found.includes(text)
              ) {
                found.push(text);
              }
            });
            if (found.length >= 5) break;
          }
          return found.slice(0, 5);
        });
      } catch {}

      // Answer questions
      const answers = await answerPage(page, persona, readingSpeed);
      questionCount++;

      const pageTime = Math.round((Date.now() - pageStart) / 1000);

      // Store page data for session report
      const pageData = {
        pageNum: pageCount,
        url: currentUrl,
        title: pageTitle,
        questions: questionsOnPage,
        answers: answers || [],
        timeTaken: pageTime,
        screenshot: `${sessionId}/page_${pageCount}.png`,
      };
      pages.push(pageData);

      await logSessionEvent(sessionId, "page_answered", {
        page: pageCount,
        url: currentUrl,
        title: pageTitle,
        questions: questionsOnPage,
        answers: answers || [],
        timeTaken: pageTime,
        screenshot: `${sessionId}/page_${pageCount}.png`,
      });

      // Click next
      const clicked = await clickNext(page);
      if (!clicked) {
        outcome = detectOutcome(page.url()) || "completed";
        break;
      }

      try {
        await page.waitForNavigation({
          timeout: 15000,
          waitUntil: "domcontentloaded",
        });
      } catch {
        await page.waitForTimeout(2000);
      }

      const newUrl = page.url();
      outcome = detectOutcome(newUrl);
      if (outcome) {
        // Screenshot of final redirect page
        const finalScreenshotPath = path.join(
          sessionScreenshotsDir,
          `page_${pageCount + 1}_final.png`,
        );
        try {
          await page.screenshot({ path: finalScreenshotPath, fullPage: true });
        } catch {}
        await logSessionEvent(sessionId, "redirect_detected", {
          url: newUrl,
          outcome,
          screenshot: `${sessionId}/page_${pageCount + 1}_final.png`,
        });
        break;
      }
    }

    if (!outcome) outcome = pageCount >= MAX_PAGES ? "error" : "completed";
  } catch (err) {
    outcome = "error";
    await logSessionEvent(sessionId, "error", { message: err.message });
    console.error(`[Worker] Session ${sessionId} error:`, err.message);
  } finally {
    try {
      if (context) {
        await context.tracing.stop({ path: tracePath });
        await saveTracePath(sessionId, tracePath);
      }
    } catch {}
    try {
      await browser?.close();
    } catch {}
  }

  const durationS = Math.round((Date.now() - startTime) / 1000);
  await updateSessionStatus(sessionId, outcome, {
    outcome,
    totalDurationS: durationS,
    questionCount,
    redirectType: outcome,
  });

  await logSessionEvent(sessionId, "session_complete", {
    outcome,
    durationS,
    pageCount,
    questionCount,
    responseId,
    totalPages: pages.length,
  });

  console.log(
    `[Worker] Session ${sessionId} → ${outcome} (${durationS}s, ${pageCount} pages)`,
  );
  return { sessionId, outcome, durationS, responseId };
};

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker("survey-sessions", processSession, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on("completed", (job, result) =>
  console.log(`[Worker] Job ${job.id} completed — ${result.outcome}`),
);
worker.on("failed", (job, err) =>
  console.error(`[Worker] Job ${job.id} failed:`, err.message),
);
worker.on("error", (err) => console.error("[Worker] Error:", err));

process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});

console.log("[Worker] Ready and listening for jobs...");
