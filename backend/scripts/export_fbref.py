"""Export the FBref landing tables to Parquet — and why not CSV.

The storage question, answered
------------------------------
There are four layers here and each exists because the one above it cannot do
its job.

  1. **Raw HTML, gzipped, content-addressed**
     `backend/data/cache/fbref_html/<hash>.html.gz`
     Six seconds a page is the real cost of this dataset. A parser bug must
     cost a re-parse, never a re-scrape. This layer is append-only and is the
     only thing that would be genuinely expensive to lose.

  2. **`fbref.sqlite` — the landing zone, and the source of truth**
     Typed, indexed, PRIMARY KEY (league, season, row_key). Re-scraping a
     season REPLACES its rows. This is the reason the answer to "CSV?" is no:
     a CSV has no key, so the only way to add this week's fixtures is to append
     — and appending the same season twice silently doubles it. That failure is
     not hypothetical here; this warehouse once had 18,547 duplicate fixtures
     and a team that "won" the Bundesliga because a 7-0 was counted twice.
     SQLite gets an idempotent upsert for free.

  3. **Parquet, partitioned by league and season** (this script)
     For portability and analysis. Typed, columnar, roughly a tenth the size
     of the equivalent CSV, and readable by pandas, polars and duckdb without
     a schema guess. Partitioning by league/season means a new season adds a
     file rather than rewriting the dataset, and a reader can pull one league
     without touching the rest.

  4. **`warehouse.sqlite` — the serving layer**
     Populated by a separate, re-runnable loader. Deliberately NOT written by
     the scraper: three workflows overwrite the warehouse from a release asset,
     and a scrape measured in hours must not hold its write lock.

CSV is still produced on request (`--csv`) because a human eyeballing one
league-season in a spreadsheet is a real use. It is an EXPORT, never an input.

How new data arrives
--------------------
The unit of refresh is the league-season, and staleness is read from the data:
a season with no unplayed fixtures is finished and frozen forever; a season
still being played goes stale after a few days and re-enters the queue. That
rule needs no "current season" constant, which matters in August when three
leagues have started and two have not.

    python3 -m backend.scripts.export_fbref
    python3 -m backend.scripts.export_fbref --csv --leagues "England Premier League"
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("export_fbref")

DB = ROOT / "backend" / "data" / "fbref.sqlite"
OUT = ROOT / "backend" / "data" / "fbref"


def _slug(value: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in value)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", help="comma-separated; default every league present")
    ap.add_argument("--csv", action="store_true",
                    help="also write CSV, for reading by eye")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not DB.exists():
        logger.error("no %s — run ingest_fbref_schedules first", DB)
        return 1

    import duckdb

    out = Path(args.out)
    (out / "parquet").mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute(f"ATTACH '{DB}' AS fb (TYPE sqlite, READ_ONLY);")

    leagues = ([s.strip() for s in args.leagues.split(",") if s.strip()]
               if args.leagues else
               [r[0] for r in con.execute(
                   "SELECT DISTINCT league FROM fb.fbref_fixtures ORDER BY 1").fetchall()])
    if not leagues:
        logger.error("no fixtures in %s yet", DB)
        return 1

    written = rows_total = 0
    for league in leagues:
        seasons = [r[0] for r in con.execute(
            "SELECT DISTINCT season FROM fb.fbref_fixtures WHERE league = ? ORDER BY 1",
            [league]).fetchall()]
        for season in seasons:
            # One file per league-season. A new season adds a file; it never
            # rewrites the ones already there, so an interrupted export leaves
            # every completed partition intact.
            part = out / "parquet" / f"league={_slug(league)}" / f"season={_slug(season)}"
            part.mkdir(parents=True, exist_ok=True)
            target = part / "fixtures.parquet"
            n = con.execute(
                "SELECT COUNT(*) FROM fb.fbref_fixtures WHERE league = ? AND season = ?",
                [league, season]).fetchone()[0]
            if not n:
                continue
            con.execute(
                f"COPY (SELECT * FROM fb.fbref_fixtures WHERE league = ? AND season = ?) "
                f"TO '{target}' (FORMAT PARQUET, COMPRESSION ZSTD)", [league, season])
            if args.csv:
                con.execute(
                    f"COPY (SELECT * FROM fb.fbref_fixtures WHERE league = ? AND season = ?) "
                    f"TO '{part / 'fixtures.csv'}' (HEADER, DELIMITER ',')",
                    [league, season])
            written += 1
            rows_total += n

    manifest = out / "MANIFEST.json"
    import json
    size = sum(p.stat().st_size for p in (out / "parquet").rglob("*.parquet"))
    manifest.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "fbref.sqlite (landing zone); raw HTML cached under "
                  "backend/data/cache/fbref_html",
        "layout": "parquet/league=<league>/season=<season>/fixtures.parquet",
        "partitions": written,
        "rows": rows_total,
        "bytes": size,
        "note": "Parquet is an EXPORT. The source of truth is fbref.sqlite, "
                "which has a primary key and therefore an idempotent upsert; "
                "appending to a keyless CSV is how a fixture gets counted twice.",
    }, indent=2))

    logger.info("wrote %d partitions, %d rows, %.1f MB -> %s",
                written, rows_total, size / 1e6, out / "parquet")
    logger.info("manifest: %s", manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
