"""
Live match endpoints: timeline (events) and in-play win-probability.

Both routes are powered by the ESPN summary endpoint via ``ESPNClient``.
``/live-probability`` reuses the pre-match prediction layer (``/api/predict/unified``)
and feeds it into ``compute_live_probability``.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

from backend.services.espn.client import ESPN_LEAGUE_IDS, get_espn_client
from backend.services.prediction.in_play import compute_live_probability

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/match", tags=["match-live"])


# ---------------------------------------------------------------------------
# ESPN helpers
# ---------------------------------------------------------------------------


async def _fetch_espn_summary(
    match_id: str, league: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Fetch the ESPN ``summary`` payload, trying multiple leagues if needed."""
    client = get_espn_client()
    league_keys: List[str]
    if league and league in ESPN_LEAGUE_IDS:
        league_keys = [league] + [k for k in ESPN_LEAGUE_IDS if k != league]
    else:
        league_keys = list(ESPN_LEAGUE_IDS.keys())

    for key in league_keys:
        data = await client.get_match_details(key, match_id)
        if data and data.get("header"):
            return data
    return None


def _competition(summary: Dict[str, Any]) -> Dict[str, Any]:
    return (summary.get("header", {}).get("competitions") or [{}])[0]


def _team_ids(summary: Dict[str, Any]) -> Tuple[str, str, str, str]:
    """Return ``(home_id, away_id, home_name, away_name)``."""
    comp = _competition(summary)
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), {})
    return (
        str(home.get("team", {}).get("id") or ""),
        str(away.get("team", {}).get("id") or ""),
        str(home.get("team", {}).get("displayName") or ""),
        str(away.get("team", {}).get("displayName") or ""),
    )


def _parse_clock(clock: Optional[Dict[str, Any]]) -> int:
    if not clock:
        return 0
    display = str(clock.get("displayValue") or "").strip()
    if display:
        head = display.split("+")[0].split(":")[0]
        try:
            return int(head)
        except ValueError:
            pass
    value = clock.get("value")
    if isinstance(value, (int, float)) and value > 0:
        return int(value // 60)
    return 0


def _infer_event_team(
    raw: Dict[str, Any], home_id: str, away_id: str
) -> Optional[str]:
    candidates = [
        raw.get("team", {}).get("id"),
        raw.get("competitor", {}).get("id") if isinstance(raw.get("competitor"), dict) else None,
        raw.get("competitorId"),
        raw.get("teamId"),
    ]
    for c in candidates:
        if c is None:
            continue
        if str(c) == home_id:
            return "home"
        if str(c) == away_id:
            return "away"
    if raw.get("homeAway") in ("home", "away"):
        return raw["homeAway"]
    return None


def _normalize_event_type(raw_type: str) -> Optional[str]:
    rt = raw_type.lower()
    if "own" in rt and "goal" in rt:
        return "own_goal"
    if "goal" in rt:
        return "goal"
    if "yellow" in rt:
        return "yellow_card"
    if "red" in rt:
        return "red_card"
    if "substitution" in rt or "sub" == rt:
        return "substitution"
    return None


def _build_timeline(summary: Dict[str, Any]) -> List[Dict[str, Any]]:
    home_id, away_id, _, _ = _team_ids(summary)
    events: List[Dict[str, Any]] = []
    seen = set()

    def push(evt: Dict[str, Any]) -> None:
        key = (evt["type"], evt["minute"], evt["team"], (evt.get("player") or "").lower())
        if key in seen:
            return
        seen.add(key)
        events.append(evt)

    # 1) Goals from scoringPlays (richest source)
    for play in summary.get("scoringPlays") or []:
        text = str(play.get("text") or "")
        team = _infer_event_team(play, home_id, away_id)
        if not team:
            continue
        is_own = "own goal" in text.lower()
        player = (
            play.get("scoringPlay", {}).get("scorer", {}).get("athlete", {}).get("displayName")
            if isinstance(play.get("scoringPlay"), dict)
            else None
        ) or play.get("athlete", {}).get("displayName") or "Unknown"
        push(
            {
                "minute": _parse_clock(play.get("clock")),
                "type": "own_goal" if is_own else "goal",
                "team": team,
                "player": player,
                "detail": text,
            }
        )

    # 2) Cards / subs / additional goals from keyEvents
    for evt in summary.get("keyEvents") or []:
        raw_type = str((evt.get("type") or {}).get("type") or (evt.get("type") or {}).get("text") or "")
        etype = _normalize_event_type(raw_type)
        if not etype:
            continue
        team = _infer_event_team(evt, home_id, away_id)
        if not team:
            continue
        text = str(evt.get("text") or "")
        player = (
            evt.get("athlete", {}).get("displayName")
            or (evt.get("participants") or [{}])[0].get("athlete", {}).get("displayName")
            or "Unknown"
        )
        push(
            {
                "minute": _parse_clock(evt.get("clock")),
                "type": etype,
                "team": team,
                "player": player,
                "detail": text,
            }
        )

    events.sort(key=lambda e: e["minute"])
    return events


def _live_state(summary: Dict[str, Any]) -> Dict[str, Any]:
    """Extract current minute, score and red-card counts."""
    comp = _competition(summary)
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), {})
    status = comp.get("status") or {}
    status_type = status.get("type") or {}

    state = status_type.get("state", "pre")
    state_name = status_type.get("name", "")
    minute = _parse_clock(status)
    if state_name == "STATUS_HALFTIME":
        minute = 45
    elif state == "post":
        minute = 90
    elif state == "pre":
        minute = 0

    try:
        home_score = int(home.get("score") or 0)
    except (TypeError, ValueError):
        home_score = 0
    try:
        away_score = int(away.get("score") or 0)
    except (TypeError, ValueError):
        away_score = 0

    timeline = _build_timeline(summary)
    red_home = sum(1 for e in timeline if e["type"] == "red_card" and e["team"] == "home")
    red_away = sum(1 for e in timeline if e["type"] == "red_card" and e["team"] == "away")

    return {
        "minute": minute,
        "home_score": home_score,
        "away_score": away_score,
        "red_home": red_home,
        "red_away": red_away,
        "state": state,
        "state_name": state_name,
        "home_team": home.get("team", {}).get("displayName") or "",
        "away_team": away.get("team", {}).get("displayName") or "",
    }


