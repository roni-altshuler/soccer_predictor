"""
Predict upcoming matches and store predictions for tracking.

Fetches scheduled matches from ESPN for all leagues, generates
predictions using the per-league Dixon-Coles model, and stores
them as pending predictions (no outcome yet) for the accuracy dashboard.

Usage:
    python -m backend.scripts.predict_upcoming
    python -m backend.scripts.predict_upcoming --days 7
"""

import asyncio
import json
import math
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List
import httpx
import argparse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Same leagues as the seed script
LEAGUES = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
    "usa.1": "MLS",
    "uefa.champions": "Champions League",
    "uefa.europa": "Europa League",
    "ned.1": "Eredivisie",
    "por.1": "Primeira Liga",
}

LEAGUE_DRAW_RATES = {
    "Premier League": 0.23, "La Liga": 0.24, "Bundesliga": 0.22,
    "Serie A": 0.27, "Ligue 1": 0.24, "MLS": 0.22,
    "Champions League": 0.20, "Europa League": 0.22,
    "Eredivisie": 0.21, "Primeira Liga": 0.25,
}

LEAGUE_AVG_GOALS = {
    "Premier League": 1.42, "La Liga": 1.30, "Bundesliga": 1.55,
    "Serie A": 1.32, "Ligue 1": 1.30, "MLS": 1.45,
    "Champions League": 1.50, "Europa League": 1.42,
    "Eredivisie": 1.45, "Primeira Liga": 1.28,
}

DATA_DIR = Path(__file__).parent.parent / "data" / "predictions"
ADJUSTMENTS_FILE = DATA_DIR / "model_adjustments.json"


def load_learned_adjustments() -> Dict:
    """Load parameter adjustments from train_feedback.py output."""
    if not ADJUSTMENTS_FILE.exists():
        return {}
    try:
        with open(ADJUSTMENTS_FILE) as f:
            data = json.load(f)
        suggestions = data.get("suggested_params", {})
        applied = {}
        for league, s in suggestions.items():
            if s.get("changed"):
                applied[league] = s["suggested"]
        if applied:
            logger.info(f"Loaded learned adjustments for {len(applied)} leagues")
        return applied
    except Exception:
        return {}


class EloPredictor:
    """ELO system initialized from historical seed data, with learned adjustments."""

    DEFAULT = 1500.0
    HOME_ADV = 65.0
    K = 32.0

    def __init__(self):
        self.ratings: Dict[str, float] = {}
        self.learned = load_learned_adjustments()
        self._load_ratings_from_seed()

    def _load_ratings_from_seed(self):
        """Build ELO ratings from existing seeded predictions."""
        if not DATA_DIR.exists():
            logger.warning("No seed data found — using default ELO ratings")
            return

        all_matches = []
        for f in sorted(DATA_DIR.glob("predictions_*.json")):
            try:
                with open(f) as fh:
                    data = json.load(fh)
                for p in data.get("predictions", []):
                    if p.get("actual_winner") is not None:
                        all_matches.append(p)
            except Exception:
                continue

        all_matches.sort(key=lambda m: m.get("match_date", ""))

        for m in all_matches:
            home = m["home_team"]
            away = m["away_team"]
            h_elo = self.get(home)
            a_elo = self.get(away)
            h_exp = 1.0 / (1.0 + math.pow(10, -(h_elo + self.HOME_ADV - a_elo) / 400))

            actual = m.get("actual_winner", "draw")
            if actual == "home":
                h_act, a_act = 1.0, 0.0
            elif actual == "away":
                h_act, a_act = 0.0, 1.0
            else:
                h_act, a_act = 0.5, 0.5

            hg = m.get("actual_home_goals", 0) or 0
            ag = m.get("actual_away_goals", 0) or 0
            gd = abs(hg - ag)
            mult = 1.0 if gd <= 1 else 1.5 if gd == 2 else 1.75 + (gd - 3) * 0.125

            k = self.K * mult
            self.ratings[home] = h_elo + k * (h_act - h_exp)
            self.ratings[away] = a_elo + k * ((1.0 - h_act) - (1.0 - h_exp))

        logger.info(f"Loaded ELO ratings for {len(self.ratings)} teams from {len(all_matches)} matches")

    def get(self, team: str) -> float:
        return self.ratings.get(team, self.DEFAULT)

    def predict(self, home: str, away: str, league: str) -> Dict[str, float]:
        h_elo = self.get(home) + self.HOME_ADV
        a_elo = self.get(away)
        diff = h_elo - a_elo

        # Use learned draw rate if available, else base
        learned = self.learned.get(league, {})
        base_draw_rate = learned.get("draw_rate", LEAGUE_DRAW_RATES.get(league, 0.24))
        elo_closeness = math.exp(-(diff ** 2) / (2 * 250 ** 2))
        draw = base_draw_rate * (0.6 + 0.8 * elo_closeness)
        draw = max(0.08, min(0.38, draw))

        win_pool = 1.0 - draw
        home_win_raw = 1.0 / (1.0 + math.pow(10, -diff / 400))
        hw = win_pool * home_win_raw
        aw = win_pool * (1.0 - home_win_raw)

        total = hw + draw + aw
        return {
            "home_win": round(hw / total, 4),
            "draw": round(draw / total, 4),
            "away_win": round(aw / total, 4),
        }

    def predict_goals(self, home: str, away: str, league: str):
        h_elo = self.get(home)
        a_elo = self.get(away)
        # Use learned avg_goals if available
        learned = self.learned.get(league, {})
        avg_goals = learned.get("avg_goals", LEAGUE_AVG_GOALS.get(league, 1.35))

        h_attack = max(0.5, 1.0 + (h_elo - 1500) / 600)
        a_attack = max(0.5, 1.0 + (a_elo - 1500) / 600)
        h_def_weakness = max(0.4, 1.0 - (h_elo - 1500) / 900)
        a_def_weakness = max(0.4, 1.0 - (a_elo - 1500) / 900)

        home_xg = h_attack * a_def_weakness * avg_goals + 0.25
        away_xg = a_attack * h_def_weakness * avg_goals

        return max(0.3, min(4.5, home_xg)), max(0.3, min(4.0, away_xg))


