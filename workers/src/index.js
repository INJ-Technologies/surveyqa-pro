"use strict";
const { Worker } = require("bullmq");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const readSecret = (name) => {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, 'utf8').trim();
  } catch {
    return null;
  }
};

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
const MAX_PAGES = 200;
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

      // Skip spec boxes whose parent radio option was NOT selected
      // Decipher renders all spec boxes but only the selected option's box should be filled
      const isOrphanSpecBox = await input.evaluate(el => {
        let node = el.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!node) break;
          // If this input is inside a radio option container, check if that radio is checked
          const radio = node.querySelector('input[type="radio"]');
          if (radio) return !radio.checked;
          node = node.parentElement;
        }
        return false; // Not inside a radio container — fill it normally
      }).catch(() => false);
      if (isOrphanSpecBox) continue;

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

    // Returns true if a radio option's container has a follow-up text/number input or textarea
    // Used to deprioritise options like "Other (please specify)" that require extra typing
    const hasFollowupField = async (radio) => {
      try {
        return await radio.evaluate(el => {
          let node = el.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!node) break;
            if (node.querySelector('input[type="text"], input[type="number"], textarea')) return true;
            // Stop walking up if this container holds multiple radios (we've left the option scope)
            if (node.querySelectorAll('input[type="radio"]').length > 1) break;
            node = node.parentElement;
          }
          return false;
        });
      } catch {
        return false;
      }
    };

    // Partition radio options into clean (no follow-up) and with-followup
    // Returns clean options first, followup options as fallback
    const partitionByFollowup = async (options) => {
      const clean = [], withFollowup = [];
      for (let i = 0; i < options.length; i++) {
        const hasField = await hasFollowupField(options[i]);
        if (hasField) withFollowup.push(i);
        else clean.push(i);
      }
      return { clean, withFollowup };
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

      // Prefer options without follow-up input fields
      const { clean } = await partitionByFollowup(valid.map(v => options[v - 1]));
      const preferredIndices = clean.length > 0
        ? clean.map(ci => valid[ci])   // indices into valid[] that are clean
        : valid;
      const chosen = preferredIndices[Math.floor(Math.random() * preferredIndices.length)];
      await clickRadioOption(page, options[chosen - 1]);
      await fillFollowupInput(page);
      console.log(`[Scenario] select_one_of → picked option ${chosen}${clean.length > 0 && clean.length < valid.length ? ' (preferred no-followup)' : ''}`);
      return [{ type: 'radio', scenarioControlled: true }];
    }
    if (action === 'select_not_in') {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const excludeIdxs = new Set(vals.map(v => v - 1));
      const available = options.filter((_, i) => !excludeIdxs.has(i));
      if (available.length === 0) return null;

      // Prefer options without follow-up input fields
      const { clean, withFollowup } = await partitionByFollowup(available);
      const candidatePool = clean.length > 0 ? clean.map(ci => available[ci]) : available;
      const chosen = candidatePool[Math.floor(Math.random() * candidatePool.length)];
      await clickRadioOption(page, chosen);
      await fillFollowupInput(page);
      console.log(`[Scenario] select_not_in → picked from ${available.length} available${clean.length > 0 && withFollowup.length > 0 ? ` (${withFollowup.length} follow-up options deprioritised)` : ''}`);
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
      const midpoint = (min + max) / 2;

      // Strategy 1: Direct numeric inputs (no radio involved)
      const strictInputs = await page.locator("input[type='number']").all();
      const visibleStrict = [];
      for (const inp of strictInputs) {
        if (await inp.isVisible().catch(() => false)) visibleStrict.push(inp);
      }
      if (visibleStrict.length > 0) {
        const results = [];
        for (const inp of visibleStrict) {
          const raw = min + Math.random() * (max - min);
          const rounded = Math.round(raw / roundTo) * roundTo;
          await inp.fill(String(rounded)).catch(() => {});
          results.push(rounded);
        }
        console.log(`[Scenario] numeric_fill → ${results.join(', ')}`);
        return [{ type: 'numeric', values: results, scenarioControlled: true }];
      }

      // Strategy 2: Radio + spec box pattern (Decipher style)
      // Find the radio option whose label range best contains our target value
      const allRadios = await page.locator('input[type="radio"]').all();
      const groupMap = {}; const groupOrder = [];
      for (const r of allRadios) {
        const name = await r.getAttribute('name').catch(() => null);
        if (!name) continue;
        if (!groupMap[name]) { groupMap[name] = []; groupOrder.push(name); }
        groupMap[name].push(r);
      }

      if (groupOrder.length > 0) {
        const options = groupMap[groupOrder[0]];
        let bestRadio = null;
        let bestIdx = -1;
        let fallbackRadio = null;
        let fallbackIdx = Math.floor(options.length / 2); // middle option as fallback

        for (let i = 0; i < options.length; i++) {
          const radio = options[i];
          const id = await radio.getAttribute('id').catch(() => null);
          let labelText = '';
          if (id) labelText = (await page.locator(`label[for="${id}"]`).textContent().catch(() => '')) || '';
          if (!labelText) labelText = (await radio.locator('xpath=ancestor::label').textContent().catch(() => '')) || '';

          const hasMillion = /\b(million|mn)\b/i.test(labelText);
          const hasBillion = /\b(billion|bn)\b/i.test(labelText);
          const hasThousand = /\b(thousand|,000|k)\b/i.test(labelText);

          // Parse range from label
          const range = extractRange(labelText, hasMillion || hasBillion);

          if (range) {
            const rangeMin = range.min;
            const rangeMax = range.max;
            if (midpoint >= rangeMin && midpoint <= rangeMax) {
              bestRadio = radio; bestIdx = i; break;
            }
          }

          // Handle "Less than X" — target value < X
          if (/less than|under|below/i.test(labelText)) {
            const nums = labelText.match(/[\d,.]+/g);
            if (nums) {
              let threshold = parseNum(nums[0], hasMillion || hasBillion);
              if (threshold && midpoint < threshold) {
                if (!bestRadio) { bestRadio = radio; bestIdx = i; }
              }
            }
          }

          // Handle "Over X / More than X" — target value > X
          if (/over|more than|greater than|above/i.test(labelText)) {
            const nums = labelText.match(/[\d,.]+/g);
            if (nums) {
              let threshold = parseNum(nums[0], hasMillion || hasBillion);
              if (threshold && midpoint > threshold) {
                fallbackRadio = radio; fallbackIdx = i; // keep as candidate but don't break
              }
            }
          }
        }

        // Pick best match, then fallback, then middle
        const chosenRadio = bestRadio || fallbackRadio || options[fallbackIdx];
        const chosenIdx   = bestRadio ? bestIdx : (fallbackRadio ? fallbackIdx : Math.floor(options.length / 2));

        if (chosenRadio) {
          await clickRadioOption(page, chosenRadio);
          await fillFollowupInput(page); // handles the revealed spec input
          console.log(`[Scenario] numeric_fill → clicked radio option ${chosenIdx + 1} (range target: ${min}–${max}), spec box filled by followup handler`);
          return [{ type: 'numeric', values: [Math.round(midpoint)], scenarioControlled: true }];
        }
      }

      // Strategy 3: Last resort — all visible plain text inputs
      const allTextInputs = await page.locator("input[type='text']").all();
      const results = [];
      for (const inp of allTextInputs) {
        if (!await inp.isVisible().catch(() => false)) continue;
        const existing = await inp.inputValue().catch(() => '');
        if (existing && existing.trim() !== '') continue;
        const raw = min + Math.random() * (max - min);
        const rounded = Math.round(raw / roundTo) * roundTo;
        await inp.fill(String(rounded)).catch(() => {});
        results.push(rounded);
      }
      if (results.length > 0) console.log(`[Scenario] numeric_fill (fallback text) → ${results.join(', ')}`);
      else console.warn('[Scenario] numeric_fill: no inputs found on page');
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

// ══════════════════════════════════════════════════════════════════════════════
// AI ANSWER ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const buildPersonaContext = (persona) => {
  if (!persona) return 'You are a typical senior professional respondent. Be realistic and consistent.';
  const attrs = persona.behavioural_attrs || {};
  const lines = ['YOU ARE THIS PERSON — answer every question as them:'];
  if (persona.name)           lines.push(`Name: ${persona.name}`);
  if (persona.description)    lines.push(`Bio: ${persona.description}`);
  if (persona.country)        lines.push(`Country: ${persona.country}`);
  if (persona.language)       lines.push(`Language: ${persona.language}`);
  if (persona.gender)         lines.push(`Gender: ${persona.gender}`);
  if (persona.age_min && persona.age_max)
                              lines.push(`Age: ${persona.age_min}–${persona.age_max}`);
  else if (persona.age_min)   lines.push(`Age: ${persona.age_min}+`);
  if (persona.device_type)    lines.push(`Device: ${persona.device_type}`);
  if (attrs.designation)      lines.push(`Job Title / Designation: ${attrs.designation}`);
  if (attrs.department)       lines.push(`Department: ${attrs.department}`);
  if (attrs.industry)         lines.push(`Industry: ${attrs.industry}`);
  if (attrs.companyRevenue)   lines.push(`Company Revenue: ${attrs.companyRevenue}`);
  if (attrs.employeeSize)     lines.push(`Company Size (employees): ${attrs.employeeSize}`);
  if (attrs.readingSpeed)     lines.push(`Reading Speed: ${attrs.readingSpeed}`);
  if (attrs.responseStyle)    lines.push(`Response Style: ${attrs.responseStyle}`);
  if (attrs.deviceOs)         lines.push(`Device OS: ${attrs.deviceOs}`);
  if (attrs.browser)          lines.push(`Browser: ${attrs.browser}`);
  if (attrs.behaviouralTags?.length > 0)
                              lines.push(`Behavioural Profile: ${attrs.behaviouralTags.join(', ')}`);
  if (attrs.secondaryDescription) {
    lines.push('');
    lines.push('FULL PERSONA DESCRIPTION (treat this as your character brief):');
    lines.push(attrs.secondaryDescription);
  }
  return lines.join('\n');
};