# ---------------------------------------------------------------------------
# Pre-match probability
# ---------------------------------------------------------------------------


async def _fetch_pre_match_probs(
    home_team: str, away_team: str, league: Optional[str]
) -> Tuple[float, float, float]:
    """Reuse the unified predict layer; fall back to a neutral prior."""
    try:
        from backend.main import PredictionRequest, predict_match as _predict_unified

        prediction = await _predict_unified(
            PredictionRequest(home_team=home_team, away_team=away_team, league=league)
        )
        probs = (prediction or {}).get("probabilities") or {}
        # The unified endpoint returns percentages (0-100).
        h = float(probs.get("home_win", 0)) / 100.0
        d = float(probs.get("draw", 0)) / 100.0
        a = float(probs.get("away_win", 0)) / 100.0
        total = h + d + a
        if total > 0:
            return (h / total, d / total, a / total)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Pre-match probability fetch failed: %s", exc)
    # Neutral home-advantage prior.
    return (0.45, 0.27, 0.28)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/{match_id}/timeline")
async def get_match_timeline(
    match_id: str,
    league: Optional[str] = Query(default=None, description="Internal league key"),
):
    """Return a normalised list of timeline events for a match."""
    summary = await _fetch_espn_summary(match_id, league)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found on ESPN")
    return {"match_id": match_id, "events": _build_timeline(summary)}


@router.get("/{match_id}/live-probability")
async def get_live_probability(
    match_id: str,
    league: Optional[str] = Query(default=None, description="Internal league key"),
):
    """Compute current in-play win probabilities for a live match."""
    summary = await _fetch_espn_summary(match_id, league)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found on ESPN")

    state = _live_state(summary)
    pre_match = await _fetch_pre_match_probs(
        state["home_team"], state["away_team"], league
    )

    current = compute_live_probability(
        pre_match_probs=pre_match,
        minute=state["minute"],
        home_score=state["home_score"],
        away_score=state["away_score"],
        red_cards_home=state["red_home"],
        red_cards_away=state["red_away"],
    )

    return {
        "match_id": match_id,
        "pre_match": {
            "home_win": pre_match[0],
            "draw": pre_match[1],
            "away_win": pre_match[2],
        },
        "current": current,
        "minute": state["minute"],
        "score": [state["home_score"], state["away_score"]],
        "red_cards": [state["red_home"], state["red_away"]],
        "state": state["state_name"] or state["state"],
    }
