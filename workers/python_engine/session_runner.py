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
    def __init__(self, session_id: str):
        self.session_id = session_id
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

        # 5. Initialize Living Story Engine
        story_state = StoryState(persona=persona, proxy_country=proxy_country)
        story_engine = StoryEngine(story_state=story_state, model_name=model_name)

        # 6. Resolve Proxy
        proxy_opts = None
        if proxy_country and DECODO_USERNAME and DECODO_PASSWORD:
            proxy_cfg = self.db.get_proxy_config(proxy_country)
            if proxy_cfg and proxy_cfg.get("endpoint") and proxy_cfg.get("port"):
                proxy_opts = {
                    "server": f"http://{proxy_cfg['endpoint']}:{proxy_cfg['port']}",
                    "username": DECODO_USERNAME,
                    "password": DECODO_PASSWORD,
                }
                print(f"[SessionRunner] Decodo proxy active: {proxy_cfg['endpoint']}:{proxy_cfg['port']} ({proxy_country})")

        # 7. Survey URL
        survey_url = project.get("survey_url")
        if not survey_url:
            raise ValueError(f"Project {project_id} has no survey_url configured.")

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

            scraper = PageScraper(page)
            executor = ActionExecutor(page)

            try:
                print(f"[SessionRunner] Navigating to {survey_url}...")
                page.goto(survey_url, wait_until="domcontentloaded", timeout=45000)
                time.sleep(2.0)

                # Page Execution Loop
                while current_page < self.max_pages:
                    current_page += 1
                    page_start_time = time.time()
                    print(f"\n[SessionRunner] ── Processing Page {current_page} ── ({page.url})")

                    # Wait for DOM to stabilize
                    time.sleep(1.5)

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
                            event_type="page_view",
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
                        break

                    # 3. Match active Scenario Directives
                    scenario_directives = scenario_matcher.match_page_steps(
                        current_page, visible_questions, visible_fields
                    )
                    if scenario_directives:
                        print(f"[SessionRunner] Matched {len(scenario_directives)} scenario directives on page {current_page}")

                    # 4. Formulate AI decisions via StoryEngine
                    decisions_result = story_engine.decide_page_actions(
                        page_number=current_page,
                        questions=visible_questions,
                        fields=visible_fields,
                        scenario_directives=scenario_directives,
                        error_banners=detected_errors
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

                    time_taken = int(time.time() - page_start_time)
                    self.db.log_session_event(
                        session_id=self.session_id,
                        event_type="page_view",
                        page_num=current_page,
                        payload={
                            "url": page.url,
                            "title": f"Page {current_page}",
                            "timeTaken": time_taken,
                            "screenshot": page_screenshot_name,
                            "questions": visible_questions,
                            "options": flat_options,
                            "gridAnswers": grid_answers,
                            "answers": executed_answers,
                            "story_update": story_update,
                            "qa_rationale": qa_rationale,
                            "cumulative_story": cumulative_story,
                        }
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
                self.db.update_session_status(self.session_id, "error", error_log=str(e))
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
        self.db.update_session_status(
            self.session_id,
            outcome,
            outcome=outcome,
            quality_score=quality_score,
            total_duration_s=total_duration,
            question_count=current_page,
            model_used=model_name,
        )

        return {
            "session_id": self.session_id,
            "outcome": outcome,
            "pages": current_page,
            "quality_score": quality_score,
            "duration_s": total_duration,
            "cumulative_story": story_state.cumulative_story,
        }