const buildScenarioContext = (scenario) => {
  if (!scenario || scenario.name === 'Country Logic') return '';
  const lines = ['SCENARIO DIRECTIVE (steer your answers toward this goal):'];
  if (scenario.name)             lines.push(`Scenario: ${scenario.name}`);
  if (scenario.description)      lines.push(`Goal: ${scenario.description}`);
  if (scenario.expected_outcome) lines.push(`Expected outcome: ${scenario.expected_outcome}`);
  return lines.length > 1 ? lines.join('\n') : '';
};

const captureAllPageFields = async (page) => {
  try {
    return await page.evaluate(() => {
      const fields = [];

      // ── Radio groups ─────────────────────────────────────────────────────
      const radioGroups = {}; const radioOrder = [];
      document.querySelectorAll('input[type="radio"]').forEach(r => {
        if (!r.offsetParent || !r.name) return;
        if (!radioGroups[r.name]) { radioGroups[r.name] = []; radioOrder.push(r.name); }
        let label = '';
        if (r.id) { const lbl = document.querySelector(`label[for="${r.id}"]`); if (lbl) label = (lbl.innerText || '').trim(); }
        if (!label) { const pl = r.closest('label'); if (pl) label = (pl.innerText || '').trim(); }
        radioGroups[r.name].push({ label, checked: r.checked });
      });
      radioOrder.forEach((name, gi) => {
        const firstRadio = document.querySelectorAll(`input[type="radio"][name="${name}"]`)[0];
        let questionLabel = '';
        const qblock = firstRadio?.closest('.qblock, .question, [class*="qblock"]');
        if (qblock) { const qt = qblock.querySelector('.qtext, .question-text, legend, h2, h3'); if (qt) questionLabel = (qt.innerText || '').trim().slice(0, 150); }
        fields.push({ fieldType: 'radio', groupIndex: gi, groupName: name, questionLabel, options: radioGroups[name].map(r => r.label) });
      });

      // ── Checkbox groups ───────────────────────────────────────────────────
      const cbGroups = {}; const cbOrder = [];
      document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (!cb.offsetParent) return;
        const name = cb.name || cb.closest('fieldset')?.id || 'cb_group';
        if (!cbGroups[name]) { cbGroups[name] = []; cbOrder.push(name); }
        let label = '';
        if (cb.id) { const lbl = document.querySelector(`label[for="${cb.id}"]`); if (lbl) label = (lbl.innerText || '').trim(); }
        if (!label) { const pl = cb.closest('label'); if (pl) label = (pl.innerText || '').trim(); }
        cbGroups[name].push({ label, checked: cb.checked });
      });
      cbOrder.forEach((name, gi) => {
        let questionLabel = '';
        const firstCb = document.querySelector(`input[type="checkbox"][name="${name}"]`);
        const qblock = firstCb?.closest('.qblock, .question, [class*="qblock"]');
        if (qblock) { const qt = qblock.querySelector('.qtext, .question-text, legend, h2, h3'); if (qt) questionLabel = (qt.innerText || '').trim().slice(0, 150); }
        fields.push({ fieldType: 'checkbox', groupIndex: gi, groupName: name, questionLabel, options: cbGroups[name].map(c => c.label) });
      });

      // ── Select dropdowns ──────────────────────────────────────────────────
      let selIdx = 0;
      document.querySelectorAll('select').forEach(sel => {
        if (!sel.offsetParent) return;
        const currentText = sel.options[sel.selectedIndex]?.text || '';
        const isPlaceholder = !sel.value || sel.value === '' || /^(select one|--|please select|choose)/i.test(currentText);
        if (!isPlaceholder) { selIdx++; return; }
        let questionLabel = '';
        const qblock = sel.closest('.qblock, .question, [class*="qblock"]');
        if (qblock) { const qt = qblock.querySelector('.qtext, .question-text, legend, h2, h3'); if (qt) questionLabel = (qt.innerText || '').trim().slice(0, 150); }
        const opts = Array.from(sel.options).filter(o => o.value && o.value !== '' && !/^(select one|--|please select)/i.test(o.text)).map(o => ({ value: o.value, label: o.text.trim() }));
        fields.push({ fieldType: 'select', selectIndex: selIdx, questionLabel, options: opts });
        selIdx++;
      });

      // ── Textarea open-ends ────────────────────────────────────────────────
      let taIdx = 0;
      document.querySelectorAll('textarea').forEach(ta => {
        if (!ta.offsetParent) return;
        if (ta.value && ta.value.trim() !== '') { taIdx++; return; }
        let questionLabel = '';
        const qblock = ta.closest('.qblock, .question, [class*="qblock"]');
        if (qblock) { const qt = qblock.querySelector('.qtext, .question-text, legend, h2, h3'); if (qt) questionLabel = (qt.innerText || '').trim().slice(0, 200); }
        if (!questionLabel) { let node = ta.parentElement; for (let i = 0; i < 6; i++) { const t = (node?.innerText || '').trim(); if (t.length > 8 && t.length < 300) { questionLabel = t.slice(0, 200); break; } node = node?.parentElement; } }
        fields.push({ fieldType: 'textarea', textareaIndex: taIdx, questionLabel, placeholder: ta.placeholder || '' });
        taIdx++;
      });

      // ── Numeric / text inputs ─────────────────────────────────────────────
      let inpIdx = 0;
      document.querySelectorAll("input[type='text'], input[type='number']").forEach(inp => {
        if (!inp.offsetParent) return;
        if (inp.value && inp.value.trim() !== '') { inpIdx++; return; }
        let unitLabel = '';
        const parent = inp.parentElement;
        if (parent) { Array.from(parent.childNodes).forEach(sib => { if (sib === inp) return; const t = (sib.textContent || '').trim(); if (t && t.length < 20) unitLabel = t; }); }
        let rowLabel = '', columnHeader = '';
        const td = inp.closest('td');
        if (td) {
          const tr = td.closest('tr'); const table = td.closest('table');
          if (tr && table) {
            const allCells = Array.from(tr.querySelectorAll('td, th')); const colIdx = allCells.indexOf(td);
            const headerRow = table.querySelector('thead tr, tr:first-child');
            if (headerRow) { const headers = Array.from(headerRow.querySelectorAll('th, td')); if (headers[colIdx]) columnHeader = (headers[colIdx].innerText || '').trim().slice(0, 60); }
            for (const cell of allCells) { if (!cell.querySelector('input')) { const t = (cell.innerText || '').trim(); if (t) { rowLabel = t.slice(0, 80); break; } } }
          }
        }
        let contextText = '';
        let node = inp.parentElement;
        for (let i = 0; i < 8; i++) { const t = (node?.innerText || '').trim(); if (t.length > 8 && t.length < 400) { contextText = t.slice(0, 200); break; } node = node?.parentElement; }
        fields.push({ fieldType: 'input', inputIndex: inpIdx, rowLabel, columnHeader, unitLabel, contextText, placeholder: inp.placeholder || '', min: inp.min || null, max: inp.max || null });
        inpIdx++;
      });

      return fields;
    });
  } catch (e) { console.warn('[AI] captureAllPageFields error:', e.message); return []; }
};

