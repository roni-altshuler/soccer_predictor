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
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

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


@dataclass
class LoadStats:
    competition_id: str
    season: int
    fetched: int
    enriched: int  # existing rows updated
    inserted: int  # rows created because no ESPN match was found
    error: Optional[str] = None


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
    try:
        return datetime.fromisoformat(date_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


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
    )


async def _load_one(
    collector: HistoricalDataCollector,
    warehouse: Warehouse,
    resolver: TeamResolver,
    *,
    league: str,
    season: int,
    force: bool,
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

    enriched = 0
    new_rows: List[MatchRow] = []

    for raw in raw_matches:
        date_obj = _parse_fd_date(str(raw.get("date") or ""))
        if not date_obj:
            continue
        home_name = raw.get("home_team")
        away_name = raw.get("away_team")
        if not home_name or not away_name:
            continue

        home_id = resolver.resolve(home_name, gender="M").team_id
        away_id = resolver.resolve(away_name, gender="M").team_id

        ref_name = raw.get("referee")
        ref_id = warehouse.upsert_referee(ref_name) if ref_name else None

        existing_id = _find_existing_match(
            warehouse,
            competition_id=competition_id,
            home_team_id=home_id,
            away_team_id=away_id,
            target_date=date_obj,
        )
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
    )


async def load_football_data(
    warehouse: Warehouse,
    *,
    min_season: int = 2005,
    max_season: Optional[int] = None,
    leagues: Optional[Iterable[str]] = None,
    force: bool = False,
) -> List[LoadStats]:
    """Backfill football-data.co.uk odds+stats into the warehouse."""
    resolver = TeamResolver(warehouse, gender_default="M")
    collector = HistoricalDataCollector()
    requested = set(leagues) if leagues else None

    stats: List[LoadStats] = []
    try:
        for league, _fd_code in FOOTBALL_DATA_LEAGUES.items():
            if requested and FD_TO_COMPETITION_ID.get(league) not in requested:
                continue
            for season in FOOTBALL_DATA_SEASONS.get(league, []):
                if season < min_season:
                    continue
                if max_season is not None and season > max_season:
                    continue
                stat = await _load_one(
                    collector, warehouse, resolver,
                    league=league, season=season, force=force,
                )
                stats.append(stat)
                if stat.enriched or stat.inserted:
                    logger.info(
                        "FD %s %s → %d enriched, %d inserted (of %d fetched)",
                        stat.competition_id, season,
                        stat.enriched, stat.inserted, stat.fetched,
                    )
    finally:
        await collector.close()
    return stats


def run(**kwargs) -> List[LoadStats]:
    return asyncio.run(load_football_data(**kwargs))
