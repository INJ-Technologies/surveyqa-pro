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
    const result = await pool.query(`SELECT * FROM personas WHERE id = $1`, [
      personaId,
    ]);
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
      summary.push({
        type: "radio",
        label: `Selected: ${opt.selected}`,
        detail: `Option ${selNum} of ${totalOpts}`,
        options: opt.options || [],
        selected: opt.selected,
      });
    } else if (opt.type === "checkbox" && opt.selected?.length > 0) {
      summary.push({
        type: "checkbox",
        label: `Selected ${opt.selected.length} of ${opt.options?.length || "?"}`,
        detail: opt.selected.join(", "),
        options: opt.options || [],
        selected: opt.selected,
      });
    } else if (opt.type === "select" && opt.selected) {
      summary.push({
        type: "select",
        label: `Selected: ${opt.selected}`,
        options: opt.options || [],
        selected: opt.selected,
      });
    }
  }

  for (const ans of answersGiven || []) {
    if (ans?.type === "open-end" && ans.text) {
      summary.push({
        type: "open-end",
        label: "Typed response",
        detail: ans.text,
      });
    }
    if (ans?.type === "numeric" && ans.values?.length > 0) {
      summary.push({
        type: "numeric",
        label: "Entered value",
        detail: ans.values.join(", "),
      });
    }
  }

  return summary;
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
  } = job.data;

  console.log(
    `[Worker] Session ${sessionId} | Country: ${proxyCountry} | ResponseID: ${responseId}`,
  );

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
    console.log(
      `[Proxy] TEST CMD: curl -x "http://${proxy.username}:PASS@${proxy.server.replace("http://", "")}" https://ip.decodo.com/json`,
    );
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
    context = await browser.newContext({
      viewport,
      userAgent,
      locale: "en-US",
      timezoneId: "Asia/Kolkata",
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      title: `Session ${sessionId}`,
    });
    page = await context.newPage();

    // ── IP check ─────────────────────────────────────────────────────────────
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
    });

    console.log(`[Worker] Navigating to: ${surveyUrl}`);
    await page.goto(surveyUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await logSessionEvent(sessionId, "survey_loaded", {
      url: surveyUrl,
      responseId,
    });

    // ── Main survey loop ──────────────────────────────────────────────────────
    while (pageCount < MAX_PAGES) {
      pageCount++;
      const currentUrl = page.url();
      const pageStart = Date.now();

      console.log(`[Worker] Page ${pageCount}: ${currentUrl}`);

      // Check URL for outcome
      outcome = detectOutcome(currentUrl);
      if (outcome) {
        await logSessionEvent(sessionId, "redirect_detected", {
          url: currentUrl,
          outcome,
        });
        break;
      }

      // Also scan page content for Decipher exit pages (same URL)
      const contentOutcome = await detectOutcomeFromPage(page);
      if (contentOutcome) {
        outcome = contentOutcome;
        console.log(`[Worker] Exit page detected from content: ${outcome}`);
        // Screenshot the exit page
        const exitPath = path.join(
          sessionScreenshotsDir,
          `page_${pageCount}_exit.png`,
        );
        try {
          await page.screenshot({ path: exitPath, fullPage: true });
        } catch {}
        await logSessionEvent(sessionId, "redirect_detected", {
          url: currentUrl,
          outcome,
          detectedBy: "page_content",
          screenshot: `${sessionId}/page_${pageCount}_exit.png`,
        });
        break;
      }

      // ── Capture question text BEFORE answering ────────────────────────────
      let pageTitle = "";
      let questionsOnPage = [];
      try {
        pageTitle = await page.title();
        const rawTexts = await page.evaluate(() => {
          const selectors = [
            ".qtext",
            ".question-text",
            ".qtitle",
            '[class*="qtext"]',
            '[class*="question-title"]',
            "legend",
            "h2",
            "h3",
          ];
          const found = new Set();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach((el) => {
              const text = (el.innerText || el.textContent || "").trim();
              if (text) found.add(text);
            });
            if (found.size >= 8) break;
          }
          return [...found];
        });
        questionsOnPage = rawTexts.filter((t) => !isHintText(t)).slice(0, 5);
      } catch {}

      // ── Capture options BEFORE answering ──────────────────────────────────
      const pageOptionsBefore = await capturePageOptions(page);

      // ── Answer questions ──────────────────────────────────────────────────
      const answersGiven = await answerPage(page, persona, readingSpeed);
      questionCount++;

      await page.waitForTimeout(800);

      // ── Capture options AFTER answering ───────────────────────────────────
      const pageOptionsAfter = await capturePageOptions(page);

      // ── Screenshot AFTER answering ────────────────────────────────────────
      const screenshotFilename = `page_${pageCount}.png`;
      const screenshotPath = path.join(
        sessionScreenshotsDir,
        screenshotFilename,
      );
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Worker] Screenshot saved: ${screenshotPath}`);
      } catch (e) {
        console.warn(`[Worker] Screenshot failed: ${e.message}`);
      }

      const pageTime = Math.round((Date.now() - pageStart) / 1000);
      const answerSummary = buildAnswerSummary(pageOptionsAfter, answersGiven);

      pages.push({
        pageNum: pageCount,
        url: currentUrl,
        title: pageTitle,
        questions: questionsOnPage,
        options: pageOptionsAfter,
        answers: answersGiven,
        answerSummary,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
      });

      await logSessionEvent(sessionId, "page_answered", {
        page: pageCount,
        url: currentUrl,
        title: pageTitle,
        questions: questionsOnPage,
        options: pageOptionsAfter,
        answers: answersGiven,
        answerSummary,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
      });

      // ── Click next ────────────────────────────────────────────────────────
      const clicked = await clickNext(page);
      if (!clicked) {
        console.log(`[Worker] No next button on page ${pageCount}`);
        // Check page content before defaulting to completed
        const noNextOutcome = await detectOutcomeFromPage(page);
        outcome = noNextOutcome || detectOutcome(page.url()) || "completed";
        console.log(`[Worker] No next button — outcome: ${outcome}`);
        break;
      }

      try {
        await page.waitForNavigation({
          timeout: 15000,
          waitUntil: "domcontentloaded",
        });
      } catch {
        await page.waitForTimeout(3000);
      }

      const newUrl = page.url();

      // Check URL for outcome
      outcome = detectOutcome(newUrl);

      // If URL doesn't reveal outcome, scan page text (Decipher exit pages)
      if (!outcome) {
        await page.waitForTimeout(1500); // let page fully render
        outcome = await detectOutcomeFromPage(page);
        if (outcome) {
          console.log(
            `[Worker] Outcome from page content after nav: ${outcome}`,
          );
        }
      }

      if (outcome) {
        const finalPath = path.join(
          sessionScreenshotsDir,
          `page_${pageCount + 1}_final.png`,
        );
        try {
          await page.screenshot({ path: finalPath, fullPage: true });
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
    errorMessage = err?.stack || err?.message || String(err);
    await logSessionEvent(sessionId, "error", {
      message: err?.message,
      stack: err?.stack,
    });
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
    ...(errorMessage ? { errorLog: errorMessage.slice(0, 2000) } : {}),
  });

  await logSessionEvent(sessionId, "session_complete", {
    outcome,
    durationS,
    pageCount,
    questionCount,
    responseId,
    screenshotsCount: pages.length,
  });

  console.log(
    `[Worker] Session ${sessionId} → ${outcome} | ${durationS}s | ${pageCount} pages`,
  );
  return { sessionId, outcome, durationS, responseId };
};

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker("survey-sessions", processSession, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on("completed", (job, result) =>
  console.log(`[Worker] Job ${job.id} done — ${result.outcome}`),
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
