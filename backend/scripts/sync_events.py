"""Carry the event corpus across warehouse republishes, in both directions.

The failure this exists to stop
-------------------------------
`match_events` and `match_event_coverage` are the expensive part of the
warehouse: one ESPN request per match, verified against the final score before
anything is stored, accumulated over months. They live inside
`warehouse.sqlite`, which is gitignored and shared as a single release asset
that FOUR jobs download, modify and re-upload.

That makes it a lost update waiting to happen, and on 2026-08-09 it happened:
a job that downloaded the warehouse before the day's backfill re-uploaded it
afterwards, and 3,140 verified timelines stopped existing. Event Backfill's
coverage guard caught it and then failed every day for four days, because the
thing it guards had no way to heal.

The fix is the one already used for `prediction_snapshots`: the event corpus
gets its OWN release asset and a round trip through it. Whoever republishes
the warehouse can no longer destroy the record, because the record is not
only in the warehouse.

Append-only by construction. Import is `INSERT OR IGNORE`, so restoring an
older export over a newer warehouse adds what is missing and overwrites
nothing — the merge is safe in either direction and in any order.

    python -m backend.scripts.sync_events export --output /tmp/events.csv.gz
    python -m backend.scripts.sync_events import --input /tmp/events.csv.gz
    python -m backend.scripts.sync_events import --input /tmp/e.gz --allow-missing
"""
from __future__ import annotations

import argparse
import csv
import gzip
import logging
import sqlite3
import sys
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.data.warehouse import WAREHOUSE_PATH  # noqa: E402

logger = logging.getLogger("sync_events")

# Two tables in one file. `coverage` is what makes the backfill resumable —
# it records that a match was ATTEMPTED and verified, including the matches
# that legitimately have no events. Exporting the timeline without it would
# restore the data and lose the memory of what still needs fetching.
EVENT_COLUMNS = ["match_id", "seq", "event_type", "minute", "added_time",
                 "team_side", "player", "source"]
COVERAGE_COLUMNS = ["match_id", "source", "events", "verified_at"]

# First field of every row, so one flat file can carry both tables and stay
# readable without this repository's code.
EVENT_ROW, COVERAGE_ROW = "event", "coverage"
HEADER = ["kind"] + EVENT_COLUMNS


def _connect(db: Optional[Path]) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db or WAREHOUSE_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def export(output: Path, db: Optional[Path] = None) -> int:
    conn = _connect(db)
    rows = 0
    output.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(output, "wt", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(HEADER)
        for r in conn.execute(
                f"SELECT {', '.join(COVERAGE_COLUMNS)} FROM match_event_coverage"):
            writer.writerow([COVERAGE_ROW] + [r[c] for c in COVERAGE_COLUMNS]
                            + [""] * (len(EVENT_COLUMNS) - len(COVERAGE_COLUMNS)))
            rows += 1
        for r in conn.execute(
                f"SELECT {', '.join(EVENT_COLUMNS)} FROM match_events"):
            writer.writerow([EVENT_ROW] + [r[c] for c in EVENT_COLUMNS])
            rows += 1
    conn.close()
    logger.info("exported %d rows -> %s (%.1f MB)", rows, output,
                output.stat().st_size / 1e6)
    return rows


def restore(source: Path, db: Optional[Path] = None,
            allow_missing: bool = False) -> int:
    if not source.exists():
        if allow_missing:
            logger.info("no published event corpus at %s — nothing to restore, "
                        "which is expected only on the very first run", source)
            return 0
        raise SystemExit(f"no event export at {source}")

    conn = _connect(db)
    before = conn.execute(
        "SELECT COUNT(*) FROM match_event_coverage").fetchone()[0]
    events = coverage = 0
    with gzip.open(source, "rt", newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh)
        header = next(reader, None)
        if header != HEADER:
            raise SystemExit(f"unexpected header in {source}: {header}")
        for row in reader:
            kind, rest = row[0], row[1:]
            if kind == COVERAGE_ROW:
                conn.execute(
                    "INSERT OR IGNORE INTO match_event_coverage"
                    f"({', '.join(COVERAGE_COLUMNS)}) VALUES (?, ?, ?, ?)",
                    rest[:len(COVERAGE_COLUMNS)])
                coverage += 1
            elif kind == EVENT_ROW:
                conn.execute(
                    "INSERT OR IGNORE INTO match_events"
                    f"({', '.join(EVENT_COLUMNS)}) "
                    f"VALUES ({', '.join('?' * len(EVENT_COLUMNS))})", rest)
                events += 1
            else:
                raise SystemExit(f"unknown row kind {kind!r} in {source}")
    conn.commit()
    after = conn.execute(
        "SELECT COUNT(*) FROM match_event_coverage").fetchone()[0]
    conn.close()
    logger.info("read %d coverage + %d event rows; covered matches %d -> %d "
                "(+%d restored)", coverage, events, before, after, after - before)
    return after - before


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="mode", required=True)

    e = sub.add_parser("export", help="warehouse -> csv.gz")
    e.add_argument("--output", default="match_events.csv.gz")
    e.add_argument("--db")

    i = sub.add_parser("import", help="csv.gz -> warehouse (INSERT OR IGNORE)")
    i.add_argument("--input", default="match_events.csv.gz")
    i.add_argument("--db")
    i.add_argument("--allow-missing", action="store_true",
                   help="a missing file is not an error (first run only)")

    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    db = Path(args.db) if args.db else None

    if args.mode == "export":
        export(Path(args.output), db)
    else:
        restore(Path(args.input), db, args.allow_missing)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
