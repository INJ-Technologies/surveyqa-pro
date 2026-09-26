"""
Story Engine Module
Maintains the respondent's Persona, Established Facts, and evolving Cumulative Story.
Constructs story-focused LLM prompts and communicates with OpenRouter/OpenAI.
"""
import json
import re
import time
from typing import List, Dict, Any, Optional
import httpx

from .config import get_secret, OPENROUTER_API_KEY
from .optout_filter import filter_substantive_for_ai


class StoryState:
    def __init__(self, persona: Optional[Dict[str, Any]] = None, proxy_country: Optional[str] = None):
        self.persona = persona or {}
        self.proxy_country = proxy_country
        self.established_facts: Dict[str, Any] = {}
        self.cumulative_story: str = ""
        self.page_history: List[Dict[str, Any]] = []
        self._init_initial_story()

    def _init_initial_story(self):
        """Construct the foundational story narrative from the persona."""
        if not self.persona:
            country_str = f" in {self.proxy_country}" if self.proxy_country else ""
            self.cumulative_story = f"Professional respondent{country_str} completing this survey."
            if self.proxy_country:
                self.established_facts["country"] = self.proxy_country
            return

        job = self.persona.get("job_title") or self.persona.get("role") or "Professional"
        industry = self.persona.get("industry") or "Technology"
        company_size = self.persona.get("company_size") or "Mid-size"
        country = self.persona.get("country") or self.proxy_country or "United States"

        self.established_facts["country"] = country
        self.established_facts["job_title"] = job
        self.established_facts["industry"] = industry
        self.established_facts["company_size"] = company_size

        attrs = self.persona.get("behavioural_attrs") or {}
        demographics = self.persona.get("demographics") or {}
        if attrs.get("seniority"):
            self.established_facts["seniority"] = attrs["seniority"]
        if demographics.get("years_experience"):
            self.established_facts["years_experience"] = demographics["years_experience"]

        # Ultra-crisp foundational story (1 concise sentence)
        self.cumulative_story = f"{job} in {industry} ({company_size} org), based in {country}."

    def update_story(self, story_update: str, new_facts: Optional[Dict[str, Any]] = None):
        """Appends new narrative developments and merges newly confirmed facts concisely."""
        if story_update and story_update.strip():
            clean_update = story_update.strip()
            # Filter boilerplate / filler phrases
            boilerplate = (
                "professional respondent", "completing this survey", "diligently",
                "valuable feedback", "ongoing engagement", "no questions",
                "ready to", "straightforward", "standard response", "participating in",
                "ensure data quality", "meets the required standards", "robust",
            )
            is_filler = any(b in clean_update.lower() for b in boilerplate)
            if not is_filler and len(clean_update) > 5:
                # Keep cumulative story bounded (at most ~40-50 words / 2-3 concise clauses)
                sentences = [s.strip() for s in re.split(r'[.!?]+', self.cumulative_story) if s.strip()]
                new_clause = clean_update.rstrip('.!?;')
                if len(sentences) >= 3:
                    self.cumulative_story = f"{sentences[0]}. {sentences[-1]}. {new_clause}."
                else:
                    self.cumulative_story = f"{self.cumulative_story.rstrip('.')} {new_clause}."

        if new_facts and isinstance(new_facts, dict):
            for k, v in new_facts.items():
                if v is not None and str(v).strip():
                    self.established_facts[str(k)] = v

    def record_page_decision(self, page_number: int, decisions: Dict[str, Any], qa_rationale: str):
        """Record page decisions in history."""
        self.page_history.append({
            "page_number": page_number,
            "decisions": decisions,
            "qa_rationale": qa_rationale,
            "story_snapshot": self.cumulative_story,
        })