const formatFieldsForPrompt = (fields) => {
  if (!fields || fields.length === 0) return 'None — this may be an intro or transition page.';
  return fields.map((f, i) => {
    switch (f.fieldType) {
      case 'radio': {
        const opts = f.options.map((o, idx) => `  [${idx}] ${o || '(unlabelled)'}`).join('\n');
        return `[${i}] RADIO — "${f.questionLabel || 'question'}"\n${opts}`;
      }
      case 'checkbox': {
        const opts = f.options.map((o, idx) => `  [${idx}] ${o || '(unlabelled)'}`).join('\n');
        return `[${i}] CHECKBOX (select 1–4 that make sense together) — "${f.questionLabel || 'question'}"\n${opts}`;
      }
      case 'select': {
        const opts = f.options.map((o, idx) => `  [${idx}] ${o.label}`).join('\n');
        return `[${i}] DROPDOWN — "${f.questionLabel || 'question'}"\n${opts}`;
      }
      case 'textarea':
        return `[${i}] OPEN-END TEXT — "${f.questionLabel || f.placeholder || 'open response'}"`;
      case 'input': {
        const parts = [];
        if (f.rowLabel)     parts.push(`row: "${f.rowLabel}"`);
        if (f.columnHeader) parts.push(`column: "${f.columnHeader}"`);
        if (f.unitLabel)    parts.push(`unit: "${f.unitLabel}"`);
        if (f.min || f.max) parts.push(`range: ${f.min ?? '?'}–${f.max ?? '?'}`);
        const meta = parts.length > 0 ? ` [${parts.join(', ')}]` : '';
        return `[${i}] NUMERIC INPUT${meta} — context: "${f.contextText?.slice(0, 100) || f.placeholder || 'numeric field'}"`;
      }
      default: return `[${i}] UNKNOWN FIELD`;
    }
  }).join('\n\n');
};

