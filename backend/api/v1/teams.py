"""
Team-related API endpoints.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

from backend.services.fotmob import get_fotmob_client
from backend.services.ratings import get_elo_system
from backend.services.espn.client import ESPN_LEAGUE_IDS, get_espn_client
from backend.services.data.injury_tracker import get_injury_tracker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/teams", tags=["teams"])

# Simple in-process cache for team overview payloads.
_OVERVIEW_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_OVERVIEW_TTL = 300  # 5 minutes

# Display names for the leagues we know about.
_LEAGUE_DISPLAY_NAMES: Dict[str, str] = {
    "premier_league": "Premier League",
    "la_liga": "La Liga",
    "bundesliga": "Bundesliga",
    "serie_a": "Serie A",
    "ligue_1": "Ligue 1",
    "eredivisie": "Eredivisie",
    "primeira_liga": "Primeira Liga",
    "mls": "MLS",
    "champions_league": "UEFA Champions League",
    "europa_league": "UEFA Europa League",
    "conference_league": "UEFA Conference League",
    "world_cup": "FIFA World Cup",
    "euro": "UEFA European Championship",
    "copa_america": "Copa America",
}


@router.get("/search")
async def search_teams(q: str = Query(..., min_length=2)):
    """Search for teams by name."""
    client = get_fotmob_client()
    results = await client.search_team(q)
    
    if results is None:
        results = []
    
    return {
        "query": q,
        "results": results,
        "count": len(results)
    }


# ==================== PLAYERS ====================
# Declared before the /{team_id}/* routes so the literal "players" segment
# can never be captured as a team id.

_GENDER_DEFAULT_SLUGS = {"M": "eng.1", "F": "eng.w.1"}


def _player_slug(gender: Optional[str]) -> str:
    return _GENDER_DEFAULT_SLUGS.get((gender or "M").upper(), "eng.1")


def _extract_ref_id(ref: Any) -> Optional[int]:
    """Pull the trailing numeric id out of an ESPN `$ref` URL."""
    if isinstance(ref, dict):
        ref = ref.get("$ref")
    if not isinstance(ref, str):
        return None
    tail = ref.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
    return int(tail) if tail.isdigit() else None


def _stat_value(names: List[str], stats: List[Any], name: str) -> Optional[int]:
    """Look up one stat by name from ESPN's parallel names/stats arrays."""
    try:
        raw = stats[names.index(name)]
    except (ValueError, IndexError):
        return None
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return None


@router.get("/players/{player_id}")
async def get_player_profile(
    player_id: int,
    gender: Optional[str] = Query(default=None),
    league: Optional[str] = Query(default=None),
):
    """Player profile normalized to the frontend `PlayerProfile` shape.

    Backed by ESPN's core athlete API. Every field except id/name is
    optional — absent provider data stays absent (no placeholders).
    """
    espn = get_espn_client()
    slug = ESPN_LEAGUE_IDS.get(league or "", None) or _player_slug(gender)
    athlete = await espn.get_athlete(str(player_id), league_slug=slug)
    if not athlete or not (athlete.get("displayName") or athlete.get("fullName")):
        raise HTTPException(status_code=404, detail=f"Player {player_id} not found")

    position = athlete.get("position") or {}
    headshot = athlete.get("headshot") or {}
    profile: Dict[str, Any] = {
        "id": player_id,
        "name": athlete.get("displayName") or athlete.get("fullName"),
    }
    if isinstance(position, dict) and (position.get("displayName") or position.get("name")):
        profile["position"] = position.get("displayName") or position.get("name")
    if athlete.get("jersey") and str(athlete["jersey"]).isdigit():
        profile["shirtNumber"] = int(athlete["jersey"])
    if athlete.get("citizenship"):
        profile["nationality"] = athlete["citizenship"]
    if isinstance(athlete.get("age"), int):
        profile["age"] = athlete["age"]
    if isinstance(athlete.get("height"), (int, float)) and athlete["height"]:
        profile["height"] = round(athlete["height"] * 2.54)  # ESPN sends inches
    if isinstance(headshot, dict) and headshot.get("href"):
        profile["imageUrl"] = headshot["href"]

    team_id = _extract_ref_id(athlete.get("defaultTeam") or athlete.get("team"))
    if team_id is not None:
        profile["teamId"] = team_id
        team = await espn.resolve_ref(
            f"https://sports.core.api.espn.com/v2/sports/soccer/teams/{team_id}",
            cache_key=f"espn_team_ref_{team_id}",
        )
        if team:
            if team.get("displayName"):
                profile["teamName"] = team["displayName"]
            if team.get("color"):
                profile["teamColor"] = f"#{team['color']}"

    return profile


