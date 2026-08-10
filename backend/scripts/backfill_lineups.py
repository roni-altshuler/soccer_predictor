"""Backfill historical starting XIs from ESPN into the warehouse.

Why
---
`lineups` and `player_form` are empty tables and always have been. That is not
a source limitation: ESPN serves a full roster block — 22 starters, bench,
formation, positions and per-player stats — on the match summary endpoint, and
it does so back to at least 2009. Probed 2026-08-10 across five leagues and six
seasons; every one returned 22 starters.

It stayed empty because `lineup_scraper.py` only ever looks at UPCOMING
fixtures, where a lineup appears about an hour before kickoff. Out of season it
finds nothing, the hourly workflow reports success, and no historical row is
ever written. A model cannot learn from team news it has never seen.

This is the one input the closing line has and the model does not.

Mapping, and why it does not use TeamResolver
---------------------------------------------
Only 4,410 of 38,693 completed Wave A matches came from ESPN; the rest are
football-data rows whose ids carry no ESPN event. So events are discovered from
the scoreboard and matched to warehouse fixtures on (competition, date within a
day, both club names).

The match is by NAME, but the rows written use the warehouse fixture's OWN
`home_team_id` / `away_team_id`. `TeamResolver.resolve()` creates a team when it
cannot find a good one, and a backfill that creates teams is exactly how this
warehouse ended up with 18,547 duplicate fixtures and clubs split in two. This
script cannot create a team, and cannot write a lineup for a fixture it did not
already find.

Integrity
---------
Nothing is stored unless BOTH sides field at least 11 starters. A partial
roster is worse than none: it silently reads as "this player did not start".
Coverage is recorded per match so re-runs skip completed work — the run is
resumable and idempotent.

    python3 -m backend.scripts.backfill_lineups --min-season 2015 --limit 500
    python3 -m backend.scripts.backfill_lineups --stats

Writes to `players`, `lineups`, `player_match_stats`, `lineup_coverage`.
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import httpx

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("backfill_lineups")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"

# site.web.api, never site.api — Akamai answers the latter with 403 from
# datacentre IPs and its error page carries no CORS headers. See CLAUDE.md.
ESPN = "https://site.web.api.espn.com/apis/site/v2/sports/soccer"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124 Safari/537.36"}

WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")

# Same noise list the integrity validator uses, for the same reason: providers
# differ on legal form and founding year but never on the place name. Words
# that actually NAME a club ('Real', 'Atletico', 'Athletic') are deliberately
# absent — strip them and Real Madrid and Atletico Madrid both become 'madrid'.
_NOISE = {
    "fc", "cf", "sc", "ac", "afc", "sv", "as", "rc", "cd", "ud", "gd",
    "aj", "sd", "club", "de", "del", "the", "ca", "rcd", "fsv", "tsg",
    "vfl", "vfb", "ssc", "ss", "us", "acf", "ogc", "losc", "sco", "spvgg",
}


def norm_tokens(name: str) -> Set[str]:
    nfkd = unicodedata.normalize("NFKD", name or "")
    ascii_only = "".join(c for c in nfkd if not unicodedata.combining(c)).lower()
    keep = "".join(c for c in ascii_only if c.isalnum() or c == " ")
    return {t for t in keep.split() if t not in _NOISE and not t.isdigit()}


def same_club(a: str, b: str) -> bool:
    ta, tb = norm_tokens(a), norm_tokens(b)
    if not ta or not tb:
        return False
    return ta == tb or ta < tb or tb < ta


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS lineup_coverage (
               match_id    TEXT PRIMARY KEY,
               source      TEXT NOT NULL,
               players     INTEGER NOT NULL,
               starters    INTEGER NOT NULL,
               formation_h TEXT,
               formation_a TEXT,
               verified_at TEXT NOT NULL
           )"""
    )
    conn.commit()