const answerPageWithAI = async (page, persona, scenario, factSheet, intentMap, quotaCellText, questionsOnPage, pageOptions, ANTHROPIC_API_KEY) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      console.warn('[AI] No API key — falling back to random');
      return null;
    }

    const allFields = await captureAllPageFields(page);
    const actionableFields = allFields.filter(f =>
      ['radio', 'checkbox', 'select', 'textarea', 'input'].includes(f.fieldType)
    );
    if (actionableFields.length === 0) {
      console.log('[AI] No actionable fields');
      return null;
    }

    const personaContext  = buildPersonaContext(persona);
    const scenarioContext = buildScenarioContext(scenario);

    // ── Format semantic fact sheet (no pageHistory) ────────────────────────
    const factSheetLines = [];
    for (const [k, v] of Object.entries(factSheet || {})) {
      if (k === 'pageHistory') continue; // handled separately below
      if (v === null || v === undefined) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        const inner = Object.entries(v)
          .filter(([, iv]) => iv !== null && (Array.isArray(iv) ? iv.length > 0 : true))
          .map(([ik, iv]) => `  ${ik}: ${Array.isArray(iv) ? iv.join(', ') : JSON.stringify(iv)}`);
        if (inner.length) factSheetLines.push(`${k}:\n${inner.join('\n')}`);
      } else {
        factSheetLines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
      }
    }
    const factSheetText = factSheetLines.join('\n') || 'No committed facts yet — establish baseline from persona.';

    // ── Full Q&A history for cross-referencing ────────────────────────────
    const pageHistory = factSheet?.pageHistory || [];
    const fullHistoryText = pageHistory.length > 0
      ? pageHistory.map((h, i) =>
          `  [Page ${h.page}] "${h.question.slice(0, 120)}" → "${h.answer.slice(0, 150)}"`
        ).join('\n')
      : '  No prior answers yet — this is the first answerable page.';

    // ── Match intents for this page ────────────────────────────────────────
    const normalize = s => (s || '').toLowerCase().trim();
    const pageTextLower = questionsOnPage.map(normalize).join(' ');

    const matchIntent = (intent) => {
      if (!intent.when_value && intent.when_type !== 'always') return false;
      if (intent.when_type === 'always') return true;
      if (intent.when_type === 'page_number') return false;
      return pageTextLower.includes(normalize(intent.when_value));
    };

    const matchingInstructions = (intentMap?.instructions || []).filter(matchIntent);
    const intentConstraintsText = matchingInstructions.length > 0
      ? matchingInstructions.map(i =>
          `• WHEN "${i.when_value}": ${i.naturalInstruction}`
        ).join('\n')
      : 'No specific scenario constraints for this page — answer naturally as this persona while staying consistent with all prior answers.';

    // ── Web search for open-end / numeric fields ──────────────────────────────
    let webSearchContext = '';
    const flags = [];
    // Only search when question genuinely needs factual/benchmark data
    const needsWebSearch = actionableFields.some(f => f.fieldType === 'textarea' || f.fieldType === 'input') &&
      questionsOnPage.some(q => /revenue|budget|spend|growth|percent|employee|headcount|market|cost|price|salary|benchmark/i.test(q));

    if (needsWebSearch) {
      const hasOpenOrNumeric = true; // alias for flag below
      flags.push('web_search_used');
      try {
        const attrs = persona?.behavioural_attrs || {};
        const industry = attrs.industry || 'enterprise';
        const searchPrompt = `Find current benchmarks and realistic figures for answering these survey questions. Persona: ${attrs.designation || 'senior executive'} in ${industry}, large enterprise, USA. Questions: ${questionsOnPage.join('. ')}. Provide specific numbers, percentages, dollar amounts relevant to this context.`;

        const searchRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 500,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages: [{ role: 'user', content: searchPrompt }],
          }),
        });
        const searchData = await searchRes.json();
        const textBlocks = (searchData.content || []).filter(b => b.type === 'text');
        webSearchContext = textBlocks.map(b => b.text).join('\n').slice(0, 600);
        if (webSearchContext) console.log(`[AI] Web search context: ${webSearchContext.length} chars`);
      } catch (e) {
        console.warn('[AI] Web search error:', e.message);
      }
    }

    const systemPrompt =
      `You are simulating a real human survey respondent with a consistent life story. ` +
      `Your answers must be realistic, internally coherent, and NEVER contradict the session fact sheet. ` +
      `You respond ONLY with valid JSON — no markdown, no explanation outside JSON.`;

const userPrompt =
`═══════════════════════════════════════════════
PERSONA — YOU ARE THIS PERSON
═══════════════════════════════════════════════
${personaContext}

═══════════════════════════════════════════════
QUOTA CELL YOU ARE FILLING
═══════════════════════════════════════════════
${quotaCellText}
Your screener answers MUST qualify for this demographic cell.

${scenarioContext ? `═══════════════════════════════════════════════\n${scenarioContext}\n═══════════════════════════════════════════════\n` : ''}
═══════════════════════════════════════════════
SCENARIO & ROUTING CONSTRAINTS FOR THIS PAGE
═══════════════════════════════════════════════
${intentConstraintsText}

═══════════════════════════════════════════════
SEMANTIC FACT SHEET — NEVER CONTRADICT THESE
═══════════════════════════════════════════════
These are structured facts extracted from everything you have answered so far.
Every new answer MUST be logically consistent with these committed facts.

${factSheetText}

═══════════════════════════════════════════════
FULL ANSWER HISTORY — ALL PRIOR Q&A (USE FOR CROSS-REFERENCING)
═══════════════════════════════════════════════
Before answering ANY question on this page, scan this list.
If a new question relates to ANY prior answer — budgets, headcount, AI adoption,
vendors, revenue, job role, plans — your answer MUST be logically consistent.
Example: If Page 5 says you have 75,000+ employees, budget questions must scale accordingly.
Example: If Page 8 says revenue is $500M–$1B, departmental budget cannot exceed that.
Example: If Page 11 says AI adoption is "evaluating/planning", you cannot claim AI revenue on Page 15.

${fullHistoryText}

${webSearchContext ? `═══════════════════════════════════════════════\nWEB SEARCH — USE THESE FIGURES FOR REALISM\n═══════════════════════════════════════════════\n${webSearchContext}\n` : ''}
═══════════════════════════════════════════════
QUESTIONS ON THIS PAGE
═══════════════════════════════════════════════
${questionsOnPage.length > 0 ? questionsOnPage.map((q, i) => `${i + 1}. ${q}`).join('\n') : '(No question text detected — may be intro or transition page)'}

═══════════════════════════════════════════════
FIELDS TO FILL
═══════════════════════════════════════════════
${formatFieldsForPrompt(actionableFields)}

═══════════════════════════════════════════════
RULES — FOLLOW IN THIS EXACT ORDER OF PRIORITY
═══════════════════════════════════════════════
1. SCENARIO CONSTRAINTS FIRST — If a constraint above matches this page, follow it exactly.
   For COUNTRY LOGIC instructions, find the option label and select it by label not position.
   For SELECT_EXACT, select that exact option index (convert 1-based to 0-based).
   For SELECT_ONE_OF, pick the option from the list that best fits the persona.
   For SELECT_NOT_IN, avoid those indices and pick the best remaining option for persona.

2. CROSS-REFERENCE ALL PRIOR ANSWERS — Before answering, read the FULL ANSWER HISTORY above.
   Any answer touching budget, headcount, technology, revenue, AI, vendors, or role
   must be checked against ALL relevant prior answers — not just the last few.
   If Q3 said "planning to adopt AI", Q15 cannot say "generating revenue from AI."
   If Q7 said "10,000 employees", Q12 budget must match that scale.

3. FACT SHEET CONSISTENCY — Answers must not contradict the semantic facts above.
   If a contradiction is unavoidable, resolve toward the MOST RECENTLY COMMITTED fact.

4. QUOTA CELL — All screener answers must qualify for your assigned demographic cell.

5. PERSONA REALISM — Answers must be credible for this specific person in this role/industry.

6. NUMERICS — Use web search figures. Ensure all numbers are internally consistent:
   Sub-totals ≤ totals, percentages sum correctly, employee counts match company size.
   Radio + spec box: select the range whose midpoint is closest to your target value.

7. OPEN-ENDS — 1–3 sentences. Sound like a real ${persona?.behavioural_attrs?.designation || 'professional'}.
   Active or passive voice, varied sentence structure. Reference prior answers naturally.
   Never sound AI-generated. Be specific to your industry and the exact question asked.

8. BRANDS — Only select brands this persona would genuinely know in their industry.
   Never select implausible or unknown brand names — they may be phantom/fake brands.

9. ATTENTION CHECKS — If question text says "select option X" or "type the word Y",
   follow that instruction literally regardless of everything else.

10. AVOID "Don't know" / "Prefer not to say" / "Other (please specify)" unless
    genuinely unavoidable for this persona. Prefer clean options with no follow-up input.

═══════════════════════════════════════════════
RETURN ONLY THIS JSON — NO MARKDOWN, NO EXPLANATION
═══════════════════════════════════════════════
{
  "crossReferenceCheck": "prior answers checked and consistency confirmed, or 'no conflicts'",
  "contradictionCheck": "fact sheet conflicts and resolution, or 'none'",
  "intentApplied": "scenario constraint applied, or 'none — persona-driven'",
  "reasoning": "one sentence approach for this page",
  "newFacts": {
    "any_new_key": "value extracted from answers given on this page — snake_case keys only",
    "committed_numbers.budget_total": 5000000
  },
  "answers": [
    { "fieldIndex": 0, "fieldType": "radio",    "selectedIndex": 2 },
    { "fieldIndex": 1, "fieldType": "checkbox",  "selectedIndices": [0, 2] },
    { "fieldIndex": 2, "fieldType": "select",    "selectedIndex": 1 },
    { "fieldIndex": 3, "fieldType": "textarea",  "text": "Natural professional response..." },
    { "fieldIndex": 4, "fieldType": "input",     "value": "15000" }
  ]
}
Every field above MUST appear in answers array. newFacts may be {} if nothing new to extract.`;