@router.get("/players/{player_id}/stats")
async def get_player_stats(
    player_id: int,
    gender: Optional[str] = Query(default=None),
    league: Optional[str] = Query(default=None),
):
    """Season stats + recent match log, normalized to `PlayerStats`.

    ESPN's overview payload carries starts/goals/assists/shots/cards per
    competition split plus a per-event game log. It has no minutes, xG,
    xA, or ratings — those fields are deliberately omitted rather than
    fabricated.
    """
    espn = get_espn_client()
    slug = ESPN_LEAGUE_IDS.get(league or "", None) or _player_slug(gender)
    overview = await espn.get_athlete_overview(str(player_id), league_slug=slug)
    if overview is None:
        raise HTTPException(status_code=404, detail=f"Player {player_id} not found")

    result: Dict[str, Any] = {"player_id": player_id, "season": ""}

    # --- Season splits: pick the primary competition (most starts). ---
    statistics = overview.get("statistics") or {}
    names = statistics.get("names") or []
    splits = statistics.get("splits") or []
    primary = None
    primary_starts = -1
    for split in splits:
        starts = _stat_value(names, split.get("stats") or [], "starts") or 0
        if starts > primary_starts:
            primary, primary_starts = split, starts
    if primary is not None:
        stats_row = primary.get("stats") or []
        result["season"] = primary.get("displayName") or ""
        result["competition"] = primary.get("displayName") or ""
        for out_key, espn_name in (
            ("starts", "starts"),
            ("goals", "totalGoals"),
            ("assists", "goalAssists"),
            ("shots", "totalShots"),
            ("shotsOnTarget", "shotsOnTarget"),
            ("yellowCards", "yellowCards"),
            ("redCards", "redCards"),
        ):
            value = _stat_value(names, stats_row, espn_name)
            if value is not None:
                result[out_key] = value

    # --- Recent match log: join gameLog.events with its per-event stats. ---
    game_log = overview.get("gameLog") or {}
    events = game_log.get("events") or {}
    per_event_stats: Dict[str, Dict[str, Optional[int]]] = {}
    for block in game_log.get("statistics") or []:
        block_names = block.get("names") or []
        for entry in block.get("events") or []:
            event_id = str(entry.get("eventId") or "")
            stats_row = entry.get("stats") or []
            if event_id:
                per_event_stats[event_id] = {
                    "goals": _stat_value(block_names, stats_row, "totalGoals"),
                    "assists": _stat_value(block_names, stats_row, "goalAssists"),
                }

    matches: List[Dict[str, Any]] = []
    if isinstance(events, dict):
        for event_id, event in events.items():
            if not isinstance(event, dict) or not event.get("gameDate"):
                continue
            opponent = event.get("opponent") or {}
            entry: Dict[str, Any] = {
                "id": str(event_id),
                "date": event.get("gameDate"),
                "opponent": {
                    "id": opponent.get("id"),
                    "name": opponent.get("displayName") or opponent.get("abbreviation") or "",
                },
                "score": event.get("score"),
                "result": event.get("gameResult"),
                "isHome": event.get("atVs") == "vs",
            }
            joined = per_event_stats.get(str(event_id))
            if joined:
                if joined.get("goals") is not None:
                    entry["goals"] = joined["goals"]
                if joined.get("assists") is not None:
                    entry["assists"] = joined["assists"]
            matches.append(entry)
    matches.sort(key=lambda m: m["date"], reverse=True)
    result["matches"] = matches[:10]

    return result


