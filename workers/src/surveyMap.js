'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// SURVEY MAP — Pre-reads the survey structure before any session starts.
// Stores page count, question types, screener pages, and routing hints.
// Sessions use this map for context-aware answering across all pages.
// ══════════════════════════════════════════════════════════════════════════════

const { pool } = require('../../backend/src/db/index');

// ── Platform detection from DOM ───────────────────────────────────────────────
const detectPlatform = async (page) => {
  return await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    if (/focusvision|decipher|selfserve/i.test(window.location.href)) return 'decipher';
    if (/qualtrics\.com/i.test(window.location.href)) return 'qualtrics';
    if (/surveymonkey\.com/i.test(window.location.href)) return 'surveymonkey';
    if (/alchemer\.com|surveygizmo\.com/i.test(window.location.href)) return 'alchemer';
    if (/confirmit\.com/i.test(window.location.href)) return 'confirmit';
    if (document.querySelector('.qblock, .qtext')) return 'decipher';
    if (document.querySelector('.QuestionBody, .SurveyEngineBody')) return 'qualtrics';
    if (document.querySelector('.smcx-widget, .survey-page')) return 'surveymonkey';
    return 'unknown';
  }).catch(() => 'unknown');
};

// ── Extract question map from a single page ───────────────────────────────────
const extractPageQuestionMap = async (page, pageNum) => {
  return await page.evaluate((pNum) => {
    const questions = [];
    // Decipher question blocks
    document.querySelectorAll('.qblock, .question, [class*="qblock"]').forEach((block, i) => {
      const qt = block.querySelector('.qtext, .question-text, legend, h2, h3');
      const questionText = (qt?.innerText || '').trim().slice(0, 200);
      if (!questionText) return;

      // Detect question type
      const hasRadio = block.querySelectorAll('input[type="radio"]').length > 0;
      const hasCheckbox = block.querySelectorAll('input[type="checkbox"]').length > 0;
      const hasTextarea = block.querySelectorAll('textarea').length > 0;
      const hasSelect = block.querySelectorAll('select').length > 0;
      const hasInput = block.querySelectorAll('input[type="text"], input[type="number"]').length > 0;
      const radioGroups = new Set(Array.from(block.querySelectorAll('input[type="radio"]')).map(r => r.name));
      const isGrid = radioGroups.size > 2;

      let type = 'unknown';
      if (isGrid) type = 'grid';
      else if (hasRadio) type = 'radio';
      else if (hasCheckbox) type = 'checkbox';
      else if (hasTextarea) type = 'open-end';
      else if (hasSelect) type = 'select';
      else if (hasInput) type = 'numeric';

      // Detect screener signals
      const isScreener = /qualify|eligible|work|employed|job|industry|company|role|title|department|country|age|gender/i.test(questionText);

      questions.push({
        pageNum: pNum,
        questionIndex: i,
        text: questionText,
        type,
        isScreener,
        optionCount: hasRadio
          ? block.querySelectorAll('input[type="radio"]').length
          : hasCheckbox
            ? block.querySelectorAll('input[type="checkbox"]').length
            : 0,
      });
    });
    return questions;
  }, pageNum).catch(() => []);
};

// ── Check if existing map is fresh enough ─────────────────────────────────────
const getSurveyMap = async (projectId, surveyUrl) => {
  try {
    const r = await pool.query(
      `SELECT * FROM survey_maps
       WHERE project_id = $1 AND survey_url = $2
       AND mapped_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [projectId, surveyUrl]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
};

// ── Full survey pre-read ───────────────────────────────────────────────────────
const buildSurveyMap = async (surveyUrl, projectId, browser, providerConfig) => {
  let mapPage = null;
  const questionMap = [];
  let pageCount = 0;
  let platform = 'unknown';
  const screenerPages = [];

  try {
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    mapPage = await ctx.newPage();

    console.log('[SurveyMap] Pre-reading survey structure...');
    await mapPage.goto(surveyUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await mapPage.waitForTimeout(2000);

    platform = await detectPlatform(mapPage);
    console.log(`[SurveyMap] Platform detected: ${platform}`);

    // Navigate through survey WITHOUT answering — just click Next to map structure
    const MAX_MAP_PAGES = 80;
    while (pageCount < MAX_MAP_PAGES) {
      pageCount++;
      await mapPage.waitForTimeout(800);

      const pageQuestions = await extractPageQuestionMap(mapPage, pageCount);
      if (pageQuestions.length > 0) {
        questionMap.push(...pageQuestions);
        if (pageQuestions.some(q => q.isScreener)) {
          screenerPages.push(pageCount);
        }
      }

      // Try to advance — on a real survey this will terminate quickly since
      // we haven't answered screeners, but we get structure before that
      const nextBtn = await mapPage.locator(
        'input[type="button"][value*="Next"], button:has-text("Next"), .next-button, input[value="Next"]'
      ).first();

      if (!await nextBtn.isVisible().catch(() => false)) break;

      const urlBefore = mapPage.url();
      await nextBtn.click().catch(() => {});
      await mapPage.waitForTimeout(1500);

      const urlAfter = mapPage.url();
      // Survey terminated (screened out without answering) — we have enough structure
      if (urlAfter === urlBefore) break;
      if (/terminate|screenout|overquota|complete/i.test(urlAfter)) break;
    }

    await ctx.close().catch(() => {});

    // Build routing hints from question map
    const routingHints = {
      hasGridQuestions: questionMap.some(q => q.type === 'grid'),
      hasOpenEnds: questionMap.some(q => q.type === 'open-end'),
      hasNumericInputs: questionMap.some(q => q.type === 'numeric'),
      screenerPageCount: screenerPages.length,
      estimatedLOI: Math.round(pageCount * 0.8), // rough estimate in pages
      questionTypes: [...new Set(questionMap.map(q => q.type))],
    };

    // Store in DB
    await pool.query(
      `INSERT INTO survey_maps (project_id, survey_url, platform, page_count, screener_pages, question_map, routing_hints)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, survey_url)
       DO UPDATE SET platform=$3, page_count=$4, screener_pages=$5, question_map=$6, routing_hints=$7, mapped_at=NOW()`,
      [projectId, surveyUrl, platform, pageCount, JSON.stringify(screenerPages),
       JSON.stringify(questionMap), JSON.stringify(routingHints)]
    ).catch(e => console.warn('[SurveyMap] DB write failed:', e.message));

    console.log(`[SurveyMap] ✓ Mapped ${pageCount} pages, ${questionMap.length} questions, platform: ${platform}`);

    return { platform, pageCount, screenerPages, questionMap, routingHints };

  } catch (e) {
    console.warn('[SurveyMap] Build failed:', e.message);
    await mapPage?.close().catch(() => {});
    return null;
  }
};

module.exports = { buildSurveyMap, getSurveyMap, detectPlatform };