'use strict';

// ─── Decipher / FocusVision Survey Engine ────────────────────────────────────
// Tuned for emea.focusvision.com and standard Decipher surveys

// ─── Outcome detection from URL ───────────────────────────────────────────────
const COMPLETE_URLS  = ['thankyou', 'complete', 'thank-you', 'finished', 'done', 'survey-closed'];
const TERMINATE_URLS = ['terminate', 'terminated', 'screenout', 'screen-out', 'disqualified', 'dq', 'noteligible'];
const QUOTA_URLS     = ['quota', 'over-quota', 'overquota', 'quotafull', 'quota-full', 'full'];

const detectOutcome = (url) => {
  const lower = url.toLowerCase();
  if (COMPLETE_URLS.some(k  => lower.includes(k))) return 'completed';
  if (TERMINATE_URLS.some(k => lower.includes(k))) return 'terminated';
  if (QUOTA_URLS.some(k     => lower.includes(k))) return 'over_quota';
  return null;
};

// ─── Reading delay ────────────────────────────────────────────────────────────
const readingDelay = async (page, speed = 'normal') => {
  const delays = {
    slow:   { min: 3000, max: 7000 },
    normal: { min: 1500, max: 4000 },
    fast:   { min: 600,  max: 2000 },
  };
  const { min, max } = delays[speed] || delays.normal;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await page.waitForTimeout(ms);
};

// ─── Human-like typing ────────────────────────────────────────────────────────
const humanType = async (page, element, text) => {
  await element.click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
  // Clear existing content first
  await element.fill('').catch(() => {});
  for (const char of text) {
    await element.type(char, { delay: Math.floor(Math.random() * 80) + 30 });
  }
};

// ─── Safe click ───────────────────────────────────────────────────────────────
const safeClick = async (el) => {
  try {
    await el.scrollIntoViewIfNeeded();
    await el.click({ force: true });
  } catch {
    try { await el.evaluate(n => n.click()); } catch {}
  }
};

// ─── Answer radio questions ───────────────────────────────────────────────────
const answerRadio = async (page, persona) => {
  // Decipher-specific radio selectors
  const radioSelectors = [
    'input[type="radio"]:not([disabled])',
  ];

  let allRadios = [];
  for (const sel of radioSelectors) {
    const found = await page.$$(sel);
    if (found.length > 0) { allRadios = found; break; }
  }

  if (allRadios.length === 0) return false;

  // Group by name attribute
  const groups = {};
  for (const radio of allRadios) {
    try {
      const name  = await radio.getAttribute('name');
      const value = await radio.getAttribute('value');
      // Skip "other" type inputs and hidden values
      if (!name || value === '' || value === null) continue;
      if (!groups[name]) groups[name] = [];
      groups[name].push(radio);
    } catch {}
  }

  const groupNames = Object.keys(groups);
  if (groupNames.length === 0) return false;

  const style = persona?.behavioural_attrs?.responseStyle || 'neutral';

  for (const name of groupNames) {
    const options = groups[name];
    if (options.length === 0) continue;

    let idx;
    if (style === 'conservative') {
      // Middle-to-positive (for scales: avoid extremes)
      idx = Math.floor(options.length * 0.25 + Math.random() * options.length * 0.5);
    } else if (style === 'expressive') {
      idx = Math.floor(Math.random() * options.length);
    } else {
      // Neutral — slightly toward positive end but avoid extremes
      const start = Math.max(0, Math.floor(options.length * 0.2));
      const end   = Math.min(options.length - 1, Math.floor(options.length * 0.75));
      idx = start + Math.floor(Math.random() * (end - start + 1));
    }
    idx = Math.max(0, Math.min(idx, options.length - 1));

    try {
      await safeClick(options[idx]);
      await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);
    } catch {}
  }
  return true;
};

// ─── Answer checkbox questions ────────────────────────────────────────────────
const answerCheckbox = async (page) => {
  const boxes = await page.$$('input[type="checkbox"]:not([disabled])');
  if (boxes.length === 0) return false;

  // For "select all that apply" — pick 1 to 3
  const count    = Math.min(boxes.length, Math.floor(Math.random() * 3) + 1);
  const shuffled = [...boxes].sort(() => Math.random() - 0.5).slice(0, count);

  for (const box of shuffled) {
    try {
      await safeClick(box);
      await page.waitForTimeout(Math.floor(Math.random() * 300) + 100);
    } catch {}
  }
  return true;
};

// ─── Answer select dropdowns ──────────────────────────────────────────────────
const answerSelect = async (page) => {
  const selects = await page.$$('select:not([disabled])');
  if (selects.length === 0) return false;

  for (const select of selects) {
    try {
      const options = await select.$$('option');
      // Skip first (usually blank placeholder) and last (sometimes "prefer not to say")
      const validOptions = options.slice(1, -1);
      if (validOptions.length === 0) continue;
      const idx   = Math.floor(Math.random() * validOptions.length);
      const value = await validOptions[idx].getAttribute('value');
      if (value) {
        await select.selectOption(value);
        await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);
      }
    } catch {}
  }
  return true;
};

