'use strict';

// ─── Decipher / FocusVision Survey Engine ─────────────────────────────────────
// Version 2.0 — improved question extraction, consent handling, dropdown fixes

const COMPLETE_URLS  = ['thankyou', 'complete', 'thank-you', 'finished', 'done', 'survey-closed'];
const TERMINATE_URLS = ['terminate', 'terminated', 'screenout', 'screen-out', 'disqualified', 'dq', 'noteligible'];
const QUOTA_URLS     = ['quota', 'over-quota', 'overquota', 'quotafull', 'quota-full', 'full'];

// ─── Non-question text patterns (used in question extractor) ──────────────────
// These patterns identify text that looks like a question but is NOT a question:
// instruction text, section headers, progress indicators, legal notices, etc.
const NON_QUESTION_PATTERNS = [
  // Instruction-style openers
  /^please select/i,
  /^select all/i,
  /^choose all/i,
  /^select one/i,
  /^choose one/i,
  /^check all/i,
  /^please choose/i,
  /^please indicate/i,
  /^please rate/i,
  /^please answer/i,
  /^please complete/i,
  /^please tick/i,
  /^please check/i,
  /^required/i,
  /^optional/i,
  /^\*/,
  /^e\.g\./i,
  /^example/i,
  /^hint/i,
  /^note:/i,
  /^tip:/i,
  /^important:/i,
  /^instruction/i,
  // Progress / navigation
  /^section \d/i,
  /^\d+\s*of\s*\d+/,
  /^page \d/i,
  /^step \d/i,
  /^part \d/i,
  /^question \d+\s*of\s*\d+/i,
  /^q\d+\s*of\s*\d+/i,
  // Form helper text
  /^all fields/i,
  /^fields marked/i,
  /^mandatory/i,
  /^\* denotes/i,
  /^your (answers?|responses?) (are|will be|remain)/i,
  // Survey meta-text
  /^this survey/i,
  /^this questionnaire/i,
  /^this study/i,
  /^the following/i,
  /^in this section/i,
  /^for each/i,
  /^on a scale/i,            // scale instructions without the actual question
  /^using the scale/i,
  /^where 1/i,
  /^where \d/i,
  // Legal / privacy
  /^privacy/i,
  /^terms/i,
  /^copyright/i,
  /^by (clicking|continuing|proceeding)/i,
  /^i agree/i,
  /^i confirm/i,
  // Pure numbers or symbols
  /^\s*[\d\W]+\s*$/,
  // Very short navigation-style text
  /^(next|back|continue|submit|cancel|close|skip)$/i,
];

const isNonQuestion = (text) =>
  !text ||
  text.length < 8 ||
  text.length > 500 ||
  NON_QUESTION_PATTERNS.some(p => p.test(text.trim()));

// Keep isHintText as a lighter version for other uses (option label filtering etc.)
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

// ─── Other option patterns ─────────────────────────────────────────────────────
const OTHER_PATTERNS = [
  /^other/i, /^other \(please specify\)/i, /^other \(specify\)/i,
  /^specify/i, /^none of the above/i, /^prefer not to (say|answer)/i,
  /^don'?t know/i,
];

const isOtherOption = (text) =>
  OTHER_PATTERNS.some(p => p.test((text || '').trim()));

// ─── Consent checkbox detection ───────────────────────────────────────────────
// These are boxes that MUST be ticked to proceed — not survey answer choices
const CONSENT_PATTERNS = [
  /\bagree\b/i,
  /\bterms\b/i,
  /\bprivacy\b/i,
  /\bconsent\b/i,
  /\bconfirm\b/i,
  /\bi am \d{2}/i,          // "I am 18 years old"
  /\b18\s*(years|yr)/i,
  /\bof age\b/i,
  /\bi have read\b/i,
  /\bi understand\b/i,
  /\beligible\b/i,
  /\bqualify\b/i,
  /\bpolicy\b/i,
  /\blegal\b/i,
  /\bdisclaimer\b/i,
];

const isConsentCheckbox = (labelText) =>
  CONSENT_PATTERNS.some(p => p.test((labelText || '')));

