"""Refuse to publish a forecast trained on a corpus that quietly shrank.

The failure this exists to catch
--------------------------------
The season forecast trains on the canonical layer, which is rebuilt from
scratch on every CI run out of two downloaded databases. If one of those
arrives truncated — a partial release asset, a loader that started returning
nothing, a competition that stopped being ingested — the rebuild still
succeeds. It just succeeds with less. The job would then publish forecasts
under the same version string as the metrics on `/season`, computed from a
corpus those metrics never described.

The guard this replaces summed seven leagues and compared against one floor.
That caught a total collapse and nothing else: after `/season` grew to
fourteen leagues, all seven of the new ones could have vanished without
moving the number it checked.

What is checked, per league
---------------------------
Corpora only grow. Results land, matches do not un-happen, and the canonical
layer is append-only in effect. So the honest test is against what was last
measured, not against a guessed constant: every league `forecast_season`
serves must still be present, and no smaller than its recorded baseline.

`TOLERANCE` exists because a shrink of one or two is a legitimate data
correction — a duplicate fixture merged, a mis-dated match moved across a
season boundary — while a real breakage takes out hundreds. It is
deliberately far below the size of any failure worth catching.

The league list is imported from `forecast_season` rather than repeated here,
so a league added to the site cannot be left out of the guard.

Usage:
    python -m backend.scripts.verify_corpus              # check
    python -m backend.scripts.verify_corpus --update     # re-record
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
CANONICAL = ROOT / "backend" / "data" / "canonical.duckdb"
BASELINE = ROOT / "reports" / "baselines" / "corpus.json"

# Matches before this are not used for training and not counted here.
MIN_SEASON = 2000

# A shrink smaller than this is a data correction; anything larger is damage.
TOLERANCE = 25


def observed(canonical: Path, min_season: int = MIN_SEASON) -> Dict[str, int]:
    """Played-match counts per competition in the canonical layer."""
    import duckdb

    con = duckdb.connect(str(canonical), read_only=True)
    try:
        rows = con.execute(
            "SELECT competition_id, COUNT(*) FROM matches "
            "WHERE season >= ? GROUP BY 1", [min_season]).fetchall()
    finally:
        con.close()
    return {comp: int(n) for comp, n in rows}


def served_leagues() -> Dict[str, str]:
    """The leagues `/season` publishes, straight from the forecast itself."""
    from backend.scripts.forecast_season import LEAGUES

    return {comp: meta["name"] for comp, meta in LEAGUES.items()}


def check(counts: Dict[str, int], baseline: Dict[str, int],
          leagues: Dict[str, str], tolerance: int = TOLERANCE) -> list:
    """Every problem found, as human sentences. Empty means the corpus is fine."""
    problems = []
    for comp, name in sorted(leagues.items()):
        have = counts.get(comp, 0)
        if have == 0:
            problems.append(
                f"{comp} ({name}) is SERVED on /season but has no matches in "
                f"the canonical layer — it would publish a forecast trained "
                f"on nothing")
            continue
        want = baseline.get(comp)
        if want is None:
            # New league, not yet recorded. Not a failure — but say so, so it
            # is recorded deliberately rather than by silence.
            problems.append(
                f"NOTE {comp} ({name}) has {have} matches and no baseline; "
                f"run --update to record it")
            continue
        if have < want - tolerance:
            problems.append(
                f"{comp} ({name}) has {have} matches, down from {want} — "
                f"lost {want - have}. A training corpus does not shrink; "
                f"something upstream is truncated")
    return problems


def load_baseline(path: Path) -> Dict[str, int]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {k: int(v) for k, v in data.get("leagues", {}).items()}


def write_baseline(path: Path, counts: Dict[str, int],
                   leagues: Dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_season": MIN_SEASON,
        "tolerance": TOLERANCE,
        "note": ("Played matches per served league in the canonical layer. "
                 "Recorded, not chosen: the guard fails when a league falls "
                 "below what was last measured."),
        "leagues": {comp: counts.get(comp, 0) for comp in sorted(leagues)},
    }, indent=2) + "\n")


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--canonical", default=str(CANONICAL))
    ap.add_argument("--baseline", default=str(BASELINE))
    ap.add_argument("--update", action="store_true",
                    help="Re-record the baseline from the current corpus.")
    args = ap.parse_args(argv)

    canonical = Path(args.canonical)
    if not canonical.exists():
        print(f"no canonical layer at {canonical}", file=sys.stderr)
        return 2

    leagues = served_leagues()
    counts = observed(canonical)
    baseline_path = Path(args.baseline)

    if args.update:
        write_baseline(baseline_path, counts, leagues)
        total = sum(counts.get(c, 0) for c in leagues)
        print(f"recorded {len(leagues)} leagues, {total} matches "
              f"-> {baseline_path}")
        return 0

    problems = check(counts, load_baseline(baseline_path), leagues)
    total = sum(counts.get(c, 0) for c in leagues)
    print(f"canonical training corpus: {total} matches across "
          f"{len(leagues)} served leagues")
    for comp in sorted(leagues):
        print(f"  {comp:8s} {counts.get(comp, 0):7d}")

    fatal = [p for p in problems if not p.startswith("NOTE")]
    for p in problems:
        print(p, file=sys.stderr)
    if fatal:
        print("refusing to publish a forecast trained on a different corpus "
              "than the metrics on /season describe", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