async def _resolve_team_via_standings(
    team_id: str,
    league_key: Optional[str],
) -> Optional[Tuple[str, Dict[str, Any]]]:
    """Locate a team by walking ESPN standings caches.

    Returns (league_key, standing_row) on success, or None if the team isn't
    present in any cached/known league.
    """
    espn = get_espn_client()
    league_keys = [league_key] if league_key else list(ESPN_LEAGUE_IDS.keys())
    for lk in league_keys:
        if lk not in ESPN_LEAGUE_IDS:
            continue
        try:
            standings = await espn.get_standings(lk)
        except Exception as e:
            logger.debug(f"standings fetch failed for {lk}: {e}")
            continue
        if not standings:
            continue
        for row in standings:
            if str(row.get("team_id")) == str(team_id):
                return lk, row
    return None


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


async def _fetch_team_meta(league_key: str, team_id: str) -> Dict[str, Any]:
    espn = get_espn_client()
    try:
        data = await espn.get_team(league_key, team_id)
    except Exception as e:
        logger.debug(f"ESPN team fetch failed {league_key}/{team_id}: {e}")
        return {}
    if not data:
        return {}
    # ESPN response: {"team": {...}}
    return data.get("team") or {}


async def _fetch_team_roster(league_key: str, team_id: str) -> List[Dict[str, Any]]:
    """Pull the ESPN team roster via the shared HTTP layer.

    Endpoint shape: /{leagueKey}/teams/{teamId}/roster
    Returns a normalized list. Empty on any failure/missing data.
    """
    espn_league_id = ESPN_LEAGUE_IDS.get(league_key)
    if not espn_league_id:
        return []
    espn = get_espn_client()
    endpoint = f"{espn_league_id}/teams/{team_id}/roster"
    cache_key = f"espn_team_roster_{team_id}"
    try:
        data = await espn._request(endpoint, cache_key=cache_key)  # noqa: SLF001
    except Exception as e:
        logger.debug(f"ESPN roster fetch failed {league_key}/{team_id}: {e}")
        return []
    if not data:
        return []

    squad: List[Dict[str, Any]] = []
    athletes = data.get("athletes") or []
    # ESPN nests athletes either as a flat list of players or as groups
    # keyed by position. Handle both.
    if athletes and isinstance(athletes[0], dict) and "items" in athletes[0]:
        for group in athletes:
            for player in group.get("items", []) or []:
                squad.append(_transform_roster_player(player))
    else:
        for player in athletes:
            if isinstance(player, dict):
                squad.append(_transform_roster_player(player))
    return [p for p in squad if p.get("name")]


def _transform_roster_player(player: Dict[str, Any]) -> Dict[str, Any]:
    position = player.get("position") or {}
    citizenship = (
        player.get("citizenship")
        or (player.get("birthPlace") or {}).get("country")
        or ""
    )
    return {
        "player_id": str(player.get("id") or ""),
        "name": player.get("displayName") or player.get("fullName") or "",
        "position": (position.get("abbreviation") or position.get("name") or "") if isinstance(position, dict) else "",
        "number": _safe_int(player.get("jersey")) or None,
        "nationality": citizenship,
    }


def _transform_event_to_match(event: Dict[str, Any], team_id: str) -> Dict[str, Any]:
    competitions = event.get("competitions") or [{}]
    comp = competitions[0] if competitions else {}
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), {})
    self_side = home if str((home.get("team") or {}).get("id")) == str(team_id) else away
    opp_side = away if self_side is home else home

    status = (event.get("status") or {}).get("type") or {}
    return {
        "match_id": str(event.get("id") or ""),
        "kickoff": event.get("date"),
        "venue": (comp.get("venue") or {}).get("fullName"),
        "is_home": self_side is home,
        "opponent": {
            "id": str((opp_side.get("team") or {}).get("id") or ""),
            "name": (opp_side.get("team") or {}).get("displayName") or "",
        },
        "self_score": _safe_int(self_side.get("score")) if self_side.get("score") is not None else None,
        "opponent_score": _safe_int(opp_side.get("score")) if opp_side.get("score") is not None else None,
        "status": status.get("state") or "pre",
        "status_detail": status.get("detail"),
        "completed": bool(status.get("completed")),
    }


