"use strict";
const { Worker } = require("bullmq");
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const readSecret = (name) => {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, "utf8").trim();
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
const { getDefaultModel } = require("../../backend/src/db/ai_models");

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

// ══════════════════════════════════════════════════════════════════════════════
// PERSONA LOADER — random assignment from project pool if no persona assigned
// ══════════════════════════════════════════════════════════════════════════════
const getPersona = async (personaId, projectId, proxyCountry = null) => {
  // Explicit persona assigned — load it directly
  if (personaId) {
    try {
      const r = await pool.query(`SELECT * FROM personas WHERE id = $1`, [personaId]);
      if (r.rows[0]) {
        console.log(`[Persona] Loaded explicit: "${r.rows[0].name}"`);
        return r.rows[0];
      }
    } catch {}
  }

  // No explicit persona — pick from project pool, filtered by country first
  if (projectId) {
    try {
      // Resolve ISO code → full country name via proxy_countries table
      let countryName = null;
      if (proxyCountry) {
        const cr = await pool.query(
          `SELECT country FROM proxy_countries WHERE UPPER(code) = UPPER($1) LIMIT 1`,
          [proxyCountry]
        );
        countryName = cr.rows[0]?.country || null;
        if (countryName) {
          console.log(`[Persona] Country resolved: ${proxyCountry} → "${countryName}"`);
        }
      }

      // Step 1: try country-matched persona
      if (countryName) {
        const r = await pool.query(
          `SELECT p.* FROM project_personas pp
           JOIN personas p ON p.id = pp.persona_id
           WHERE pp.project_id = $1
             AND pp.is_active = true
             AND p.is_active = true
             AND p.country ILIKE $2
           ORDER BY RANDOM() LIMIT 1`,
          [projectId, countryName]
        );
        if (r.rows[0]) {
          const picked = r.rows[0];
          console.log(`[Persona] Country-matched (${countryName}): "${picked.name}"`);
          await pool.query(
            `UPDATE sessions SET persona_id = $1, persona_name = $2
             WHERE project_id = $3 AND persona_id IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [picked.id, picked.name, projectId]
          ).catch(() => {});
          return picked;
        }
        console.log(`[Persona] No country-matched persona for "${countryName}" — falling back to full pool`);
      }

      // Step 2: fallback — any active persona in the project pool
      const r = await pool.query(
        `SELECT p.* FROM project_personas pp
         JOIN personas p ON p.id = pp.persona_id
         WHERE pp.project_id = $1 AND pp.is_active = true AND p.is_active = true
         ORDER BY RANDOM() LIMIT 1`,
        [projectId]
      );
      if (r.rows[0]) {
        const picked = r.rows[0];
        console.log(`[Persona] Pool fallback (random): "${picked.name}"`);
        await pool.query(
          `UPDATE sessions SET persona_id = $1, persona_name = $2
           WHERE project_id = $3 AND persona_id IS NULL
           ORDER BY created_at DESC LIMIT 1`,
          [picked.id, picked.name, projectId]
        ).catch(() => {});
        return picked;
      }
    } catch (e) {
      console.warn('[Persona] Pool lookup failed:', e.message);
    }
  }

  console.log('[Persona] None assigned — AI will use common sense');
  return null;
};

// ══════════════════════════════════════════════════════════════════════════════
// BUILD ANSWER SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
const buildAnswerSummary = (pageOptions, answersGiven) => {
  const summary = [];
  for (const opt of pageOptions || []) {
    if (opt.type === "radio" && opt.selected) {
      const totalOpts = opt.options?.length || 0;
      const selIdx = opt.options?.indexOf(opt.selected);
      const selNum = selIdx >= 0 ? selIdx + 1 : "?";
      const label = opt.specText
        ? `Selected: ${opt.selected} — "${opt.specText}"`
        : `Selected: ${opt.selected}`;
      summary.push({
        type: "radio",
        label,
        detail: `Option ${selNum} of ${totalOpts}`,
        options: opt.options || [],
        selected: opt.selected,
        specText: opt.specText || null,
      });
    } else if (opt.type === "checkbox" && opt.selected?.length > 0) {
      let detail = opt.selected.join(", ");
      if (opt.specTexts?.length > 0) {
        detail += ` (${opt.specTexts.map((s) => `${s.option}: "${s.text}"`).join(", ")})`;
      }
      summary.push({
        type: "checkbox",
        label: `Selected ${opt.selected.length} of ${opt.options?.length || "?"}`,
        detail,
        options: opt.options || [],
        selected: opt.selected,
      });
    } else if (opt.type === "select" && opt.selected) {
      summary.push({
        type: "select",
        label: `Selected: ${opt.selected}`,
        options: opt.options || [],
        selected: opt.selected,
      });
    } else if (opt.type === "open-end" && opt.selected) {
      summary.push({
        type: "open-end",
        label: "Open-end response",
        detail: opt.selected,
      });
    }
  }
  for (const ans of answersGiven || []) {
    if (ans?.type === "open-end" && ans.text)
      summary.push({
        type: "open-end",
        label: "Typed response",
        detail: ans.text,
      });
    if (ans?.type === "numeric" && ans.values?.length > 0)
      summary.push({
        type: "numeric",
        label: "Entered value",
        detail: ans.values.join(", "),
      });
  }
  return summary;
};

// ══════════════════════════════════════════════════════════════════════════════
// SCREENSHOT
// ══════════════════════════════════════════════════════════════════════════════
const takeScreenshot = async (page, screenshotPath) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        timeout: 8000,
      });
      return true;
    } catch (e) {
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000));
      else console.warn(`[Worker] Screenshot failed: ${e.message}`);
    }
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════════
// CAPTURE GRID ANSWERS
// ══════════════════════════════════════════════════════════════════════════════
const captureGridAnswers = async (page) => {
  try {
    return await page.evaluate(() => {
      const groups = {};
      const groupOrder = [];
      document.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (!r.name) return;
        if (!groups[r.name]) {
          groups[r.name] = [];
          groupOrder.push(r.name);
        }
        groups[r.name].push(r);
      });
      if (groupOrder.length <= 1) return [];
      return groupOrder.map((name) => {
        const radios = groups[name];
        const first = radios[0];
        let rowLabel = "";
        const tr = first.closest("tr");
        if (tr) {
          const cells = Array.from(tr.querySelectorAll("td, th"));
          for (const cell of cells) {
            if (!cell.querySelector("input")) {
              const t = (cell.innerText || cell.textContent || "").trim();
              if (t) {
                rowLabel = t;
                break;
              }
            }
          }
        }
        const checked = radios.find((r) => r.checked);
        let selectedLabel = "";
        if (checked) {
          if (checked.id) {
            const lbl = document.querySelector(`label[for="${checked.id}"]`);
            if (lbl)
              selectedLabel = (lbl.innerText || lbl.textContent || "").trim();
          }
          if (!selectedLabel) {
            const table = checked.closest("table");
            const td = checked.closest("td");
            if (table && td) {
              const allCells = Array.from(
                checked.closest("tr")?.querySelectorAll("td") || [],
              );
              const colIdx = allCells.indexOf(td);
              const headers = Array.from(
                table.querySelectorAll("thead th, tr:first-child th"),
              );
              if (headers[colIdx])
                selectedLabel = (
                  headers[colIdx].innerText ||
                  headers[colIdx].textContent ||
                  ""
                ).trim();
            }
          }
        }
        return {
          row: rowLabel || name,
          selected: selectedLabel || (checked ? "✓ Selected" : "—"),
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
    const id = await radio.getAttribute("id").catch(() => null);
    if (id) {
      const lbl = page.locator(`label[for="${id}"]`);
      if (await lbl.isVisible().catch(() => false)) {
        await lbl.click();
        await page.waitForTimeout(200);
        return;
      }
    }
    const parentLbl = radio.locator("xpath=ancestor::label").first();
    if (await parentLbl.isVisible().catch(() => false)) {
      await parentLbl.click();
      await page.waitForTimeout(200);
      return;
    }
    await radio.check();
    await page.waitForTimeout(200);
  } catch {
    await radio.click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
  }
};

const clickLabelByText = async (page, text) => {
  const allLabels = await page.locator("label").all();
  for (const label of allLabels) {
    const t = (await label.textContent().catch(() => "")) || "";
    if (t.trim() === text) {
      await label.click().catch(() => {});
      await page.waitForTimeout(400);
      return true;
    }
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════════
// NUMERIC HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const parseNum = (str, ignoreSuffix = false) => {
  if (!str) return null;
  const clean = str.replace(/USD|[$£€,\s]/gi, "").trim();
  const match = clean.match(/^([\d.]+)([kmbtKMBT]?)/);
  if (!match) return null;
  let num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  if (!ignoreSuffix) {
    const s = (match[2] || "").toLowerCase();
    if (s === "k") num *= 1_000;
    else if (s === "m") num *= 1_000_000;
    else if (s === "b") num *= 1_000_000_000;
    else if (s === "t") num *= 1_000_000_000_000;
  }
  return num;
};

const extractRange = (text, ignoreSuffix = false) => {
  if (!text) return null;
  const p1 = text.match(
    /between\s+([USD$£€]*[\d,.]+[kmbtKMBT]?)\s+(?:and|–|-)\s+([USD$£€]*[\d,.]+[kmbtKMBT]?)/i,
  );
  if (p1) {
    const a = parseNum(p1[1], ignoreSuffix);
    const b = parseNum(p1[2], ignoreSuffix);
    if (a !== null && b !== null)
      return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const p2 = text.match(
    /([USD$£€]*[\d,.]+[kmbtKMBT]?)\s*(?:–|-)\s*([USD$£€]*[\d,.]+[kmbtKMBT]?)/i,
  );
  if (p2) {
    const a = parseNum(p2[1], ignoreSuffix);
    const b = parseNum(p2[2], ignoreSuffix);
    if (a !== null && b !== null && a !== b && Math.min(a, b) >= 0)
      return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const p3 = text.match(
    /(?:enter|between|from).*?([\d,.]+)\s*(?:and|to)\s*([\d,.]+)/i,
  );
  if (p3) {
    const a = parseFloat(p3[1].replace(/,/g, ""));
    const b = parseFloat(p3[2].replace(/,/g, ""));
    if (!isNaN(a) && !isNaN(b))
      return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
};

const smartRound = (value, rangeMin, rangeMax) => {
  if (!value || value <= 0) return Math.ceil(rangeMin || 1);
  const mag = Math.floor(Math.log10(Math.abs(value)));
  const roundTo = Math.pow(10, Math.max(0, mag - 2));
  const rounded = Math.round(value / roundTo) * roundTo;
  return Math.min(Math.max(rounded, Math.ceil(rangeMin)), Math.floor(rangeMax));
};

const valueForUnit = (unit, attrMin, attrMax) => {
  switch (unit) {
    case "percent":
      return Math.floor(5 + Math.random() * 25);
    case "million": {
      const mn = attrMin ?? 1;
      const mx = attrMax ?? 999;
      return smartRound(mn + Math.random() * (mx - mn), mn, mx);
    }
    case "billion": {
      const mn = attrMin ?? 1;
      const mx = attrMax ?? 9;
      return smartRound(mn + Math.random() * (mx - mn), mn, mx);
    }
    case "thousand": {
      const mn = attrMin ?? 1;
      const mx = attrMax ?? 999;
      return smartRound(mn + Math.random() * (mx - mn), mn, mx);
    }
    default: {
      const mn = attrMin ?? 1;
      const mx = attrMax ?? 100;
      return smartRound(mn + Math.random() * (mx - mn), mn, mx);
    }
  }
};

const detectUnit = (text) => {
  const t = (text || "").toLowerCase();
  if (/\b%\b|percent|percentage/.test(t)) return "percent";
  if (/billion|bn|\$.*b\b/.test(t)) return "billion";
  if (/million|mn|\$.*m\b/.test(t)) return "million";
  if (/thousand|,000/.test(t)) return "thousand";
  return "generic";
};

// ══════════════════════════════════════════════════════════════════════════════
// FILL FOLLOWUP INPUT — revealed inputs after radio click
// ══════════════════════════════════════════════════════════════════════════════
const fillFollowupInput = async (page) => {
  try {
    await page.waitForTimeout(900);
    const filledByContainer = await page
      .evaluate(() => {
        const checked = document.querySelector('input[type="radio"]:checked');
        if (!checked) return { found: false };
        let container = checked.parentElement;
        for (let i = 0; i < 8; i++) {
          if (!container) break;
          const sibling = container.parentElement;
          if (!sibling) break;
          if (sibling.querySelectorAll('input[type="radio"]').length > 1) break;
          container = sibling;
        }
        const inp = container?.querySelector(
          'input[type="text"], input[type="number"]',
        );
        if (inp && inp.offsetParent)
          return {
            found: true,
            type: "input",
            hasMin: inp.min || null,
            hasMax: inp.max || null,
          };
        const sel = container?.querySelector("select");
        if (sel && sel.offsetParent) {
          const opts = Array.from(sel.options)
            .filter(
              (o) =>
                o.value &&
                o.value !== "" &&
                !/^(select one|--|please select)/i.test(o.text),
            )
            .map((o) => o.value);
          if (opts.length > 0)
            return { found: true, type: "select", options: opts };
        }
        return { found: false };
      })
      .catch(() => ({ found: false }));

    if (!filledByContainer.found) return false;

    if (filledByContainer.type === "select") {
      const chosen =
        filledByContainer.options[
          Math.floor(Math.random() * filledByContainer.options.length)
        ];
      const selects = await page.locator("select").all();
      for (const sel of selects) {
        if (!(await sel.isVisible().catch(() => false))) continue;
        const isInChecked = await sel
          .evaluate((el) => {
            const checked = document.querySelector(
              'input[type="radio"]:checked',
            );
            if (!checked) return false;
            let container = checked.parentElement;
            for (let i = 0; i < 8; i++) {
              if (!container) break;
              if (container.contains(el)) return true;
              const sibling = container.parentElement;
              if (
                !sibling ||
                sibling.querySelectorAll('input[type="radio"]').length > 1
              )
                break;
              container = sibling;
            }
            return false;
          })
          .catch(() => false);
        if (!isInChecked) continue;
        await sel.selectOption(chosen).catch(() => {});
        console.log(
          `[Scenario] ✓ Auto-selected follow-up dropdown: "${chosen}"`,
        );
        return true;
      }
    }

    if (filledByContainer.type === "input") {
      const inputs = await page
        .locator("input[type='text'], input[type='number']")
        .all();
      for (const input of inputs) {
        if (!(await input.isVisible().catch(() => false))) continue;
        const isInChecked = await input
          .evaluate((el) => {
            const checked = document.querySelector(
              'input[type="radio"]:checked',
            );
            if (!checked) return false;
            let container = checked.parentElement;
            for (let i = 0; i < 8; i++) {
              if (!container) break;
              if (container.contains(el)) return true;
              const sibling = container.parentElement;
              if (
                !sibling ||
                sibling.querySelectorAll('input[type="radio"]').length > 1
              )
                break;
              container = sibling;
            }
            return false;
          })
          .catch(() => false);
        if (!isInChecked) continue;
        const existing = await input.inputValue().catch(() => "");
        if (existing && existing.trim() !== "") return true;

        let min = null,
          max = null;
        const attrMin = filledByContainer.hasMin;
        const attrMax = filledByContainer.hasMax;
        if (attrMin !== null && attrMin !== "") min = parseFloat(attrMin);
        if (attrMax !== null && attrMax !== "") max = parseFloat(attrMax);
        const adjacentText = await input
          .evaluate((el) =>
            (
              el.parentElement?.innerText ||
              el.parentElement?.textContent ||
              ""
            ).toLowerCase(),
          )
          .catch(() => "");
        const hasUnitLabel = /\b(million|billion|thousand|mn|bn|%)\b/i.test(
          adjacentText,
        );
        if (min === null || max === null) {
          const selectedLabel = await page
            .evaluate(() => {
              const checked = document.querySelector(
                'input[type="radio"]:checked',
              );
              if (!checked) return "";
              if (checked.id) {
                const lbl = document.querySelector(
                  `label[for="${checked.id}"]`,
                );
                if (lbl) return lbl.innerText || lbl.textContent || "";
              }
              const parentLabel = checked.closest("label");
              if (parentLabel)
                return parentLabel.innerText || parentLabel.textContent || "";
              return "";
            })
            .catch(() => "");
          if (selectedLabel) {
            const parsed = extractRange(selectedLabel, hasUnitLabel);
            if (parsed) {
              min = parsed.min;
              max = parsed.max;
              console.log(`[Scenario] Range from radio label: ${min}–${max}`);
            }
          }
        }
        if (min === null || max === null) {
          const nearbyText = await input
            .evaluate((el) => {
              let node = el.parentElement;
              for (let i = 0; i < 5; i++) {
                const t = (node?.innerText || "").trim();
                if (t.length > 10) return t;
                node = node?.parentElement;
              }
              return "";
            })
            .catch(() => "");
          const parsed = extractRange(nearbyText, hasUnitLabel);
          if (parsed) {
            min = parsed.min;
            max = parsed.max;
          }
        }
        if (min === null) min = 0;
        if (max === null) max = min * 2 || 100;
        if (min > max) [min, max] = [max, min];
        if (min === max) max = min + Math.max(1, Math.floor(min * 0.1));
        const rawValue = min + Math.random() * (max - min);
        const value = smartRound(rawValue, min, max);
        await input.fill(String(value)).catch(() => {});
        console.log(
          `[Scenario] ✓ Auto-filled follow-up input: ${value} (range: ${min}–${max})`,
        );
        return true;
      }
    }
  } catch (e) {
    console.warn(`[Scenario] Follow-up input detection failed: ${e.message}`);
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════════
// POST-CLICK DYNAMIC CONTENT RE-SCAN
// Handles custom survey code that reveals new elements after a radio/checkbox click
// e.g. CXO → sub-section of C-level titles appears; country → city list appears
// ══════════════════════════════════════════════════════════════════════════════
const rescanForRevealedContent = async (
  page,
  providerConfig,
  persona,
  factSheet,
  questionsOnPage,
) => {
  try {
    // Wait for any CSS animations / JS DOM mutations to settle
    await page.waitForTimeout(600);
    await page
      .waitForLoadState("networkidle", { timeout: 2000 })
      .catch(() => {});

    // Snapshot all currently visible interactive elements
    const revealed = await page.evaluate(() => {
      const result = [];
      // Newly visible radio groups (hidden ones that are now visible)
      const radioGroups = {};
      document.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (!r.offsetParent) return; // skip hidden
        if (r.checked || r.disabled) return; // skip already-answered or disabled
        if (!r.name) return;
        if (!radioGroups[r.name]) radioGroups[r.name] = [];
        let label = "";
        if (r.id) {
          const lbl = document.querySelector(`label[for="${r.id}"]`);
          if (lbl) label = (lbl.innerText || "").trim();
        }
        if (!label) {
          const pl = r.closest("label");
          if (pl) label = (pl.innerText || "").trim();
        }
        radioGroups[r.name].push(label || r.value);
      });
      Object.entries(radioGroups).forEach(([name, options]) => {
        // Only include groups that have NO checked option — they're unanswered
        const anyChecked = document.querySelector(
          `input[type="radio"][name="${name}"]:checked`,
        );
        if (!anyChecked) {
          let questionLabel = "";
          const firstR = document.querySelector(
            `input[type="radio"][name="${name}"]`,
          );
          const qblock = firstR?.closest(
            '.qblock, .question, [class*="qblock"], fieldset',
          );
          if (qblock) {
            const qt = qblock.querySelector(
              ".qtext, .question-text, legend, h2, h3, h4",
            );
            if (qt) questionLabel = (qt.innerText || "").trim().slice(0, 150);
          }
          result.push({
            fieldType: "radio",
            groupName: name,
            questionLabel,
            options,
          });
        }
      });
      // Newly visible selects that are still on placeholder
      document.querySelectorAll("select").forEach((sel) => {
        if (!sel.offsetParent) return;
        const val = sel.value;
        const txt = sel.options[sel.selectedIndex]?.text || "";
        if (
          val &&
          val !== "" &&
          !/^(select one|--|please select|choose)/i.test(txt)
        )
          return; // already answered
        const opts = Array.from(sel.options)
          .filter((o) => o.value && !/^(--|select|please)/i.test(o.text))
          .map((o) => ({ value: o.value, label: o.text.trim() }));
        if (opts.length === 0) return;
        result.push({ fieldType: "select", options: opts });
      });
      return result;
    });

    if (revealed.length === 0) {
      console.log("[Rescan] No newly revealed content detected");
      return false;
    }

    console.log(
      `[Rescan] Found ${revealed.length} newly revealed field(s) — passing to AI`,
    );

    // If AI is available, ask it to answer the revealed fields
    if (providerConfig?.api_key) {
      const revealedDesc = revealed
        .map((f, i) => {
          if (f.fieldType === "radio") {
            const opts = f.options
              .map((o, idx) => `  [${idx}] ${o}`)
              .join("\n");
            return `[${i}] RADIO (revealed after selection) — "${f.questionLabel || "sub-question"}"\n${opts}`;
          }
          if (f.fieldType === "select") {
            const opts = f.options
              .map((o, idx) => `  [${idx}] ${o.label}`)
              .join("\n");
            return `[${i}] DROPDOWN (revealed after selection)\n${opts}`;
          }
          return `[${i}] UNKNOWN REVEALED FIELD`;
        })
        .join("\n\n");

      const personaContext = buildPersonaContext(persona);
      const prompt =
`You are completing a survey as this persona:
${personaContext}

After selecting an option, these new fields have appeared on the page (they were hidden before):

${revealedDesc}

Select the most appropriate answer for each field, consistent with the persona.
You MUST respond with ONLY the JSON object below. Do not write any explanation, apology, or prose. Do not use markdown. Output raw JSON only:
{"answers":[{"fieldIndex":0,"fieldType":"radio","selectedIndex":2}]}`;

      const rawText = await callAIProvider(providerConfig, {
        systemPrompt:
          "Answer revealed survey fields consistently with persona. Return only JSON.",
        staticPart: "",
        dynamicPart: prompt,
        maxTokens: 400,
      });

      if (rawText) {
        // ADD THIS BLOCK:
        const trimmed = rawText.trim();
        if (/^(I'm sorry|I cannot|I can't|I apologize|Sorry,)/i.test(trimmed)) {
          console.warn('[Rescan] AI returned a refusal — falling back to random selection');
          for (const field of revealed) {
            if (field.fieldType === 'radio') {
              const allRadios = await page.locator(`input[type="radio"][name="${field.groupName}"]`).all();
              if (allRadios.length > 0) {
                const idx = Math.floor(Math.random() * allRadios.length);
                await clickRadioOption(page, allRadios[idx]);
                await fillFollowupInput(page);
                console.log(`[Rescan] Fallback random: revealed radio "${field.groupName}" → option ${idx}`);
              }
            }
          }
          return true;
        }
        // END ADD
        try {
          const decisions = JSON.parse(
            rawText.replace(/```json|```/g, "").trim(),
          );
          for (const ans of decisions.answers || []) {
            const field = revealed[ans.fieldIndex];
            if (!field) continue;
            if (field.fieldType === "radio") {
              const allRadios = await page
                .locator(`input[type="radio"][name="${field.groupName}"]`)
                .all();
              const idx = ans.selectedIndex ?? 0;
              if (idx < allRadios.length) {
                await clickRadioOption(page, allRadios[idx]);
                await fillFollowupInput(page);
                console.log(
                  `[Rescan] ✓ Answered revealed radio "${field.groupName}" → option ${idx}: "${field.options[idx]}"`,
                );
              }
            } else if (field.fieldType === "select") {
              const allSels = await page.locator("select").all();
              for (const sel of allSels) {
                if (!(await sel.isVisible().catch(() => false))) continue;
                const curVal = await sel.inputValue().catch(() => "");
                if (curVal && curVal !== "") continue;
                const targetOpt = field.options?.[ans.selectedIndex];
                if (targetOpt?.value) {
                  await sel.selectOption(targetOpt.value).catch(() => {});
                  console.log(
                    `[Rescan] ✓ Answered revealed dropdown → "${targetOpt.label}"`,
                  );
                  break;
                }
              }
            }
          }
          return true;
        } catch (e) {
          console.warn("[Rescan] AI JSON parse failed:", e.message);
        }
      }
    } else {
      // No AI — handle revealed radios with random selection
      for (const field of revealed) {
        if (field.fieldType === "radio") {
          const allRadios = await page
            .locator(`input[type="radio"][name="${field.groupName}"]`)
            .all();
          if (allRadios.length > 0) {
            const idx = Math.floor(Math.random() * allRadios.length);
            await clickRadioOption(page, allRadios[idx]);
            await fillFollowupInput(page);
            console.log(
              `[Rescan] Random: revealed radio "${field.groupName}" → option ${idx}`,
            );
          }
        }
      }
      return true;
    }
  } catch (e) {
    console.warn("[Rescan] Error:", e.message);
  }
  return false;
};

// ══════════════════════════════════════════════════════════════════════════════
// FILL REMAINING INPUTS
// ══════════════════════════════════════════════════════════════════════════════
const fillRemainingInputs = async (page) => {
  try {
    let filled = 0;
    const inputs = await page
      .locator("input[type='text'], input[type='number']")
      .all();
    for (const input of inputs) {
      if (!(await input.isVisible().catch(() => false))) continue;
      const existing = await input.inputValue().catch(() => "");
      if (existing && existing.trim() !== "") continue;
      const isOrphanSpecBox = await input
        .evaluate((el) => {
          let node = el.parentElement;
          for (let i = 0; i < 6; i++) {
            if (!node) break;
            const radio = node.querySelector('input[type="radio"]');
            if (radio) return !radio.checked;
            node = node.parentElement;
          }
          return false;
        })
        .catch(() => false);
      if (isOrphanSpecBox) continue;
      const attrMin = await input.getAttribute("min").catch(() => null);
      const attrMax = await input.getAttribute("max").catch(() => null);
      const numMin =
        attrMin !== null && attrMin !== "" ? parseFloat(attrMin) : null;
      const numMax =
        attrMax !== null && attrMax !== "" ? parseFloat(attrMax) : null;
      const surroundText = await input
        .evaluate((el) => {
          let node = el.parentElement;
          for (let i = 0; i < 6; i++) {
            const t = (node?.innerText || "").trim();
            if (t.length > 5) return t;
            node = node?.parentElement;
          }
          return "";
        })
        .catch(() => "");
      const unit = detectUnit(surroundText);
      let value;
      if (numMin !== null && numMax !== null && numMax > numMin) {
        value = smartRound(
          numMin + Math.random() * (numMax - numMin),
          numMin,
          numMax,
        );
      } else if (numMax !== null && numMin === null) {
        value = valueForUnit(unit, 1, numMax);
      } else {
        const parsed = extractRange(
          surroundText,
          /\b(million|billion|mn|bn)\b/i.test(surroundText),
        );
        if (parsed && parsed.max > parsed.min) {
          value = smartRound(
            parsed.min + Math.random() * (parsed.max - parsed.min),
            parsed.min,
            parsed.max,
          );
        } else {
          value = valueForUnit(unit, numMin, numMax);
        }
      }
      await input.fill(String(value)).catch(() => {});
      filled++;
      console.log(
        `[Worker] ✓ Filled remaining input: ${value} (unit: ${unit})`,
      );
    }
    const selects = await page.locator("select").all();
    for (const sel of selects) {
      if (!(await sel.isVisible().catch(() => false))) continue;
      const current = await sel.inputValue().catch(() => "");
      const selectedText = await sel
        .evaluate((el) => el.options[el.selectedIndex]?.text || "")
        .catch(() => "");
      const isPlaceholder =
        !current ||
        current.trim() === "" ||
        /^(select one|--|please select|choose|select\.\.\.)/i.test(
          selectedText.trim(),
        );
      if (!isPlaceholder) continue;
      const optEls = await sel.locator("option").all();
      const validOpts = [];
      for (const opt of optEls) {
        const val = await opt.getAttribute("value").catch(() => "");
        const text = (await opt.textContent().catch(() => "")).trim();
        if (val && val !== "" && !/^(select one|--|please select)/i.test(text))
          validOpts.push(val);
      }
      if (validOpts.length > 0) {
        const chosen = validOpts[Math.floor(Math.random() * validOpts.length)];
        await sel.selectOption(chosen).catch(() => {});
        filled++;
        console.log(`[Worker] ✓ Filled remaining dropdown: "${chosen}"`);
      }
    }
    if (filled > 0)
      console.log(`[Worker] fillRemainingInputs: filled ${filled} field(s)`);
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
      [projectId],
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    const cm =
      typeof row.country_mapping === "string"
        ? JSON.parse(row.country_mapping)
        : row.country_mapping;
    if (!cm?.mappings?.length) return null;
    console.log(
      `[CountryLogic] Loaded — question: "${cm.questionContains}", countries: ${cm.mappings.map((m) => m.country).join(", ")}`,
    );
    return { ...row, country_mapping: cm };
  } catch (e) {
    console.warn("[CountryLogic] Load failed:", e.message);
    return null;
  }
};

const loadSessionScenario = async (
  projectId,
  sessionId,
  scenarioIds = null,
) => {
  try {
    if (Array.isArray(scenarioIds) && scenarioIds.length === 0) {
      console.log("[Scenario] No scenarios selected — skipping");
      return null;
    }
    let scenarios = await getActiveScenarios(projectId);
    if (!scenarios || scenarios.length === 0) return null;
    if (scenarioIds && scenarioIds.length > 0)
      scenarios = scenarios.filter((s) => scenarioIds.includes(s.id));
    const posResult = await pool.query(
      `SELECT COUNT(*) AS pos FROM sessions WHERE project_id = $1 AND created_at <= (SELECT created_at FROM sessions WHERE id = $2)`,
      [projectId, sessionId],
    );
    const pos = Math.max(0, parseInt(posResult.rows[0]?.pos || 1) - 1);
    const scenario = scenarios[pos % scenarios.length];
    let steps = scenario.steps;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      const stepsResult = await pool.query(
        `SELECT * FROM scenario_steps WHERE scenario_id = $1 ORDER BY step_order ASC`,
        [scenario.id],
      );
      steps = stepsResult.rows.map((r) => ({
        ...r,
        conditions:
          typeof r.conditions === "string"
            ? JSON.parse(r.conditions)
            : r.conditions || [],
        action_values:
          typeof r.action_values === "string"
            ? JSON.parse(r.action_values)
            : r.action_values || [],
      }));
    }
    console.log(
      `[Scenario] Assigned: "${scenario.name}" (${steps.length} steps) → session ${sessionId.slice(0, 8)}`,
    );
    return { ...scenario, steps };
  } catch (e) {
    console.warn("[Scenario] Load failed:", e.message);
    return null;
  }
};

const applyCountryMapping = async (
  page,
  countryLogic,
  proxyCountry,
  questionsOnPage,
) => {
  if (!countryLogic?.country_mapping) return false;
  const { questionContains, mappings } = countryLogic.country_mapping;
  if (!questionContains || !mappings?.length) return false;
  const hasCountryQ = questionsOnPage.some((q) =>
    q.toLowerCase().includes(questionContains.toLowerCase()),
  );
  if (!hasCountryQ) return false;

  // Resolve ISO code → full country name so mapping works regardless of
  // whether the mapping stores "IN" or "India"
  let resolvedCountryName = null;
  try {
    const cr = await pool.query(
      `SELECT country FROM proxy_countries WHERE UPPER(code) = UPPER($1) LIMIT 1`,
      [proxyCountry]
    );
    resolvedCountryName = cr.rows[0]?.country || null;
    if (resolvedCountryName) {
      console.log(`[CountryLogic] Resolved: ${proxyCountry} → "${resolvedCountryName}"`);
    }
  } catch {}

  // Match by ISO code OR full country name (handles both storage formats)
  const mapping = mappings.find((m) =>
    m.country.toUpperCase() === (proxyCountry || '').toUpperCase() ||
    (resolvedCountryName && m.country.toLowerCase() === resolvedCountryName.toLowerCase())
  );

  if (!mapping) {
    console.log(`[CountryLogic] No mapping for "${proxyCountry}" / "${resolvedCountryName}" — skipping`);
    return false;
  }
  const answer = mapping.answer;
  console.log(`[CountryLogic] Mapping: ${proxyCountry} → "${answer}"`);
  if (await clickLabelByText(page, answer)) {
    console.log(`[CountryLogic] ✓ Clicked label: "${answer}"`);
    return true;
  }
  const radios = await page.locator('input[type="radio"]').all();
  for (const radio of radios) {
    const id = await radio.getAttribute("id").catch(() => null);
    let labelText = "";
    if (id)
      labelText =
        (await page
          .locator(`label[for="${id}"]`)
          .textContent()
          .catch(() => "")) || "";
    if (!labelText)
      labelText =
        (await radio
          .locator("xpath=ancestor::label")
          .textContent()
          .catch(() => "")) || "";
    if (labelText.trim() === answer) {
      await clickRadioOption(page, radio);
      console.log(`[CountryLogic] ✓ Clicked radio: "${answer}"`);
      return true;
    }
  }
  for (const sel of await page.locator("select").all()) {
    try {
      await sel.selectOption({ label: answer });
      console.log(`[CountryLogic] ✓ Selected dropdown: "${answer}"`);
      return true;
    } catch {}
  }
  console.warn(`[CountryLogic] ✗ Could not find option "${answer}" on page`);
  return false;
};

const matchStep = (step, questionsOnPage, pageNum) => {
  const { when_type, when_value } = step;
  if (when_type === "always") return true;
  if (when_type === "page_number") return parseInt(when_value) === pageNum;
  if (when_type === "question_contains") {
    const normalize = (str) =>
      (str || "")
        .toLowerCase()
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/\s+/g, " ")
        .trim();
    const needle = normalize(when_value);
    if (!needle) {
      console.warn(`[Scenario] ✗ Step skipped — when_value empty`);
      return false;
    }
    const match = questionsOnPage.some((q) => normalize(q).includes(needle));
    if (match) console.log(`[Scenario] ✓ Step matched: "${when_value}"`);
    else console.log(`[Scenario] ✗ No match for "${when_value}"`);
    return match;
  }
  if (when_type === "question_position")
    return questionsOnPage.length >= parseInt(when_value || 1);
  return false;
};

const hasFollowupField = async (radio) => {
  try {
    return await radio.evaluate((el) => {
      let node = el.parentElement;
      for (let i = 0; i < 5; i++) {
        if (!node) break;
        if (
          node.querySelector(
            'input[type="text"], input[type="number"], textarea',
          )
        )
          return true;
        if (node.querySelectorAll('input[type="radio"]').length > 1) break;
        node = node.parentElement;
      }
      return false;
    });
  } catch {
    return false;
  }
};

const partitionByFollowup = async (options) => {
  const clean = [],
    withFollowup = [];
  for (let i = 0; i < options.length; i++) {
    if (await hasFollowupField(options[i])) withFollowup.push(i);
    else clean.push(i);
  }
  return { clean, withFollowup };
};

const executeScenarioAction = async (page, step) => {
  const { action, action_values, action_mode, action_text, duration_s } = step;
  const vals = Array.isArray(action_values)
    ? action_values.map((v) => parseInt(v))
    : [];
  console.log(`[Scenario] Executing: "${action}" vals: [${vals.join(",")}]`);
  try {
    if (action === "skip") {
      return [];
    }
    if (action === "wait") {
      await page.waitForTimeout((duration_s || 5) * 1000);
      return [];
    }
    if (action === "back") {
      await page
        .locator('input[value="Back"], button:has-text("Back"), .back-button')
        .first()
        .click({ timeout: 5000 })
        .catch(() => {});
      return [];
    }
    if (action === "open_end") {
      if (action_mode === "specific" && action_text) {
        const fields = await page.locator("textarea, input[type='text']").all();
        for (const field of fields) {
          if (await field.isVisible().catch(() => false))
            await field.fill(action_text).catch(() => {});
        }
        return [{ type: "open-end", text: action_text }];
      }
      return null;
    }
    const getRadioGroups = async () => {
      const allRadios = await page.locator("input[type='radio']").all();
      const groupMap = {};
      const groupOrder = [];
      for (const radio of allRadios) {
        const name = await radio.getAttribute("name").catch(() => null);
        if (!name) continue;
        if (!groupMap[name]) {
          groupMap[name] = [];
          groupOrder.push(name);
        }
        groupMap[name].push(radio);
      }
      console.log(`[Scenario] Found ${groupOrder.length} radio group(s)`);
      return { groupMap, groupOrder };
    };
    if (action === "select_exact") {
      if (vals.length === 0) {
        console.warn("[Scenario] select_exact: no values — skipping");
        return null;
      }
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const targetIdx = (vals[0] || 1) - 1;
      if (targetIdx >= 0 && targetIdx < options.length) {
        await clickRadioOption(page, options[targetIdx]);
        await fillFollowupInput(page);
        console.log(`[Scenario] select_exact → option ${targetIdx + 1}`);
      } else {
        console.warn(`[Scenario] select_exact: option ${vals[0]} out of range`);
        return null;
      }
      return [{ type: "radio", scenarioControlled: true }];
    }
    if (action === "select_one_of") {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const valid = vals.filter((v) => v >= 1 && v <= options.length);
      if (valid.length === 0) {
        console.warn(`[Scenario] select_one_of: no valid options`);
        return null;
      }
      const { clean } = await partitionByFollowup(
        valid.map((v) => options[v - 1]),
      );
      const preferredIndices =
        clean.length > 0 ? clean.map((ci) => valid[ci]) : valid;
      const chosen =
        preferredIndices[Math.floor(Math.random() * preferredIndices.length)];
      await clickRadioOption(page, options[chosen - 1]);
      await fillFollowupInput(page);
      console.log(`[Scenario] select_one_of → option ${chosen}`);
      return [{ type: "radio", scenarioControlled: true }];
    }
    if (action === "select_not_in") {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const excludeIdxs = new Set(vals.map((v) => v - 1));
      const available = options.filter((_, i) => !excludeIdxs.has(i));
      if (available.length === 0) return null;
      const { clean } = await partitionByFollowup(available);
      const candidatePool =
        clean.length > 0 ? clean.map((ci) => available[ci]) : available;
      const chosen =
        candidatePool[Math.floor(Math.random() * candidatePool.length)];
      await clickRadioOption(page, chosen);
      await fillFollowupInput(page);
      console.log(
        `[Scenario] select_not_in → picked from ${available.length} available`,
      );
      return [{ type: "radio", scenarioControlled: true }];
    }
    if (action === "select_random") {
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0) return null;
      const options = groupMap[groupOrder[0]];
      const idx = Math.floor(Math.random() * options.length);
      await clickRadioOption(page, options[idx]);
      await fillFollowupInput(page);
      return [{ type: "radio", scenarioControlled: true }];
    }
    if (action === "select_grid") {
      let rowSelections = [];
      try {
        rowSelections = JSON.parse(action_text || "[]");
      } catch {}
      const { groupMap, groupOrder } = await getRadioGroups();
      if (groupOrder.length === 0 || rowSelections.length === 0) return null;
      for (
        let ri = 0;
        ri < rowSelections.length && ri < groupOrder.length;
        ri++
      ) {
        const colIdx = (parseInt(rowSelections[ri].col) || 1) - 1;
        const options = groupMap[groupOrder[ri]];
        if (colIdx >= 0 && colIdx < options.length)
          await clickRadioOption(page, options[colIdx]);
      }
      console.log(`[Scenario] select_grid → ${rowSelections.length} row(s)`);
      return [{ type: "grid", scenarioControlled: true }];
    }
    if (action === "numeric_fill") {
      const min = parseFloat(vals[0] ?? 0);
      const max = parseFloat(vals[1] ?? 100);
      const roundTo = parseFloat(action_text) || 1;
      const midpoint = (min + max) / 2;
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
        console.log(`[Scenario] numeric_fill → ${results.join(", ")}`);
        return [{ type: "numeric", values: results, scenarioControlled: true }];
      }
      const allRadios = await page.locator('input[type="radio"]').all();
      const groupMap = {};
      const groupOrder = [];
      for (const r of allRadios) {
        const name = await r.getAttribute("name").catch(() => null);
        if (!name) continue;
        if (!groupMap[name]) {
          groupMap[name] = [];
          groupOrder.push(name);
        }
        groupMap[name].push(r);
      }
      if (groupOrder.length > 0) {
        const options = groupMap[groupOrder[0]];
        let bestRadio = null;
        let bestIdx = -1;
        let fallbackRadio = null;
        let fallbackIdx = Math.floor(options.length / 2);
        for (let i = 0; i < options.length; i++) {
          const radio = options[i];
          const id = await radio.getAttribute("id").catch(() => null);
          let labelText = "";
          if (id)
            labelText =
              (await page
                .locator(`label[for="${id}"]`)
                .textContent()
                .catch(() => "")) || "";
          if (!labelText)
            labelText =
              (await radio
                .locator("xpath=ancestor::label")
                .textContent()
                .catch(() => "")) || "";
          const hasMillion = /\b(million|mn)\b/i.test(labelText);
          const hasBillion = /\b(billion|bn)\b/i.test(labelText);
          const range = extractRange(labelText, hasMillion || hasBillion);
          if (range && midpoint >= range.min && midpoint <= range.max) {
            bestRadio = radio;
            bestIdx = i;
            break;
          }
          if (/less than|under|below/i.test(labelText)) {
            const nums = labelText.match(/[\d,.]+/g);
            if (nums) {
              const threshold = parseNum(nums[0], hasMillion || hasBillion);
              if (threshold && midpoint < threshold && !bestRadio) {
                bestRadio = radio;
                bestIdx = i;
              }
            }
          }
          if (/over|more than|greater than|above/i.test(labelText)) {
            const nums = labelText.match(/[\d,.]+/g);
            if (nums) {
              const threshold = parseNum(nums[0], hasMillion || hasBillion);
              if (threshold && midpoint > threshold) {
                fallbackRadio = radio;
                fallbackIdx = i;
              }
            }
          }
        }
        const chosenRadio = bestRadio || fallbackRadio || options[fallbackIdx];
        if (chosenRadio) {
          await clickRadioOption(page, chosenRadio);
          await fillFollowupInput(page);
          return [
            {
              type: "numeric",
              values: [Math.round(midpoint)],
              scenarioControlled: true,
            },
          ];
        }
      }
      const allTextInputs = await page.locator("input[type='text']").all();
      const results = [];
      for (const inp of allTextInputs) {
        if (!(await inp.isVisible().catch(() => false))) continue;
        const existing = await inp.inputValue().catch(() => "");
        if (existing && existing.trim() !== "") continue;
        const raw = min + Math.random() * (max - min);
        const rounded = Math.round(raw / roundTo) * roundTo;
        await inp.fill(String(rounded)).catch(() => {});
        results.push(rounded);
      }
      return [{ type: "numeric", values: results, scenarioControlled: true }];
    }
  } catch (e) {
    console.warn(`[Scenario] Action "${action}" threw: ${e.message}`);
    return null;
  }
  return null;
};

const findMatchingStep = (scenario, questionsOnPage, pageNum) => {
  if (!scenario?.steps?.length) return null;
  for (const step of scenario.steps) {
    if (matchStep(step, questionsOnPage, pageNum)) return step;
  }
  return null;
};

// ══════════════════════════════════════════════════════════════════════════════
// PERSONA CONTEXT BUILDER — upgraded with structured lookup and answering rules
// ══════════════════════════════════════════════════════════════════════════════
const buildPersonaContext = (persona) => {
  if (!persona)
    return [
      "You are a realistic survey respondent — a mid-level professional in a corporate setting.",
      "Age: 30–45. Gender: unspecified. Country: India. Language: English.",
      "You answer all questions honestly and consistently as this type of person.",
      "You are not extreme in any view — you are measured, practical, and grounded.",
    ].join("\n");

  const attrs = persona.behavioural_attrs || {};
  const isB2B = !!(attrs.designation || attrs.department || attrs.industry);

  const lines = [
    "══════════════════════════════════════════",
    "WHO YOU ARE — embody this person completely.",
    "Every answer must sound like it comes from THIS specific person.",
    "══════════════════════════════════════════",
    "",
    "── CORE IDENTITY ──",
  ];

  if (persona.name) lines.push(`Persona Label: ${persona.name}`);
  if (persona.country) lines.push(`Country: ${persona.country}`);
  if (persona.language) lines.push(`Language: ${persona.language}`);
  if (persona.age_min && persona.age_max)
    lines.push(`Age Range: ${persona.age_min}–${persona.age_max} years old`);
  else if (persona.age_min) lines.push(`Age: ${persona.age_min}+ years old`);
  if (persona.gender) lines.push(`Gender: ${persona.gender}`);
  if (attrs.educationLevel) lines.push(`Education: ${attrs.educationLevel}`);
  if (attrs.maritalStatus) lines.push(`Marital Status: ${attrs.maritalStatus}`);
  if (attrs.childrenStatus)
    lines.push(`Children / Dependants: ${attrs.childrenStatus}`);
  if (attrs.annualIncome)
    lines.push(`Annual Personal Income: ${attrs.annualIncome}`);

  if (isB2B) {
    lines.push("", "── PROFESSIONAL PROFILE ──");
    if (attrs.designation) lines.push(`Job Title: ${attrs.designation}`);
    if (attrs.department)
      lines.push(`Department / Function: ${attrs.department}`);
    if (attrs.industry) lines.push(`Industry: ${attrs.industry}`);
    if (attrs.companyRevenue)
      lines.push(`Company Annual Revenue: ${attrs.companyRevenue}`);
    if (attrs.employeeSize)
      lines.push(`Company Size (employees): ${attrs.employeeSize}`);
  }

  lines.push("", "── DEVICE & SURVEY BEHAVIOUR ──");
  if (persona.device_type) lines.push(`Device: ${persona.device_type}`);
  if (attrs.deviceOs) lines.push(`Operating System: ${attrs.deviceOs}`);
  if (attrs.browser) lines.push(`Browser: ${attrs.browser}`);
  if (attrs.readingSpeed) lines.push(`Reading Style: ${attrs.readingSpeed}`);
  if (attrs.responseStyle) lines.push(`Response Style: ${attrs.responseStyle}`);

  if (attrs.behaviouralTags?.length > 0) {
    lines.push("", "── BEHAVIOURAL PROFILE ──");
    lines.push(attrs.behaviouralTags.join(" · "));
  }

  if (attrs.secondaryDescription) {
    lines.push("", "── FULL CHARACTER BRIEF ──");
    lines.push(
      "Read this carefully — it defines your mindset, priorities, opinions, and habits:",
    );
    lines.push(attrs.secondaryDescription);
  }

  lines.push("", "── HOW YOU ANSWER THIS SURVEY ──");
  lines.push(
    "1. You answer as this specific person — not as a generic AI respondent.",
  );
  lines.push(
    "2. Your opinions, experiences, and choices are consistent with your background above.",
  );
  lines.push(
    "3. You are not gaming the survey — you answer honestly as this persona.",
  );
  lines.push(
    "4. You use natural variation — you do not always pick the middle or safe option.",
  );
  lines.push(
    `5. Response style: ${attrs.responseStyle || "balanced and measured — not too brief, not too elaborate"}.`,
  );
  lines.push(
    "6. You keep all answers consistent with everything you have answered before in this session.",
  );

  // ── HARD CONSTRAINTS — non-negotiable persona facts ──────────────────────
  // These are injected separately so the AI treats them as deterministic,
  // not as background colour. AI must find the closest matching survey option.
  const constraints = [];
  if (persona.country)             constraints.push(`• Respondent country / location → ${persona.country}`);
  const a = persona.behavioural_attrs || {};
  if (a.industry)                  constraints.push(`• Industry / sector → ${a.industry}`);
  if (a.designation)               constraints.push(`• Job title / role → ${a.designation}`);
  if (a.department)                constraints.push(`• Department / function → ${a.department}`);
  if (a.companyRevenue)            constraints.push(`• Company annual revenue → ${a.companyRevenue}`);
  if (a.employeeSize)              constraints.push(`• Company size (employees) → ${a.employeeSize}`);
  if (persona.age_min && persona.age_max)
                                   constraints.push(`• Age → ${persona.age_min}–${persona.age_max} years old`);
  if (persona.gender)              constraints.push(`• Gender → ${persona.gender}`);

  if (constraints.length > 0) {
    lines.push('');
    lines.push('── HARD CONSTRAINTS (non-negotiable) ──');
    lines.push('When a survey question relates to any item below, you MUST select');
    lines.push('the closest matching option available — even if the wording differs.');
    lines.push('Do NOT deviate from these facts under any circumstances:');
    constraints.forEach(c => lines.push(c));
  }

  return lines.join("\n");
};

const buildScenarioContext = (scenario) => {
  if (!scenario || scenario.name === "Country Logic") return "";
  const lines = ["SCENARIO DIRECTIVE (steer your answers toward this goal):"];
  if (scenario.name) lines.push(`Scenario: ${scenario.name}`);
  if (scenario.description) lines.push(`Goal: ${scenario.description}`);
  if (scenario.expected_outcome)
    lines.push(`Expected outcome: ${scenario.expected_outcome}`);
  return lines.length > 1 ? lines.join("\n") : "";
};

// ══════════════════════════════════════════════════════════════════════════════
// CAPTURE ALL PAGE FIELDS
// ══════════════════════════════════════════════════════════════════════════════
const captureAllPageFields = async (page) => {
  try {
    return await page.evaluate(() => {
      const fields = [];
      const radioGroups = {};
      const radioOrder = [];
      document.querySelectorAll('input[type="radio"]').forEach((r) => {
        if (!r.offsetParent || !r.name) return;
        if (!radioGroups[r.name]) {
          radioGroups[r.name] = [];
          radioOrder.push(r.name);
        }
        let label = "";
        if (r.id) {
          const lbl = document.querySelector(`label[for="${r.id}"]`);
          if (lbl) label = (lbl.innerText || "").trim();
        }
        if (!label) {
          const pl = r.closest("label");
          if (pl) label = (pl.innerText || "").trim();
        }
        radioGroups[r.name].push({ label, checked: r.checked });
      });
      radioOrder.forEach((name, gi) => {
        const firstRadio = document.querySelectorAll(
          `input[type="radio"][name="${name}"]`,
        )[0];
        let questionLabel = "";
        const qblock = firstRadio?.closest(
          '.qblock, .question, [class*="qblock"]',
        );
        if (qblock) {
          const qt = qblock.querySelector(
            ".qtext, .question-text, legend, h2, h3",
          );
          if (qt) questionLabel = (qt.innerText || "").trim().slice(0, 150);
        }
        fields.push({
          fieldType: "radio",
          groupIndex: gi,
          groupName: name,
          questionLabel,
          options: radioGroups[name].map((r) => r.label),
        });
      });
      const cbGroups = {};
      const cbOrder = [];
      document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        if (!cb.offsetParent) return;
        const name = cb.name || cb.closest("fieldset")?.id || "cb_group";
        if (!cbGroups[name]) {
          cbGroups[name] = [];
          cbOrder.push(name);
        }
        let label = "";
        if (cb.id) {
          const lbl = document.querySelector(`label[for="${cb.id}"]`);
          if (lbl) label = (lbl.innerText || "").trim();
        }
        if (!label) {
          const pl = cb.closest("label");
          if (pl) label = (pl.innerText || "").trim();
        }
        cbGroups[name].push({ label, checked: cb.checked });
      });
      cbOrder.forEach((name, gi) => {
        let questionLabel = "";
        const firstCb = document.querySelector(
          `input[type="checkbox"][name="${name}"]`,
        );
        const qblock = firstCb?.closest(
          '.qblock, .question, [class*="qblock"]',
        );
        if (qblock) {
          const qt = qblock.querySelector(
            ".qtext, .question-text, legend, h2, h3",
          );
          if (qt) questionLabel = (qt.innerText || "").trim().slice(0, 150);
        }
        fields.push({
          fieldType: "checkbox",
          groupIndex: gi,
          groupName: name,
          questionLabel,
          options: cbGroups[name].map((c) => c.label),
        });
      });
      let selIdx = 0;
      document.querySelectorAll("select").forEach((sel) => {
        if (!sel.offsetParent) return;
        const currentText = sel.options[sel.selectedIndex]?.text || "";
        const isPlaceholder =
          !sel.value ||
          sel.value === "" ||
          /^(select one|--|please select|choose)/i.test(currentText);
        if (!isPlaceholder) {
          selIdx++;
          return;
        }
        let questionLabel = "";
        const qblock = sel.closest('.qblock, .question, [class*="qblock"]');
        if (qblock) {
          const qt = qblock.querySelector(
            ".qtext, .question-text, legend, h2, h3",
          );
          if (qt) questionLabel = (qt.innerText || "").trim().slice(0, 150);
        }
        const opts = Array.from(sel.options)
          .filter(
            (o) =>
              o.value &&
              o.value !== "" &&
              !/^(select one|--|please select)/i.test(o.text),
          )
          .map((o) => ({ value: o.value, label: o.text.trim() }));
        fields.push({
          fieldType: "select",
          selectIndex: selIdx,
          questionLabel,
          options: opts,
        });
        selIdx++;
      });
      let taIdx = 0;
      document.querySelectorAll("textarea").forEach((ta) => {
        if (!ta.offsetParent) return;
        if (ta.value && ta.value.trim() !== "") {
          taIdx++;
          return;
        }
        let questionLabel = "";
        const qblock = ta.closest('.qblock, .question, [class*="qblock"]');
        if (qblock) {
          const qt = qblock.querySelector(
            ".qtext, .question-text, legend, h2, h3",
          );
          if (qt) questionLabel = (qt.innerText || "").trim().slice(0, 200);
        }
        if (!questionLabel) {
          let node = ta.parentElement;
          for (let i = 0; i < 6; i++) {
            const t = (node?.innerText || "").trim();
            if (t.length > 8 && t.length < 300) {
              questionLabel = t.slice(0, 200);
              break;
            }
            node = node?.parentElement;
          }
        }
        fields.push({
          fieldType: "textarea",
          textareaIndex: taIdx,
          questionLabel,
          placeholder: ta.placeholder || "",
        });
        taIdx++;
      });
      let inpIdx = 0;
      document
        .querySelectorAll("input[type='text'], input[type='number']")
        .forEach((inp) => {
          if (!inp.offsetParent) return;
          if (inp.value && inp.value.trim() !== "") {
            inpIdx++;
            return;
          }
          let unitLabel = "";
          const parent = inp.parentElement;
          if (parent) {
            Array.from(parent.childNodes).forEach((sib) => {
              if (sib === inp) return;
              const t = (sib.textContent || "").trim();
              if (t && t.length < 20) unitLabel = t;
            });
          }
          let rowLabel = "",
            columnHeader = "";
          const td = inp.closest("td");
          if (td) {
            const tr = td.closest("tr");
            const table = td.closest("table");
            if (tr && table) {
              const allCells = Array.from(tr.querySelectorAll("td, th"));
              const colIdx = allCells.indexOf(td);
              const headerRow = table.querySelector("thead tr, tr:first-child");
              if (headerRow) {
                const headers = Array.from(
                  headerRow.querySelectorAll("th, td"),
                );
                if (headers[colIdx])
                  columnHeader = (headers[colIdx].innerText || "")
                    .trim()
                    .slice(0, 60);
              }
              for (const cell of allCells) {
                if (!cell.querySelector("input")) {
                  const t = (cell.innerText || "").trim();
                  if (t) {
                    rowLabel = t.slice(0, 80);
                    break;
                  }
                }
              }
            }
          }
          let contextText = "";
          let node = inp.parentElement;
          for (let i = 0; i < 8; i++) {
            const t = (node?.innerText || "").trim();
            if (t.length > 8 && t.length < 400) {
              contextText = t.slice(0, 200);
              break;
            }
            node = node?.parentElement;
          }
          fields.push({
            fieldType: "input",
            inputIndex: inpIdx,
            rowLabel,
            columnHeader,
            unitLabel,
            contextText,
            placeholder: inp.placeholder || "",
            min: inp.min || null,
            max: inp.max || null,
          });
          inpIdx++;
        });
      return fields;
    });
  } catch (e) {
    console.warn("[AI] captureAllPageFields error:", e.message);
    return [];
  }
};

const formatFieldsForPrompt = (fields) => {
  if (!fields || fields.length === 0)
    return "None — this may be an intro or transition page.";
  return fields
    .map((f, i) => {
      switch (f.fieldType) {
        case "radio": {
          const opts = f.options
            .map((o, idx) => `  [${idx}] ${o || "(unlabelled)"}`)
            .join("\n");
          return `[${i}] RADIO — "${f.questionLabel || "question"}"\n${opts}`;
        }
        case "checkbox": {
          const opts = f.options
            .map((o, idx) => `  [${idx}] ${o || "(unlabelled)"}`)
            .join("\n");
          return `[${i}] CHECKBOX (select 1–4 that make sense together) — "${f.questionLabel || "question"}"\n${opts}`;
        }
        case "select": {
          const opts = f.options
            .map((o, idx) => `  [${idx}] ${o.label}`)
            .join("\n");
          return `[${i}] DROPDOWN — "${f.questionLabel || "question"}"\n${opts}`;
        }
        case "textarea":
          return `[${i}] OPEN-END TEXT — "${f.questionLabel || f.placeholder || "open response"}"`;
        case "input": {
          const parts = [];
          if (f.rowLabel) parts.push(`row: "${f.rowLabel}"`);
          if (f.columnHeader) parts.push(`column: "${f.columnHeader}"`);
          if (f.unitLabel) parts.push(`unit: "${f.unitLabel}"`);
          if (f.min || f.max)
            parts.push(`range: ${f.min ?? "?"}–${f.max ?? "?"}`);
          const meta = parts.length > 0 ? ` [${parts.join(", ")}]` : "";
          return `[${i}] NUMERIC INPUT${meta} — context: "${f.contextText?.slice(0, 100) || f.placeholder || "numeric field"}"`;
        }
        default:
          return `[${i}] UNKNOWN FIELD`;
      }
    })
    .join("\n\n");
};

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-PROVIDER AI CALLER
// ══════════════════════════════════════════════════════════════════════════════
const callAIProvider = async (
  providerConfig,
  {
    systemPrompt,
    staticPart,
    dynamicPart,
    maxTokens = 1400,
    isSearch = false,
    searchPrompt = null,
  },
) => {
  const { provider_type, api_key, model } = providerConfig;

  if (provider_type === "anthropic") {
    const callWithRetry = async (body, maxRetries = 4) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
          },
          body: JSON.stringify(body),
        });
        if (res.ok) return res;
        if (res.status === 429 || res.status === 529) {
          const retryAfter = parseInt(res.headers?.get?.("retry-after") || "0");
          if (retryAfter > 60) {
            console.warn(
              `[AI] Rate limited — retry-after ${retryAfter}s too long`,
            );
            return null;
          }
          const waitMs =
            retryAfter > 0
              ? retryAfter * 1000
              : Math.min(1000 * Math.pow(2, attempt), 30000);
          console.warn(
            `[AI] Rate limited (${res.status}) — attempt ${attempt}/${maxRetries}, waiting ${Math.round(waitMs / 1000)}s`,
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        console.warn(`[AI] Anthropic error ${res.status}`);
        return res;
      }
      return null;
    };
    if (isSearch && searchPrompt) {
      const res = await callWithRetry({
        model,
        max_tokens: 500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: searchPrompt }],
      });
    if (!res?.ok) return null;
      const data = await res.json();
      return {
        text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"),
        inputTokens:  data.usage?.input_tokens  || 0,
        outputTokens: data.usage?.output_tokens || 0,
      };
    }
    const res = await callWithRetry({
      model,
      max_tokens: maxTokens,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: staticPart,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: dynamicPart },
          ],
        },
      ],
    });
  if (!res?.ok) return null;
    const data = await res.json();
    return {
      text:         data.content?.[0]?.text || "",
      inputTokens:  data.usage?.input_tokens  || 0,
      outputTokens: data.usage?.output_tokens || 0,
    };
  }

  // OpenRouter / OpenAI
  const baseUrl =
    providerConfig.base_url ||
    (provider_type === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions");
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${api_key}`,
  };
  if (provider_type === "openrouter") {
    headers["HTTP-Referer"] = "https://surveyqa.pro";
    headers["X-Title"] = "SurveyQA Pro";
  }
  const callWithRetry = async (body, maxRetries = 3) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) return res;
      if (res.status === 429) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.warn(
          `[AI] ${provider_type} rate limited — waiting ${Math.round(waitMs / 1000)}s`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      console.warn(`[AI] ${provider_type} error ${res.status}`);
      return res;
    }
    return null;
  };
  if (isSearch && searchPrompt) {
    const res = await callWithRetry({
      model,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: "Provide current industry benchmarks and realistic figures.",
        },
        { role: "user", content: searchPrompt },
      ],
    });
  if (!res?.ok) return null;
    const data = await res.json();
    return {
      text:         data.choices?.[0]?.message?.content || '',
      inputTokens:  data.usage?.prompt_tokens     || 0,
      outputTokens: data.usage?.completion_tokens || 0,
    };
  }

  const fullUserContent = staticPart + "\n\n" + dynamicPart;
  const res = await callWithRetry({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: fullUserContent },
    ],
  });
