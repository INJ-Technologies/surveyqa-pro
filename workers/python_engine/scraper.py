"""
Survey Page Scraper (Playwright Sync API)
Extracts visible questions, answer options, error banners, and page state.
Strictly filters out hidden/stale DOM elements to prevent cross-page contamination.
"""
import re
from typing import List, Dict, Any, Optional
from playwright.sync_api import Page

COMPLETE_URL_KEYWORDS = ["thankyou", "complete", "thank-you", "finished", "done", "survey-closed", "completed"]
TERMINATE_URL_KEYWORDS = ["terminate", "terminated", "screenout", "screen-out", "disqualified", "dq", "noteligible"]
QUOTA_URL_KEYWORDS = ["quota", "over-quota", "overquota", "quotafull", "quota-full"]

TERMINATE_TEXT_PATTERNS = [
    "looking for a specific type of participant",
    "unfortunately, we are looking",
    "unfortunately we are looking",
    "does not meet our requirements",
    "do not qualify",
    "not eligible",
    "screened out",
    "unfortunately we are unable to include you",
    "not what we are looking for",
    "we appreciate your understanding",
    "disqualified from this study",
]

QUOTA_TEXT_PATTERNS = [
    "no longer accepting respondents",
    "no longer accepting participants",
    "quota has been filled",
    "enough respondents",
    "survey is full",
    "unfortunately we are no longer",
]

COMPLETE_TEXT_PATTERNS = [
    "thank you for taking our survey",
    "your efforts are greatly appreciated",
    "thank you for completing",
    "survey is now complete",
    "successfully completed",
    "thank you for your participation",
    "your responses have been recorded",
]


