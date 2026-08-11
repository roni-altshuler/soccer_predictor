"""Restore the published prediction history into a fresh warehouse.

Why this exists
---------------
The scheduled forecast runs on a container that starts from
`warehouse.sqlite.gz` on the release and is destroyed afterwards. That artifact
does not carry `prediction_snapshots` — it is republished by the training and
backfill jobs, which know nothing about forecasts. So without this script the
sequence is:

    run 1: empty table -> record 2,346 -> export a CSV of 2,346
    run 2: empty table -> record 2,346 -> export a CSV of 2,346  (run 1 GONE)

The upload is `--clobber`, so run 2's export silently replaces run 1's. The
history would be one run deep forever while claiming to be append-only, and
nobody would notice until someone asked what we said about a match a month ago.

Importing the published CSV back before recording closes the loop: the table is
rebuilt from the log, extended, and exported again.

Safety
------
`INSERT OR IGNORE`, same as `record()`. A row already present is left exactly
as it was — an import can only ever add. Rows are validated before insert, so a
truncated or corrupted download cannot poison the record; the import fails and
the job stops rather than writing half a history.

    python3 -m backend.scripts.import_snapshots --input /tmp/snaps.csv.gz
    python3 -m backend.scripts.import_snapshots --input x.csv.gz --allow-missing
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import logging
import sys
from pathlib import Path
from typing import List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.forecast.snapshots import Snapshot, SnapshotStore  # noqa: E402

logger = logging.getLogger("import_snapshots")

# The columns that must be present for a row to be a forecast at all. Extra
# columns are ignored (a newer export may carry more); a missing one of these
# means the file is not what it claims to be.
REQUIRED = ("fixture_uid", "generated_at", "model_version", "competition_id",
            "season", "kickoff_at", "home_team", "away_team",
            "p_home", "p_draw", "p_away", "lambda_home", "lambda_away")

OPTIONAL_FLOAT = ("elo_home", "elo_away", "top_scoreline_p")


def _open(path: Path) -> io.TextIOBase:
    if path.suffix == ".gz":
        return gzip.open(path, "rt", newline="")
    return path.open("rt", newline="")


def parse(path: Path) -> List[Snapshot]:
    """Read the export into validated snapshots, or raise."""
    with _open(path) as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        return []
    missing = [c for c in REQUIRED if c not in rows[0]]
    if missing:
        raise ValueError(
            f"{path} is missing {missing} — this is not a prediction snapshot "
            f"export, and importing it would corrupt the provenance record")

    out: List[Snapshot] = []
    for i, r in enumerate(rows, start=2):  # line 1 is the header
        def opt(key: str) -> Optional[float]:
            v = r.get(key)
            return float(v) if v not in (None, "", "None") else None
        try:
            s = Snapshot(
                fixture_uid=r["fixture_uid"],
                generated_at=r["generated_at"],
                model_version=r["model_version"],
                competition_id=r["competition_id"],
                season=int(r["season"]),
                kickoff_at=r["kickoff_at"],
                home_team=r["home_team"],
                away_team=r["away_team"],
                p_home=float(r["p_home"]),
                p_draw=float(r["p_draw"]),
                p_away=float(r["p_away"]),
                lambda_home=float(r["lambda_home"]),
                lambda_away=float(r["lambda_away"]),
                elo_home=opt("elo_home"),
                elo_away=opt("elo_away"),
                trained_through=r.get("trained_through") or None,
                top_scoreline=r.get("top_scoreline") or None,
                top_scoreline_p=opt("top_scoreline_p"),
            )
            s.validate()
        except (ValueError, KeyError) as exc:
            raise ValueError(f"{path} line {i}: {exc}") from exc
        out.append(s)
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", default="prediction_snapshots.csv.gz")
    ap.add_argument("--allow-missing", action="store_true",
                    help="a missing file is fine on the first ever run, when "
                         "no history has been published yet")
    ap.add_argument("--database", default=None)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    path = Path(args.input)
    if not path.exists():
        if args.allow_missing:
            logger.info("no published history at %s — starting a new record", path)
            return 0
        logger.error("no such file: %s", path)
        return 1

    snaps = parse(path)
    with SnapshotStore(args.database) as store:
        before = store.stats()
        written = store.record(snaps)
        after = store.stats()
    logger.info("read %d snapshots from %s", len(snaps), path)
    logger.info("restored %d (had %d, now %d over %d fixtures, %d version(s))",
                written, before["rows"], after["rows"], after["fixtures"],
                after["versions"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