if (!res?.ok) return null;
  const data = await res.json();
  return {
    text:         data.choices?.[0]?.message?.content || '',
    inputTokens:  data.usage?.prompt_tokens     || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
};

// ══════════════════════════════════════════════════════════════════════════════
// AI ANSWER ENGINE — answerPageWithAI
// ══════════════════════════════════════════════════════════════════════════════
const answerPageWithAI = async (
  page,
  persona,
  scenario,
  factSheet,
  intentMap,
  quotaCellText,
  questionsOnPage,
  pageOptions,
  providerConfig,
) => {
  try {
    if (!providerConfig?.api_key) {
      console.warn("[AI] No provider config — falling back to random");
      return null;
    }
    const allFields = await captureAllPageFields(page);
    const actionableFields = allFields.filter((f) =>
      ["radio", "checkbox", "select", "textarea", "input"].includes(
        f.fieldType,
      ),
    );
    if (actionableFields.length === 0) {
      console.log("[AI] No actionable fields");
      return null;
    }

    const personaContext = buildPersonaContext(persona);
    const scenarioContext = buildScenarioContext(scenario);

    const factSheetLines = [];
    for (const [k, v] of Object.entries(factSheet || {})) {
      if (k === "pageHistory") continue;
      if (v === null || v === undefined) continue;
      if (typeof v === "object" && !Array.isArray(v)) {
        const inner = Object.entries(v)
          .filter(
            ([, iv]) =>
              iv !== null && (Array.isArray(iv) ? iv.length > 0 : true),
          )
          .map(
            ([ik, iv]) =>
              `  ${ik}: ${Array.isArray(iv) ? iv.join(", ") : JSON.stringify(iv)}`,
          );
        if (inner.length) factSheetLines.push(`${k}:\n${inner.join("\n")}`);
      } else {
        factSheetLines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
      }
    }
    const factSheetText =
      factSheetLines.join("\n") ||
      "No committed facts yet — establish baseline from persona.";

    const pageHistory = factSheet?.pageHistory || [];
    let fullHistoryText;
    if (pageHistory.length === 0) {
      fullHistoryText =
        "  No prior answers yet — this is the first answerable page.";
    } else if (pageHistory.length <= 20) {
      fullHistoryText = pageHistory
        .map(
          (h) =>
            `  [Page ${h.page}] "${h.question.slice(0, 120)}" → "${h.answer.slice(0, 150)}"`,
        )
        .join("\n");
    } else {
      const recent = pageHistory.slice(-20);
      const older = pageHistory.slice(0, -20);
      const olderSummary = older
        .map(
          (h) =>
            `${h.question.slice(0, 60).replace(/\s+/g, " ")}: ${h.answer.slice(0, 80)}`,
        )
        .join(" | ");
      fullHistoryText =
        `  SUMMARY OF EARLIER PAGES (${older.length} answers):\n  ${olderSummary}\n\n  RECENT PAGES (verbatim):\n` +
        recent
          .map(
            (h) =>
              `  [Page ${h.page}] "${h.question.slice(0, 120)}" → "${h.answer.slice(0, 150)}"`,
          )
          .join("\n");
    }

    const normalize = (s) => (s || "").toLowerCase().trim();
    const pageTextLower = questionsOnPage.map(normalize).join(" ");
    const matchIntent = (intent) => {
      if (!intent.when_value && intent.when_type !== "always") return false;
      if (intent.when_type === "always") return true;
      if (intent.when_type === "page_number") return false;
      return pageTextLower.includes(normalize(intent.when_value));
    };
    const matchingInstructions = (intentMap?.instructions || []).filter(
      matchIntent,
    );
    const intentConstraintsText =
      matchingInstructions.length > 0
        ? matchingInstructions
            .map((i) => `• WHEN "${i.when_value}": ${i.naturalInstruction}`)
            .join("\n")
        : "No specific scenario constraints for this page — answer naturally as this persona.";

    let webSearchContext = "";
    const flags = [];
    const needsWebSearch =
      actionableFields.some(
        (f) => f.fieldType === "textarea" || f.fieldType === "input",
      ) &&
      questionsOnPage.some((q) =>
        /revenue|budget|spend|growth|percent|employee|headcount|market|cost|price|salary|benchmark/i.test(
          q,
        ),
      );
    if (needsWebSearch) {
      flags.push("web_search_used");
      try {
        const attrs = persona?.behavioural_attrs || {};
        const searchPrompt = `Current benchmarks for: ${questionsOnPage.join(". ")}. Context: ${attrs.designation || "executive"} in ${attrs.industry || "enterprise"}.`;
        const searchResult = await callAIProvider(providerConfig, {
          systemPrompt: "Provide industry benchmarks.",
          staticPart: "",
          dynamicPart: "",
          isSearch: true,
          searchPrompt,
        });
        const searchText = typeof searchResult === 'object' ? (searchResult?.text || '') : (searchResult || '');
        webSearchContext = searchText.slice(0, 600);
        if (webSearchContext)
          console.log(`[AI] Web search: ${webSearchContext.length} chars`);
      } catch (e) {
        console.warn("[AI] Web search error:", e.message);
      }
    }

    const systemPrompt = `You are simulating a real human survey respondent with a consistent life story. Your answers must be realistic, internally coherent, and NEVER contradict the session fact sheet. You respond ONLY with valid JSON — no markdown, no explanation outside JSON.`;

    const staticPromptPart = `═══════════════════════════════════════════════
PERSONA — YOU ARE THIS PERSON
═══════════════════════════════════════════════
${personaContext}

═══════════════════════════════════════════════
QUOTA CELL YOU ARE FILLING
═══════════════════════════════════════════════
${quotaCellText}
Your screener answers MUST qualify for this demographic cell.

${scenarioContext ? `═══════════════════════════════════════════════\n${scenarioContext}\n═══════════════════════════════════════════════\n` : ""}`;

    const dynamicPromptPart = `═══════════════════════════════════════════════
SCENARIO & ROUTING CONSTRAINTS FOR THIS PAGE
═══════════════════════════════════════════════
${intentConstraintsText}

═══════════════════════════════════════════════
SEMANTIC FACT SHEET — NEVER CONTRADICT THESE
═══════════════════════════════════════════════
${factSheetText}

═══════════════════════════════════════════════
FULL ANSWER HISTORY
═══════════════════════════════════════════════
${fullHistoryText}

${webSearchContext ? `═══════════════════════════════════════════════\nWEB SEARCH BENCHMARKS\n═══════════════════════════════════════════════\n${webSearchContext}\n` : ""}
═══════════════════════════════════════════════
QUESTIONS ON THIS PAGE
═══════════════════════════════════════════════
${questionsOnPage.length > 0 ? questionsOnPage.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(No question text detected)"}

═══════════════════════════════════════════════
FIELDS TO FILL
═══════════════════════════════════════════════
${formatFieldsForPrompt(actionableFields)}

═══════════════════════════════════════════════
QUESTION TYPE GUIDE — HOW TO ANSWER EACH TYPE
═══════════════════════════════════════════════

RADIO (single select):
- Select exactly ONE option that best matches this persona.
- RATING SCALES (Strongly agree → Strongly disagree, or reverse):
  Read label order carefully — do not assume direction.
  Satisfied persona: top 2 of 5, or 4 of 5. Neutral: 3 of 5.
- SATISFACTION / NPS (1–5, 1–7, 0–10):
  Satisfied = 4–5 of 5, or 7–8 of 10. Neutral = 3 of 5, or 6 of 10. NPS satisfied = 8–9.
- FREQUENCY (Never/Rarely/Sometimes/Often/Always): match persona's actual habits.
- AGREEMENT: express this persona's genuine view — do not always pick "Agree".
- IMPORTANCE: pick what genuinely matters for this persona's role and context.
- SENIORITY / JOB TITLE: use exact job title from profile — pick closest match.
- COMPANY SIZE: use stated employee count — pick the band that contains it.
- REVENUE / BUDGET: use stated revenue — pick the band that contains it.
- AGE: pick the band that contains the persona's stated age range.
- GENDER: match stated gender exactly.
- COUNTRY / REGION: use stated country — match exactly or pick closest.
- INDUSTRY: use stated industry — match exactly or pick closest sector.

CHECKBOX (multi-select):
- Read instruction carefully: "Select all that apply" vs "Select up to 3" vs "Select at least 2".
- Never select contradictory options (e.g. "Use daily" AND "Never use").
- Never select "None of the above" alongside other options.
- BRAND AWARENESS: only tick brands this persona would genuinely know in their industry/role.
- CHANNELS / MEDIA: tick what this persona actually uses based on their profile and tags.
- Typical count: 2–4 unless persona naturally uses more or the question asks for fewer.
- Do NOT select "Don't know" or "None" unless the persona genuinely has no experience.

DROPDOWN (select):
- Treat exactly like RADIO — single select, best fit for this persona.
- Never pick the placeholder ("Select one", "--", "Please choose").

OPEN-END TEXT (textarea):
- Write in first person as this specific persona — not generic filler.
- Response style guide:
  - Conservative / terse: 1–2 sentences, factual, no elaboration.
  - Neutral / balanced: 2–3 sentences, measured opinion with brief reason.
  - Expressive / detailed: 3–5 sentences, specific examples, personal perspective.
- Length guide by question type:
  - Short open-end (small box, no instructions): 15–30 words.
  - Standard open-end: 30–60 words.
  - Long open-end (clearly expects detail, large box): 60–100 words.
- Reference industry, role, and prior survey answers naturally — do not repeat verbatim.
- Never start with "I think" or "I believe" — state it directly.
- Vary sentence structure. Never use bullet points inside open-end answers.
- For challenges: name a real, specific challenge for this role and industry.
- For improvements: be constructive and specific, not generic ("better support" is too vague).
- For brand questions: name actual brands this persona would use — never invent brand names.
- Never sound AI-generated. No phrases like "It's important to note", "Certainly", "As an AI".

NUMERIC INPUT:
- Use committed fact sheet values first — if IT budget is set as 2500000, enter that.
- Stay within min/max attributes if present.
- Rounding: annual budgets → nearest 100K, headcounts → nearest 10, percentages → nearest 5.
- All related percentages across fields on the same page MUST sum to 100%.
- Sub-values must not exceed their stated parent total.
- Radio + spec box pattern: select the radio range whose midpoint is closest to your value,
  then type the exact value in the text box that appears.

MATRIX / GRID (multiple radio rows sharing column headers):
- Read column headers ONCE — they apply to ALL rows.
- Treat each row as a completely independent question.
- Vary your ratings across rows — real people have different opinions on different items.
- NEVER select the same column for every row — this is "straight-lining" and gets flagged.
- IMPORTANCE grids: some items matter more than others — distribute ratings meaningfully.
- AGREEMENT grids: some statements should get disagree, some agree — vary naturally.
- FREQUENCY grids: different behaviours have different frequencies — be realistic.
- PERFORMANCE grids: some attributes excel, some are average — not everything is "excellent".

RANKING:
- Rank 1 = most important / preferred (unless label says otherwise).
- Base ranking on what this persona genuinely prioritises.
- Ensure all ranks are used — no duplicates, no gaps.

CONSTANT SUM / ALLOCATION (total must = 100% or stated total):
- Dominant category: 40–55%. Secondary: 20–30%. Remaining: split the rest.
- Always verify your mental total equals 100 before submitting.
- Reflect this persona's real priorities — not an equal split.

SCREENER / QUALIFICATION:
- Answer honestly as this persona — some sessions should naturally terminate.
- If a scenario constraint requires qualifying: follow it (scenario takes priority).
- If no constraint: answer truthfully — let the survey logic decide the outcome.

ATTENTION / TRAP QUESTIONS:
- Detected by: "Please select option X to continue", "Type the word Y", "For quality control select Z".
- Follow the literal instruction EXACTLY — ignore all other logic for this field only.

BRAND / AWARENESS:
- Aided awareness (list): tick only brands this persona would realistically know.
- Unaided awareness (open text): write real, actual brand names from the relevant industry.
- Usage: only claim usage of brands consistent with company size, budget, and industry.
- Never select obscure, unfamiliar, or clearly fake/phantom brand names.
- B2B software: use brands appropriate to stated company size and budget level.

PIPED / REFERENCE TEXT:
- If the question shows your previous answer (e.g. "You said you use AWS..."), confirm or build on it.
- Cross-reference the answer history above to stay fully consistent.

DEMOGRAPHIC QUESTIONS (age, income, education, job level, company size):
- Always use your stated profile values — never deviate.
- Pick the band / option that contains your stated value.

═══════════════════════════════════════════════
RULES — FOLLOW IN THIS EXACT ORDER OF PRIORITY
═══════════════════════════════════════════════
1. SCENARIO / COUNTRY LOGIC CONSTRAINTS — Hard override.
   If a constraint matches this page, follow it exactly.
   Country Logic: find option by label text, not by position number.
   SELECT_EXACT: convert 1-based to 0-based index.
   SELECT_ONE_OF: pick most persona-appropriate from the allowed list.
   SELECT_NOT_IN: avoid listed indices, pick best remaining for persona.

2. CROSS-REFERENCE ALL PRIOR ANSWERS — Scan the full answer history before answering.
   Budget, headcount, AI adoption, vendors, revenue, job role, technology, brands
   must all be internally consistent across every page of this session.
   ✗ "Evaluating AI" on Page 3 cannot become "AI generates 20% of revenue" on Page 12.
   ✗ "26–50 employees" on Page 2 cannot become "10,000+ headcount" on Page 9.
   ✗ "No cloud usage" on Page 4 cannot become "AWS, Azure, GCP user" on Page 10.

3. FACT SHEET CONSISTENCY — Never contradict committed facts.
   If a conflict is unavoidable, resolve toward the MOST RECENTLY COMMITTED value.

4. QUOTA CELL — All screener answers must qualify for the assigned demographic cell.

5. QUESTION TYPE GUIDE — Apply the guide above for the specific field type on this page.

6. PERSONA REALISM — Every answer must be credible for this specific person.
   Ask: "Would this persona genuinely answer this way given their background?"

7. NUMERIC CONSISTENCY:
   • Sub-totals ≤ parent totals at all times.
   • Percentages across related fields sum to 100%.
   • Employee counts match stated company size band.
   • Budgets match stated revenue band.
   • Radio + spec box: select range containing target, type exact value in box.

8. OPEN-END QUALITY:
   • Sound like a real ${persona?.behavioural_attrs?.designation || "professional"} in ${persona?.country || "their country"}.
   • Reference actual prior answers and specific industry context.
   • Never use filler: "Great question", "It's important to note", "Certainly".
   • Never produce mechanical, list-like, or AI-sounding text.

9. AVOID STRAIGHT-LINING:
   • Never select the same column/position for every row of a grid.
   • Never select the exact same number of checkboxes every time.
   • Real people have varied opinions — vary naturally across rows and pages.

10. PROBLEM OPTIONS — Use only when genuinely unavoidable for this persona:
    • "Don't know" — only if this persona truly would not know.
    • "Prefer not to say" — only if the question is genuinely sensitive.
    • "Other (please specify)" — only if NO listed option fits this persona at all.
    • "None of the above" — only if this persona has zero relevant experience.

═══════════════════════════════════════════════
RETURN ONLY THIS JSON — NO MARKDOWN, NO PREAMBLE
═══════════════════════════════════════════════
{
  "crossReferenceCheck": "brief note on prior answer consistency, or 'no conflicts'",
  "contradictionCheck": "fact sheet conflicts found and how resolved, or 'none'",
  "intentApplied": "scenario constraint applied, or 'none — persona-driven'",
  "reasoning": "one sentence: why these specific answers for this persona on this page",
  "newFacts": {
    "snake_case_key": "new factual commitment from answers on this page — omit if nothing new"
  },
  "answers": [
    { "fieldIndex": 0, "fieldType": "radio",     "selectedIndex": 2 },
    { "fieldIndex": 1, "fieldType": "checkbox",  "selectedIndices": [0, 2] },
    { "fieldIndex": 2, "fieldType": "select",    "selectedIndex": 1 },
    { "fieldIndex": 3, "fieldType": "textarea",  "text": "Natural first-person response that sounds like this specific persona..." },
    { "fieldIndex": 4, "fieldType": "input",     "value": 2500000 }
  ]
}
JSON RULES:
- Every field in FIELDS TO FILL must have an entry in answers — no exceptions.
- selectedIndex is 0-based (first option = 0, second = 1, etc.).
- selectedIndices is always an array, even if only one checkbox selected.
- text must be a plain string — no JSON, no line breaks as \\n.
- value for numeric inputs must be a NUMBER not a string.
- newFacts may be {} if this page revealed nothing new to commit.`;

    const aiResult = await callAIProvider(providerConfig, {
      systemPrompt,
      staticPart:  staticPromptPart,
      dynamicPart: dynamicPromptPart,
      maxTokens:   10240,
    });

    if (!aiResult) return null;
    const rawText = typeof aiResult === 'string' ? aiResult : aiResult.text;

    // ── Accumulate token usage on providerConfig._usage ──────────────────────
    if (!providerConfig._usage) {
      providerConfig._usage = { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 };
    }
    const inTok  = typeof aiResult === 'object' ? (aiResult.inputTokens  || 0) : 0;
    const outTok = typeof aiResult === 'object' ? (aiResult.outputTokens || 0) : 0;
    providerConfig._usage.inputTokens  += inTok;
    providerConfig._usage.outputTokens += outTok;
    providerConfig._usage.calls        += 1;
    const inPrice  = parseFloat(providerConfig.inputPricePer1m  || 0);
    const outPrice = parseFloat(providerConfig.outputPricePer1m || 0);
    providerConfig._usage.costUsd +=
      (inTok  / 1_000_000) * inPrice +
      (outTok / 1_000_000) * outPrice;
    if (inTok > 0 || outTok > 0) {
      console.log(`[AI] Tokens: ${inTok} in + ${outTok} out | call cost: $${((inTok/1e6)*inPrice+(outTok/1e6)*outPrice).toFixed(6)}`);
    }

    if (!rawText) return null;
    let decisions;
    try {
      decisions = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      console.warn(`[AI] JSON parse failed — raw: ${rawText.slice(0, 300)}`);
      return null;
    }

    if (
      decisions.crossReferenceCheck &&
      decisions.crossReferenceCheck !== "no conflicts"
    )
      console.log(`[AI] Cross-ref: ${decisions.crossReferenceCheck}`);
    if (decisions.contradictionCheck && decisions.contradictionCheck !== "none")
      console.log(`[AI] Contradiction: ${decisions.contradictionCheck}`);
    if (
      decisions.intentApplied &&
      decisions.intentApplied !== "none — persona-driven"
    )
      console.log(`[AI] Intent applied: ${decisions.intentApplied}`);
    if (decisions.reasoning)
      console.log(`[AI] Reasoning: ${decisions.reasoning}`);

    if (decisions.newFacts && typeof decisions.newFacts === "object") {
      for (const [key, value] of Object.entries(decisions.newFacts)) {
        if (value === null || value === undefined) continue;
        if (key.includes(".")) {
          const [parent, child] = key.split(".");
          if (factSheet[parent] && typeof factSheet[parent] === "object") {
            if (Array.isArray(factSheet[parent][child]) && Array.isArray(value))
              factSheet[parent][child] = [
                ...new Set([...factSheet[parent][child], ...value]),
              ];
            else factSheet[parent][child] = value;
          }
        } else {
          factSheet[key] = value;
        }
      }
    }

    const answersGiven = [];
    for (const ans of decisions.answers || []) {
      const field = actionableFields[ans.fieldIndex];
      if (!field) {
        console.warn(`[AI] fieldIndex ${ans.fieldIndex} not found`);
        continue;
      }
      try {
        switch (ans.fieldType) {
          case "radio": {
            const allRadios = await page.locator('input[type="radio"]').all();
            const groupMap = {};
            const groupOrder = [];
            for (const r of allRadios) {
              const name = await r.getAttribute("name").catch(() => null);
              if (!name) continue;
              if (!groupMap[name]) {
                groupMap[name] = [];
                groupOrder.push(name);
              }
              groupMap[name].push(r);
            }
            const radios = groupMap[groupOrder[field.groupIndex]] || [];
            const idx = ans.selectedIndex ?? 0;
            if (idx < radios.length) {
              // Try the AI-selected index first
                            let clicked = false;
              try {
                await clickRadioOption(page, radios[idx]);
                await page.waitForTimeout(300);
                const isChecked = await radios[idx].isChecked().catch(() => false);
                if (isChecked) clicked = true;
              } catch {}

              // Force-click via JS if normal click didn't register
              // Handles two-column CSS grid layouts common in Decipher
              if (!clicked) {
                try {
                  await radios[idx].evaluate(el => {
                    el.scrollIntoView({ block: 'center' });
                    el.click();
                    // Also dispatch change event in case survey JS listens for it
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('input',  { bubbles: true }));
                  });
                  await page.waitForTimeout(400);
                  const isChecked = await radios[idx].isChecked().catch(() => false);
                  if (isChecked) clicked = true;
                } catch {}
              }

              // Try clicking the label instead of the input
              if (!clicked) {
                try {
                  const id = await radios[idx].getAttribute('id').catch(() => null);
                  if (id) {
                    const lbl = page.locator(`label[for="${id}"]`);
                    if (await lbl.isVisible().catch(() => false)) {
                      await lbl.click({ force: true });
                      await page.waitForTimeout(400);
                      clicked = true;
                    }
                  }
                } catch {}
              }

              // If click failed or radio not checked, try scrollIntoView + force click
              if (!clicked) {
                try {
                  await radios[idx].evaluate(el => el.scrollIntoView({ block: 'center' }));
                  await page.waitForTimeout(200);
                  await radios[idx].click({ force: true });
                  await page.waitForTimeout(300);
                  clicked = true;
                } catch {}
              }

              // Last resort: click by label text
              if (!clicked) {
                const label = field.options?.[idx];
                if (label) {
                  const allLabels = await page.locator('label').all();
                  for (const lbl of allLabels) {
                    const txt = (await lbl.textContent().catch(() => '')).trim();
                    if (txt === label) {
                      await lbl.click({ force: true }).catch(() => {});
                      await page.waitForTimeout(300);
                      clicked = true;
                      break;
                    }
                  }
                }
              }

              await fillFollowupInput(page);
              const label = field.options?.[idx] || `option ${idx}`;
              answersGiven.push({
                type: "radio",
                selected: label,
                aiControlled: true,
                flags,
              });
              console.log(`[AI] ✓ Radio [${field.groupIndex}] → "${label}" (clicked: ${clicked})`);
            }
            break;
          }
          case "checkbox": {
            const allCbs = await page.locator('input[type="checkbox"]').all();
            const visible = [];
            for (const cb of allCbs) {
              if (await cb.isVisible().catch(() => false)) visible.push(cb);
            }
            let groupStart = 0;
            for (let gi = 0; gi < field.groupIndex; gi++) {
              const pf = actionableFields.find(
                (f) => f.fieldType === "checkbox" && f.groupIndex === gi,
              );
              if (pf) groupStart += pf.options?.length || 0;
            }
            const selected = [];
            for (const idx of ans.selectedIndices || []) {
              const cbEl = visible[groupStart + idx];
              if (cbEl) {
                await cbEl.check().catch(() => {});
                selected.push(field.options?.[idx] || `option ${idx}`);
              }
            }

            answersGiven.push({
              type: "checkbox",
              selected,
              aiControlled: true,
              flags,
            });
            console.log(
              `[AI] ✓ Checkbox [${field.groupIndex}] → [${selected.join(", ")}]`,
            );
            break;
          }
          case "select": {
            const allSels = await page.locator("select").all();
            const visible = [];
            for (const s of allSels) {
              if (await s.isVisible().catch(() => false)) visible.push(s);
            }
            const sel = visible[field.selectIndex];
            if (sel) {
              const targetOpt = field.options?.[ans.selectedIndex];
              if (targetOpt?.value) {
                await sel.selectOption(targetOpt.value).catch(() => {});
                answersGiven.push({
                  type: "select",
                  selected: targetOpt.label,
                  aiControlled: true,
                  flags,
                });
                console.log(
                  `[AI] ✓ Select [${field.selectIndex}] → "${targetOpt.label}"`,
                );
              }
            }
            break;
          }
          case "textarea": {
            const allTas = await page.locator("textarea").all();
            const visible = [];
            for (const ta of allTas) {
              if (await ta.isVisible().catch(() => false)) visible.push(ta);
            }
            const ta = visible[field.textareaIndex];
            if (ta && ans.text) {
              await ta.fill(ans.text).catch(() => {});
              answersGiven.push({
                type: "open-end",
                text: ans.text,
                aiControlled: true,
                flags,
              });
              console.log(
                `[AI] ✓ Open-end [${field.textareaIndex}] → "${ans.text.slice(0, 80)}"`,
              );
            }
            break;
          }
          case "input": {
            const allInputs = await page
              .locator("input[type='text'], input[type='number']")
              .all();
            const visible = [];
            for (const inp of allInputs) {
              if (!(await inp.isVisible().catch(() => false))) continue;
              const existing = await inp.inputValue().catch(() => "");
              if (existing && existing.trim() !== "") continue;
              visible.push(inp);
            }
            const inp = visible[field.inputIndex];
            if (
              inp &&
              ans.value !== undefined &&
              ans.value !== null &&
              String(ans.value) !== ""
            ) {
              await inp.fill(String(ans.value)).catch(() => {});
              const label =
                field.rowLabel ||
                field.columnHeader ||
                field.contextText?.slice(0, 40) ||
                `input ${field.inputIndex}`;
              answersGiven.push({
                type: "numeric",
                value: ans.value,
                label,
                aiControlled: true,
                flags,
              });
              console.log(
                `[AI] ✓ Input [${field.inputIndex}] "${label}" → ${ans.value}`,
              );
            }
            break;
          }
        }
      } catch (e) {
        console.warn(
          `[AI] Error on fieldIndex ${ans.fieldIndex}: ${e.message}`,
        );
      }
    }

    if (answersGiven.length === 0) {
      console.log("[AI] No answers executed");
      return null;
    }

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
  const instructions = [],
    timerRules = [];
  for (const step of scenario.steps) {
    if (step.when_type === "question_contains" && !step.when_value) continue;
    const vals = Array.isArray(step.action_values)
      ? step.action_values.map((v) => parseInt(v)).filter((n) => !isNaN(n))
      : [];
    let naturalInstruction = "";
    switch (step.action) {
      case "select_exact":
        naturalInstruction =
          vals.length === 1
            ? `Select option ${vals[0]} (1-based) exactly — required qualifying answer`
            : `Select first valid from [${vals.join(", ")}] (1-based)`;
        break;
      case "select_one_of":
        naturalInstruction = `Select any ONE from (1-based): [${vals.join(", ")}] — all qualify. Pick most consistent with persona.`;
        break;
      case "select_not_in":
        naturalInstruction = `Avoid options [${vals.join(", ")}] (1-based). Pick anything else that fits persona.`;
        break;
      case "numeric_fill":
        naturalInstruction = `Enter numeric value. Target range: ${vals[0] ?? 0}–${vals[1] ?? 100}. Select radio whose range contains target, fill spec box.`;
        break;
      case "open_end":
        naturalInstruction =
          step.action_mode === "specific" && step.action_text
            ? `Type exactly: "${step.action_text}"`
            : "Write natural open-end consistent with persona and prior answers.";
        break;
      case "skip":
        naturalInstruction = "Do not answer — click next immediately.";
        break;
      case "select_grid":
        naturalInstruction =
          "Grid question — answer each row following persona.";
        break;
      default:
        naturalInstruction = "";
    }
    if (naturalInstruction)
      instructions.push({
        when_type: step.when_type,
        when_value: step.when_value || "",
        action: step.action,
        vals,
        naturalInstruction,
        wait_min_s: step.wait_min_s || null,
        wait_max_s: step.wait_max_s || null,
      });
    if (step.wait_min_s || step.wait_max_s)
      timerRules.push({
        when_value: (step.when_value || "").toLowerCase(),
        when_type: step.when_type,
        wait_min_s: step.wait_min_s,
        wait_max_s: step.wait_max_s,
      });
  }
  return { instructions, timerRules };
};

