'use strict';

// ─── Decipher / FocusVision Survey Engine ────────────────────────────────────

const COMPLETE_URLS  = ['thankyou', 'complete', 'thank-you', 'finished', 'done', 'survey-closed'];
const TERMINATE_URLS = ['terminate', 'terminated', 'screenout', 'screen-out', 'disqualified', 'dq', 'noteligible'];
const QUOTA_URLS     = ['quota', 'over-quota', 'overquota', 'quotafull', 'quota-full', 'full'];

// ─── Hint text patterns to exclude from question detection ───────────────────
const HINT_PATTERNS = [
  /^please select/i, /^select all/i, /^choose all/i,
  /^select one/i,    /^choose one/i, /^check all/i,
  /^required/i,      /^optional/i,   /^\*/,
  /^e\.g\./i,        /^example/i,    /^hint/i,
  /^note:/i,         /^tip:/i,
];

const isHintText = (text) =>
  !text ||
  text.length < 4 ||
  text.length > 350 ||
  HINT_PATTERNS.some(p => p.test(text.trim()));

// ─── Outcome detection ────────────────────────────────────────────────────────
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
  await page.waitForTimeout(Math.floor(Math.random() * (max - min + 1)) + min);
};

// ─── Human-like typing ────────────────────────────────────────────────────────
const humanType = async (page, element, text) => {
  await element.click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
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

// ─── Answer radio questions — returns structured answer ───────────────────────
const answerRadio = async (page, persona) => {
  const allRadios = await page.$$('input[type="radio"]:not([disabled])');
  if (allRadios.length === 0) return null;

  const groups = {};
  for (const radio of allRadios) {
    try {
      const name  = await radio.getAttribute('name');
      const value = await radio.getAttribute('value');
      if (!name || value === '' || value === null) continue;
      if (!groups[name]) groups[name] = [];
      groups[name].push(radio);
    } catch {}
  }

  const groupNames = Object.keys(groups);
  if (groupNames.length === 0) return null;

  const style = persona?.behavioural_attrs?.responseStyle || 'neutral';
  const selectedAnswers = [];

  for (const name of groupNames) {
    const options = groups[name];
    if (options.length === 0) continue;

    let idx;
    if (style === 'conservative') {
      idx = Math.floor(options.length * 0.25 + Math.random() * options.length * 0.5);
    } else if (style === 'expressive') {
      idx = Math.floor(Math.random() * options.length);
    } else {
      const start = Math.max(0, Math.floor(options.length * 0.2));
      const end   = Math.min(options.length - 1, Math.floor(options.length * 0.75));
      idx = start + Math.floor(Math.random() * (end - start + 1));
    }
    idx = Math.max(0, Math.min(idx, options.length - 1));

    try {
      await safeClick(options[idx]);
      await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);

      // Get the label text for the selected option
      const selectedValue = await options[idx].getAttribute('value');
      const selectedLabel = await options[idx].evaluate(el => {
        // Try to find associated label
        const id = el.id;
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label) return label.innerText?.trim();
        }
        // Try parent label
        const parentLabel = el.closest('label');
        if (parentLabel) return parentLabel.innerText?.trim();
        // Try next sibling text
        const next = el.nextSibling;
        if (next && next.textContent) return next.textContent.trim();
        return el.value || '';
      }).catch(() => selectedValue);

      selectedAnswers.push({
        questionName: name,
        selectedValue,
        selectedLabel: selectedLabel || selectedValue,
        optionCount: options.length,
        selectedIndex: idx + 1,
      });
    } catch {}
  }

  return selectedAnswers.length > 0
    ? { type: 'radio', selections: selectedAnswers }
    : null;
};

// ─── Answer checkboxes — returns structured answer ────────────────────────────
const answerCheckbox = async (page) => {
  const boxes = await page.$$('input[type="checkbox"]:not([disabled])');
  if (boxes.length === 0) return null;

  const count    = Math.min(boxes.length, Math.floor(Math.random() * 3) + 1);
  const shuffled = [...boxes].sort(() => Math.random() - 0.5).slice(0, count);
  const selectedLabels = [];

  for (const box of shuffled) {
    try {
      await safeClick(box);
      await page.waitForTimeout(Math.floor(Math.random() * 300) + 100);

      const label = await box.evaluate(el => {
        const id = el.id;
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) return lbl.innerText?.trim();
        }
        const parentLabel = el.closest('label');
        if (parentLabel) return parentLabel.innerText?.trim();
        return el.value || '';
      }).catch(() => '');

      selectedLabels.push(label || 'Option selected');
    } catch {}
  }

  return {
    type: 'checkbox',
    totalOptions: boxes.length,
    selectedCount: selectedLabels.length,
    selectedLabels,
  };
};

// ─── Answer select dropdowns — returns structured answer ──────────────────────
const answerSelect = async (page) => {
  const selects = await page.$$('select:not([disabled])');
  if (selects.length === 0) return null;

  const selections = [];

  for (const select of selects) {
    try {
      const options = await select.$$('option');
      const validOptions = options.slice(1); // skip placeholder
      if (validOptions.length === 0) continue;

      const idx   = Math.floor(Math.random() * validOptions.length);
      const value = await validOptions[idx].getAttribute('value');
      const label = await validOptions[idx].evaluate(el => el.innerText?.trim() || el.value);

      if (value) {
        await select.selectOption(value);
        await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);
        selections.push({
          selectedValue: value,
          selectedLabel: label,
          totalOptions: validOptions.length,
        });
      }
    } catch {}
  }

  return selections.length > 0
    ? { type: 'select', selections }
    : null;
};

