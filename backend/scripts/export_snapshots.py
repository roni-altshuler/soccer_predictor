"""Export the immutable prediction history so it outlives the runner.

`prediction_snapshots` lives in `warehouse.sqlite`, which is gitignored and
rebuilt from a release asset on every CI run. A provenance record that only
exists inside a container is not a provenance record, so the scheduled job
exports it and uploads it alongside the other artifacts.

CSV rather than a database file: it is a flat append-only log, it compresses to
almost nothing, and anyone auditing a published forecast should not need this
repository's code to read it.

    python3 -m backend.scripts.export_snapshots --output /tmp/snaps.csv.gz
"""
from __future__ import annotations

import argparse
import csv
import gzip
import logging
import sys
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.forecast.snapshots import SnapshotStore  # noqa: E402

logger = logging.getLogger("export_snapshots")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", default="prediction_snapshots.csv.gz")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with SnapshotStore() as store:
        conn = store.connect()
        cur = conn.execute(
            "SELECT * FROM prediction_snapshots ORDER BY generated_at, fixture_uid")
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        w.writerows(rows)
    logger.info("exported %d snapshots to %s (%.1f KB)", len(rows), out,
                out.stat().st_size / 1024)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
