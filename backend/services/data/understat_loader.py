"""Understat → warehouse xG enrichment.

Understat (understat.com) has its own well-regarded expected-goals
model trained on a public corpus of shot-level data. They cover the top
5 European leagues (Premier League, La Liga, Bundesliga, Serie A,
Ligue 1) plus the Russian Premier League.

Understat historically embedded match data inside `<script>` tags as
`var datesData = JSON.parse('...')`; sometime in 2026 the league pages
became empty SPA shells and the data moved to a JSON endpoint:

    GET https://understat.com/getLeagueData/{league}/{season}
    → {"teams": ..., "players": ..., "dates": [match, ...]}

Each match in `dates` has the same shape the embedded blob used
(`isResult`, `h.title`, `a.title`, `datetime`, `xG.h`, `xG.a`).

We:
1. Fetch the JSON endpoint (falling back to scraping the legacy HTML
   embed if the endpoint ever disappears again).
2. Walk each match's `h.xG` and `a.xG` numbers.
3. Match against the warehouse and UPDATE `matches.home_xg` / `away_xg`
   where the values are NULL or where Understat is preferred over FBref
   (config flag).

When both FBref and Understat have xG for a match, Understat usually
wins because their model is slightly more shot-quality aware. The
preference is controlled by `prefer_understat=True` (the default).

Like FBref, this loader fails open — Understat changes their HTML
occasionally, and we'd rather train without their xG than crash the
warehouse build.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import httpx

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchEvent, Warehouse

logger = logging.getLogger(__name__)

UNDERSTAT_BASE = "https://understat.com/league"
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "understat"

# Understat URL slug → warehouse competition_id.
UNDERSTAT_LEAGUES: Tuple[Dict, ...] = (
    {"slug": "EPL",         "competition_id": "eng.1"},
    {"slug": "La_liga",     "competition_id": "esp.1"},
    {"slug": "Bundesliga",  "competition_id": "ger.1"},
    {"slug": "Serie_A",     "competition_id": "ita.1"},
    {"slug": "Ligue_1",     "competition_id": "fra.1"},
)


@dataclass
class LoadStats:
    competition_id: str
    season: int
    fetched: int = 0
    matched: int = 0
    enriched: int = 0
    error: Optional[str] = None


def _cache_path(slug: str, season: int) -> Path:
    return CACHE_DIR / f"{slug}_{season}.html"


def _json_cache_path(slug: str, season: int) -> Path:
    return CACHE_DIR / f"{slug}_{season}.json"


def _read_json_cache(slug: str, season: int, max_age_days: int = 30) -> Optional[List[Dict]]:
    p = _json_cache_path(slug, season)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > max_age_days * 86400:
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _write_json_cache(slug: str, season: int, matches: List[Dict]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _json_cache_path(slug, season).write_text(json.dumps(matches))
    except Exception as exc:
        logger.debug("Failed to cache Understat JSON %s: %s", slug, exc)


async def _fetch_league_matches(
    client: httpx.AsyncClient, slug: str, season: int
) -> Tuple[Optional[List[Dict]], Optional[str]]:
    """Fetch the season's match list, JSON endpoint first, HTML fallback.

    Returns (matches, error) — exactly one is non-None (an empty list is
    a valid result for a season with no data).
    """
    cached = _read_json_cache(slug, season)
    if cached is not None:
        return cached, None

    # Primary: the JSON endpoint the SPA itself calls. It 404s without
    # the XHR marker header.
    url = f"https://understat.com/getLeagueData/{slug}/{season}"
    try:
        resp = await client.get(
            url, timeout=30, headers={"X-Requested-With": "XMLHttpRequest"}
        )
        if resp.status_code == 200:
            payload = resp.json()
            matches = payload.get("dates") or payload.get("datesData") or []
            if matches:
                _write_json_cache(slug, season, matches)
                return matches, None
    except Exception as exc:
        logger.debug("Understat JSON endpoint failed for %s/%s: %s", slug, season, exc)

    # Fallback: legacy HTML embed (pre-2026 site layout).
    body = _read_cache(slug, season)
    if body is None:
        try:
            resp = await client.get(f"{UNDERSTAT_BASE}/{slug}/{season}", timeout=30)
        except Exception as exc:
            return None, str(exc)
        if resp.status_code != 200:
            return None, f"http {resp.status_code}"
        body = resp.text
        _write_cache(slug, season, body)
    matches = _extract_matches(body)
    if matches:
        return matches, None
    return None, "no match data in JSON endpoint or HTML embed"


def _read_cache(slug: str, season: int, max_age_days: int = 30) -> Optional[str]:
    p = _cache_path(slug, season)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > max_age_days * 86400:
        return None
    try:
        return p.read_text()
    except Exception:
        return None


def _write_cache(slug: str, season: int, body: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _cache_path(slug, season).write_text(body)
    except Exception as exc:
        logger.debug("Failed to cache Understat %s: %s", slug, exc)


# ---------------------------------------------------------------------------
# Per-match shot data → minute-level goal events
#
# `GET https://understat.com/getMatchData/{id}` (requires the same
# X-Requested-With: XMLHttpRequest marker as getLeagueData) returns
# {"rosters": ..., "shots": {"h": [shot...], "a": [shot...]}, "tmpl": ...}.
# Shot fields verified 2026-07: minute, result ('Goal', 'OwnGoal',
# 'SavedShot', ...), situation ('OpenPlay', 'Penalty', ...), player, h_a.
#
# Attribution quirk (verified against real matches): an 'OwnGoal' shot sits
# in the SHOOTER's array, but the goal is credited to the OPPOSITE side
# (e.g. Ethan Pinnock's OG in shots['h'] for Brentford 2-1 Crystal Palace
# was Palace's goal). We flip the side so goal sums reconcile with scores.
#
# Minute convention: Understat records the floor of elapsed minutes (a shot
# at 86:30 has minute=86 while match reports say 87') — we store minute+1 to
# align with the ESPN/display convention. Understat has no added-time field:
# league play only, so anything past 90 is stoppage and is folded into
# (90, +n). First-half stoppage is genuinely ambiguous in their data (45+2
# looks like 46') and is stored as-is — a documented ±few-minute fuzz around
# halftime for understat-sourced events only.
# ---------------------------------------------------------------------------

UNDERSTAT_MATCH_URL = "https://understat.com/getMatchData/{match_id}"


def _match_shots_cache_path(understat_match_id: str) -> Path:
    return CACHE_DIR / f"match_{understat_match_id}.json"


async def fetch_match_shots(
    client: httpx.AsyncClient, understat_match_id: str
) -> Tuple[Optional[Dict], Optional[str]]:
    """Fetch (and cache forever — finished matches don't change) one match's shots.

    Returns (shots_dict, error); exactly one is non-None. `shots_dict` is the
    {"h": [...], "a": [...]} mapping.
    """
    cache = _match_shots_cache_path(understat_match_id)
    if cache.exists():
        try:
            return json.loads(cache.read_text()), None
        except Exception:
            pass  # fall through to refetch
    url = UNDERSTAT_MATCH_URL.format(match_id=understat_match_id)
    try:
        resp = await client.get(
            url, timeout=30, headers={"X-Requested-With": "XMLHttpRequest"}
        )
    except Exception as exc:
        return None, str(exc)
    if resp.status_code != 200:
        return None, f"http {resp.status_code}"
    try:
        shots = resp.json().get("shots") or {}
    except Exception as exc:
        return None, f"json parse: {exc}"
    if not isinstance(shots, dict):
        return None, "unexpected shots payload"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        cache.write_text(json.dumps(shots))
    except Exception as exc:
        logger.debug("Failed to cache Understat match %s: %s", understat_match_id, exc)
    return shots, None


def _normalise_understat_minute(raw_minute) -> Optional[Tuple[int, Optional[int]]]:
    try:
        m = int(raw_minute) + 1  # Understat is floor-of-elapsed; display is +1
    except (TypeError, ValueError):
        return None
    if m < 1:
        return None
    if m > 90:  # league-only coverage → past 90 is stoppage
        return 90, m - 90
    return m, None


def parse_match_shot_events(shots: Dict) -> Optional[List[MatchEvent]]:
    """Understat shots → goal events (no cards — Understat has none).

    Returns None if any goal has an unusable minute (store nothing rather
    than a half-truth timeline).
    """
    events: List[MatchEvent] = []
    for side, opposite in (("h", "away"), ("a", "home")):
        credited_same = "home" if side == "h" else "away"
        for shot in shots.get(side) or []:
            result = shot.get("result")
            if result == "Goal":
                event_type = "penalty_goal" if shot.get("situation") == "Penalty" else "goal"
                team_side = credited_same
            elif result == "OwnGoal":
                event_type = "own_goal"
                team_side = opposite  # credited to the benefiting side
            else:
                continue
            norm = _normalise_understat_minute(shot.get("minute"))
            if norm is None:
                return None
            minute, added = norm
            events.append(
                MatchEvent(
                    event_type=event_type,
                    minute=minute,
                    added_time=added,
                    team_side=team_side,
                    player=shot.get("player"),
                )
            )
    return events


_DATES_RE = re.compile(r"datesData\s*=\s*JSON\.parse\('([^']+)'\)", re.DOTALL)


def _extract_matches(html: str) -> List[Dict]:
    """Pull the `datesData` JSON blob from the embedded script."""
    m = _DATES_RE.search(html)
    if not m:
        return []
    raw = m.group(1)
    # Understat escapes characters as \xNN — unescape and parse.
    try:
        unescaped = raw.encode("utf-8").decode("unicode_escape")
        return json.loads(unescaped)
    except Exception as exc:
        logger.debug("Understat JSON parse failed: %s", exc)
        return []


def _to_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _find_warehouse_match(
    warehouse: Warehouse,
    *,
    competition_id: str,
    home_team_id: int,
    away_team_id: int,
    target_date: datetime,
) -> Optional[str]:
    lo = (target_date - timedelta(days=2)).isoformat()
    hi = (target_date + timedelta(days=2)).isoformat()
    with warehouse._lock:  # noqa: SLF001
        cur = warehouse._conn.execute(  # noqa: SLF001
            """
            SELECT match_id FROM matches
            WHERE competition_id = ?
              AND home_team_id = ?
              AND away_team_id = ?
              AND date_utc BETWEEN ? AND ?
            ORDER BY ABS(strftime('%s', date_utc) - strftime('%s', ?)) ASC
            LIMIT 1
            """,
            (competition_id, home_team_id, away_team_id, lo, hi, target_date.isoformat()),
        )
        row = cur.fetchone()
        return row["match_id"] if row else None


def _enrich_xg(
    warehouse: Warehouse,
    match_id: str,
    home_xg: Optional[float],
    away_xg: Optional[float],
    *,
    prefer: bool,
) -> None:
    """If `prefer`, overwrite existing xG; else only fill NULLs."""
    with warehouse._lock:  # noqa: SLF001
        if prefer:
            warehouse._conn.execute(  # noqa: SLF001
                "UPDATE matches SET home_xg = ?, away_xg = ? WHERE match_id = ?",
                (home_xg, away_xg, match_id),
            )
        else:
            warehouse._conn.execute(  # noqa: SLF001
                """
                UPDATE matches SET
                    home_xg = COALESCE(home_xg, ?),
                    away_xg = COALESCE(away_xg, ?)
                WHERE match_id = ?
                """,
                (home_xg, away_xg, match_id),
            )


async def _load_one(
    client: httpx.AsyncClient,
    warehouse: Warehouse,
    resolver: TeamResolver,
    *,
    league: Dict,
    season: int,
    prefer_understat: bool,
) -> LoadStats:
    competition_id = league["competition_id"]
    stat = LoadStats(competition_id=competition_id, season=season)

    matches, error = await _fetch_league_matches(client, league["slug"], season)
    if matches is None:
        stat.error = error
        return stat
    stat.fetched = len(matches)
    if not matches:
        return stat

    for m in matches:
        if not m.get("isResult"):
            continue
        home = (m.get("h") or {}).get("title")
        away = (m.get("a") or {}).get("title")
        date_str = m.get("datetime")
        if not home or not away or not date_str:
            continue
        try:
            date_obj = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            if date_obj.tzinfo is None:
                date_obj = date_obj.replace(tzinfo=timezone.utc)
        except ValueError:
            continue

        home_xg = _to_float(m.get("xG", {}).get("h"))
        away_xg = _to_float(m.get("xG", {}).get("a"))
        if home_xg is None and away_xg is None:
            continue

        home_id = resolver.resolve(home, gender="M").team_id
        away_id = resolver.resolve(away, gender="M").team_id
        match_id = _find_warehouse_match(
            warehouse,
            competition_id=competition_id,
            home_team_id=home_id,
            away_team_id=away_id,
            target_date=date_obj,
        )
        if not match_id:
            continue

        stat.matched += 1
        _enrich_xg(warehouse, match_id, home_xg, away_xg, prefer=prefer_understat)
        stat.enriched += 1
    return stat


async def load_understat_xg(
    warehouse: Warehouse,
    *,
    min_season: int = 2014,  # Understat coverage starts ~2014
    max_season: int = 2025,
    competitions: Optional[Iterable[str]] = None,
    prefer_understat: bool = True,
    sleep_between_requests: float = 3.0,
) -> List[LoadStats]:
    resolver = TeamResolver(warehouse, gender_default="M")
    stats: List[LoadStats] = []
    requested = set(competitions) if competitions else None

    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor/4.0 (+research; contact via github.com)"},
        follow_redirects=True,
    ) as client:
        for league in UNDERSTAT_LEAGUES:
            if requested and league["competition_id"] not in requested:
                continue
            for season in range(min_season, max_season + 1):
                stat = await _load_one(
                    client, warehouse, resolver,
                    league=league, season=season,
                    prefer_understat=prefer_understat,
                )
                stats.append(stat)
                if stat.enriched:
                    logger.info(
                        "Understat %s %s → enriched %d / %d fetched",
                        stat.competition_id, season, stat.enriched, stat.fetched,
                    )
                elif stat.error:
                    logger.warning(
                        "Understat %s %s skipped: %s",
                        stat.competition_id, season, stat.error,
                    )
                await asyncio.sleep(sleep_between_requests)
    return stats


def run(**kwargs) -> List[LoadStats]:
    return asyncio.run(load_understat_xg(**kwargs))
