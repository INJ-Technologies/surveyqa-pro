"""
Survey Session Runner (Playwright Sync Engine)
Orchestrates the entire survey QA run:
- Decodo proxy setup
- Visible-only scraping
- Scenario directive binding
- Persona & Living Story narrative progression
- Action execution (safeguarded against duplicate ranks, straight-lining, and opt-outs)
- Screenshot capture and session event logging
- Quality Score computation
"""
import os
import time
import math
from typing import Dict, Any, Optional
from playwright.sync_api import sync_playwright

from .config import SCREENSHOTS_DIR, TRACES_DIR, DECODO_USERNAME, DECODO_PASSWORD
from .db import DBClient
from .optout_filter import is_optout_option
from .scraper import PageScraper
from .scenario_matcher import ScenarioMatcher
from .story_engine import StoryState, StoryEngine
from .executor import ActionExecutor


def calculate_quality_score(
    page_count: int,
    outcome: str,
    total_duration_s: int,
    optout_count: int,
    error_count: int
) -> int:
    """
    Computes a realistic QA Quality Score (0-100):
    - Higher completion / valid outcome: up to 40 pts
    - Zero opt-out penalty (no 'Don't know' anchors): up to 30 pts
    - Pacing & error resilience: up to 30 pts
    """
    score = 0
    # 1. Outcome (40 pts)
    if outcome == "completed":
        score += 40
    elif outcome in ("terminated", "over_quota"):
        score += 30  # Valid intentional screening
    else:
        score += min(20, page_count * 2)

    # 2. Strict Anti-Optout integrity (30 pts)
    optout_penalty = min(30, optout_count * 15)
    score += max(0, 30 - optout_penalty)

    # 3. Pacing & Clean Validation (30 pts)
    error_penalty = min(15, error_count * 5)
    pacing_pts = 15 if total_duration_s >= 60 else max(5, int(total_duration_s / 4))
    score += max(0, 15 - error_penalty) + pacing_pts

    return min(100, max(10, score))


