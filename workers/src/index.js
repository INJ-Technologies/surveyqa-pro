'use strict';
const { Worker } = require('bullmq');
const { chromium }  = require('playwright');
const path = require('path');
const fs   = require('fs');

const { connection }        = require('../../backend/src/queues/index');
const { updateSessionStatus, logSessionEvent, recordUsedIP, saveTracePath } = require('../../backend/src/db/sessions');
const { getProxyForSession } = require('../../backend/src/services/proxyService');
const { detectOutcome, answerPage, clickNext } = require('../../backend/src/services/decipherEngine');
const { pool }              = require('../../backend/src/db/index');

const CONCURRENCY  = parseInt(process.env.WORKER_CONCURRENCY) || 5;
const MAX_PAGES    = 50;
const TRACES_DIR   = process.env.TRACES_DIR || '/app/traces';
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/app/recordings';

// Ensure directories exist
[TRACES_DIR, RECORDINGS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

console.log(`[Worker] Starting — concurrency: ${CONCURRENCY}`);
console.log(`[Worker] Traces dir: ${TRACES_DIR}`);

// ─── Load persona from DB ─────────────────────────────────────────────────────
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
    proxyProvider, proxyCountry, deviceType, aiStrategy,
  } = job.data;

  console.log(`[Worker] Session ${sessionId} | ResponseID: ${responseId} | URL: ${surveyUrl}`);

  await updateSessionStatus(sessionId, 'initialising');
  await logSessionEvent(sessionId, 'worker_started', { jobId: job.id, responseId });

  // ── Load persona ──────────────────────────────────────────────────────────
  const persona      = await getPersona(personaId);
  const readingSpeed = persona?.behavioural_attrs?.readingSpeed  || 'normal';
  const deviceOs     = persona?.behavioural_attrs?.deviceOs      || 'windows';

  // ── Viewport per device ───────────────────────────────────────────────────
  const viewports = {
    desktop: { width: 1366, height: 768  },
    mobile:  { width: 390,  height: 844  },
    tablet:  { width: 820,  height: 1180 },
  };
  const viewport = viewports[deviceType] || viewports.desktop;

  // ── User agent ────────────────────────────────────────────────────────────
  const userAgents = {
    'desktop-windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'desktop-macos':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'mobile-android':  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'mobile-ios':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
  const uaKey    = `${deviceType}-${deviceOs.toLowerCase()}`;
  const userAgent = userAgents[uaKey] || userAgents['desktop-windows'];

  // ── Proxy config with unique session ID for IP uniqueness ─────────────────
  const proxySessionId = sessionId.slice(0, 8);
  const proxy = getProxyForSession(proxyProvider, proxyCountry, proxySessionId);

  // ── Launch options ────────────────────────────────────────────────────────
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  };
  if (proxy) launchOptions.proxy = proxy;

  let browser, context, page;
  let outcome       = null;
  let pageCount     = 0;
  let questionCount = 0;
  const startTime   = Date.now();
  const tracePath   = path.join(TRACES_DIR, `${sessionId}.zip`);

  try {
    browser = await chromium.launch(launchOptions);

    context = await browser.newContext({
      viewport,
      userAgent,
      locale:     'en-US',
      timezoneId: 'Asia/Kolkata',
    });

    // ── Stealth: remove webdriver flag ────────────────────────────────────
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // ── Start Playwright trace ────────────────────────────────────────────
    await context.tracing.start({
      screenshots: true,   // screenshot on every action
      snapshots:   true,   // DOM snapshots for timeline
      sources:     false,  // skip source files (reduces size)
      title:       `Session ${sessionId} | ${responseId}`,
    });

    page = await context.newPage();

    // ── Get assigned IP ───────────────────────────────────────────────────
    try {
      const ipRes  = await page.goto('https://api.ipify.org?format=json', { timeout: 12000 });
      const ipData = await ipRes.json();
      if (ipData?.ip) {
        await recordUsedIP(projectId, sessionId, ipData.ip);
        await logSessionEvent(sessionId, 'ip_assigned', { ip: ipData.ip, country: proxyCountry });
        console.log(`[Worker] Session ${sessionId} IP: ${ipData.ip}`);
      }
    } catch (e) {
      await logSessionEvent(sessionId, 'ip_check_failed', { error: e.message });
      console.warn(`[Worker] IP check failed for ${sessionId}: ${e.message}`);
    }

    // ── Mark in_progress ──────────────────────────────────────────────────
    await updateSessionStatus(sessionId, 'in_progress');
    await logSessionEvent(sessionId, 'browser_launched', {
      proxy: proxy ? 'decodo' : 'direct',
      responseId,
      surveyUrl,
    });

    // ── Navigate to survey ────────────────────────────────────────────────
    await page.goto(surveyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await logSessionEvent(sessionId, 'survey_loaded', { url: surveyUrl, responseId });

    // ── Main survey loop ──────────────────────────────────────────────────
    while (pageCount < MAX_PAGES) {
      pageCount++;
      const currentUrl = page.url();

      // Check for redirect outcome
      outcome = detectOutcome(currentUrl);
      if (outcome) {
        await logSessionEvent(sessionId, 'redirect_detected', { url: currentUrl, outcome });
        break;
      }

      // Answer all questions on current page
      await answerPage(page, persona, readingSpeed);
      questionCount++;
      await logSessionEvent(sessionId, 'page_answered', { page: pageCount, url: currentUrl });

      // Click next button
      const clicked = await clickNext(page);
      if (!clicked) {
        outcome = detectOutcome(page.url()) || 'completed';
        break;
      }

      // Wait for navigation
      try {
        await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' });
      } catch {
        await page.waitForTimeout(2000);
      }

      // Re-check URL after navigation
      const newUrl = page.url();
      outcome = detectOutcome(newUrl);
      if (outcome) {
        await logSessionEvent(sessionId, 'redirect_detected', { url: newUrl, outcome });
        break;
      }
    }

    if (!outcome) outcome = pageCount >= MAX_PAGES ? 'error' : 'completed';

  } catch (err) {
    outcome = 'error';
    await logSessionEvent(sessionId, 'error', { message: err.message });
    console.error(`[Worker] Session ${sessionId} error:`, err.message);
  } finally {

    // ── Stop trace and save ───────────────────────────────────────────────
    try {
      if (context) {
        await context.tracing.stop({ path: tracePath });
        await saveTracePath(sessionId, tracePath);
        console.log(`[Worker] Trace saved: ${tracePath}`);
      }
    } catch (e) {
      console.warn(`[Worker] Trace save failed for ${sessionId}:`, e.message);
    }

    try { await browser?.close(); } catch {}
  }

  // ── Final status update ───────────────────────────────────────────────────
  const durationS = Math.round((Date.now() - startTime) / 1000);
  await updateSessionStatus(sessionId, outcome, {
    outcome,
    totalDurationS: durationS,
    questionCount,
    redirectType:   outcome,
  });

  await logSessionEvent(sessionId, 'session_complete', {
    outcome, durationS, pageCount, questionCount, responseId,
    tracePath: fs.existsSync(tracePath) ? tracePath : null,
  });

  console.log(`[Worker] Session ${sessionId} → ${outcome} (${durationS}s, ${pageCount} pages, responseId: ${responseId})`);
  return { sessionId, outcome, durationS, responseId };
};

// ─── Worker instance ──────────────────────────────────────────────────────────
const worker = new Worker('survey-sessions', processSession, {
  connection,
  concurrency: CONCURRENCY,
});

worker.on('completed', (job, result) => {
  console.log(`[Worker] Job ${job.id} completed — ${result.outcome} | ${result.responseId}`);
});

worker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[Worker] Worker error:', err);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received — shutting down gracefully');
  await worker.close();
  process.exit(0);
});

console.log('[Worker] Ready and listening for jobs...');