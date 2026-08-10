"""Fit per-league goal/home-advantage/draw parameters from observed history.

Replaces the drift loop that used to write these three fields.

WHAT WENT WRONG BEFORE. `train_feedback._update_league_params` treated
`avg_goals`, `home_adv` and `draw_rate` as things to *learn by nudging*: each
run added a fraction of the latest prediction error to the current value and
clamped the result. Nothing in that loop referenced the truth, so the error term
never had to shrink — a run that pushed a parameter the wrong way was followed
by another push in the same direction. Every parameter walked until it hit a
clamp and stopped there.

Measured on 2026-08-10, that is exactly where all fourteen leagues were:

    eng.1  avg_goals 0.75 (= MIN)   home_adv 0.05 (= MIN)
    ita.1  avg_goals 0.75 (= MIN)   draw_rate 0.08 (= MIN)
    usa.1  avg_goals 2.25 (= MAX)   home_adv 0.45 (= MAX)

`avg_goals` is per-team expected goals, so 0.75 says a Premier League match
finishes 0.8-0.75 and `home_adv` 0.05 says home advantage is worth a twentieth
of a goal. The real values are ~1.4 and ~0.25. These feed the `/predict` page
through `src/app/api/predict/{any-teams,head-to-head}/route.ts`, so the error
was visible to anyone who asked for a scoreline.

WHAT THIS DOES INSTEAD. All three quantities are directly observable, so they
are measured rather than inferred:

    avg_goals  mean goals scored by ONE side in a match
    home_adv   mean (home goals - away goals), i.e. the goal-scale home edge
    draw_rate  share of matches that finished level

over a trailing window of completed matches in the warehouse. The estimator is
deterministic and idempotent: running it twice on the same data writes the same
numbers, and a bad run cannot compound into the next one.

The clamps stay, but their meaning is inverted. They used to be where the walk
came to rest; now a fitted value that reaches one is treated as evidence the
estimator is wrong, reported as a warning and — with `--strict` — a non-zero
exit. A real league does not sit on a rail.

Usage:
    python -m backend.scripts.fit_league_params
    python -m backend.scripts.fit_league_params --dry-run
    python -m backend.scripts.fit_league_params --strict     # CI
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from backend.services.data.warehouse import WAREHOUSE_PATH, Warehouse

logger = logging.getLogger(__name__)

PARAMS_PATH = Path(__file__).resolve().parents[1] / "data" / "league_params.json"

# Sanity rails. A fitted value touching one of these means the estimator is
# broken or the sample is junk — never that the league is that extreme.
BOUNDS: Dict[str, Tuple[float, float]] = {
    "avg_goals": (0.75, 2.25),
    "home_adv": (0.05, 0.45),
    "draw_rate": (0.08, 0.38),
}

# Below this many completed matches an estimate is noise; the existing value is
# kept and the league is reported as skipped. A full league season is ~306-380.
MIN_SAMPLE = 200

# Trailing window. Long enough to be stable, short enough to track real drift
# in scoring rates (VAR, rule changes, a league's own evolution).
DEFAULT_SEASONS = 5


def _fit_one(rows: List) -> Optional[Dict[str, float]]:
    """Empirical parameters from completed matches. None if too few."""
    scored = [
        (r["home_score"], r["away_score"])
        for r in rows
        if r["home_score"] is not None and r["away_score"] is not None
    ]
    if len(scored) < MIN_SAMPLE:
        return None
    n = len(scored)
    total_goals = sum(h + a for h, a in scored)
    return {
        # Per-SIDE goals: the parameter is multiplied by a team's attack
        # strength downstream, not by the match total.
        "avg_goals": round(total_goals / (2 * n), 4),
        "home_adv": round(sum(h - a for h, a in scored) / n, 4),
        "draw_rate": round(sum(1 for h, a in scored if h == a) / n, 4),
        "n": n,
    }


def fit(
    wh: Warehouse, league_keys: List[str], *, seasons: int
) -> Tuple[Dict[str, Dict], List[str], List[str]]:
    """Returns (fitted, skipped_for_sample, rail_hits)."""
    fitted: Dict[str, Dict] = {}
    skipped: List[str] = []
    rails: List[str] = []

    latest = wh._conn.execute(  # noqa: SLF001
        "SELECT MAX(season) AS s FROM matches"
    ).fetchone()["s"]
    if latest is None:
        return {}, league_keys, []
    since = int(latest) - seasons + 1

    for key in league_keys:
        rows = wh._conn.execute(  # noqa: SLF001
            """
            SELECT home_score, away_score FROM matches
            WHERE competition_id = ? AND season >= ?
              AND home_score IS NOT NULL AND away_score IS NOT NULL
            """,
            (key, since),
        ).fetchall()
        est = _fit_one(rows)
        if est is None:
            skipped.append(f"{key} ({len(rows)} completed matches < {MIN_SAMPLE})")
            continue
        for field, (lo, hi) in BOUNDS.items():
            v = est[field]
            if v <= lo or v >= hi:
                rails.append(
                    f"{key}.{field} fitted to {v} which is at or beyond its "
                    f"[{lo}, {hi}] sanity bound over {est['n']} matches"
                )
            est[field] = min(hi, max(lo, v))
        fitted[key] = est
    return fitted, skipped, rails


def apply(fitted: Dict[str, Dict], *, dry_run: bool) -> int:
    if not PARAMS_PATH.exists():
        logger.error("league_params.json not found at %s", PARAMS_PATH)
        return 0
    data = json.loads(PARAMS_PATH.read_text())
    leagues = data.get("leagues", {})
    changed = 0
    for key, est in sorted(fitted.items()):
        lp = leagues.get(key)
        if lp is None:
            continue
        for field in ("avg_goals", "home_adv", "draw_rate"):
            before, after = lp.get(field), est[field]
            if before != after:
                logger.info(
                    "  %-16s %-10s %s -> %s   (n=%d)",
                    key, field, before, after, est["n"],
                )
                if not dry_run:
                    lp[field] = after
                changed += 1
    if changed and not dry_run:
        data["updated_at"] = datetime.now(timezone.utc).isoformat()
        data["params_fitted_by"] = "backend/scripts/fit_league_params.py"
        PARAMS_PATH.write_text(json.dumps(data, indent=2) + "\n")
    return changed


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", type=Path, default=WAREHOUSE_PATH)
    ap.add_argument("--seasons", type=int, default=DEFAULT_SEASONS)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero if any fitted value lands on a sanity rail.",
    )
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)

    if not args.db.exists():
        print(f"warehouse not found at {args.db}", file=sys.stderr)
        return 2
    if not PARAMS_PATH.exists():
        print(f"league_params.json not found at {PARAMS_PATH}", file=sys.stderr)
        return 2

    league_keys = list(json.loads(PARAMS_PATH.read_text()).get("leagues", {}))
    wh = Warehouse(args.db)
    try:
        fitted, skipped, rails = fit(wh, league_keys, seasons=args.seasons)
    finally:
        wh.close()

    print(f"{'DRY RUN — ' if args.dry_run else ''}fitting {len(league_keys)} leagues "
          f"over the last {args.seasons} seasons")
    changed = apply(fitted, dry_run=args.dry_run)
    print(f"  fitted   : {len(fitted)} leagues, {changed} parameter changes")
    if skipped:
        print(f"  skipped  : {len(skipped)} leagues below the {MIN_SAMPLE}-match floor")
        for s in skipped:
            print(f"             {s}")
    if rails:
        print(f"  RAIL HITS: {len(rails)} — the estimator, not the league, is the suspect")
        for r in rails:
            print(f"             {r}")
        if args.strict:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
