"""Fold the FBref landing zone into the warehouse, without creating a team.

The rule this script exists to obey
-----------------------------------
`TeamResolver.resolve()` creates a team when it cannot confidently match one.
A loader that is allowed to do that is how this warehouse ended up with 18,547
duplicate fixtures, 60 of 77 league-seasons carrying the wrong team count, and
Dortmund "winning" the 2018-19 Bundesliga because a 7-0 was counted twice.

So this loader **cannot create a team and cannot create a fixture**. It matches
FBref rows onto fixtures that already exist — by competition, by date within a
day, and by both club names normalising to the same tokens — and if it cannot
find one, it counts that as unmatched and moves on. A row it cannot place is
reported, never invented.

What it fills
-------------
NULLs only. An existing value is never overwritten, because the warehouse's
own sources (ESPN kickoff times, football-data odds) are not improved by being
replaced with a second opinion.

The gap that motivated this is referees. CLAUDE.md records non-English referee
coverage at 0.8-1.8% and calls it a source limitation:

    eng.1  98.9%    esp.1  0.0%    ger.1  0.0%
    ita.1   9.2%    fra.1  0.0%

FBref carries the referee on the schedule page for 94% of the rows scraped so
far. It is not a source limitation; it is a column nobody had read yet. That
makes the referee feature group testable outside England for the first time —
which is worth something regardless of which way the ablation lands, because
"untestable" and "no effect" are different answers.

    python3 -m backend.scripts.load_fbref_to_warehouse --dry-run
    python3 -m backend.scripts.load_fbref_to_warehouse --competitions wave-a

Updates `matches` (referee_id, home_xg, away_xg, attendance, venue).
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("load_fbref_to_warehouse")

WAREHOUSE = ROOT / "backend" / "data" / "warehouse.sqlite"
FBREF = ROOT / "backend" / "data" / "fbref.sqlite"

# FBref league name -> warehouse competition_id. Only competitions the
# warehouse ALREADY has: this script never registers a new one, because a new
# competition needs new teams and creating teams is the thing it must not do.
LEAGUE_MAP: Dict[str, str] = {
    "England Premier League": "eng.1",
    "Spain La Liga": "esp.1",
    "Germany Bundesliga": "ger.1",
    "Italy Serie A": "ita.1",
    "France Ligue 1": "fra.1",
    "Netherlands Eredivisie": "ned.1",
    "Portugal Primeira Liga": "por.1",
    "USA MLS": "usa.1",
    "USA NWSL": "usa.1.w",
    "England WSL": "eng.1.w",
    "UEFA Champions League": "uefa.champions",
    "UEFA Europa League": "uefa.europa",
    "UEFA Conference League": "uefa.conference",
    "UEFA Womens Champions League": "uefa.champions.w",
    "UEFA European Championship": "uefa.euro",
    "UEFA Womens European Championship": "uefa.euro.w",
    "FIFA World Cup": "fifa.world",
    "FIFA Womens World Cup": "fifa.world.w",
    "CONMEBOL Copa America": "conmebol.america",
    "CONMEBOL Copa Libertadores": "conmebol.libertadores",
}
WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")

# Same list the integrity validator uses, for the same reason: providers
# differ on legal form, never on the place name. Words that actually NAME a
# club ('Real', 'Atletico', 'Athletic') are deliberately absent.
_NOISE = {
    "fc", "cf", "sc", "ac", "afc", "sv", "as", "rc", "cd", "ud", "gd",
    "aj", "sd", "club", "de", "del", "the", "ca", "rcd", "fsv", "tsg",
    "vfl", "vfb", "ssc", "ss", "us", "acf", "ogc", "losc", "sco", "spvgg",
}


def norm(name: str) -> frozenset:
    nfkd = unicodedata.normalize("NFKD", name or "")
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c)).lower()
    keep = "".join(c for c in ascii_only if c.isalnum() or c == " ")
    return frozenset(t for t in keep.split() if t not in _NOISE and not t.isdigit())


def parse_date(value: Optional[str]) -> Optional[str]:
    """FBref writes ISO on schedule pages ('2024-08-16'); tolerate the long
    form ('Saturday November 23, 2024') that match pages use."""
    if not value:
        return None
    v = value.strip()
    for fmt in ("%Y-%m-%d", "%A %B %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(v, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return v[:10] if len(v) >= 10 and v[4] == "-" else None


def build_index(conn: sqlite3.Connection, comps: Sequence[str]) -> Dict:
    """(competition, date) -> list of (match_id, home_tokens, away_tokens, row)."""
    ph = ",".join("?" * len(comps))
    idx: Dict[Tuple[str, str], List] = defaultdict(list)
    sql = f"""
        SELECT m.match_id, m.competition_id, substr(m.date_utc,1,10) AS d,
               th.canonical_name AS home, ta.canonical_name AS away,
               m.referee_id, m.home_xg, m.away_xg, m.attendance, m.venue
          FROM matches m
          JOIN teams th ON th.team_id = m.home_team_id
          JOIN teams ta ON ta.team_id = m.away_team_id
         WHERE m.competition_id IN ({ph}) AND m.home_score IS NOT NULL
    """
    for r in conn.execute(sql, list(comps)):
        idx[(r["competition_id"], r["d"])].append(
            (r["match_id"], norm(r["home"]), norm(r["away"]), r))
    return idx


def find(idx: Dict, comp: str, date: str, home: frozenset,
         away: frozenset) -> Optional[Tuple]:
    """Same competition, same clubs, within a day.

    The +/- 1 day window is not slack: FBref stores the local calendar date and
    the warehouse stores a UTC timestamp, so a 20:00 kickoff in Buenos Aires
    and a late kick-off in Europe legitimately land on different dates.
    """
    base = datetime.strptime(date, "%Y-%m-%d")
    for delta in (0, 1, -1):
        day = (base + timedelta(days=delta)).strftime("%Y-%m-%d")
        for match_id, h, a, row in idx.get((comp, day), ()):
            if not h or not a:
                continue
            # Subset either way: 'Manchester Utd' vs 'Manchester United'.
            if ((h <= home or home <= h) and (a <= away or away <= a)):
                return match_id, row
    return None


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", default="all",
                    help="'all', 'wave-a', or comma-separated warehouse ids")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not FBREF.exists():
        logger.error("no %s — run ingest_fbref_schedules first", FBREF)
        return 1

    if args.competitions == "all":
        wanted = set(LEAGUE_MAP.values())
    elif args.competitions == "wave-a":
        wanted = set(WAVE_A)
    else:
        wanted = {c.strip() for c in args.competitions.split(",") if c.strip()}

    fb = sqlite3.connect(f"file:{FBREF}?mode=ro", uri=True)
    fb.row_factory = sqlite3.Row
    wh = sqlite3.connect(WAREHOUSE)
    wh.row_factory = sqlite3.Row
    wh.execute("PRAGMA busy_timeout=60000")

    have = {r[0] for r in wh.execute("SELECT competition_id FROM competitions")}
    comps = sorted(wanted & have)
    if not comps:
        logger.error("none of %s are in the warehouse", sorted(wanted))
        return 1
    logger.info("competitions: %s", ", ".join(comps))

    idx = build_index(wh, comps)
    logger.info("indexed %d warehouse fixtures",
                sum(len(v) for v in idx.values()))

    referees: Dict[str, Optional[int]] = {}

    def referee_id(name: str) -> Optional[int]:
        if name not in referees:
            wh.execute("INSERT OR IGNORE INTO referees(name) VALUES (?)", (name,))
            row = wh.execute("SELECT referee_id FROM referees WHERE name = ?",
                             (name,)).fetchone()
            referees[name] = int(row[0]) if row else None
        return referees[name]

    matched = unmatched = 0
    filled = defaultdict(int)
    unmatched_by_league: Dict[str, int] = defaultdict(int)

    for row in fb.execute("SELECT * FROM fbref_fixtures WHERE home_goals IS NOT NULL"):
        comp = LEAGUE_MAP.get(row["league"])
        if comp not in comps:
            continue
        date = parse_date(row["date"])
        if not date:
            continue
        hit = find(idx, comp, date, norm(row["home"]), norm(row["away"]))
        if not hit:
            unmatched += 1
            unmatched_by_league[row["league"]] += 1
            continue
        match_id, existing = hit
        matched += 1

        sets, params = [], []
        if existing["referee_id"] is None and row["referee"]:
            rid = referee_id(row["referee"].strip())
            if rid is not None:
                sets.append("referee_id = ?")
                params.append(rid)
                filled["referee"] += 1
        for col, src in (("home_xg", "home_xg"), ("away_xg", "away_xg"),
                         ("attendance", "attendance"), ("venue", "venue")):
            if existing[col] is None and row[src] is not None:
                sets.append(f"{col} = ?")
                params.append(row[src])
                filled[col] += 1
        if sets and not args.dry_run:
            params.append(match_id)
            wh.execute(f"UPDATE matches SET {', '.join(sets)} WHERE match_id = ?",
                       params)

    if not args.dry_run:
        wh.commit()

    logger.info("\nmatched %d FBref rows onto warehouse fixtures, %d unmatched",
                matched, unmatched)
    for k, v in sorted(filled.items(), key=lambda kv: -kv[1]):
        logger.info("  filled %-12s %6d", k, v)
    if unmatched_by_league:
        logger.info("unmatched by league (a row this loader refused to invent):")
        for k, v in sorted(unmatched_by_league.items(), key=lambda kv: -kv[1])[:12]:
            logger.info("  %-34s %6d", k, v)

    logger.info("\nreferee coverage now:")
    for comp in comps:
        n, r = wh.execute(
            "SELECT COUNT(*), SUM(referee_id IS NOT NULL) FROM matches "
            "WHERE competition_id = ? AND home_score IS NOT NULL", (comp,)).fetchone()
        if n:
            logger.info("  %-22s %6d matches, %6d with a referee (%.1f%%)",
                        comp, n, r or 0, 100.0 * (r or 0) / n)
    if args.dry_run:
        logger.info("\n(dry run — nothing written)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
