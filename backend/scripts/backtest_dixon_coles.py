"""Walk-forward backtest of the Dixon-Coles baseline — THE YARDSTICK REPORT.

THIN SHIM: the per-block scoring loop now lives in
``backend/scripts/_backtest_core.py`` (the pluggable harness that also scores
the Match Engine — see ``backend/scripts/backtest.py``). This module keeps the
historical CLI and report format byte-for-byte so existing commands and docs
do not break; it simply runs the core with the Dixon-Coles predictor only.

For the most recent *complete* season of each requested competition, walk
forward matchday-by-matchday: fit Dixon-Coles on everything strictly before the
matchday (last N seasons, time-decayed to the matchday date), predict every
match in it, then score the predictions with multiclass Brier and log-loss
against two baselines:

  (a) uniform 1/3-1/3-1/3, and
  (b) the bookmaker market, de-vigged by normalising implied probabilities
      (1/odds), on the subset of matches carrying odds_home/draw/away.

Honesty note: the market is a strong predictor — Dixon-Coles *losing to the
market everywhere is the expected result and fine*. What the baseline must do
is crush uniform; that is the bar the Match Engine later has to clear against
Dixon-Coles itself (VISION_2030 §8).

The warehouse is ALWAYS opened strictly read-only.

Run
---
    python -m backend.scripts.backtest_dixon_coles --competitions eng.1
    python -m backend.scripts.backtest_dixon_coles \
        --competitions eng.1 esp.1 --season 2024 --seasons 5
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts._backtest_core import (  # noqa: E402,F401 — re-exported API
    MIN_FIT_MATCHES,
    SEASON_COMPLETE_GRACE_DAYS,
    CompetitionReport,
    DixonColesPredictor,
    ScoreAccumulator,
    brier,
    devig,
    latest_complete_season,
    load_season_matches,
    log_loss,
    matchday_blocks,
    outcome_index,
    run_backtest,
)
from backend.scripts.train_dixon_coles import (  # noqa: E402,F401 — re-exported
    WAREHOUSE_PATH,
    connect_readonly,
    dominant_source,
    load_competition_matches,
)
from backend.services.prediction.dixon_coles import (  # noqa: E402,F401
    DEFAULT_HALF_LIFE_DAYS,
)

DC = DixonColesPredictor.name  # "dixon_coles"


# ---------------------------------------------------------------------------
# Report printing (historical format, unchanged)
# ---------------------------------------------------------------------------
def print_report(reports: List[CompetitionReport]) -> None:
    line = "-" * 78
    print()
    print("=" * 78)
    print("DIXON-COLES WALK-FORWARD BACKTEST — THE YARDSTICK REPORT")
    print("(lower Brier / log-loss is better; DC must crush uniform;")
    print(" losing to the de-vigged market is expected — the market is strong)")
    print("=" * 78)
    for r in reports:
        dc_all = r.all_acc[DC]
        dc_mkt = r.odds_acc[DC]
        print()
        print(
            f"{r.competition_id}  season {r.season}  (source={r.source}, "
            f"{dc_all.n} matches scored across {r.n_blocks} matchday blocks"
            + (f", {r.skipped} skipped: insufficient history" if r.skipped else "")
            + ")"
        )
        print(line)
        print(f"{'model':<26}{'n':>6}{'Brier':>10}{'log-loss':>10}{'top-1 acc':>11}")
        print(line)
        rows: List[Tuple[str, ScoreAccumulator]] = [
            ("Dixon-Coles (all)", dc_all),
            ("Uniform 1/3 (all)", r.uni_all),
        ]
        if r.mkt.n:
            rows += [
                ("Dixon-Coles (odds subset)", dc_mkt),
                ("Market de-vig (odds subset)", r.mkt),
                ("Uniform 1/3 (odds subset)", r.uni_mkt),
            ]
        for label, acc in rows:
            print(
                f"{label:<26}{acc.n:>6}{acc.brier:>10.4f}"
                f"{acc.logloss:>10.4f}{acc.accuracy:>11.3f}"
            )
        print(line)
        if r.uni_all.n:
            d_brier = r.uni_all.brier - dc_all.brier
            print(f"  vs uniform: Brier {'-' if d_brier >= 0 else '+'}"
                  f"{abs(d_brier):.4f} "
                  f"({'DC better' if d_brier > 0 else 'DC WORSE — investigate'})")
        if r.mkt.n:
            d_brier_m = r.mkt.brier - dc_mkt.brier
            verdict = "DC beats the market" if d_brier_m > 0 else \
                "market better (expected)"
            print(f"  vs market:  Brier {'+' if d_brier_m < 0 else '-'}"
                  f"{abs(d_brier_m):.4f} ({verdict})")
        else:
            print("  vs market:  no odds columns for this competition/source")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Walk-forward backtest for the Dixon-Coles baseline."
    )
    parser.add_argument(
        "--competitions",
        nargs="+",
        default=["eng.1"],
        help="Competition ids to backtest (default: eng.1)",
    )
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="Season label to backtest (default: latest complete season)",
    )
    parser.add_argument(
        "--seasons",
        type=int,
        default=5,
        help="Training window: last N seasons before each matchday (default 5)",
    )
    parser.add_argument(
        "--half-life",
        type=float,
        default=DEFAULT_HALF_LIFE_DAYS,
        help=f"Time-decay half-life in days (default {DEFAULT_HALF_LIFE_DAYS:.0f})",
    )
    parser.add_argument(
        "--warehouse",
        type=Path,
        default=WAREHOUSE_PATH,
        help="Path to warehouse.sqlite (opened read-only)",
    )
    args = parser.parse_args(argv)

    con = connect_readonly(args.warehouse)
    try:
        reports, _records = run_backtest(
            con,
            predictors=[DixonColesPredictor()],
            competitions=args.competitions,
            season=args.season,
            n_seasons=args.seasons,
            half_life_days=args.half_life,
        )
    finally:
        con.close()

    if not reports:
        print("Nothing to report.")
        return 1
    print_report(reports)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
