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

from .optout_filter import is_consent_checkbox


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
            sel_idx = 0

        target_opt = options[sel_idx]
        opt_id = target_opt.get("id")
        opt_val = target_opt.get("value")
        opt_label = target_opt.get("label", "")

        # Click radio
        clicked = False
        if opt_id:
            loc = locate_by_id(self.page, opt_id)
            if loc.count() > 0:
                safe_click(loc)
                clicked = True
                try:
                    if not loc.is_checked():
                        clean_id = opt_id.replace('"', '\\"')
                        lbl = self.page.locator(f'label[for="{clean_id}"]')
                        if lbl.count() > 0:
                            safe_click(lbl)
                        if not loc.is_checked():
                            loc.evaluate("el => { el.checked = true; el.dispatchEvent(new Event('change', {bubbles: true})); }")
                except Exception:
                    pass

        if not clicked and group_name:
            if opt_val:
                loc = self.page.locator(f'input[type="radio"][name="{group_name}"][value="{opt_val}"]')
                if loc.count() > 0:
                    safe_click(loc)
                    clicked = True
            if not clicked:
                all_radios = self.page.locator(f'input[type="radio"][name="{group_name}"]').all()
                if sel_idx < len(all_radios):
                    safe_click(all_radios[sel_idx])
                    clicked = True

        time.sleep(0.2)

        # Handle follow-up specify box if present
        spec_text = ans.get("specifyText")
        if target_opt.get("hasSpecify") or spec_text:
            if not spec_text:
                # Fallback to realistic persona role/title rather than random numbers
                role = (persona or {}).get("job_title") or (persona or {}).get("role") or "Strategy & Operations"
                spec_text = role

            spec_id = target_opt.get("specifyId")
            if spec_id:
                loc = locate_by_id(self.page, spec_id)
                if loc.count() > 0 and loc.is_visible():
                    loc.fill(spec_text)
            else:
                # Find input near radio
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
                }""", {"groupName": group_name, "text": spec_text})

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
            # Fallback if AI returned single selectedIndex
            single = ans.get("selectedIndex")
            sel_indices = [single] if single is not None else [0]

        if not options:
            return None

        selected_labels = []
        for idx in sel_indices:
            if idx < 0 or idx >= len(options):
                continue
            opt = options[idx]
            opt_id = opt.get("id")
            opt_val = opt.get("value")
            opt_label = opt.get("label", "")

            clicked = False
            if opt_id:
                loc = locate_by_id(self.page, opt_id)
                if loc.count() > 0:
                    safe_click(loc)
                    clicked = True
                    try:
                        if not loc.is_checked():
                            clean_id = opt_id.replace('"', '\\"')
                            lbl = self.page.locator(f'label[for="{clean_id}"]')
                            if lbl.count() > 0:
                                safe_click(lbl)
                            if not loc.is_checked():
                                loc.evaluate("el => { el.checked = true; el.dispatchEvent(new Event('change', {bubbles: true})); }")
                    except Exception:
                        pass

            if not clicked and group_name:
                if opt_val:
                    loc = self.page.locator(f'input[type="checkbox"][name="{group_name}"][value="{opt_val}"]')
                    if loc.count() > 0:
                        safe_click(loc)
                        clicked = True
                if not clicked:
                    all_cbs = self.page.locator(f'input[type="checkbox"][name="{group_name}"]').all()
                    if idx < len(all_cbs):
                        safe_click(all_cbs[idx])
                        clicked = True

            selected_labels.append(opt_label)
            time.sleep(0.15)

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