const buildCountryLogicIntent = (countryLogic, proxyCountry) => {
  if (!countryLogic?.country_mapping) return null;
  const { questionContains, mappings } = countryLogic.country_mapping;
  if (!questionContains || !mappings?.length) return null;
  const mapping = mappings.find(
    (m) => m.country.toUpperCase() === (proxyCountry || "").toUpperCase(),
  );
  if (!mapping) return null;
  return {
    when_type: "question_contains",
    when_value: questionContains,
    action: "country_logic",
    vals: [],
    naturalInstruction: `COUNTRY LOGIC: Select the option whose label is exactly "${mapping.answer}". Mandatory — do not deviate.`,
    wait_min_s: countryLogic.country_mapping.waitMinS || null,
    wait_max_s: countryLogic.country_mapping.waitMaxS || null,
  };
};

const initFactSheet = (persona, country) => {
  const attrs = persona?.behavioural_attrs || {};
  return {
    gender: persona?.gender || null,
    age: persona?.age_min
      ? `${persona.age_min}${persona.age_max ? "–" + persona.age_max : "+"}`
      : null,
    job_title: attrs.designation || null,
    seniority_level: null,
    industry: attrs.industry || null,
    country: country || persona?.country || null,
    company_size: attrs.employeeSize || null,
    company_revenue: attrs.companyRevenue || null,
    ai_adoption_status: null,
    ai_budget: null,
    current_vendors: null,
    purchase_timeline: null,
    decision_maker: null,
    brand_awareness: {
      aware_of: [],
      not_aware_of: [],
      used: [],
      satisfaction: {},
    },
    committed_numbers: {},
    survey_specific: {},
    pageHistory: [],
  };
};