class PageScraper:
    def __init__(self, page: Page):
        self.page = page

    def detect_outcome_from_url(self) -> Optional[str]:
        """Detect survey termination, quota, or completion from current URL."""
        try:
            url_lower = self.page.url.lower()
            if any(k in url_lower for k in COMPLETE_URL_KEYWORDS):
                return "completed"
            if any(k in url_lower for k in TERMINATE_URL_KEYWORDS):
                return "terminated"
            if any(k in url_lower for k in QUOTA_URL_KEYWORDS):
                return "over_quota"
        except Exception:
            pass
        return None

    def detect_outcome_from_content(self) -> Optional[str]:
        """Detect survey outcome from visible body text."""
        try:
            body_text = self.page.evaluate("""() => {
                const visibleText = (document.body ? (document.body.innerText || '') : '').toLowerCase();
                return visibleText;
            }""")
            if not body_text:
                return None

            for pattern in TERMINATE_TEXT_PATTERNS:
                if pattern in body_text:
                    return "terminated"

            for pattern in QUOTA_TEXT_PATTERNS:
                if pattern in body_text:
                    return "over_quota"

            for pattern in COMPLETE_TEXT_PATTERNS:
                if pattern in body_text:
                    return "completed"
        except Exception:
            pass
        return None

    def detect_error_banners(self) -> List[str]:
        """Detect any active validation error banners (e.g. Decipher .errMsg)."""
        try:
            errors = self.page.evaluate("""() => {
                const results = [];
                const errorSelectors = [
                    '.errMsg', '.error', '.err', '[class*="error"]',
                    '.validation-error', '.survey-err', '[role="alert"]',
                    '.alert-danger', '.has-error'
                ];
                for (const sel of errorSelectors) {
                    document.querySelectorAll(sel).forEach(el => {
                        if (!el.offsetParent) return;
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
                        const text = (el.innerText || el.textContent || '').trim();
                        if (text && text.length > 3 && text.length < 300 && !results.includes(text)) {
                            results.push(text);
                        }
                    });
                }
                return results;
            }""")
            return errors or []
        except Exception:
            return []

    def check_timer(self) -> Optional[Dict[str, Any]]:
        """Check if page has a countdown timer preventing submission."""
        try:
            timer_info = self.page.evaluate("""() => {
                const timerSelectors = [
                    '[class*="timer"]', '[id*="timer"]', '[class*="countdown"]', '[class*="counter"]'
                ];
                for (const sel of timerSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent) {
                        const txt = (el.innerText || '').trim();
                        if (txt) return { hasTimer: true, text: txt };
                    }
                }
                const body = (document.body ? document.body.innerText : '') || '';
                const match = body.match(/you will be able to continue in (\\d+)/i);
                if (match) {
                    return { hasTimer: true, seconds: parseInt(match[1], 10), text: match[0] };
                }
                return { hasTimer: false };
            }""")
            return timer_info if timer_info and timer_info.get("hasTimer") else None
        except Exception:
            return None

    def scrape_visible_page(self) -> Dict[str, Any]:
        """
        Scrapes all visible question blocks and interactive controls.
        Guarantees that hidden elements from previous/future Decipher pages are strictly excluded.
        """
        outcome_url = self.detect_outcome_from_url()
        outcome_content = self.detect_outcome_from_content()
        outcome = outcome_url or outcome_content

        errors = self.detect_error_banners()
        timer = self.check_timer()

        # Detailed DOM scraping in page context
        dom_data = self.page.evaluate("""() => {
            const isVisible = (el) => {
                if (!el || !el.offsetParent) return false;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            };

            const cleanText = (t) => (t || '').replace(/\\s+/g, ' ').trim();

            const questions = [];
            const fields = [];

            // ── Find Question Titles ──
            const qTitleSelectors = [
                '.qtext', '.question-text', '.qtitle', '[class*="qtext"]',
                '[class*="question-title"]', '[class*="questionText"]',
                'legend', '.survey-question-text', '[data-question-text]'
            ];

            const seenTitles = new Set();
            for (const sel of qTitleSelectors) {
                document.querySelectorAll(sel).forEach(el => {
                    if (!isVisible(el)) return;
                    const txt = cleanText(el.innerText || el.textContent);
                    if (txt && txt.length >= 8 && txt.length <= 600 && !seenTitles.has(txt)) {
                        seenTitles.add(txt);
                        questions.push(txt);
                    }
                });
            }

            // Fallback for headings inside visible question blocks
            if (questions.length === 0) {
                document.querySelectorAll('.qblock, .question, [class*="qblock"], [class*="question-block"], fieldset').forEach(b => {
                    if (!isVisible(b)) return;
                    const h = b.querySelector('h2, h3, h4');
                    if (h && isVisible(h)) {
                        const txt = cleanText(h.innerText || h.textContent);
                        if (txt && txt.length >= 8 && txt.length <= 600 && !seenTitles.has(txt)) {
                            seenTitles.add(txt);
                            questions.push(txt);
                        }
                    }
                });
            }

            // ── Helper to find question label for a control ──
            const getQuestionForControl = (el) => {
                const block = el.closest('.qblock, .question, [class*="qblock"], fieldset, tr');
                if (block) {
                    const qt = block.querySelector('.qtext, .question-text, legend, h2, h3');
                    if (qt && isVisible(qt)) return cleanText(qt.innerText || qt.textContent);
                }
                return questions[0] || '';
            };

            // ── Helper to find specify/other input near a radio/checkbox ──
            const findSpecifyInput = (inputEl) => {
                let node = inputEl.parentElement;
                for (let i = 0; i < 6; i++) {
                    if (!node) break;
                    const textInp = node.querySelector('input[type="text"], input[type="search"], textarea');
                    if (textInp && textInp !== inputEl) {
                        return {
                            found: true,
                            id: textInp.id || null,
                            name: textInp.name || null,
                            placeholder: textInp.placeholder || '',
                            value: textInp.value || ''
                        };
                    }
                    if (node.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 1) break;
                    node = node.parentElement;
                }
                return null;
            };

            // ── 1. Check for Radio Grids / Matrix ──
            const tables = Array.from(document.querySelectorAll('table')).filter(isVisible);
            const gridProcessedRadios = new Set();

            tables.forEach((table, ti) => {
                const rows = Array.from(table.querySelectorAll('tr')).filter(isVisible);
                const radioRows = rows.filter(r => r.querySelectorAll('input[type="radio"]').length >= 2);
                if (radioRows.length < 2) return;

                // Column scale headers
                const headerRow = table.querySelector('thead tr, tr:first-child');
                let colHeaders = [];
                if (headerRow) {
                    colHeaders = Array.from(headerRow.querySelectorAll('th, td'))
                        .filter(c => !c.querySelector('input'))
                        .map(c => cleanText(c.innerText || c.textContent))
                        .filter(t => t.length > 0);
                }

                const gridRows = [];
                radioRows.forEach(tr => {
                    const radios = Array.from(tr.querySelectorAll('input[type="radio"]')).filter(isVisible);
                    if (radios.length === 0) return;

                    const rowName = radios[0].name || '';
                    radios.forEach(r => gridProcessedRadios.add(r));

                    // Row label
                    const cells = Array.from(tr.querySelectorAll('td, th'));
                    let rowLabel = '';
                    const firstNonRadioCell = cells.find(c => !c.querySelector('input[type="radio"]'));
                    if (firstNonRadioCell) {
                        rowLabel = cleanText(firstNonRadioCell.innerText || firstNonRadioCell.textContent);
                    }

                    const cols = radios.map((r, ci) => {
                        let label = colHeaders[ci] || '';
                        if (!label && r.id) {
                            const lbl = document.querySelector(`label[for="${r.id}"]`);
                            if (lbl) label = cleanText(lbl.innerText);
                        }
                        return {
                            colIndex: ci,
                            label: label || `Option ${ci + 1}`,
                            value: r.value || '',
                            id: r.id || '',
                            checked: r.checked
                        };
                    });

                    gridRows.push({
                        groupName: rowName,
                        rowLabel: rowLabel || rowName,
                        columns: cols
                    });
                });

                if (gridRows.length > 0) {
                    fields.push({
                        fieldType: 'grid',
                        fieldIndex: fields.length,
                        questionLabel: getQuestionForControl(table),
                        colHeaders: colHeaders,
                        rows: gridRows
                    });
                }
            });

            // ── 2. Standard Radio Groups (excluding grids) ──
            const radioGroups = {};
            const radioOrder = [];
            document.querySelectorAll('input[type="radio"]').forEach(r => {
                if (!isVisible(r) || !r.name || gridProcessedRadios.has(r)) return;
                if (!radioGroups[r.name]) {
                    radioGroups[r.name] = [];
                    radioOrder.push(r.name);
                }

                let label = '';
                if (r.id) {
                    const lbl = document.querySelector(`label[for="${r.id}"]`);
                    if (lbl) label = cleanText(lbl.innerText || lbl.textContent);
                }
                if (!label) {
                    const pl = r.closest('label');
                    if (pl) {
                        const clone = pl.cloneNode(true);
                        clone.querySelectorAll('input').forEach(n => n.remove());
                        label = cleanText(clone.innerText || clone.textContent);
                    }
                }
                if (!label && r.parentElement) {
                    label = cleanText(r.parentElement.innerText || '');
                }

                const spec = findSpecifyInput(r);
                radioGroups[r.name].push({
                    value: r.value || '',
                    id: r.id || '',
                    label: label || r.value || 'Option',
                    checked: r.checked,
                    hasSpecify: !!spec,
                    specifyId: spec ? spec.id : null,
                    specifyName: spec ? spec.name : null
                });
            });

            radioOrder.forEach((name, gi) => {
                const opts = radioGroups[name];
                const firstRadio = document.querySelector(`input[type="radio"][name="${name}"]`);
                fields.push({
                    fieldType: 'radio',
                    fieldIndex: fields.length,
                    groupName: name,
                    groupIndex: gi,
                    questionLabel: firstRadio ? getQuestionForControl(firstRadio) : questions[0] || '',
                    options: opts
                });
            });

            // ── 3. Checkboxes ──
            const cbGroups = {};
            const cbOrder = [];
            document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (!isVisible(cb)) return;
                const name = cb.name || cb.closest('fieldset')?.id || 'checkbox_group';
                if (!cbGroups[name]) {
                    cbGroups[name] = [];
                    cbOrder.push(name);
                }

                let label = '';
                if (cb.id) {
                    const lbl = document.querySelector(`label[for="${cb.id}"]`);
                    if (lbl) label = cleanText(lbl.innerText || lbl.textContent);
                }
                if (!label) {
                    const pl = cb.closest('label');
                    if (pl) {
                        const clone = pl.cloneNode(true);
                        clone.querySelectorAll('input').forEach(n => n.remove());
                        label = cleanText(clone.innerText || clone.textContent);
                    }
                }
                if (!label) {
                    const sib = cb.nextElementSibling;
                    if (sib && !sib.querySelector('input')) {
                        label = cleanText(sib.innerText || sib.textContent);
                    }
                }

                const spec = findSpecifyInput(cb);
                cbGroups[name].push({
                    value: cb.value || '',
                    id: cb.id || '',
                    label: label || cb.value || 'Option',
                    checked: cb.checked,
                    hasSpecify: !!spec,
                    specifyId: spec ? spec.id : null,
                    specifyName: spec ? spec.name : null
                });
            });

            cbOrder.forEach((name, gi) => {
                const opts = cbGroups[name];
                const firstCb = document.querySelector(`input[type="checkbox"][name="${name}"]`);
                fields.push({
                    fieldType: 'checkbox',
                    fieldIndex: fields.length,
                    groupName: name,
                    groupIndex: gi,
                    questionLabel: firstCb ? getQuestionForControl(firstCb) : questions[0] || '',
                    options: opts
                });
            });

            // ── 4. Dropdowns & Ranking Detection ──
            const selects = Array.from(document.querySelectorAll('select')).filter(isVisible);

            // Group ranking selects (e.g. 3-8 selects in same table/container each having ranks 1, 2, 3...)
            const rankingCandidates = [];
            const normalSelects = [];

            selects.forEach((sel) => {
                const optTexts = Array.from(sel.options).map(o => cleanText(o.text));
                const numericOpts = optTexts.filter(t => /^[0-9]+$/.test(t));
                const isRankLike = (numericOpts.length >= 2 && numericOpts.length === optTexts.filter(t => !/select|--|choose/i.test(t)).length)
                    || /rank|order|priorit/i.test(sel.name || '');

                if (isRankLike) {
                    rankingCandidates.push(sel);
                } else {
                    normalSelects.push(sel);
                }
            });

            if (rankingCandidates.length >= 2) {
                // Treated as a RANKING question set
                const rankItems = rankingCandidates.map((sel, idx) => {
                    const row = sel.closest('tr, [class*="row"], [class*="item"]');
                    let rowLabel = '';
                    if (row) {
                        const firstCell = row.querySelector('td:first-child, th:first-child, label, span');
                        if (firstCell && firstCell !== sel) {
                            rowLabel = cleanText(firstCell.innerText || firstCell.textContent);
                        }
                    }
                    const validOpts = Array.from(sel.options)
                        .filter(o => o.value && !/select|--|choose/i.test(o.text))
                        .map(o => ({ value: o.value, text: cleanText(o.text) }));

                    return {
                        itemIndex: idx,
                        id: sel.id || null,
                        name: sel.name || `rank_sel_${idx}`,
                        itemLabel: rowLabel || `Item ${idx + 1}`,
                        selectedValue: sel.value || null,
                        rankOptions: validOpts
                    };
                });

                fields.push({
                    fieldType: 'ranking',
                    fieldIndex: fields.length,
                    questionLabel: getQuestionForControl(rankingCandidates[0]),
                    items: rankItems
                });
            } else {
                rankingCandidates.forEach(s => normalSelects.push(s));
            }

            normalSelects.forEach((sel, si) => {
                const validOpts = Array.from(sel.options)
                    .filter(o => o.value && !/select one|--|please select/i.test(o.text))
                    .map(o => ({ value: o.value, label: cleanText(o.text) }));

                fields.push({
                    fieldType: 'select',
                    fieldIndex: fields.length,
                    selectIndex: si,
                    id: sel.id || null,
                    name: sel.name || `select_${si}`,
                    questionLabel: getQuestionForControl(sel),
                    selectedValue: sel.value || null,
                    options: validOpts
                });
            });

            // ── 5. Text Areas & Open-Ends ──
            document.querySelectorAll('textarea').forEach((ta, ti) => {
                if (!isVisible(ta)) return;
                fields.push({
                    fieldType: 'textarea',
                    fieldIndex: fields.length,
                    textareaIndex: ti,
                    id: ta.id || null,
                    name: ta.name || `textarea_${ti}`,
                    questionLabel: getQuestionForControl(ta),
                    placeholder: ta.placeholder || '',
                    currentValue: ta.value || ''
                });
            });

            // ── 6. Numeric & Text Inputs ──
            document.querySelectorAll('input[type="text"], input[type="number"]').forEach((inp, ii) => {
                if (!isVisible(inp)) return;
                // Exclude if already attached to radio/checkbox as specify input
                const isSpecify = inp.closest('.other, [class*="other"], .specify, [class*="specify"]');
                const fieldType = inp.type === 'number' || /percent|amount|allocation|count|revenue|budget/i.test(inp.name || inp.id || '') ? 'numeric' : 'text';

                // Look for unit suffix like %, $, USD
                let unit = '';
                const parent = inp.parentElement;
                if (parent) {
                    const text = cleanText(parent.innerText || '');
                    if (/%|USD|\\$|€|£|pts/i.test(text)) {
                        const m = text.match(/(%|USD|\\$|€|£|pts)/i);
                        if (m) unit = m[0];
                    }
                }

                fields.push({
                    fieldType: fieldType,
                    fieldIndex: fields.length,
                    inputIndex: ii,
                    id: inp.id || null,
                    name: inp.name || `input_${ii}`,
                    questionLabel: getQuestionForControl(inp),
                    placeholder: inp.placeholder || '',
                    min: inp.min || null,
                    max: inp.max || null,
                    unit: unit,
                    currentValue: inp.value || ''
                });
            });

            return { questions, fields };
        }""")

        return {
            "url": self.page.url,
            "outcome": outcome,
            "errors": errors,
            "timer": timer,
            "questions": dom_data.get("questions", []),
            "fields": dom_data.get("fields", []),
        }
