'use strict';

// ─── Decipher / FocusVision Survey Engine ────────────────────────────────────

const COMPLETE_URLS  = ['thankyou', 'complete', 'thank-you', 'finished', 'done', 'survey-closed'];
const TERMINATE_URLS = ['terminate', 'terminated', 'screenout', 'screen-out', 'disqualified', 'dq', 'noteligible'];
const QUOTA_URLS     = ['quota', 'over-quota', 'overquota', 'quotafull', 'quota-full', 'full'];

const HINT_PATTERNS = [
  /^please select/i, /^select all/i, /^choose all/i,
  /^select one/i,    /^choose one/i, /^check all/i,
  /^required/i,      /^optional/i,   /^\*/,
  /^e\.g\./i,        /^example/i,    /^hint/i,
  /^note:/i,         /^tip:/i,
];

const isHintText = (text) =>
  !text || text.length < 4 || text.length > 350 ||
  HINT_PATTERNS.some(p => p.test(text.trim()));

const OTHER_PATTERNS = [
  /^other/i, /^other \(please specify\)/i, /^other \(specify\)/i,
  /^specify/i, /^none of the above/i, /^prefer not to (say|answer)/i,
  /^don'?t know/i,
];

const isOtherOption = (text) =>
  OTHER_PATTERNS.some(p => p.test((text || '').trim()));

// ─── Detect outcome from URL ──────────────────────────────────────────────────
const detectOutcome = (url) => {
  const lower = url.toLowerCase();
  if (COMPLETE_URLS.some(k  => lower.includes(k))) return 'completed';
  if (TERMINATE_URLS.some(k => lower.includes(k))) return 'terminated';
  if (QUOTA_URLS.some(k     => lower.includes(k))) return 'over_quota';
  return null;
};

// ─── Detect outcome from page content (Decipher exit pages) ──────────────────
// Decipher exit pages stay on the same URL — must read page body to know outcome
const detectOutcomeFromPage = async (page) => {
  try {
    const text = await page.evaluate(() =>
      (document.body.innerText || document.body.textContent || '').toLowerCase()
    );

    // Terminated / Screened out — check FIRST (more specific phrases)
    if (
      text.includes('looking for a specific type of participant') ||
      text.includes('unfortunately, we are looking') ||
      text.includes('unfortunately we are looking') ||
      text.includes('does not meet our requirements') ||
      text.includes('do not qualify') ||
      text.includes('not eligible') ||
      text.includes('screened out') ||
      text.includes('unfortunately we are unable to include you') ||
      text.includes('does not qualify') ||
      text.includes('not what we are looking for') ||
      text.includes('we appreciate your understanding')
    ) return 'terminated';

    // Over quota — check SECOND
    if (
      text.includes('no longer accepting respondents') ||
      text.includes('no longer accepting participants') ||
      text.includes('quota has been filled') ||
      text.includes('enough respondents') ||
      text.includes('survey is full') ||
      text.includes('unfortunately we are no longer')
    ) return 'over_quota';

    // Qualified / Completed — check LAST (most generic)
    if (
      text.includes('thank you for taking our survey') ||
      text.includes('your efforts are greatly appreciated') ||
      text.includes('thank you for completing') ||
      text.includes('survey is now complete') ||
      text.includes('successfully completed') ||
      text.includes('thank you for your participation')
    ) return 'completed';

    return null;
  } catch {
    return null;
  }
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

// ─── Get label text for a radio/checkbox input ───────────────────────────────
const getLabelText = async (input) => {
  try {
    return await input.evaluate(el => {
      const id = el.id;
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) return (lbl.innerText || lbl.textContent || '').trim();
      }
      const parentLabel = el.closest('label');
      if (parentLabel) return (parentLabel.innerText || parentLabel.textContent || '').trim();
      const next = el.nextSibling;
      if (next?.textContent) return next.textContent.trim();
      return el.value || '';
    });
  } catch {
    return '';
  }
};