def _build_form_string(recent: List[Dict[str, Any]]) -> str:
    """Build a W/D/L form string from the most-recent completed matches first."""
    form = []
    for m in recent:
        if not m.get("completed"):
            continue
        sf = m.get("self_score")
        so = m.get("opponent_score")
        if sf is None or so is None:
            continue
        if sf > so:
            form.append("W")
        elif sf < so:
            form.append("L")
        else:
            form.append("D")
        if len(form) >= 5:
            break
    return "".join(form)


@router.get("/{team_id}/overview")
async def get_team_overview(
    team_id: str,
    league: Optional[str] = Query(default=None),
):
    """Aggregate team detail payload used by the team detail page.

    Powered by ESPN (standings, schedule, roster, team meta) plus the
    in-repo InjuryTracker. Falls back gracefully whenever an upstream
    section is missing.
    """
    cache_key = f"{team_id}|{league or '*'}"
    cached = _OVERVIEW_CACHE.get(cache_key)
    if cached and (time.time() - cached[0]) < _OVERVIEW_TTL:
        return cached[1]

    # 1. Resolve the league + standing row.
    resolved = await _resolve_team_via_standings(team_id, league)
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail=f"Team {team_id} not found in any cached league",
        )
    league_key, standing_row = resolved

    espn = get_espn_client()

    # 2. Fetch team meta + schedule in parallel.
    meta_task = asyncio.create_task(_fetch_team_meta(league_key, team_id))
    schedule_task = asyncio.create_task(espn.get_team_schedule(league_key, team_id))
    roster_task = asyncio.create_task(_fetch_team_roster(league_key, team_id))
    meta_raw, schedule_events, squad = await asyncio.gather(
        meta_task, schedule_task, roster_task, return_exceptions=False
    )

    # 3. Injuries - hard 5s budget; empty on timeout / failure.
    injuries: List[Dict[str, Any]] = []
    try:
        tracker = get_injury_tracker()
        injuries = await asyncio.wait_for(
            tracker.fetch_team_injuries(str(team_id), league_key=league_key),
            timeout=5.0,
        )
    except asyncio.TimeoutError:
        logger.info(f"Injury fetch timeout for team {team_id}")
        injuries = []
    except Exception as e:
        logger.debug(f"Injury fetch failed for team {team_id}: {e}")
        injuries = []

    # 4. Split schedule into past / upcoming.
    schedule_events = schedule_events or []
    completed_matches: List[Dict[str, Any]] = []
    upcoming_matches: List[Dict[str, Any]] = []
    for event in schedule_events:
        transformed = _transform_event_to_match(event, team_id)
        if transformed.get("completed"):
            completed_matches.append(transformed)
        else:
            upcoming_matches.append(transformed)

    # Most recent first; nearest fixture first.
    completed_matches.sort(key=lambda m: m.get("kickoff") or "", reverse=True)
    upcoming_matches.sort(key=lambda m: m.get("kickoff") or "")

    recent_results = completed_matches[:5]
    upcoming_fixtures = upcoming_matches[:5]
    next_fixture = upcoming_fixtures[0] if upcoming_fixtures else None

    # 5. Build form string from recent completed matches.
    form_string = _build_form_string(recent_results)

    # 6. Stats computed from standings (no extra calls).
    played = _safe_int(standing_row.get("played"))
    gf = _safe_int(standing_row.get("goals_for"))
    ga = _safe_int(standing_row.get("goals_against"))
    stats = {
        "goals_per_match": round(gf / played, 2) if played else 0.0,
        "conceded_per_match": round(ga / played, 2) if played else 0.0,
        "clean_sheets": None,  # not directly available in ESPN standings
        "possession_avg": None,
    }

    # 7. Team identity.
    team_block = {
        "id": str(team_id),
        "name": meta_raw.get("displayName") or standing_row.get("team_name") or "",
        "abbreviation": meta_raw.get("abbreviation") or standing_row.get("team_short_name") or "",
        "logo": (meta_raw.get("logos") or [{}])[0].get("href") if meta_raw.get("logos") else standing_row.get("logo"),
        "venue": (meta_raw.get("venue") or {}).get("fullName"),
        "founded": None,  # ESPN site API does not expose this consistently
    }

    league_block = {
        "id": league_key,
        "name": _LEAGUE_DISPLAY_NAMES.get(league_key, league_key.replace("_", " ").title()),
        "season": _current_season_string(),
    }

    standing_block = {
        "position": _safe_int(standing_row.get("position")),
        "played": played,
        "won": _safe_int(standing_row.get("won")),
        "drawn": _safe_int(standing_row.get("drawn")),
        "lost": _safe_int(standing_row.get("lost")),
        "gf": gf,
        "ga": ga,
        "points": _safe_int(standing_row.get("points")),
        "form_string": form_string,
    }

    payload = {
        "team": team_block,
        "league": league_block,
        "standing": standing_block,
        "next_fixture": next_fixture,
        "recent_results": recent_results,
        "upcoming_fixtures": upcoming_fixtures,
        "squad": squad or [],
        "stats": stats,
        "injuries": injuries or [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    _OVERVIEW_CACHE[cache_key] = (time.time(), payload)
    return payload


def _current_season_string() -> str:
    """Return e.g. '2025-2026' for European-style seasons starting in Aug."""
    now = datetime.now(timezone.utc)
    if now.month >= 7:
        return f"{now.year}-{now.year + 1}"
    return f"{now.year - 1}-{now.year}"


@router.get("/{team_id}")
async def get_team(team_id: int):
    """Get team information."""
    client = get_fotmob_client()
    data = await client.get_team(team_id)

    if not data:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found")

    return data


@router.get("/{team_id}/fixtures")
async def get_team_fixtures(team_id: int):
    """Get team's fixtures (past and upcoming)."""
    client = get_fotmob_client()
    fixtures = await client.get_team_fixtures(team_id)
    
    if fixtures is None:
        raise HTTPException(status_code=404, detail=f"Fixtures not found for team {team_id}")
    
    return {
        "team_id": team_id,
        "fixtures": fixtures,
        "count": len(fixtures)
    }


@router.get("/{team_id}/squad")
async def get_team_squad(team_id: int):
    """Get team's current squad."""
    client = get_fotmob_client()
    squad = await client.get_team_squad(team_id)
    
    if squad is None:
        raise HTTPException(status_code=404, detail=f"Squad not found for team {team_id}")
    
    return {
        "team_id": team_id,
        "squad": squad
    }


@router.get("/{team_id}/form")
async def get_team_form(
    team_id: int,
    matches: int = Query(default=5, ge=1, le=10)
):
    """Get team's recent form (W/D/L)."""
    client = get_fotmob_client()
    form = await client.get_team_form(team_id, matches)
    
    # Calculate form points
    points = sum(3 if r == 'W' else (1 if r == 'D' else 0) for r in form)
    
    return {
        "team_id": team_id,
        "form": form,
        "matches": len(form),
        "points": points,
        "max_points": len(form) * 3,
        "form_string": "".join(form)
    }


@router.get("/{team_id}/injuries")
async def get_team_injuries(team_id: int):
    """Get team's current injuries and suspensions."""
    client = get_fotmob_client()
    injuries = await client.get_team_injuries(team_id)
    
    if injuries is None:
        injuries = []
    
    return {
        "team_id": team_id,
        "injuries": injuries,
        "count": len(injuries)
    }


@router.get("/ratings/rankings")
async def get_team_rankings(top: int = Query(default=50, ge=1, le=200)):
    """Get team rankings by ELO rating."""
    elo = get_elo_system()
    rankings = elo.get_rankings(top)
    
    return {
        "rankings": rankings,
        "count": len(rankings)
    }


@router.get("/ratings/{team_name}")
async def get_team_rating(team_name: str):
    """Get a team's ELO rating."""
    elo = get_elo_system()
    rating_data = elo.get_rating(team_name)
    
    return {
        "team": team_name,
        **rating_data
    }
