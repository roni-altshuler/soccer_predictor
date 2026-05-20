"""ClubElo → warehouse loader.

ClubElo (clubelo.com) maintains an authoritative ELO time-series for
European clubs going back to 1995. The free HTTP API returns CSV:

    GET http://api.clubelo.com/<TeamName>

    Club,Country,Level,Elo,From,To
    Barcelona,ESP,1,2065.79,2019-08-09,2019-08-15
    Barcelona,ESP,1,2080.04,2019-08-16,2019-08-22
    ...

Each row says "this team had this Elo *from* <date> *until* <date>".
We persist one row per (team_id, From) in `clubelo_ratings`. The feature
builder then picks the latest row whose `From <= match_date`.

ClubElo only covers MEN'S European clubs. For women's leagues we keep
the internal Elo system as the primary rating source.

The CSV uses ClubElo's own team-name spelling (e.g. "Barcelona", not
"FC Barcelona"). The team_resolver alias system handles the mapping.

Rate limiting: ClubElo is hosted on a small server; be polite. We
default to 1.5s sleep between requests and cache responses for 24h.
"""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import httpx

from backend.services.data.team_resolver import TeamResolver
from backend.services.data.warehouse import Warehouse

logger = logging.getLogger(__name__)

CLUBELO_BASE = "http://api.clubelo.com"
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "clubelo"


@dataclass
class LoadStats:
    teams_fetched: int = 0
    ratings_written: int = 0
    teams_not_found: int = 0
    errors: int = 0


def _cache_path(team_name: str) -> Path:
    safe = "".join(c if c.isalnum() else "_" for c in team_name)
    return CACHE_DIR / f"{safe}.csv"


def _read_cached(team_name: str, max_age_seconds: int = 86_400) -> Optional[str]:
    path = _cache_path(team_name)
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > max_age_seconds:
        return None
    try:
        return path.read_text()
    except Exception:
        return None


