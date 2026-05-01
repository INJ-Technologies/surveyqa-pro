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
const { getActiveScenarios } = require("../../backend/src/db/scenarios");

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
    const result = await pool.query(`SELECT * FROM personas WHERE id = $1`, [personaId]);
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
      summary.push({ type: "radio", label: `Selected: ${opt.selected}`, detail: `Option ${selNum} of ${totalOpts}`, options: opt.options || [], selected: opt.selected });
    } else if (opt.type === "checkbox" && opt.selected?.length > 0) {
      summary.push({ type: "checkbox", label: `Selected ${opt.selected.length} of ${opt.options?.length || "?"}`, detail: opt.selected.join(", "), options: opt.options || [], selected: opt.selected });
    } else if (opt.type === "select" && opt.selected) {
      summary.push({ type: "select", label: `Selected: ${opt.selected}`, options: opt.options || [], selected: opt.selected });
    }
  }
  for (const ans of answersGiven || []) {
    if (ans?.type === "open-end" && ans.text) summary.push({ type: "open-end", label: "Typed response", detail: ans.text });
    if (ans?.type === "numeric" && ans.values?.length > 0) summary.push({ type: "numeric", label: "Entered value", detail: ans.values.join(", ") });
  }
  return summary;
};

// ─── Screenshot with retry ────────────────────────────────────────────────────
const takeScreenshot = async (page, screenshotPath) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 8000 });
      return true;
    } catch (e) {
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
      else console.warn(`[Worker] Screenshot failed: ${e.message}`);
    }
  }
  return false;
};

