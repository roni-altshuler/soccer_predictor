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
from backend.scripts.import_snapshots import parse  # noqa: E402

logger = logging.getLogger("export_snapshots")


def verify_preserved(previous: Path, candidate: Path) -> None:
    """Every published record must survive byte-value-equivalent by its key."""
    def key(row):
        return row.fixture_uid, row.generated_at, row.model_version
    old = parse(previous)
    new = {key(row): row for row in parse(candidate)}
    for row in old:
        if new.get(key(row)) != row:
            raise ValueError(f"Published history lost or changed: {key(row)}")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output", default="prediction_snapshots.csv.gz")
    ap.add_argument("--database", default=None)
    ap.add_argument("--previous-input", type=Path,
                    help="Require all previously published records to survive unchanged")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    with SnapshotStore(args.database) as store:
        conn = store.connect()
        cur = conn.execute(
            "SELECT * FROM prediction_snapshots ORDER BY generated_at, fixture_uid")
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".pending.gz")
    with gzip.open(tmp, "wt", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        w.writerows(rows)
    try:
        if args.previous_input:
            verify_preserved(args.previous_input, tmp)
        tmp.replace(out)
    finally:
        tmp.unlink(missing_ok=True)
    logger.info("exported %d snapshots to %s (%.1f KB)", len(rows), out,
                out.stat().st_size / 1024)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