def _write_cache(team_name: str, body: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        _cache_path(team_name).write_text(body)
    except Exception as exc:
        logger.debug("Failed to cache ClubElo %s: %s", team_name, exc)


def _parse_csv(body: str) -> List[Tuple[str, float]]:
    """Return list of (from_date, elo)."""
    out: List[Tuple[str, float]] = []
    reader = csv.DictReader(io.StringIO(body))
    for row in reader:
        try:
            d = row.get("From", "").strip()
            e = float(row.get("Elo", "0"))
            if d and e > 0:
                out.append((d, e))
        except (TypeError, ValueError):
            continue
    return out


def _team_url_name(canonical: str) -> str:
    """ClubElo uses single-word names with no spaces (e.g. 'Manchester' is ambiguous;
    they use 'ManUnited', 'ManCity', 'Barcelona', 'RealMadrid', etc.).

    We map our canonical_name to ClubElo's URL slug using a hand-curated
    table where the obvious capitalization-removal would be ambiguous;
    otherwise we just strip spaces.
    """
    overrides = {
        "Manchester United": "ManUnited",
        "Manchester City": "ManCity",
        "Real Madrid": "RealMadrid",
        "Real Sociedad": "Sociedad",
        "Atletico Madrid": "Atletico",
        "Athletic Bilbao": "Athletic",
        "Real Betis": "Betis",
        "Borussia Dortmund": "Dortmund",
        "Bayern Munich": "Bayern",
        "Bayer Leverkusen": "Leverkusen",
        "RB Leipzig": "RBLeipzig",
        "Eintracht Frankfurt": "Frankfurt",
        "Borussia Monchengladbach": "Gladbach",
        "VfB Stuttgart": "Stuttgart",
        "VfL Wolfsburg": "Wolfsburg",
        "Werder Bremen": "Werder",
        "Hoffenheim": "Hoffenheim",
        "AC Milan": "Milan",
        "Inter": "Inter",
        "Paris Saint-Germain": "Paris SG",
        "Marseille": "Marseille",
        "Lyon": "Lyon",
        "Saint-Etienne": "Saint Etienne",
        "Saint Etienne": "Saint Etienne",
        "PSV": "PSV",
        "Sporting CP": "Sporting",
        "Tottenham Hotspur": "Tottenham",
        "Newcastle United": "Newcastle",
        "West Ham United": "West Ham",
        "Aston Villa": "Aston Villa",
        "Brighton & Hove Albion": "Brighton",
        "Wolverhampton Wanderers": "Wolves",
        "Leeds United": "Leeds",
        "Nottingham Forest": "Forest",
        "Leicester City": "Leicester",
        "Crystal Palace": "Crystal Palace",
    }
    if canonical in overrides:
        return overrides[canonical]
    return canonical.replace(" ", "").replace(".", "").replace("'", "")


async def _fetch_team(
    client: httpx.AsyncClient,
    team_name: str,
    *,
    use_cache: bool = True,
) -> Optional[List[Tuple[str, float]]]:
    if use_cache:
        cached = _read_cached(team_name)
        if cached is not None:
            return _parse_csv(cached)

    slug = _team_url_name(team_name)
    url = f"{CLUBELO_BASE}/{slug}"
    try:
        resp = await client.get(url, timeout=20)
    except Exception as exc:
        logger.debug("ClubElo HTTP error %s: %s", url, exc)
        return None

    if resp.status_code != 200 or not resp.text:
        return None

    body = resp.text
    if "Club,Country,Level,Elo" not in body.split("\n", 1)[0]:
        # ClubElo returned a 404-like response with no real CSV header.
        return None

    _write_cache(team_name, body)
    return _parse_csv(body)


async def load_clubelo(
    warehouse: Warehouse,
    *,
    only_team_ids: Optional[Iterable[int]] = None,
    sleep_between_requests: float = 1.5,
    use_cache: bool = True,
) -> LoadStats:
    """Fetch ClubElo ratings for every men's team in the warehouse."""
    stats = LoadStats()
    # Discover men's teams to fetch.
    with warehouse._lock:  # noqa: SLF001
        cur = warehouse._conn.execute(  # noqa: SLF001
            "SELECT team_id, canonical_name FROM teams WHERE gender = 'M' ORDER BY team_id"
        )
        teams = cur.fetchall()

    only = set(only_team_ids) if only_team_ids is not None else None

    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor/4.0 (+research)"},
        follow_redirects=True,
    ) as client:
        for team in teams:
            if only is not None and team["team_id"] not in only:
                continue

            try:
                series = await _fetch_team(client, team["canonical_name"], use_cache=use_cache)
            except Exception as exc:
                logger.warning("ClubElo error for %s: %s", team["canonical_name"], exc)
                stats.errors += 1
                series = None

            stats.teams_fetched += 1

            if not series:
                stats.teams_not_found += 1
                # Polite even on a miss — they still served us a response.
                await asyncio.sleep(sleep_between_requests)
                continue

            rows = [(int(team["team_id"]), d, float(e)) for d, e in series]
            stats.ratings_written += warehouse.upsert_clubelo(rows)

            await asyncio.sleep(sleep_between_requests)

    return stats


def run(**kwargs) -> LoadStats:
    return asyncio.run(load_clubelo(**kwargs))


def latest_clubelo(warehouse: Warehouse, team_id: int, on_date: str) -> Optional[float]:
    """Return the most recent ClubElo rating known on/before `on_date`."""
    with warehouse._lock:  # noqa: SLF001
        cur = warehouse._conn.execute(  # noqa: SLF001
            """
            SELECT elo FROM clubelo_ratings
            WHERE team_id = ? AND date <= ?
            ORDER BY date DESC
            LIMIT 1
            """,
            (team_id, on_date),
        )
        row = cur.fetchone()
        return float(row["elo"]) if row else None
