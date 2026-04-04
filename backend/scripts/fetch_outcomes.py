"""
Fetch actual match outcomes from ESPN and update prediction records.

Reads pending predictions from backend/data/predictions/, fetches
completed match scores from ESPN's scoreboard API, and writes
outcome data (actual_winner, actual goals, accuracy flags) back.

This is the Python equivalent of the Next.js fetch-outcomes API route,
designed to run in GitHub Actions without a running server.

Usage:
    python -m backend.scripts.fetch_outcomes
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List

import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data" / "predictions"

LEAGUE_TO_ESPN: Dict[str, str] = {
    "Premier League": "eng.1",
    "La Liga": "esp.1",
    "Bundesliga": "ger.1",
    "Serie A": "ita.1",
    "Ligue 1": "fra.1",
    "MLS": "usa.1",
    "Champions League": "uefa.champions",
    "Europa League": "uefa.europa",
    "Conference League": "uefa.europa.conf",
    "Eredivisie": "ned.1",
    "Primeira Liga": "por.1",
    "FIFA World Cup": "fifa.world",
}


def fetch_outcomes() -> int:
    """Fetch outcomes for all pending predictions. Returns count of updated predictions."""
    if not DATA_DIR.exists():
        logger.warning(f"Data directory not found: {DATA_DIR}")
        return 0

    files = sorted(DATA_DIR.glob("predictions_*.json"))
    total_updated = 0

    for file_path in files:
        try:
            with open(file_path) as f:
                file_data = json.load(f)
        except Exception:
            continue

        predictions: List[dict] = file_data.get("predictions", [])
        pending = [p for p in predictions if p.get("actual_winner") is None]
        if not pending:
            continue

        # Group pending by league
        by_league: Dict[str, List[dict]] = {}
        for p in pending:
            league = p["league"]
            if league not in by_league:
                by_league[league] = []
            by_league[league].append(p)

        file_modified = False

        for league, preds in by_league.items():
            espn_id = LEAGUE_TO_ESPN.get(league)
            if not espn_id:
                logger.warning(f"No ESPN mapping for league: {league}")
                continue

            # Get date range for this batch
            dates = sorted(p["match_date"] for p in preds)
            start_date = dates[0].replace("-", "")
            end_date = dates[-1].replace("-", "")

            url = (
                f"https://site.api.espn.com/apis/site/v2/sports/soccer/"
                f"{espn_id}/scoreboard?dates={start_date}-{end_date}&limit=100"
            )

            try:
                resp = httpx.get(url, timeout=15.0)
                if resp.status_code != 200:
                    logger.warning(f"ESPN returned {resp.status_code} for {league}")
                    continue
                data = resp.json()
            except Exception as e:
                logger.error(f"ESPN fetch error for {league}: {e}")
                continue

            for event in data.get("events", []):
                status = event.get("status", {}).get("type", {}).get("name", "")
                if "STATUS_FULL_TIME" not in status and "STATUS_FINAL" not in status:
                    continue

                match_id = event.get("id", "")
                comps = (event.get("competitions") or [{}])[0]
                competitors = comps.get("competitors", [])

                home_comp = next((c for c in competitors if c.get("homeAway") == "home"), None)
                away_comp = next((c for c in competitors if c.get("homeAway") == "away"), None)
                if not home_comp or not away_comp:
                    continue

                home_goals = int(home_comp.get("score", "0"))
                away_goals = int(away_comp.get("score", "0"))
                actual_winner = (
                    "home" if home_goals > away_goals
                    else "away" if home_goals < away_goals
                    else "draw"
                )

                home_name = home_comp.get("team", {}).get("displayName", "")
                home_short = home_comp.get("team", {}).get("shortDisplayName", "")

                # Match by match_id or fuzzy team name
                pred = None
                for p in preds:
                    if p.get("actual_winner") is not None:
                        continue
                    if p["match_id"] == match_id:
                        pred = p
                        break
                    # Fuzzy: check if last word of predicted home team appears in ESPN name or vice versa
                    p_home_last = p["home_team"].split()[-1] if p["home_team"] else ""
                    if (
                        p_home_last
                        and (p_home_last in home_name or p_home_last in home_short
                             or home_short in p["home_team"])
                    ):
                        pred = p
                        break

                if pred and pred.get("actual_winner") is None:
                    pred["actual_home_goals"] = home_goals
                    pred["actual_away_goals"] = away_goals
                    pred["actual_winner"] = actual_winner

                    predicted_winner = pred.get("predicted_winner")
                    if predicted_winner not in {"home", "away", "draw"}:
                        # Backfill very old records if predicted_winner is missing.
                        hw = float(pred.get("predicted_home_win") or 0.0)
                        dr = float(pred.get("predicted_draw") or 0.0)
                        aw = float(pred.get("predicted_away_win") or 0.0)
                        if hw >= dr and hw >= aw:
                            predicted_winner = "home"
                        elif aw >= dr and aw >= hw:
                            predicted_winner = "away"
                        else:
                            predicted_winner = "draw"
                        pred["predicted_winner"] = predicted_winner

                    pred["winner_correct"] = predicted_winner == actual_winner
                    pred["scoreline_correct"] = (
                        pred["predicted_scoreline"] == f"{home_goals}-{away_goals}"
                    )
                    predicted_total = pred["predicted_home_goals"] + pred["predicted_away_goals"]
                    pred["goals_diff"] = round(abs((home_goals + away_goals) - predicted_total))
                    pred["outcome_timestamp"] = datetime.now().isoformat()
                    total_updated += 1
                    file_modified = True

        if file_modified:
            file_data["predictions"] = predictions
            with open(file_path, "w") as f:
                json.dump(file_data, f, indent=2)
            logger.info(f"Updated {file_path.name}")

    return total_updated


def main():
    logger.info("=" * 60)
    logger.info("FETCHING MATCH OUTCOMES FROM ESPN")
    logger.info("=" * 60)

    updated = fetch_outcomes()

    logger.info(f"\n{'=' * 60}")
    logger.info("OUTCOME FETCH COMPLETE")
    logger.info(f"  Updated predictions: {updated}")
    logger.info(f"{'=' * 60}")


if __name__ == "__main__":
    main()