// ─── Capture grid/matrix answers with row labels ──────────────────────────────
const captureGridAnswers = async (page) => {
  try {
    return await page.evaluate(() => {
      const groups = {};
      const groupOrder = [];
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        if (!r.name) return;
        if (!groups[r.name]) { groups[r.name] = []; groupOrder.push(r.name); }
        groups[r.name].push(r);
      });
      if (groupOrder.length <= 1) return [];
      return groupOrder.map(name => {
        const radios = groups[name];
        const first = radios[0];
        let rowLabel = '';
        const tr = first.closest('tr');
        if (tr) {
          const cells = Array.from(tr.querySelectorAll('td, th'));
          for (const cell of cells) {
            if (!cell.querySelector('input')) {
              const t = (cell.innerText || cell.textContent || '').trim();
              if (t) { rowLabel = t; break; }
            }
          }
        }
        const checked = radios.find(r => r.checked);
        let selectedLabel = '';
        if (checked) {
          if (checked.id) {
            const lbl = document.querySelector(`label[for="${checked.id}"]`);
            if (lbl) selectedLabel = (lbl.innerText || lbl.textContent || '').trim();
          }
          if (!selectedLabel) {
            const table = checked.closest('table');
            const td = checked.closest('td');
            if (table && td) {
              const allCells = Array.from(checked.closest('tr')?.querySelectorAll('td') || []);
              const colIdx = allCells.indexOf(td);
              const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th'));
              if (headers[colIdx]) selectedLabel = (headers[colIdx].innerText || headers[colIdx].textContent || '').trim();
            }
          }
        }
        return {
          row: rowLabel || name,
          selected: selectedLabel || (checked ? '✓ Selected' : '—'),
          answered: !!checked,
        };
      });
    });
  } catch {
    return [];
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// CLICK HELPERS
// ══════════════════════════════════════════════════════════════════════════════

const clickRadioOption = async (page, radio) => {
  try {
    const id = await radio.getAttribute('id').catch(() => null);
    if (id) {
      const lbl = page.locator(`label[for="${id}"]`);
      const visible = await lbl.isVisible().catch(() => false);
      if (visible) { await lbl.click(); await page.waitForTimeout(200); return; }
    }
    const parentLbl = radio.locator('xpath=ancestor::label').first();
    const parentVisible = await parentLbl.isVisible().catch(() => false);
    if (parentVisible) { await parentLbl.click(); await page.waitForTimeout(200); return; }
    await radio.check();
    await page.waitForTimeout(200);
  } catch {
    await radio.click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
  }
};

const clickLabelByText = async (page, text) => {
  const allLabels = await page.locator('label').all();
  for (const label of allLabels) {
    const t = (await label.textContent().catch(() => '')) || '';
    if (t.trim() === text) {
      await label.click().catch(() => {});
      await page.waitForTimeout(400);
      return true;
    }
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════════
// NUMERIC INPUT HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a numeric string with optional magnitude suffix.
 * ignoreSuffix=true → "USD$500m" becomes 500 (used when input has "million" label beside it)
 */
const parseNum = (str, ignoreSuffix = false) => {
  if (!str) return null;
  const clean = str.replace(/USD|[$£€,\s]/gi, '').trim();
  const match = clean.match(/^([\d.]+)([kmbtKMBT]?)/);
  if (!match) return null;
  let num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  if (!ignoreSuffix) {
    const s = (match[2] || '').toLowerCase();
    if (s === 'k') num *= 1_000;
    else if (s === 'm') num *= 1_000_000;
    else if (s === 'b') num *= 1_000_000_000;
    else if (s === 't') num *= 1_000_000_000_000;
  }
  return num;
};

/**
 * Extract {min, max} from any text string.
 * Handles: "between X and Y", "X – Y", "X to Y", etc.
 */
const extractRange = (text, ignoreSuffix = false) => {
  if (!text) return null;
  const p1 = text.match(/between\s+([USD$£€]*[\d,.]+[kmbtKMBT]?)\s+(?:and|–|-)\s+([USD$£€]*[\d,.]+[kmbtKMBT]?)/i);
  if (p1) {
    const a = parseNum(p1[1], ignoreSuffix);
    const b = parseNum(p1[2], ignoreSuffix);
    if (a !== null && b !== null) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const p2 = text.match(/([USD$£€]*[\d,.]+[kmbtKMBT]?)\s*(?:–|-)\s*([USD$£€]*[\d,.]+[kmbtKMBT]?)/i);
  if (p2) {
    const a = parseNum(p2[1], ignoreSuffix);
    const b = parseNum(p2[2], ignoreSuffix);
    if (a !== null && b !== null && a !== b && Math.min(a, b) >= 0) {
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
  }
  const p3 = text.match(/(?:enter|between|from).*?([\d,.]+)\s*(?:and|to)\s*([\d,.]+)/i);
  if (p3) {
    const a = parseFloat(p3[1].replace(/,/g, ''));
    const b = parseFloat(p3[2].replace(/,/g, ''));
    if (!isNaN(a) && !isNaN(b)) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
};

/**
 * Round to 3 significant figures based on magnitude, clamped to [rangeMin, rangeMax].
 * e.g. 87432 → 87400, 12433 → 12400, 750 → 750, 550 → 550
 */
const smartRound = (value, rangeMin, rangeMax) => {
  if (!value || value <= 0) return Math.ceil(rangeMin || 1);
  const mag = Math.floor(Math.log10(Math.abs(value)));
  const roundTo = Math.pow(10, Math.max(0, mag - 2));
  const rounded = Math.round(value / roundTo) * roundTo;
  return Math.min(Math.max(rounded, Math.ceil(rangeMin)), Math.floor(rangeMax));
};

/**
 * Pick a sensible random value for a numeric input based on its unit context.
 * unit: 'percent' | 'million' | 'billion' | 'thousand' | 'generic'
 */
const valueForUnit = (unit, attrMin, attrMax) => {
  switch (unit) {
    case 'percent':
      return Math.floor(5 + Math.random() * 25); // 5–30%
    case 'million': {
      const min = attrMin ?? 1;
      const max = attrMax ?? 999;
      return smartRound(min + Math.random() * (max - min), min, max);
    }
    case 'billion': {
      const min = attrMin ?? 1;
      const max = attrMax ?? 9;
      return smartRound(min + Math.random() * (max - min), min, max);
    }
    case 'thousand': {
      const min = attrMin ?? 1;
      const max = attrMax ?? 999;
      return smartRound(min + Math.random() * (max - min), min, max);
    }
    default: {
      const min = attrMin ?? 1;
      const max = attrMax ?? 100;
      const raw = min + Math.random() * (max - min);
      return smartRound(raw, min, max);
    }
  }
};

/**
 * Detect unit type from surrounding text.
 */
const detectUnit = (text) => {
  const t = (text || '').toLowerCase();
  if (/\b%\b|percent|percentage/.test(t)) return 'percent';
  if (/billion|bn|\$.*b\b/.test(t)) return 'billion';
  if (/million|mn|\$.*m\b/.test(t)) return 'million';
  if (/thousand|,000/.test(t)) return 'thousand';
  return 'generic';
};

// ──────────────────────────────────────────────────────────────────────────────
// fillFollowupInput — runs after a radio click to fill any revealed input/select
// Handles: text input, number input, <select> dropdown
// ──────────────────────────────────────────────────────────────────────────────
const fillFollowupInput = async (page) => {
  try {
    await page.waitForTimeout(900);

    // ── Check for revealed text/number inputs first ────────────────────────
    const inputs = await page.locator("input[type='text'], input[type='number']").all();
    for (const input of inputs) {
      if (!await input.isVisible().catch(() => false)) continue;

      let min = null;
      let max = null;

      // Strategy 1: HTML min/max attributes
      const attrMin = await input.getAttribute('min').catch(() => null);
      const attrMax = await input.getAttribute('max').catch(() => null);
      if (attrMin !== null && attrMin !== '') min = parseFloat(attrMin);
      if (attrMax !== null && attrMax !== '') max = parseFloat(attrMax);

      // Detect if input has a unit label beside it (million, billion, %)
      const adjacentText = await input.evaluate(el => {
        const parent = el.parentElement;
        return (parent?.innerText || parent?.textContent || '').toLowerCase();
      }).catch(() => '');
      const hasUnitLabel = /\b(million|billion|thousand|mn|bn|%)\b/i.test(adjacentText);

      // Strategy 2: range from the currently selected radio label text
      if (min === null || max === null) {
        const selectedLabel = await page.evaluate(() => {
          const checked = document.querySelector('input[type="radio"]:checked');
          if (!checked) return '';
          if (checked.id) {
            const lbl = document.querySelector(`label[for="${checked.id}"]`);
            if (lbl) return lbl.innerText || lbl.textContent || '';
          }
          const parentLabel = checked.closest('label');
          if (parentLabel) return parentLabel.innerText || parentLabel.textContent || '';
          return '';
        }).catch(() => '');

        if (selectedLabel) {
          const parsed = extractRange(selectedLabel, hasUnitLabel);
          if (parsed) {
            min = parsed.min;
            max = parsed.max;
            console.log(`[Scenario] Range from selected radio label: ${min}–${max}`);
          }
        }
      }

      // Strategy 3: range from nearby parent text
      if (min === null || max === null) {
        const nearbyText = await input.evaluate(el => {
          let node = el.parentElement;
          for (let i = 0; i < 5; i++) {
            const t = (node?.innerText || '').trim();
            if (t.length > 10) return t;
            node = node?.parentElement;
          }
          return '';
        }).catch(() => '');
        const parsed = extractRange(nearbyText, hasUnitLabel);
        if (parsed) { min = parsed.min; max = parsed.max; }
      }

      // Strategy 4: error/hint elements only
      if (min === null || max === null) {
        const errorText = await page.evaluate(() => {
          const selectors = ['.error', '.validation-error', '.field-error', '[class*="error"]', '[class*="invalid"]', '.hint', '.help-text', '[class*="hint"]'];
          const texts = [];
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => {
              const t = (el.innerText || el.textContent || '').trim();
              if (t) texts.push(t);
            });
          }
          return texts.join(' ');
        }).catch(() => '');
        if (errorText) {
          const parsed = extractRange(errorText, hasUnitLabel);
          if (parsed) { min = parsed.min; max = parsed.max; }
        }
      }

      // Strategy 5: placeholder fallback
      if (min === null && max === null) {
        const placeholder = await input.getAttribute('placeholder').catch(() => '');
        const parsed = extractRange(placeholder || '', false);
        if (parsed) { min = parsed.min; max = parsed.max; }
      }

      // Ensure valid range
      if (min === null) min = 0;
      if (max === null) max = min * 2 || 100;
      if (min > max) [min, max] = [max, min];
      if (min === max) max = min + Math.max(1, Math.floor(min * 0.1));

      const rawValue = min + Math.random() * (max - min);
      const value = smartRound(rawValue, min, max);
      await input.fill(String(value)).catch(() => {});
      console.log(`[Scenario] ✓ Auto-filled follow-up input: ${value} (range: ${min}–${max}, unitLabel: ${hasUnitLabel})`);
      return true;
    }

    // ── Check for revealed <select> dropdown (e.g. Image 3: radio → dropdown) ──
    const selects = await page.locator('select').all();
    for (const sel of selects) {
      if (!await sel.isVisible().catch(() => false)) continue;
      const current = await sel.inputValue().catch(() => '');
      const selectedText = await sel.evaluate(el =>
        el.options[el.selectedIndex]?.text || ''
      ).catch(() => '');
      const isPlaceholder = !current || current.trim() === '' ||
        /^(select one|--|please select|choose|select\.\.\.)/i.test(selectedText.trim());
      if (!isPlaceholder) continue; // already has a real answer

      const optEls = await sel.locator('option').all();
      const validOpts = [];
      for (const opt of optEls) {
        const val  = await opt.getAttribute('value').catch(() => '');
        const text = (await opt.textContent().catch(() => '')).trim();
        if (val && val !== '' && !/^(select one|--|please select)/i.test(text)) {
          validOpts.push(val);
        }
      }
      if (validOpts.length > 0) {
        const chosen = validOpts[Math.floor(Math.random() * validOpts.length)];
        await sel.selectOption(chosen).catch(() => {});
        console.log(`[Scenario] ✓ Auto-selected follow-up dropdown: "${chosen}"`);
        return true;
      }
    }

  } catch (e) {
    console.warn(`[Scenario] Follow-up input detection failed: ${e.message}`);
  }
  return false;
};

// ──────────────────────────────────────────────────────────────────────────────
// fillRemainingInputs — runs after answerPage/scenario to catch any unfilled
// visible inputs. Handles:
//   • standalone text/number inputs (S10, Q7, Q12 text rows)
//   • grid tables of inputs (S9, Q7, Q12)
//   • standalone <select> dropdowns not already answered
// ──────────────────────────────────────────────────────────────────────────────
const fillRemainingInputs = async (page) => {
  try {
    let filled = 0;

    // ── Text / number inputs ────────────────────────────────────────────────
    const inputs = await page.locator("input[type='text'], input[type='number']").all();
    for (const input of inputs) {
      if (!await input.isVisible().catch(() => false)) continue;

      // Skip if already has a value
      const existing = await input.inputValue().catch(() => '');
      if (existing && existing.trim() !== '') continue;

      // Detect unit from HTML attrs + surrounding text
      const attrMin = await input.getAttribute('min').catch(() => null);
      const attrMax = await input.getAttribute('max').catch(() => null);
      const numMin = attrMin !== null && attrMin !== '' ? parseFloat(attrMin) : null;
      const numMax = attrMax !== null && attrMax !== '' ? parseFloat(attrMax) : null;

      // Walk up DOM to find unit context
      const surroundText = await input.evaluate(el => {
        let node = el.parentElement;
        for (let i = 0; i < 6; i++) {
          const t = (node?.innerText || '').trim();
          if (t.length > 5) return t;
          node = node?.parentElement;
        }
        return '';
      }).catch(() => '');

      const unit = detectUnit(surroundText);

      // If HTML range exists and is sensible, use it; otherwise use unit defaults
      let value;
      if (numMin !== null && numMax !== null && numMax > numMin) {
        const raw = numMin + Math.random() * (numMax - numMin);
        value = smartRound(raw, numMin, numMax);
      } else if (numMax !== null && numMin === null) {
        // Only max — pick lower half of range
        value = valueForUnit(unit, 1, numMax);
      } else {
        // No HTML constraints — try to extract range from surrounding text
        const parsed = extractRange(surroundText, /\b(million|billion|mn|bn)\b/i.test(surroundText));
        if (parsed && parsed.max > parsed.min) {
          const raw = parsed.min + Math.random() * (parsed.max - parsed.min);
          value = smartRound(raw, parsed.min, parsed.max);
        } else {
          value = valueForUnit(unit, numMin, numMax);
        }
      }

      await input.fill(String(value)).catch(() => {});
      filled++;
      console.log(`[Worker] ✓ Filled remaining input: ${value} (unit: ${unit}, context: "${surroundText.slice(0, 40)}")`);
    }

    // ── <select> dropdowns not yet answered ─────────────────────────────────
    const selects = await page.locator('select').all();
    for (const sel of selects) {
      if (!await sel.isVisible().catch(() => false)) continue;
      const current = await sel.inputValue().catch(() => '');
      const selectedText = await sel.evaluate(el =>
        el.options[el.selectedIndex]?.text || ''
      ).catch(() => '');
      const isPlaceholder = !current || current.trim() === '' ||
        /^(select one|--|please select|choose|select\.\.\.)/i.test(selectedText.trim());
      if (!isPlaceholder) continue; // already has a real answer

      const optEls = await sel.locator('option').all();
      const validOpts = [];
      for (const opt of optEls) {
        const val  = await opt.getAttribute('value').catch(() => '');
        const text = (await opt.textContent().catch(() => '')).trim();
        if (val && val !== '' && !/^(select one|--|please select)/i.test(text)) {
          validOpts.push(val);
        }
      }
      if (validOpts.length > 0) {
        const chosen = validOpts[Math.floor(Math.random() * validOpts.length)];
        await sel.selectOption(chosen).catch(() => {});
        filled++;
        console.log(`[Worker] ✓ Filled remaining dropdown: "${chosen}"`);
      }
    }

    if (filled > 0) console.log(`[Worker] fillRemainingInputs: filled ${filled} field(s)`);
    return filled > 0;
  } catch (e) {
    console.warn(`[Worker] fillRemainingInputs error: ${e.message}`);
    return false;
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// SCENARIO ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const loadCountryLogic = async (projectId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM scenarios WHERE project_id = $1 AND name = 'Country Logic' AND is_active = true LIMIT 1`,
      [projectId]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    const cm = typeof row.country_mapping === 'string'
      ? JSON.parse(row.country_mapping) : row.country_mapping;
    if (!cm?.mappings?.length) return null;
    console.log(`[CountryLogic] Loaded — question: "${cm.questionContains}", countries: ${cm.mappings.map(m => m.country).join(', ')}`);
    return { ...row, country_mapping: cm };
  } catch (e) {
    console.warn('[CountryLogic] Load failed:', e.message);
    return null;
  }
};

const loadSessionScenario = async (projectId, sessionId, scenarioIds = null) => {
  try {
    if (Array.isArray(scenarioIds) && scenarioIds.length === 0) {
      console.log('[Scenario] No scenarios selected by user — skipping');
      return null;
    }
    let scenarios = await getActiveScenarios(projectId);
    if (!scenarios || scenarios.length === 0) return null;
    if (scenarioIds && scenarioIds.length > 0) {
      scenarios = scenarios.filter(s => scenarioIds.includes(s.id));
    }
    const posResult = await pool.query(
      `SELECT COUNT(*) AS pos FROM sessions
       WHERE project_id = $1 AND created_at <= (SELECT created_at FROM sessions WHERE id = $2)`,
      [projectId, sessionId]
    );
    const pos = Math.max(0, parseInt(posResult.rows[0]?.pos || 1) - 1);
    const scenario = scenarios[pos % scenarios.length];
    let steps = scenario.steps;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      const stepsResult = await pool.query(
        `SELECT * FROM scenario_steps WHERE scenario_id = $1 ORDER BY step_order ASC`,
        [scenario.id]
      );
      steps = stepsResult.rows.map(r => ({
        ...r,
        conditions:    typeof r.conditions    === 'string' ? JSON.parse(r.conditions)    : r.conditions    || [],
        action_values: typeof r.action_values === 'string' ? JSON.parse(r.action_values) : r.action_values || [],
      }));
    }
    console.log(`[Scenario] Assigned: "${scenario.name}" (${steps.length} steps) → session ${sessionId.slice(0,8)}`);
    return { ...scenario, steps };
  } catch (e) {
    console.warn('[Scenario] Load failed:', e.message);
    return null;
  }
};

const applyCountryMapping = async (page, countryLogic, proxyCountry, questionsOnPage) => {
  if (!countryLogic?.country_mapping) return false;
  const { questionContains, mappings } = countryLogic.country_mapping;
  if (!questionContains || !mappings?.length) return false;
  const hasCountryQ = questionsOnPage.some(q => q.toLowerCase().includes(questionContains.toLowerCase()));
  if (!hasCountryQ) return false;
  const mapping = mappings.find(m => m.country.toUpperCase() === (proxyCountry || '').toUpperCase());
  if (!mapping) { console.log(`[CountryLogic] No mapping for "${proxyCountry}" — skipping`); return false; }
  const answer = mapping.answer;
  console.log(`[CountryLogic] Mapping: ${proxyCountry} → "${answer}"`);
  if (await clickLabelByText(page, answer)) { console.log(`[CountryLogic] ✓ Clicked label: "${answer}"`); return true; }
  const radios = await page.locator('input[type="radio"]').all();
  for (const radio of radios) {
    const id = await radio.getAttribute('id').catch(() => null);
    let labelText = '';
    if (id) labelText = (await page.locator(`label[for="${id}"]`).textContent().catch(() => '')) || '';
    if (!labelText) labelText = (await radio.locator('xpath=ancestor::label').textContent().catch(() => '')) || '';
    if (labelText.trim() === answer) { await clickRadioOption(page, radio); console.log(`[CountryLogic] ✓ Clicked radio: "${answer}"`); return true; }
  }
  for (const sel of await page.locator('select').all()) {
    try { await sel.selectOption({ label: answer }); console.log(`[CountryLogic] ✓ Selected dropdown: "${answer}"`); return true; } catch {}
  }
  console.warn(`[CountryLogic] ✗ Could not find option "${answer}" on page`);
  return false;
};

const matchStep = (step, questionsOnPage, pageNum) => {
  const { when_type, when_value } = step;
  if (when_type === 'always') return true;
  if (when_type === 'page_number') return parseInt(when_value) === pageNum;
  if (when_type === 'question_contains') {
    const normalize = (str) => (str || '').toLowerCase()
      .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    const needle = normalize(when_value);
    if (!needle) {
      console.warn(`[Scenario] ✗ Step skipped — when_value is empty/null`);
      return false;
    }
    const match = questionsOnPage.some(q => normalize(q).includes(needle));
    if (match) console.log(`[Scenario] ✓ Step matched: question contains "${when_value}"`);
    else console.log(`[Scenario] ✗ No match for "${when_value}" against: [${questionsOnPage.map(q => `"${q.slice(0,40)}"`).join(', ')}]`);
    return match;
  }
  if (when_type === 'question_position') return questionsOnPage.length >= parseInt(when_value || 1);
  return false;
};

const executeScenarioAction = async (page, step) => {
  const { action, action_values, action_mode, action_text, duration_s } = step;
  const vals = Array.isArray(action_values) ? action_values.map(v => parseInt(v)) : [];
  console.log(`[Scenario] Executing action: "${action}" with values: [${vals.join(',')}]`);
  try {
    if (action === 'skip') { console.log('[Scenario] Action: skip'); return []; }
    if (action === 'wait') {
      const secs = duration_s || 5;
      console.log(`[Scenario] Action: wait ${secs}s`);
      await page.waitForTimeout(secs * 1000);
      return [];
    }
    if (action === 'back') {
      const backBtn = page.locator('input[value="Back"], button:has-text("Back"), .back-button').first();
      await backBtn.click({ timeout: 5000 }).catch(() => {});
      return [];
    }
    if (action === 'open_end') {
      if (action_mode === 'specific' && action_text) {
        const fields = await page.locator("textarea, input[type='text']").all();
        for (const field of fields) {
          if (await field.isVisible().catch(() => false)) await field.fill(action_text).catch(() => {});
        }
        console.log(`[Scenario] Action: open_end → "${action_text.slice(0, 40)}"`);
        return [{ type: 'open-end', text: action_text }];
      }
      return null;
    }
    const getRadioGroups = async () => {
      const allRadios = await page.locator("input[type='radio']").all();
      const groupMap = {}; const groupOrder = [];
      for (const radio of allRadios) {
        const name = await radio.getAttribute('name').catch(() => null);
        if (!name) continue;
        if (!groupMap[name]) { groupMap[name] = []; groupOrder.push(name); }
        groupMap[name].push(radio);
      }
      console.log(`[Scenario] Found ${groupOrder.length} radio group(s) on page`);
      return { groupMap, groupOrder };
    };
    if (action === 'select_exact') {
      if (vals.length === 0) { console.warn('[Scenario] select_exact: no action_values configured — skipping'); return null; }
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) { console.warn('[Scenario] select_exact: no radio groups found'); return null; }
      const options = groupMap[groupOrder[0]];
      const targetIdx = (vals[0] || 1) - 1;
      if (targetIdx >= 0 && targetIdx < options.length) {
        await clickRadioOption(page, options[targetIdx]);
        await fillFollowupInput(page);
        console.log(`[Scenario] select_exact → clicked option ${targetIdx + 1} of ${options.length}`);
      } else {
        console.warn(`[Scenario] select_exact: option ${vals[0]} out of range (${options.length} options)`);
        return null;
      }
      return [{ type: 'radio', scenarioControlled: true }];
    }
    if (action === 'select_one_of') {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const valid = vals.filter(v => v >= 1 && v <= options.length);
      if (valid.length === 0) { console.warn(`[Scenario] select_one_of: no valid options from [${vals}]`); return null; }
      const chosen = valid[Math.floor(Math.random() * valid.length)];
      await clickRadioOption(page, options[chosen - 1]);
      await fillFollowupInput(page);
      console.log(`[Scenario] select_one_of → picked option ${chosen}`);
      return [{ type: 'radio', scenarioControlled: true }];
    }
    if (action === 'select_not_in') {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const excludeIdxs = new Set(vals.map(v => v - 1));
      const available = options.filter((_, i) => !excludeIdxs.has(i));
      if (available.length === 0) return null;
      const chosen = available[Math.floor(Math.random() * available.length)];
      await clickRadioOption(page, chosen);
      await fillFollowupInput(page);
      console.log(`[Scenario] select_not_in → picked from ${available.length} available`);
      return [{ type: 'radio', scenarioControlled: true }];
    }
    if (action === 'select_random') {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const idx = Math.floor(Math.random() * options.length);
      await clickRadioOption(page, options[idx]);
      await fillFollowupInput(page);
      console.log(`[Scenario] select_random → picked option ${idx + 1}`);
      return [{ type: 'radio', scenarioControlled: true }];
    }
    if (action === 'select_grid') {
      let rowSelections = [];
      try { rowSelections = JSON.parse(action_text || '[]'); } catch {}
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0 || rowSelections.length === 0) return null;
      for (let ri = 0; ri < rowSelections.length && ri < groupOrder.length; ri++) {
        const colIdx = (parseInt(rowSelections[ri].col) || 1) - 1;
        const options = groupMap[groupOrder[ri]];
        if (colIdx >= 0 && colIdx < options.length) await clickRadioOption(page, options[colIdx]);
      }
      console.log(`[Scenario] select_grid → ${rowSelections.length} row(s)`);
      return [{ type: 'grid', scenarioControlled: true }];
    }
    if (action === 'numeric_fill') {
      const min = parseFloat(vals[0] ?? 0);
      const max = parseFloat(vals[1] ?? 100);
      const roundTo = parseFloat(action_text) || 1;
      const inputs = await page.locator("input[type='number'], input[type='text'][class*='num'], input[class*='number']").all();
      const results = [];
      for (const input of inputs) {
        if (!await input.isVisible().catch(() => false)) continue;
        const raw = min + Math.random() * (max - min);
        const rounded = Math.round(raw / roundTo) * roundTo;
        await input.fill(String(rounded)).catch(() => {});
        results.push(rounded);
      }
      console.log(`[Scenario] numeric_fill → ${results.join(', ')}`);
      return [{ type: 'numeric', values: results, scenarioControlled: true }];
    }
  } catch (e) {
    console.warn(`[Scenario] Action "${action}" threw: ${e.message}`);
    return null;
  }
  return null;
};

const findMatchingStep = (scenario, questionsOnPage, pageNum) => {
  if (!scenario?.steps?.length) return null;
  console.log(`[Scenario] Checking ${scenario.steps.length} step(s) against page ${pageNum}, questions: [${questionsOnPage.map(q => q.slice(0,40)).join(' | ')}]`);
  for (const step of scenario.steps) {
    if (matchStep(step, questionsOnPage, pageNum)) return step;
  }
  console.log(`[Scenario] No step matched for page ${pageNum}`);
  return null;
};

// ─── Main session processor ───────────────────────────────────────────────────
const processSession = async (job) => {
  const {
    sessionId, projectId, personaId, surveyUrl,
    responseId, proxyProvider, proxyCountry, deviceType, scenarioIds,
    internalTesting,
  } = job.data;

  console.log(`[Worker] Session ${sessionId} | Country: ${proxyCountry} | ResponseID: ${responseId}`);

  await updateSessionStatus(sessionId, 'initialising');
  await logSessionEvent(sessionId, 'worker_started', { jobId: job.id, responseId });

  const persona = await getPersona(personaId);
  const readingSpeed = persona?.behavioural_attrs?.readingSpeed || 'normal';
  const deviceOs = persona?.behavioural_attrs?.deviceOs || 'windows';

  const countryLogic = await loadCountryLogic(projectId);
  const scenario = await loadSessionScenario(projectId, sessionId, scenarioIds);

  if (countryLogic) console.log(`[Worker] Country Logic active`);
  if (scenario) {
    await logSessionEvent(sessionId, 'scenario_assigned', {
      scenarioId: scenario.id, scenarioName: scenario.name, stepCount: scenario.steps?.length || 0,
    });
  } else {
    console.log(`[Worker] No scenario assigned — default random answering`);
  }

  const viewports = { desktop: { width: 1366, height: 768 }, mobile: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 } };
  const viewport = viewports[deviceType] || viewports.desktop;
  const userAgents = {
    'desktop-windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'desktop-macos':   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'mobile-android':  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'mobile-ios':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
  const uaKey = `${deviceType || 'desktop'}-${deviceOs.toLowerCase()}`;
  const userAgent = userAgents[uaKey] || userAgents['desktop-windows'];

  const proxySessionId = sessionId.slice(0, 8);
  const proxy = internalTesting
    ? null
    : await getProxyForSession(proxyProvider || 'decodo', { country: proxyCountry || null, sessionId: proxySessionId });

  if (internalTesting) console.log('[Proxy] INTERNAL TESTING — no proxy, using local IP');
  else if (proxy) console.log(`[Proxy] Server: ${proxy.server} | Country: ${proxyCountry || 'none'}`);
  else console.log('[Proxy] DIRECT — no proxy configured');

  const launchOptions = {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
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
    context = await browser.newContext({ viewport, userAgent, locale: 'en-US', timezoneId: 'Asia/Kolkata' });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver',  { get: () => undefined });
      Object.defineProperty(navigator, 'plugins',    { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages',  { get: () => ['en-US', 'en'] });
    });
    await context.tracing.start({ screenshots: true, snapshots: true, title: `Session ${sessionId}` });
    page = await context.newPage();

    // ── IP check ─────────────────────────────────────────────────────────────
    try {
      const ipRes = await page.goto('https://api.ipify.org?format=json', { timeout: 12000 });
      const ipData = await ipRes.json();
      if (ipData?.ip) {
        await recordUsedIP(projectId, sessionId, ipData.ip);
        await logSessionEvent(sessionId, 'ip_assigned', { ip: ipData.ip, country: proxyCountry });
        console.log(`[Worker] IP: ${ipData.ip} (requested: ${proxyCountry})`);
      }
    } catch (e) {
      await logSessionEvent(sessionId, 'ip_check_failed', { error: e.message });
    }

    await updateSessionStatus(sessionId, 'in_progress');
    // Store internal_testing flag and scenario name on session record
    await pool.query(
      `UPDATE sessions SET
         internal_testing = $1,
         scenario_name    = $2
       WHERE id = $3`,
      [!!internalTesting, scenario?.name || null, sessionId]
    ).catch(() => {});
    await logSessionEvent(sessionId, 'browser_launched', {
      proxy: internalTesting ? 'internal-testing' : proxy ? `decodo-${proxyCountry}` : 'direct',
      responseId, surveyUrl, scenarioName: scenario?.name || null,
    });

    console.log(`[Worker] Navigating to: ${surveyUrl}`);
    await page.goto(surveyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await logSessionEvent(sessionId, 'survey_loaded', { url: surveyUrl, responseId });

    // ── Main survey loop ──────────────────────────────────────────────────────
    while (pageCount < MAX_PAGES) {
      pageCount++;
      const currentUrl = page.url();
      const pageStart = Date.now();
      console.log(`\n[Worker] ── Page ${pageCount} ──────────────────────────────`);
      console.log(`[Worker] URL: ${currentUrl}`);

      // ── Stop check ─────────────────────────────────────────────────────────
      try {
        const statusCheck = await pool.query(`SELECT status, error_log FROM sessions WHERE id = $1`, [sessionId]);
        if (statusCheck.rows[0]?.status === 'error' && statusCheck.rows[0]?.error_log === 'Manually stopped by user') {
          console.log(`[Worker] Session manually stopped`); outcome = 'error'; break;
        }
      } catch {}

      // ── URL outcome check ──────────────────────────────────────────────────
      outcome = detectOutcome(currentUrl);
      if (outcome) { await logSessionEvent(sessionId, 'redirect_detected', { url: currentUrl, outcome }); break; }

      // ── Content exit page check ────────────────────────────────────────────
      const contentOutcome = await detectOutcomeFromPage(page);
      if (contentOutcome) {
        outcome = contentOutcome;
        const exitFilename = `page_${pageCount}.png`;
        await takeScreenshot(page, path.join(sessionScreenshotsDir, exitFilename));
        await logSessionEvent(sessionId, 'page_answered', {
          page: pageCount, url: currentUrl, title: await page.title().catch(() => 'Exit Page'),
          questions: [], options: [], answers: [], answerSummary: [],
          timeTaken: 0, screenshot: `${sessionId}/${exitFilename}`,
          isExitPage: true, exitOutcome: contentOutcome,
        });
        await logSessionEvent(sessionId, 'redirect_detected', { url: currentUrl, outcome, detectedBy: 'page_content', screenshot: `${sessionId}/${exitFilename}` });
        break;
      }

      // ── Detect questions on page ────────────────────────────────────────────
      let pageTitle = '';
      let questionsOnPage = [];
      try {
        pageTitle = await page.title();
        const rawTexts = await page.evaluate(() => {
          const selectors = ['.qtext', '.question-text', '.qtitle', '[class*="qtext"]', '[class*="question-title"]', 'legend', 'h2', 'h3'];
          const found = new Set();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(el => {
              const text = (el.innerText || el.textContent || '').trim();
              if (text) found.add(text);
            });
            if (found.size >= 8) break;
          }
          return [...found];
        });
        questionsOnPage = rawTexts
          .map(t => t.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
                     .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
                     .replace(/\s+/g, ' ').trim())
          .filter(t => !isHintText(t))
          .slice(0, 5);
        console.log(`[Worker] Questions detected: [${questionsOnPage.map(q => `"${q.slice(0,50)}"`).join(', ')}]`);
      } catch (e) {
        console.warn(`[Worker] Question detection failed: ${e.message}`);
      }

      // ── Screenshot before answering ────────────────────────────────────────
      const screenshotFilename = `page_${pageCount}.png`;
      const screenshotPath = path.join(sessionScreenshotsDir, screenshotFilename);
      await takeScreenshot(page, screenshotPath);

      const pageOptionsBefore = await capturePageOptions(page);

      // ── Answer logic ────────────────────────────────────────────────────────
      let answersGiven = null;
      let scenarioStepUsed = null;

      // Step 1: Country Logic (global, always runs first)
      if (countryLogic && questionsOnPage.length > 0) {
        const countryHandled = await applyCountryMapping(page, countryLogic, proxyCountry, questionsOnPage);
        if (countryHandled) {
          scenarioStepUsed = 'country_mapping';
          answersGiven = [{ type: 'country_mapping', country: proxyCountry }];
          questionCount++;
          const cm = countryLogic.country_mapping;
          const waitMin = parseInt(cm.waitMinS) || 0;
          const waitMax = parseInt(cm.waitMaxS) || waitMin;
          if (waitMin > 0 || waitMax > 0) {
            const waitMs = (waitMin + Math.random() * (waitMax - waitMin)) * 1000;
            console.log(`[CountryLogic] Waiting ${Math.round(waitMs/1000)}s after country answer (range: ${waitMin}-${waitMax}s)`);
            await page.waitForTimeout(waitMs);
          }
          console.log(`[Worker] Page ${pageCount}: country mapping applied`);
        }
      }

      // Step 2: Scenario steps
      if (answersGiven === null && scenario && questionsOnPage.length > 0) {
        const matchedStep = findMatchingStep(scenario, questionsOnPage, pageCount);
        if (matchedStep) {
          scenarioStepUsed = matchedStep.action;
          answersGiven = await executeScenarioAction(page, matchedStep);
          if (answersGiven !== null) {
            questionCount++;
            const waitMin = parseInt(matchedStep.wait_min_s) || 0;
            const waitMax = parseInt(matchedStep.wait_max_s) || waitMin;
            if (waitMin > 0 || waitMax > 0) {
              const waitMs = (waitMin + Math.random() * (waitMax - waitMin)) * 1000;
              console.log(`[Scenario] Waiting ${Math.round(waitMs/1000)}s (range: ${waitMin}-${waitMax}s)`);
              await page.waitForTimeout(waitMs);
            }
            console.log(`[Worker] Page ${pageCount}: scenario step "${matchedStep.action}" executed`);
          } else {
            console.log(`[Worker] Page ${pageCount}: scenario action returned null — falling through to default`);
          }
        }
      }

      // Step 3: Default random answering
      if (answersGiven === null) {
        console.log(`[Worker] Page ${pageCount}: using default random answering`);
        answersGiven = await answerPage(page, persona, readingSpeed);
        questionCount++;
      }

      // Step 4: Fill any remaining unfilled inputs/selects on the page
      // This catches: grid numeric inputs, standalone inputs, dropdowns
      // that answerPage or scenario actions didn't cover (Images 3-7)
      await fillRemainingInputs(page);

      await page.waitForTimeout(800);
      const pageOptionsAfter = await capturePageOptions(page);
      const gridAnswers = await captureGridAnswers(page);

      // Screenshot after answering (captures all filled states)
      await takeScreenshot(page, screenshotPath);

      const pageTime = Math.round((Date.now() - pageStart) / 1000);
      const answerSummary = buildAnswerSummary(pageOptionsAfter, answersGiven);

      pages.push({
        pageNum: pageCount, url: currentUrl, title: pageTitle,
        questions: questionsOnPage, options: pageOptionsAfter,
        answers: answersGiven, answerSummary, timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
        scenarioStep: scenarioStepUsed || null,
        gridAnswers: gridAnswers.length > 0 ? gridAnswers : undefined,
      });

      await logSessionEvent(sessionId, 'page_answered', {
        page: pageCount, url: currentUrl, title: pageTitle,
        questions: questionsOnPage, options: pageOptionsAfter,
        answers: answersGiven, answerSummary, timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
        scenarioStep: scenarioStepUsed || null,
        gridAnswers: gridAnswers.length > 0 ? gridAnswers : undefined,
      });

      // ── Click next ────────────────────────────────────────────────────────
      const clicked = await clickNext(page);
      if (!clicked) {
        const noNextOutcome = await detectOutcomeFromPage(page);
        outcome = noNextOutcome || detectOutcome(page.url()) || 'completed';
        console.log(`[Worker] No next button — outcome: ${outcome}`);
        break;
      }

      try {
        await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' });
      } catch {
        await page.waitForTimeout(3000);
      }

      const newUrl = page.url();
      outcome = detectOutcome(newUrl);
      if (!outcome) { await page.waitForTimeout(1500); outcome = await detectOutcomeFromPage(page); }

      if (outcome) {
        const finalNum = pageCount + 1;
        const finalFilename = `page_${finalNum}.png`;
        const finalPath = path.join(sessionScreenshotsDir, finalFilename);
        await takeScreenshot(page, finalPath);
        await logSessionEvent(sessionId, 'page_answered', {
          page: finalNum, url: newUrl, title: await page.title().catch(() => 'Exit Page'),
          questions: [], options: [], answers: [], answerSummary: [],
          timeTaken: 0, screenshot: `${sessionId}/${finalFilename}`,
          isExitPage: true, exitOutcome: outcome,
        });
        await logSessionEvent(sessionId, 'redirect_detected', { url: newUrl, outcome, screenshot: `${sessionId}/${finalFilename}` });
        break;
      }
    }

    if (!outcome) outcome = pageCount >= MAX_PAGES ? 'error' : 'completed';
  } catch (err) {
    outcome = 'error';
    errorMessage = err?.stack || err?.message || String(err);
    await logSessionEvent(sessionId, 'error', { message: err?.message, stack: err?.stack });
    console.error(`[Worker] Session ${sessionId} error:`, err.message);
  } finally {
    try { if (context) { await context.tracing.stop({ path: tracePath }); await saveTracePath(sessionId, tracePath); } } catch {}
    try { await browser?.close(); } catch {}
  }

  const durationS = Math.round((Date.now() - startTime) / 1000);
  await updateSessionStatus(sessionId, outcome, {
    outcome, totalDurationS: durationS, questionCount, redirectType: outcome,
    ...(errorMessage ? { errorLog: errorMessage.slice(0, 2000) } : {}),
  });
  await logSessionEvent(sessionId, 'session_complete', {
    outcome, durationS, pageCount, questionCount, responseId,
    screenshotsCount: pages.length, scenarioName: scenario?.name || null,
  });
  console.log(`[Worker] Session ${sessionId} → ${outcome} | ${durationS}s | ${pageCount} pages | scenario: ${scenario?.name || 'none'}`);
  return { sessionId, outcome, durationS, responseId };
};

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker('survey-sessions', processSession, { connection, concurrency: CONCURRENCY });
worker.on('completed', (job, result) => console.log(`[Worker] Job ${job.id} done — ${result.outcome}`));
worker.on('failed',    (job, err)    => console.error(`[Worker] Job ${job.id} failed:`, err.message));
worker.on('error',     (err)         => console.error('[Worker] Error:', err));
process.on('SIGTERM', async () => { await worker.close(); process.exit(0); });
console.log('[Worker] Ready and listening for jobs...');