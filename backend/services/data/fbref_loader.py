"""FBref → warehouse xG enrichment.

FBref (fbref.com, run by Sports Reference) is the most comprehensive
free source of advanced football stats — including per-match expected
goals (xG and xGA) for the top 5 European men's leagues and a growing
set of women's competitions, plus advanced team metrics like progressive
passes, shot-creating actions, etc.

Scope of this loader
--------------------
For first-pass training we only need *match-level xG* per team. FBref
publishes that on each league's "Scores & Fixtures" page in a table with
columns: Date, Home, Score, xG, Away, xG.AwayTeam, etc.

We:
1. Fetch the season fixtures page for each supported league.
2. Parse the table, extracting `(date, home, away, home_xg, away_xg)`.
3. Match against warehouse rows (existing ESPN/football-data matches)
   and UPDATE `matches.home_xg` / `matches.away_xg` where currently NULL.

Politeness
----------
FBref's robots.txt allows it but they actively rate-limit. We:
* Use a 6-second sleep between requests by default.
* Cache parsed pages on disk for 30 days.
* Identify ourselves with a real User-Agent that includes a contact URL.

This loader fails gracefully — if FBref changes their HTML, we log a
warning, skip the affected season, and move on. The unified model still
trains; it just won't have xG for the un-scraped seasons.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import Warehouse

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "fbref"

# FBref's competition IDs (URL slugs) → warehouse competition_id.
# These IDs appear in URLs like:
#   https://fbref.com/en/comps/9/2017-2018/schedule/2017-2018-Premier-League-Scores-and-Fixtures
FBREF_LEAGUES: Tuple[Dict, ...] = (
    {"fbref_id": "9",  "name": "Premier-League",     "competition_id": "eng.1", "gender": "M"},
    {"fbref_id": "12", "name": "La-Liga",            "competition_id": "esp.1", "gender": "M"},
    {"fbref_id": "20", "name": "Bundesliga",         "competition_id": "ger.1", "gender": "M"},
    {"fbref_id": "11", "name": "Serie-A",            "competition_id": "ita.1", "gender": "M"},
    {"fbref_id": "13", "name": "Ligue-1",            "competition_id": "fra.1", "gender": "M"},
    {"fbref_id": "8",  "name": "Champions-League",   "competition_id": "uefa.champions", "gender": "M"},
    # Women
    {"fbref_id": "189","name": "Womens-Super-League","competition_id": "eng.1.w", "gender": "F"},
    {"fbref_id": "182","name": "NWSL",               "competition_id": "usa.1.w", "gender": "F"},
)


@dataclass
class LoadStats:
    competition_id: str
    season: int
    matched: int = 0
    enriched: int = 0
    fetched: int = 0
    error: Optional[str] = None


def _cache_path(comp_id: str, season: int) -> Path:
    return CACHE_DIR / f"{comp_id}_{season}.html"


def _read_cache(comp_id: str, season: int, max_age_days: int = 30) -> Optional[str]:
    p = _cache_path(comp_id, season)
    if not p.exists():
        return None
    if time.time() - p.stat().st_mtime > max_age_days * 86400:
        return None
    try:
        return p.read_text()
    except Exception:
        return None


def _write_cache(comp_id: str, season: int, body: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _cache_path(comp_id, season).write_text(body)
    except Exception as exc:
        logger.debug("Failed to cache FBref %s: %s", comp_id, exc)


def _season_path(season: int) -> str:
    """FBref uses 'YYYY-YYYY' (full years) in URLs."""
    return f"{season}-{season + 1}"


def _build_url(league: Dict, season: int) -> str:
    season_str = _season_path(season)
    return (
        f"https://fbref.com/en/comps/{league['fbref_id']}/{season_str}/schedule/"
        f"{season_str}-{league['name']}-Scores-and-Fixtures"
    )


_FLOAT_RE = re.compile(r"^[-+]?\d*\.?\d+$")


def _safe_float(s: str) -> Optional[float]:
    s = (s or "").strip()
    if not s or not _FLOAT_RE.match(s):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_fixtures_table(html: str) -> List[Dict]:
    """Pull (date, home, home_xg, away, away_xg) rows from the schedule table."""
    soup = BeautifulSoup(html, "lxml")
    # FBref wraps tables inside HTML comments — un-comment them so BeautifulSoup sees them.
    for c in soup.find_all(string=lambda s: isinstance(s, str) and s.strip().startswith("<table")):
        try:
            inner = BeautifulSoup(c, "lxml")
            c.replace_with(inner)
        except Exception:
            continue

    table = soup.find("table", id=re.compile(r"sched_.*"))
    if table is None:
        return []

    out: List[Dict] = []
    for tr in table.tbody.find_all("tr") if table.tbody else []:
        if "thead" in (tr.get("class") or []):
            continue

        def cell(name: str) -> str:
            td = tr.find("td", {"data-stat": name})
            return td.get_text(strip=True) if td else ""

        date_str = cell("date")
        home = cell("home_team")
        away = cell("away_team")
        if not date_str or not home or not away:
            continue
        home_xg = _safe_float(cell("home_xg"))
        away_xg = _safe_float(cell("away_xg"))
        # No xG for many older seasons — skip rather than emit nulls.
        if home_xg is None and away_xg is None:
            continue
        try:
            date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue

        out.append({
            "date": date_obj.replace(tzinfo=timezone.utc).isoformat(),
            "home": home,
            "away": away,
            "home_xg": home_xg,
            "away_xg": away_xg,
        })
    return out


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


def _enrich_xg(warehouse: Warehouse, match_id: str, home_xg: Optional[float], away_xg: Optional[float]) -> None:
    with warehouse._lock:  # noqa: SLF001
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
    resolver_m: TeamResolver,
    resolver_f: TeamResolver,
    *,
    league: Dict,
    season: int,
) -> LoadStats:
    competition_id = league["competition_id"]
    stat = LoadStats(competition_id=competition_id, season=season)

    body = _read_cache(competition_id, season)
    if body is None:
        url = _build_url(league, season)
        try:
            resp = await client.get(url, timeout=30)
        except Exception as exc:
            stat.error = str(exc)
            return stat
        if resp.status_code != 200:
            stat.error = f"http {resp.status_code}"
            return stat
        body = resp.text
        _write_cache(competition_id, season, body)

    rows = _parse_fixtures_table(body)
    stat.fetched = len(rows)
    if not rows:
        return stat

    resolver = resolver_m if league["gender"] == "M" else resolver_f
    for r in rows:
        try:
            date_obj = datetime.fromisoformat(r["date"])
        except ValueError:
            continue
        home_id = resolver.resolve(r["home"], gender=league["gender"]).team_id
        away_id = resolver.resolve(r["away"], gender=league["gender"]).team_id
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
        _enrich_xg(warehouse, match_id, r["home_xg"], r["away_xg"])
        stat.enriched += 1
    return stat


async def load_fbref_xg(
    warehouse: Warehouse,
    *,
    min_season: int = 2017,  # FBref started publishing xG ~2017
    max_season: int = 2025,
    competitions: Optional[Iterable[str]] = None,
    sleep_between_requests: float = 6.0,
) -> List[LoadStats]:
    """Enrich warehouse matches with FBref xG.

    Args:
        min_season: First season to fetch (default 2017, when FBref xG started).
        max_season: Last season to fetch (inclusive).
        competitions: warehouse competition_ids to limit to; default = all FBref leagues.
        sleep_between_requests: Politeness delay between HTTP calls.
    """
    resolver_m = TeamResolver(warehouse, gender_default="M")
    resolver_f = TeamResolver(warehouse, gender_default="F")
    stats: List[LoadStats] = []
    requested = set(competitions) if competitions else None

    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor/4.0 (+research; contact via github.com)"},
        follow_redirects=True,
    ) as client:
        for league in FBREF_LEAGUES:
            if requested and league["competition_id"] not in requested:
                continue
            for season in range(min_season, max_season + 1):
                stat = await _load_one(
                    client, warehouse, resolver_m, resolver_f,
                    league=league, season=season,
                )
                stats.append(stat)
                if stat.enriched:
                    logger.info(
                        "FBref xG %s %s → enriched %d / %d fetched",
                        stat.competition_id, season, stat.enriched, stat.fetched,
                    )
                elif stat.error:
                    logger.warning(
                        "FBref xG %s %s skipped: %s",
                        stat.competition_id, season, stat.error,
                    )
                await asyncio.sleep(sleep_between_requests)
    return stats


def run(**kwargs) -> List[LoadStats]:
    return asyncio.run(load_fbref_xg(**kwargs))
