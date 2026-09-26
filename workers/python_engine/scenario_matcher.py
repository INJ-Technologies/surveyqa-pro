"""
Scenario Matcher Module
Matches active scenario steps with the visible survey questions and options.
Translates scenario rules into actionable directives for the AI and executor.
"""
import re
from typing import List, Dict, Any, Optional


def normalize_text(text: str) -> str:
    """Normalize text for reliable fuzzy matching."""
    if not text:
        return ""
    t = text.lower()
    t = re.sub(r"[\u2018\u2019\u201a\u201b\u2032\u2035]", "'", t)
    t = re.sub(r"[\u201c\u201d\u201e\u201f\u2033\u2036]", '"', t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


class ScenarioMatcher:
    def __init__(self, scenario: Optional[Dict[str, Any]] = None):
        self.scenario = scenario or {}
        self.steps = self.scenario.get("steps", [])

    def match_page_steps(
        self,
        page_number: int,
        questions_on_page: List[str],
        fields_on_page: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Finds all scenario steps that match the current page, either by
        page_number, question_contains, or always.
        Returns a list of matched directives with target field bindings.
        """
        if not self.steps:
            return []

        matched_directives = []
        norm_questions = [normalize_text(q) for q in questions_on_page]
        combined_page_text = " ".join(norm_questions)

        for step in self.steps:
            when_type = step.get("when_type", "")
            when_value = step.get("when_value") or ""
            norm_when_val = normalize_text(when_value)

            matched = False
            matched_question = ""

            if when_type == "always":
                matched = True
            elif when_type == "page_number":
                try:
                    if int(when_value) == page_number:
                        matched = True
                except (ValueError, TypeError):
                    pass
            elif when_type == "question_contains":
                if norm_when_val:
                    for i, nq in enumerate(norm_questions):
                        if norm_when_val in nq:
                            matched = True
                            matched_question = questions_on_page[i]
                            break
                    if not matched and norm_when_val in combined_page_text:
                        matched = True
            elif when_type == "question_position":
                try:
                    pos = int(when_value or 1)
                    if len(questions_on_page) >= pos:
                        matched = True
                        matched_question = questions_on_page[pos - 1]
                except (ValueError, TypeError):
                    pass

            if matched:
                directive = self._build_directive(step, matched_question, fields_on_page)
                if directive:
                    matched_directives.append(directive)

        return matched_directives

    def _build_directive(
        self,
        step: Dict[str, Any],
        matched_question: str,
        fields_on_page: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """
        Converts a raw scenario step into a structured constraint directive.
        Binds to a matching field on the page if possible.
        """
        action = step.get("action", "")
        action_mode = step.get("action_mode")
        action_text = step.get("action_text")
        raw_vals = step.get("action_values") or []

        # Parse 1-based index values from scenario
        vals = []
        for v in raw_vals:
            try:
                vals.append(int(v))
            except (ValueError, TypeError):
                pass

        # Find which field on the page corresponds to this step
        target_field_index = None
        if matched_question:
            norm_mq = normalize_text(matched_question)
            for f in fields_on_page:
                f_q = normalize_text(f.get("questionLabel", ""))
                if f_q and (f_q in norm_mq or norm_mq in f_q):
                    target_field_index = f.get("fieldIndex")
                    break

        if target_field_index is None and len(fields_on_page) > 0:
            target_field_index = fields_on_page[0].get("fieldIndex")

        directive = {
            "step_order": step.get("step_order"),
            "action": action,
            "action_mode": action_mode,
            "action_text": action_text,
            "action_values": vals,
            "target_field_index": target_field_index,
            "matched_question": matched_question,
            "step_id": step.get("id"),
        }

        # Formulate human/AI readable instruction
        if action == "select_exact" and vals:
            directive["instruction"] = f"Must select option #{vals[0]}"
        elif action == "select_one_of" and vals:
            directive["instruction"] = f"Must select one of options: {vals}"
        elif action == "select_not_in" and vals:
            directive["instruction"] = f"Must NOT select options: {vals}"
        elif action == "open_end" and action_text:
            directive["instruction"] = f"Provide text response: '{action_text}'"
        elif action == "skip":
            directive["instruction"] = "Do not answer - skip immediately"
        elif action == "wait":
            directive["instruction"] = f"Wait for {step.get('duration_s', 5)} seconds"
        else:
            directive["instruction"] = f"Apply action '{action}'"

        return directive