def target_matches(conn: sqlite3.Connection, comps: Sequence[str], min_season: int,
                   max_season: Optional[int]) -> List[sqlite3.Row]:
    ph = ", ".join("?" * len(comps))
    args: List = list(comps) + [min_season]
    extra = ""
    if max_season is not None:
        extra = " AND m.season <= ?"
        args.append(max_season)
    return conn.execute(
        f"""SELECT m.match_id, m.date_utc, m.season, m.competition_id,
                   m.home_team_id, m.away_team_id,
                   th.canonical_name AS home, ta.canonical_name AS away
            FROM matches m
            JOIN teams th ON th.team_id = m.home_team_id
            JOIN teams ta ON ta.team_id = m.away_team_id
            LEFT JOIN lineup_coverage lc ON lc.match_id = m.match_id
            WHERE m.competition_id IN ({ph})
              AND m.home_score IS NOT NULL
              AND m.season >= ?{extra}
              AND lc.match_id IS NULL
            ORDER BY m.date_utc""",
        args,
    ).fetchall()


class Espn:
    def __init__(self, delay: float = 0.4) -> None:
        self.cl = httpx.Client(timeout=30, headers=UA, follow_redirects=True)
        self.delay = delay
        self.calls = 0

    def get(self, url: str) -> Optional[dict]:
        for attempt in range(3):
            try:
                r = self.cl.get(url)
                self.calls += 1
                time.sleep(self.delay)
                if r.status_code == 200:
                    return r.json()
                if r.status_code in (429, 503):
                    time.sleep(2 ** attempt * 3)
                    continue
                return None
            except Exception as exc:  # noqa: BLE001
                logger.debug("GET %s failed (%s), retry %d", url, exc, attempt)
                time.sleep(2 ** attempt)
        return None

    def scoreboard_window(self, comp: str, start: str, end: str) -> List[dict]:
        d = self.get(f"{ESPN}/{comp}/scoreboard?dates={start}-{end}&limit=500")
        return (d or {}).get("events") or []

    def summary(self, comp: str, event_id: str) -> Optional[dict]:
        return self.get(f"{ESPN}/{comp}/summary?event={event_id}")

    def close(self) -> None:
        self.cl.close()


def index_events(espn: Espn, comp: str, dates: Iterable[str]) -> Dict[str, List[dict]]:
    """date (YYYY-MM-DD) -> ESPN events, discovered in monthly windows.

    One request per league-month rather than per fixture: a season is ~10 calls
    instead of ~380, and the same window serves every match inside it.
    """
    months = sorted({d[:7] for d in dates})
    by_date: Dict[str, List[dict]] = defaultdict(list)
    for ym in months:
        y, m = int(ym[:4]), int(ym[5:7])
        start = f"{y:04d}{m:02d}01"
        nxt = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=timezone.utc)
        end = (nxt - timedelta(days=1)).strftime("%Y%m%d")
        for ev in espn.scoreboard_window(comp, start, end):
            day = (ev.get("date") or "")[:10]
            if day:
                by_date[day].append(ev)
    return by_date


def event_teams(ev: dict) -> Tuple[Optional[str], Optional[str]]:
    comps = (ev.get("competitions") or [{}])[0].get("competitors") or []
    home = away = None
    for c in comps:
        t = c.get("team") or {}
        name = t.get("displayName") or t.get("name") or t.get("shortDisplayName")
        if c.get("homeAway") == "home":
            home = name
        elif c.get("homeAway") == "away":
            away = name
    return home, away


def find_event(by_date: Dict[str, List[dict]], row: sqlite3.Row) -> Optional[str]:
    """ESPN event id for a warehouse fixture, or None.

    A day either side is allowed because the two sources disagree on late
    kickoffs crossing midnight UTC. BOTH clubs must match — one is not enough,
    since a club can play twice in three days.
    """
    day = row["date_utc"][:10]
    base = datetime.strptime(day, "%Y-%m-%d")
    for delta in (0, -1, 1):
        key = (base + timedelta(days=delta)).strftime("%Y-%m-%d")
        for ev in by_date.get(key, []):
            eh, ea = event_teams(ev)
            if not eh or not ea:
                continue
            if same_club(eh, row["home"]) and same_club(ea, row["away"]):
                return str(ev.get("id"))
    return None