// ─── Answer radio questions ───────────────────────────────────────────────────
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
      const labelText = await getLabelText(radio);
      groups[name].push({ el: radio, value, label: labelText });
    } catch {}
  }

  const groupNames = Object.keys(groups);
  if (groupNames.length === 0) return null;

  const style = persona?.behavioural_attrs?.responseStyle || 'neutral';
  const selectedAnswers = [];

  for (const name of groupNames) {
    const allOptions = groups[name];
    if (allOptions.length === 0) continue;

    const mainOptions  = allOptions.filter(o => !isOtherOption(o.label));
    const optionsToUse = mainOptions.length > 0 ? mainOptions : allOptions;

    let idx;
    const n = optionsToUse.length;

    if (style === 'conservative') {
      idx = Math.floor(n * 0.25 + Math.random() * n * 0.5);
    } else if (style === 'expressive') {
      idx = Math.floor(Math.random() * n);
    } else {
      const start = Math.max(0, Math.floor(n * 0.15));
      const end   = Math.min(n - 1, Math.floor(n * 0.80));
      idx = start + Math.floor(Math.random() * (end - start + 1));
    }
    idx = Math.max(0, Math.min(idx, n - 1));

    const chosen = optionsToUse[idx];

    try {
      await safeClick(chosen.el);
      await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);

      const fullIdx = allOptions.findIndex(o => o.value === chosen.value);

      selectedAnswers.push({
        questionName:  name,
        selectedValue: chosen.value,
        selectedLabel: chosen.label || chosen.value,
        optionCount:   allOptions.length,
        selectedIndex: fullIdx + 1,
      });
    } catch {}
  }

  return selectedAnswers.length > 0
    ? { type: 'radio', selections: selectedAnswers }
    : null;
};

// ─── Answer checkboxes ────────────────────────────────────────────────────────
const answerCheckbox = async (page) => {
  const allBoxes = await page.$$('input[type="checkbox"]:not([disabled])');
  if (allBoxes.length === 0) return null;

  const boxesWithLabels = await Promise.all(allBoxes.map(async box => ({
    el: box,
    label: await getLabelText(box),
  })));

  const mainBoxes  = boxesWithLabels.filter(b => !isOtherOption(b.label));
  const pool       = mainBoxes.length > 0 ? mainBoxes : boxesWithLabels;

  const count    = Math.min(pool.length, Math.floor(Math.random() * 3) + 1);
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  const selectedLabels = [];

  for (const box of shuffled) {
    try {
      await safeClick(box.el);
      await page.waitForTimeout(Math.floor(Math.random() * 300) + 100);
      selectedLabels.push(box.label || 'Option selected');
    } catch {}
  }

  return {
    type:          'checkbox',
    totalOptions:  allBoxes.length,
    selectedCount: selectedLabels.length,
    selectedLabels,
  };
};

// ─── Answer select dropdowns ──────────────────────────────────────────────────
const answerSelect = async (page) => {
  const selects = await page.$$('select:not([disabled])');
  if (selects.length === 0) return null;

  const selections = [];

  for (const select of selects) {
    try {
      const options = await select.$$('option');
      const allValid = options.slice(1);
      if (allValid.length === 0) continue;

      const idx   = Math.floor(Math.random() * Math.min(allValid.length, Math.ceil(allValid.length * 0.75)));
      const value = await allValid[idx].getAttribute('value');
      const label = await allValid[idx].evaluate(el => el.innerText?.trim() || el.value);

      if (value) {
        await select.selectOption(value);
        await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);
        selections.push({ selectedValue: value, selectedLabel: label, totalOptions: allValid.length });
      }
    } catch {}
  }

  return selections.length > 0 ? { type: 'select', selections } : null;
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

