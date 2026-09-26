"""
Survey Action Executor (Playwright Sync API)
Executes AI and Scenario decisions directly on the page DOM.
Handles custom radio/checkbox controls, ranking dropdowns, anti-straight-lining grids,
text specify boxes, timer waiting, and next-button clicking with validation retry.
"""
import random
import time
from typing import List, Dict, Any, Optional
from playwright.sync_api import Page, Locator

from .optout_filter import is_consent_checkbox, is_optout_option


def safe_click(locator: Locator):
    """Safely click an element with fallback to DOM evaluate click."""
    try:
        locator.scroll_into_view_if_needed(timeout=2000)
        locator.click(force=True, timeout=2000)
    except Exception:
        try:
            locator.evaluate("el => el.click()")
        except Exception:
            pass


def locate_by_id(page: Page, el_id: str) -> Locator:
    """
    Safely locates an element by its ID attribute, properly handling
    special characters like dots, colons, and brackets common in survey platforms.
    """
    if not el_id:
        return page.locator("nonexistent-selector")
    clean_id = el_id.replace('"', '\\"')
    return page.locator(f'[id="{clean_id}"]')


class ActionExecutor:
    def __init__(self, page: Page):
        self.page = page

    def handle_consent_checkboxes(self) -> List[str]:
        """Automatically ticks any required consent/privacy/terms checkboxes."""
        ticked = []
        try:
            cbs = self.page.locator('input[type="checkbox"]').all()
            for cb in cbs:
                if not cb.is_visible():
                    continue
                # Get label text
                label_text = cb.evaluate("""el => {
                    if (el.id) {
                        const lbl = document.querySelector(`label[for="${el.id}"]`);
                        if (lbl) return lbl.innerText || '';
                    }
                    const pl = el.closest('label');
                    if (pl) return pl.innerText || '';
                    return el.parentElement ? el.parentElement.innerText : '';
                }""")
                if is_consent_checkbox(label_text):
                    if not cb.is_checked():
                        safe_click(cb)
                        time.sleep(0.15)
                        ticked.append(label_text.strip()[:60])
        except Exception as e:
            print(f"[Executor] Consent check exception: {e}")
        return ticked

    def _check_input_element(
        self,
        opt_id: Optional[str],
        opt_name: Optional[str] = None,
        opt_val: Optional[str] = None,
        is_radio: bool = False
    ) -> bool:
        """
        Robustly clicks and checks a radio or checkbox across any survey platform
        (Decipher FIR, Qualtrics, Confirmit, SurveyMonkey, Vanilla HTML).
        """
        input_type = "radio" if is_radio else "checkbox"
        loc = None

        if opt_id:
            loc = locate_by_id(self.page, opt_id)
        if (not loc or loc.count() == 0) and opt_name and opt_val:
            loc = self.page.locator(f'input[type="{input_type}"][name="{opt_name}"][value="{opt_val}"]')
        if (not loc or loc.count() == 0) and opt_name:
            loc = self.page.locator(f'input[type="{input_type}"][name="{opt_name}"]')

        if not loc or loc.count() == 0:
            return False

        target_el = loc.first

        # 1. Try clicking associated label or custom FIR element first (mirrors human interaction)
        label_clicked = False
        try:
            if opt_id:
                clean_id = opt_id.replace('"', '\\"')
                lbl = self.page.locator(f'label[for="{clean_id}"]')
                if lbl.count() > 0 and lbl.first.is_visible():
                    safe_click(lbl.first)
                    label_clicked = True
            if not label_clicked:
                parent_lbl = target_el.locator('xpath=ancestor::label[1]')
                if parent_lbl.count() > 0 and parent_lbl.first.is_visible():
                    safe_click(parent_lbl.first)
                    label_clicked = True
        except Exception:
            pass

        # 2. If not checked, click target element directly
        try:
            if not target_el.is_checked():
                safe_click(target_el)
        except Exception:
            pass

        # 3. DOM Level State & Decipher FIR Synchronization
        try:
            target_el.evaluate("""(el) => {
                el.checked = true;
                const wrapper = el.closest('.fir-checkbox, .fir-radio, .element, label, [class*="fir-"]');
                if (wrapper) {
                    wrapper.classList.add('fir-selected');
                    wrapper.classList.add('checked');
                    wrapper.classList.add('selected');
                }
                const lbl = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest('label');
                if (lbl) {
                    lbl.classList.add('fir-selected');
                    lbl.classList.add('checked');
                    lbl.classList.add('selected');
                }
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }""")
        except Exception:
            pass

        return True

    def execute_decisions(
        self,
        fields: List[Dict[str, Any]],
        answers: List[Dict[str, Any]],
        persona: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Executes all field decisions on the current page DOM.
        Returns a list of structured answer summary records.
        """
        # Always tick mandatory consent checkboxes first
        self.handle_consent_checkboxes()

        results = []
        field_map = {f.get("fieldIndex"): f for f in fields}

        # Safety Fallback: If AI returned no answers but fields are present, execute substantive defaults
        if not answers and fields:
            print(f"[Executor] No answers provided for {len(fields)} fields; applying safety fallback execution.")
            for f in fields:
                f_idx = f.get("fieldIndex", 0)
                f_type = f.get("fieldType")
                opts = f.get("options", [])
                substantive = [i for i, o in enumerate(opts) if not is_optout_option(o.get("label", ""))]
                chosen_idx = substantive[0] if substantive else 0

                if f_type == "radio":
                    res = self._execute_radio(f, {"selectedIndex": chosen_idx}, persona)
                    if res: results.append(res)
                elif f_type == "checkbox":
                    chosen_indices = substantive[:2] if len(substantive) >= 2 else ([chosen_idx])
                    res = self._execute_checkbox(f, {"selectedIndices": chosen_indices}, persona)
                    if res: results.append(res)
                elif f_type == "ranking":
                    res = self._execute_ranking(f, {"rankings": [{"itemIndex": i, "rank": str(i + 1)} for i in range(len(f.get("items", [])))]})
                    if res: results.append(res)
                elif f_type == "grid":
                    rows = f.get("rows", [])
                    cols = f.get("colHeaders", [])
                    grid_sels = [{"rowIndex": ri, "colIndex": (ri % max(1, len(cols) - 1))} for ri in range(len(rows))]
                    res = self._execute_grid(f, {"gridSelections": grid_sels})
                    if res: results.append(res)
                elif f_type == "select":
                    res = self._execute_select(f, {"selectedIndex": chosen_idx})
                    if res: results.append(res)
                elif f_type in ("textarea", "text"):
                    res = self._execute_text(f, {"textResponse": "We maintain high compliance and operational standards across all units."}, persona)
                    if res: results.append(res)
                elif f_type == "numeric":
                    res = self._execute_numeric(f, {"numericValue": 50})
                    if res: results.append(res)
            return results

        for ans in answers:
            f_idx = ans.get("fieldIndex")
            field = field_map.get(f_idx)
            if not field:
                continue

            f_type = field.get("fieldType")
            try:
                if f_type == "radio":
                    res = self._execute_radio(field, ans, persona)
                    if res:
                        results.append(res)
                elif f_type == "checkbox":
                    res = self._execute_checkbox(field, ans, persona)
                    if res:
                        results.append(res)
                elif f_type == "ranking":
                    res = self._execute_ranking(field, ans)
                    if res:
                        results.append(res)
                elif f_type == "grid":
                    res = self._execute_grid(field, ans)
                    if res:
                        results.append(res)
                elif f_type == "select":
                    res = self._execute_select(field, ans)
                    if res:
                        results.append(res)
                elif f_type in ("textarea", "text"):
                    res = self._execute_text(field, ans, persona)
                    if res:
                        results.append(res)
                elif f_type == "numeric":
                    res = self._execute_numeric(field, ans)
                    if res:
                        results.append(res)
            except Exception as e:
                print(f"[Executor] Error executing field {f_idx} ({f_type}): {e}")

        return results

    def _execute_radio(
        self,
        field: Dict[str, Any],
        ans: Dict[str, Any],
        persona: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        group_name = field.get("groupName")
        options = field.get("options", [])
        sel_idx = ans.get("selectedIndex", 0)

        if not options:
            return None

        # Clamp index
        if sel_idx < 0 or sel_idx >= len(options):
            substantive = [i for i, o in enumerate(options) if not is_optout_option(o.get("label", ""))]
            sel_idx = substantive[0] if substantive else 0

        target_opt = options[sel_idx]
        opt_id = target_opt.get("id")
        opt_name = target_opt.get("name") or group_name
        opt_val = target_opt.get("value")
        opt_label = target_opt.get("label", "")

        self._check_input_element(opt_id=opt_id, opt_name=opt_name, opt_val=opt_val, is_radio=True)
        time.sleep(0.15)

        # Handle follow-up specify box if present
        spec_text = ans.get("specifyText")
        if target_opt.get("hasSpecify") or spec_text:
            if not spec_text:
                role = (persona or {}).get("job_title") or (persona or {}).get("role") or "Strategy & Operations"
                spec_text = role

            spec_id = target_opt.get("specifyId")
            if spec_id:
                loc = locate_by_id(self.page, spec_id)
                if loc.count() > 0 and loc.is_visible():
                    loc.fill(spec_text)
            else:
                self.page.evaluate("""(data) => {
                    const r = document.querySelector(`input[type="radio"][name="${data.groupName}"]:checked`);
                    if (!r) return;
                    let node = r.parentElement;
                    for (let i = 0; i < 5; i++) {
                        if (!node) break;
                        const inp = node.querySelector('input[type="text"], textarea');
                        if (inp) {
                            inp.value = data.text;
                            inp.dispatchEvent(new Event('input', { bubbles: true }));
                            inp.dispatchEvent(new Event('change', { bubbles: true }));
                            break;
                        }
                        node = node.parentElement;
                    }
                }""", {"groupName": opt_name or group_name, "text": spec_text})

        return {
            "type": "radio",
            "question": field.get("questionLabel", ""),
            "selected": opt_label,
            "selectedIndex": sel_idx,
            "specifyText": spec_text,
            "options": [o.get("label") for o in options]
        }

    def _execute_checkbox(
        self,
        field: Dict[str, Any],
        ans: Dict[str, Any],
        persona: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        group_name = field.get("groupName")
        options = field.get("options", [])
        sel_indices = ans.get("selectedIndices")

        if sel_indices is None:
            single = ans.get("selectedIndex")
            sel_indices = [single] if single is not None else []

        if not options:
            return None

        # Guarantee at least 1 substantive selection to satisfy Decipher validation rules
        if not sel_indices:
            substantive = [i for i, o in enumerate(options) if not is_optout_option(o.get("label", ""))]
            sel_indices = [substantive[0]] if substantive else [0]

        # Uncheck any opt-outs if substantive options are selected
        has_substantive = any(not is_optout_option(options[i].get("label", "")) for i in sel_indices if 0 <= i < len(options))
        if has_substantive:
            for opt in options:
                if is_optout_option(opt.get("label", "")):
                    opt_id = opt.get("id")
                    if opt_id:
                        try:
                            loc = locate_by_id(self.page, opt_id)
                            if loc.count() > 0 and loc.first.is_checked():
                                loc.first.evaluate("""(el) => {
                                    el.checked = false;
                                    const wrapper = el.closest('.fir-checkbox, .fir-radio, .element, label, [class*="fir-"]');
                                    if (wrapper) {
                                        wrapper.classList.remove('fir-selected', 'checked', 'selected');
                                    }
                                    el.dispatchEvent(new Event('change', { bubbles: true }));
                                }""")
                        except Exception:
                            pass

        selected_labels = []
        for idx in sel_indices:
            if idx < 0 or idx >= len(options):
                continue
            opt = options[idx]
            opt_id = opt.get("id")
            opt_name = opt.get("name") or group_name
            opt_val = opt.get("value")
            opt_label = opt.get("label", "")

            self._check_input_element(opt_id=opt_id, opt_name=opt_name, opt_val=opt_val, is_radio=False)
            selected_labels.append(opt_label)

            # Handle specify if present
            spec_text = ans.get("specifyText")
            if opt.get("hasSpecify") or spec_text:
                if not spec_text:
                    role = (persona or {}).get("job_title") or (persona or {}).get("role") or "Strategy & Operations"
                    spec_text = role
                spec_id = opt.get("specifyId")
                if spec_id:
                    loc = locate_by_id(self.page, spec_id)
                    if loc.count() > 0 and loc.is_visible():
                        loc.fill(spec_text)

            time.sleep(0.1)

        return {
            "type": "checkbox",
            "question": field.get("questionLabel", ""),
            "selected": selected_labels,
            "selectedIndices": sel_indices,
            "options": [o.get("label") for o in options]
        }

    def _execute_ranking(self, field: Dict[str, Any], ans: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Executes ranking dropdown selections.
        CRITICAL: Guarantees unique rank assignment (1, 2, 3...) across items,
        avoiding red Decipher validation banners!
        """
        items = field.get("items", [])
        if not items:
            return None

        rankings = ans.get("rankings", [])
        rank_map = {}
        for r in rankings:
            item_idx = r.get("itemIndex")
            rank_val = str(r.get("rank", "")).strip()
            if item_idx is not None and rank_val:
                rank_map[item_idx] = rank_val

        # Ensure distinct ranks (1..N) without duplicates
        assigned_ranks = set()
        final_assignments = []

        for i, item in enumerate(items):
            chosen_rank = rank_map.get(i)
            valid_opts = [o.get("text") for o in item.get("rankOptions", [])]

            if not chosen_rank or chosen_rank in assigned_ranks or chosen_rank not in valid_opts:
                # Pick next available rank
                for opt in valid_opts:
                    if opt not in assigned_ranks and re.match(r"^[0-9]+$", opt):
                        chosen_rank = opt
                        break

            if not chosen_rank and valid_opts:
                chosen_rank = valid_opts[0]

            assigned_ranks.add(chosen_rank)
            final_assignments.append({
                "itemLabel": item.get("itemLabel"),
                "rank": chosen_rank
            })

            # Apply to DOM
            sel_id = item.get("id")
            sel_name = item.get("name")
            try:
                if sel_id:
                    loc = locate_by_id(self.page, sel_id)
                    if loc.count() > 0 and loc.is_visible():
                        loc.select_option(label=chosen_rank)
                elif sel_name:
                    loc = self.page.locator(f'select[name="{sel_name}"]')
                    if loc.count() > 0 and loc.is_visible():
                        loc.select_option(label=chosen_rank)
            except Exception:
                pass
            time.sleep(0.15)

        return {
            "type": "ranking",
            "question": field.get("questionLabel", ""),
            "selected": ", ".join([f"{a['itemLabel']}: #{a['rank']}" for a in final_assignments]),
            "assignments": final_assignments
        }

    def _execute_grid(self, field: Dict[str, Any], ans: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Executes radio grid / matrix selections.
        Enforces anti-straight-lining so responses look natural and authentic.
        """
        rows = field.get("rows", [])
        col_headers = field.get("colHeaders", [])
        if not rows:
            return None

        grid_selections = ans.get("gridSelections", [])
        col_map = {}
        for gs in grid_selections:
            r_idx = gs.get("rowIndex")
            c_idx = gs.get("colIndex", 0)
            if r_idx is not None:
                col_map[r_idx] = c_idx

        # Check for straight-lining (all rows assigned the identical column)
        chosen_cols = [col_map.get(ri, 0) for ri in range(len(rows))]
        if len(rows) >= 3 and len(set(chosen_cols)) == 1:
            # Vary at least one row slightly
            jitter_row = random.randint(0, len(rows) - 1)
            num_cols = len(col_headers) if col_headers else 4
            col_map[jitter_row] = (chosen_cols[0] + 1) % max(1, num_cols)

        row_results = []
        for ri, row in enumerate(rows):
            target_col = col_map.get(ri, 0)
            cols = row.get("columns", [])
            if not cols:
                continue

            target_col = max(0, min(target_col, len(cols) - 1))
            col_opt = cols[target_col]
            radio_id = col_opt.get("id")

            if radio_id:
                loc = locate_by_id(self.page, radio_id)
                if loc.count() > 0:
                    safe_click(loc)
                    try:
                        if not loc.is_checked():
                            clean_id = radio_id.replace('"', '\\"')
                            lbl = self.page.locator(f'label[for="{clean_id}"]')
                            if lbl.count() > 0:
                                safe_click(lbl)
                            if not loc.is_checked():
                                loc.evaluate("el => { el.checked = true; el.dispatchEvent(new Event('change', {bubbles: true})); }")
                    except Exception:
                        pass
            else:
                row_name = row.get("groupName")
                if row_name:
                    all_radios = self.page.locator(f'input[type="radio"][name="{row_name}"]').all()
                    if target_col < len(all_radios):
                        safe_click(all_radios[target_col])

            col_label = col_opt.get("label") or (col_headers[target_col] if target_col < len(col_headers) else f"Col {target_col + 1}")
            row_results.append({
                "row": row.get("rowLabel"),
                "selected": col_label,
                "answered": True
            })
            time.sleep(0.1)

        return {
            "type": "grid",
            "question": field.get("questionLabel", ""),
            "gridAnswers": row_results
        }

    def _execute_select(self, field: Dict[str, Any], ans: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        options = field.get("options", [])
        sel_idx = ans.get("selectedIndex", 0)
        if not options:
            return None

        sel_idx = max(0, min(sel_idx, len(options) - 1))
        chosen = options[sel_idx]
        label = chosen.get("label")

        sel_id = field.get("id")
        sel_name = field.get("name")

        try:
            if sel_id:
                loc = locate_by_id(self.page, sel_id)
                if loc.count() > 0:
                    loc.select_option(label=label)
            elif sel_name:
                loc = self.page.locator(f'select[name="{sel_name}"]')
                if loc.count() > 0:
                    loc.select_option(label=label)
        except Exception:
            pass

        return {
            "type": "select",
            "question": field.get("questionLabel", ""),
            "selected": label,
            "options": [o.get("label") for o in options]
        }

    def _execute_text(
        self,
        field: Dict[str, Any],
        ans: Dict[str, Any],
        persona: Optional[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        text_resp = ans.get("textResponse")
        if not text_resp or not text_resp.strip():
            # Realistic persona response
            role = (persona or {}).get("job_title") or "Operations"
            industry = (persona or {}).get("industry") or "Technology"
            text_resp = f"From our perspective in {industry}, operational reliability, security, and scalability remain our top priorities."

        f_id = field.get("id")
        f_name = field.get("name")

        try:
            if f_id:
                loc = locate_by_id(self.page, f_id)
                if loc.count() > 0:
                    loc.fill(text_resp)
            elif f_name:
                loc = self.page.locator(f'[name="{f_name}"]')
                if loc.count() > 0:
                    loc.fill(text_resp)
        except Exception:
            pass

        return {
            "type": "open-end",
            "question": field.get("questionLabel", ""),
            "selected": text_resp,
            "text": text_resp
        }

    def _execute_numeric(self, field: Dict[str, Any], ans: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        num_val = ans.get("numericValue")
        if num_val is None:
            min_val = float(field.get("min") or 1)
            max_val = float(field.get("max") or 100)
            num_val = int(random.uniform(min_val, min(max_val, 100)))

        f_id = field.get("id")
        f_name = field.get("name")

        try:
            if f_id:
                loc = locate_by_id(self.page, f_id)
                if loc.count() > 0:
                    loc.fill(str(num_val))
            elif f_name:
                loc = self.page.locator(f'[name="{f_name}"]')
                if loc.count() > 0:
                    loc.fill(str(num_val))
        except Exception:
            pass

        return {
            "type": "numeric",
            "question": field.get("questionLabel", ""),
            "selected": str(num_val),
            "value": num_val
        }

    def wait_for_timer_and_click_next(self, max_wait_s: int = 120) -> bool:
        """
        Locates Next/Continue button. If disabled due to a countdown timer,
        waits for the timer before proceeding.
        """
        next_selectors = [
            'input[type="submit"]', 'button[type="submit"]',
            'input[value="Next"]', 'input[value="Continue"]',
            'input[value="Next »"]', 'input[value="Continue »"]',
            'input[value="Submit"]',
            'button:has-text("Next")', 'button:has-text("Continue")',
            'button:has-text("Submit")',
            '#next', '.next-btn', '.btn-next'
        ]

        start_time = time.time()
        while time.time() - start_time < max_wait_s:
            for sel in next_selectors:
                try:
                    btn = self.page.locator(sel).first
                    if btn.count() > 0 and btn.is_visible():
                        if btn.is_enabled():
                            safe_click(btn)
                            time.sleep(1.0)
                            return True
                except Exception:
                    pass

            # Check if there is an active countdown timer
            timer_text = self.page.evaluate("""() => {
                const timerSelectors = ['[class*="timer"]', '[id*="timer"]', '[class*="countdown"]', '[class*="counter"]'];
                for (const sel of timerSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent) return (el.innerText || '').trim();
                }
                const body = (document.body ? document.body.innerText : '') || '';
                const m = body.match(/you will be able to continue in (\\d+)/i);
                return m ? m[0] : null;
            }""")

            if timer_text:
                print(f"[Executor] Waiting for timer: {timer_text}...")
                time.sleep(2.0)
            else:
                time.sleep(1.0)

        return False