def parse_rosters(summary: dict) -> Optional[Dict[str, dict]]:
    """{'home': {...}, 'away': {...}} with players and formation, or None."""
    rosters = summary.get("rosters") or []
    if len(rosters) != 2:
        return None
    out: Dict[str, dict] = {}
    for side in rosters:
        ha = side.get("homeAway")
        if ha not in ("home", "away"):
            return None
        players = []
        for entry in side.get("roster") or []:
            ath = entry.get("athlete") or {}
            name = ath.get("displayName") or ath.get("fullName")
            if not name:
                continue
            pos = ((entry.get("position") or {}).get("abbreviation")
                   or (ath.get("position") or {}).get("abbreviation"))
            players.append({
                "name": name,
                "starter": bool(entry.get("starter")),
                "position": pos,
                "formation_place": entry.get("formationPlace"),
                "stats": entry.get("stats") or [],
                "subbed_in": entry.get("subbedIn"),
                "subbed_out": entry.get("subbedOut"),
            })
        out[ha] = {"players": players, "formation": side.get("formation")}
    return out if len(out) == 2 else None


def upsert_player(conn: sqlite3.Connection, name: str, team_id: int,
                  position: Optional[str], cache: Dict[Tuple[str, int], int]) -> int:
    key = (name, team_id)
    if key in cache:
        return cache[key]
    row = conn.execute(
        "SELECT player_id FROM players WHERE name = ? AND gender = 'M' AND current_team_id = ?",
        (name, team_id),
    ).fetchone()
    if row:
        cache[key] = int(row[0])
        return cache[key]
    cur = conn.execute(
        "INSERT INTO players (name, position, current_team_id, gender) VALUES (?, ?, ?, 'M')",
        (name, position, team_id),
    )
    cache[key] = int(cur.lastrowid)
    return cache[key]


# ESPN's own names, read off a real payload rather than guessed: goals are
# `totalGoals` not `goals`, assists are `goalAssists`, shots are `totalShots`.
# Minutes are not published per player at all, so that column stays NULL rather
# than being filled with a plausible 90.
_STAT_KEYS = {"totalGoals": "goals", "goalAssists": "assists",
              "totalShots": "shots", "shotsOnTarget": "sot"}


def stat_map(stats: Sequence[dict]) -> Dict[str, Optional[int]]:
    out: Dict[str, Optional[int]] = {}
    for s in stats or []:
        k = _STAT_KEYS.get(s.get("name") or "")
        if not k:
            continue
        try:
            out[k] = int(float(s.get("value") if s.get("value") is not None else s.get("displayValue")))
        except (TypeError, ValueError):
            continue
    return out