const resolveQuotaCell = async (persona, projectId, apiKey) => {
  if (!apiKey || !projectId) return null;
  try {
    const result = await pool.query(
      `SELECT dimensions FROM quota_cells WHERE project_id = $1`,
      [projectId],
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
      .map(([d, vals]) => `${d}: ${[...vals].join(", ")}`)
      .join("\n");
    const mockProvider = {
      provider_type: "anthropic",
      api_key: apiKey,
      model: "claude-sonnet-4-6",
    };
        const cellResult = await callAIProvider(mockProvider, {
      systemPrompt: "Map persona to quota dimensions. Return only JSON.",
      staticPart: "",
      dynamicPart: `Persona:\n${buildPersonaContext(persona)}\n\nDimensions:\n${dimensionsText}\n\nReturn JSON: {"DimensionName": "matched_value"}`,
      maxTokens: 250,
    });
    const cellText = typeof cellResult === 'object' ? (cellResult?.text || '{}') : (cellResult || '{}');
    const cell = JSON.parse(cellText.replace(/```json|```/g, "").trim());

    console.log(`[Agent] Quota cell: ${JSON.stringify(cell)}`);
    return cell;
  } catch (e) {
    console.warn("[Agent] resolveQuotaCell failed:", e.message);
    return null;
  }
};

const prepareSessionAgent = async (
  persona,
  scenario,
  countryLogic,
  projectId,
  proxyCountry,
  apiKey,
) => {
  const [quotaCell, intentMap, factSheet] = await Promise.all([
    resolveQuotaCell(persona, projectId, apiKey),
    Promise.resolve(buildIntentMap(scenario)),
    Promise.resolve(initFactSheet(persona, proxyCountry)),
  ]);
  const countryIntent = buildCountryLogicIntent(countryLogic, proxyCountry);
  if (countryIntent) {
    intentMap.instructions.unshift(countryIntent);
    console.log(`[Agent] Country logic injected`);
  }
  if (quotaCell) {
    for (const [dim, val] of Object.entries(quotaCell)) {
      const d = dim.toLowerCase();
      if (
        d.includes("seniority") ||
        d.includes("level") ||
        d.includes("title") ||
        d.includes("role")
      )
        factSheet.seniority_level = val;
    }
  }
  const quotaCellText = quotaCell
    ? Object.entries(quotaCell)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" × ")
    : "Not defined — answer based on persona";
  console.log(
    `[Agent] Ready — cell: ${quotaCellText} | intents: ${intentMap.instructions.length}`,
  );
  return {
    personaBrief: buildPersonaContext(persona),
    quotaCellText,
    intentMap,
    factSheet,
  };
};