def poisson_scoreline(home_xg: float, away_xg: float) -> str:
    """Most likely scoreline via Dixon-Coles corrected Poisson."""
    rho = -0.13
    best_score, best_prob = "1-1", 0.0

    for h in range(6):
        for a in range(6):
            p_h = (home_xg ** h) * math.exp(-home_xg) / math.factorial(h)
            p_a = (away_xg ** a) * math.exp(-away_xg) / math.factorial(a)
            base = p_h * p_a

            if h == 0 and a == 0:
                tau = 1.0 - home_xg * away_xg * rho
            elif h == 0 and a == 1:
                tau = 1.0 + home_xg * rho
            elif h == 1 and a == 0:
                tau = 1.0 + away_xg * rho
            elif h == 1 and a == 1:
                tau = 1.0 - rho
            else:
                tau = 1.0

            prob = base * max(0, tau)
            if prob > best_prob:
                best_prob = prob
                best_score = f"{h}-{a}"

    return best_score


async def fetch_upcoming_matches(
    client: httpx.AsyncClient, espn_id: str, days_ahead: int = 14
) -> List[dict]:
    """Fetch scheduled/upcoming matches from ESPN."""
    matches = []
    today = datetime.now()
    fmt = lambda d: f"{d.year}{d.month:02d}{d.day:02d}"

    # Fetch from today to N days ahead
    start = today
    end = today + timedelta(days=days_ahead)
    date_range = f"{fmt(start)}-{fmt(end)}"

    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/{espn_id}/scoreboard?dates={date_range}&limit=100"
    try:
        resp = await client.get(url, timeout=15)
        if resp.status_code != 200:
            return []
        data = resp.json()

        for event in data.get("events", []):
            comp = event.get("competitions", [{}])[0]
            status = comp.get("status", {}).get("type", {}).get("name", "")

            # Only scheduled/pre-match — not finished, not in progress
            if "FINAL" in status or "FULL_TIME" in status or "IN_PROGRESS" in status:
                continue

            home_c = next(
                (c for c in comp.get("competitors", []) if c.get("homeAway") == "home"), None
            )
            away_c = next(
                (c for c in comp.get("competitors", []) if c.get("homeAway") == "away"), None
            )
            if not home_c or not away_c:
                continue

            venue = comp.get("venue", {})
            matches.append({
                "id": str(event.get("id", "")),
                "date": event.get("date", ""),
                "home_team": home_c.get("team", {}).get("displayName", "Unknown"),
                "away_team": away_c.get("team", {}).get("displayName", "Unknown"),
                "venue": venue.get("fullName", ""),
                "city": venue.get("address", {}).get("city", ""),
            })
    except Exception as e:
        logger.error(f"Error fetching upcoming {espn_id}: {e}")

    return matches