// ─── Answer numeric inputs ────────────────────────────────────────────────────
const answerNumeric = async (page) => {
  const numInputs = await page.$$('input[type="number"]:not([disabled])');
  if (numInputs.length === 0) return null;

  const values = [];
  for (const input of numInputs) {
    try {
      const min = parseFloat(await input.getAttribute('min') || '1');
      const max = parseFloat(await input.getAttribute('max') || '100');
      const val = Math.floor(min + Math.random() * (max - min));
      await input.fill(String(val));
      await page.waitForTimeout(200);
      values.push(val);
    } catch {}
  }

  return values.length > 0 ? { type: 'numeric', values } : null;
};

// ─── Answer open-ended text ───────────────────────────────────────────────────
const answerOpenEnd = async (page, persona) => {
  const textareas  = await page.$$('textarea:not([disabled]):not([readonly])');
  const textInputs = await page.$$('input[type="text"]:not([disabled]):not([readonly])');
  const fields     = [...textareas, ...textInputs];
  if (fields.length === 0) return null;

  const style = persona?.behavioural_attrs?.responseStyle || 'neutral';
  const responses = {
    conservative: [
      'It meets my expectations and does what I need.',
      'Generally satisfactory and reliable.',
      'Works as expected without any major issues.',
      'Fairly standard experience overall.',
    ],
    neutral: [
      'It works well for my needs most of the time.',
      'Has both strengths and areas that could be improved.',
      'Overall a decent experience with room for improvement.',
      'Meets most of my requirements on a day to day basis.',
    ],
    expressive: [
      'I really appreciate how intuitive and user-friendly this is — it saves me considerable time and effort.',
      'While there are some areas that could be improved, overall this delivers real value.',
      'Very impressed with the overall quality and attention to detail — would definitely recommend.',
      'The core functionality is excellent and the interface is clean and easy to navigate.',
    ],
  };

  const pool     = responses[style] || responses.neutral;
  const response = pool[Math.floor(Math.random() * pool.length)];
  const typed    = [];

  for (const field of fields) {
    try {
      const box = await field.boundingBox();
      if (box && box.width < 30) continue;
      await humanType(page, field, response);
      await page.waitForTimeout(Math.floor(Math.random() * 400) + 200);
      typed.push(response);
    } catch {}
  }

  return typed.length > 0 ? { type: 'open-end', text: typed[0] } : null;
};

// ─── Capture all page options for report ──────────────────────────────────────
const capturePageOptions = async (page) => {
  try {
    return await page.evaluate(() => {
      const result = [];

      // Radio groups — get all options
      const radioGroups = {};
      document.querySelectorAll('input[type="radio"]').forEach(radio => {
        const name = radio.name;
        if (!name) return;
        if (!radioGroups[name]) radioGroups[name] = { options: [], selected: null };
        const id = radio.id;
        let labelText = '';
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = lbl.innerText?.trim();
        }
        if (!labelText) {
          const parentLabel = radio.closest('label');
          if (parentLabel) labelText = parentLabel.innerText?.trim();
        }
        if (!labelText) labelText = radio.value;

        radioGroups[name].options.push(labelText);
        if (radio.checked) radioGroups[name].selected = labelText;
      });

      Object.entries(radioGroups).forEach(([name, group]) => {
        result.push({
          type:     'radio',
          name,
          options:  group.options,
          selected: group.selected,
        });
      });

      // Checkboxes
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length > 0) {
        const cbOptions = [];
        const cbSelected = [];
        checkboxes.forEach(cb => {
          const id = cb.id;
          let labelText = '';
          if (id) {
            const lbl = document.querySelector(`label[for="${id}"]`);
            if (lbl) labelText = lbl.innerText?.trim();
          }
          if (!labelText) {
            const parentLabel = cb.closest('label');
            if (parentLabel) labelText = parentLabel.innerText?.trim();
          }
          if (!labelText) labelText = cb.value;
          cbOptions.push(labelText);
          if (cb.checked) cbSelected.push(labelText);
        });
        result.push({
          type:     'checkbox',
          options:  cbOptions,
          selected: cbSelected,
        });
      }

      // Selects
      document.querySelectorAll('select').forEach(select => {
        const options = [...select.options].map(o => o.innerText?.trim() || o.value);
        const selectedOpt = select.options[select.selectedIndex];
        const selected = selectedOpt ? selectedOpt.innerText?.trim() : null;
        result.push({
          type:     'select',
          options:  options.slice(1), // skip placeholder
          selected,
        });
      });

      return result;
    });
  } catch {
    return [];
  }
};

// ─── Answer all questions on page ─────────────────────────────────────────────
const answerPage = async (page, persona, readingSpeed = 'normal') => {
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(500);
  await readingDelay(page, readingSpeed);

  const radioResult    = await answerRadio(page, persona);
  const checkboxResult = await answerCheckbox(page);
  const selectResult   = await answerSelect(page);
  const numericResult  = await answerNumeric(page);
  const openEndResult  = await answerOpenEnd(page, persona);

  await page.waitForTimeout(Math.floor(Math.random() * 800) + 400);

  return [radioResult, checkboxResult, selectResult, numericResult, openEndResult].filter(Boolean);
};

// ─── Click Next button ────────────────────────────────────────────────────────
const clickNext = async (page) => {
  const nextSelectors = [
    'input[type="submit"]',
    'button[type="submit"]',
    'input[value="Next"]',
    'input[value="Continue"]',
    'input[value="Continue »"]',
    'input[value="Next »"]',
    'input[value="Submit"]',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Submit")',
    '#next', '.next-btn', '.btn-next',
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

module.exports = { detectOutcome, answerPage, clickNext, readingDelay, capturePageOptions, isHintText };