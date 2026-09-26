"""
PostgreSQL Database Client for SurveyQA Pro Python Engine
"""
import json
import logging
from typing import Dict, Any, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from .config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

logger = logging.getLogger("surveyqa.db")


class DBClient:
    def __init__(self):
        self._conn = None

    def get_connection(self):
        if self._conn is None or self._conn.closed:
            self._conn = psycopg2.connect(
                host=DB_HOST,
                port=DB_PORT,
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
            )
            self._conn.autocommit = True
        return self._conn

    def close(self):
        if self._conn and not self._conn.closed:
            self._conn.close()

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM projects WHERE id = %s", (project_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def get_project_surveys(self, project_id: str) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM project_surveys WHERE project_id = %s ORDER BY created_at ASC", (project_id,))
            return [dict(r) for r in cur.fetchall()]

    def get_persona(self, persona_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM personas WHERE id = %s", (persona_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def get_project_persona(self, project_id: str, proxy_country: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Selects a persona from the project pool, matching country if specified."""
        conn = self.get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Resolve country ISO code to full name if needed
            country_name = None
            if proxy_country:
                cur.execute(
                    "SELECT country FROM proxy_countries WHERE UPPER(code) = UPPER(%s) LIMIT 1",
                    (proxy_country,),
                )
                cr = cur.fetchone()
                if cr:
                    country_name = cr["country"]

            # 2. Try country-matched persona
            if country_name:
                cur.execute(
                    """
                    SELECT p.* FROM project_personas pp
                    JOIN personas p ON p.id = pp.persona_id
                    WHERE pp.project_id = %s AND pp.is_active = true AND p.is_active = true
                      AND p.country ILIKE %s
                    ORDER BY RANDOM() LIMIT 1
                    """,
                    (project_id, country_name),
                )
                row = cur.fetchone()
                if row:
                    return dict(row)

            # 3. Fallback to any active persona in the project pool
            cur.execute(
                """
                SELECT p.* FROM project_personas pp
                JOIN personas p ON p.id = pp.persona_id
                WHERE pp.project_id = %s AND pp.is_active = true AND p.is_active = true
                ORDER BY RANDOM() LIMIT 1
                """,
                (project_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def get_scenarios(self, project_id: str, scenario_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Loads active scenarios and their ordered steps."""
        conn = self.get_connection()
        scenarios = []
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if scenario_ids and len(scenario_ids) > 0:
                cur.execute("SELECT * FROM scenarios WHERE id = ANY(%s) AND is_active = true", (scenario_ids,))
            else:
                cur.execute(
                    """
                    SELECT s.* FROM scenarios s
                    JOIN project_scenarios ps ON ps.scenario_id = s.id AND ps.project_id = %s
                    WHERE ps.is_active = true AND s.is_active = true
                    ORDER BY s.created_at ASC
                    """,
                    (project_id,),
                )
            rows = cur.fetchall()
            for r in rows:
                scen = dict(r)
                # Fetch steps
                cur.execute(
                    "SELECT * FROM scenario_steps WHERE scenario_id = %s ORDER BY step_order ASC",
                    (scen["id"],),
                )
                scen["steps"] = [dict(step) for step in cur.fetchall()]
                scenarios.append(scen)
        return scenarios

    def get_ai_model(self, workspace_id: str, model_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Fetches active AI model configuration (rates, reasoning level)."""
        conn = self.get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if model_id:
                cur.execute(
                    "SELECT * FROM ai_models WHERE workspace_id = %s AND (model_id = %s OR id::text = %s) LIMIT 1",
                    (workspace_id, model_id, model_id),
                )
                row = cur.fetchone()
                if row:
                    return dict(row)

            # Fallback to default active model
            cur.execute(
                "SELECT * FROM ai_models WHERE workspace_id = %s AND is_default = true AND is_active = true LIMIT 1",
                (workspace_id,),
            )
            row = cur.fetchone()
            if row:
                return dict(row)

            # Fallback to any active model
            cur.execute(
                "SELECT * FROM ai_models WHERE workspace_id = %s AND is_active = true ORDER BY created_at ASC LIMIT 1",
                (workspace_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def get_proxy_config(self, country_code: Optional[str]) -> Optional[Dict[str, Any]]:
        if not country_code:
            return None
        conn = self.get_connection()
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT code, country, endpoint, port FROM proxy_countries WHERE UPPER(code) = UPPER(%s) AND status = 1 LIMIT 1",
                (country_code,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def log_session_event(self, session_id: str, event_type: str, payload: Dict[str, Any], page_num: Optional[int] = None):
        conn = self.get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO session_events (session_id, event_type, payload, page_number)
                VALUES (%s, %s, %s, %s)
                """,
                (session_id, event_type, json.dumps(payload), page_num),
            )

    def log_session_answer(
        self,
        session_id: str,
        project_id: str,
        question_num: Optional[int],
        question_text: str,
        question_type: str,
        answer_value: str,
        answer_label: str,
        ai_reasoning: str,
        time_spent_s: int = 0,
    ):
        conn = self.get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO session_answers (
                    session_id, project_id, question_number, question_text,
                    question_type, answer_value, answer_label, ai_reasoning,
                    time_on_question_s
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    project_id,
                    question_num,
                    question_text[:500] if question_text else None,
                    question_type,
                    str(answer_value)[:500] if answer_value else None,
                    str(answer_label)[:500] if answer_label else None,
                    ai_reasoning[:1000] if ai_reasoning else None,
                    time_spent_s,
                ),
            )

    def record_used_ip(self, project_id: str, session_id: str, ip_address: str, country: Optional[str] = None):
        conn = self.get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO proxy_used_ips (project_id, session_id, ip_address, country)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (project_id, ip_address) DO NOTHING
                """,
                (project_id, session_id, ip_address, country),
            )

    def is_session_cancelled(self, session_id: str) -> bool:
        """Checks if session was cancelled, stopped, or terminated by the user from frontend."""
        try:
            conn = self.get_connection()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT status, error_log FROM sessions WHERE id = %s",
                    (session_id,)
                )
                row = cur.fetchone()
                if row:
                    status = (row[0] or "").lower()
                    error_log = (row[1] or "").lower()
                    if status in ("terminated", "cancelled", "stopped") or "manually stopped" in error_log:
                        return True
        except Exception:
            pass
        return False

    def update_session_status(self, session_id: str, status: str, **kwargs):
        conn = self.get_connection()
        cols = ["status = %s", "updated_at = NOW()"]
        vals = [status]

        if status == "in_progress":
            cols.append("started_at = COALESCE(started_at, NOW())")
        elif status in ("completed", "terminated", "over_quota", "error"):
            cols.append("completed_at = NOW()")

        field_map = {
            "outcome": "outcome",
            "total_duration_s": "total_duration_s",
            "question_count": "question_count",
            "redirect_type": "redirect_type",
            "quality_score": "quality_score",
            "input_tokens_total": "input_tokens_total",
            "output_tokens_total": "output_tokens_total",
            "ai_calls_count": "ai_calls_count",
            "ai_cost_usd": "ai_cost_usd",
            "model_used": "model_used",
            "error_log": "error_log",
            "persona_id": "persona_id",
            "persona_name": "persona_name",
            "scenario_name": "scenario_name",
            "proxy_ip": "proxy_ip",
            "proxy_country": "proxy_country",
        }

        for k, v in kwargs.items():
            if k in field_map:
                cols.append(f"{field_map[k]} = %s")
                vals.append(v)

        vals.append(session_id)
        sql = f"UPDATE sessions SET {', '.join(cols)} WHERE id = %s"
        try:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(vals))
        except Exception as e:
            print(f"[DB] Warning: update_session_status failed: {e}")
            try:
                conn.rollback()
            except Exception:
                pass

    def update_session_progress(
        self,
        session_id: str,
        question_count: int,
        total_duration_s: int,
        **kwargs
    ):
        conn = self.get_connection()
        cols = ["question_count = %s", "total_duration_s = %s", "updated_at = NOW()"]
        vals = [question_count, total_duration_s]

        field_map = {
            "ai_calls_count": "ai_calls_count",
            "input_tokens_total": "input_tokens_total",
            "output_tokens_total": "output_tokens_total",
            "ai_cost_usd": "ai_cost_usd",
            "model_used": "model_used",
            "quality_score": "quality_score",
            "outcome": "outcome",
            "error_log": "error_log",
        }

        for k, v in kwargs.items():
            if k in field_map and v is not None:
                cols.append(f"{field_map[k]} = %s")
                vals.append(v)

        vals.append(session_id)
        sql = f"UPDATE sessions SET {', '.join(cols)} WHERE id = %s"
        try:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(vals))
        except Exception as e:
            print(f"[DB] Warning: update_session_progress failed: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
