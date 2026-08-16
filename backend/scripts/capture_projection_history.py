"""Record what the season projection said, so that "what changed" can be answered.

WHY THIS EXISTS
---------------
`season_projections.json` is a snapshot: it says Arsenal have a 41% title
chance today and has no memory of saying 34% last Saturday. The movement is the
interesting half — a projection that only ever shows its current value asks the
reader to take today's number on trust, while a projection that shows what moved
it after a result is showing its work.

The artifact is regenerated in place by `forecast_season.py`, so the previous
value is gone the moment the next run finishes. This appends each run's figures
to an append-only history first.

**IT HAS TO BE CAPTURED FORWARD, and git history is not a substitute.**
Measured 2026-08-15: the twenty committed revisions of `season_projections.json`
span five days, and across them the league count goes 14 -> 7 -> 9 -> 6 while
every European league still reads `played: 0`. Those differences are scope
changes and retrains during development, not a forecast responding to football.
Backfilling them would manufacture movement that never happened, and label a
product decision as evidence about a team. So this starts from empty and fills
up from matchday one, exactly as `capture_vendor_predictions.py` does.

WHAT IS KEPT
------------
One row per (captured run, competition, team) with the four figures a reader
actually follows, plus `played` so a delta can say whether any football
happened between two snapshots — a change with no matches in between is a
retrain, and must never be narrated as a result.

    python3 -m backend.scripts.capture_projection_history
    python3 -m backend.scripts.capture_projection_history --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "backend" / "data" / "predictions" / "season_projections.json"
OUT = ROOT / "backend" / "data" / "predictions" / "projection_history.jsonl"

# The figures the product actually shows. Anything else can be recomputed from
# the artifact of the day; these are the ones whose HISTORY is the point.
#
# `p_group_title` and `p_qualify` are here for the GROUPED leagues. In MLS
# `p_title` is the Supporters' Shield and `p_top_cut` is the same number under
# a second name, so without these two a grouped league has no history for the
# figures that actually decide its season — which conference a club wins, and
# whether it reaches the playoffs. Absent in ungrouped leagues, and a missing
# key is simply not recorded.
FIGURES = (
    "p_title",
    "p_top_cut",
    "p_relegated",
    "p_group_title",
    "p_qualify",
    "exp_points",
    "exp_position",
)


def rows_for(payload: dict) -> List[dict]:
    """One row per team, stamped with the run that produced it."""
    generated_at = payload.get("generated_at")
    if not generated_at:
        return []

    out: List[dict] = []
    for league in payload.get("leagues") or []:
        competition_id = league.get("competition_id")
        if not competition_id:
            continue
        for team in league.get("table") or []:
            name = team.get("team")
            if not name:
                continue
            row = {
                "generated_at": generated_at,
                "competition_id": competition_id,
                "season": league.get("season"),
                "team": name,
                # Matches played at the time of this run. Two snapshots with the
                # same `played` differ because the MODEL changed, not because
                # results did — the difference must not be told as a story
                # about the team.
                "played": team.get("played"),
                "points": team.get("points"),
            }
            for key in FIGURES:
                row[key] = team.get(key)
            out.append(row)
    return out


def already_captured(path: Path) -> Set[Tuple[str, str, str]]:
    """(generated_at, competition, team) already on file."""
    seen: Set[Tuple[str, str, str]] = set()
    if not path.exists():
        return seen
    for line in path.read_text(encoding="utf8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            # A half-written line costs that line, never the rest of the file.
            continue
        seen.add(
            (
                str(row.get("generated_at")),
                str(row.get("competition_id")),
                str(row.get("team")),
            )
        )
    return seen


def new_rows(rows: Iterable[dict], seen: Set[Tuple[str, str, str]]) -> List[dict]:
    """Rows this file has not already recorded. Re-running captures nothing twice."""
    fresh = []
    for row in rows:
        key = (
            str(row.get("generated_at")),
            str(row.get("competition_id")),
            str(row.get("team")),
        )
        if key not in seen:
            seen.add(key)
            fresh.append(row)
    return fresh


def append(rows: List[dict], path: Path) -> int:
    if not rows:
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(rows)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path, default=SOURCE)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    if not args.source.exists():
        print(f"no projection at {args.source} — nothing captured.", file=sys.stderr)
        return 0

    try:
        payload = json.loads(args.source.read_text(encoding="utf8"))
    except json.JSONDecodeError as exc:
        print(f"{args.source} is not readable JSON: {exc}", file=sys.stderr)
        return 1

    rows = rows_for(payload)
    if not rows:
        print("the projection carries no league table — nothing captured.", file=sys.stderr)
        return 0

    fresh = new_rows(rows, already_captured(args.out))
    kept = 0 if args.dry_run else append(fresh, args.out)

    by_competition: Dict[str, int] = {}
    for row in fresh:
        by_competition[row["competition_id"]] = by_competition.get(row["competition_id"], 0) + 1

    stamp = payload.get("generated_at")
    print(f"{stamp}: {len(fresh)} new row(s) across {len(by_competition)} competition(s)")
    for competition, count in sorted(by_competition.items()):
        print(f"  {competition:9s} {count}")
    if not args.dry_run:
        print(f"appended {kept} row(s) to {args.out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
