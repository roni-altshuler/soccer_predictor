"""Turn the season-projection backtest's measured miscalibration into a fix.

The Monte Carlo is overconfident in the middle-to-high band, and the backtest
measures exactly how much. From `season_projection_summary.json`, over 20,324
scored team-seasons:

    relegation   stated 85%  ->  happened 76%       ECE .0224
    top-4        stated 85%  ->  happened 80%       ECE .0101
    title        stated 85%  ->  happened 78%       ECE .0033

Until now that measurement was *printed* next to the projections as a caveat.
A caveat is the right thing to do with an error you cannot correct; this one is
correctable. A reader shown "86%" and, separately, "when we say 85% it happens
78%" is being asked to do arithmetic the page could have done.

WHAT THIS FITS. Isotonic regression of observed frequency on stated
probability, per metric, weighted by bin population. Isotonic is the right
family here because the only structure worth assuming is monotonicity — a team
the simulator likes more should not end up with a lower calibrated probability —
and unlike a Platt sigmoid it can follow a curve that is well calibrated at the
bottom and sags in the middle, which is what this one does.

The output is a knot table (stated -> calibrated), interpolated linearly
between knots by the consumer. A table rather than a pickle so the frontend can
apply the same mapping as the backend without a Python runtime, and so the
correction is readable in a diff.

WHAT THIS DELIBERATELY DOES NOT DO. It does not touch the simulator. The
Monte Carlo keeps producing what it produces, the backtest keeps scoring the
raw output, and this mapping sits at the display edge. Folding the correction
into the simulator would make the next backtest score the corrected numbers
and measure a calibration that had already been applied — the loop that makes a
model look better every time it is measured.

Usage:
    python -m backend.scripts.fit_projection_calibrator
    python -m backend.scripts.fit_projection_calibrator --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from sklearn.isotonic import IsotonicRegression

DIAGNOSTICS = Path(__file__).resolve().parents[1] / "data" / "diagnostics"
BACKTEST_PATH = DIAGNOSTICS / "season_projection_summary.json"
OUTPUT_PATH = DIAGNOSTICS / "projection_calibrator.json"

# Metrics whose probabilities the product displays, and the total probability
# mass each one carries across a league. Renormalising to this after mapping is
# what keeps "20 teams' title chances" summing to one club winning the league.
METRIC_MASS: Dict[str, Optional[float]] = {
    "title": 1.0,      # exactly one champion
    "relegation": 3.0,  # the simulator's own hardcoded three down
    "top_4": 4.0,
}

# A bin below this many observations moves the curve on noise. The backtest's
# lowest bucket carries 14k points and its middle ones a few hundred, so this
# only ever excludes genuinely empty buckets.
MIN_BIN_N = 30


def fit_metric(bins: List[dict]) -> Optional[Dict]:
    """Isotonic knots mapping stated probability to observed frequency."""
    usable = [b for b in bins if b.get("n", 0) >= MIN_BIN_N]
    if len(usable) < 3:
        return None

    x = np.array([b["mean_predicted"] for b in usable], dtype=float)
    y = np.array([b["observed_frequency"] for b in usable], dtype=float)
    w = np.array([b["n"] for b in usable], dtype=float)

    iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip")
    fitted = iso.fit_transform(x, y, sample_weight=w)

    # Anchor both ends. Without (0,0) and (1,1) the consumer has to guess what
    # happens outside the observed range, and "certain" must stay certain.
    knots = [(0.0, 0.0)]
    for xi, yi in zip(x, fitted):
        knots.append((round(float(xi), 6), round(float(yi), 6)))
    knots.append((1.0, 1.0))

    # Strictly increasing in x, non-decreasing in y — the interpolation contract.
    cleaned: List[tuple] = []
    for xi, yi in sorted(knots):
        if cleaned and xi <= cleaned[-1][0]:
            continue
        if cleaned and yi < cleaned[-1][1]:
            yi = cleaned[-1][1]
        cleaned.append((xi, yi))

    ece_before = float(np.sum(w * np.abs(x - y)) / np.sum(w))
    ece_after = float(np.sum(w * np.abs(fitted - y)) / np.sum(w))
    return {
        "knots": [[a, b] for a, b in cleaned],
        "n": int(w.sum()),
        "ece_before": round(ece_before, 6),
        "ece_after_in_sample": round(ece_after, 6),
        "largest_correction": round(float(np.max(np.abs(fitted - x))), 6),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--backtest", type=Path, default=BACKTEST_PATH)
    ap.add_argument("--output", type=Path, default=OUTPUT_PATH)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    if not args.backtest.exists():
        print(f"backtest artifact not found at {args.backtest}", file=sys.stderr)
        print("run: python -m backend.scripts.backtest_season_projections", file=sys.stderr)
        return 2

    payload = json.loads(args.backtest.read_text())
    by_metric = (payload.get("calibration") or {}).get("by_metric") or {}
    if not by_metric:
        print("backtest has no per-metric calibration block", file=sys.stderr)
        return 2

    metrics: Dict[str, Dict] = {}
    for name, mass in METRIC_MASS.items():
        block = by_metric.get(name)
        if not block:
            print(f"  {name:12} no calibration block — skipped")
            continue
        fitted = fit_metric(block.get("bins") or [])
        if fitted is None:
            print(f"  {name:12} too few populated bins — skipped")
            continue
        fitted["renormalise_to"] = mass
        metrics[name] = fitted
        print(
            f"  {name:12} {fitted['n']:>6} points   "
            f"ECE {fitted['ece_before']:.4f} -> {fitted['ece_after_in_sample']:.4f}   "
            f"largest correction {fitted['largest_correction']:+.3f}"
        )

    if not metrics:
        print("nothing fitted", file=sys.stderr)
        return 1

    report = {
        "artifact": "projection_calibrator",
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": "backend/scripts/fit_projection_calibrator.py",
        "source": str(args.backtest.name),
        "source_generated_at": payload.get("generated_at"),
        "method": "isotonic regression of observed frequency on stated probability, "
                  "weighted by bin population, anchored at (0,0) and (1,1)",
        "how_to_apply": "piecewise-linear interpolation between knots, then rescale the "
                        "league's calibrated values so they sum to renormalise_to",
        "in_sample_warning": "ece_after_in_sample is fitted on the same bins it is scored "
                             "on and is therefore optimistic; the honest test is the next "
                             "backtest run, which scores the RAW simulator output",
        "metrics": metrics,
    }

    if args.dry_run:
        print("\nDRY RUN — not written")
        return 0
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nWrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