// ── Retry wrapper with exponential backoff for rate limits ────────────
    const callWithRetry = async (body, maxRetries = 4) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });

        if (res.ok) return res;

        if (res.status === 429 || res.status === 529) {
          const retryAfter = parseInt(res.headers?.get?.('retry-after') || '0');

          // If Anthropic says wait more than 30s, don't retry — go straight to fallback
          // This prevents 7-10 minute page freezes on free tier
          if (retryAfter > 60) {
            console.warn(`[AI] Rate limited — retry-after ${retryAfter}s is too long, falling back immediately`);
            return null;
          }

          const waitMs = retryAfter > 0
            ? retryAfter * 1000
            : Math.min(1000 * Math.pow(2, attempt), 30000); // 2s, 4s, 8s, 16s, max 30s
          console.warn(`[AI] Rate limited (${res.status}) — attempt ${attempt}/${maxRetries}, waiting ${Math.round(waitMs/1000)}s`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        // Non-retryable error
        console.warn(`[AI] Claude API error ${res.status}`);
        return res;
      }
      console.warn(`[AI] Max retries reached — giving up`);
      return null;
    };

    const apiRes = await callWithRetry({
      model: 'claude-sonnet-4-6',
      max_tokens: 1400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    if (!apiRes || !apiRes.ok) return null;

    const apiData = await apiRes.json();
    const rawText = apiData.content?.[0]?.text || '';
    let decisions;
    try {
      decisions = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      console.warn(`[AI] JSON parse failed — raw: ${rawText.slice(0, 300)}`);
      return null;
    }

    if (decisions.crossReferenceCheck && decisions.crossReferenceCheck !== 'no conflicts') console.log(`[AI] Cross-ref: ${decisions.crossReferenceCheck}`);
    if (decisions.contradictionCheck  && decisions.contradictionCheck  !== 'none') console.log(`[AI] Contradiction: ${decisions.contradictionCheck}`);
    if (decisions.intentApplied       && decisions.intentApplied       !== 'none — persona-driven') console.log(`[AI] Intent applied: ${decisions.intentApplied}`);
    if (decisions.reasoning) console.log(`[AI] Reasoning: ${decisions.reasoning}`);

    // Apply newFacts inline — eliminates the separate updateFactSheet API call
    if (decisions.newFacts && typeof decisions.newFacts === 'object') {
      for (const [key, value] of Object.entries(decisions.newFacts)) {
        if (value === null || value === undefined) continue;
        if (key.includes('.')) {
          const [parent, child] = key.split('.');
          if (factSheet[parent] && typeof factSheet[parent] === 'object') {
            if (Array.isArray(factSheet[parent][child]) && Array.isArray(value)) {
              factSheet[parent][child] = [...new Set([...factSheet[parent][child], ...value])];
            } else {
              factSheet[parent][child] = value;
            }
          }
        } else {
          factSheet[key] = value;
        }
      }
    }

    const answersGiven = [];

    for (const ans of decisions.answers || []) {
      const field = actionableFields[ans.fieldIndex];
      if (!field) { console.warn(`[AI] fieldIndex ${ans.fieldIndex} not found`); continue; }
      try {
        switch (ans.fieldType) {
          case 'radio': {
            const allRadios = await page.locator('input[type="radio"]').all();
            const groupMap = {}; const groupOrder = [];
            for (const r of allRadios) {
              const name = await r.getAttribute('name').catch(() => null);
              if (!name) continue;
              if (!groupMap[name]) { groupMap[name] = []; groupOrder.push(name); }
              groupMap[name].push(r);
            }
            const radios = groupMap[groupOrder[field.groupIndex]] || [];
            const idx = ans.selectedIndex ?? 0;
            if (idx < radios.length) {
              await clickRadioOption(page, radios[idx]);
              await fillFollowupInput(page);
              const label = field.options?.[idx] || `option ${idx}`;
              answersGiven.push({ type: 'radio', selected: label, aiControlled: true, flags });
              console.log(`[AI] ✓ Radio [${field.groupIndex}] → "${label}"`);
            }
            break;
          }
          case 'checkbox': {
            const allCbs = await page.locator('input[type="checkbox"]').all();
            const visible = [];
            for (const cb of allCbs) { if (await cb.isVisible().catch(() => false)) visible.push(cb); }
            let groupStart = 0;
            for (let gi = 0; gi < field.groupIndex; gi++) {
              const pf = actionableFields.find(f => f.fieldType === 'checkbox' && f.groupIndex === gi);
              if (pf) groupStart += (pf.options?.length || 0);
            }
            const selected = [];
            for (const idx of ans.selectedIndices || []) {
              const cbEl = visible[groupStart + idx];
              if (cbEl) { await cbEl.check().catch(() => {}); selected.push(field.options?.[idx] || `option ${idx}`); }
            }
            answersGiven.push({ type: 'checkbox', selected, aiControlled: true, flags });
            console.log(`[AI] ✓ Checkbox [${field.groupIndex}] → [${selected.join(', ')}]`);
            break;
          }
          case 'select': {
            const allSels = await page.locator('select').all();
            const visible = [];
            for (const s of allSels) { if (await s.isVisible().catch(() => false)) visible.push(s); }
            const sel = visible[field.selectIndex];
            if (sel) {
              const targetOpt = field.options?.[ans.selectedIndex];
              if (targetOpt?.value) {
                await sel.selectOption(targetOpt.value).catch(() => {});
                answersGiven.push({ type: 'select', selected: targetOpt.label, aiControlled: true, flags });
                console.log(`[AI] ✓ Select [${field.selectIndex}] → "${targetOpt.label}"`);
              }
            }
            break;
          }
          case 'textarea': {
            const allTas = await page.locator('textarea').all();
            const visible = [];
            for (const ta of allTas) { if (await ta.isVisible().catch(() => false)) visible.push(ta); }
            const ta = visible[field.textareaIndex];
            if (ta && ans.text) {
              await ta.fill(ans.text).catch(() => {});
              answersGiven.push({ type: 'open-end', text: ans.text, aiControlled: true, flags });
              console.log(`[AI] ✓ Open-end [${field.textareaIndex}] → "${ans.text.slice(0, 80)}"`);
            }
            break;
          }
          case 'input': {
            const allInputs = await page.locator("input[type='text'], input[type='number']").all();
            const visible = [];
            for (const inp of allInputs) {
              if (!await inp.isVisible().catch(() => false)) continue;
              const existing = await inp.inputValue().catch(() => '');
              if (existing && existing.trim() !== '') continue;
              visible.push(inp);
            }
            const inp = visible[field.inputIndex];
            if (inp && ans.value !== undefined && ans.value !== null && String(ans.value) !== '') {
              await inp.fill(String(ans.value)).catch(() => {});
              const label = field.rowLabel || field.columnHeader || field.contextText?.slice(0, 40) || `input ${field.inputIndex}`;
              answersGiven.push({ type: 'numeric', value: ans.value, label, aiControlled: true, flags });
              console.log(`[AI] ✓ Input [${field.inputIndex}] "${label}" → ${ans.value}`);
            }
            break;
          }
        }
      } catch (e) {
        console.warn(`[AI] Error on fieldIndex ${ans.fieldIndex}: ${e.message}`);
      }
    }

    if (answersGiven.length === 0) { console.log('[AI] No answers executed'); return null; }
    return answersGiven;
  } catch (e) {
    console.warn(`[AI] answerPageWithAI crashed: ${e.message}`);
    return null;
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// PRE-SESSION AGENT SETUP
// ══════════════════════════════════════════════════════════════════════════════

const buildIntentMap = (scenario) => {
  if (!scenario?.steps?.length) return { instructions: [], timerRules: [] };
  const instructions = [], timerRules = [];

  for (const step of scenario.steps) {
    if (step.when_type === 'question_contains' && !step.when_value) continue;
    const vals = Array.isArray(step.action_values)
      ? step.action_values.map(v => parseInt(v)).filter(n => !isNaN(n))
      : [];

    let naturalInstruction = '';
    switch (step.action) {
      case 'select_exact':
        naturalInstruction = vals.length === 1
          ? `Select option ${vals[0]} (1-based) exactly — this is the required qualifying answer`
          : `Select the first valid option from [${vals.join(', ')}] (1-based) — all are qualifying`;
        break;
      case 'select_one_of':
        naturalInstruction = `Select any ONE option from these (1-based): [${vals.join(', ')}] — all qualify. Prefer the one most consistent with persona.`;
        break;
      case 'select_not_in':
        naturalInstruction = `Avoid options [${vals.join(', ')}] (1-based, e.g. "Other/prefer not to say"). Pick anything else that fits persona.`;
        break;
      case 'numeric_fill':
        naturalInstruction = `Enter a numeric value. Target range: ${vals[0] ?? 0}–${vals[1] ?? 100}. Select the radio option whose range contains this target, then fill the spec box.`;
        break;
      case 'open_end':
        naturalInstruction = step.action_mode === 'specific' && step.action_text
          ? `Type this exact text: "${step.action_text}"`
          : `Write a natural open-end response consistent with persona and prior answers.`;
        break;
      case 'skip':
        naturalInstruction = `Do not answer this question — click next immediately.`;
        break;
      case 'select_grid':
        naturalInstruction = `This is a grid question. Follow persona to answer each row.`;
        break;
      default:
        naturalInstruction = '';
    }

    if (naturalInstruction) {
      instructions.push({
        when_type: step.when_type,
        when_value: step.when_value || '',
        action: step.action,
        vals,
        naturalInstruction,
        wait_min_s: step.wait_min_s || null,
        wait_max_s: step.wait_max_s || null,
      });
    }

    if (step.wait_min_s || step.wait_max_s) {
      timerRules.push({
        when_value: (step.when_value || '').toLowerCase(),
        when_type:  step.when_type,
        wait_min_s: step.wait_min_s,
        wait_max_s: step.wait_max_s,
      });
    }
  }
  return { instructions, timerRules };
};

const buildCountryLogicIntent = (countryLogic, proxyCountry) => {
  if (!countryLogic?.country_mapping) return null;
  const { questionContains, mappings } = countryLogic.country_mapping;
  if (!questionContains || !mappings?.length) return null;
  const mapping = mappings.find(m => m.country.toUpperCase() === (proxyCountry || '').toUpperCase());
  if (!mapping) return null;
  return {
    when_type: 'question_contains',
    when_value: questionContains,
    action: 'country_logic',
    vals: [],
    naturalInstruction: `COUNTRY LOGIC: Select the option whose label is exactly "${mapping.answer}". This is mandatory — do not deviate.`,
    wait_min_s: countryLogic.country_mapping.waitMinS || null,
    wait_max_s: countryLogic.country_mapping.waitMaxS || null,
  };
};

const initFactSheet = (persona, country) => {
  const attrs = persona?.behavioural_attrs || {};
  return {
    // Semantic facts — extracted and structured for contradiction checking
    gender:             persona?.gender || null,
    age:                persona?.age_min ? `${persona.age_min}${persona.age_max ? '–' + persona.age_max : '+'}` : null,
    job_title:          attrs.designation || null,
    seniority_level:    null,
    industry:           attrs.industry || null,
    country:            country || persona?.country || null,
    company_size:       attrs.employeeSize || null,
    company_revenue:    attrs.companyRevenue || null,
    ai_adoption_status: null,
    ai_budget:          null,
    current_vendors:    null,
    purchase_timeline:  null,
    decision_maker:     null,
    brand_awareness:    { aware_of: [], not_aware_of: [], used: [], satisfaction: {} },
    committed_numbers:  {},
    survey_specific:    {},
    // Full Q&A history — every question + answer for cross-referencing
    // Used by AI to check Q10 against Q3, Q15 against Q7, etc.
    pageHistory:        [],
  };
};

const resolveQuotaCell = async (persona, projectId, ANTHROPIC_API_KEY) => {
  if (!ANTHROPIC_API_KEY || !projectId) return null;
  try {
    const result = await pool.query(
      `SELECT dimensions FROM quota_cells WHERE project_id = $1`,
      [projectId]
    );
    if (!result.rows.length) return null;

    const dimMap = {};
    for (const row of result.rows) {
      for (const [dim, val] of Object.entries(row.dimensions || {})) {
        if (!dimMap[dim]) dimMap[dim] = new Set();
        dimMap[dim].add(val);
      }
    }
    if (!Object.keys(dimMap).length) return null;

    const dimensionsText = Object.entries(dimMap)
      .map(([d, vals]) => `${d}: ${[...vals].join(', ')}`)
      .join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        system: 'Map a persona to quota dimension values. Return only valid JSON, no explanation.',
        messages: [{
          role: 'user',
          content: `Persona:\n${buildPersonaContext(persona)}\n\nAvailable quota dimensions:\n${dimensionsText}\n\nSelect the best matching value for each dimension. Return JSON: {"DimensionName": "matched_value", ...}`,
        }],
      }),
    });
    const data = await res.json();
    const cell = JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
    console.log(`[Agent] Quota cell resolved: ${JSON.stringify(cell)}`);
    return cell;
  } catch (e) {
    console.warn('[Agent] resolveQuotaCell failed:', e.message);
    return null;
  }
};

