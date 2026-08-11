"""Every league FBref covers, every season it has, one request per season.

The arithmetic that makes this possible
---------------------------------------
Scraping FBref match-by-match costs about 8.6 seconds a page. "All 39 leagues
back to the start" is on the order of a million matches, which at that rate is
measured in decades and is not a plan.

But a season's *Scores-and-Fixtures* page carries the whole schedule in a
single table: date, home, away, score, both xG columns, attendance, venue and
the referee. One request per LEAGUE-SEASON, not per match. FBref's history
pages list roughly 1,500 league-seasons across the 39 competitions, so the
whole thing is a few hours rather than a few decades.

That is the tier this script covers, and it is the tier that answers "train on
everything". Shot-level data and the full officials crew still need the match
page and still cost 8.6s each, so those stay scoped to seasons where FBref
actually has them (2017-18 onward for the big five) — `ingest_fbref.py`.

Discipline
----------
Resumable per league-season: a run that dies at league 30 restarts at league
30. Raw HTML is cached to disk by `FBrefClient`, so fixing a parser bug costs a
re-parse and not a re-scrape.

Nothing here writes to `warehouse.sqlite`. Three workflows overwrite that file
from a release asset, and a scrape measured in hours must not hold its write
lock — the first version of this pipeline died with "database is locked" while
the tournament backfill was mid-run. The scraper owns `fbref.sqlite`; folding
it into the warehouse is a separate, re-runnable step.

    backend/scripts/run_fbref_scrape.sh --schedules --all
    python3 -m backend.scripts.ingest_fbref_schedules --leagues "England Premier League"
    python3 -m backend.scripts.ingest_fbref_schedules --stats

Writes to `fbref_seasons`, `fbref_fixtures`.
"""
from __future__ import annotations

import argparse
import logging
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.fbref.client import FBrefClient  # noqa: E402

logger = logging.getLogger("ingest_fbref_schedules")

DB = ROOT / "backend" / "data" / "fbref.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS fbref_seasons (
    league      TEXT NOT NULL,
    season      TEXT NOT NULL,          -- FBref's own label, e.g. "2024-2025"
    stats_url   TEXT NOT NULL,
    schedule_url TEXT,
    fixtures    INTEGER,
    scraped_at  TEXT,
    error       TEXT,
    PRIMARY KEY (league, season)
);

CREATE TABLE IF NOT EXISTS fbref_fixtures (
    league      TEXT NOT NULL,
    season      TEXT NOT NULL,
    row_key     TEXT NOT NULL,          -- match url when present, else a digest
    match_url   TEXT,
    date        TEXT,
    round       TEXT,
    day         TEXT,
    time        TEXT,
    home        TEXT,
    away        TEXT,
    home_goals  INTEGER,
    away_goals  INTEGER,
    home_xg     REAL,
    away_xg     REAL,
    attendance  INTEGER,
    venue       TEXT,
    referee     TEXT,
    PRIMARY KEY (league, season, row_key)
);
CREATE INDEX IF NOT EXISTS idx_fbref_fixtures_season
    ON fbref_fixtures(league, season);
