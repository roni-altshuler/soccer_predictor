"""ESPN → warehouse loader.

Wraps the existing `HistoricalDataCollector` (which already knows how to
fetch from ESPN's range scoreboard, handle midweek tournament chunks,
and fall back to curated archives for Euro 2000) and translates the
dicts it returns into canonical `MatchRow` objects written to the
warehouse.

This module also seeds the `competitions` table with metadata for every
ESPN league we care about, and registers women's-league equivalents so
the same loader can populate the women's universe when fed
`gender='F'` plus the relevant ESPN endpoint ID.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchEvent, MatchRow, Warehouse
from backend.services.prediction.historical_data import (
    AVAILABLE_SEASONS,
    ESPN_LEAGUES,
    HistoricalDataCollector,
)

logger = logging.getLogger(__name__)

# competition_id used in the warehouse = ESPN's league key (e.g. "eng.1"),
# suffixed with ".w" for women's competitions.

# Men's competition metadata. The internal key (e.g. "premier_league") is
# what the underlying HistoricalDataCollector expects; competition_id is
# the canonical warehouse identifier.
MEN_COMPETITIONS: Tuple[Dict, ...] = (
    {"key": "premier_league", "competition_id": "eng.1", "name": "Premier League", "country": "GB", "tier": 1, "confederation": "UEFA"},
    {"key": "la_liga",        "competition_id": "esp.1", "name": "La Liga",        "country": "ES", "tier": 1, "confederation": "UEFA"},
    {"key": "bundesliga",     "competition_id": "ger.1", "name": "Bundesliga",     "country": "DE", "tier": 1, "confederation": "UEFA"},
    {"key": "serie_a",        "competition_id": "ita.1", "name": "Serie A",        "country": "IT", "tier": 1, "confederation": "UEFA"},
    {"key": "ligue_1",        "competition_id": "fra.1", "name": "Ligue 1",        "country": "FR", "tier": 1, "confederation": "UEFA"},
    {"key": "eredivisie",     "competition_id": "ned.1", "name": "Eredivisie",     "country": "NL", "tier": 1, "confederation": "UEFA"},
    {"key": "primeira_liga",  "competition_id": "por.1", "name": "Primeira Liga",  "country": "PT", "tier": 1, "confederation": "UEFA"},
    {"key": "mls",            "competition_id": "usa.1", "name": "Major League Soccer", "country": "US", "tier": 1, "confederation": "CONCACAF"},
    {"key": "champions_league", "competition_id": "uefa.champions", "name": "UEFA Champions League", "country": None, "tier": 1, "confederation": "UEFA"},
    {"key": "europa_league",  "competition_id": "uefa.europa",   "name": "UEFA Europa League",     "country": None, "tier": 1, "confederation": "UEFA"},
    {"key": "world_cup",      "competition_id": "fifa.world",    "name": "FIFA World Cup",         "country": None, "tier": 0, "confederation": "FIFA"},
    # Leagues added to /season on 2026-08-12 after each cleared its own
    # benchmark. Results have to reach the warehouse or the forecast
    # cannot re-sync as their seasons run.
    {"key": "championship", "competition_id": "eng.2", "name": "EFL Championship", "country": "GB", "tier": 2, "confederation": "UEFA"},
    {"key": "laliga_2", "competition_id": "esp.2", "name": "LaLiga 2", "country": "ES", "tier": 2, "confederation": "UEFA"},
    {"key": "bundesliga_2", "competition_id": "ger.2", "name": "2. Bundesliga", "country": "DE", "tier": 2, "confederation": "UEFA"},
    {"key": "serie_b", "competition_id": "ita.2", "name": "Serie B", "country": "IT", "tier": 2, "confederation": "UEFA"},
    {"key": "ligue_2", "competition_id": "fra.2", "name": "Ligue 2", "country": "FR", "tier": 2, "confederation": "UEFA"},
    {"key": "super_lig", "competition_id": "tur.1", "name": "Süper Lig", "country": "TR", "tier": 1, "confederation": "UEFA"},
    {"key": "brasileirao", "competition_id": "bra.1", "name": "Brasileirão Série A", "country": "BR", "tier": 1, "confederation": "CONMEBOL"},
    {"key": "euro",           "competition_id": "uefa.euro",     "name": "UEFA European Championship", "country": None, "tier": 0, "confederation": "UEFA"},
    {"key": "copa_america",   "competition_id": "conmebol.america", "name": "Copa América",        "country": None, "tier": 0, "confederation": "CONMEBOL"},
)

# Women's competitions (ESPN IDs where available). Where ESPN doesn't expose
# a women's league we leave the key empty; those rows will be populated by
# FBref / OpenFootball loaders instead.
WOMEN_COMPETITIONS: Tuple[Dict, ...] = (
    {"key": "nwsl",                 "espn_id": "usa.nwsl",           "competition_id": "usa.1.w",    "name": "NWSL",                              "country": "US", "tier": 1, "confederation": "CONCACAF"},
    {"key": "wsl",                  "espn_id": "eng.w.1",            "competition_id": "eng.1.w",    "name": "FA Women's Super League",           "country": "GB", "tier": 1, "confederation": "UEFA"},
    {"key": "fifa_women_world",     "espn_id": "fifa.wwc",           "competition_id": "fifa.world.w","name": "FIFA Women's World Cup",            "country": None, "tier": 0, "confederation": "FIFA"},
    {"key": "uefa_women_euro",      "espn_id": "uefa.weuro",         "competition_id": "uefa.euro.w","name": "UEFA Women's European Championship","country": None, "tier": 0, "confederation": "UEFA"},
    {"key": "uefa_women_champions", "espn_id": "uefa.wchampions",    "competition_id": "uefa.champions.w","name": "UEFA Women's Champions League","country": None, "tier": 1, "confederation": "UEFA"},
)

# Women's season ranges where ESPN coverage is reliable.
WOMEN_SEASONS: Dict[str, List[int]] = {
    "nwsl": list(range(2013, 2026)),
    "wsl": list(range(2018, 2026)),
    "fifa_women_world": [2003, 2007, 2011, 2015, 2019, 2023],
    "uefa_women_euro": [2005, 2009, 2013, 2017, 2022, 2025],
    "uefa_women_champions": list(range(2009, 2026)),
}


@dataclass
class LoadStats:
    competition_id: str
    season: int
    fetched: int
    written: int
    error: Optional[str] = None


def _parse_iso_utc(value: str) -> str:
    """Normalise the assortment of ISO formats ESPN returns into one."""
    if not value:
        return ""
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except ValueError:
        return value


def _to_int(value) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None


def _to_float(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _match_dict_to_row(
    raw: Dict,
    *,
    competition_id: str,
    home_team_id: int,
    away_team_id: int,
    referee_id: Optional[int],
) -> MatchRow:
    return MatchRow(
        match_id=f"espn_{competition_id}_{raw.get('match_id') or raw.get('id')}",
        source="espn",
        competition_id=competition_id,
        season=int(raw.get("season") or 0),
        date_utc=_parse_iso_utc(str(raw.get("date") or "")),
        home_team_id=home_team_id,
        away_team_id=away_team_id,
        home_score=_to_int(raw.get("home_score")),
        away_score=_to_int(raw.get("away_score")),
        phase=raw.get("phase"),
        referee_id=referee_id,
        home_shots=_to_float(raw.get("home_shots")),
        away_shots=_to_float(raw.get("away_shots")),
        home_sot=_to_float(raw.get("home_shots_on_target")),
        away_sot=_to_float(raw.get("away_shots_on_target")),
        home_corners=_to_float(raw.get("home_corners")),
        away_corners=_to_float(raw.get("away_corners")),
        home_yellows=_to_int(raw.get("home_yellows")),
        away_yellows=_to_int(raw.get("away_yellows")),
        home_reds=_to_int(raw.get("home_reds")),
        away_reds=_to_int(raw.get("away_reds")),
        attendance=_to_int(raw.get("attendance")),
        venue=raw.get("venue"),
    )


# ---------------------------------------------------------------------------
# Per-match summary → minute-level events (goals + red cards)
#
# The summary endpoint (`.../soccer/{league}/summary?event={id}`) returns a
# `keyEvents` list. Field names verified against live responses (2026-07):
#   * goals:      type.type ∈ {'goal', 'goal---header', ...}, scoringPlay=True
#   * penalties:  type.type == 'penalty---scored' (id 98), scoringPlay=True
#   * own goals:  type.type == 'own-goal' (id 97), scoringPlay=True and
#                 `team` is ALREADY the credited (benefiting) team
#   * red cards:  type.type == 'red-card' (id 93)
#   * clock.displayValue: "42'", "45'+3'", "108'" (extra time is a plain
#     minute > 90); shootout kicks carry shootout=True / no scoringPlay
# Home/away mapping comes from header.competitions[0].competitors[].homeAway.
# ---------------------------------------------------------------------------

ESPN_SUMMARY_URL = (
    "https://site.web.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={event_id}"
)

# competition_id → ESPN league slug. Men's warehouse competition_ids ARE the
# ESPN slug; women's differ (e.g. usa.1.w ↔ usa.nwsl).
_WOMEN_ESPN_IDS: Dict[str, str] = {c["competition_id"]: c["espn_id"] for c in WOMEN_COMPETITIONS}


def espn_league_for_competition(competition_id: str) -> str:
    return _WOMEN_ESPN_IDS.get(competition_id, competition_id)


def espn_event_id_from_match_id(match_id: str) -> Optional[str]:
    """`espn_{competition_id}_{event_id}` → event_id (competition ids contain dots, not underscores)."""
    if not match_id.startswith("espn_"):
        return None
    _, _, rest = match_id.partition("espn_")
    _, _, event_id = rest.rpartition("_")
    return event_id or None


class SummaryParseError(ValueError):
    """The summary payload is structurally unusable for event extraction."""


_CLOCK_RE = re.compile(r"^(\d+)'(?:\s*\+\s*(\d+)'?)?$")


def parse_clock(display_value: str) -> Tuple[int, Optional[int]]:
    """"45'+3'" → (45, 3); "108'" → (108, None). Raises SummaryParseError."""
    m = _CLOCK_RE.match((display_value or "").strip())
    if not m:
        raise SummaryParseError(f"unparseable clock {display_value!r}")
    minute = int(m.group(1))
    added = int(m.group(2)) if m.group(2) else None
    if not (1 <= minute <= 120):
        raise SummaryParseError(f"clock minute out of range: {display_value!r}")
    return minute, added


def _classify_key_event(ev: Dict) -> Optional[str]:
    """Map one keyEvents entry to a warehouse event_type, or None to ignore."""
    type_str = str(((ev.get("type") or {}).get("type")) or "")
    if ev.get("shootout"):
        return None  # shootout kicks are not match-minute events
    if ev.get("scoringPlay"):
        if type_str == "own-goal":
            return "own_goal"
        if type_str.startswith("penalty"):
            return "penalty_goal"
        return "goal"
    if type_str == "red-card" or type_str.endswith("-red-card"):
        return "red_card"
    return None


def parse_summary_events(payload: Dict) -> List[MatchEvent]:
    """Extract goal + red-card events from an ESPN summary payload.

    Returns [] when the payload simply has no keyEvents (old matches).
    Raises SummaryParseError when data exists but can't be honestly mapped
    (missing home/away header, unknown team id, unparseable clock) — callers
    must then store NOTHING for the match.
    """
    side_by_team_id: Dict[str, str] = {}
    try:
        competitors = payload["header"]["competitions"][0]["competitors"]
    except (KeyError, IndexError, TypeError):
        competitors = []
    for c in competitors or []:
        team_id = str((c.get("team") or {}).get("id") or c.get("id") or "")
        side = c.get("homeAway")
        if team_id and side in ("home", "away"):
            side_by_team_id[team_id] = side

    key_events = payload.get("keyEvents") or []
    events: List[MatchEvent] = []
    for ev in key_events:
        event_type = _classify_key_event(ev)
        if event_type is None:
            continue
        if not side_by_team_id:
            raise SummaryParseError("no home/away mapping in header.competitions")
        team_id = str((ev.get("team") or {}).get("id") or "")
        side = side_by_team_id.get(team_id)
        if side is None:
            raise SummaryParseError(f"event team id {team_id!r} not in header competitors")
        minute, added = parse_clock((ev.get("clock") or {}).get("displayValue") or "")
        participants = ev.get("participants") or []
        player = ((participants[0].get("athlete") or {}).get("displayName")) if participants else None
        events.append(
            MatchEvent(
                event_type=event_type,
                minute=minute,
                added_time=added,
                team_side=side,
                player=player,
            )
        )
    return events


def register_competitions(warehouse: Warehouse) -> None:
    """Idempotently seed the `competitions` table for ESPN-covered leagues."""
    for c in MEN_COMPETITIONS:
        warehouse.upsert_competition(
            competition_id=c["competition_id"],
            name=c["name"],
            gender="M",
            country=c.get("country"),
            tier=c.get("tier"),
            confederation=c.get("confederation"),
        )
    for c in WOMEN_COMPETITIONS:
        warehouse.upsert_competition(
            competition_id=c["competition_id"],
            name=c["name"],
            gender="F",
            country=c.get("country"),
            tier=c.get("tier"),
            confederation=c.get("confederation"),
        )


async def _load_one(
    collector: HistoricalDataCollector,
    warehouse: Warehouse,
    resolver_m: TeamResolver,
    resolver_f: TeamResolver,
    *,
    competition_id: str,
    espn_league_key: str,
    season: int,
    gender: str,
    force: bool,
) -> LoadStats:
    """Fetch one league-season from ESPN and write to warehouse."""
    if espn_league_key not in ESPN_LEAGUES and gender == "M":
        return LoadStats(competition_id, season, 0, 0, error="unknown_espn_league")

    try:
        if gender == "M":
            raw_matches = await collector.fetch_season_matches(espn_league_key, season, force=force)
        else:
            # Women's leagues aren't in the original collector mapping; fall back
            # to a direct ESPN range call by injecting the league id temporarily.
            raw_matches = await _fetch_women_season(collector, espn_league_key, season, force=force)
    except Exception as exc:
        logger.warning("ESPN fetch failed for %s/%s: %s", competition_id, season, exc)
        return LoadStats(competition_id, season, 0, 0, error=str(exc))

    if not raw_matches:
        return LoadStats(competition_id, season, 0, 0)

    resolver = resolver_m if gender == "M" else resolver_f
    rows: List[MatchRow] = []
    for raw in raw_matches:
        home_name = raw.get("home_team")
        away_name = raw.get("away_team")
        if not home_name or not away_name:
            continue
        home_id = resolver.resolve(home_name, gender=gender).team_id
        away_id = resolver.resolve(away_name, gender=gender).team_id

        ref_name = raw.get("referee")
        ref_id = warehouse.upsert_referee(ref_name) if ref_name else None

        rows.append(
            _match_dict_to_row(
                raw,
                competition_id=competition_id,
                home_team_id=home_id,
                away_team_id=away_id,
                referee_id=ref_id,
            )
        )

    written = warehouse.upsert_matches(rows)
    return LoadStats(competition_id, season, len(raw_matches), written)


async def _fetch_women_season(
    collector: HistoricalDataCollector,
    espn_league_id: str,
    season: int,
    *,
    force: bool,
) -> List[Dict]:
    """Direct ESPN range fetch for women's leagues.

    Mirrors `HistoricalDataCollector._date_chunks` but doesn't require a
    pre-registered key in `ESPN_LEAGUES`. Women's seasons follow Aug-May
    for European leagues and Mar-Nov for NWSL, but we widen the window to
    cover both — duplicate matches dedupe by ESPN match_id.
    """
    from datetime import datetime, timedelta
    from backend.services.prediction.historical_data import ESPN_BASE

    client = await collector._get_client()  # noqa: SLF001 — same package use
    matches: List[Dict] = []

    start = datetime(season, 1, 1)
    end = datetime(season + 1, 6, 30)
    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + timedelta(days=30))
        date_str = f"{cursor.strftime('%Y%m%d')}-{chunk_end.strftime('%Y%m%d')}"
        url = (
            f"{ESPN_BASE}/site/v2/sports/soccer/{espn_league_id}/scoreboard"
            f"?dates={date_str}&limit=1000"
        )
        try:
            resp = await client.get(url, timeout=20)
            if resp.status_code == 200:
                events = resp.json().get("events", [])
                for ev in events:
                    parsed = collector._parse_espn_event(ev, espn_league_id, season)  # noqa: SLF001
                    if parsed:
                        matches.append(parsed)
        except Exception as exc:
            logger.debug("Women's ESPN fetch error %s: %s", url, exc)
        await asyncio.sleep(0.1)
        cursor = chunk_end + timedelta(days=1)

    # dedupe by match_id
    seen = set()
    unique = []
    for m in matches:
        mid = m.get("match_id")
        if mid and mid not in seen:
            seen.add(mid)
            unique.append(m)
    return unique


async def load_men_competitions(
    warehouse: Warehouse,
    *,
    min_season: int = 1998,
    max_season: Optional[int] = None,
    competitions: Optional[Iterable[str]] = None,
    force: bool = False,
) -> List[LoadStats]:
    """Backfill every men's ESPN-covered league-season into the warehouse."""
    register_competitions(warehouse)
    resolver_m = TeamResolver(warehouse, gender_default="M")
    resolver_f = TeamResolver(warehouse, gender_default="F")
    collector = HistoricalDataCollector()
    requested = set(competitions) if competitions else None

    stats: List[LoadStats] = []
    try:
        for comp in MEN_COMPETITIONS:
            if requested and comp["competition_id"] not in requested:
                continue
            seasons = AVAILABLE_SEASONS.get(comp["key"], [])
            for season in seasons:
                if season < min_season:
                    continue
                if max_season is not None and season > max_season:
                    continue
                stat = await _load_one(
                    collector,
                    warehouse,
                    resolver_m,
                    resolver_f,
                    competition_id=comp["competition_id"],
                    espn_league_key=comp["key"],
                    season=season,
                    gender="M",
                    force=force,
                )
                stats.append(stat)
                if stat.written:
                    logger.info(
                        "ESPN/M %s %s → %d matches written",
                        comp["competition_id"],
                        season,
                        stat.written,
                    )
    finally:
        await collector.close()
    return stats