class StoryEngine:
    def __init__(
        self,
        story_state: StoryState,
        model_name: str = "meta-llama/llama-3.3-70b-instruct",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None
    ):
        self.story_state = story_state
        self.model_name = model_name
        # Resolve API key
        self.api_key = api_key or get_secret("openrouter_synthfield") or OPENROUTER_API_KEY
        self.base_url = base_url or "https://openrouter.ai/api/v1/chat/completions"

    def decide_page_actions(
        self,
        page_number: int,
        questions: List[str],
        fields: List[Dict[str, Any]],
        scenario_directives: List[Dict[str, Any]],
        error_banners: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Formulates decisions for all visible fields on the page based on the
        Persona, Living Story, Scenario Constraints, and Anti-Optout ground rules.
        """
        # Fast path: if no form fields to answer and no error banners to resolve, skip LLM call entirely
        if not fields and not error_banners:
            return {
                "answers": [],
                "story_update": "",
                "qa_rationale": "Page transition — no actionable questions.",
                "cumulative_story": self.story_state.cumulative_story,
                "new_facts": {},
                "raw_response": "{}"
            }

        prompt = self._build_prompt(page_number, questions, fields, scenario_directives, error_banners)
        system_instruction = self._build_system_instruction()

        raw_response = self._call_llm(system_instruction, prompt)
        parsed = self._parse_json_response(raw_response)

        # Update StoryState
        story_update = parsed.get("story_update", "").strip()
        new_facts = parsed.get("new_facts", {})
        qa_rationale = parsed.get("qa_rationale", "").strip()

        self.story_state.update_story(story_update, new_facts)
        self.story_state.record_page_decision(page_number, parsed.get("answers", []), qa_rationale)

        return {
            "answers": parsed.get("answers", []),
            "story_update": story_update,
            "qa_rationale": qa_rationale,
            "cumulative_story": self.story_state.cumulative_story,
            "new_facts": new_facts,
            "raw_response": raw_response
        }

    def _build_system_instruction(self) -> str:
        return (
            "You are an authentic, highly consistent respondent completing a survey for QA validation.\n"
            "Embody the Persona and maintain a cohesive Living Story.\n\n"
            "STRICT GROUND RULES:\n"
            "1. NO OPT-OUTS: Strictly NEVER choose 'Don't know', 'None of the above', 'N/A', or opt-out anchors.\n"
            "   Always make substantive, knowledgeable selections appropriate for your role.\n"
            "2. UNIQUE RANKINGS: In ranking questions, assign distinct ranks (1, 2, 3...) with no duplicates.\n"
            "3. NO STRAIGHT-LINING ON GRIDS: In rating grids/matrixes, express realistic nuanced opinions across rows.\n"
            "   Do not pick the exact same scale column for all rows.\n"
            "4. SCENARIO DIRECTIVES: Mandatory QA test conditions. You MUST follow them.\n"
            "5. NO ILLOGICAL TEXT: Write realistic answers matching persona. Never enter random digits like '0'.\n"
            "6. TOKEN CONSERVATION & CRISPNESS (CRITICAL):\n"
            "   - story_update: Maximum 1 short sentence (<12 words) describing ONLY concrete new facts established (or \"\" if none).\n"
            "   - qa_rationale: Maximum 1 crisp sentence (<12 words) stating the decision rationale (e.g. 'Selected senior IT role; avoided opt-out.').\n"
            "   - NEVER use filler like 'As a professional respondent...' or restate questions.\n"
            "7. OUTPUT FORMAT: Respond ONLY with valid, raw JSON matching the requested schema. No markdown formatting, no conversational text."
        )

    def _build_prompt(
        self,
        page_number: int,
        questions: List[str],
        fields: List[Dict[str, Any]],
        scenario_directives: List[Dict[str, Any]],
        error_banners: Optional[List[str]] = None
    ) -> str:
        # 1. Compact Respondent Story & Facts
        compact_facts = {k: v for k, v in self.story_state.established_facts.items() if v}
        story_summary = (
            f"=== RESPONDENT IDENTITY ===\n"
            f"Story: \"{self.story_state.cumulative_story}\"\n"
            f"Confirmed Facts: {json.dumps(compact_facts)}\n"
        )

        # 2. Page Questions
        questions_str = "\n".join([f"Q{i+1}: {q}" for i, q in enumerate(questions)]) if questions else "Questions not explicitly labeled."

        # 3. Active Error Banners (if any)
        error_str = ""
        if error_banners:
            error_str = (
                f"\n⚠️ PLATFORM VALIDATION ERROR ON PREVIOUS ATTEMPT:\n"
                f"{json.dumps(error_banners)}\n"
                f"You MUST adjust your answers to satisfy this survey validation rule!\n"
            )

        # 4. Scenario Directives
        scenario_str = ""
        if scenario_directives:
            scenario_str = "\n🎯 MANDATORY SCENARIO DIRECTIVES:\n"
            for d in scenario_directives:
                scenario_str += f"- Step {d.get('step_order')}: {d.get('instruction')} (targets field {d.get('target_field_index')})\n"

        # 5. Process Fields & Filter Opt-Outs
        formatted_fields = []
        for f in fields:
            f_idx = f.get("fieldIndex")
            f_type = f.get("fieldType")
            f_label = f.get("questionLabel", "")

            # Check if this field has a scenario directive
            f_directive = next((d for d in scenario_directives if d.get("target_field_index") == f_idx), None)
            allow_optout = f_directive and f_directive.get("action") == "select_exact"

            field_desc = {
                "fieldIndex": f_idx,
                "fieldType": f_type,
                "questionLabel": f_label,
            }

            if f_directive:
                field_desc["scenario_requirement"] = f_directive.get("instruction")

            if f_type in ("radio", "checkbox"):
                raw_opts = f.get("options", [])
                # Strip out 'Don't know', 'None of the above'
                eligible_opts = filter_substantive_for_ai(raw_opts, allow_optout=allow_optout)
                field_desc["options"] = [
                    {"index": i, "label": opt.get("label", ""), "hasSpecify": opt.get("hasSpecify", False)}
                    for i, opt in enumerate(eligible_opts)
                ]
            elif f_type == "ranking":
                field_desc["ranking_items"] = [
                    {
                        "itemIndex": item.get("itemIndex"),
                        "itemLabel": item.get("itemLabel"),
                        "availableRanks": [o.get("text") for o in item.get("rankOptions", [])]
                    }
                    for item in f.get("items", [])
                ]
                field_desc["instruction"] = "Assign a UNIQUE rank to each item (1 = highest priority). No two items can share the same rank!"
            elif f_type == "grid":
                field_desc["columnHeaders"] = f.get("colHeaders", [])
                field_desc["rows"] = [
                    {"rowIndex": ri, "rowLabel": r.get("rowLabel")}
                    for ri, r in enumerate(f.get("rows", []))
                ]
                field_desc["instruction"] = "Select realistic scale rating for each row. Avoid straight-lining!"
            elif f_type == "select":
                field_desc["options"] = [
                    {"index": i, "label": o.get("label")}
                    for i, o in enumerate(f.get("options", []))
                ]
            elif f_type in ("textarea", "text"):
                field_desc["placeholder"] = f.get("placeholder", "")
                field_desc["instruction"] = "Provide a 1-2 sentence thoughtful answer in 1st person consistent with your persona."
            elif f_type == "numeric":
                field_desc["unit"] = f.get("unit", "")
                field_desc["min"] = f.get("min")
                field_desc["max"] = f.get("max")

            formatted_fields.append(field_desc)

        user_content = (
            f"{story_summary}\n"
            f"=== CURRENT SURVEY PAGE {page_number} ===\n"
            f"{questions_str}\n"
            f"{error_str}\n"
            f"{scenario_str}\n"
            f"=== ACTIONABLE FORM FIELDS TO ANSWER ===\n"
            f"{json.dumps(formatted_fields, indent=2)}\n\n"
            f"=== RESPONSE JSON SCHEMA ===\n"
            f"Return a single JSON object with this exact structure:\n"
            f"{{\n"
            f'  "answers": [\n'
            f'    {{\n'
            f'      "fieldIndex": 0,\n'
            f'      "fieldType": "radio" | "checkbox" | "ranking" | "grid" | "select" | "text" | "numeric",\n'
            f'      "selectedIndex": 0,\n'
            f'      "selectedIndices": [0, 2],\n'
            f'      "rankings": [{{"itemIndex": 0, "rank": "1"}}],\n'
            f'      "gridSelections": [{{"rowIndex": 0, "colIndex": 2}}],\n'
            f'      "textResponse": "...",\n'
            f'      "numericValue": 75,\n'
            f'      "specifyText": "..."\n'
            f'    }}\n'
            f'  ],\n'
            f'  "new_facts": {{"key": "value"}},\n'
            f'  "story_update": "Max 1 short sentence (<12 words) of new fact, or empty string",\n'
            f'  "qa_rationale": "Max 1 crisp sentence (<12 words) QA reason"\n'
            f"}}"
        )
        return user_content

    def _call_llm(self, system_instruction: str, user_prompt: str) -> str:
        """Calls OpenRouter with retries and rate limit handling."""
        if not self.api_key:
            print("[StoryEngine] Warning: No OpenRouter API key found. Using rule-based fallback decisions.")
            return json.dumps({
                "answers": [],
                "story_update": "",
                "qa_rationale": "Default rule-based selection applied.",
                "new_facts": {}
            })

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://surveyqa.pro",
            "X-Title": "SurveyQA Pro Living Story Engine",
        }

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 500,
        }

        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                with httpx.Client(timeout=45.0) as client:
                    resp = client.post(self.base_url, headers=headers, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        return data["choices"][0]["message"]["content"]
                    elif resp.status_code == 429:
                        wait_s = 2 ** attempt
                        print(f"[StoryEngine] Rate limited (429). Retrying in {wait_s}s...")
                        time.sleep(wait_s)
                    else:
                        print(f"[StoryEngine] LLM Error {resp.status_code}: {resp.text}")
                        time.sleep(1)
            except Exception as e:
                print(f"[StoryEngine] Request exception: {e}")
                time.sleep(1)

        return "{}"

    def _parse_json_response(self, text: str) -> Dict[str, Any]:
        """Safely parses LLM JSON response, extracting it from markdown codeblocks if necessary."""
        if not text:
            return {"answers": [], "story_update": "", "qa_rationale": "", "new_facts": {}}

        clean = text.strip()
        # Remove ```json ... ``` wrapper if present
        if clean.startswith("```"):
            clean = re.sub(r"^```(?:json)?\s*", "", clean)
            clean = re.sub(r"\s*```$", "", clean)
            clean = clean.strip()

        try:
            return json.loads(clean)
        except Exception:
            # Try finding the first '{' and last '}'
            m = re.search(r"(\{.*\})", clean, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(1))
                except Exception:
                    pass

        return {
            "answers": [],
            "story_update": "Proceeded with survey responses adhering to persona guidelines.",
            "qa_rationale": "Answers processed via fallback parser.",
            "new_facts": {}
        }