CREATE INDEX IF NOT EXISTS idx_fbref_fixtures_date ON fbref_fixtures(date);
"""

# `data-stat` attributes are FBref's own machine names and are far stabler
# than the visible headers, which change wording between eras.
FIELDS = {
    "date": "date", "round": "round", "day": "dayofweek", "time": "start_time",
    "home": "home_team", "away": "away_team", "venue": "venue",
    "referee": "referee", "attendance": "attendance",
    "home_xg": "home_xg", "away_xg": "away_xg",
}

_SCORE = re.compile(r"^\s*(\d+)\s*[-–—]\s*(\d+)\s*$")


def _txt(cell) -> Optional[str]:
    if cell is None:
        return None
    s = cell.get_text(" ", strip=True)
    return s or None


def _num(cell, cast):
    s = _txt(cell)
    if not s:
        return None
    s = s.replace(",", "")
    try:
        return cast(s)
    except ValueError:
        return None


def parse_schedule(soup, league: str, season: str) -> List[Tuple]:
    """Rows from the Scores-and-Fixtures table.

    The table id varies by competition ("sched_2024-2025_9_1", "sched_all"),
    so it is found by shape — a table containing `td[data-stat=score]` — which
    holds across every era FBref publishes.
    """
    table = None
    for t in soup.find_all("table"):
        if t.find("td", {"data-stat": "score"}) or t.find("th", {"data-stat": "score"}):
            table = t
            break
    if table is None:
        return []

    out: List[Tuple] = []
    for tr in table.find_all("tr"):
        # FBref repeats the header every ~25 rows. Those rows carry NO class —
        # they sit inside a <thead>. Filtering on class alone let one through
        # per season and stored a fixture literally called "Home vs Away".
        if tr.find_parent("thead") is not None:
            continue
        if tr.get("class") and "thead" in tr.get("class"):
            continue
        cells = {}
        for cell in tr.find_all(["td", "th"]):
            stat = cell.get("data-stat")
            if stat:
                cells[stat] = cell
        if "score" not in cells and "home_team" not in cells:
            continue

        home = _txt(cells.get("home_team"))
        away = _txt(cells.get("away_team"))
        if not home or not away:
            continue

        hg = ag = None
        score_cell = cells.get("score")
        m = _SCORE.match(_txt(score_cell) or "")
        if m:
            hg, ag = int(m.group(1)), int(m.group(2))

        link = score_cell.find("a") if score_cell else None
        match_url = ("https://fbref.com" + link["href"]) if link and link.get("href") else None
        date = _txt(cells.get("date"))
        row_key = match_url or f"{date}|{home}|{away}"

        out.append((
            league, season, row_key, match_url, date,
            _txt(cells.get("round")) or _txt(cells.get("gameweek")),
            _txt(cells.get("dayofweek")),
            _txt(cells.get("start_time")), home, away, hg, ag,
            _num(cells.get("home_xg") or cells.get("xg_home") or cells.get("xg_a"), float),
            _num(cells.get("away_xg") or cells.get("xg_away") or cells.get("xg_b"), float),
            _num(cells.get("attendance"), int),
            _txt(cells.get("venue")), _txt(cells.get("referee")),
        ))
    return out


def schedule_url(stats_url: str) -> str:
    """.../2024-2025/2024-2025-Premier-League-Stats
       -> .../2024-2025/schedule/2024-2025-Premier-League-Scores-and-Fixtures"""
    parts = stats_url.split("/")
    parts.insert(-1, "schedule")
    return "/".join(parts).replace("Stats", "Scores-and-Fixtures")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", help="comma-separated FBref league names; default all")
    ap.add_argument("--since", type=int, help="skip seasons starting before this year")
    ap.add_argument("--limit", type=int, help="stop after N league-seasons")
    ap.add_argument("--refresh", action="store_true", help="ignore the HTML cache")
    ap.add_argument("--stale-days", type=float, default=3.0,
                    help="re-scrape an UNFINISHED season older than this many "
                         "days; finished seasons are never re-scraped")
    ap.add_argument("--reparse", action="store_true",
                    help="rebuild fixtures from CACHED html only, fetching "
                         "nothing — what the raw-HTML layer exists for")
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                        datefmt="%H:%M:%S")
    for noisy in ("botasaurus", "urllib3", "httpx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()

    if args.stats:
        s = conn.execute("SELECT COUNT(*) FROM fbref_seasons WHERE scraped_at IS NOT NULL").fetchone()[0]
        f = conn.execute("SELECT COUNT(*) FROM fbref_fixtures").fetchone()[0]
        played = conn.execute("SELECT COUNT(*) FROM fbref_fixtures "
                              "WHERE home_goals IS NOT NULL").fetchone()[0]
        xg = conn.execute("SELECT COUNT(*) FROM fbref_fixtures "
                          "WHERE home_xg IS NOT NULL").fetchone()[0]
        ref = conn.execute("SELECT COUNT(*) FROM fbref_fixtures "
                           "WHERE referee IS NOT NULL").fetchone()[0]
        logger.info("league-seasons scraped %d | fixtures %d (%d played, "
                    "%d with xG, %d with a referee)", s, f, played, xg, ref)
        for r in conn.execute("""SELECT league, COUNT(*) n, MIN(season), MAX(season),
                    SUM(CASE WHEN home_goals IS NOT NULL THEN 1 ELSE 0 END) played
                FROM fbref_fixtures GROUP BY 1 ORDER BY 2 DESC"""):
            logger.info("  %-34s %6d rows  %s..%s  %d played",
                        r[0], r[1], r[2], r[3], r[4])
        return 0

    from ScraperFC.fbref import comps

    names = ([n.strip() for n in args.leagues.split(",") if n.strip()]
             if args.leagues else sorted(comps))
    unknown = [n for n in names if n not in comps]
    if unknown:
        ap.error(f"unknown FBref leagues: {unknown}")

    client = FBrefClient()

    if args.reparse:
        return _reparse(conn, client)

    done = _already_current(conn, args.stale_days)
    logger.info("%d league-seasons already current", len(done))

    processed = 0
    for league in names:
        history = comps[league]["FBREF"]["history url"]
        soup = client.soup(history, refresh=args.refresh)
        if soup is None:
            logger.warning("%s: history page unavailable", league)
            continue
        seasons: Dict[str, str] = {
            th.get_text(strip=True): "https://fbref.com" + th.find("a")["href"]
            for th in soup.find_all("th", {"data-stat": re.compile("year"),
                                           "scope": "row"})
            if th.find("a")
        }
        if args.since:
            seasons = {k: v for k, v in seasons.items()
                       if _season_start(k) is None or _season_start(k) >= args.since}
        logger.info("%s: %d seasons", league, len(seasons))

        for season, stats_url in sorted(seasons.items()):
            conn.execute("""INSERT OR IGNORE INTO fbref_seasons
                            (league, season, stats_url) VALUES (?,?,?)""",
                         (league, season, stats_url))
            conn.commit()
            if (league, season) in done:
                continue
            if args.limit and processed >= args.limit:
                logger.info("hit --limit %d", args.limit)
                _report(client, conn)
                return 0

            url = schedule_url(stats_url)
            page = client.soup(url, refresh=args.refresh)
            if page is None:
                conn.execute("UPDATE fbref_seasons SET schedule_url=?, error=? "
                             "WHERE league=? AND season=?",
                             (url, "unavailable", league, season))
                conn.commit()
                continue

            rows = parse_schedule(page, league, season)
            if rows:
                conn.executemany(
                    "INSERT OR REPLACE INTO fbref_fixtures VALUES "
                    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            conn.execute("""UPDATE fbref_seasons
                            SET schedule_url=?, fixtures=?, scraped_at=?, error=NULL
                            WHERE league=? AND season=?""",
                         (url, len(rows), datetime.now(timezone.utc).isoformat(),
                          league, season))
            conn.commit()
            processed += 1
            logger.info("  %-34s %-12s %4d fixtures", league, season, len(rows))

    _report(client, conn)
    conn.close()
    return 0


def _reparse(conn: sqlite3.Connection, client: FBrefClient) -> int:
    """Re-derive every fixture from HTML already on disk.

    The whole reason raw pages are cached. Two parser bugs were found after
    the first run — a repeated header row stored as a fixture called "Home vs
    Away", and `round` read from a data-stat FBref calls `gameweek` — and
    fixing them cost one re-parse instead of re-scraping at six seconds a
    page.
    """
    from backend.services.fbref.client import cache_path

    rows = conn.execute("SELECT league, season, schedule_url FROM fbref_seasons "
                        "WHERE schedule_url IS NOT NULL").fetchall()
    reparsed = missing = 0
    for r in rows:
        if not cache_path(r["schedule_url"]).exists():
            missing += 1
            continue
        soup = client.soup(r["schedule_url"])
        if soup is None:
            missing += 1
            continue
        fixtures = parse_schedule(soup, r["league"], r["season"])
        conn.execute("DELETE FROM fbref_fixtures WHERE league=? AND season=?",
                     (r["league"], r["season"]))
        if fixtures:
            conn.executemany(
                "INSERT OR REPLACE INTO fbref_fixtures VALUES "
                "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", fixtures)
        conn.execute("UPDATE fbref_seasons SET fixtures=? WHERE league=? AND season=?",
                     (len(fixtures), r["league"], r["season"]))
        conn.commit()
        reparsed += 1
        logger.info("  reparsed %-34s %-12s %4d fixtures",
                    r["league"], r["season"], len(fixtures))
    total = conn.execute("SELECT COUNT(*) FROM fbref_fixtures").fetchone()[0]
    logger.info("reparsed %d league-seasons from cache (%d had no cached page); "
                "%d fixtures | %s", reparsed, missing, total, client.stats())
    return 0


def _already_current(conn: sqlite3.Connection, stale_days: float) -> set:
    """League-seasons that need no work.

    A completed season is immutable — its fixtures will never change, so it is
    scraped once and never again. A season still being played grows every
    week, so it goes stale after `stale_days` and comes back into the queue.
    Deciding this from the DATA (are there fixtures with no score?) rather than
    from a hardcoded "current season" means the rule keeps working in August
    when three leagues have started and two have not.
    """
    out = set()
    rows = conn.execute("""
        SELECT s.league, s.season, s.scraped_at,
               (SELECT COUNT(*) FROM fbref_fixtures f
                 WHERE f.league = s.league AND f.season = s.season
                   AND f.home_goals IS NULL) AS unplayed
          FROM fbref_seasons s
         WHERE s.scraped_at IS NOT NULL
    """).fetchall()
    now = datetime.now(timezone.utc)
    for r in rows:
        if not r["unplayed"]:
            out.add((r["league"], r["season"]))       # finished: frozen
            continue
        try:
            age = (now - datetime.fromisoformat(r["scraped_at"])).total_seconds() / 86400
        except (TypeError, ValueError):
            continue
        if age < stale_days:
            out.add((r["league"], r["season"]))       # in progress, still fresh
    return out


def _season_start(label: str) -> Optional[int]:
    m = re.match(r"^(\d{4})", label.strip())
    return int(m.group(1)) if m else None


def _report(client: FBrefClient, conn: sqlite3.Connection) -> None:
    total = conn.execute("SELECT COUNT(*) FROM fbref_fixtures").fetchone()[0]
    logger.info("done: %d fixtures stored | %s", total, client.stats())


if __name__ == "__main__":
    raise SystemExit(main())
