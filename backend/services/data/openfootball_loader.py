"""OpenFootball → warehouse loader.

OpenFootball (github.com/openfootball) is a community-curated repository
of football match data published as plain JSON. We use the
`football.json` repo's per-season files:

    https://raw.githubusercontent.com/openfootball/football.json/master/<SEASON>/<LEAGUE>.json

    e.g.  .../2017-18/en.1.json   (Premier League 2017-18)
          .../2003-04/de.1.json   (Bundesliga 2003-04)

Each file has:

    {
      "name": "English Premier League 2017/18",
      "matches": [
        {"round": "Matchday 1", "date": "2017-08-11",
         "team1": "Arsenal FC", "team2": "Leicester City FC",
         "score": {"ft": [4, 3]}},
        ...
      ]
    }

OpenFootball's value here is filling history that ESPN doesn't expose
cleanly (pre-2003 seasons for some leagues, plus alternative coverage of
smaller leagues). We treat it as a *gap-filler*: a match is only
inserted when no ESPN/football-data row already covers it.

Note: OpenFootball spellings differ from ESPN ("Arsenal FC" vs
"Arsenal"). The team resolver handles this.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import httpx

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import MatchRow, Warehouse

logger = logging.getLogger(__name__)

OF_BASE = "https://raw.githubusercontent.com/openfootball/football.json/master"


# (openfootball league filename without .json, warehouse competition_id, gender, season_format)
# season_format: "YYYY-YY" or "YYYY" depending on the league
OPENFOOTBALL_LEAGUES: Tuple[Dict, ...] = (
    {"of_id": "en.1",        "competition_id": "eng.1",          "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "es.1",        "competition_id": "esp.1",          "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "de.1",        "competition_id": "ger.1",          "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "it.1",        "competition_id": "ita.1",          "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "fr.1",        "competition_id": "fra.1",          "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "nl.1",        "competition_id": "ned.1",          "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "pt.1",        "competition_id": "por.1",          "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "champions-league",  "competition_id": "uefa.champions", "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "europa-league",     "competition_id": "uefa.europa",    "gender": "M", "season_format": "YYYY-YY"},
    {"of_id": "world-cup",         "competition_id": "fifa.world",     "gender": "M", "season_format": "YYYY"},
    {"of_id": "euro",              "competition_id": "uefa.euro",      "gender": "M", "season_format": "YYYY"},
    {"of_id": "copa-america",      "competition_id": "conmebol.america","gender": "M", "season_format": "YYYY"},
)


@dataclass
class LoadStats:
    competition_id: str
    season: int
    fetched: int
    inserted: int
    skipped_existing: int
    error: Optional[str] = None
    note: str = ""


def _season_path(season: int, fmt: str) -> str:
    if fmt == "YYYY-YY":
        return f"{season}-{str(season + 1)[-2:]}"
    return str(season)


def _parse_score(payload: Dict) -> Tuple[Optional[int], Optional[int]]:
    """OpenFootball `score` can be `{ft:[h,a]}` or `{ht:[..],ft:[..]}` or missing."""
    if not isinstance(payload, dict):
        return None, None
    ft = payload.get("ft") or payload.get("FT")
    if isinstance(ft, list) and len(ft) == 2:
        try:
            return int(ft[0]), int(ft[1])
        except (TypeError, ValueError):
            return None, None
    return None, None


def _date_to_utc(date_str: str) -> Optional[str]:
    """OpenFootball dates are YYYY-MM-DD with no time. Pin to 18:00 UTC (kickoff stand-in)."""
    if not date_str:
        return None
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d").replace(hour=18, tzinfo=timezone.utc)
        return dt.isoformat()
    except (TypeError, ValueError):
        return None


def _existing_match(
    warehouse: Warehouse,
    *,
    competition_id: str,
    home_team_id: int,
    away_team_id: int,
    date_utc: str,
) -> bool:
    """A wider window than football-data: ±3 days, since OpenFootball dates are date-only."""
    from datetime import timedelta
    try:
        dt = datetime.fromisoformat(date_utc.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    lo = (dt - timedelta(days=3)).isoformat()
    hi = (dt + timedelta(days=3)).isoformat()
    with warehouse._lock:  # noqa: SLF001
        cur = warehouse._conn.execute(  # noqa: SLF001
            """
            SELECT 1 FROM matches
            WHERE competition_id = ?
              AND home_team_id = ?
              AND away_team_id = ?
              AND date_utc BETWEEN ? AND ?
            LIMIT 1
            """,
            (competition_id, home_team_id, away_team_id, lo, hi),
        )
        return cur.fetchone() is not None


async def _load_one(
    client: httpx.AsyncClient,
    warehouse: Warehouse,
    resolver_m: TeamResolver,
    resolver_f: TeamResolver,
    *,
    competition_id: str,
    of_id: str,
    season: int,
    gender: str,
    season_format: str,
) -> LoadStats:
    season_str = _season_path(season, season_format)
    url = f"{OF_BASE}/{season_str}/{of_id}.json"

    try:
        resp = await client.get(url, timeout=20)
    except Exception as exc:
        return LoadStats(competition_id, season, 0, 0, 0, error=str(exc))

    if resp.status_code == 404:
        return LoadStats(competition_id, season, 0, 0, 0, note="404 (season not in OF)")
    if resp.status_code != 200:
        return LoadStats(competition_id, season, 0, 0, 0, error=f"http {resp.status_code}")

    try:
        payload = resp.json()
    except Exception as exc:
        return LoadStats(competition_id, season, 0, 0, 0, error=f"json parse: {exc}")

    matches = payload.get("matches", [])
    resolver = resolver_m if gender == "M" else resolver_f

    new_rows: List[MatchRow] = []
    skipped = 0
    for m in matches:
        home_name = m.get("team1") or m.get("home")
        away_name = m.get("team2") or m.get("away")
        if not home_name or not away_name:
            continue
        h_score, a_score = _parse_score(m.get("score", {}))
        if h_score is None or a_score is None:
            # No full-time score → match not played yet or data missing; skip.
            continue
        date_utc = _date_to_utc(str(m.get("date") or ""))
        if not date_utc:
            continue

        home_id = resolver.resolve(home_name, gender=gender).team_id
        away_id = resolver.resolve(away_name, gender=gender).team_id

        if _existing_match(
            warehouse,
            competition_id=competition_id,
            home_team_id=home_id,
            away_team_id=away_id,
            date_utc=date_utc,
        ):
            skipped += 1
            continue

        match_id = f"of_{competition_id}_{season_str}_{date_utc[:10]}_{home_id}_{away_id}"
        new_rows.append(
            MatchRow(
                match_id=match_id,
                source="openfootball",
                competition_id=competition_id,
                season=season,
                date_utc=date_utc,
                home_team_id=home_id,
                away_team_id=away_id,
                home_score=h_score,
                away_score=a_score,
                phase=m.get("round"),
            )
        )

    inserted = warehouse.upsert_matches(new_rows) if new_rows else 0
    return LoadStats(
        competition_id=competition_id,
        season=season,
        fetched=len(matches),
        inserted=inserted,
        skipped_existing=skipped,
    )


async def load_openfootball(
    warehouse: Warehouse,
    *,
    min_season: int = 1993,
    max_season: int = 2025,
    competitions: Optional[Iterable[str]] = None,
) -> List[LoadStats]:
    resolver_m = TeamResolver(warehouse, gender_default="M")
    resolver_f = TeamResolver(warehouse, gender_default="F")
    stats: List[LoadStats] = []
    requested = set(competitions) if competitions else None

    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor/4.0 (+research)"},
        follow_redirects=True,
    ) as client:
        for league in OPENFOOTBALL_LEAGUES:
            if requested and league["competition_id"] not in requested:
                continue
            for season in range(min_season, max_season + 1):
                stat = await _load_one(
                    client, warehouse, resolver_m, resolver_f,
                    competition_id=league["competition_id"],
                    of_id=league["of_id"],
                    season=season,
                    gender=league["gender"],
                    season_format=league["season_format"],
                )
                stats.append(stat)
                if stat.inserted:
                    logger.info(
                        "OF %s %s → %d new matches (fetched %d, skipped %d existing)",
                        stat.competition_id, season,
                        stat.inserted, stat.fetched, stat.skipped_existing,
                    )
                # Be polite to GitHub's raw endpoint.
                await asyncio.sleep(0.3)

    return stats


def run(**kwargs) -> List[LoadStats]:
    return asyncio.run(load_openfootball(**kwargs))