// ─── Answer open-ended text fields ───────────────────────────────────────────
const answerOpenEnd = async (page, persona) => {
  const textareas  = await page.$$('textarea:not([disabled]):not([readonly])');
  const textInputs = await page.$$('input[type="text"]:not([disabled]):not([readonly])');

  const allFields = [...textareas, ...textInputs];
  if (allFields.length === 0) return null;

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
      'I really appreciate how intuitive and user-friendly this is — it saves me considerable time.',
      'While there are some areas that could be improved, overall this delivers real value.',
      'Very impressed with the overall quality and attention to detail.',
      'The core functionality is excellent and the interface is clean and easy to navigate.',
    ],
  };

  const pool     = responses[style] || responses.neutral;
  const response = pool[Math.floor(Math.random() * pool.length)];
  const typed    = [];

  for (const field of allFields) {
    try {
      const box = await field.boundingBox();
      if (!box || box.width < 40 || box.height < 10) continue;

      const isSpecifyField = await field.evaluate(el => {
        const form   = el.closest('form') || el.closest('.survey-page') || document;
        const radios = [...form.querySelectorAll('input[type="radio"]')];
        const nearbyOtherRadio = radios.find(r => {
          const id  = r.id;
          const lbl = id ? document.querySelector(`label[for="${id}"]`) : r.closest('label');
          const txt = (lbl?.innerText || '').toLowerCase();
          return txt.includes('other') || txt.includes('specify');
        });

        if (nearbyOtherRadio) return !nearbyOtherRadio.checked;

        const parent = el.closest('[class*="other"]') || el.closest('[id*="other"]');
        if (parent) {
          const radio = parent.querySelector('input[type="radio"]');
          if (radio && !radio.checked) return true;
        }

        return false;
      }).catch(() => false);

      if (isSpecifyField) {
        console.log('[Engine] Skipping specify field — Other radio not selected');
        continue;
      }

      await humanType(page, field, response);
      await page.waitForTimeout(Math.floor(Math.random() * 400) + 200);
      typed.push(response);
    } catch {}
  }

  return typed.length > 0 ? { type: 'open-end', text: typed[0] } : null;
};

// ─── Wait for timer-gated Next button ────────────────────────────────────────
const waitForNextButton = async (page, maxWaitMs = 120000) => {
  const nextSelectors = [
    'input[type="submit"]', 'button[type="submit"]',
    'input[value="Next"]', 'input[value="Continue"]',
    'input[value="Continue »"]', 'input[value="Next »"]',
    'button:has-text("Next")', 'button:has-text("Continue")',
  ];

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    for (const sel of nextSelectors) {
      try {
        const btn = await page.$(sel);
        if (!btn) continue;
        const isVisible = await btn.isVisible().catch(() => false);
        const isEnabled = await btn.isEnabled().catch(() => false);
        if (isVisible && isEnabled) return btn;
      } catch {}
    }

    const timerText = await page.evaluate(() => {
      const timerSelectors = [
        '[class*="timer"]', '[id*="timer"]', '[class*="countdown"]', '[class*="counter"]',
      ];
      for (const sel of timerSelectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText) return el.innerText.trim();
      }
      const body  = document.body.innerText || '';
      const match = body.match(/you will be able to continue in (\d+)/i);
      if (match) return `Waiting ${match[1]}s`;
      return null;
    }).catch(() => null);

    if (timerText) {
      console.log(`[Engine] Timer detected: ${timerText} — waiting...`);
    }

    await page.waitForTimeout(2000);
  }

  return null;
};

// ─── Click Next button (with timer awareness) ─────────────────────────────────
const clickNext = async (page) => {
  const immediateSelectors = [
    'input[type="submit"]', 'button[type="submit"]',
    'input[value="Next"]', 'input[value="Continue"]',
    'input[value="Continue »"]', 'input[value="Next »"]',
    'input[value="Submit"]',
    'button:has-text("Next")', 'button:has-text("Continue")',
    'button:has-text("Submit")',
    '#next', '.next-btn', '.btn-next',
  ];

  for (const sel of immediateSelectors) {
    try {
      const btn = await page.$(sel);
      if (!btn) continue;
      const isVisible = await btn.isVisible().catch(() => false);
      const isEnabled = await btn.isEnabled().catch(() => false);
      if (isVisible && isEnabled) {
        await safeClick(btn);
        return true;
      }
    } catch {}
  }

  // Next button visible but disabled — wait for timer
  for (const sel of immediateSelectors) {
    try {
      const btn = await page.$(sel);
      if (!btn) continue;
      const isVisible = await btn.isVisible().catch(() => false);
      if (!isVisible) continue;

      console.log('[Engine] Next button is disabled — checking for timer...');
      const enabledBtn = await waitForNextButton(page, 180000);
      if (enabledBtn) {
        console.log('[Engine] Timer expired — Next button now enabled');
        await page.waitForTimeout(500);
        await safeClick(enabledBtn);
        return true;
      }
      return false;
    } catch {}
  }

  return false;
};