// ─── Answer open-ended text fields ────────────────────────────────────────────
const answerOpenEnd = async (page, persona) => {
  // Decipher open-ends: textareas and text inputs not used for hidden fields
  const textareas  = await page.$$('textarea:not([disabled]):not([readonly])');
  const textInputs = await page.$$('input[type="text"]:not([disabled]):not([readonly]):not([name*="hidden"])');

  const fields = [...textareas, ...textInputs];
  if (fields.length === 0) return false;

  const style = persona?.behavioural_attrs?.responseStyle || 'neutral';

  const responses = {
    conservative: [
      'It meets my expectations and does what I need.',
      'Generally satisfactory and reliable.',
      'No strong feelings either way — seems adequate.',
      'Works as expected without any major issues.',
      'Fairly standard experience overall.',
    ],
    neutral: [
      'It works well for my needs most of the time.',
      'I find it useful and relatively easy to use.',
      'Has both strengths and areas that could be improved.',
      'Overall a decent experience with room for improvement.',
      'Meets most of my requirements on a day to day basis.',
    ],
    expressive: [
      'I really appreciate how intuitive and user-friendly this is — it saves me considerable time and effort.',
      'While there are some areas that could be improved, overall this is a great product that delivers real value.',
      'I have been using this for a while now and it consistently delivers on its promises — very reliable.',
      'Very impressed with the overall quality and attention to detail — would definitely recommend.',
      'The core functionality is excellent and the interface is clean and easy to navigate.',
    ],
  };

  const pool     = responses[style] || responses.neutral;
  const response = pool[Math.floor(Math.random() * pool.length)];

  for (const field of fields) {
    try {
      // Skip very small fields (likely hidden or for numbers)
      const box = await field.boundingBox();
      if (box && box.width < 30) continue;

      await humanType(page, field, response);
      await page.waitForTimeout(Math.floor(Math.random() * 500) + 200);
    } catch {}
  }
  return true;
};

// ─── Handle numeric/number inputs ─────────────────────────────────────────────
const answerNumeric = async (page) => {
  const numInputs = await page.$$('input[type="number"]:not([disabled])');
  if (numInputs.length === 0) return false;

  for (const input of numInputs) {
    try {
      const min = parseFloat(await input.getAttribute('min') || '1');
      const max = parseFloat(await input.getAttribute('max') || '100');
      const val = Math.floor(min + Math.random() * (max - min));
      await input.fill(String(val));
      await page.waitForTimeout(200);
    } catch {}
  }
  return true;
};

// ─── Answer all questions on page ─────────────────────────────────────────────
const answerPage = async (page, persona, readingSpeed = 'normal') => {
  // Wait for network and DOM to settle
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Human reading delay
  await readingDelay(page, readingSpeed);

  const answers = [];

  // Answer in order most common on Decipher surveys
  const didRadio    = await answerRadio(page, persona);
  const didCheckbox = await answerCheckbox(page);
  const didSelect   = await answerSelect(page);
  const didNumeric  = await answerNumeric(page);
  const didOpenEnd  = await answerOpenEnd(page, persona);

  if (didRadio)    answers.push('radio');
  if (didCheckbox) answers.push('checkbox');
  if (didSelect)   answers.push('select');
  if (didNumeric)  answers.push('numeric');
  if (didOpenEnd)  answers.push('open-end');

  // Small pause before clicking next
  await page.waitForTimeout(Math.floor(Math.random() * 800) + 400);

  return answers;
};

// ─── Click Next/Submit button ─────────────────────────────────────────────────
const clickNext = async (page) => {
  // Decipher next button selectors — ordered by specificity
  const nextSelectors = [
    // Decipher-specific
    'input[type="submit"]',
    'button[type="submit"]',
    // Common labels
    'input[value="Next"]',
    'input[value="Continue"]',
    'input[value="Submit"]',
    'input[value="Next >>"]',
    'input[value=">> Next"]',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Submit")',
    // Generic fallbacks
    '#next',
    '.next-btn',
    '.btn-next',
    '[data-role="next"]',
  ];

  for (const sel of nextSelectors) {
    try {
      const btn = await page.$(sel);
      if (!btn) continue;

      const isVisible = await btn.isVisible().catch(() => false);
      const isEnabled = await btn.isEnabled().catch(() => false);
      if (!isVisible || !isEnabled) continue;

      await safeClick(btn);
      return true;
    } catch {}
  }
  return false;
};

module.exports = {
  detectOutcome,
  answerPage,
  clickNext,
  readingDelay,
};