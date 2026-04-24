'use strict';

// ─── Decipher Survey Engine ───────────────────────────────────────────────────
// Handles navigation, question detection, and answering for Decipher surveys

const DECIPHER_SELECTORS = {
  // Question containers
  question:     '.sv-question, .sv_question, [class*="question"]',
  // Answer types
  radio:        'input[type="radio"]',
  checkbox:     'input[type="checkbox"]',
  select:       'select',
  textarea:     'textarea',
  textInput:    'input[type="text"], input[type="number"]',
  // Navigation
  nextBtn:      'input[type="submit"], button[type="submit"], .sv-btn, #next, .next-btn, [value="Next"], [value="Continue"]',
  // Outcome detection
  completeUrl:  ['thankyou', 'complete', 'thank-you', 'finished', 'done'],
  terminateUrl: ['terminate', 'terminated', 'screenout', 'screen-out', 'disqualified', 'dq'],
  quotaUrl:     ['quota', 'over-quota', 'overquota', 'quotafull', 'quota-full'],
};

// ─── Detect page outcome from URL ─────────────────────────────────────────────
const detectOutcome = (url) => {
  const lower = url.toLowerCase();
  if (DECIPHER_SELECTORS.completeUrl.some(k  => lower.includes(k))) return 'completed';
  if (DECIPHER_SELECTORS.terminateUrl.some(k => lower.includes(k))) return 'terminated';
  if (DECIPHER_SELECTORS.quotaUrl.some(k     => lower.includes(k))) return 'over_quota';
  return null;
};

// ─── Human reading delay ──────────────────────────────────────────────────────
const readingDelay = async (page, speed = 'normal') => {
  const delays = {
    slow:   { min: 3000, max: 8000 },
    normal: { min: 1500, max: 4000 },
    fast:   { min: 500,  max: 2000 },
  };
  const { min, max } = delays[speed] || delays.normal;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await page.waitForTimeout(ms);
};

// ─── Simulate human typing ────────────────────────────────────────────────────
const humanType = async (element, text) => {
  for (const char of text) {
    await element.type(char, { delay: Math.floor(Math.random() * 80) + 40 });
  }
};

// ─── Answer a single radio group ─────────────────────────────────────────────
const answerRadio = async (page, persona) => {
  const radios = await page.$$(DECIPHER_SELECTORS.radio);
  if (radios.length === 0) return false;

  // Group by name
  const groups = {};
  for (const radio of radios) {
    const name = await radio.getAttribute('name');
    if (!groups[name]) groups[name] = [];
    groups[name].push(radio);
  }

  for (const [name, options] of Object.entries(groups)) {
    // Pick a random option (weighted toward middle options — avoid extremes)
    const style = persona?.behavioural_attrs?.responseStyle || 'neutral';
    let idx;
    if (style === 'conservative') {
      // Tends toward middle-to-positive
      idx = Math.floor(options.length * 0.3 + Math.random() * options.length * 0.4);
    } else if (style === 'expressive') {
      // More varied
      idx = Math.floor(Math.random() * options.length);
    } else {
      // Neutral — avoid extreme ends
      const start = Math.max(0, Math.floor(options.length * 0.2));
      const end   = Math.min(options.length - 1, Math.floor(options.length * 0.8));
      idx = start + Math.floor(Math.random() * (end - start + 1));
    }
    idx = Math.max(0, Math.min(idx, options.length - 1));
    await options[idx].click();
    await page.waitForTimeout(Math.floor(Math.random() * 500) + 200);
  }
  return true;
};

// ─── Answer checkboxes ────────────────────────────────────────────────────────
const answerCheckbox = async (page) => {
  const boxes = await page.$$(DECIPHER_SELECTORS.checkbox);
  if (boxes.length === 0) return false;

  // Select 1 to 3 random checkboxes
  const count = Math.min(boxes.length, Math.floor(Math.random() * 3) + 1);
  const shuffled = [...boxes].sort(() => Math.random() - 0.5).slice(0, count);
  for (const box of shuffled) {
    await box.click();
    await page.waitForTimeout(Math.floor(Math.random() * 300) + 100);
  }
  return true;
};

// ─── Answer select dropdowns ──────────────────────────────────────────────────
const answerSelect = async (page) => {
  const selects = await page.$$(DECIPHER_SELECTORS.select);
  if (selects.length === 0) return false;

  for (const select of selects) {
    const options = await select.$$('option');
    const validOptions = options.slice(1); // skip first (usually placeholder)
    if (validOptions.length === 0) continue;
    const idx = Math.floor(Math.random() * validOptions.length);
    const value = await validOptions[idx].getAttribute('value');
    if (value) await select.selectOption(value);
    await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);
  }
  return true;
};

// ─── Answer open-ended text ───────────────────────────────────────────────────
const answerOpenEnd = async (page, persona, questionText = '') => {
  const textareas = await page.$$(DECIPHER_SELECTORS.textarea);
  const textInputs = await page.$$(DECIPHER_SELECTORS.textInput);
  const fields = [...textareas, ...textInputs];
  if (fields.length === 0) return false;

  // Generate a basic open-end response based on persona description
  // Phase 2.7 will replace this with actual Claude API calls
  const description = persona?.behavioural_attrs?.secondaryDescription || ''
  const style = persona?.behavioural_attrs?.responseStyle || 'neutral'

  const responses = {
    conservative: [
      'It meets my expectations.',
      'Generally satisfactory.',
      'No strong opinion either way.',
      'It does what it is supposed to do.',
      'Fairly standard in my experience.',
    ],
    neutral: [
      'It works well for my needs.',
      'I find it fairly useful.',
      'Has both strengths and areas for improvement.',
      'Overall a decent experience.',
      'Meets most of my requirements.',
    ],
    expressive: [
      'I really appreciate how intuitive and user-friendly this is — it saves me a lot of time.',
      'There are some areas that could be improved but overall it is a great product.',
      'I have been using this for a while and find it consistently delivers on its promises.',
      'Very impressed with the quality and attention to detail.',
      'Could be better in some areas but the core functionality is excellent.',
    ],
  }

  const pool = responses[style] || responses.neutral
  const response = pool[Math.floor(Math.random() * pool.length)]

  for (const field of fields) {
    await field.click()
    await humanType(field, response)
    await page.waitForTimeout(Math.floor(Math.random() * 600) + 300)
  }
  return true
}

// ─── Answer all questions on current page ─────────────────────────────────────
const answerPage = async (page, persona, readingSpeed = 'normal') => {
  // Wait for page to settle
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

  // Human reading delay
  await readingDelay(page, readingSpeed)

  // Answer in order: radio → checkbox → select → text
  await answerRadio(page, persona)
  await answerCheckbox(page)
  await answerSelect(page)
  await answerOpenEnd(page, persona)

  // Small pause before clicking next
  await page.waitForTimeout(Math.floor(Math.random() * 1000) + 500)
}

// ─── Click the Next button ────────────────────────────────────────────────────
const clickNext = async (page) => {
  const btn = await page.$(DECIPHER_SELECTORS.nextBtn)
  if (!btn) return false
  await btn.click()
  return true
}

module.exports = {
  detectOutcome, answerPage, clickNext,
  DECIPHER_SELECTORS,
}