const prepareSessionAgent = async (persona, scenario, countryLogic, projectId, proxyCountry, ANTHROPIC_API_KEY) => {
  const [quotaCell, intentMap, factSheet] = await Promise.all([
    resolveQuotaCell(persona, projectId, ANTHROPIC_API_KEY),
    Promise.resolve(buildIntentMap(scenario)),
    Promise.resolve(initFactSheet(persona, proxyCountry)),
  ]);

  // Inject country logic as first instruction — highest priority
  const countryIntent = buildCountryLogicIntent(countryLogic, proxyCountry);
  if (countryIntent) {
    intentMap.instructions.unshift(countryIntent);
    console.log(`[Agent] Country logic injected as intent: "${countryIntent.naturalInstruction}"`);
  }

  if (quotaCell) {
    for (const [dim, val] of Object.entries(quotaCell)) {
      const d = dim.toLowerCase();
      if (d.includes('seniority') || d.includes('level') || d.includes('title') || d.includes('role')) {
        factSheet.seniority_level = val;
      }
    }
  }

  const quotaCellText = quotaCell
    ? Object.entries(quotaCell).map(([k, v]) => `${k}: ${v}`).join(' × ')
    : 'Not defined — answer based on persona';

  console.log(`[Agent] Ready — cell: ${quotaCellText} | intents: ${intentMap.instructions.length} instructions`);
  return { personaBrief: buildPersonaContext(persona), quotaCellText, intentMap, factSheet };
};