async def predict_upcoming(days_ahead: int = 14):
    """Main routine: fetch upcoming matches and generate predictions."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    elo = EloPredictor()

    # Load existing predictions to avoid duplicates
    existing_ids = set()
    for f in DATA_DIR.glob("predictions_*.json"):
        try:
            with open(f) as fh:
                data = json.load(fh)
            for p in data.get("predictions", []):
                existing_ids.add(p["match_id"])
        except Exception:
            continue

    all_upcoming: List[dict] = []
    async with httpx.AsyncClient() as client:
        for espn_id, league_name in LEAGUES.items():
            logger.info(f"Fetching upcoming {league_name} ({espn_id})...")
            matches = await fetch_upcoming_matches(client, espn_id, days_ahead)
            for m in matches:
                m["league"] = league_name
            # Filter out already predicted matches
            new_matches = [m for m in matches if m["id"] not in existing_ids]
            all_upcoming.extend(new_matches)
            logger.info(f"  Found {len(matches)} upcoming, {len(new_matches)} new")

    if not all_upcoming:
        logger.info("No new upcoming matches to predict.")
        return

    all_upcoming.sort(key=lambda m: m["date"])
    logger.info(f"Total new upcoming matches to predict: {len(all_upcoming)}")

    # Generate predictions
    predictions_by_month: Dict[str, list] = {}

    for m in all_upcoming:
        match_date_str = m["date"][:10]
        month_key = match_date_str[:7]
        league = m["league"]

        probs = elo.predict(m["home_team"], m["away_team"], league)
        pred_home_xg, pred_away_xg = elo.predict_goals(m["home_team"], m["away_team"], league)
        pred_scoreline = poisson_scoreline(pred_home_xg, pred_away_xg)

        if probs["home_win"] > probs["draw"] and probs["home_win"] > probs["away_win"]:
            pred_winner = "home"
        elif probs["away_win"] > probs["home_win"] and probs["away_win"] > probs["draw"]:
            pred_winner = "away"
        else:
            pred_winner = "draw"

        record = {
            "match_id": m["id"],
            "home_team": m["home_team"],
            "away_team": m["away_team"],
            "league": league,
            "match_date": match_date_str,
            "predicted_home_win": probs["home_win"],
            "predicted_draw": probs["draw"],
            "predicted_away_win": probs["away_win"],
            "predicted_home_goals": round(pred_home_xg, 2),
            "predicted_away_goals": round(pred_away_xg, 2),
            "predicted_scoreline": pred_scoreline,
            "predicted_winner": pred_winner,
            "confidence": round(max(probs.values()) * 100, 1),
            "home_elo": round(elo.get(m["home_team"]), 1),
            "away_elo": round(elo.get(m["away_team"]), 1),
            "weather_factor": 1.0,
            "referee_factor": 1.0,
            "venue": m.get("venue", ""),
            # Outcome fields — null until match is played
            "actual_home_goals": None,
            "actual_away_goals": None,
            "actual_winner": None,
            "winner_correct": None,
            "scoreline_correct": None,
            "goals_diff": None,
            "prediction_timestamp": datetime.now().isoformat(),
            "outcome_timestamp": None,
        }

        if month_key not in predictions_by_month:
            predictions_by_month[month_key] = []
        predictions_by_month[month_key].append(record)

    # Merge into existing monthly files (or create new ones)
    new_count = 0
    for month_key, new_preds in predictions_by_month.items():
        file_path = DATA_DIR / f"predictions_{month_key}.json"

        if file_path.exists():
            with open(file_path) as f:
                existing = json.load(f)
            existing_preds = existing.get("predictions", [])
            existing_match_ids = {p["match_id"] for p in existing_preds}
            # Only add truly new predictions
            added = [p for p in new_preds if p["match_id"] not in existing_match_ids]
            existing_preds.extend(added)
            existing["predictions"] = existing_preds
            existing["count"] = len(existing_preds)
            new_count += len(added)
        else:
            existing = {"month": month_key, "count": len(new_preds), "predictions": new_preds}
            new_count += len(new_preds)

        with open(file_path, "w") as f:
            json.dump(existing, f, indent=2)
        logger.info(f"  {file_path.name}: {len(existing['predictions'])} total predictions")

    # Report
    by_league: Dict[str, int] = {}
    for preds in predictions_by_month.values():
        for p in preds:
            by_league[p["league"]] = by_league.get(p["league"], 0) + 1

    logger.info(f"\n{'='*60}")
    logger.info("UPCOMING MATCH PREDICTIONS COMPLETE")
    logger.info(f"  New predictions stored: {new_count}")
    for lg, count in sorted(by_league.items()):
        logger.info(f"    {lg}: {count} matches")
    logger.info(f"  Stored in: {DATA_DIR}")
    logger.info(f"{'='*60}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Predict upcoming matches")
    parser.add_argument("--days", type=int, default=14, help="Days ahead to fetch (default: 14)")
    args = parser.parse_args()
    asyncio.run(predict_upcoming(args.days))
