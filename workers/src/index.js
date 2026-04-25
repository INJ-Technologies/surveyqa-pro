'use strict';
const { Worker } = require('bullmq');
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

const { connection }         = require('../../backend/src/queues/index');
const { updateSessionStatus, logSessionEvent, recordUsedIP, saveTracePath } = require('../../backend/src/db/sessions');
const { getProxyForSession } = require('../../backend/src/services/proxyService');
const { detectOutcome, answerPage, clickNext } = require('../../backend/src/services/decipherEngine');
const { pool }               = require('../../backend/src/db/index');

const CONCURRENCY     = parseInt(process.env.WORKER_CONCURRENCY) || 5;
const MAX_PAGES       = 50;
const TRACES_DIR      = process.env.TRACES_DIR      || '/app/traces';
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || '/app/screenshots';

[TRACES_DIR, SCREENSHOTS_DIR].forEach(dir => {
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
  } catch { return null; }
};

// ─── Main session processor ───────────────────────────────────────────────────
const processSession = async (job) => {
  const {
    sessionId, projectId, personaId,
    surveyUrl, responseId,
    proxyProvider, proxyCountry, deviceType,
  } = job.data;

  console.log(`[Worker] Session ${sessionId} | Country: ${proxyCountry} | ResponseID: ${responseId}`);

  await updateSessionStatus(sessionId, 'initialising');
  await logSessionEvent(sessionId, 'worker_started', { jobId: job.id, responseId });

  const persona      = await getPersona(personaId);
  const readingSpeed = persona?.behavioural_attrs?.readingSpeed || 'normal';
  const deviceOs     = persona?.behavioural_attrs?.deviceOs     || 'windows';

  const viewports = {
    desktop: { width: 1366, height: 768  },
    mobile:  { width: 390,  height: 844  },
    tablet:  { width: 820,  height: 1180 },
  };
  const viewport = viewports[deviceType] || viewports.desktop;

  const userAgents = {
    'desktop-windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'desktop-macos':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'mobile-android':  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'mobile-ios':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
  const uaKey    = `${deviceType || 'desktop'}-${deviceOs.toLowerCase()}`;
  const userAgent = userAgents[uaKey] || userAgents['desktop-windows'];

  // ── PROXY — using new signature ────────────────────────────────────────────
  const proxySessionId = sessionId.slice(0, 8);
  const proxy = getProxyForSession(proxyProvider || 'decodo', {
    country:         proxyCountry || null,
    sessionId:       proxySessionId,
    sessionDuration: 60,
  });

  console.log(`[Worker] Proxy: ${proxy ? `${proxy.server} | user: ${proxy.username}` : 'DIRECT (no proxy)'}`);

  const launchOptions = {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    }),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--allow-running-insecure-content',
    ],
  };
  if (proxy) launchOptions.proxy = proxy;

  const sessionScreenshotsDir = path.join(SCREENSHOTS_DIR, sessionId);
  fs.mkdirSync(sessionScreenshotsDir, { recursive: true });

  let browser, context, page;
  let outcome       = null;
  let errorMessage  = null;
  let pageCount     = 0;
  let questionCount = 0;
  const startTime   = Date.now();
  const tracePath   = path.join(TRACES_DIR, `${sessionId}.zip`);
  const pages       = [];

  try {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      viewport, userAgent,
      locale: 'en-US', timezoneId: 'Asia/Kolkata',
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await context.tracing.start({ screenshots: true, snapshots: true, title: `Session ${sessionId}` });

    page = await context.newPage();

    // ── Check IP assigned ────────────────────────────────────────────────────
    try {
      const ipRes  = await page.goto('https://api.ipify.org?format=json', { timeout: 12000 });
      const ipData = await ipRes.json();
      if (ipData?.ip) {
        await recordUsedIP(projectId, sessionId, ipData.ip);
        await logSessionEvent(sessionId, 'ip_assigned', { ip: ipData.ip, country: proxyCountry });
        console.log(`[Worker] Session ${sessionId} IP: ${ipData.ip} (requested: ${proxyCountry})`);
      }
    } catch (e) {
      console.warn(`[Worker] IP check failed: ${e.message}`);
      await logSessionEvent(sessionId, 'ip_check_failed', { error: e.message });
    }

    await updateSessionStatus(sessionId, 'in_progress');
    await logSessionEvent(sessionId, 'browser_launched', {
      proxy:     proxy ? `decodo-${proxyCountry}` : 'direct',
      userAgent, responseId, surveyUrl,
    });

    // ── Navigate to survey ───────────────────────────────────────────────────
    console.log(`[Worker] Navigating to: ${surveyUrl}`);
    await page.goto(surveyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await logSessionEvent(sessionId, 'survey_loaded', { url: surveyUrl, responseId });

    // ── Main survey loop ─────────────────────────────────────────────────────
    while (pageCount < MAX_PAGES) {
      pageCount++;
      const currentUrl = page.url();
      const pageStart  = Date.now();

      console.log(`[Worker] Page ${pageCount}: ${currentUrl}`);

      // Check for redirect/completion
      outcome = detectOutcome(currentUrl);
      if (outcome) {
        await logSessionEvent(sessionId, 'redirect_detected', { url: currentUrl, outcome });
        break;
      }

      // Screenshot BEFORE answering
      const screenshotFilename = `page_${pageCount}.png`;
      const screenshotPath     = path.join(sessionScreenshotsDir, screenshotFilename);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Worker] Screenshot saved: ${screenshotPath}`);
      } catch (e) {
        console.warn(`[Worker] Screenshot failed: ${e.message}`);
      }

      // Extract page title + questions
      let pageTitle      = '';
      let questionsOnPage = [];
      try {
        pageTitle = await page.title();
        questionsOnPage = await page.evaluate(() => {
          const selectors = [
            // Decipher-specific
            '.qtext', '.question-text', '.qtitle',
            // Generic fallbacks
            'legend', 'label.question', 'h2', 'h3', 'h4',
            '[class*="question"] .text',
            '[class*="qtext"]',
          ];
          const found = new Set();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => {
              const text = (el.innerText || el.textContent || '').trim();
              if (text && text.length > 5 && text.length < 400) found.add(text);
            });
            if (found.size >= 5) break;
          }
          return [...found].slice(0, 5);
        });
      } catch {}

      // Answer questions
      const answersGiven = await answerPage(page, persona, readingSpeed);
      questionCount++;

      const pageTime = Math.round((Date.now() - pageStart) / 1000);

      pages.push({
        pageNum: pageCount, url: currentUrl, title: pageTitle,
        questions: questionsOnPage, answers: answersGiven,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
      });

      await logSessionEvent(sessionId, 'page_answered', {
        page: pageCount, url: currentUrl, title: pageTitle,
        questions: questionsOnPage, answers: answersGiven,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
      });

      // Click next
      const clicked = await clickNext(page);
      if (!clicked) {
        console.log(`[Worker] No next button found on page ${pageCount}`);
        outcome = detectOutcome(page.url()) || 'completed';
        break;
      }

      // Wait for navigation
      try {
        await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' });
      } catch {
        await page.waitForTimeout(3000);
      }

      const newUrl = page.url();
      outcome = detectOutcome(newUrl);
      if (outcome) {
        // Screenshot the final page
        const finalPath = path.join(sessionScreenshotsDir, `page_${pageCount + 1}_final.png`);
        try { await page.screenshot({ path: finalPath, fullPage: true }); } catch {}
        await logSessionEvent(sessionId, 'redirect_detected', {
          url: newUrl, outcome,
          screenshot: `${sessionId}/page_${pageCount + 1}_final.png`,
        });
        break;
      }
    }

    if (!outcome) outcome = pageCount >= MAX_PAGES ? 'error' : 'completed';

  } catch (err) {
    outcome      = 'error';
    errorMessage = err?.stack || err?.message || String(err);
    await logSessionEvent(sessionId, 'error', { message: err?.message, stack: err?.stack });
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
    outcome, totalDurationS: durationS, questionCount, redirectType: outcome,
    ...(errorMessage ? { errorLog: errorMessage.slice(0, 2000) } : {}),
  });

  await logSessionEvent(sessionId, 'session_complete', {
    outcome, durationS, pageCount, questionCount, responseId,
    screenshotsCount: pages.length,
  });

  console.log(`[Worker] Session ${sessionId} → ${outcome} | ${durationS}s | ${pageCount} pages | ${pages.length} screenshots`);
  return { sessionId, outcome, durationS, responseId };
};

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker('survey-sessions', processSession, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on('completed', (job, result) => console.log(`[Worker] Job ${job.id} done — ${result.outcome}`));
worker.on('failed',    (job, err)    => console.error(`[Worker] Job ${job.id} failed:`, err.message));
worker.on('error',     (err)         => console.error('[Worker] Error:', err));

process.on('SIGTERM', async () => { await worker.close(); process.exit(0); });

console.log('[Worker] Ready and listening for jobs...');