"""football-data.co.uk → warehouse loader.

football-data.co.uk publishes per-season CSVs that contain match results,
betting odds (Pinnacle / Bet365 / market averages), referees, shots, shot-
on-target, corners, fouls, and yellow/red cards. The odds in particular
are the single strongest predictive signal available outside of a
licensed live-odds feed, so this loader is essential.

Strategy
--------
* Reuse `HistoricalDataCollector.fetch_football_data_season` (already in
  the project) to do the actual HTTP / CSV parsing. It also caches CSV
  contents under `backend/data/historical/fd_*.json` so re-running is
  cheap.
* For each football-data row, try to *merge* it into an existing ESPN
  match in the warehouse: same competition, same teams (after
  alias resolution), date within ±2 days (CSV dates are local; ESPN dates
  are UTC, so cross-midnight drift is normal). When we find a match, we
  UPDATE it with the odds + extra stats — preserving ESPN's match_id and
  any other source-specific data already present.
* If no ESPN match exists (some lower leagues are FD-only), insert a
  fresh `source='fdcouk'` row.

Timestamps — read this before touching `_parse_fd_date`
-------------------------------------------------------
football-data.co.uk's `Date` column is a **local calendar date with no
time and no timezone** (`04/03/2026`). `HistoricalDataCollector` turns it
into a naive `datetime` at local midnight.

Calling `.astimezone(timezone.utc)` on a naive datetime does NOT treat it
as UTC — Python assumes it is in the *host machine's* zone and converts.
On the Asia/Jerusalem box this warehouse was built on, every football-data
row was therefore shifted back by 2–3 hours across midnight: a 2026-03-04
fixture was stored as `2026-03-03T22:00:00+00:00`. That moved the calendar
date *and* the weekday back by one day for 86% of Wave A, which is why the
Wave A weekday histogram peaked Friday/Saturday instead of Saturday/Sunday
and why every day-of-week feature was wrong.

The date is now anchored to UTC explicitly. Where football-data also
publishes a `Time` column (all leagues, 2019-20 season onward) we fetch it
and convert the venue-local kickoff to a real UTC instant, so those rows
carry a genuine kickoff rather than a midnight placeholder. Rows without a
`Time` keep 00:00:00Z, which callers must read as "date known, kickoff
unknown" — never as a real midnight kickoff.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo

import httpx

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchRow, Warehouse
from backend.services.prediction.historical_data import (
    FOOTBALL_DATA_LEAGUES,
    FOOTBALL_DATA_SEASONS,
    HistoricalDataCollector,
)

logger = logging.getLogger(__name__)

# football-data leagues → warehouse competition_id (must match ESPN loader's IDs)
FD_TO_COMPETITION_ID: Dict[str, str] = {
    "premier_league": "eng.1",
    "la_liga": "esp.1",
    "bundesliga": "ger.1",
    "serie_a": "ita.1",
    "ligue_1": "fra.1",
    "eredivisie": "ned.1",
    "primeira_liga": "por.1",
}

# Venue-local timezone for each domestic league. football-data's `Time`
# column is local wall-clock at the ground, so we need this to recover a
# true UTC instant (and to get BST/CEST transitions right).
FD_LEAGUE_TIMEZONE: Dict[str, str] = {
    "premier_league": "Europe/London",
    "la_liga": "Europe/Madrid",
    "bundesliga": "Europe/Berlin",
    "serie_a": "Europe/Rome",
    "ligue_1": "Europe/Paris",
    "eredivisie": "Europe/Amsterdam",
    "primeira_liga": "Europe/Lisbon",
}

# Clubs whose home ground is NOT in their league's mainland timezone.
# Getting these wrong would put the kickoff an hour out, so they are named
# explicitly rather than absorbed into the league default. Keyed by the
# football-data spelling of the HOME team.
FD_VENUE_TIMEZONE_OVERRIDES: Dict[Tuple[str, str], str] = {
    ("la_liga", "Las Palmas"): "Atlantic/Canary",
    ("la_liga", "Tenerife"): "Atlantic/Canary",
    ("primeira_liga", "Maritimo"): "Atlantic/Madeira",
    ("primeira_liga", "Nacional"): "Atlantic/Madeira",
    ("primeira_liga", "Uniao Madeira"): "Atlantic/Madeira",
    ("primeira_liga", "Santa Clara"): "Atlantic/Azores",
}

FD_CSV_URL = "https://www.football-data.co.uk/mmz4281/{season_code}/{code}.csv"


@dataclass
class LoadStats:
    competition_id: str
    season: int
    fetched: int
    enriched: int  # existing rows updated
    inserted: int  # rows created because no ESPN match was found
    error: Optional[str] = None
    kickoffs_applied: int = 0  # rows given a real UTC kickoff from `Time`
    duplicates_skipped: int = 0  # same fixture already present under other ids


def _to_float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _to_int(v) -> Optional[int]:
    f = _to_float(v)
    return None if f is None else int(f)


def _parse_fd_date(date_iso: str) -> Optional[datetime]:
    """football-data's local calendar date → a UTC-anchored datetime.

    A naive input is anchored to UTC, NOT converted from the host
    machine's local zone — see the module docstring for the bug that
    caused. An input that already carries an offset is converted normally.
    """
    try:
        parsed = datetime.fromisoformat(str(date_iso).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _season_code(season: int) -> str:
    """2019 → '1920' (football-data's split-season directory name)."""
    return f"{season % 100:02d}{(season + 1) % 100:02d}"


def _venue_timezone(league: str, home_team: str) -> ZoneInfo:
    tz_name = FD_VENUE_TIMEZONE_OVERRIDES.get(
        (league, (home_team or "").strip())
    ) or FD_LEAGUE_TIMEZONE.get(league)
    return ZoneInfo(tz_name) if tz_name else ZoneInfo("UTC")


def _combine_local_kickoff(
    date_utc_midnight: datetime, hhmm: str, tz: ZoneInfo
) -> Optional[datetime]:
    """(date, 'HH:MM', venue tz) → real UTC instant, or None if unusable."""
    try:
        hour, minute = (int(p) for p in hhmm.strip().split(":")[:2])
    except (ValueError, TypeError, AttributeError):
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    local = datetime(
        date_utc_midnight.year, date_utc_midnight.month, date_utc_midnight.day,
        hour, minute, tzinfo=tz,
    )
    return local.astimezone(timezone.utc)


async def fetch_kickoff_times(
    client: httpx.AsyncClient, league: str, season: int
) -> Dict[Tuple[str, str, str], str]:
    """(date 'YYYY-MM-DD', home, away) → local 'HH:MM' for one season file.

    Returns {} when football-data publishes no `Time` column for that
    season — it appears from 2019-20 onward and is absent before that.
    Never raises: a missing kickoff is genuine missingness, not an error.
    """
    code = FOOTBALL_DATA_LEAGUES.get(league)
    if not code:
        return {}
    url = FD_CSV_URL.format(season_code=_season_code(season), code=code)
    try:
        resp = await client.get(url, timeout=30)
    except Exception as exc:
        logger.debug("FD kickoff fetch failed %s/%s: %s", league, season, exc)
        return {}
    if resp.status_code != 200:
        return {}

    out: Dict[Tuple[str, str, str], str] = {}
    reader = csv.DictReader(io.StringIO(resp.text))
    if not reader.fieldnames or "Time" not in reader.fieldnames:
        return {}
    for row in reader:
        raw_time = (row.get("Time") or "").strip()
        raw_date = (row.get("Date") or "").strip()
        home = (row.get("HomeTeam") or "").strip()
        away = (row.get("AwayTeam") or "").strip()
        if not raw_time or not raw_date or not home or not away:
            continue
        for fmt in ("%d/%m/%Y", "%d/%m/%y"):
            try:
                day = datetime.strptime(raw_date, fmt)
                break
            except ValueError:
                day = None
        if day is None:
            continue
        out[(day.strftime("%Y-%m-%d"), home, away)] = raw_time
    return out


def _find_existing_match(
    warehouse: Warehouse,
    *,
    competition_id: str,
    home_team_id: int,
    away_team_id: int,
    target_date: datetime,
    window_days: int = 2,
) -> Optional[str]:
    """Find an ESPN match within ±`window_days` of `target_date`."""
    lo = (target_date - timedelta(days=window_days)).isoformat()
    hi = (target_date + timedelta(days=window_days)).isoformat()
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


def _find_fixture_in_season(
    warehouse: Warehouse,
    *,
    competition_id: str,
    season: int,
    home_team_id: int,
    away_team_id: int,
) -> Optional[str]:
    """Same fixture anywhere in the season, ignoring the date entirely.

    The ±2-day window above is the normal path, but ESPN and football-data
    occasionally disagree about a postponed fixture's date by more than two
    days. Every competition this loader handles is a double round-robin, so
    (competition, season, home, away) identifies at most one real fixture —
    finding one here means the fixture already exists and inserting would
    create a duplicate. This is the ingest-side uniqueness guard.
    """
    with warehouse._lock:  # noqa: SLF001
        cur = warehouse._conn.execute(  # noqa: SLF001
            """
            SELECT match_id FROM matches
            WHERE competition_id = ? AND season = ?
              AND home_team_id = ? AND away_team_id = ?
            ORDER BY date_utc ASC LIMIT 1
            """,
            (competition_id, season, home_team_id, away_team_id),
        )
        row = cur.fetchone()
        return row["match_id"] if row else None


def _enrich_match(
    warehouse: Warehouse,
    match_id: str,
    raw: Dict,
    *,
    referee_id: Optional[int],
) -> None:
    """COALESCE-style update: only overwrite NULL columns."""
    with warehouse._lock:  # noqa: SLF001
        warehouse._conn.execute(  # noqa: SLF001
            """
            UPDATE matches SET
                referee_id   = COALESCE(referee_id, ?),
                home_shots   = COALESCE(home_shots, ?),
                away_shots   = COALESCE(away_shots, ?),
                home_sot     = COALESCE(home_sot, ?),
                away_sot     = COALESCE(away_sot, ?),
                home_corners = COALESCE(home_corners, ?),
                away_corners = COALESCE(away_corners, ?),
                home_yellows = COALESCE(home_yellows, ?),
                away_yellows = COALESCE(away_yellows, ?),
                home_reds    = COALESCE(home_reds, ?),
                away_reds    = COALESCE(away_reds, ?),
                odds_home    = COALESCE(odds_home, ?),
                odds_draw    = COALESCE(odds_draw, ?),
                odds_away    = COALESCE(odds_away, ?),
                odds_over_2_5= COALESCE(odds_over_2_5, ?)
            WHERE match_id = ?
            """,
            (
                referee_id,
                _to_float(raw.get("home_shots")),
                _to_float(raw.get("away_shots")),
                _to_float(raw.get("home_shots_on_target")),
                _to_float(raw.get("away_shots_on_target")),
                _to_float(raw.get("home_corners")),
                _to_float(raw.get("away_corners")),
                _to_int(raw.get("home_yellows")),
                _to_int(raw.get("away_yellows")),
                _to_int(raw.get("home_reds")),
                _to_int(raw.get("away_reds")),
                _to_float(raw.get("odds_home")),
                _to_float(raw.get("odds_draw")),
                _to_float(raw.get("odds_away")),
                _to_float(raw.get("odds_over_2_5")),
                match_id,
            ),
        )


def _raw_to_row(
    raw: Dict,
    *,
    competition_id: str,
    home_team_id: int,
    away_team_id: int,
    referee_id: Optional[int],
) -> MatchRow:
    return MatchRow(
        match_id=raw.get("match_id") or f"fdcouk_{competition_id}_{raw.get('date')}_{home_team_id}_{away_team_id}",
        source="fdcouk",
        competition_id=competition_id,
        season=int(raw.get("season") or 0),
        date_utc=raw.get("date") or "",
        home_team_id=home_team_id,
        away_team_id=away_team_id,
        home_score=_to_int(raw.get("home_score")),
        away_score=_to_int(raw.get("away_score")),
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
        odds_home=_to_float(raw.get("odds_home")),
        odds_draw=_to_float(raw.get("odds_draw")),
        odds_away=_to_float(raw.get("odds_away")),
        odds_over_2_5=_to_float(raw.get("odds_over_2_5")),
        odds_close_home=_to_float(raw.get("odds_close_home")),
        odds_close_draw=_to_float(raw.get("odds_close_draw")),
        odds_close_away=_to_float(raw.get("odds_close_away")),
    )


async def _load_one(
    collector: HistoricalDataCollector,
    warehouse: Warehouse,
    resolver: TeamResolver,
    *,
    league: str,
    season: int,
    force: bool,
    kickoffs: Optional[Dict[Tuple[str, str, str], str]] = None,
) -> LoadStats:
    competition_id = FD_TO_COMPETITION_ID.get(league)
    if not competition_id:
        return LoadStats(league, season, 0, 0, 0, error="unknown_league")
    if league not in FOOTBALL_DATA_LEAGUES or season not in FOOTBALL_DATA_SEASONS.get(league, []):
        return LoadStats(competition_id, season, 0, 0, 0, error="season_not_in_fd_range")

    try:
        raw_matches = await collector.fetch_football_data_season(league, season, force=force)
    except Exception as exc:
        logger.warning("FD fetch failed %s/%s: %s", competition_id, season, exc)
        return LoadStats(competition_id, season, 0, 0, 0, error=str(exc))

    kickoffs = kickoffs or {}
    enriched = 0
    kickoffs_applied = 0
    duplicates_skipped = 0
    new_rows: List[MatchRow] = []
    # Guard against the source file itself listing a fixture twice.
    seen_fixtures: Set[Tuple[int, int]] = set()

    for raw in raw_matches:
        date_obj = _parse_fd_date(str(raw.get("date") or ""))
        if not date_obj:
            continue
        home_name = raw.get("home_team")
        away_name = raw.get("away_team")
        if not home_name or not away_name:
            continue

        # Upgrade midnight-UTC to the real kickoff where football-data
        # publishes one (2019-20 onward). Absent → stays 00:00:00Z, meaning
        # "date known, kickoff unknown".
        hhmm = kickoffs.get((date_obj.strftime("%Y-%m-%d"), home_name.strip(), away_name.strip()))
        if hhmm:
            precise = _combine_local_kickoff(
                date_obj, hhmm, _venue_timezone(league, home_name)
            )
            if precise is not None:
                date_obj = precise
                kickoffs_applied += 1

        home_id = resolver.resolve(home_name, gender="M").team_id
        away_id = resolver.resolve(away_name, gender="M").team_id

        if (home_id, away_id) in seen_fixtures:
            duplicates_skipped += 1
            continue
        seen_fixtures.add((home_id, away_id))

        ref_name = raw.get("referee")
        ref_id = warehouse.upsert_referee(ref_name) if ref_name else None

        existing_id = _find_existing_match(
            warehouse,
            competition_id=competition_id,
            home_team_id=home_id,
            away_team_id=away_id,
            target_date=date_obj,
        )
        if existing_id is None:
            # Date disagreement wider than the ±2-day window — still the
            # same fixture. Enrich it instead of inserting a duplicate.
            existing_id = _find_fixture_in_season(
                warehouse,
                competition_id=competition_id,
                season=season,
                home_team_id=home_id,
                away_team_id=away_id,
            )
            if existing_id is not None:
                duplicates_skipped += 1

        if existing_id:
            _enrich_match(warehouse, existing_id, raw, referee_id=ref_id)
            enriched += 1
        else:
            raw_norm = dict(raw)
            raw_norm["date"] = date_obj.isoformat()
            raw_norm["season"] = season
            new_rows.append(
                _raw_to_row(
                    raw_norm,
                    competition_id=competition_id,
                    home_team_id=home_id,
                    away_team_id=away_id,
                    referee_id=ref_id,
                )
            )

    inserted = warehouse.upsert_matches(new_rows) if new_rows else 0
    return LoadStats(
        competition_id=competition_id,
        season=season,
        fetched=len(raw_matches),
        enriched=enriched,
        inserted=inserted,
        kickoffs_applied=kickoffs_applied,
        duplicates_skipped=duplicates_skipped,
    )


async def load_football_data(
    warehouse: Warehouse,
    *,
    min_season: int = 2005,
    max_season: Optional[int] = None,
    leagues: Optional[Iterable[str]] = None,
    force: bool = False,
    with_kickoff_times: bool = True,
) -> List[LoadStats]:
    """Backfill football-data.co.uk odds+stats into the warehouse.

    `with_kickoff_times` fetches the raw season CSV a second time to read
    its `Time` column (present 2019-20 onward). That is one extra small
    HTTP GET per league-season; set it False for an offline/cached run.
    """
    resolver = TeamResolver(warehouse, gender_default="M")
    collector = HistoricalDataCollector()
    requested = set(leagues) if leagues else None

    stats: List[LoadStats] = []
    client = (
        httpx.AsyncClient(
            headers={"User-Agent": "SoccerPredictor/4.0 (+research)"},
            follow_redirects=True,
        )
        if with_kickoff_times
        else None
    )
    try:
        for league, _fd_code in FOOTBALL_DATA_LEAGUES.items():
            if requested and FD_TO_COMPETITION_ID.get(league) not in requested:
                continue
            for season in FOOTBALL_DATA_SEASONS.get(league, []):
                if season < min_season:
                    continue
                if max_season is not None and season > max_season:
                    continue
                kickoffs = (
                    await fetch_kickoff_times(client, league, season)
                    if client is not None
                    else {}
                )
                stat = await _load_one(
                    collector, warehouse, resolver,
                    league=league, season=season, force=force,
                    kickoffs=kickoffs,
                )
                stats.append(stat)
                if stat.enriched or stat.inserted:
                    logger.info(
                        "FD %s %s → %d enriched, %d inserted, %d kickoffs, "
                        "%d dupes skipped (of %d fetched)",
                        stat.competition_id, season,
                        stat.enriched, stat.inserted, stat.kickoffs_applied,
                        stat.duplicates_skipped, stat.fetched,
                    )
    finally:
        await collector.close()
        if client is not None:
            await client.aclose()

    if resolver.near_duplicates:
        logger.warning(
            "football-data introduced %d near-duplicate team name(s) that were "
            "NOT merged. Pin them in backend/data/team_aliases.yml: %s",
            len(resolver.near_duplicates),
            ", ".join(f"{n!r}~{e!r}({s:.2f})" for n, e, s in resolver.near_duplicates[:20]),
        )
    return stats


def run(**kwargs) -> List[LoadStats]:
    return asyncio.run(load_football_data(**kwargs))