async def load_women_competitions(
    warehouse: Warehouse,
    *,
    min_season: int = 2003,
    max_season: Optional[int] = None,
    competitions: Optional[Iterable[str]] = None,
    force: bool = False,
) -> List[LoadStats]:
    """Backfill every women's ESPN-covered league-season into the warehouse."""
    register_competitions(warehouse)
    resolver_m = TeamResolver(warehouse, gender_default="M")
    resolver_f = TeamResolver(warehouse, gender_default="F")
    collector = HistoricalDataCollector()
    requested = set(competitions) if competitions else None

    stats: List[LoadStats] = []
    try:
        for comp in WOMEN_COMPETITIONS:
            if requested and comp["competition_id"] not in requested:
                continue
            seasons = WOMEN_SEASONS.get(comp["key"], [])
            for season in seasons:
                if season < min_season:
                    continue
                if max_season is not None and season > max_season:
                    continue
                stat = await _load_one(
                    collector,
                    warehouse,
                    resolver_m,
                    resolver_f,
                    competition_id=comp["competition_id"],
                    espn_league_key=comp["espn_id"],
                    season=season,
                    gender="F",
                    force=force,
                )
                stats.append(stat)
                if stat.written:
                    logger.info(
                        "ESPN/F %s %s → %d matches written",
                        comp["competition_id"],
                        season,
                        stat.written,
                    )
    finally:
        await collector.close()
    return stats


def run_men(**kwargs) -> List[LoadStats]:
    """Sync convenience wrapper for orchestration scripts."""
    return asyncio.run(load_men_competitions(**kwargs))


def run_women(**kwargs) -> List[LoadStats]:
    return asyncio.run(load_women_competitions(**kwargs))
