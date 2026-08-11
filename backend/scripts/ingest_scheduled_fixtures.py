"""Ingest tournament fixtures that have been DRAWN but not yet played.

Why this exists
---------------
Everything else in this repo ingests results. That is the right default —
`matches` has held zero null-score rows for the life of the project, and every
consumer (Elo, Dixon-Coles, the feature builder, the integrity checker) reads a
row there as a fact about something that happened.

But a forward forecast needs the opposite thing. On 2026-08-11 the Copa
Libertadores round of 16 was drawn and its first leg kicked off that evening:
sixteen fixtures, real teams on both sides, none of them played. That is the
only state in which a title forecast is a forecast rather than a report, and
the warehouse had no way to represent it.

So drawn-but-unplayed fixtures land in their own table, `scheduled_matches`,
which this script owns the way `backfill_knockout_results` owns
`knockout_results`. `matches` stays results-only.

Two guards that are not optional
--------------------------------
1. **Placeholders are refused.** ESPN publishes future rounds with competitors
   like "Winner Match 12" or "TBD" before the draw. Resolving those through
   `TeamResolver` would mint permanent junk clubs in `teams` that every later
   fuzzy match then has to compete with. Anything matching `_PLACEHOLDER` is
   skipped and counted.
2. **A played fixture is deleted, not kept.** Once the result lands in
   `matches` the scheduled row is stale, and a stale row would let the
   forecaster present a finished tie as upcoming. Every run purges rows whose
   `match_id` now exists in `matches`, and readers exclude them again in SQL.

    python3 -m backend.scripts.ingest_scheduled_fixtures --all
    python3 -m backend.scripts.ingest_scheduled_fixtures --competitions conmebol.libertadores

Writes to `scheduled_matches`.
"""
from __future__ import annotations

import argparse
import logging
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.ingest_tournaments import ESPN, UA, TOURNAMENTS  # noqa: E402
from backend.services.data.team_resolver import TeamResolver  # noqa: E402
from backend.services.data.warehouse import Warehouse  # noqa: E402

logger = logging.getLogger("ingest_scheduled_fixtures")

DDL = """
CREATE TABLE IF NOT EXISTS scheduled_matches (
    match_id       TEXT PRIMARY KEY,
    source         TEXT NOT NULL,
    competition_id TEXT NOT NULL,
    season         INTEGER NOT NULL,
    date_utc       TEXT NOT NULL,
    phase          TEXT,
    home_team_id   INTEGER NOT NULL REFERENCES teams(team_id),
    away_team_id   INTEGER NOT NULL REFERENCES teams(team_id),
    state          TEXT NOT NULL,
    fetched_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_comp
    ON scheduled_matches(competition_id, season, date_utc);
"""

# A name that describes a bracket SLOT rather than a club. "Winner Match 12",
# "TBD", "Runner-up Group C", "Group A 2nd Place", "Best 3rd Place".
#
# The last two patterns were added after the first run: the AFC Asian Cup 2027
# knockout is published with slot names, `TeamResolver` fuzzy-matched every
# "Group X 2nd Place" onto a single invented club, and the result was a tie
# whose two sides were the same team. One junk row in `teams` is permanent and
# competes with every later fuzzy match, so this list errs toward refusing.
_PLACEHOLDER = re.compile(
    r"^\s*(tbd|tba|bye|to be (confirmed|determined))\s*$|"
    r"\b(winner|loser|runner[- ]?up|vencedor|perdedor|ganador|sieger|vainqueur)\b|"
    r"\b(1st|2nd|3rd|4th|first|second|third|fourth|best)\b.*\bplace\b|"
    r"\bplace\b.*\b(group|grupo)\b|"
    r"\b(group|grupo|match|partido|game)\s+[a-z0-9]+\b",
    re.IGNORECASE,
)


def is_placeholder(name: str) -> bool:
    return bool(_PLACEHOLDER.search(name or "")) or not (name or "").strip()


def _iso(date: str) -> str:
    """ESPN's '2026-08-11T23:30Z' -> full ISO-8601 with an offset."""
    if date.endswith("Z"):
        return date[:-1] + (":00+00:00" if len(date) == 17 else "+00:00")
    return date


def windows(months_ahead: int) -> List[Tuple[str, str]]:
    """Quarterly windows from today. ESPN's scoreboard silently caps at 100
    events without an explicit limit and truncates long spans even with one."""
    today = datetime.now(timezone.utc).date()
    out = []
    start = today
    while start < today + timedelta(days=31 * months_ahead):
        end = start + timedelta(days=90)
        out.append((start.strftime("%Y%m%d"), end.strftime("%Y%m%d")))
        start = end + timedelta(days=1)
    return out


