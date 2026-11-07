"""Export the strictly verified published record; no fitting or source writes."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import tempfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from backend.services.forecast.track_record import from_database

ROOT = Path(__file__).resolve().parents[2]


def read_snapshots(path: Path) -> list[dict]:
    """Preserve optional declarations from the same immutable CSV row.

    The existing importer validates every row and preserves order. Its ledger
    schema has no period columns, so it must not manufacture declarations for
    old exports. No source ledger schema or writer is changed here.
    """
    from backend.scripts.import_snapshots import parse

    # Both passes must see the same bytes: a refreshed CSV must not splice new
    # declarations onto forecasts parsed from an earlier file version.
    with tempfile.TemporaryDirectory(prefix="record-input-") as directory:
        source = Path(directory) / path.name
        source.write_bytes(path.read_bytes())
        parsed = parse(source)
        opener = gzip.open if source.suffix == ".gz" else open
        with opener(source, "rt", newline="") as stream:
            raw = list(csv.DictReader(stream))
    rows = []
    for snapshot, source in zip(parsed, raw, strict=True):
        row = asdict(snapshot)
        for name in ("outcome_period", "scoreline_period"):
            row[name] = source.get(name) or None
        rows.append(row)
    return rows


def write_record(payload: dict, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=target.parent, prefix=".track-record-")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f, indent=2, allow_nan=False)
            f.write("\n")
        os.replace(name, target)
    finally:
        Path(name).unlink(missing_ok=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--database", type=Path, required=True)
    ap.add_argument("--snapshots", type=Path)
    ap.add_argument(
        "--output",
        type=Path,
        default=ROOT / "backend/data/evaluation/track_record.json",
    )
    args = ap.parse_args(argv)
    snapshots = None
    if args.snapshots:
        snapshots = read_snapshots(args.snapshots)
    payload = from_database(
        args.database, as_of=datetime.now(timezone.utc).isoformat(), snapshots=snapshots
    )
    write_record(payload, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
