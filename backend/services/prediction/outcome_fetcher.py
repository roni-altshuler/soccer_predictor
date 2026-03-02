"""
Automatic Outcome Fetcher & Incremental Model Learning.

Runs periodically to:
1. Check ESPN for finished matches that have pending predictions
2. Update prediction records with actual outcomes
3. Update ELO ratings from real results
4. Trigger incremental model re-training when enough new data accumulates
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

# ESPN scoreboard base URL
ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer"

# Map league identifiers to ESPN league slugs
LEAGUE_ESPN_MAP = {
    "premier_league": "eng.1",
    "la_liga": "esp.1",
    "bundesliga": "ger.1",
    "serie_a": "ita.1",
    "ligue_1": "fra.1",
    "mls": "usa.1",
    "champions_league": "uefa.champions",
    "europa_league": "uefa.europa",
    "world_cup": "fifa.world",
    "eredivisie": "ned.1",
    "primeira_liga": "por.1",
}

# Incremental retrain threshold
RETRAIN_THRESHOLD = 50  # Re-train after this many new outcomes


class OutcomeFetcher:
    """Fetches real match outcomes and feeds them back to the model."""

    def __init__(self):
        self._running = False
        self._last_run: Optional[datetime] = None
        self._outcomes_since_retrain = 0

    async def fetch_finished_matches(
        self, league_slug: str, date: str
    ) -> List[Dict]:
        """
        Fetch finished match results from ESPN for a given league and date.

        Args:
            league_slug: ESPN league identifier (e.g. 'eng.1')
            date: Date string YYYYMMDD

        Returns:
            List of dicts with match_id, home_team, away_team, home_score, away_score
        """
        url = f"{ESPN_BASE}/{league_slug}/scoreboard?dates={date}"
        results = []

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()

            for event in data.get("events", []):
                comp = event.get("competitions", [{}])[0]
                status_name = comp.get("status", {}).get("type", {}).get("name", "")

                if "FINAL" not in status_name and "FULL_TIME" not in status_name:
                    continue

                competitors = comp.get("competitors", [])
                home = next(
                    (c for c in competitors if c.get("homeAway") == "home"), None
                )
                away = next(
                    (c for c in competitors if c.get("homeAway") == "away"), None
                )

                if not home or not away:
                    continue

                results.append(
                    {
                        "match_id": str(event.get("id", "")),
                        "home_team": home.get("team", {}).get("displayName", ""),
                        "away_team": away.get("team", {}).get("displayName", ""),
                        "home_score": int(home.get("score", 0)),
                        "away_score": int(away.get("score", 0)),
                        "date": event.get("date", ""),
                        "league": league_slug,
                    }
                )
        except Exception as e:
            logger.warning(f"Error fetching ESPN results for {league_slug}/{date}: {e}")

        return results

    async def update_pending_predictions(self) -> Dict:
        """
        Main routine: check all pending predictions, fetch real results, update tracker.

        Returns summary dict with counts.
        """
        from backend.services.prediction.tracker import get_prediction_tracker

        tracker = get_prediction_tracker()
        pending = tracker.get_recent_predictions(limit=500, completed_only=False)
        pending = [p for p in pending if p.actual_winner is None]

        if not pending:
            return {"checked": 0, "updated": 0, "message": "No pending predictions"}

        # Group pending by date range (check last 14 days)
        dates_to_check = set()
        now = datetime.utcnow()
        for pred in pending:
            try:
                pred_date = datetime.fromisoformat(pred.match_date)
                if pred_date <= now:
                    dates_to_check.add(pred_date.strftime("%Y%m%d"))
            except (ValueError, TypeError):
                # Try parsing YYYY-MM-DD
                try:
                    pred_date = datetime.strptime(pred.match_date[:10], "%Y-%m-%d")
                    if pred_date <= now:
                        dates_to_check.add(pred_date.strftime("%Y%m%d"))
                except Exception:
                    pass

        if not dates_to_check:
            return {"checked": 0, "updated": 0, "message": "No past-due predictions"}

        updated_count = 0
        checked_count = 0

        # Build a lookup of pending predictions by approximate team names
        pending_lookup: Dict[str, object] = {}
        for pred in pending:
            key = f"{pred.home_team.lower()}_{pred.away_team.lower()}"
            pending_lookup[key] = pred
            # Also store by match_id
            pending_lookup[pred.match_id] = pred

        # Fetch results for each league + date combination
        for date_str in sorted(dates_to_check):
            for _league_name, espn_slug in LEAGUE_ESPN_MAP.items():
                try:
                    finished = await self.fetch_finished_matches(espn_slug, date_str)
                    checked_count += len(finished)

                    for result in finished:
                        # Try match by ID first
                        pred = pending_lookup.get(result["match_id"])

                        # Try match by team names
                        if pred is None:
                            key = f"{result['home_team'].lower()}_{result['away_team'].lower()}"
                            pred = pending_lookup.get(key)

                        if pred is not None and hasattr(pred, "match_id"):
                            record = tracker.update_outcome(
                                match_id=pred.match_id,
                                home_goals=result["home_score"],
                                away_goals=result["away_score"],
                            )
                            if record:
                                updated_count += 1
                                self._outcomes_since_retrain += 1
                                # Update ELO ratings with real result
                                self._update_elo(
                                    result["home_team"],
                                    result["away_team"],
                                    result["home_score"],
                                    result["away_score"],
                                )
                except Exception as e:
                    logger.warning(f"Error processing {espn_slug}/{date_str}: {e}")

                # Small delay to avoid rate limiting
                await asyncio.sleep(0.1)

        # Check if incremental retrain is warranted
        retrain_triggered = False
        if self._outcomes_since_retrain >= RETRAIN_THRESHOLD:
            retrain_triggered = await self._trigger_incremental_retrain()
            if retrain_triggered:
                self._outcomes_since_retrain = 0

        self._last_run = datetime.utcnow()

        return {
            "checked": checked_count,
            "updated": updated_count,
            "pending_remaining": len(pending) - updated_count,
            "retrain_triggered": retrain_triggered,
            "outcomes_since_retrain": self._outcomes_since_retrain,
        }

    def _update_elo(
        self,
        home_team: str,
        away_team: str,
        home_score: int,
        away_score: int,
    ):
        """Update ELO ratings with a real match result."""
        try:
            from backend.services.ratings.elo import get_elo_system

            elo = get_elo_system()
            elo.calculate_new_ratings(home_team, away_team, home_score, away_score)
        except Exception as e:
            logger.debug(f"ELO update failed: {e}")

    async def _trigger_incremental_retrain(self) -> bool:
        """Trigger incremental model re-training with new data."""
        try:
            from backend.services.prediction.training import train_model_pipeline

            logger.info(
                f"Triggering incremental retrain after {RETRAIN_THRESHOLD} new outcomes"
            )
            result = await train_model_pipeline()
            logger.info(f"Retrain complete: {result}")
            return True
        except Exception as e:
            logger.error(f"Incremental retrain failed: {e}")
            return False

    def get_status(self) -> Dict:
        """Return current fetcher status."""
        return {
            "last_run": self._last_run.isoformat() if self._last_run else None,
            "outcomes_since_retrain": self._outcomes_since_retrain,
            "retrain_threshold": RETRAIN_THRESHOLD,
            "running": self._running,
        }


# ── Background scheduler ──────────────────────────────────────────────


async def outcome_update_loop(interval_minutes: int = 30):
    """
    Background coroutine that periodically fetches outcomes.

    Started once at app startup.
    """
    fetcher = get_outcome_fetcher()

    while True:
        try:
            fetcher._running = True
            result = await fetcher.update_pending_predictions()
            logger.info(f"Outcome update: {result}")
        except Exception as e:
            logger.error(f"Outcome update loop error: {e}")
        finally:
            fetcher._running = False

        await asyncio.sleep(interval_minutes * 60)


# ── Singleton ──────────────────────────────────────────────────────────

_outcome_fetcher: Optional[OutcomeFetcher] = None


def get_outcome_fetcher() -> OutcomeFetcher:
    global _outcome_fetcher
    if _outcome_fetcher is None:
        _outcome_fetcher = OutcomeFetcher()
    return _outcome_fetcher
