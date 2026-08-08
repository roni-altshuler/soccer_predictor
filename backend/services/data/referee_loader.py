"""ESPN match-summary → `matches.referee_id`.

Why this exists
---------------
`referee_id` was populated for `eng.1` and nothing else. The obvious
suspect was the football-data loader, but football-data is not the
problem — it is the source. Checked across all 21 published seasons of
every league we ingest:

    league          seasons   with a `Referee` column
    E0  eng.1            21   21
    I1  ita.1            21    2   (2005-06, 2006-07 only)
    SP1 esp.1            21    0
    D1  ger.1            21    0
    F1  fra.1            21    0
    N1  ned.1            21    0
    P1  por.1            21    0

So La Liga, the Bundesliga, Ligue 1, the Eredivisie and the Primeira Liga
referee data **cannot** come from football-data at any price. It is not a
loader bug and no amount of parsing will produce it.

ESPN does publish it, but only on the per-match summary endpoint
(`/summary?event=<id>`), not on the scoreboard feed the ESPN loader uses:

    GET https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={id}
    → {"gameInfo": {"officials": [{"fullName": "Mario Melero López", ...}], ...}}

That is one request per match, so this is a slow loader and is opt-in.

Coverage ceiling — state this honestly when reporting
-----------------------------------------------------
Two hard limits stack, and together they make this a small win, not a fix:

1. The `event` id only exists for rows this warehouse sourced from ESPN
   (`match_id` like `espn_<league>_<id>`). Rows that came from
   football-data carry no ESPN id and cannot be enriched without first
   resolving each one to an ESPN fixture. That is ~10% of Wave A.
2. ESPN only populates `gameInfo.officials` from the **2022-23 season**
   onward. Probed one fixture per season per league on 2026-08-08: 2015
   through 2021 return `officials: null` every time; 2022 onward return a
   name. `MIN_SEASON_WITH_OFFICIALS` encodes this so the loader does not
   spend a request per match on years that cannot answer.

A referee feature built on this must treat every uncovered match as
genuinely missing, never as "no referee effect".
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx

from backend.services.data.warehouse import Warehouse

logger = logging.getLogger(__name__)

SUMMARY_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={event}"
)
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "espn_summary"

# espn_<competition>_<event id>
_MATCH_ID_RE = re.compile(r"^espn_(?P<competition>[^_]+)_(?P<event>\d+)$")

# ESPN backfilled officials only from 2022-23 onward; earlier summaries
# return `officials: null`. Measured, not assumed — see the docstring.
MIN_SEASON_WITH_OFFICIALS = 2022


@dataclass
class LoadStats:
    considered: int = 0
    fetched: int = 0
    from_cache: int = 0
    referees_set: int = 0
    no_officials: int = 0
    errors: int = 0
    referees_created: int = 0
    by_competition: Dict[str, int] = field(default_factory=dict)


def parse_match_id(match_id: str) -> Optional[Tuple[str, str]]:
    """'espn_ger.1_517847' → ('ger.1', '517847'); None for non-ESPN ids."""
    m = _MATCH_ID_RE.match(str(match_id or ""))
    if not m:
        return None
    return m.group("competition"), m.group("event")


def extract_referee(payload: Dict) -> Optional[str]:
    """Pull the head referee's name out of a summary payload.

    ESPN orders officials by `order`, 1 being the referee; assistants and
    the fourth official follow. We take order 1, falling back to the first
    entry. Returns None when ESPN has no officials for the match — which
    is common for older fixtures and must stay missing.
    """
    officials = ((payload or {}).get("gameInfo") or {}).get("officials")
    if not isinstance(officials, list) or not officials:
        return None
    ranked = sorted(
        (o for o in officials if isinstance(o, dict)),
        key=lambda o: o.get("order") if isinstance(o.get("order"), int) else 99,
    )
    for official in ranked:
        name = (official.get("fullName") or official.get("displayName") or "").strip()
        if name:
            return name
    return None


def _cache_path(competition: str, event: str) -> Path:
    return CACHE_DIR / f"{competition}_{event}.json"


async def _fetch_summary(
    client: httpx.AsyncClient, competition: str, event: str
) -> Tuple[Optional[Dict], bool]:
    """Returns (payload, came_from_cache). Finished matches never change,
    so the cache has no expiry."""
    path = _cache_path(competition, event)
    if path.exists():
        try:
            return json.loads(path.read_text()), True
        except Exception:
            pass
    try:
        resp = await client.get(SUMMARY_URL.format(league=competition, event=event), timeout=30)
    except Exception as exc:
        logger.debug("ESPN summary error %s/%s: %s", competition, event, exc)
        return None, False
    if resp.status_code != 200:
        return None, False
    try:
        payload = resp.json()
    except Exception:
        return None, False

    # Store only what we need; a full summary is ~1 MB and we want tens of
    # thousands of them to stay cheap on disk.
    trimmed = {"gameInfo": {"officials": ((payload.get("gameInfo") or {}).get("officials"))}}
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(json.dumps(trimmed))
    except Exception as exc:
        logger.debug("Failed to cache ESPN summary %s: %s", event, exc)
    return trimmed, False


async def load_referees(
    warehouse: Warehouse,
    *,
    competitions: Optional[Sequence[str]] = None,
    min_season: int = MIN_SEASON_WITH_OFFICIALS,
    limit: Optional[int] = None,
    sleep_between_requests: float = 0.25,
) -> LoadStats:
    """Fill `referee_id` for ESPN-sourced matches that do not have one.

    `min_season` defaults to the first season ESPN actually publishes
    officials for; pass 0 to attempt everything (it will spend one request
    per match to learn that older years have none).
    """
    stats = LoadStats()

    sql = """
        SELECT match_id, competition_id FROM matches
        WHERE referee_id IS NULL AND match_id LIKE 'espn\\_%' ESCAPE '\\'
    """
    args: List = []
    if min_season:
        sql += " AND season >= ?"
        args.append(min_season)
    if competitions:
        sql += " AND competition_id IN ({})".format(", ".join("?" * len(competitions)))
        args.extend(competitions)
    sql += " ORDER BY date_utc DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"

    with warehouse._lock:  # noqa: SLF001
        rows = warehouse._conn.execute(sql, args).fetchall()  # noqa: SLF001

    known_before = warehouse._conn.execute(  # noqa: SLF001
        "SELECT COUNT(*) AS n FROM referees"
    ).fetchone()["n"]
    logger.info("Referees: %d ESPN-sourced matches without one", len(rows))

    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor/4.0 (+research)"}, follow_redirects=True
    ) as client:
        for i, row in enumerate(rows, 1):
            stats.considered += 1
            parsed = parse_match_id(row["match_id"])
            if parsed is None:
                continue
            competition, event = parsed
            payload, cached = await _fetch_summary(client, competition, event)
            if payload is None:
                stats.errors += 1
                await asyncio.sleep(sleep_between_requests)
                continue
            stats.fetched += 1
            if cached:
                stats.from_cache += 1

            name = extract_referee(payload)
            if not name:
                stats.no_officials += 1
            else:
                referee_id = warehouse.upsert_referee(name)
                if referee_id is not None:
                    with warehouse._lock, warehouse._conn:  # noqa: SLF001
                        warehouse._conn.execute(  # noqa: SLF001
                            "UPDATE matches SET referee_id = ? WHERE match_id = ?",
                            (referee_id, row["match_id"]),
                        )
                    stats.referees_set += 1
                    stats.by_competition[row["competition_id"]] = (
                        stats.by_competition.get(row["competition_id"], 0) + 1
                    )
            if i % 250 == 0:
                logger.info("Referees: %d/%d, %d set", i, len(rows), stats.referees_set)
            if not cached:
                await asyncio.sleep(sleep_between_requests)

    stats.referees_created = warehouse._conn.execute(  # noqa: SLF001
        "SELECT COUNT(*) AS n FROM referees"
    ).fetchone()["n"] - known_before
    return stats


def run(**kwargs) -> LoadStats:
    return asyncio.run(load_referees(**kwargs))