const detectAttentionCheck = async (questionsOnPage, allFields, apiKey) => {
  if (!apiKey || !questionsOnPage.length) return null;
  const fullText = questionsOnPage.join(" ");
  const optionTexts = allFields
    .filter((f) => ["radio", "checkbox"].includes(f.fieldType))
    .flatMap((f) => f.options || [])
    .join(" ");
  const botSignals = [
    /please select.{0,50}(to continue|to verify|option \d|answer \d)/i,
    /type the word/i,
    /enter the (word|number|text)/i,
    /quality check/i,
    /attention check/i,
    /to verify you are/i,
    /do not select this/i,
    /for quality control/i,
    /select.{0,20}to proceed/i,
  ];
  const hasSignal = botSignals.some(
    (p) => p.test(fullText) || p.test(optionTexts),
  );
  if (!hasSignal) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        system: "Detect attention checks. Return only JSON.",
        messages: [
          {
            role: "user",
            content: `Question: ${fullText.slice(0, 400)}\nOptions: ${optionTexts.slice(0, 300)}\n\nReturn: {"isAttentionCheck": boolean, "confidence": "high" or "low", "instruction": "what to do or null"}`,
          },
        ],
      }),
    });
    const data = await res.json();
    return JSON.parse(
      (data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim(),
    );
  } catch {
    return null;
  }
};