// ─── Capture all page options for structured report ───────────────────────────
const capturePageOptions = async (page) => {
  try {
    return await page.evaluate(() => {
      const result = [];

const radioGroups = {};
      document.querySelectorAll('input[type="radio"]').forEach(radio => {
        const name = radio.name;
        if (!name) return;
        if (!radioGroups[name]) radioGroups[name] = { options: [], selected: null, rowLabel: null };

        const id = radio.id;
        let labelText = '';
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = (lbl.innerText || lbl.textContent || '').trim();
        }
        if (!labelText) {
          const parentLabel = radio.closest('label');
          if (parentLabel) labelText = (parentLabel.innerText || parentLabel.textContent || '').trim();
        }
        if (!labelText) labelText = radio.value;

        radioGroups[name].options.push(labelText);
        if (radio.checked) radioGroups[name].selected = labelText;

        // ── Capture row label for grid/matrix questions ──
        if (!radioGroups[name].rowLabel) {
          const row = radio.closest('tr');
          if (row) {
            const firstCell = row.querySelector('td:first-child, th:first-child');
            if (firstCell) {
              const cellText = (firstCell.innerText || firstCell.textContent || '').trim();
              if (cellText && cellText.length > 1) radioGroups[name].rowLabel = cellText;
            }
          }
          // Decipher also uses div-based grids — try parent container label
          if (!radioGroups[name].rowLabel) {
            const rowDiv = radio.closest('[class*="row"],[class*="item"],[class*="grid-row"]');
            if (rowDiv) {
              const span = rowDiv.querySelector('span,label,div');
              if (span) {
                const t = (span.innerText || span.textContent || '').trim();
                if (t && t.length > 1 && !t.match(/^\d+$/)) radioGroups[name].rowLabel = t;
              }
            }
          }
        }
      });

      Object.entries(radioGroups).forEach(([name, group]) => {
        result.push({ type: 'radio', name, options: group.options, selected: group.selected, rowLabel: group.rowLabel || null });
      });

      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length > 0) {
        const cbOptions  = [];
        const cbSelected = [];
        checkboxes.forEach(cb => {
          const id = cb.id;
          let labelText = '';
          if (id) {
            const lbl = document.querySelector(`label[for="${id}"]`);
            if (lbl) labelText = (lbl.innerText || lbl.textContent || '').trim();
          }
          if (!labelText) {
            const parentLabel = cb.closest('label');
            if (parentLabel) labelText = (parentLabel.innerText || parentLabel.textContent || '').trim();
          }
          if (!labelText) labelText = cb.value;
          cbOptions.push(labelText);
          if (cb.checked) cbSelected.push(labelText);
        });
        result.push({ type: 'checkbox', options: cbOptions, selected: cbSelected });
      }

      document.querySelectorAll('select').forEach(select => {
        const options    = [...select.options].slice(1).map(o => (o.innerText || o.value).trim());
        const selectedEl = select.options[select.selectedIndex];
        const selected   = selectedEl ? (selectedEl.innerText || selectedEl.value).trim() : null;
        if (options.length > 0) result.push({ type: 'select', options, selected });
      });

      const textareas  = [...document.querySelectorAll('textarea')];
      const textInputs = [...document.querySelectorAll('input[type="text"]')];
      [...textareas, ...textInputs].forEach(field => {
        if (field.value && field.offsetWidth > 40) {
          result.push({ type: 'open-end', options: [], selected: field.value });
        }
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

  await page.waitForTimeout(Math.floor(Math.random() * 600) + 300);

  return [radioResult, checkboxResult, selectResult, numericResult, openEndResult].filter(Boolean);
};

module.exports = {
  detectOutcome,
  detectOutcomeFromPage,
  answerPage,
  clickNext,
  readingDelay,
  capturePageOptions,
  isHintText,
};