def fetch_scheduled(client: httpx.Client, slug: str,
                    months_ahead: int) -> List[dict]:
    events: Dict[str, dict] = {}
    for lo, hi in windows(months_ahead):
        try:
            r = client.get(f"{ESPN}/{slug}/scoreboard",
                           params={"dates": f"{lo}-{hi}", "limit": 500})
            r.raise_for_status()
            for ev in r.json().get("events") or []:
                comp = (ev.get("competitions") or [{}])[0]
                status = ((comp.get("status") or {}).get("type") or {})
                if status.get("completed"):
                    continue
                if ev.get("id"):
                    events[str(ev["id"])] = ev
        except Exception as exc:  # noqa: BLE001
            logger.debug("  %s %s-%s failed: %s", slug, lo, hi, exc)
        time.sleep(0.2)
    return list(events.values())


def parse(event: dict, competition_id: str, resolver: Optional[TeamResolver],
          gender: str) -> Optional[Tuple]:
    """`resolver=None` parses without touching `teams` — `TeamResolver.resolve`
    CREATES a club when it cannot match one, which a dry run must not do."""
    comps = event.get("competitions") or []
    if not comps:
        return None
    comp = comps[0]
    sides = {c.get("homeAway"): c for c in comp.get("competitors") or []}
    home, away = sides.get("home"), sides.get("away")
    if not home or not away:
        return None
    hname = (home.get("team") or {}).get("displayName")
    aname = (away.get("team") or {}).get("displayName")
    if is_placeholder(hname) or is_placeholder(aname):
        return ("placeholder", hname, aname)

    season = (event.get("season") or {}).get("year")
    date = event.get("date")
    if season is None or not date:
        return None
    state = ((comp.get("status") or {}).get("type") or {}).get("state", "pre")
    if resolver is None:
        return ("dry-run", hname, aname)

    hid = resolver.resolve(hname, gender=gender).team_id
    aid = resolver.resolve(aname, gender=gender).team_id
    if hid == aid:
        # Two different upstream names collapsed onto one club. Always a
        # resolver artefact — a team cannot play itself — and a self-tie would
        # sail through the bracket as a guaranteed advance.
        return ("placeholder", hname, aname)

    return (
        f"espn_{competition_id}_{event.get('id')}", "espn", competition_id,
        int(season), _iso(date), (event.get("season") or {}).get("slug"),
        hid, aid, state, datetime.now(timezone.utc).isoformat(),
    )


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", help="comma-separated warehouse ids")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--months-ahead", type=int, default=18)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                        datefmt="%H:%M:%S")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    by_id = {t.competition_id: t for t in TOURNAMENTS}
    if args.competitions:
        wanted = [by_id[c.strip()] for c in args.competitions.split(",") if c.strip()]
    elif args.all:
        wanted = list(TOURNAMENTS)
    else:
        ap.error("pass --competitions or --all")

    wh = Warehouse()
    wh.migrate()
    conn: sqlite3.Connection = wh._conn  # noqa: SLF001 — same pattern as backfill
    for stmt in DDL.strip().split(";"):
        if stmt.strip():
            conn.execute(stmt)
    resolver = None if args.dry_run else TeamResolver(wh, gender_default="M")

    total = placeholders = 0
    with httpx.Client(headers=UA, timeout=30.0) as client:
        for t in wanted:
            events = fetch_scheduled(client, t.espn, args.months_ahead)
            rows, skipped = [], 0
            for ev in events:
                parsed = parse(ev, t.competition_id, resolver, t.gender)
                if parsed is None:
                    continue
                if parsed[0] == "placeholder":
                    skipped += 1
                    logger.debug("  placeholder: %s vs %s", parsed[1], parsed[2])
                    continue
                rows.append(parsed)
            placeholders += skipped
            if rows and not args.dry_run:
                conn.executemany(
                    "INSERT OR REPLACE INTO scheduled_matches "
                    "(match_id, source, competition_id, season, date_utc, phase, "
                    " home_team_id, away_team_id, state, fetched_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
                conn.commit()
            total += len(rows)
            if rows or skipped:
                logger.info("%-24s %3d scheduled  (%d placeholder%s skipped)",
                            t.competition_id, len(rows), skipped,
                            "" if skipped == 1 else "s")

    if not args.dry_run:
        # A fixture that has been played is no longer scheduled. Leaving the
        # row would let the forecaster present a decided tie as upcoming.
        purged = conn.execute(
            "DELETE FROM scheduled_matches WHERE match_id IN "
            "(SELECT match_id FROM matches)").rowcount
        # And one that never resolved: past its kickoff, still no result, and
        # ESPN has stopped listing it. Two weeks is longer than any postponement
        # this layer cares about.
        cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        stale = conn.execute(
            "DELETE FROM scheduled_matches WHERE date_utc < ?", (cutoff,)).rowcount
        conn.commit()
        logger.info("purged %d played, %d stale", purged, stale)

    if resolver.near_duplicates:
        logger.warning("%d near-duplicate team names created — check "
                       "team_aliases.yml:", len(resolver.near_duplicates))
        for new, existing, score in resolver.near_duplicates[:25]:
            logger.warning("   %-32s ~ %-32s %.2f", new, existing, score)

    logger.info("wrote %d scheduled fixtures, refused %d placeholders",
                total, placeholders)
    wh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