def store(conn: sqlite3.Connection, row: sqlite3.Row, parsed: Dict[str, dict],
          cache: Dict[Tuple[str, int], int]) -> Tuple[int, int]:
    sides = (("home", int(row["home_team_id"])), ("away", int(row["away_team_id"])))
    n_players = n_starters = 0
    for ha, team_id in sides:
        for p in parsed[ha]["players"]:
            pid = upsert_player(conn, p["name"], team_id, p["position"], cache)
            conn.execute(
                """INSERT OR REPLACE INTO lineups
                   (match_id, team_id, player_id, is_starter, formation_role)
                   VALUES (?, ?, ?, ?, ?)""",
                (row["match_id"], team_id, pid, 1 if p["starter"] else 0,
                 str(p["formation_place"]) if p["formation_place"] is not None else p["position"]),
            )
            st = stat_map(p["stats"])
            if st:
                conn.execute(
                    """INSERT OR REPLACE INTO player_match_stats
                       (match_id, player_id, team_id, minutes, goals, assists, shots, sot)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (row["match_id"], pid, team_id, st.get("minutes"), st.get("goals", 0),
                     st.get("assists", 0), st.get("shots"), st.get("sot")),
                )
            n_players += 1
            n_starters += int(p["starter"])
    conn.execute(
        """INSERT OR REPLACE INTO lineup_coverage
           (match_id, source, players, starters, formation_h, formation_a, verified_at)
           VALUES (?, 'espn', ?, ?, ?, ?, ?)""",
        (row["match_id"], n_players, n_starters,
         parsed["home"].get("formation"), parsed["away"].get("formation"),
         datetime.now(timezone.utc).isoformat()),
    )
    return n_players, n_starters


def print_stats(conn: sqlite3.Connection) -> None:
    q = lambda s: conn.execute(s).fetchone()[0]  # noqa: E731
    print(f"lineups rows          : {q('SELECT COUNT(*) FROM lineups'):,}")
    print(f"players               : {q('SELECT COUNT(*) FROM players'):,}")
    print(f"player_match_stats    : {q('SELECT COUNT(*) FROM player_match_stats'):,}")
    try:
        print(f"matches with lineups  : {q('SELECT COUNT(*) FROM lineup_coverage'):,}")
    except sqlite3.OperationalError:
        print("matches with lineups  : 0 (no coverage table yet)")
        return
    print("\nby season:")
    for r in conn.execute(
        """SELECT m.season, m.competition_id, COUNT(*) n
           FROM lineup_coverage lc JOIN matches m ON m.match_id = lc.match_id
           GROUP BY m.season, m.competition_id ORDER BY m.season, m.competition_id"""
    ):
        print(f"  {r[0]} {r[1]}: {r[2]}")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=Path, default=DB)
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--min-season", type=int, default=2015)
    ap.add_argument("--max-season", type=int, default=None)
    ap.add_argument("--limit", type=int, default=None, help="max matches to store this run")
    ap.add_argument("--delay", type=float, default=0.4, help="seconds between ESPN calls")
    ap.add_argument("--stats", action="store_true", help="report coverage and exit")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)s %(message)s")
    if not args.db.exists():
        logger.error("warehouse not found at %s", args.db)
        return 2

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema(conn)

    if args.stats:
        print_stats(conn)
        return 0

    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]
    todo = target_matches(conn, comps, args.min_season, args.max_season)
    logger.info("%d completed matches without lineups", len(todo))
    if not todo:
        return 0

    espn = Espn(delay=args.delay)
    cache: Dict[Tuple[str, int], int] = {}
    stored = unmatched = rejected = 0
    try:
        by_comp: Dict[str, List[sqlite3.Row]] = defaultdict(list)
        for r in todo:
            by_comp[r["competition_id"]].append(r)

        for comp, rows in by_comp.items():
            logger.info("%s: %d matches", comp, len(rows))
            index = index_events(espn, comp, [r["date_utc"] for r in rows])
            logger.info("  %s: indexed %d match-days from the scoreboard", comp, len(index))

            for row in rows:
                if args.limit is not None and stored >= args.limit:
                    break
                ev = find_event(index, row)
                if ev is None:
                    unmatched += 1
                    logger.debug("no ESPN event for %s %s v %s",
                                 row["date_utc"][:10], row["home"], row["away"])
                    continue
                summary = espn.summary(comp, ev)
                parsed = parse_rosters(summary or {})
                if parsed is None:
                    rejected += 1
                    continue
                starters = {ha: sum(1 for p in parsed[ha]["players"] if p["starter"])
                            for ha in ("home", "away")}
                # A partial roster reads as "did not start" for everyone missing,
                # which is a fabricated observation. Refuse it.
                if min(starters.values()) < 11:
                    rejected += 1
                    logger.debug("partial roster for %s (%s) — not stored",
                                 row["match_id"], starters)
                    continue
                if args.dry_run:
                    stored += 1
                    continue
                n, s = store(conn, row, parsed, cache)
                conn.commit()
                stored += 1
                if stored % 25 == 0:
                    logger.info("  stored %d (last: %s %s v %s, %d players)",
                                stored, row["date_utc"][:10], row["home"], row["away"], n)
            if args.limit is not None and stored >= args.limit:
                break
    finally:
        espn.close()
        conn.commit()

    logger.info("done. stored=%d unmatched=%d rejected=%d espn_calls=%d",
                stored, unmatched, rejected, espn.calls)
    print()
    print_stats(conn)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