// ── Attention check detection ──────────────────────────────────────────────────
const detectAttentionCheck = async (questionsOnPage, allFields, ANTHROPIC_API_KEY) => {
  if (!ANTHROPIC_API_KEY || !questionsOnPage.length) return null;

  const fullText = questionsOnPage.join(' ');
  const optionTexts = allFields
    .filter(f => ['radio', 'checkbox'].includes(f.fieldType))
    .flatMap(f => f.options || []).join(' ');

  const botSignals = [
    /please select.{0,50}(to continue|to verify|option \d|answer \d)/i,
    /type the word/i, /enter the (word|number|text)/i,
    /quality check/i, /attention check/i, /to verify you are/i,
    /do not select this/i, /for quality control/i,
    /select.{0,20}to proceed/i,
  ];
  const hasSignal = botSignals.some(p => p.test(fullText) || p.test(optionTexts));
  if (!hasSignal) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: 'Detect survey attention/quality check questions. Return only JSON.',
        messages: [{
          role: 'user',
          content: `Question text: ${fullText.slice(0, 400)}\nOption texts: ${optionTexts.slice(0, 300)}\n\nIs this an attention check or bot detection question? Return: {"isAttentionCheck": boolean, "confidence": "high" or "low", "instruction": "exact instruction to follow e.g. select option 3 or type apple" or null}`,
        }],
      }),
    });
    const data = await res.json();
    return JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
};

