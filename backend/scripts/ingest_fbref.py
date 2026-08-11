"""Ingest FBref match pages — shot-level xG and the full officials crew.

Why this exists, and what it is honestly worth
----------------------------------------------
FBref answers plain HTTP with 403. Not an IP block: the headers say
`server: cloudflare`, `cf-mitigated: challenge`, and the body is the
"Just a moment..." interstitial. Measured 2026-08-11, three ways:

  requests.get(), no headers  ->  403, 0 tables   (the common recipe)
  curl, full browser headers  ->  403
  headless Chromium, 12s wait ->  403, challenge unsolved

ScraperFC gets through because its FBref reader drives **botasaurus**, an
anti-detection browser stack, against a real Chrome. That works here and
**cannot work in CI** — GitHub's runners have no such browser and the challenge
would fail anyway. So this is a LOCAL BAKE: run it on a workstation, commit
the result, and let the committed data be the source of truth. The F1 race
replays in the sibling project use the same pattern for the same reason.

Rate: about 8.6 seconds per match, measured. A league-season of 380 matches is
roughly 55 minutes. That cost is why this script is resumable per match rather
than per season — `scrape_matches` returns nothing until the whole season is
done, so an interruption at match 379 loses everything.

What FBref actually adds over what the warehouse already has
------------------------------------------------------------
Not much of what people assume. Match-level xG is already 89% covered for Wave
A from 2017 (via Understat), shots/SoT/corners are at 100%, and results go back
to 2003. Two things are genuinely new:

  1. **Shot-level data** — every shot with its xG, post-shot xG, distance, body
     part and outcome. Match xG is the sum; the distribution is not recoverable
     from it, and neither is post-shot xG.
  2. **The officials crew** — referee, both assistants, fourth official and
     VAR. CLAUDE.md records referee coverage outside England at 0.8-1.8% and
     calls it a source limitation. It is not; it is an FBref column.

Both are untested inputs. Neither is promised to help: the ablation on this
corpus found nine of ten feature groups actively harmful out of sample, and
`benchmark_market_blend` found that adding ratings to the price makes the price
WORSE. Ingest first, measure second, and let the paired bootstrap decide.

    python3 -m backend.scripts.ingest_fbref --leagues wave-a --seasons 2023-2025
    python3 -m backend.scripts.ingest_fbref --stats

Writes to `fbref_matches`, `fbref_shots`, `fbref_officials`.
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("ingest_fbref")

# Its OWN database, deliberately. A scrape that takes fifty hours must not
# hold a write lock on warehouse.sqlite — three workflows overwrite that
# file from a release asset, and the first probe of this script died with
# "database is locked" while the tournament backfill was mid-run. Same
# rule the odds snapshots follow: the scraper owns a durable record, and
# the build is what folds it into the warehouse.
DB = ROOT / "backend" / "data" / "fbref.sqlite"

# FBref's own league names — these strings are validated by ScraperFC and a
# wrong one raises rather than silently scraping nothing.
LEAGUES: Dict[str, str] = {
    "eng.1": "England Premier League",
    "esp.1": "Spain La Liga",
    "ger.1": "Germany Bundesliga",
    "ita.1": "Italy Serie A",
    "fra.1": "France Ligue 1",
}
WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")

SCHEMA = """
CREATE TABLE IF NOT EXISTS fbref_matches (
    url            TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    season         INTEGER NOT NULL,
    date_utc       TEXT,
    stage          TEXT,
    home_name      TEXT, away_name TEXT,
    home_goals     INTEGER, away_goals INTEGER,
    match_id       TEXT,          -- warehouse fixture, NULL when unmatched
    scraped_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fbref_matches_fixture ON fbref_matches(match_id);
CREATE INDEX IF NOT EXISTS idx_fbref_matches_season
    ON fbref_matches(competition_id, season);

CREATE TABLE IF NOT EXISTS fbref_officials (
    url             TEXT PRIMARY KEY REFERENCES fbref_matches(url),
    referee         TEXT,
    assistant_1     TEXT,
    assistant_2     TEXT,
    fourth_official TEXT,
    var             TEXT
);

CREATE TABLE IF NOT EXISTS fbref_shots (
    url        TEXT NOT NULL REFERENCES fbref_matches(url),
    side       TEXT NOT NULL,          -- home | away
    seq        INTEGER NOT NULL,
    minute     TEXT,
    player     TEXT,
    squad      TEXT,
    xg         REAL,
    psxg       REAL,
    outcome    TEXT,
    distance   REAL,
    body_part  TEXT,
    notes      TEXT,
    PRIMARY KEY (url, side, seq)
);
CREATE INDEX IF NOT EXISTS idx_fbref_shots_url ON fbref_shots(url);
"""


def _f(v) -> Optional[float]:
    try:
        if v is None or v != v or str(v).strip() == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _s(v) -> Optional[str]:
    if v is None or (isinstance(v, float) and v != v):
        return None
    s = str(v).strip()
    return s or None


def _i(v) -> Optional[int]:
    f = _f(v)
    return int(f) if f is not None else None


def _flatten(col) -> str:
    """FBref shot tables come back with a MultiIndex header."""
    if isinstance(col, tuple):
        parts = [str(c) for c in col if c and not str(c).startswith("Unnamed")]
        return "_".join(parts).strip().lower()
    return str(col).strip().lower()


def shot_rows(df, url: str, side: str) -> List[Tuple]:
    """One row per shot. Column names vary by season, so each field is looked
    up by suffix rather than by an exact header that will drift."""
    if df is None or getattr(df, "empty", True):
        return []
    cols = {_flatten(c): c for c in df.columns}

    def pick(*needles):
        for needle in needles:
            for flat, real in cols.items():
                if flat == needle or flat.endswith("_" + needle):
                    return real
        return None

    c_min, c_player = pick("minute"), pick("player")
    c_squad, c_xg = pick("squad"), pick("xg")
    c_psxg, c_out = pick("psxg"), pick("outcome")
    c_dist, c_body = pick("distance"), pick("body part", "body_part")
    c_notes = pick("notes")

    out = []
    for seq, (_, r) in enumerate(df.iterrows()):
        minute = _s(r.get(c_min)) if c_min is not None else None
        player = _s(r.get(c_player)) if c_player is not None else None
        if minute is None and player is None:
            continue                     # FBref pads its tables with blanks
        out.append((
            url, side, seq, minute, player,
            _s(r.get(c_squad)) if c_squad is not None else None,
            _f(r.get(c_xg)) if c_xg is not None else None,
            _f(r.get(c_psxg)) if c_psxg is not None else None,
            _s(r.get(c_out)) if c_out is not None else None,
            _f(r.get(c_dist)) if c_dist is not None else None,
            _s(r.get(c_body)) if c_body is not None else None,
            _s(r.get(c_notes)) if c_notes is not None else None,
        ))
    return out


def parse_seasons(spec: str) -> List[int]:
    out: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            out.extend(range(int(a), int(b) + 1))
        elif part:
            out.append(int(part))
    return sorted(set(out))


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", default="wave-a")
    ap.add_argument("--seasons", default="2023-2025",
                    help="warehouse season numbers, e.g. 2023-2025 or 2019,2021")
    ap.add_argument("--limit", type=int, help="stop after N matches (a probe)")
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s",
                        datefmt="%H:%M:%S")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=60000")
    conn.executescript(SCHEMA)
    conn.commit()

    if args.stats:
        m = conn.execute("SELECT COUNT(*) FROM fbref_matches").fetchone()[0]
        s = conn.execute("SELECT COUNT(*) FROM fbref_shots").fetchone()[0]
        r = conn.execute("SELECT COUNT(*) FROM fbref_officials "
                         "WHERE referee IS NOT NULL").fetchone()[0]
        logger.info("fbref_matches %d | fbref_shots %d | with referee %d", m, s, r)
        for row in conn.execute("""SELECT competition_id, season, COUNT(*) n,
                    SUM(CASE WHEN match_id IS NOT NULL THEN 1 ELSE 0 END) linked
                FROM fbref_matches GROUP BY 1,2 ORDER BY 1,2"""):
            logger.info("  %-7s %d  %3d scraped, %3d linked to a warehouse fixture",
                        row["competition_id"], row["season"], row["n"], row["linked"])
        return 0

    comps = list(WAVE_A) if args.leagues == "wave-a" else [
        c.strip() for c in args.leagues.split(",") if c.strip()]
    seasons = parse_seasons(args.seasons)

    import ScraperFC  # imported late: it pulls in a browser stack

    fb = ScraperFC.FBref()
    done = {r[0] for r in conn.execute("SELECT url FROM fbref_matches")}
    logger.info("%d matches already stored", len(done))

    total = failed = 0
    for comp in comps:
        league = LEAGUES.get(comp)
        if not league:
            logger.warning("no FBref league name for %s — skipping", comp)
            continue
        for season in seasons:
            # FBref labels a European season "2024-2025"; the warehouse stores
            # the starting year.
            year = f"{season}-{season + 1}"
            try:
                links = fb.get_match_links(year=year, league=league)
            except Exception as exc:  # noqa: BLE001
                logger.warning("  %s %s: no match links (%s)", comp, year, exc)
                continue
            todo = [u for u in links if u not in done]
            logger.info("%s %s: %d matches, %d already stored, %d to scrape",
                        comp, year, len(links), len(links) - len(todo), len(todo))

            for i, url in enumerate(todo, 1):
                if args.limit and total >= args.limit:
                    logger.info("hit --limit %d", args.limit)
                    conn.commit()
                    return 0
                t0 = time.time()
                try:
                    m = fb.scrape_match(url)
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    logger.warning("  FAILED %s: %s", url.rsplit("/", 1)[-1][:40],
                                   str(exc)[:120])
                    continue

                conn.execute(
                    """INSERT OR REPLACE INTO fbref_matches
                       (url, competition_id, season, date_utc, stage, home_name,
                        away_name, home_goals, away_goals, match_id, scraped_at)
                       VALUES (?,?,?,?,?,?,?,?,?,NULL,?)""",
                    (url, comp, season, _s(m.date), _s(m.stage), _s(m.home_team),
                     _s(m.away_team), _i(m.home_goals), _i(m.away_goals),
                     datetime.now(timezone.utc).isoformat()))
                conn.execute(
                    """INSERT OR REPLACE INTO fbref_officials
                       (url, referee, assistant_1, assistant_2, fourth_official, var)
                       VALUES (?,?,?,?,?,?)""",
                    (url, _s(m.referee), _s(m.ar1), _s(m.ar2),
                     _s(m.fourth_official), _s(m.var)))
                conn.execute("DELETE FROM fbref_shots WHERE url = ?", (url,))
                rows = (shot_rows(m.home_shots, url, "home")
                        + shot_rows(m.away_shots, url, "away"))
                if rows:
                    conn.executemany(
                        "INSERT OR REPLACE INTO fbref_shots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        rows)
                conn.commit()          # per match: this job WILL be interrupted
                total += 1
                if total % 10 == 0 or i == 1:
                    logger.info("  %d/%d  %s %s-%s  %d shots  (%.1fs)",
                                i, len(todo), _s(m.date), _s(m.home_team),
                                _s(m.away_team), len(rows), time.time() - t0)

    logger.info("done: %d matches scraped, %d failed", total, failed)
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
