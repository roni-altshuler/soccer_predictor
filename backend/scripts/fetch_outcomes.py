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
import os
import tempfile
import time
from datetime import datetime, timezone
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
    "UEFA European Championship": "uefa.euro",
    "Copa America": "conmebol.america",
    # Women's universe
    "NWSL": "usa.nwsl",
    "FA Women's Super League": "eng.w.1",
    "UEFA Women's Champions League": "uefa.wchampions",
    "FIFA Women's World Cup": "fifa.wwc",
    "UEFA Women's European Championship": "uefa.weuro",
}


def _prediction_day(value: str) -> str:
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.tzinfo is not None:
        timestamp = timestamp.astimezone(timezone.utc)
    return timestamp.strftime("%Y%m%d")


def _finished_results(client: httpx.Client, league: str, day: str) -> Dict[str, tuple]:
    """Daily queries avoid the rejected range contract and event-count truncation."""
    response = client.get(
        f"https://site.web.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard",
        params={"dates": day, "limit": 200}, timeout=15.0,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict) or not isinstance(data.get("events"), list):
        raise ValueError(f"{league}/{day}: scoreboard must contain an events list")
    results = {}
    for event in data["events"]:
        if not isinstance(event, dict) or not event.get("id") or isinstance(event["id"], bool):
            raise ValueError(f"{league}/{day}: event has no valid id")
        competitions = event.get("competitions")
        if not isinstance(competitions, list) or not competitions or not isinstance(competitions[0], dict):
            raise ValueError(f"{league}/{day}: event has no competition")
        comp = competitions[0]
        status = event.get("status") or comp.get("status")
        if not isinstance(status, dict) or not isinstance(status.get("type"), dict):
            raise ValueError(f"{league}/{day}: event has no status")
        name = status["type"].get("name")
        if not isinstance(name, str) or not name:
            raise ValueError(f"{league}/{day}: event has invalid status")
        if "STATUS_FULL_TIME" not in name and "STATUS_FINAL" not in name:
            continue
        competitors = comp.get("competitors")
        if not isinstance(competitors, list) or any(not isinstance(c, dict) for c in competitors):
            raise ValueError(f"{league}/{day}: finished event has no competitors")
        home = [c for c in competitors if c.get("homeAway") == "home"]
        away = [c for c in competitors if c.get("homeAway") == "away"]
        if len(home) != 1 or len(away) != 1:
            raise ValueError(f"{league}/{day}: finished event must have one home and away side")
        scores = []
        for side in (home[0], away[0]):
            score = side.get("score")
            if isinstance(score, bool) or not isinstance(score, (str, int)) or not str(score).isdigit():
                raise ValueError(f"{league}/{day}: finished event has no valid score")
            scores.append(int(score))
        eid = str(event["id"])
        observed = tuple(scores)
        if eid in results and results[eid] != observed:
            raise ValueError(f"{league}/{day}: conflicting scores for event {eid}")
        results[eid] = observed
    return results


def _settle(pred: dict, home_goals: int, away_goals: int) -> None:
    actual_winner = ("home" if home_goals > away_goals else "away" if home_goals < away_goals else "draw")
    pred["actual_home_goals"] = home_goals
    pred["actual_away_goals"] = away_goals
    pred["actual_winner"] = actual_winner
    predicted_winner = pred.get("predicted_winner")
    if predicted_winner not in {"home", "away", "draw"}:
        hw = float(pred.get("predicted_home_win") or 0.0)
        dr = float(pred.get("predicted_draw") or 0.0)
        aw = float(pred.get("predicted_away_win") or 0.0)
        predicted_winner = "home" if hw >= dr and hw >= aw else "away" if aw >= dr and aw >= hw else "draw"
        pred["predicted_winner"] = predicted_winner
    scoreline = f"{home_goals}-{away_goals}"
    pred["winner_correct"] = predicted_winner == actual_winner
    pred["scoreline_correct"] = pred.get("predicted_scoreline") == scoreline
    top_scorelines = pred.get("top_scorelines")
    if top_scorelines:
        pred["scoreline_in_top5"] = any(s.get("score") == scoreline for s in top_scorelines)
    predicted_total = pred["predicted_home_goals"] + pred["predicted_away_goals"]
    pred["goals_diff"] = round(abs((home_goals + away_goals) - predicted_total))
    pred["outcome_timestamp"] = datetime.now(timezone.utc).isoformat()


def _publish_updates(updates: Dict[Path, dict]) -> None:
    """Stage every file, then replace atomically; restore originals on write errors."""
    staged = {}
    backups = {}
    published = []
    try:
        for path, payload in updates.items():
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as fh:
                backups[path] = Path(fh.name)
                fh.write(path.read_bytes())
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as fh:
                staged[path] = Path(fh.name)
                json.dump(payload, fh, indent=2, allow_nan=False)
                fh.flush()
                os.fsync(fh.fileno())
        for path, temporary in staged.items():
            os.replace(temporary, path)
            published.append(path)
    except Exception:
        for path in reversed(published):
            os.replace(backups[path], path)
        raise
    finally:
        for path in [*staged.values(), *backups.values()]:
            path.unlink(missing_ok=True)


def fetch_outcomes() -> int:
    """Settle exact ESPN event IDs only after every requested daily fetch succeeds."""
    if not DATA_DIR.exists():
        raise FileNotFoundError(f"Prediction data directory not found: {DATA_DIR}")
    files = {}
    pending = []
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    for path in sorted(DATA_DIR.glob("predictions_*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("predictions"), list):
            raise ValueError(f"Invalid prediction file: {path}")
        files[path] = payload
        for pred in payload["predictions"]:
            if not isinstance(pred, dict):
                raise ValueError(f"Invalid prediction record: {path}")
            if pred.get("actual_winner") is not None:
                continue
            day = _prediction_day(pred["match_date"])
            if day > today:
                continue
            league = LEAGUE_TO_ESPN.get(pred["league"])
            if league is None:
                raise ValueError(f"No ESPN mapping for league: {pred['league']}")
            eid = pred.get("match_id")
            if isinstance(eid, bool) or not isinstance(eid, (str, int)) or not str(eid).strip():
                raise ValueError(f"Prediction has no valid event id: {path}")
            pending.append((path, pred, league, day, str(eid)))
    results = {}
    if pending:
        with httpx.Client(timeout=15.0, follow_redirects=True) as client:
            for league, day in sorted({(league, day) for _, _, league, day, _ in pending}):
                results[(league, day)] = _finished_results(client, league, day)
                time.sleep(0.4)
    updates = {}
    total = 0
    for path, pred, league, day, eid in pending:
        observed = results[(league, day)].get(eid)
        if observed is None:
            continue
        _settle(pred, *observed)
        updates[path] = files[path]
        total += 1
    _publish_updates(updates)
    logger.info("Settled %d predictions from %d validated league/date queries", total, len(results))
    return total


def main() -> int:
    try:
        updated = fetch_outcomes()
    except Exception as exc:
        logger.error("Outcome fetch failed; batch not published: %s", exc)
        return 1
    logger.info("Outcome fetch complete: %d updated predictions", updated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
