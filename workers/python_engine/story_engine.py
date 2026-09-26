"""
Story Engine Module
Maintains the respondent's Persona, Established Facts, and evolving Cumulative Story.
Constructs story-focused LLM prompts and communicates with OpenRouter/OpenAI.
"""
import json
import random
import re
import time
from typing import List, Dict, Any, Optional
import httpx

from .config import get_secret, OPENROUTER_API_KEY
from .optout_filter import filter_substantive_for_ai, is_optout_option


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
        base_url: Optional[str] = None,
        input_price_per_1m: float = 0.0,
        output_price_per_1m: float = 0.0,
    ):
        self.story_state = story_state
        self.model_name = model_name
        # Resolve API key
        self.api_key = api_key or get_secret("openrouter_synthfield") or OPENROUTER_API_KEY
        self.base_url = base_url or "https://openrouter.ai/api/v1/chat/completions"
        self.input_price_per_1m = float(input_price_per_1m or 0.0)
        self.output_price_per_1m = float(output_price_per_1m or 0.0)

        # Real-time token and cost tracking
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.total_calls = 0
        self.total_cost_usd = 0.0
        self.last_model_used = model_name

    def _resolve_pricing(self, model: str):
        """Returns (input_price_per_1m, output_price_per_1m) in USD."""
        if self.input_price_per_1m > 0 or self.output_price_per_1m > 0:
            return self.input_price_per_1m, self.output_price_per_1m

        m_lower = (model or "").lower()
        pricing_defaults = {
            "llama-3.3-70b": (0.40, 0.40),
            "llama-3.1-70b": (0.40, 0.40),
            "llama-3.1-8b": (0.05, 0.05),
            "llama-3-70b": (0.50, 0.50),
            "mistral-small": (0.20, 0.20),
            "mistral-large": (2.00, 6.00),
            "qwen-2.5-72b": (0.35, 0.40),
            "gemini-2.0-flash": (0.10, 0.40),
            "gemini-1.5-flash": (0.075, 0.30),
            "gemini-1.5-pro": (1.25, 5.00),
            "gemma-2-27b": (0.20, 0.20),
            "gemma-2-9b": (0.06, 0.06),
            "gemma-4": (0.15, 0.15),
            "claude-3-5-sonnet": (3.00, 15.00),
            "claude-3-haiku": (0.25, 1.25),
            "gpt-4o-mini": (0.15, 0.60),
            "gpt-4o": (2.50, 10.00),
            "deepseek-chat": (0.14, 0.28),
        }
        for k, (inp, outp) in pricing_defaults.items():
            if k in m_lower:
                return inp, outp

        return 0.30, 0.30

    def get_usage_summary(self) -> Dict[str, Any]:
        """Returns live cumulative token usage and cost for the session."""
        return {
            "calls": self.total_calls,
            "input_tokens": self.total_input_tokens,
            "output_tokens": self.total_output_tokens,
            "cost_usd": round(self.total_cost_usd, 6),
            "model_used": self.last_model_used or self.model_name,
        }

    def _generate_fallback_answers(
        self,
        fields: List[Dict[str, Any]],
        scenario_directives: List[Dict[str, Any]],
        error_banners: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Generates robust, realistic substantive fallback answers when the LLM
        is rate-limited (429) or unavailable, strictly avoiding opt-outs.
        """
        answers = []
        for f in fields:
            f_idx = f.get("fieldIndex", 0)
            f_type = f.get("fieldType")
            raw_opts = f.get("options", [])

            if f_type == "radio":
                substantive = [i for i, o in enumerate(raw_opts) if not is_optout_option(o.get("label", ""))]
                chosen = substantive[0] if substantive else 0
                answers.append({
                    "fieldIndex": f_idx,
                    "fieldType": "radio",
                    "selectedIndex": chosen
                })
            elif f_type == "checkbox":
                substantive = [i for i, o in enumerate(raw_opts) if not is_optout_option(o.get("label", ""))]
                min_req = f.get("minSelections") or 1
                chosen = substantive[:max(min_req, 2)] if len(substantive) >= min_req else substantive
                if not chosen and raw_opts:
                    chosen = [0]
                answers.append({
                    "fieldIndex": f_idx,
                    "fieldType": "checkbox",
                    "selectedIndices": chosen
                })
            elif f_type == "ranking":
                items = f.get("items", [])
                rank_limit = f.get("rankLimit") or 3
                # Strictly filter out opt-outs
                substantive_items = [
                    item for item in items
                    if not is_optout_option(item.get("itemLabel", ""))
                ]
                rankings = []
                for r_idx, item in enumerate(substantive_items[:rank_limit]):
                    available = item.get("rankOptions", [])
                    rank_val = available[r_idx]["text"] if r_idx < len(available) else f"Rank {r_idx + 1}"
                    rankings.append({
                        "itemIndex": item.get("itemIndex"),
                        "rank": rank_val
                    })
                answers.append({
                    "fieldIndex": f_idx,
                    "fieldType": "ranking",
                    "rankings": rankings
                })
            elif f_type == "grid":
                rows = f.get("rows", [])
                col_headers = f.get("colHeaders", [])
                num_cols = len(col_headers) if col_headers else 3
                grid_sels = []
                for ri in range(len(rows)):
                    c_idx = (ri % (num_cols - 1)) if num_cols > 1 else 0
                    grid_sels.append({"rowIndex": ri, "colIndex": c_idx})
                answers.append({
                    "fieldIndex": f_idx,
                    "fieldType": "grid",
                    "gridSelections": grid_sels
                })
            elif f_type == "select":
                substantive = [i for i, o in enumerate(raw_opts) if not is_optout_option(o.get("label", "")) and not re.search(r"select|choose|--", o.get("label", ""), re.I)]
                chosen = substantive[0] if substantive else (1 if len(raw_opts) > 1 else 0)
                answers.append({
                    "fieldIndex": f_idx,
                    "fieldType": "select",
                    "selectedIndex": chosen
                })
            elif f_type in ("text", "textarea"):
                role = self.story_state.established_facts.get("job_title") or "Senior Specialist"
                answers.append({
                    "fieldIndex": f_idx,
                    "fieldType": f_type,
                    "textResponse": f"In our organization, as {role}, we prioritize robust operational standards and risk mitigation."
                })
            elif f_type == "numeric":
                min_v = f.get("min") or 10
                max_v = f.get("max") or 100
                answers.append({
                    "fieldIndex": f_idx,
                    "fieldType": "numeric",
                    "numericValue": min(max(50, int(min_v)), int(max_v))
                })

        return answers

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

        answers = parsed.get("answers", [])
        story_update = parsed.get("story_update", "").strip()
        new_facts = parsed.get("new_facts", {})
        qa_rationale = parsed.get("qa_rationale", "").strip()

        # If LLM returned empty answers despite visible fields (e.g. rate limit 429), apply intelligent fallback
        if not answers and fields:
            print(f"[StoryEngine] LLM returned no answers for {len(fields)} fields. Applying heuristic fallback.")
            answers = self._generate_fallback_answers(fields, scenario_directives, error_banners)
            if not qa_rationale:
                qa_rationale = "Heuristic answers applied to ensure continuous survey progression."

        # Ensure any field omitted by the LLM is covered
        answered_f_indices = {a.get("fieldIndex") for a in answers if isinstance(a, dict)}
        missing_fields = [f for f in fields if f.get("fieldIndex") not in answered_f_indices]
        if missing_fields:
            fallback_for_missing = self._generate_fallback_answers(missing_fields, scenario_directives, error_banners)
            answers.extend(fallback_for_missing)

        # Update StoryState
        self.story_state.update_story(story_update, new_facts)
        self.story_state.record_page_decision(page_number, answers, qa_rationale)

        return {
            "answers": answers,
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
            "2. RANKING QUESTIONS:\n"
            "   - Read the question and any instruction/hint text carefully (e.g. 'Please rank the top three in order of importance').\n"
            "   - If asked to rank top N (e.g. top 3), rank ONLY those N items (e.g. Rank 1, Rank 2, Rank 3).\n"
            "   - Assign strictly UNIQUE ranks. No two items may share the same rank.\n"
            "   - Leave ALL other remaining items unranked (do not include them in the rankings list).\n"
            "   - NEVER rank 'Don't know', 'None of the above', or any opt-out anchor.\n"
            "3. NO STRAIGHT-LINING ON GRIDS: In rating grids/matrixes, express realistic nuanced opinions across rows.\n"
            "   Do not pick the exact same scale column for all rows.\n"
            "4. SCENARIO DIRECTIVES: Mandatory QA test conditions. You MUST follow them.\n"
            "5. CONDITIONAL SPECIFY / WRITE-IN:\n"
            "   - Only provide specifyText IF you actually selected 'Other (please specify)' or an option with hasSpecify=true.\n"
            "   - If you did NOT select an option requiring specification, set specifyText to null.\n"
            "6. NO ILLOGICAL TEXT: Write realistic answers matching persona. Never enter random digits like '0'.\n"
            "7. TOKEN CONSERVATION & CRISPNESS (CRITICAL):\n"
            "   - story_update: Maximum 1 short sentence (<12 words) describing ONLY concrete new facts established (or \"\" if none).\n"
            "   - qa_rationale: Maximum 1 crisp sentence (<12 words) stating the decision rationale (e.g. 'Selected senior IT role; avoided opt-out.').\n"
            "   - NEVER use filler like 'As a professional respondent...' or restate questions.\n"
            "8. OUTPUT FORMAT: Respond ONLY with valid, raw JSON matching the requested schema. No markdown formatting, no conversational text."
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
                opts_for_ai = []
                for orig_idx, opt in enumerate(raw_opts):
                    lbl = opt.get("label", "")
                    if not allow_optout and is_optout_option(lbl):
                        continue
                    opts_for_ai.append({
                        "index": orig_idx,
                        "label": lbl,
                        "hasSpecify": opt.get("hasSpecify", False)
                    })
                if not opts_for_ai:
                    opts_for_ai = [
                        {"index": orig_idx, "label": opt.get("label", ""), "hasSpecify": opt.get("hasSpecify", False)}
                        for orig_idx, opt in enumerate(raw_opts)
                    ]
                field_desc["options"] = opts_for_ai
                if f_type == "checkbox":
                    min_req = f.get("minSelections") or 1
                    field_desc["minSelections"] = min_req
                    field_desc["instruction"] = f"Select at least {min_req} options that fit your persona. Never select opt-out options (like 'Don't know', 'None')."
            elif f_type == "ranking":
                rank_limit = f.get("rankLimit") or 3
                substantive_items = [
                    {
                        "itemIndex": item.get("itemIndex"),
                        "itemLabel": item.get("itemLabel"),
                        "hasSpecify": item.get("hasSpecify", False),
                        "availableRanks": [o.get("text") for o in item.get("rankOptions", [])]
                    }
                    for item in f.get("items", [])
                    if not is_optout_option(item.get("itemLabel", ""))
                ]
                field_desc["ranking_items"] = substantive_items
                field_desc["rankLimit"] = rank_limit
                field_desc["instruction"] = (
                    f"CRITICAL: Rank ONLY the top {rank_limit} items using unique ranks (e.g. Rank 1, Rank 2, Rank 3). "
                    f"Do NOT assign ranks to any other items. Leave remaining items unranked. "
                    f"Never rank 'Don't know' or opt-outs. "
                    f"Only supply 'specifyText' if an 'Other (please specify)' item is ranked."
                )
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
                    if not is_optout_option(o.get("label", ""))
                ]
                if not field_desc["options"]:
                    field_desc["options"] = [{"index": i, "label": o.get("label")} for i, o in enumerate(f.get("options", []))]
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
        """Calls OpenRouter with retries, model failover, and jittered rate limit handling."""
        if not self.api_key:
            print("[StoryEngine] Warning: No OpenRouter API key found. Using rule-based fallback decisions.")
            return "{}"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://surveyqa.pro",
            "X-Title": "SurveyQA Pro Living Story Engine",
        }

        candidate_models = [
            self.model_name,
            "meta-llama/llama-3.3-70b-instruct",
            "mistralai/mistral-small-24b-instruct-2501",
            "meta-llama/llama-3.1-8b-instruct"
        ]
        # Remove duplicates preserving order
        seen_models = set()
        candidate_models = [m for m in candidate_models if m and not (m in seen_models or seen_models.add(m))]

        payload = {
            "model": self.model_name,
            "messages": [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 500,
        }

        max_retries = 4
        for attempt in range(max_retries):
            current_model = candidate_models[min(attempt, len(candidate_models) - 1)] if attempt > 0 else self.model_name
            payload["model"] = current_model

            try:
                with httpx.Client(timeout=30.0) as client:
                    resp = client.post(self.base_url, headers=headers, json=payload)
                    if resp.status_code == 200:
                        data = resp.json()
                        usage = data.get("usage") or {}
                        in_tok = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
                        out_tok = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)

                        actual_model = data.get("model") or current_model
                        self.last_model_used = actual_model

                        in_price, out_price = self._resolve_pricing(actual_model)
                        call_cost = (in_tok / 1_000_000.0) * in_price + (out_tok / 1_000_000.0) * out_price

                        self.total_input_tokens += in_tok
                        self.total_output_tokens += out_tok
                        self.total_calls += 1
                        self.total_cost_usd += call_cost

                        print(f"[StoryEngine] Call #{self.total_calls} ({actual_model}): {in_tok} in + {out_tok} out tokens | cost: ${call_cost:.6f} | total session cost: ${self.total_cost_usd:.6f}")

                        return data["choices"][0]["message"]["content"]
                    elif resp.status_code == 429:
                        wait_s = (1.5 ** (attempt + 1)) + random.uniform(0.5, 2.5)
                        print(f"[StoryEngine] Rate limited (429) on {current_model}. Retrying in {wait_s:.1f}s...")
                        time.sleep(wait_s)
                    else:
                        print(f"[StoryEngine] LLM Error {resp.status_code} on {current_model}: {resp.text[:120]}")
                        time.sleep(1.0)
            except Exception as e:
                print(f"[StoryEngine] Request exception on {current_model}: {e}")
                time.sleep(1.0)

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
