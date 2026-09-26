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

            const isInputInteractive = (el) => {
                if (!el) return false;
                if (isVisible(el)) return true;
                if (el.type === 'radio' || el.type === 'checkbox') {
                    // Check if enclosed in display:none container
                    let p = el.parentElement;
                    while (p && p !== document.body) {
                        const style = window.getComputedStyle(p);
                        if (style.display === 'none' || style.visibility === 'hidden') return false;
                        p = p.parentElement;
                    }
                    // Check associated label
                    let lbl = null;
                    if (el.id) {
                        try { lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); } catch(e) {}
                    }
                    if (!lbl) lbl = el.closest('label');
                    if (lbl && isVisible(lbl)) return true;
                    // Check parent element (e.g. .element, .fir-checkbox)
                    if (el.parentElement && isVisible(el.parentElement)) return true;
                }
                return false;
            };

            const cleanText = (t) => (t || '').replace(/\\s+/g, ' ').trim();

            const questions = [];
            const fields = [];

            // ── Find Question Titles, Subtitles, Instructions & Hints ──
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
                    if (txt && txt.length >= 6 && txt.length <= 600 && !seenTitles.has(txt)) {
                        seenTitles.add(txt);
                        questions.push(txt);
                    }
                });
            }

            // Headings inside visible question blocks
            if (questions.length === 0) {
                document.querySelectorAll('.qblock, .question, [class*="qblock"], [class*="question-block"], fieldset').forEach(b => {
                    if (!isVisible(b)) return;
                    const h = b.querySelector('h2, h3, h4');
                    if (h && isVisible(h)) {
                        const txt = cleanText(h.innerText || h.textContent);
                        if (txt && txt.length >= 6 && txt.length <= 600 && !seenTitles.has(txt)) {
                            seenTitles.add(txt);
                            questions.push(txt);
                        }
                    }
                });
            }

            // Extract question instructions, hints, and specify prompts
            const instructionSelectors = [
                '.instruction', '.hint', '.subtext', '.sub-text', '.qcomment',
                '[class*="instruction"]', '[class*="hint"]', '[class*="subtext"]',
                '.help-text', '[class*="help-text"]', '.specify', '[class*="specify"]',
                'label[for*="specify"]', 'label[for*="other"]', '.fir-specify'
            ];
            for (const sel of instructionSelectors) {
                document.querySelectorAll(sel).forEach(el => {
                    if (!isVisible(el)) return;
                    if (el.querySelector('input[type="radio"], input[type="checkbox"]')) return;
                    const t = cleanText(el.innerText || el.textContent);
                    if (t && t.length >= 4 && t.length <= 300 && !seenTitles.has(t)) {
                        seenTitles.add(t);
                        questions.push(t);
                    }
                });
            }

            // Scan for small/em/p instruction hints inside question blocks
            document.querySelectorAll('.qblock, .question, [class*="qblock"]').forEach(block => {
                if (!isVisible(block)) return;
                block.querySelectorAll('em, small, .note, p').forEach(el => {
                    if (!isVisible(el) || el.querySelector('input, select, textarea, label')) return;
                    const t = cleanText(el.innerText || el.textContent);
                    if (!seenTitles.has(t) && t.length >= 4 && t.length <= 250) {
                        if (/select (all|up to|at least|top|exactly|one|two|three|[0-9]+)/i.test(t) ||
                            /check (all|up to|at least|[0-9]+)/i.test(t) ||
                            /choose (all|up to|at least|[0-9]+)/i.test(t) ||
                            /please (select|check|choose|tick|specify|indicate)/i.test(t) ||
                            /enter a (number|value|percentage)/i.test(t) ||
                            /between [0-9]+ and [0-9]+/i.test(t) ||
                            /specify (the exact|your)/i.test(t)) {
                            seenTitles.add(t);
                            questions.push(t);
                        }
                    }
                });
            });

            // ── Helper to find question label and instruction/hint for a control ──
            const isOptOutText = (t) => {
                if (!t) return false;
                return /don'?t\s+know|do\s+not\s+know|not\s+sure|unsure|cannot\s+say|prefer\s+not|none\s+of|^\s*none\s*$|not\s+applicable|^\s*n\/?a\s*$/i.test(t);
            };

            const getQuestionForControl = (el) => {
                const block = el.closest('.qblock, .question, [class*="qblock"], [class*="question-block"], fieldset, form, table') || el.closest('table')?.parentElement;
                let qText = '';
                let hintText = '';
                if (block) {
                    const qt = block.querySelector('.qtext, .question-text, legend, h2, h3, h4, [class*="qtitle"], [class*="question-title"]');
                    if (qt && isVisible(qt)) qText = cleanText(qt.innerText || qt.textContent);

                    const ht = block.querySelector('.instruction, .hint, .subtext, .sub-text, .qcomment, .comment, [class*="instruction"], [class*="comment"], [class*="hint"], [class*="subtext"], .fir-instruction, .fir-comment, em, small');
                    if (ht && isVisible(ht) && ht !== qt) {
                        hintText = cleanText(ht.innerText || ht.textContent);
                    }
                }
                if (!qText) qText = questions[0] || '';
                return {
                    question: qText,
                    hint: hintText,
                    fullText: hintText && !qText.includes(hintText) ? `${qText} (${hintText})` : qText
                };
            };

            const claimedSpecifyInputs = new Set();
            const claimedOptOutCbs = new Set();

            // ── Helper to find specify/other input near a radio/checkbox ──
            const findSpecifyInput = (inputEl) => {
                let node = inputEl.parentElement;
                for (let i = 0; i < 6; i++) {
                    if (!node) break;
                    const textInp = node.querySelector('input[type="text"], input[type="search"], textarea');
                    if (textInp && textInp !== inputEl) {
                        claimedSpecifyInputs.add(textInp);
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
                    const qInfo = getQuestionForControl(table);
                    fields.push({
                        fieldType: 'grid',
                        fieldIndex: fields.length,
                        questionLabel: qInfo.fullText,
                        questionTitle: qInfo.question,
                        questionHint: qInfo.hint,
                        colHeaders: colHeaders,
                        rows: gridRows
                    });
                }
            });

            // ── 2. Standard Radio Groups (excluding grids) ──
            const radioGroups = {};
            const radioOrder = [];
            document.querySelectorAll('input[type="radio"]').forEach(r => {
                if (!isInputInteractive(r) || !r.name || gridProcessedRadios.has(r)) return;
                if (!radioGroups[r.name]) {
                    radioGroups[r.name] = [];
                    radioOrder.push(r.name);
                }

                let label = '';
                if (r.id) {
                    try {
                        const lbl = document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
                        if (lbl) label = cleanText(lbl.innerText || lbl.textContent);
                    } catch(e) {}
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
                const qInfo = firstRadio ? getQuestionForControl(firstRadio) : { fullText: questions[0] || '', question: questions[0] || '', hint: '' };
                fields.push({
                    fieldType: 'radio',
                    fieldIndex: fields.length,
                    groupName: name,
                    groupIndex: gi,
                    questionLabel: qInfo.fullText,
                    questionTitle: qInfo.question,
                    questionHint: qInfo.hint,
                    options: opts
                });
            });

            // ── 3. Checkboxes ──
            const cbGroups = {};
            const cbOrder = [];
            document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (!isInputInteractive(cb)) return;
                if (claimedOptOutCbs.has(cb)) return;

                // Group checkboxes belonging to the same question block into one multi-option question
                const qBlock = cb.closest('.qblock, .question, [class*="qblock"], [class*="question-block"], fieldset, table, [role="group"]');
                const qInfo = getQuestionForControl(cb);
                const qText = qInfo.fullText;

                // Strip trailing option index/suffix (e.g. ans2214.0.0 -> ans2214.0)
                let baseName = (cb.name || '').replace(/([._\\[])\\d+\\]?$/, '');

                let groupKey = '';
                if (qBlock && (qBlock.id || qBlock.getAttribute('name'))) {
                    groupKey = qBlock.id || qBlock.getAttribute('name');
                } else if (baseName) {
                    groupKey = baseName;
                } else if (qText) {
                    groupKey = qText;
                } else {
                    groupKey = cb.name || 'checkbox_group';
                }

                if (!cbGroups[groupKey]) {
                    cbGroups[groupKey] = {
                        name: cb.name || groupKey,
                        questionLabel: qInfo.fullText,
                        questionTitle: qInfo.question,
                        questionHint: qInfo.hint,
                        options: []
                    };
                    cbOrder.push(groupKey);
                }

                let label = '';
                if (cb.id) {
                    try {
                        const lbl = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
                        if (lbl) label = cleanText(lbl.innerText || lbl.textContent);
                    } catch(e) {}
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
                cbGroups[groupKey].options.push({
                    name: cb.name || '',
                    value: cb.value || '',
                    id: cb.id || '',
                    label: label || cb.value || 'Option',
                    checked: cb.checked,
                    hasSpecify: !!spec,
                    specifyId: spec ? spec.id : null,
                    specifyName: spec ? spec.name : null
                });
            });

            cbOrder.forEach((groupKey, gi) => {
                const groupObj = cbGroups[groupKey];
                fields.push({
                    fieldType: 'checkbox',
                    fieldIndex: fields.length,
                    groupName: groupObj.name,
                    groupIndex: gi,
                    questionLabel: groupObj.questionLabel || questions[0] || '',
                    questionTitle: groupObj.questionTitle || questions[0] || '',
                    questionHint: groupObj.questionHint || '',
                    options: groupObj.options
                });
            });

            // ── 4. Dropdowns & Ranking Detection ──
            const selects = Array.from(document.querySelectorAll('select')).filter(isVisible);

            // Group ranking selects (e.g. selects in same table/container where options are ranks 1, 2, 3...)
            const rankingCandidates = [];
            const normalSelects = [];

            selects.forEach((sel) => {
                const optTexts = Array.from(sel.options).map(o => cleanText(o.text));
                const meaningfulOpts = optTexts.filter(t => !/select|--|choose|^none$|^$/i.test(t));
                const rankLikeOpts = meaningfulOpts.filter(t => /^(rank\s*)?[0-9]+(\w+)?$/i.test(t) || /^(top\s*)?[0-9]+/i.test(t) || /^[0-9]+(st|nd|rd|th)$/i.test(t) || /^#[0-9]+$/.test(t));

                const container = sel.closest('table, .qblock, .question, [class*="qblock"], fieldset') || sel.parentElement;
                const containerText = cleanText(container?.innerText || '');
                const hasRankingContext = /rank|order of importance|order of preference|priority|rank the top|select each answer only once/i.test(containerText) ||
                                          /rank|order|priorit/i.test(sel.name || '') ||
                                          /rank|order|priorit/i.test(sel.id || '');

                const isRankLike = (meaningfulOpts.length >= 2 && rankLikeOpts.length === meaningfulOpts.length) ||
                                   (hasRankingContext && meaningfulOpts.length >= 2 && rankLikeOpts.length >= 1);

                if (isRankLike) {
                    rankingCandidates.push(sel);
                } else {
                    normalSelects.push(sel);
                }
            });

            if (rankingCandidates.length >= 2) {
                // Determine rank limit from container instruction text (e.g. "top three" -> 3)
                const container = rankingCandidates[0].closest('table, .qblock, .question, [class*="qblock"], fieldset') || rankingCandidates[0].parentElement;
                const containerText = cleanText(container?.innerText || '') + ' ' + (questions.join(' '));

                let detectedRankLimit = null;
                const matchLimit = containerText.match(/(?:rank|select)\s+(?:the\s+)?(?:top\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+)/i);
                if (matchLimit) {
                    const wordMap = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
                    const parsed = wordMap[matchLimit[1].toLowerCase()] || parseInt(matchLimit[1], 10);
                    if (!isNaN(parsed) && parsed > 0) {
                        detectedRankLimit = parsed;
                    }
                }

                // Check for opt-out checkboxes in this table/container (e.g. "Don't know")
                const optOutCheckboxes = [];
                if (container) {
                    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        const row = cb.closest('tr, [class*="row"], label') || cb.parentElement;
                        const rowText = cleanText(row?.innerText || '');
                        if (isOptOutText(rowText)) {
                            claimedOptOutCbs.add(cb);
                            optOutCheckboxes.push(cb.id || cb.name);
                        }
                    });
                }

                const rankItems = rankingCandidates.map((sel, idx) => {
                    const row = sel.closest('tr, [class*="row"], [class*="item"]');
                    let rowLabel = '';
                    let specInput = null;

                    if (row) {
                        const cells = Array.from(row.querySelectorAll('td, th'));
                        const firstCell = cells.find(c => !c.querySelector('select, input[type="radio"], input[type="checkbox"]')) || cells[0];
                        if (firstCell && firstCell !== sel) {
                            rowLabel = cleanText(firstCell.innerText || firstCell.textContent);
                        }

                        // Check if this row contains a specify / write-in input box!
                        const rowInp = row.querySelector('input[type="text"], input[type="search"], textarea');
                        if (rowInp) {
                            specInput = rowInp;
                            claimedSpecifyInputs.add(rowInp);
                        }
                    }

                    const validOpts = Array.from(sel.options)
                        .filter(o => o.value && !/select|--|choose|^$/i.test(o.text))
                        .map(o => ({ value: o.value, text: cleanText(o.text) }));

                    return {
                        itemIndex: idx,
                        id: sel.id || null,
                        name: sel.name || `rank_sel_${idx}`,
                        itemLabel: rowLabel || `Item ${idx + 1}`,
                        selectedValue: sel.value || null,
                        hasSpecify: !!specInput,
                        specifyId: specInput ? specInput.id : null,
                        specifyName: specInput ? specInput.name : null,
                        rankOptions: validOpts
                    };
                });

                const numRankOptions = rankItems[0]?.rankOptions?.length || 3;
                const effectiveLimit = detectedRankLimit ? Math.min(detectedRankLimit, numRankOptions) : Math.min(rankItems.length, numRankOptions);

                const qInfo = getQuestionForControl(rankingCandidates[0]);
                fields.push({
                    fieldType: 'ranking',
                    fieldIndex: fields.length,
                    questionLabel: qInfo.fullText,
                    questionTitle: qInfo.question,
                    questionHint: qInfo.hint,
                    rankLimit: effectiveLimit,
                    items: rankItems,
                    optOutCheckboxIds: optOutCheckboxes.filter(Boolean)
                });
            } else {
                rankingCandidates.forEach(s => normalSelects.push(s));
            }

            normalSelects.forEach((sel, si) => {
                const validOpts = Array.from(sel.options)
                    .filter(o => o.value && !/select one|--|please select/i.test(o.text))
                    .map(o => ({ value: o.value, label: cleanText(o.text) }));

                const qInfo = getQuestionForControl(sel);
                fields.push({
                    fieldType: 'select',
                    fieldIndex: fields.length,
                    selectIndex: si,
                    id: sel.id || null,
                    name: sel.name || `select_${si}`,
                    questionLabel: qInfo.fullText,
                    questionTitle: qInfo.question,
                    questionHint: qInfo.hint,
                    selectedValue: sel.value || null,
                    options: validOpts
                });
            });

            // ── 5. Text Areas & Open-Ends ──
            document.querySelectorAll('textarea').forEach((ta, ti) => {
                if (!isVisible(ta)) return;
                if (claimedSpecifyInputs.has(ta)) return;
                const qInfo = getQuestionForControl(ta);
                fields.push({
                    fieldType: 'textarea',
                    fieldIndex: fields.length,
                    textareaIndex: ti,
                    id: ta.id || null,
                    name: ta.name || `textarea_${ti}`,
                    questionLabel: qInfo.fullText,
                    questionTitle: qInfo.question,
                    questionHint: qInfo.hint,
                    placeholder: ta.placeholder || '',
                    currentValue: ta.value || ''
                });
            });

            // ── 6. Numeric & Text Inputs ──
            document.querySelectorAll('input[type="text"], input[type="number"]').forEach((inp, ii) => {
                if (!isVisible(inp)) return;
                // Exclude if already attached to radio/checkbox/ranking as specify input
                if (claimedSpecifyInputs.has(inp)) return;

                // Exclude if inside an "other" or "specify" row/container or if name/id indicates specify
                const row = inp.closest('tr, [class*="row"], .other, [class*="other"], .specify, [class*="specify"]');
                const rowText = row ? cleanText(row.innerText || '') : '';
                if (/other\s*\(|please\s*specify|^other$/i.test(rowText) ||
                    /specify|other/i.test(inp.name || '') ||
                    /specify|other/i.test(inp.id || '')) {
                    claimedSpecifyInputs.add(inp);
                    return;
                }

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

                const qInfo = getQuestionForControl(inp);
                fields.push({
                    fieldType: fieldType,
                    fieldIndex: fields.length,
                    inputIndex: ii,
                    id: inp.id || null,
                    name: inp.name || `input_${ii}`,
                    questionLabel: qInfo.fullText,
                    questionTitle: qInfo.question,
                    questionHint: qInfo.hint,
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

    def capture_page_options(self) -> List[Dict[str, Any]]:
        """
        Captures all interactive controls, their full option lists, and current selection
        states from the live page DOM after execution.
        Matches the exact schema expected by frontend ProjectDetail.jsx and PDF report:
        [
            { "type": "radio", "options": ["USA", "Japan", ...], "selected": "USA", "specText": "..." },
            { "type": "checkbox", "options": ["0% - No increase", ...], "selected": ["0% - No increase"] },
            { "type": "select", "options": ["1%", "2%", ...], "selected": "24%" },
            { "type": "open-end", "options": [], "selected": "10400" },
            { "type": "numeric", "options": [], "selected": "50" }
        ]
        """
        try:
            return self.page.evaluate("""() => {
                const result = [];
                const cleanText = (t) => (t || '').replace(/\\s+/g, ' ').trim();

                const isVisible = (el) => {
                    if (!el) return false;
                    if (el.offsetParent) return true;
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                };

                const getSpecText = (checkedInput) => {
                    if (!checkedInput) return null;
                    let node = checkedInput.parentElement;
                    for (let i = 0; i < 8; i++) {
                        if (!node || node === document.body) break;
                        const specInput = node.querySelector('input[type="text"], input[type="search"], textarea');
                        if (specInput && specInput !== checkedInput) {
                            const val = (specInput.value || '').trim();
                            if (val.length > 0) return val;
                        }
                        if (node.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 1) break;
                        node = node.parentElement;
                    }
                    return null;
                };

                // 1. Radio groups
                const radioGroups = {};
                document.querySelectorAll('input[type="radio"]').forEach(radio => {
                    const hiddenAncestor = radio.closest('[hidden], [style*="display: none"], [style*="display:none"]');
                    if (hiddenAncestor) return;

                    const name = radio.name || 'radio_group';
                    if (!radioGroups[name]) {
                        radioGroups[name] = { options: [], selected: null, specText: null };
                    }

                    let labelText = '';
                    if (radio.id) {
                        try {
                            const lbl = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
                            if (lbl) labelText = cleanText(lbl.innerText || lbl.textContent);
                        } catch(e) {}
                    }
                    if (!labelText) {
                        const pl = radio.closest('label');
                        if (pl) {
                            const clone = pl.cloneNode(true);
                            clone.querySelectorAll('input').forEach(n => n.remove());
                            labelText = cleanText(clone.innerText || clone.textContent);
                        }
                    }
                    if (!labelText && radio.parentElement) {
                        labelText = cleanText(radio.parentElement.innerText || '');
                    }
                    if (!labelText) labelText = radio.value || 'Option';

                    if (!radioGroups[name].options.includes(labelText)) {
                        radioGroups[name].options.push(labelText);
                    }

                    if (radio.checked) {
                        radioGroups[name].selected = labelText;
                        const spec = getSpecText(radio);
                        if (spec) radioGroups[name].specText = spec;
                    }
                });

                Object.values(radioGroups).forEach(group => {
                    if (group.options.length > 0) {
                        result.push({
                            type: 'radio',
                            options: group.options,
                            selected: group.selected,
                            specText: group.specText || null
                        });
                    }
                });

                // 2. Checkbox groups
                const cbGroups = {};
                document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                    const hiddenAncestor = cb.closest('[hidden], [style*="display: none"], [style*="display:none"]');
                    if (hiddenAncestor) return;

                    const qBlock = cb.closest('.qblock, .question, [class*="qblock"], [class*="question-block"], fieldset, table');
                    let baseName = (cb.name || '').replace(/([._\\[])\\d+\\]?$/, '');
                    let gKey = (qBlock && (qBlock.id || qBlock.getAttribute('name'))) || baseName || cb.name || 'checkbox_group';

                    if (!cbGroups[gKey]) {
                        cbGroups[gKey] = { options: [], selected: [] };
                    }

                    let labelText = '';
                    if (cb.id) {
                        try {
                            const lbl = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
                            if (lbl) labelText = cleanText(lbl.innerText || lbl.textContent);
                        } catch(e) {}
                    }
                    if (!labelText) {
                        const pl = cb.closest('label');
                        if (pl) {
                            const clone = pl.cloneNode(true);
                            clone.querySelectorAll('input').forEach(n => n.remove());
                            labelText = cleanText(clone.innerText || clone.textContent);
                        }
                    }
                    if (!labelText && cb.parentElement) {
                        labelText = cleanText(cb.parentElement.innerText || '');
                    }
                    if (!labelText) labelText = cb.value || 'Option';

                    if (!cbGroups[gKey].options.includes(labelText)) {
                        cbGroups[gKey].options.push(labelText);
                    }

                    if (cb.checked) {
                        cbGroups[gKey].selected.push(labelText);
                        const spec = getSpecText(cb);
                        if (spec) {
                            if (!cbGroups[gKey].specText) cbGroups[gKey].specText = spec;
                            else cbGroups[gKey].specText += `, ${spec}`;
                        }
                    }
                });

                Object.values(cbGroups).forEach(group => {
                    if (group.options.length > 0) {
                        result.push({
                            type: 'checkbox',
                            options: group.options,
                            selected: group.selected,
                            specText: group.specText || null
                        });
                    }
                });

                // 3. Dropdowns (select elements)
                document.querySelectorAll('select').forEach(select => {
                    if (!isVisible(select)) return;
                    const options = Array.from(select.options)
                        .filter(o => {
                            const val = (o.value || '').trim();
                            const text = cleanText(o.innerText || o.textContent);
                            if (!val || val === '0') return false;
                            if (/^(--|select|choose|please select|please choose|pick one|none selected)/i.test(text)) return false;
                            return true;
                        })
                        .map(o => cleanText(o.innerText || o.value));

                    const selectedEl = select.options[select.selectedIndex];
                    const selected = selectedEl ? cleanText(selectedEl.innerText || selectedEl.value) : null;
                    if (options.length > 0) {
                        result.push({
                            type: 'select',
                            options: options,
                            selected: selected
                        });
                    }
                });

                // 4. Standalone textareas and text inputs (open-end / numeric)
                const textFields = Array.from(document.querySelectorAll('textarea, input[type="text"], input[type="number"], input[type="search"]'));
                textFields.forEach(field => {
                    const val = (field.value || '').trim();
                    if (!val) return;

                    const hiddenAncestor = field.closest('[hidden], [style*="display: none"], [style*="display:none"]');
                    if (hiddenAncestor) return;

                    // Skip if attached to a checked radio/checkbox as specify box
                    let isAttachedSpecBox = false;
                    let p = field.parentElement;
                    for (let i = 0; i < 8; i++) {
                        if (!p || p === document.body) break;
                        const checkedInputs = p.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked');
                        if (checkedInputs.length === 1) {
                            isAttachedSpecBox = true;
                            break;
                        }
                        if (p.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 1) break;
                        p = p.parentElement;
                    }

                    if (!isAttachedSpecBox) {
                        const isNumeric = field.type === 'number' || /^[0-9.,$€£% ]+$/.test(val);
                        result.push({
                            type: isNumeric ? 'numeric' : 'open-end',
                            options: [],
                            selected: val
                        });
                    }
                });

                return result;
            }""")
        except Exception as e:
            print(f"[PageScraper] capture_page_options exception: {e}")
            return []