// ── Fact sheet updater ────────────────────────────────────────────────────────
const updateFactSheet = async (factSheet, answersGiven, questionsOnPage, pageNum, ANTHROPIC_API_KEY) => {
  if (!answersGiven?.length) return factSheet;

  // Always update pageHistory — no API needed for this
  for (let i = 0; i < answersGiven.length; i++) {
    const ans = answersGiven[i];
    if (!ans || ans.type === 'country_mapping') continue;
    const questionText = questionsOnPage[i] || questionsOnPage[0] || `Page ${pageNum} field ${i + 1}`;
    const answerText =
      ans.type === 'open-end'     ? ans.text :
      ans.type === 'numeric'      ? `${ans.value} (${ans.label || 'numeric'})` :
      Array.isArray(ans.selected) ? ans.selected.join(', ') :
      (ans.selected || String(ans.value || ''));
    if (answerText) {
      factSheet.pageHistory.push({
        page:     pageNum,
        question: questionText.slice(0, 200),
        answer:   answerText.slice(0, 200),
        type:     ans.type,
      });
    }
  }

  if (!ANTHROPIC_API_KEY) return factSheet;

  const answerSummary = answersGiven
    .filter(a => a && a.type !== 'country_mapping')
    .map(a => {
      if (a.type === 'open-end')       return `Open-end: "${(a.text || '').slice(0, 150)}"`;
      if (a.type === 'numeric')        return `Numeric "${a.label}": ${a.value}`;
      if (Array.isArray(a.selected))   return `Multi-select: [${a.selected.join(', ')}]`;
      return `Selected: "${a.selected}"`;
    }).join('\n');

  if (!answerSummary.trim()) return factSheet;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: 'Extract semantic facts from survey answers to update a respondent profile. Return only JSON with new/updated keys. Return {} if nothing meaningful to extract.',
        messages: [{
          role: 'user',
          content: `Questions: ${questionsOnPage.join(' | ')}\nAnswers:\n${answerSummary}\nExisting fact sheet: ${JSON.stringify(factSheet, null, 0).slice(0, 500)}\n\nExtract new/updated facts as snake_case keys. For brands use "brand_awareness.aware_of": ["Brand1"] or "brand_awareness.not_aware_of": ["Brand2"]. For committed numbers use "committed_numbers.budget_total": 5000000. Return only changed/new keys as JSON.`,
        }],
      }),
    });
    const data = await res.json();
    const newFacts = JSON.parse((data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim());

    for (const [key, value] of Object.entries(newFacts)) {
      if (value === null || value === undefined) continue;
      if (key.includes('.')) {
        const [parent, child] = key.split('.');
        if (factSheet[parent] && typeof factSheet[parent] === 'object') {
          if (Array.isArray(factSheet[parent][child]) && Array.isArray(value)) {
            factSheet[parent][child] = [...new Set([...factSheet[parent][child], ...value])];
          } else {
            factSheet[parent][child] = value;
          }
        }
      } else {
        factSheet[key] = value;
      }
    }
  } catch (e) {
    console.warn('[Agent] updateFactSheet error:', e.message);
  }
  return factSheet;
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

  // ── AI agent setup (initialised with defaults, upgraded after key is loaded) ─
  let agentSetup = {
    personaBrief:  buildPersonaContext(persona),
    quotaCellText: 'Not resolved',
    intentMap:     buildIntentMap(scenario),
    factSheet:     initFactSheet(persona, proxyCountry),
  };

  const ANTHROPIC_API_KEY =
    readSecret('anthropic_api_key_v1') ||
    process.env.ANTHROPIC_API_KEY ||
    null;

  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️ Anthropic API key not found. AI features disabled.');
  }

  const useAI = !!ANTHROPIC_API_KEY;

  // Pre-session agent setup: quota cell mapping + intent compilation
  if (useAI && persona) {
    try {
      agentSetup = await prepareSessionAgent(persona, scenario, countryLogic, projectId, proxyCountry, ANTHROPIC_API_KEY);
    } catch (e) {
      console.warn('[Agent] prepareSessionAgent failed, using defaults:', e.message);
    }
  }

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
      const pageFields = await captureAllPageFields(page);

      // ── Pre-check: Attention / bot detection ──────────────────────────────
      // Attention check is handled inline by the main AI answer call (Rule 9 in prompt)
      // Separate API call disabled to reduce rate limit pressure
      // if (useAI && questionsOnPage.length > 0) {
      //   const attCheck = await detectAttentionCheck(questionsOnPage, pageFields, ANTHROPIC_API_KEY);
      //   if (attCheck?.isAttentionCheck) {
      //     console.log(`[Agent] Attention check (${attCheck.confidence}): "${attCheck.instruction}"`);
      //     await logSessionEvent(sessionId, 'attention_check_detected', {
      //       page: pageCount, instruction: attCheck.instruction, confidence: attCheck.confidence,
      //     });
      //     if (attCheck.confidence === 'low') {
      //       await logSessionEvent(sessionId, 'flag_warning', {
      //         flag: 'NEED_ATTENTION_QUALITY_CHECK',
      //         message: `Possible quality check — AI made best guess. Review page ${pageCount}.`,
      //         page: pageCount,
      //       });
      //     }
      //   }
      // }

      // ── Answer logic — AI is always the primary executor ──────────────────
      // Country Logic and Scenarios are context injected into AI, not independent executors.
      let answersGiven = null;
      const scenarioStepUsed = 'ai';

      if (useAI) {
        console.log(`[Worker] Page ${pageCount}: AI answering (persona + quota + intents + full history)`);
        answersGiven = await answerPageWithAI(
          page, persona, scenario,
          agentSetup.factSheet, agentSetup.intentMap, agentSetup.quotaCellText,
          questionsOnPage, pageOptionsBefore,
          ANTHROPIC_API_KEY
        );
        if (answersGiven?.length > 0) {
          questionCount++;
          console.log(`[Worker] Page ${pageCount}: AI answered ${answersGiven.length} field(s)`);

          // Apply wait time from matching intent timer rule
          const normalize = s => (s || '').toLowerCase().trim();
          const pageTextLower = questionsOnPage.map(normalize).join(' ');
          const matchedTimer = (agentSetup.intentMap?.timerRules || []).find(r => {
            if (r.when_type === 'always') return true;
            if (r.when_type === 'question_contains') return pageTextLower.includes(normalize(r.when_value));
            return false;
          });
          if (matchedTimer?.wait_min_s || matchedTimer?.wait_max_s) {
            const wMin = parseInt(matchedTimer.wait_min_s) || 0;
            const wMax = parseInt(matchedTimer.wait_max_s) || wMin;
            const waitMs = (wMin + Math.random() * Math.max(0, wMax - wMin)) * 1000;
            console.log(`[Worker] Page ${pageCount}: intent timer — waiting ${Math.round(waitMs/1000)}s (range: ${wMin}–${wMax}s)`);
            await page.waitForTimeout(waitMs);
          }
        } else {
          // AI returned nothing (rate limit hit after retries, or parse failure)
          // Fall back to random answering which handles all field types
          console.warn(`[Worker] Page ${pageCount}: AI returned no answers — falling back to random`);
          await logSessionEvent(sessionId, 'flag_warning', {
            flag: 'AI_FALLBACK_RANDOM',
            message: `AI failed on page ${pageCount} (rate limit or parse error) — random answering used`,
            page: pageCount,
          });
          answersGiven = await answerPage(page, persona, readingSpeed);
          questionCount++;
        }
      } else {
      // AI disabled (no API key) — use random as last resort
      console.log(`[Worker] Page ${pageCount}: AI disabled — using random answering`);
      answersGiven = await answerPage(page, persona, readingSpeed);
      questionCount++;
    }

      // Log web search flag if used (fact extraction now happens inside answerPageWithAI)
      if (useAI && answersGiven?.length > 0) {
        const usedWebSearch = answersGiven.some(a => a?.flags?.includes('web_search_used'));
        if (usedWebSearch) {
          await logSessionEvent(sessionId, 'flag_warning', {
            flag: 'NEED_ATTENTION_WEB_SEARCH',
            message: `Web search used on page ${pageCount} — additional tokens consumed`,
            page: pageCount,
          });
        }
        // Update pageHistory in fact sheet (no API call needed)
        for (let i = 0; i < answersGiven.length; i++) {
          const ans = answersGiven[i];
          if (!ans || ans.type === 'country_mapping') continue;
          const questionText = questionsOnPage[i] || questionsOnPage[0] || `Page ${pageCount} field ${i+1}`;
          const answerText =
            ans.type === 'open-end'     ? ans.text :
            ans.type === 'numeric'      ? `${ans.value} (${ans.label || 'numeric'})` :
            Array.isArray(ans.selected) ? ans.selected.join(', ') :
            (ans.selected || String(ans.value || ''));
          if (answerText) {
            agentSetup.factSheet.pageHistory.push({
              page:     pageCount,
              question: questionText.slice(0, 200),
              answer:   answerText.slice(0, 200),
              type:     ans.type,
            });
          }
        }
      }

      // Step 4: Last-resort fill for anything AI or scenario missed
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
        factSheet: useAI ? agentSetup.factSheet : undefined,
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