// ─── Detect outcome from URL ──────────────────────────────────────────────────
const detectOutcome = (url) => {
  const lower = url.toLowerCase();
  if (COMPLETE_URLS.some(k  => lower.includes(k))) return 'completed';
  if (TERMINATE_URLS.some(k => lower.includes(k))) return 'terminated';
  if (QUOTA_URLS.some(k     => lower.includes(k))) return 'over_quota';
  return null;
};

// ─── Detect outcome from page content (Decipher exit pages) ──────────────────
const detectOutcomeFromPage = async (page) => {
  try {
    const text = await page.evaluate(() =>
      (document.body.innerText || document.body.textContent || '').toLowerCase()
    );

    // Terminated / Screened out — check FIRST (most specific)
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

    // Completed — check LAST (most generic)
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

// ─── Get label text for a radio/checkbox input ────────────────────────────────
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
// FIX: Consent checkboxes (terms/privacy/age verification) are always ticked.
// Regular checkboxes use persona-driven random selection.
const answerCheckbox = async (page) => {
  const allBoxes = await page.$$('input[type="checkbox"]:not([disabled])');
  if (allBoxes.length === 0) return null;

  const boxesWithLabels = await Promise.all(allBoxes.map(async box => ({
    el:    box,
    label: await getLabelText(box),
  })));

  const selectedLabels = [];

  // ── Step 1: Always tick consent checkboxes ───────────────────────────────
  const consentBoxes  = boxesWithLabels.filter(b => isConsentCheckbox(b.label));
  const regularBoxes  = boxesWithLabels.filter(b =>
    !isConsentCheckbox(b.label) && !isOtherOption(b.label)
  );

  for (const box of consentBoxes) {
    try {
      const isChecked = await box.el.isChecked().catch(() => false);
      if (!isChecked) {
        await safeClick(box.el);
        await page.waitForTimeout(Math.floor(Math.random() * 200) + 100);
      }
      selectedLabels.push(box.label || 'Consent acknowledged');
      console.log(`[Engine] ✓ Consent checkbox ticked: "${(box.label || '').slice(0, 60)}"`);
    } catch {}
  }

  // ── Step 2: Random selection for regular answer checkboxes ───────────────
  const pool = regularBoxes.length > 0 ? regularBoxes : [];

  if (pool.length > 0) {
    const count    = Math.min(pool.length, Math.floor(Math.random() * 3) + 1);
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, count);

    for (const box of shuffled) {
      try {
        await safeClick(box.el);
        await page.waitForTimeout(Math.floor(Math.random() * 300) + 100);
        selectedLabels.push(box.label || 'Option selected');
      } catch {}
    }
  }

  if (selectedLabels.length === 0) return null;

  return {
    type:          'checkbox',
    totalOptions:  allBoxes.length,
    selectedCount: selectedLabels.length,
    selectedLabels,
  };
};

// ─── Answer select dropdowns ──────────────────────────────────────────────────
// FIX: Properly detect and skip placeholder options instead of blindly slice(1).
// Handles: "--Select one--", "Please choose...", empty values, value="0" placeholders.
const answerSelect = async (page) => {
  const selects = await page.$$('select:not([disabled])');
  if (selects.length === 0) return null;

  const selections = [];

  for (const select of selects) {
    try {
      // Check if already answered (has a real selected value)
      const currentValue = await select.evaluate(el => el.value);
      const isAnswered = currentValue &&
        currentValue !== '' &&
        currentValue !== '0' &&
        !/^(--|select|choose|please|pick|none)/i.test(currentValue);
      if (isAnswered) continue;

      const options = await select.$$('option');

      // FIX: Filter placeholder options properly rather than blindly skipping [0]
      const validOptions = [];
      for (const opt of options) {
        const value = await opt.getAttribute('value');
        const text  = await opt.evaluate(el => (el.innerText || el.textContent || '').trim());

        // Skip if no value
        if (!value || value === '' || value === '0') continue;

        // Skip placeholder text patterns
        if (/^(--|select|choose|please select|please choose|pick one|none selected)/i.test(text)) continue;

        // Skip if text is empty
        if (!text || text.length === 0) continue;

        validOptions.push({ value, text });
      }

      if (validOptions.length === 0) continue;

      // Pick a random option from first 75% of valid options (avoids "prefer not to say" at end)
      const pickFrom = Math.max(1, Math.ceil(validOptions.length * 0.75));
      const idx      = Math.floor(Math.random() * pickFrom);
      const chosen   = validOptions[idx];

      await select.selectOption(chosen.value);
      await page.waitForTimeout(Math.floor(Math.random() * 400) + 150);
      selections.push({
        selectedValue: chosen.value,
        selectedLabel: chosen.text,
        totalOptions:  validOptions.length,
      });
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
      // Skip already-filled inputs
      const existing = await input.inputValue().catch(() => '');
      if (existing && existing.trim() !== '') continue;

      const minAttr = await input.getAttribute('min');
      const maxAttr = await input.getAttribute('max');
      const min     = parseFloat(minAttr ?? '1');
      const max     = parseFloat(maxAttr ?? '100');

      // Clamp to sensible defaults if attributes are missing or extreme
      const safeMin = isNaN(min) ? 1   : Math.max(0, min);
      const safeMax = isNaN(max) ? 100 : Math.min(9999, max);

      const val = Math.floor(safeMin + Math.random() * (safeMax - safeMin));
      await input.fill(String(val));
      await page.waitForTimeout(200);
      values.push(val);
    } catch {}
  }

  return values.length > 0 ? { type: 'numeric', values } : null;
};

// ─── Answer open-ended text fields ────────────────────────────────────────────
// Skips spec boxes that belong to unselected "Other" options.
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

      // Skip fields that already have a value
      const existingValue = await field.inputValue().catch(() => '');
      if (existingValue && existingValue.trim() !== '') continue;

      // FIX: Detect spec boxes that belong to unselected "Other" radio options
      const isSpecifyField = await field.evaluate(el => {
        // Strategy 1: Walk up to find a radio container and check if its radio is checked
        let node = el.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!node) break;

          // If this container has a radio, check if "Other" radio is checked
          const radios = node.querySelectorAll('input[type="radio"]');
          if (radios.length === 1) {
            const radio = radios[0];
            const id    = radio.id;
            const lbl   = id ? document.querySelector(`label[for="${id}"]`) : radio.closest('label');
            const txt   = (lbl?.innerText || '').toLowerCase();
            const isOther = txt.includes('other') || txt.includes('specify') || txt.includes('please state');
            if (isOther && !radio.checked) return true;  // Other radio exists but not checked
          }

          // Stop walking up when we hit a container with multiple radios (left option scope)
          if (node.querySelectorAll('input[type="radio"]').length > 1) break;
          node = node.parentElement;
        }

        // Strategy 2: Class/ID-based detection
        const parent = el.closest('[class*="other"]') ||
                       el.closest('[id*="other"]') ||
                       el.closest('[class*="specify"]') ||
                       el.closest('[id*="specify"]');
        if (parent) {
          const radio = parent.querySelector('input[type="radio"]');
          if (radio && !radio.checked) return true;
        }

        // Strategy 3: Check placeholder text
        const ph = (el.placeholder || '').toLowerCase();
        if (ph.includes('specify') || ph.includes('please state') || ph.includes('please describe')) {
          // If there's a radio nearby that's not checked, skip this field
          const nearestForm = el.closest('form') || el.closest('.survey-page') || document;
          const uncheckedRadios = [...nearestForm.querySelectorAll('input[type="radio"]')]
            .filter(r => !r.checked);
          if (uncheckedRadios.length > 0) return true;
        }

        return false;
      }).catch(() => false);

      if (isSpecifyField) {
        console.log('[Engine] Skipping specify/other field — parent radio not selected');
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
// FIX: Spec box text (Other/specify fields) is now captured and attached
// directly to the radio or checkbox entry that triggered it, not as a
// separate disconnected open-end entry.
const capturePageOptions = async (page) => {
  try {
    return await page.evaluate(() => {
      const result = [];

      // ── Helper: find spec box text near a checked input ─────────────────────
      // Walks up the DOM from the checked input to find a text/textarea
      // that belongs to the same option container and has a value filled in.
      const getSpecText = (checkedInput) => {
        if (!checkedInput) return null;
        let node = checkedInput.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!node) break;
          // Look for text input or textarea within this container
          const specInput = node.querySelector(
            'input[type="text"], input[type="search"], textarea'
          );
          if (specInput) {
            const val = (specInput.value || '').trim();
            if (val.length > 0) return val;
          }
          // Stop walking up when the container holds multiple radio/checkboxes
          // — we have left the option scope
          if (node.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 1) break;
          node = node.parentElement;
        }
        return null;
      };

      // ── Radio groups ──────────────────────────────────────────────────────
      const radioGroups = {};
      const radioElements = {}; // store the actual element for spec box lookup
      document.querySelectorAll('input[type="radio"]').forEach(radio => {
        const name = radio.name;
        if (!name) return;
        if (!radioGroups[name]) {
          radioGroups[name] = { options: [], selected: null, specText: null, rowLabel: null };
          radioElements[name] = {};
        }

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

        if (radio.checked) {
          radioGroups[name].selected = labelText;
          // FIX: Capture spec box text for the checked option
          const specText = getSpecText(radio);
          if (specText) radioGroups[name].specText = specText;
        }

        // Capture row label for grid/matrix questions
        if (!radioGroups[name].rowLabel) {
          const row = radio.closest('tr');
          if (row) {
            const firstCell = row.querySelector('td:first-child, th:first-child');
            if (firstCell) {
              const cellText = (firstCell.innerText || firstCell.textContent || '').trim();
              if (cellText && cellText.length > 1) radioGroups[name].rowLabel = cellText;
            }
          }
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
        result.push({
          type:      'radio',
          name,
          options:   group.options,
          selected:  group.selected,
          specText:  group.specText || null,   // ← NEW: spec box text attached here
          rowLabel:  group.rowLabel || null,
        });
      });

      // ── Checkboxes ────────────────────────────────────────────────────────
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      if (checkboxes.length > 0) {
        const cbOptions    = [];
        const cbSelected   = [];
        const cbSpecTexts  = []; // FIX: track spec text per selected checkbox

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

          if (cb.checked) {
            cbSelected.push(labelText);
            // FIX: capture spec text for checked checkboxes too
            const specText = getSpecText(cb);
            if (specText) cbSpecTexts.push({ option: labelText, text: specText });
          }
        });

        result.push({
          type:      'checkbox',
          options:   cbOptions,
          selected:  cbSelected,
          specTexts: cbSpecTexts.length > 0 ? cbSpecTexts : null, // ← NEW
        });
      }

      // ── Dropdowns ─────────────────────────────────────────────────────────
      document.querySelectorAll('select').forEach(select => {
        // Filter placeholder options properly
        const options = [...select.options]
          .filter(o => {
            const val  = o.value;
            const text = (o.innerText || o.textContent || '').trim();
            if (!val || val === '' || val === '0') return false;
            if (/^(--|select|choose|please select|please choose|pick one|none selected)/i.test(text)) return false;
            return true;
          })
          .map(o => (o.innerText || o.value).trim());

        const selectedEl = select.options[select.selectedIndex];
        const selected   = selectedEl ? (selectedEl.innerText || selectedEl.value).trim() : null;
        if (options.length > 0) result.push({ type: 'select', options, selected });
      });

      // ── Standalone open-end fields ────────────────────────────────────────
      // Only captures fields that are NOT spec boxes already captured above.
      // A field is a standalone open-end if it has no nearby radio/checkbox.
      const textareas  = [...document.querySelectorAll('textarea')];
      const textInputs = [...document.querySelectorAll('input[type="text"]')];

      [...textareas, ...textInputs].forEach(field => {
        const val = (field.value || '').trim();
        if (!val) return;

        // Skip invisible fields (spec boxes that are hidden but have stale values)
        // Use offsetParent instead of offsetWidth for more reliable visibility check
        if (!field.offsetParent && field.offsetWidth === 0 && field.offsetHeight === 0) return;

        // Check if this field is a spec box that belongs to a radio/checkbox
        // If so, skip it — it's already captured inside the radio/checkbox entry above
        const isSpecBox = (() => {
          let node = field.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!node) break;
            const inputs = node.querySelectorAll('input[type="radio"], input[type="checkbox"]');
            if (inputs.length === 1 && inputs[0].checked) return true; // attached to a checked option
            if (inputs.length > 1) break; // left option scope
            node = node.parentElement;
          }
          return false;
        })();

        if (!isSpecBox) {
          result.push({ type: 'open-end', options: [], selected: val });
        }
      });

      return result;
    });
  } catch {
    return [];
  }
};

// ─── Answer all questions on page (fallback — used when AI unavailable) ───────
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
  isNonQuestion,
};