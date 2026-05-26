"""API-Football free-tier loader.

100 requests/day budget. We use it to fill the two gaps the existing sources
don't cover well:

* Confirmed lineups for upcoming matches
* Injury reports

Because the budget is so tight, this loader is **budget-aware**: it tracks
remaining quota in ``core.pipeline_meta`` (key ``api_football.budget``) and
refuses to make a call when below zero. The quota resets daily.

Set ``API_FOOTBALL_KEY`` in the environment to activate.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

API_BASE = "https://v3.football.api-sports.io"


class APIFootballLoader:
    SOURCE = "api_football"

    def __init__(self, pg_warehouse, *, http_client=None):
        self._pg = pg_warehouse
        self._http = http_client

    # ---- budget -----------------------------------------------------------

    def _budget_state(self) -> dict:
        with self._pg.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT value FROM core.pipeline_meta WHERE key = 'api_football.budget'")
            row = cur.fetchone()
        if row:
            return row[0]
        from backend.pipeline.settings import get_pipeline_settings
        return {"day": date.today().isoformat(), "remaining": get_pipeline_settings().api_football_daily_budget}

    def _decrement_budget(self) -> int:
        from backend.pipeline.settings import get_pipeline_settings
        today = date.today().isoformat()
        with self._pg.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT value FROM core.pipeline_meta WHERE key = 'api_football.budget'")
            row = cur.fetchone()
            state = row[0] if row else None
            daily_budget = get_pipeline_settings().api_football_daily_budget
            if not state or state.get("day") != today:
                state = {"day": today, "remaining": daily_budget}
            state["remaining"] = max(0, int(state.get("remaining", 0)) - 1)
            cur.execute(
                """
                INSERT INTO core.pipeline_meta (key, value)
                VALUES ('api_football.budget', %s::jsonb)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
                """,
                (_json(state),),
            )
            conn.commit()
            return state["remaining"]

    # ---- HTTP -------------------------------------------------------------

    def _get(self, path: str, params: Optional[dict] = None) -> Optional[dict]:
        from backend.pipeline.settings import get_pipeline_settings
        s = get_pipeline_settings()
        if not s.api_football_key:
            logger.debug("API-Football skipped: API_FOOTBALL_KEY unset")
            return None
        state = self._budget_state()
        if state.get("day") == date.today().isoformat() and state.get("remaining", 0) <= 0:
            logger.info("API-Football budget exhausted for today")
            return None

        headers = {"x-apisports-key": s.api_football_key}
        url = f"{API_BASE}{path}"
        try:
            if self._http is not None:
                resp = self._http.get_json(url, params=params, headers=headers)
            else:
                import httpx
                r = httpx.get(url, params=params, headers=headers, timeout=15.0)
                r.raise_for_status()
                resp = r.json()
        finally:
            self._decrement_budget()
        return resp

    # ---- ingest -----------------------------------------------------------

    def fetch_lineups(self, fixture_id: int) -> Optional[list[dict]]:
        data = self._get("/fixtures/lineups", {"fixture": fixture_id})
        return (data or {}).get("response")

    def fetch_injuries(self, league_id: int, season: int) -> Optional[list[dict]]:
        data = self._get("/injuries", {"league": league_id, "season": season})
        return (data or {}).get("response")

    def load_injuries(self, league_id: int, season: int) -> int:
        rows = self.fetch_injuries(league_id, season) or []
        if not rows:
            return 0
        with self._pg.ingest_run(self.SOURCE, "load_injuries",
                                 params={"league_id": league_id, "season": season}) as _:
            written = 0
            with self._pg.connection() as conn, conn.cursor() as cur:
                for r in rows:
                    player_name = ((r.get("player") or {}).get("name") or "").strip()
                    if not player_name:
                        continue
                    # Upsert player row (no DOB available here)
                    cur.execute(
                        """
                        INSERT INTO core.dim_players (canonical_name)
                        VALUES (%s)
                        ON CONFLICT (canonical_name, dob) DO UPDATE SET
                            canonical_name = EXCLUDED.canonical_name
                        RETURNING player_id
                        """,
                        (player_name,),
                    )
                    pid_row = cur.fetchone()
                    if not pid_row:
                        continue
                    player_id = pid_row[0]
                    info = r.get("fixture") or {}
                    cur.execute(
                        """
                        INSERT INTO core.fact_player_injuries
                            (player_id, start_date, expected_return, injury_type, severity, source, last_updated)
                        VALUES (%s, %s, %s, %s, %s, %s, now())
                        """,
                        (
                            player_id,
                            _parse_date(info.get("date")),
                            None,
                            (r.get("player") or {}).get("reason"),
                            (r.get("player") or {}).get("type"),
                            self.SOURCE,
                        ),
                    )
                    written += 1
                conn.commit()
            return written


def _json(obj) -> str:
    import json
    return json.dumps(obj, default=str)


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None