const updateFactSheet = async (
  factSheet,
  answersGiven,
  questionsOnPage,
  pageNum,
  apiKey,
) => {
  if (!answersGiven?.length) return factSheet;
  for (let i = 0; i < answersGiven.length; i++) {
    const ans = answersGiven[i];
    if (!ans || ans.type === "country_mapping") continue;
    const questionText =
      questionsOnPage[i] ||
      questionsOnPage[0] ||
      `Page ${pageNum} field ${i + 1}`;
    const answerText =
      ans.type === "open-end"
        ? ans.text
        : ans.type === "numeric"
          ? `${ans.value} (${ans.label || "numeric"})`
          : Array.isArray(ans.selected)
            ? ans.selected.join(", ")
            : ans.selected || String(ans.value || "");
    if (answerText)
      factSheet.pageHistory.push({
        page: pageNum,
        question: questionText.slice(0, 200),
        answer: answerText.slice(0, 200),
        type: ans.type,
      });
  }
  if (!apiKey) return factSheet;
  const answerSummary = answersGiven
    .filter((a) => a && a.type !== "country_mapping")
    .map((a) => {
      if (a.type === "open-end")
        return `Open-end: "${(a.text || "").slice(0, 150)}"`;
      if (a.type === "numeric") return `Numeric "${a.label}": ${a.value}`;
      if (Array.isArray(a.selected)) return `Multi: [${a.selected.join(", ")}]`;
      return `Selected: "${a.selected}"`;
    })
    .join("\n");
  if (!answerSummary.trim()) return factSheet;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system:
          "Extract semantic facts from survey answers. Return only JSON with new/updated keys. Return {} if nothing to extract.",
        messages: [
          {
            role: "user",
            content: `Questions: ${questionsOnPage.join(" | ")}\nAnswers:\n${answerSummary}\nExisting: ${JSON.stringify(factSheet, null, 0).slice(0, 500)}\n\nExtract new/updated facts as snake_case keys. Return only changed/new keys as JSON.`,
          },
        ],
      }),
    });
    const data = await res.json();
    const newFacts = JSON.parse(
      (data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim(),
    );
    for (const [key, value] of Object.entries(newFacts)) {
      if (value === null || value === undefined) continue;
      if (key.includes(".")) {
        const [parent, child] = key.split(".");
        if (factSheet[parent] && typeof factSheet[parent] === "object") {
          if (Array.isArray(factSheet[parent][child]) && Array.isArray(value))
            factSheet[parent][child] = [
              ...new Set([...factSheet[parent][child], ...value]),
            ];
          else factSheet[parent][child] = value;
        }
      } else {
        factSheet[key] = value;
      }
    }
  } catch (e) {
    console.warn("[Agent] updateFactSheet error:", e.message);
  }
  return factSheet;
};