class SurveySessionRunner:
    def __init__(self, session_id: str, survey_url: Optional[str] = None, internal_testing: Optional[bool] = None):
        self.session_id = session_id
        self.survey_url = survey_url
        self.internal_testing = internal_testing
        self.db = DBClient()
        self.max_pages = 150

    def run(self) -> Dict[str, Any]:
        session = self.db.get_session(self.session_id)
        if not session:
            raise ValueError(f"Session {self.session_id} not found in database.")

        project_id = str(session["project_id"])
        project = self.db.get_project(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found for session {self.session_id}.")

        # 1. Update status to in_progress
        self.db.update_session_status(self.session_id, "in_progress")
        start_time = time.time()

        # Check internal testing mode: CLI flag override OR session record OR proxy_provider == 'none'
        is_internal = False
        if self.internal_testing is True:
            is_internal = True
        elif session.get("internal_testing"):
            is_internal = True
        elif str(session.get("proxy_provider") or "").lower() in ["none", "direct", "internal", "local"]:
            is_internal = True

        # 2. Resolve Persona
        proxy_country = session.get("proxy_country") or project.get("proxy_country")
        persona_id = session.get("persona_id")
        persona = None
        if persona_id:
            persona = self.db.get_persona(str(persona_id))
        if not persona:
            persona = self.db.get_project_persona(project_id, proxy_country=proxy_country)

        persona_name = persona.get("name") if persona else "Automated QA Respondent"
        self.db.update_session_status(self.session_id, "in_progress", persona_name=persona_name)

        # 3. Resolve Scenarios
        scenario_id = session.get("scenario_id")
        scenarios = self.db.get_scenarios(project_id, [str(scenario_id)] if scenario_id else None)
        active_scenario = scenarios[0] if scenarios else {}
        scenario_matcher = ScenarioMatcher(active_scenario)

        # 4. Resolve AI Model
        workspace_id = str(project.get("workspace_id") or session.get("workspace_id"))
        ai_model_record = self.db.get_ai_model(workspace_id, session.get("ai_model_id"))
        model_name = ai_model_record.get("model_id") if ai_model_record else "meta-llama/llama-3.3-70b-instruct"
        input_price = float(ai_model_record.get("input_price_per_1m") or 0.0) if ai_model_record else 0.0
        output_price = float(ai_model_record.get("output_price_per_1m") or 0.0) if ai_model_record else 0.0

        # 5. Initialize Living Story Engine
        story_state = StoryState(persona=persona, proxy_country=proxy_country)
        story_engine = StoryEngine(
            story_state=story_state,
            model_name=model_name,
            input_price_per_1m=input_price,
            output_price_per_1m=output_price,
        )

        # 6. Resolve Proxy
        proxy_opts = None
        if is_internal:
            print(f"[SessionRunner] Internal testing mode active — proxy disabled (direct connection)")
        elif proxy_country and DECODO_USERNAME and DECODO_PASSWORD:
            proxy_cfg = self.db.get_proxy_config(proxy_country)
            if proxy_cfg and proxy_cfg.get("endpoint") and proxy_cfg.get("port"):
                proxy_opts = {
                    "server": f"http://{proxy_cfg['endpoint']}:{proxy_cfg['port']}",
                    "username": DECODO_USERNAME,
                    "password": DECODO_PASSWORD,
                }
                print(f"[SessionRunner] Decodo proxy active: {proxy_cfg['endpoint']}:{proxy_cfg['port']} ({proxy_country})")
            else:
                print(f"[SessionRunner] No proxy endpoint configured for {proxy_country} — using direct connection")
        else:
            print(f"[SessionRunner] Direct connection (no proxy configured)")

        # 7. Survey URL resolution
        survey_url = self.survey_url or session.get("survey_url")
        if not survey_url:
            surveys = self.db.get_project_surveys(project_id)
            if surveys:
                matched_survey = None
                if proxy_country:
                    for s in surveys:
                        c_data = s.get("countries") or []
                        if isinstance(c_data, str):
                            try:
                                import json
                                c_data = json.loads(c_data)
                            except Exception:
                                c_data = [c_data]
                        if proxy_country.upper() in [str(c).upper() for c in c_data] or "ALL" in [str(c).upper() for c in c_data]:
                            matched_survey = s
                            break
                if not matched_survey and surveys:
                    matched_survey = surveys[0]
                if matched_survey and matched_survey.get("url"):
                    raw_url = matched_survey["url"]
                    resp_id = session.get("response_id") or "test_response"
                    survey_url = raw_url.replace("identifier", resp_id).replace("IDENTIFIER", resp_id)

        if not survey_url:
            survey_url = project.get("survey_url")

        if not survey_url:
            raise ValueError(f"Could not resolve survey URL for session {self.session_id} (Project {project_id}).")

        # Ensure directories
        sess_screenshots_dir = os.path.join(SCREENSHOTS_DIR, self.session_id)
        os.makedirs(sess_screenshots_dir, exist_ok=True)
        os.makedirs(TRACES_DIR, exist_ok=True)

        current_page = 0
        total_optouts_chosen = 0
        total_errors_encountered = 0
        outcome = "in_progress"

        print(f"[SessionRunner] Launching browser for session {self.session_id}...")

        with sync_playwright() as p:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-infobars",
                "--window-position=0,0",
                "--ignore-certificate-errors",
            ]
            launch_kwargs = {
                "headless": True,
                "proxy": proxy_opts,
                "args": launch_args,
            }
            exec_path = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
            if exec_path and os.path.exists(exec_path):
                launch_kwargs["executable_path"] = exec_path

            browser = p.chromium.launch(**launch_kwargs)

            context = browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            )

            page = context.new_page()
            page.set_default_timeout(30000)

            # Log browser_launched event
            self.db.log_session_event(
                session_id=self.session_id,
                event_type="browser_launched",
                page_num=0,
                payload={
                    "proxy": "internal-testing" if is_internal else (f"decodo-{proxy_country}" if proxy_opts else "direct"),
                    "responseId": session.get("response_id"),
                    "surveyUrl": survey_url,
                    "scenarioName": active_scenario.get("name") if active_scenario else None,
                }
            )

            scraper = PageScraper(page)
            executor = ActionExecutor(page)

            try:
                print(f"[SessionRunner] Navigating to {survey_url}...")
                nav_success = False
                last_nav_err = None
                for attempt in range(2):
                    try:
                        wait_strat = "domcontentloaded" if attempt == 0 else "commit"
                        nav_timeout = 60000 if proxy_opts else 30000
                        print(f"[SessionRunner] Navigation attempt {attempt + 1} (wait_until='{wait_strat}', timeout={nav_timeout}ms)...")
                        page.goto(survey_url, wait_until=wait_strat, timeout=nav_timeout)
                        nav_success = True
                        break
                    except Exception as goto_err:
                        last_nav_err = goto_err
                        print(f"[SessionRunner] Navigation attempt {attempt + 1} encountered error: {goto_err}")
                        if attempt == 0:
                            time.sleep(2.0)
                        else:
                            raise last_nav_err

                # Allow initial scripts/DOM to settle
                time.sleep(1.0 if is_internal else 2.5)

                consecutive_error_count = 0
                # Page Execution Loop
                while current_page < self.max_pages:
                    # Check if session was stopped or terminated by user from frontend
                    if self.db.is_session_cancelled(self.session_id):
                        print(f"[SessionRunner] Session {self.session_id} was stopped/terminated by user. Halting execution.")
                        outcome = "terminated"
                        break

                    current_page += 1
                    page_start_time = time.time()
                    print(f"\n[SessionRunner] ── Processing Page {current_page} ── ({page.url})")

                    # Wait for DOM to stabilize
                    time.sleep(0.5 if is_internal else 1.5)

                    # 1. Scrape visible elements and inspect state
                    scrape_data = scraper.scrape_visible_page()
                    visible_questions = scrape_data.get("questions", [])
                    visible_fields = scrape_data.get("fields", [])
                    detected_errors = scrape_data.get("errors", [])
                    detected_outcome = scrape_data.get("outcome")

                    if detected_errors:
                        total_errors_encountered += len(detected_errors)
                        print(f"[SessionRunner] Detected error banners: {detected_errors}")

                    # 2. Check for Exit Page (Completed / Terminated / Over Quota)
                    if detected_outcome:
                        outcome = detected_outcome
                        print(f"[SessionRunner] Survey reached exit page: '{outcome}' on Page {current_page}")

                        # Take final exit screenshot
                        exit_screenshot_name = f"page_{current_page}.png"
                        exit_screenshot_path = os.path.join(sess_screenshots_dir, exit_screenshot_name)
                        page.screenshot(path=exit_screenshot_path, full_page=True)

                        # Log exit page event
                        self.db.log_session_event(
                            session_id=self.session_id,
                            event_type="page_answered",
                            page_num=current_page,
                            payload={
                                "isExitPage": True,
                                "exitOutcome": outcome,
                                "url": page.url,
                                "title": "Exit Page",
                                "timeTaken": int(time.time() - page_start_time),
                                "screenshot": exit_screenshot_name,
                                "questions": visible_questions,
                                "story_snapshot": story_state.cumulative_story,
                            }
                        )
                        usage = story_engine.get_usage_summary()
                        self.db.update_session_progress(
                            session_id=self.session_id,
                            question_count=current_page,
                            total_duration_s=int(time.time() - start_time),
                            ai_calls_count=usage["calls"],
                            input_tokens_total=usage["input_tokens"],
                            output_tokens_total=usage["output_tokens"],
                            ai_cost_usd=usage["cost_usd"],
                            model_used=usage["model_used"],
                        )
                        break

                    # 3. Match active Scenario Directives
                    scenario_directives = scenario_matcher.match_page_steps(
                        current_page, visible_questions, visible_fields
                    )
                    if scenario_directives:
                        print(f"[SessionRunner] Matched {len(scenario_directives)} scenario directives on page {current_page}")

                    # 4. Formulate AI decisions via StoryEngine
                    if self.db.is_session_cancelled(self.session_id):
                        print(f"[SessionRunner] Session {self.session_id} was stopped by user before AI call. Halting.")
                        outcome = "terminated"
                        break

                    decisions_result = story_engine.decide_page_actions(
                        page_number=current_page,
                        questions=visible_questions,
                        fields=visible_fields,
                        scenario_directives=scenario_directives,
                        error_banners=detected_errors,
                        page_content=scrape_data.get("pageContent", ""),
                        is_intro_page=scrape_data.get("isIntroPage", False)
                    )

                    answers = decisions_result.get("answers", [])
                    story_update = decisions_result.get("story_update", "")
                    qa_rationale = decisions_result.get("qa_rationale", "")
                    cumulative_story = decisions_result.get("cumulative_story", "")

                    print(f"[StoryEngine] Story Update: \"{story_update}\"")
                    print(f"[StoryEngine] QA Rationale: \"{qa_rationale}\"")

                    # 5. Execute actions on the DOM
                    executed_answers = executor.execute_decisions(
                        fields=visible_fields,
                        answers=answers,
                        persona=persona
                    )

                    # 6. Post-execution verification & screenshot
                    time.sleep(0.5)
                    page_screenshot_name = f"page_{current_page}.png"
                    page_screenshot_path = os.path.join(sess_screenshots_dir, page_screenshot_name)
                    page.screenshot(path=page_screenshot_path, full_page=True)

                    # Check if any opt-out was selected (for score calculation)
                    for ea in executed_answers:
                        sel_str = str(ea.get("selected", ""))
                        if is_optout_option(sel_str):
                            total_optouts_chosen += 1

                    # 7. Log structured Page View event in session_events
                    grid_answers = []
                    flat_options = []
                    for ea in executed_answers:
                        if ea.get("type") == "grid":
                            grid_answers.extend(ea.get("gridAnswers", []))
                        else:
                            flat_options.append(ea)

                    # Capture rich live DOM options (all available options + selected state)
                    try:
                        captured_page_options = scraper.capture_page_options()
                    except Exception as e:
                        print(f"[SessionRunner] capture_page_options exception: {e}")
                        captured_page_options = []

                    final_options = captured_page_options if captured_page_options else flat_options

                    time_taken = int(time.time() - page_start_time)
                    self.db.log_session_event(
                        session_id=self.session_id,
                        event_type="page_answered",
                        page_num=current_page,
                        payload={
                            "url": page.url,
                            "title": f"Page {current_page}",
                            "timeTaken": time_taken,
                            "screenshot": page_screenshot_name,
                            "questions": visible_questions,
                            "options": final_options,
                            "gridAnswers": grid_answers,
                            "answers": executed_answers,
                            "page_content": scrape_data.get("pageContent", ""),
                            "is_intro_page": scrape_data.get("isIntroPage", False),
                            "survey_background": story_engine.story_state.survey_background,
                            "current_section": story_engine.story_state.current_section,
                            "story_update": story_update,
                            "qa_rationale": qa_rationale,
                            "cumulative_story": cumulative_story,
                        }
                    )

                    # Real-time progress and cost update to sessions table
                    usage = story_engine.get_usage_summary()
                    self.db.update_session_progress(
                        session_id=self.session_id,
                        question_count=current_page,
                        total_duration_s=int(time.time() - start_time),
                        ai_calls_count=usage["calls"],
                        input_tokens_total=usage["input_tokens"],
                        output_tokens_total=usage["output_tokens"],
                        ai_cost_usd=usage["cost_usd"],
                        model_used=usage["model_used"],
                    )

                    # Log each answer to session_answers table
                    for ans_idx, ea in enumerate(executed_answers):
                        self.db.log_session_answer(
                            session_id=self.session_id,
                            project_id=project_id,
                            question_num=ans_idx + 1,
                            question_text=ea.get("question", visible_questions[0] if visible_questions else ""),
                            question_type=ea.get("type", "generic"),
                            answer_value=str(ea.get("selected", "")),
                            answer_label=str(ea.get("selected", "")),
                            ai_reasoning=qa_rationale,
                            time_spent_s=time_taken
                        )

                    # Loop guard: detect if stuck on repeated validation errors for >= 5 attempts
                    if detected_errors:
                        consecutive_error_count += 1
                        print(f"[SessionRunner] Active validation errors (attempt {consecutive_error_count}/5): {detected_errors}")
                        if consecutive_error_count >= 5:
                            print(f"[SessionRunner] Stalled on page errors for 5 consecutive attempts. Stopping loop.")
                            outcome = "error"
                            self.db.update_session_status(self.session_id, "error", error_log=f"Validation loop: {detected_errors}")
                            break
                    else:
                        consecutive_error_count = 0

                    # 8. Click Next button (with countdown timer awareness)
                    next_clicked = executor.wait_for_timer_and_click_next()
                    if not next_clicked:
                        print(f"[SessionRunner] No Next button found or enabled. Checking if survey has completed...")
                        time.sleep(2.0)
                        post_outcome = scraper.detect_outcome_from_url() or scraper.detect_outcome_from_content()
                        if post_outcome:
                            outcome = post_outcome
                            break
                        else:
                            print(f"[SessionRunner] Unable to progress from page {current_page}. Ending session.")
                            break

                if outcome == "in_progress":
                    outcome = "completed"

            except Exception as e:
                print(f"[SessionRunner] Fatal error during session run: {e}")
                outcome = "error"
                usage = story_engine.get_usage_summary() if 'story_engine' in locals() else {}
                self.db.update_session_status(
                    self.session_id,
                    "error",
                    error_log=str(e),
                    ai_calls_count=usage.get("calls", 0),
                    input_tokens_total=usage.get("input_tokens", 0),
                    output_tokens_total=usage.get("output_tokens", 0),
                    ai_cost_usd=usage.get("cost_usd", 0.0),
                    model_used=usage.get("model_used", model_name),
                )
            finally:
                browser.close()

        total_duration = int(time.time() - start_time)
        quality_score = calculate_quality_score(
            page_count=current_page,
            outcome=outcome,
            total_duration_s=total_duration,
            optout_count=total_optouts_chosen,
            error_count=total_errors_encountered
        )

        print(f"\n[SessionRunner] Session {self.session_id} finished:")
        print(f"  Outcome: {outcome}")
        print(f"  Pages: {current_page}")
        print(f"  Duration: {total_duration}s")
        print(f"  Quality Score: {quality_score}/100")
        print(f"  Final Living Story: \"{story_state.cumulative_story}\"")

        # Update final session state in PostgreSQL
        usage = story_engine.get_usage_summary()
        if outcome == "terminated":
            self.db.update_session_status(
                self.session_id,
                "terminated",
                outcome="error",
                error_log="Manually stopped by user",
                quality_score=0,
                total_duration_s=total_duration,
                question_count=current_page,
                model_used=usage["model_used"],
                ai_calls_count=usage["calls"],
                input_tokens_total=usage["input_tokens"],
                output_tokens_total=usage["output_tokens"],
                ai_cost_usd=usage["cost_usd"],
            )
        else:
            self.db.update_session_status(
                self.session_id,
                outcome,
                outcome=outcome,
                quality_score=quality_score,
                total_duration_s=total_duration,
                question_count=current_page,
                model_used=usage["model_used"],
                ai_calls_count=usage["calls"],
                input_tokens_total=usage["input_tokens"],
                output_tokens_total=usage["output_tokens"],
                ai_cost_usd=usage["cost_usd"],
            )

        return {
            "session_id": self.session_id,
            "outcome": outcome,
            "pages": current_page,
            "quality_score": quality_score,
            "duration_s": total_duration,
            "cumulative_story": story_state.cumulative_story,
        }