// ══════════════════════════════════════════════════════════════════════════════
// QUESTION EXTRACTOR — 3-priority system, expanded NON_QUESTION_PATTERNS
// ══════════════════════════════════════════════════════════════════════════════
const extractQuestionsFromPage = async (page) => {
  const rawTexts = await page.evaluate(() => {
    const found = new Set();

    // Priority 1: Decipher-specific question selectors
    const primarySelectors = [
      ".qtext",
      ".question-text",
      ".qtitle",
      '[class*="qtext"]',
      '[class*="question-title"]',
      '[class*="questionText"]',
      "legend",
      ".survey-question-text",
      "[data-question-text]",
    ];
    for (const sel of primarySelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const text = (el.innerText || el.textContent || "").trim();
        if (text && text.length >= 8 && text.length <= 500) found.add(text);
      });
      if (found.size >= 8) break;
    }

    // Priority 2: h2/h3/h4 ONLY inside known question containers
    if (found.size === 0) {
      document
        .querySelectorAll(
          '.qblock, .question, [class*="qblock"], [class*="question-block"], [class*="questionContainer"], fieldset',
        )
        .forEach((block) => {
          const heading = block.querySelector("h2, h3, h4");
          if (heading) {
            const text = (
              heading.innerText ||
              heading.textContent ||
              ""
            ).trim();
            if (text && text.length >= 8 && text.length <= 500) found.add(text);
          }
        });
    }

    // Priority 3: Proximity-based extraction from inputs
    if (found.size === 0) {
      const seen = new Set();
      for (const selector of [
        'input[type="radio"]:not([disabled])',
        'input[type="checkbox"]:not([disabled])',
        "select:not([disabled])",
        "textarea:not([disabled])",
      ]) {
        const inputs = document.querySelectorAll(selector);
        for (const inp of inputs) {
          let node = inp.parentElement;
          for (let depth = 0; depth < 10; depth++) {
            if (!node || node === document.body) break;
            const clone = node.cloneNode(true);
            clone
              .querySelectorAll(
                "input, select, textarea, button, label, ul, ol, table",
              )
              .forEach((n) => n.remove());
            const ownText = (clone.innerText || clone.textContent || "")
              .trim()
              .replace(/\s+/g, " ");
            if (
              ownText.length >= 10 &&
              ownText.length <= 400 &&
              !seen.has(ownText) &&
              (ownText.includes("?") || ownText.split(" ").length >= 6)
            ) {
              const words = ownText.split(" ").filter((w) => w.length > 2);
              if (words.length >= 4) {
                found.add(ownText);
                seen.add(ownText);
                break;
              }
            }
            if (node.querySelectorAll("input, select, textarea").length > 6)
              break;
            node = node.parentElement;
          }
          if (found.size >= 8) break;
        }
        if (found.size >= 8) break;
      }
    }
    return [...found];
  });

  const NON_QUESTION_PATTERNS = [
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
    /^section \d/i,
    /^\d+\s*of\s*\d+/,
    /^page \d/i,
    /^step \d/i,
    /^part \d/i,
    /^question \d+\s*of\s*\d+/i,
    /^q\d+\s*of\s*\d+/i,
    /^all fields/i,
    /^fields marked/i,
    /^mandatory/i,
    /^\* denotes/i,
    /^your (answers?|responses?) (are|will be|remain)/i,
    /^this survey/i,
    /^this questionnaire/i,
    /^this study/i,
    /^the following/i,
    /^in this section/i,
    /^on a scale/i,
    /^using the scale/i,
    /^where \d/i,
    /^privacy/i,
    /^terms/i,
    /^copyright/i,
    /^by (clicking|continuing|proceeding)/i,
    /^i agree/i,
    /^i confirm/i,
    /^(next|back|continue|submit|cancel|close|skip)$/i,
    /^\s*[\d\W]+\s*$/,
  ];

  const isNonQuestion = (text) =>
    !text ||
    text.length < 8 ||
    text.length > 500 ||
    NON_QUESTION_PATTERNS.some((p) => p.test(text.trim()));

  return rawTexts
    .map((t) =>
      t
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((t) => !isNonQuestion(t))
    .slice(0, 5);
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN SESSION PROCESSOR
// ══════════════════════════════════════════════════════════════════════════════
const processSession = async (job) => {
  const {
    sessionId,
    projectId,
    personaId,
    surveyUrl,
    responseId,
    proxyProvider,
    proxyCountry,
    deviceType,
    scenarioIds,
    internalTesting,
    aiModelId,
    aiProviderId,
  } = job.data;

  // Support both aiModelId (new) and aiProviderId (legacy fallback)
  const resolvedModelId = aiModelId || aiProviderId || null;

  console.log(
    `[Worker] Session ${sessionId} | Country: ${proxyCountry} | ResponseID: ${responseId}`,
  );

  await updateSessionStatus(sessionId, "initialising");
  await logSessionEvent(sessionId, "worker_started", {
    jobId: job.id,
    responseId,
  });

  // Persona — auto-assigned from project pool if not explicitly set
  const persona = await getPersona(personaId, projectId, proxyCountry);
  const readingSpeed = persona?.behavioural_attrs?.readingSpeed || "normal";
  const deviceOs = persona?.behavioural_attrs?.deviceOs || "windows";

  const countryLogic = await loadCountryLogic(projectId);
  let countryLogicApplied = false; // track if already applied this session
  const scenario = await loadSessionScenario(projectId, sessionId, scenarioIds);

  if (countryLogic) console.log(`[Worker] Country Logic active`);
  if (scenario) {
    await logSessionEvent(sessionId, "scenario_assigned", {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      stepCount: scenario.steps?.length || 0,
    });
  } else console.log(`[Worker] No scenario — default AI answering`);

  const viewports = {
    desktop: { width: 1366, height: 768 },
    mobile: { width: 390, height: 844 },
    tablet: { width: 820, height: 1180 },
  };
  const viewport = viewports[deviceType] || viewports.desktop;
  const userAgents = {
    "desktop-windows":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "desktop-macos":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "mobile-android":
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "mobile-ios":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  };
  const uaKey = `${deviceType || "desktop"}-${deviceOs.toLowerCase()}`;
  const userAgent = userAgents[uaKey] || userAgents["desktop-windows"];

  const proxySessionId = sessionId.slice(0, 8);
  const proxy = internalTesting
    ? null
    : await getProxyForSession(proxyProvider || "decodo", {
        country: proxyCountry || null,
        sessionId: proxySessionId,
      });

  if (internalTesting) console.log("[Proxy] INTERNAL TESTING — no proxy");
  else if (proxy)
    console.log(
      `[Proxy] Server: ${proxy.server} | Country: ${proxyCountry || "none"}`,
    );
  else console.log("[Proxy] DIRECT — no proxy");

  const launchOptions = {
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    }),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  };
  if (proxy) launchOptions.proxy = proxy;

  const sessionScreenshotsDir = path.join(SCREENSHOTS_DIR, sessionId);
  fs.mkdirSync(sessionScreenshotsDir, { recursive: true });

  let browser, context, page;
  let outcome = null,
    errorMessage = null,
    pageCount = 0,
    questionCount = 0;
  const startTime = Date.now();
  const tracePath = path.join(TRACES_DIR, `${sessionId}.zip`);
  const pages = [];

  let agentSetup = {
    personaBrief: buildPersonaContext(persona),
    quotaCellText: "Not resolved",
    intentMap: buildIntentMap(scenario),
    factSheet: initFactSheet(persona, proxyCountry),
  };

  // ── Resolve AI provider / model ────────────────────────────────────────────
  let providerConfig = null;

  if (resolvedModelId) {
    try {
      // Try new ai_models table first
      const modelResult = await pool.query(
        `SELECT * FROM ai_models WHERE (model_id = $1 OR id::text = $1) AND is_active = true LIMIT 1`,
        [resolvedModelId],
      );
      if (modelResult.rows[0]) {
        const m = modelResult.rows[0];
        const secretName = "openrouter_synthfield";
        const resolvedKey = readSecret(secretName);
        if (resolvedKey) {
        providerConfig = {
          provider_type:    "openrouter",
          api_key:          resolvedKey,
          model:            m.model_id,
          base_url:         null,
          inputPricePer1m:  parseFloat(m.input_price_per_1m  || 0),
          outputPricePer1m: parseFloat(m.output_price_per_1m || 0),
          _usage: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 },
        };
        console.log(
          `[Worker] ✓ AI model loaded: ${m.display_name} (${m.model_id}) — $${providerConfig.inputPricePer1m}/1M in, $${providerConfig.outputPricePer1m}/1M out`,
        );
        } else {
          console.warn(`[Worker] ⚠️ Secret "${secretName}" not found`);
          try {
            const available = fs.readdirSync("/run/secrets/").join(", ");
            console.warn(`[Worker] Available secrets: ${available}`);
          } catch {}
        }
      } else {
        // Legacy: try ai_providers table
        const {
          getProviderByIdInternal,
        } = require("../../backend/src/db/ai_providers");
        const providerRecord = await getProviderByIdInternal(
          resolvedModelId,
        ).catch(() => null);
        if (providerRecord) {
          const resolvedKey = readSecret(providerRecord.secret_name);
          if (resolvedKey) {
            providerConfig = {
              provider_type: providerRecord.provider_type,
              api_key: resolvedKey,
              model: providerRecord.model,
              base_url: providerRecord.base_url || null,
            };
            console.log(
              `[Worker] ✓ AI provider (legacy): ${providerRecord.name}`,
            );
          }
        }
      }
    } catch (e) {
      console.warn(`[Worker] AI model lookup failed: ${e.message}`);
    }
  }

  // Try default model from ai_models table
  if (!providerConfig) {
    try {
      const wsResult = await pool.query(
        `SELECT workspace_id FROM sessions WHERE id = $1`,
        [sessionId],
      );
      const wsId = wsResult.rows[0]?.workspace_id;
      if (wsId) {
        const defaultModel = await getDefaultModel(wsId);
        if (defaultModel) {
          const resolvedKey = readSecret("openrouter_synthfield");
          if (resolvedKey) {
          providerConfig = {
            provider_type:    "openrouter",
            api_key:          resolvedKey,
            model:            defaultModel.model_id,
            base_url:         null,
            inputPricePer1m:  parseFloat(defaultModel.input_price_per_1m  || 0),
            outputPricePer1m: parseFloat(defaultModel.output_price_per_1m || 0),
            _usage: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 },
          };
          console.log(
            `[Worker] ✓ AI model (workspace default): ${defaultModel.display_name} — $${providerConfig.inputPricePer1m}/1M in, $${providerConfig.outputPricePer1m}/1M out`,
          );
          }
        }
      }
    } catch (e) {
      console.warn("[Worker] Default model lookup failed:", e.message);
    }
  }

  // Final fallback: Anthropic env key
  if (!providerConfig) {
    const fallbackKey =
      readSecret("anthropic_api_key_v1") ||
      process.env.ANTHROPIC_API_KEY ||
      null;
    if (fallbackKey) {
      providerConfig = {
        provider_type:    "anthropic",
        api_key:          fallbackKey,
        model:            "claude-sonnet-4-6",
        base_url:         null,
        inputPricePer1m:  3.0,
        outputPricePer1m: 15.0,
        _usage: { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 },
      };
      console.log("[Worker] AI provider: fallback (anthropic env key)");
    }
  }

  if (!providerConfig)
    console.warn("⚠️ No AI provider resolved. AI features disabled.");

  const useAI = !!providerConfig;
  const ANTHROPIC_API_KEY = providerConfig?.api_key || null;

  if (useAI && persona) {
    try {
      agentSetup = await prepareSessionAgent(
        persona,
        scenario,
        countryLogic,
        projectId,
        proxyCountry,
        ANTHROPIC_API_KEY,
      );
    } catch (e) {
      console.warn("[Agent] prepareSessionAgent failed:", e.message);
    }
  }

  try {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({
      viewport,
      userAgent,
      locale: "en-US",
      timezoneId: "Asia/Kolkata",
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      title: `Session ${sessionId}`,
    });
    page = await context.newPage();

    // ── IP check ──────────────────────────────────────────────────────────────
    try {
      const ipRes = await page.goto("https://api.ipify.org?format=json", {
        timeout: 12000,
      });
      const ipData = await ipRes.json();
      if (ipData?.ip) {
        await recordUsedIP(projectId, sessionId, ipData.ip);
        await logSessionEvent(sessionId, "ip_assigned", {
          ip: ipData.ip,
          country: proxyCountry,
        });
        console.log(`[Worker] IP: ${ipData.ip} (${proxyCountry})`);
      }
    } catch (e) {
      await logSessionEvent(sessionId, "ip_check_failed", { error: e.message });
    }

    await updateSessionStatus(sessionId, "in_progress");
    await pool
      .query(
        `UPDATE sessions SET internal_testing = $1, scenario_name = $2 WHERE id = $3`,
        [!!internalTesting, scenario?.name || null, sessionId],
      )
      .catch(() => {});
    await logSessionEvent(sessionId, "browser_launched", {
      proxy: internalTesting
        ? "internal-testing"
        : proxy
          ? `decodo-${proxyCountry}`
          : "direct",
      responseId,
      surveyUrl,
      scenarioName: scenario?.name || null,
    });

    console.log(`[Worker] Navigating to: ${surveyUrl}`);
    await page.goto(surveyUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await logSessionEvent(sessionId, "survey_loaded", {
      url: surveyUrl,
      responseId,
    });

    // ══ MAIN SURVEY LOOP ═════════════════════════════════════════════════════
    while (pageCount < MAX_PAGES) {
      pageCount++;
      const currentUrl = page.url();
      const pageStart = Date.now();
      console.log(
        `\n[Worker] ── Page ${pageCount} ──────────────────────────────`,
      );
      console.log(`[Worker] URL: ${currentUrl}`);

      // Stop check
      try {
        const statusCheck = await pool.query(
          `SELECT status, error_log FROM sessions WHERE id = $1`,
          [sessionId],
        );
        if (
          statusCheck.rows[0]?.status === "error" &&
          statusCheck.rows[0]?.error_log === "Manually stopped by user"
        ) {
          console.log(`[Worker] Session manually stopped`);
          outcome = "error";
          break;
        }
      } catch {}

      // URL outcome check
      outcome = detectOutcome(currentUrl);
      if (outcome) {
        await logSessionEvent(sessionId, "redirect_detected", {
          url: currentUrl,
          outcome,
        });
        break;
      }

      // Content exit page check
      const contentOutcome = await detectOutcomeFromPage(page);
      if (contentOutcome) {
        outcome = contentOutcome;
        const exitFilename = `page_${pageCount}.png`;
        await takeScreenshot(
          page,
          path.join(sessionScreenshotsDir, exitFilename),
        );
        await logSessionEvent(sessionId, "page_answered", {
          page: pageCount,
          url: currentUrl,
          title: await page.title().catch(() => "Exit Page"),
          questions: [],
          options: [],
          answers: [],
          answerSummary: [],
          timeTaken: 0,
          screenshot: `${sessionId}/${exitFilename}`,
          isExitPage: true,
          exitOutcome: contentOutcome,
        });
        await logSessionEvent(sessionId, "redirect_detected", {
          url: currentUrl,
          outcome,
          detectedBy: "page_content",
          screenshot: `${sessionId}/${exitFilename}`,
        });
        break;
      }

      // ── Question extraction ─────────────────────────────────────────────────
      let pageTitle = "";
      let questionsOnPage = [];
      try {
        pageTitle = await page.title();
        questionsOnPage = await extractQuestionsFromPage(page);
        console.log(
          `[Worker] Questions detected (${questionsOnPage.length}): [${questionsOnPage.map((q) => `"${q.slice(0, 50)}"`).join(", ")}]`,
        );
      } catch (e) {
        console.warn(`[Worker] Question detection failed: ${e.message}`);
      }

      // ── Reading speed delay ─────────────────────────────────────────────────────
      // Simulates realistic human time on a survey — reading the question,
      // processing options, thinking, and registering a response.
      // Modelled on CATI interview pacing (interviewer reads, respondent answers).
      //
      // BASE TIME per page (single question):
      //   Express  :  5–10s   (stress test / speed run only)
      //   Fast     : 12–25s   (quick self-completion)
      //   Normal   : 25–50s   (average respondent, self-completion)
      //   Slow     : 45–90s   (deliberate reader, complex questions)
      //
      // QUESTION MULTIPLIER: each additional question adds 60–80% of base time
      // OPTIONS MULTIPLIER:  captured page options inflate time (more to read)
      {
        const speedStr = (
          persona?.behavioural_attrs?.readingSpeed || ""
        ).toLowerCase();

        // Base range in milliseconds [min, max] for a single question page
        let baseMin, baseMax;
        if (speedStr.includes("slow")) {
          baseMin = 45_000;
          baseMax = 90_000; // 45–90s
        } else if (speedStr.includes("fast") || speedStr.includes("skim")) {
          baseMin = 12_000;
          baseMax = 25_000; // 12–25s
        } else if (speedStr.includes("express") || speedStr.includes("terse")) {
          baseMin = 5_000;
          baseMax = 10_000; // 5–10s
        } else {
          // Normal / no persona — default average human
          baseMin = 25_000;
          baseMax = 50_000; // 25–50s
        }

        // Each additional question on the page adds 60–80% of base time
        // e.g. 3 questions at normal pace = 1.0 + 0.7 + 0.7 = 2.4× base
        const qCount = Math.max(1, questionsOnPage.length);
        const questionMultiplier =
          1 + (qCount - 1) * (0.6 + Math.random() * 0.2);

        // Random variation within range, then scaled by question count
        const baseMs = baseMin + Math.random() * (baseMax - baseMin);
        let readMs = Math.round(baseMs * questionMultiplier);

        // Hard cap: no page should take more than 4 minutes
        // Hard floor: always at least 5 seconds (page load + screenshot time)
        readMs = Math.min(readMs, 240_000);
        readMs = Math.max(readMs, 5_000);

        const readSec = Math.round(readMs / 1000);
        console.log(
          `[Worker] Reading delay: ${readSec}s ` +
            `(speed: ${speedStr || "normal/average"}, ` +
            `questions: ${qCount}, ` +
            `multiplier: ${questionMultiplier.toFixed(2)}×)`,
        );

                // Break the wait into chunks — wrapped in try/catch so a closed
        // browser during reading delay doesn't crash the whole session
        let remaining = readMs;
        while (remaining > 0) {
          const chunk = Math.min(remaining, 10_000);
          try {
            await page.waitForTimeout(chunk);
          } catch {
            // Page or browser closed during wait — exit reading delay gracefully
            console.log(`[Worker] Browser closed during reading delay — stopping wait`);
            break;
          }
          remaining -= chunk;

          // Early exit if page already navigated away (survey auto-advanced)
          let stillOnPage = '';
          try { stillOnPage = page.url(); } catch { break; }
          if (stillOnPage && stillOnPage !== currentUrl) {
            console.log(`[Worker] Page auto-advanced during reading delay — stopping wait`);
            break;
          }

          // Early exit if session was manually stopped
          try {
            const statusCheck = await pool.query(
              `SELECT status, error_log FROM sessions WHERE id = $1`, [sessionId]
            );
            if (statusCheck.rows[0]?.error_log === 'Manually stopped by user') {
              console.log(`[Worker] Session stopped during reading delay`);
              break;
            }
          } catch {}
        }
      }
      // Screenshot before answering
      const screenshotFilename = `page_${pageCount}.png`;
      const screenshotPath = path.join(
        sessionScreenshotsDir,
        screenshotFilename,
      );
      await takeScreenshot(page, screenshotPath);

      const pageOptionsBefore = await capturePageOptions(page);

      // ── AI answering ─────────────────────────────────────────────────────────────
      let answersGiven = null;
      const scenarioStepUsed = "ai";

      // ── COUNTRY LOGIC: runs AFTER AI so it always has final say ──────────
      if (countryLogic && !countryLogicApplied && questionsOnPage.length > 0) {
        try {
          const applied = await applyCountryMapping(
            page, countryLogic, proxyCountry, questionsOnPage,
          );
          if (applied) {
            countryLogicApplied = true; // prevent re-application on subsequent pages
            console.log(`[CountryLogic] ✓ Hard-clicked: ${proxyCountry} answer on page ${pageCount}`);
            await logSessionEvent(sessionId, 'country_logic_applied', {
              page: pageCount,
              country: proxyCountry,
              question: questionsOnPage[0]?.slice(0, 100),
            });
            await page.waitForTimeout(500);
            // Rescan in case CountryLogic click revealed a sub-question
            await rescanForRevealedContent(page, providerConfig, persona, agentSetup.factSheet, questionsOnPage);
          }
        } catch (e) {
          console.warn(`[CountryLogic] Hard-apply failed: ${e.message}`);
        }
      }

      // ── AI fills all remaining fields (including any Country Logic missed) ──────
      if (useAI) {
        console.log(`[Worker] Page ${pageCount}: AI answering`);
        answersGiven = await answerPageWithAI(
          page,
          persona,
          scenario,
          agentSetup.factSheet,
          agentSetup.intentMap,
          agentSetup.quotaCellText,
          questionsOnPage,
          pageOptionsBefore,
          providerConfig,
        );

        if (answersGiven?.length > 0) {
          questionCount++;
          console.log(
            `[Worker] Page ${pageCount}: AI answered ${answersGiven.length} field(s)`,
          );

          // Apply intent timer if matched
          const norm = (s) => (s || "").toLowerCase().trim();
          const pageTextLower = questionsOnPage.map(norm).join(" ");
          const matchedTimer = (agentSetup.intentMap?.timerRules || []).find(
            (r) => {
              if (r.when_type === "always") return true;
              if (r.when_type === "question_contains")
                return pageTextLower.includes(norm(r.when_value));
              return false;
            },
          );
          if (matchedTimer?.wait_min_s || matchedTimer?.wait_max_s) {
            const wMin = parseInt(matchedTimer.wait_min_s) || 0;
            const wMax = parseInt(matchedTimer.wait_max_s) || wMin;
            const waitMs =
              (wMin + Math.random() * Math.max(0, wMax - wMin)) * 1000;
            console.log(
              `[Worker] Intent timer — waiting ${Math.round(waitMs / 1000)}s`,
            );
            await page.waitForTimeout(waitMs);
          }
        } else {
          console.warn(
            `[Worker] Page ${pageCount}: AI returned no answers — falling back to random`,
          );
          await logSessionEvent(sessionId, "flag_warning", {
            flag: "AI_FALLBACK_RANDOM",
            message: `AI failed on page ${pageCount} — random answering used`,
            page: pageCount,
          });
          answersGiven = await answerPage(page, persona, readingSpeed);
          questionCount++;
        }
      } else {
        console.log(
          `[Worker] Page ${pageCount}: AI disabled — random answering`,
        );
        answersGiven = await answerPage(page, persona, readingSpeed);
        questionCount++;
      }

      // Flag web search usage
      if (useAI && answersGiven?.length > 0) {
        const usedWebSearch = answersGiven.some((a) =>
          a?.flags?.includes("web_search_used"),
        );
        if (usedWebSearch)
          await logSessionEvent(sessionId, "flag_warning", {
            flag: "NEED_ATTENTION_WEB_SEARCH",
            message: `Web search used on page ${pageCount}`,
            page: pageCount,
          });

        // Update pageHistory
        for (let i = 0; i < answersGiven.length; i++) {
          const ans = answersGiven[i];
          if (!ans || ans.type === "country_mapping") continue;
          const questionText =
            questionsOnPage[i] ||
            questionsOnPage[0] ||
            `Page ${pageCount} field ${i + 1}`;
          const answerText =
            ans.type === "open-end"
              ? ans.text
              : ans.type === "numeric"
                ? `${ans.value} (${ans.label || "numeric"})`
                : Array.isArray(ans.selected)
                  ? ans.selected.join(", ")
                  : ans.selected || String(ans.value || "");
          if (answerText)
            agentSetup.factSheet.pageHistory.push({
              page: pageCount,
              question: questionText.slice(0, 200),
              answer: answerText.slice(0, 200),
              type: ans.type,
            });
        }
      }

      // ── Post-answer hesitation delay ─────────────────────────────────────────────
      // After selecting an answer, a real person pauses before clicking Next.
      // Expressive/detailed personas take longer (reviewing their answer).
      {
                const styleStr = (
          persona?.behavioural_attrs?.responseStyle || ""
        ).toLowerCase();
        let hesMs;
        if (styleStr.includes("expressive") || styleStr.includes("detail"))
          hesMs = 3000 + Math.random() * 4000;
        else if (styleStr.includes("terse") || styleStr.includes("minimal"))
          hesMs = 800 + Math.random() * 1200;
        else hesMs = 1500 + Math.random() * 2500;
        await page.waitForTimeout(Math.round(hesMs)).catch(() => {});
    }
      // Last-resort fill for anything AI missed
      await fillRemainingInputs(page);

      await page.waitForTimeout(800);
      const pageOptionsAfter = await capturePageOptions(page);
      const gridAnswers = await captureGridAnswers(page);

      // Screenshot after answering
      await takeScreenshot(page, screenshotPath);

      const pageTime = Math.round((Date.now() - pageStart) / 1000);
      const answerSummary = buildAnswerSummary(pageOptionsAfter, answersGiven);

      pages.push({
        pageNum: pageCount,
        url: currentUrl,
        title: pageTitle,
        questions: questionsOnPage,
        options: pageOptionsAfter,
        answers: answersGiven,
        answerSummary,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
        scenarioStep: scenarioStepUsed || null,
        gridAnswers: gridAnswers.length > 0 ? gridAnswers : undefined,
      });

      await logSessionEvent(sessionId, "page_answered", {
        page: pageCount,
        url: currentUrl,
        title: pageTitle,
        questions: questionsOnPage,
        options: pageOptionsAfter,
        answers: answersGiven,
        answerSummary,
        timeTaken: pageTime,
        screenshot: `${sessionId}/${screenshotFilename}`,
        scenarioStep: scenarioStepUsed || null,
        gridAnswers: gridAnswers.length > 0 ? gridAnswers : undefined,
        factSheet: useAI ? agentSetup.factSheet : undefined,
      });

      // Click next
      const clicked = await clickNext(page);
      if (!clicked) {
        const noNextOutcome = await detectOutcomeFromPage(page);
        outcome = noNextOutcome || detectOutcome(page.url()) || "completed";
        console.log(`[Worker] No next button — outcome: ${outcome}`);
        break;
      }

            try {
        await page.waitForNavigation({
          timeout: 15000,
          waitUntil: "domcontentloaded",
        });
      } catch {
        await page.waitForTimeout(3000);
      }

      const newUrl = page.url();

      // ── Detect hash-only navigation (Decipher validation error) ────────────
      // When Decipher shows a validation error it changes only the URL hash
      // (#?, #$, #&, etc.) but stays on the same page. Detect this and handle.
      const prevBase = currentUrl.split('#')[0];
      const newBase  = newUrl.split('#')[0];
      const isHashOnly = prevBase === newBase && newUrl !== currentUrl;

      if (isHashOnly) {
        console.log(`[Worker] Hash-only navigation detected — likely validation error`);

        // Check if there's actually a validation error on the page
        const hasValidationError = await page.evaluate(() => {
          const errorSelectors = [
            '.error', '.validation-error', '[class*="error"]',
            '.alert', '[class*="alert"]', '.warning',
          ];
          for (const sel of errorSelectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent) return true;
          }
          const bodyText = (document.body?.innerText || '').toLowerCase();
          return bodyText.includes('there were problems') ||
                 bodyText.includes('please select') ||
                 bodyText.includes('required');
        }).catch(() => false);

        if (hasValidationError) {
          console.warn(`[Worker] Validation error on page ${pageCount} — answer may not have been accepted`);
          await logSessionEvent(sessionId, 'flag_warning', {
            flag: 'VALIDATION_ERROR',
            message: `Decipher validation error on page ${pageCount} — answer not accepted`,
            page: pageCount,
            url: newUrl,
          });
          // Don't increment pageCount — treat as same page, continue loop
          // This prevents infinite loop by eventually hitting MAX_PAGES
          pageCount--; // subtract so the outer loop increment keeps it the same
        }
        outcome = null; // not an exit outcome
        continue;
      }

      outcome = detectOutcome(newUrl);
      if (!outcome) {
        await page.waitForTimeout(1500);
        outcome = await detectOutcomeFromPage(page);
      }

      if (outcome) {
        const finalNum = pageCount + 1;
        const finalFilename = `page_${finalNum}.png`;
        await takeScreenshot(
          page,
          path.join(sessionScreenshotsDir, finalFilename),
        );
        await logSessionEvent(sessionId, "page_answered", {
          page: finalNum,
          url: newUrl,
          title: await page.title().catch(() => "Exit Page"),
          questions: [],
          options: [],
          answers: [],
          answerSummary: [],
          timeTaken: 0,
          screenshot: `${sessionId}/${finalFilename}`,
          isExitPage: true,
          exitOutcome: outcome,
        });
        await logSessionEvent(sessionId, "redirect_detected", {
          url: newUrl,
          outcome,
          screenshot: `${sessionId}/${finalFilename}`,
        });
        break;
      }
    }

    if (!outcome) outcome = pageCount >= MAX_PAGES ? "error" : "completed";
  } catch (err) {
    outcome = "error";
    errorMessage = err?.stack || err?.message || String(err);
    await logSessionEvent(sessionId, "error", {
      message: err?.message,
      stack: err?.stack,
    });
    console.error(`[Worker] Session ${sessionId} error:`, err.message);
  } finally {
    try {
      if (context) {
        await context.tracing.stop({ path: tracePath });
        await saveTracePath(sessionId, tracePath);
      }
    } catch {}
    try {
      await browser?.close();
    } catch {}
  }

  const durationS = Math.round((Date.now() - startTime) / 1000);
  const usage = providerConfig?._usage || { inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 };

  if (usage.calls > 0) {
    console.log(
      `[Cost] ✓ Session ${sessionId.slice(0, 8)}: ${usage.calls} AI calls | ` +
      `${usage.inputTokens} input + ${usage.outputTokens} output tokens | ` +
      `$${usage.costUsd.toFixed(6)} USD`
    );
  }

  await updateSessionStatus(sessionId, outcome, {
    outcome,
    totalDurationS:    durationS,
    questionCount,
    redirectType:      outcome,
    inputTokensTotal:  usage.inputTokens,
    outputTokensTotal: usage.outputTokens,
    aiCallsCount:      usage.calls,
    aiCostUsd:         parseFloat(usage.costUsd.toFixed(8)),
    modelUsed:         providerConfig?.model || null,
    ...(errorMessage ? { errorLog: errorMessage.slice(0, 2000) } : {}),
  });
  await logSessionEvent(sessionId, "session_complete", {
    outcome,
    durationS,
    pageCount,
    questionCount,
    responseId,
    screenshotsCount: pages.length,
    scenarioName: scenario?.name || null,
  });
  console.log(
    `[Worker] Session ${sessionId} → ${outcome} | ${durationS}s | ${pageCount} pages`,
  );
  return { sessionId, outcome, durationS, responseId };
};

// ══════════════════════════════════════════════════════════════════════════════
// WORKER
// ══════════════════════════════════════════════════════════════════════════════
const worker = new Worker("survey-sessions", processSession, {
  connection,
  concurrency: CONCURRENCY,
});
worker.on("completed", (job, result) =>
  console.log(`[Worker] Job ${job.id} done — ${result.outcome}`),
);
worker.on("failed", (job, err) =>
  console.error(`[Worker] Job ${job.id} failed:`, err.message),
);
worker.on("error", (err) => console.error("[Worker] Error:", err));
process.on("SIGTERM", async () => {
  await worker.close();
  process.exit(0);
});
console.log("[Worker] Ready and listening for jobs...");
