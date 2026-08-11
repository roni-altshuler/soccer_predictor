"""Where the model disagrees with the price, is the model ever right?

Why this is the question that is left
-------------------------------------
`benchmark_market_blend` settled the averages, and the answer was blunt:

    the price itself          .57279
    ratings, no price         .58575
    ratings + price blended   .57433   <- WORSE than the price alone,
                                          significantly (95% CI [+.0009, +.0022])

Nothing this project can build improves on the price on average. Handed both,
a gradient booster copies the price and adds noise. That closes off "make the
average better" as a route, and it is why adding more feature columns — from
FBref or anywhere else — is measurably the wrong direction: nine of the ten
feature groups ever ablated here made the model WORSE out of sample.

But a betting edge was never an average. It is conditional. The question that
survives is narrower and more useful: on the subset of fixtures where the model
and the price disagree by a lot, who wins? If the answer is "the price, always,
everywhere", the honest conclusion is that this model should be used to
understand matches and not to pick them. If there is a pocket where
disagreement pays, that pocket is the product.

Method
------
Model probabilities are rolling-origin and contain NO market feature, so the
disagreement is real rather than an artefact of the model having seen the
price. For every fixture x outcome, edge = p_model - p_market_devigged.
Buckets are formed on that edge and each is scored three ways:

  * hit rate — how often the outcome actually happened
  * the market's implied rate over the same fixtures
  * ROI at the ACTUAL offered decimal odds, vig included, because that is the
    number a person collects; a de-vigged ROI is a fantasy

The bucket boundaries are fixed in advance rather than chosen after looking,
and the ROI carries a bootstrap interval, because "positive in the tail" is
what noise looks like when you slice 18,000 fixtures forty ways.

    python3 -m backend.scripts.benchmark_edge_buckets --min-season 2010

Writes backend/data/diagnostics/edge_buckets.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.benchmark_market_blend import market_block  # noqa: E402
from backend.scripts.benchmark_pi_ratings import (  # noqa: E402
    WAVE_A,
    build_pi_features,
    load_matches,
)
from backend.scripts.sweep_classifiers import elo_features  # noqa: E402

logger = logging.getLogger("benchmark_edge_buckets")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "edge_buckets.json"

# Fixed before looking at anything. Choosing them afterwards is how a tail
# becomes a finding.
EDGE_BINS = [-1.0, -0.15, -0.10, -0.05, -0.02, 0.02, 0.05, 0.10, 0.15, 1.0]
OUTCOME_NAMES = ("home", "draw", "away")


def rolling_probs(X: np.ndarray, y: np.ndarray, seasons: np.ndarray,
                  test_seasons: Sequence[int]) -> np.ndarray:
    from sklearn.base import clone
    from sklearn.ensemble import HistGradientBoostingClassifier

    proto = HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.05, max_depth=3, l2_regularization=1.0,
        early_stopping=True, validation_fraction=0.15, random_state=17)
    out = np.full((len(y), 3), np.nan)
    for s in test_seasons:
        tr = np.flatnonzero(seasons < s)
        te = np.flatnonzero(seasons == s)
        if len(tr) < 2000 or not len(te):
            continue
        m = clone(proto)
        m.fit(X[tr], y[tr])
        out[te] = m.predict_proba(X[te])
    return out


def bootstrap_roi(profit: np.ndarray, n: int = 4000, seed: int = 17) -> Dict[str, float]:
    """Interval on mean profit per unit staked."""
    if len(profit) < 20:
        return {"roi": float(profit.mean()) if len(profit) else 0.0,
                "ci_low": float("nan"), "ci_high": float("nan")}
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(profit), size=(n, len(profit)))
    means = profit[idx].mean(axis=1)
    return {"roi": float(profit.mean()),
            "ci_low": float(np.percentile(means, 2.5)),
            "ci_high": float(np.percentile(means, 97.5))}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--min-season", type=int, default=2010)
    ap.add_argument("--test-from", type=int, default=2016)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")

    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]
    rows = load_matches(conn, comps)
    Xpi, y, _ = build_pi_features(rows)
    Xelo = elo_features(conn, rows)
    Xmkt, priced = market_block(rows)
    seasons = np.array([int(r["season"] or 0) for r in rows])
    odds = np.array([[r["oh"] or np.nan, r["od"] or np.nan, r["oa"] or np.nan]
                     for r in rows], dtype=np.float64)

    keep = priced & (seasons >= args.min_season)
    Xpi, Xelo, Xmkt, y, seasons, odds = (Xpi[keep], Xelo[keep], Xmkt[keep],
                                         y[keep], seasons[keep], odds[keep])
    ratings = np.nan_to_num(np.hstack([Xpi, Xelo]), nan=0.0)
    test_seasons = sorted({int(s) for s in seasons if s >= args.test_from})

    logger.info("%d priced fixtures; testing %s-%s",
                len(y), test_seasons[0], test_seasons[-1])
    P = rolling_probs(ratings, y, seasons, test_seasons)
    scored = ~np.isnan(P[:, 0])
    logger.info("model produced probabilities for %d\n", int(scored.sum()))

    # Flatten to one row per (fixture, outcome).
    idx = np.flatnonzero(scored)
    p_model = P[idx].reshape(-1)
    p_mkt = Xmkt[idx, :3].reshape(-1)
    price = odds[idx].reshape(-1)
    won = np.zeros((len(idx), 3), dtype=np.int8)
    won[np.arange(len(idx)), y[idx]] = 1
    won = won.reshape(-1)
    edge = p_model - p_mkt

    ok = np.isfinite(price) & (price > 1.0) & np.isfinite(edge)
    p_model, p_mkt, price, won, edge = (p_model[ok], p_mkt[ok], price[ok],
                                        won[ok], edge[ok])

    # Profit per unit staked, at the odds actually offered.
    profit = np.where(won == 1, price - 1.0, -1.0)

    logger.info("%-16s %7s %8s %8s %8s %9s %s", "edge bucket", "n", "model",
                "market", "actual", "ROI", "95% CI")
    buckets = []
    for lo, hi in zip(EDGE_BINS[:-1], EDGE_BINS[1:]):
        sel = (edge >= lo) & (edge < hi)
        if sel.sum() < 50:
            continue
        b = bootstrap_roi(profit[sel])
        entry = {
            "edge_low": lo, "edge_high": hi, "n": int(sel.sum()),
            "model_stated": round(float(p_model[sel].mean()), 4),
            "market_implied": round(float(p_mkt[sel].mean()), 4),
            "actual": round(float(won[sel].mean()), 4),
            "roi": round(b["roi"], 4),
            "roi_ci_low": round(b["ci_low"], 4), "roi_ci_high": round(b["ci_high"], 4),
            "profitable": bool(b["ci_low"] > 0),
        }
        buckets.append(entry)
        logger.info("%+.2f to %+.2f %7d %8.3f %8.3f %8.3f %+8.2f%%  [%+.1f%%, %+.1f%%]%s",
                    lo, hi, entry["n"], entry["model_stated"],
                    entry["market_implied"], entry["actual"], entry["roi"] * 100,
                    b["ci_low"] * 100, b["ci_high"] * 100,
                    "  <- profitable" if entry["profitable"] else "")

    # Same question, split by which outcome is being backed. Draws are the
    # model's known blind spot and deserve to be looked at separately rather
    # than averaged into the home/away rows.
    per_outcome = []
    which = np.tile(np.arange(3), len(idx))[ok]
    for o in range(3):
        sel = (which == o) & (edge > 0.05)
        if sel.sum() < 50:
            continue
        b = bootstrap_roi(profit[sel])
        per_outcome.append({
            "outcome": OUTCOME_NAMES[o], "n": int(sel.sum()),
            "actual": round(float(won[sel].mean()), 4),
            "market_implied": round(float(p_mkt[sel].mean()), 4),
            "roi": round(b["roi"], 4), "roi_ci_low": round(b["ci_low"], 4),
            "roi_ci_high": round(b["ci_high"], 4),
            "profitable": bool(b["ci_low"] > 0)})

    logger.info("\nbacking a >5pp edge, by outcome:")
    for e in per_outcome:
        logger.info("  %-6s n=%5d actual %.3f vs market %.3f  ROI %+6.2f%%  "
                    "[%+.1f%%, %+.1f%%]%s", e["outcome"], e["n"], e["actual"],
                    e["market_implied"], e["roi"] * 100, e["roi_ci_low"] * 100,
                    e["roi_ci_high"] * 100,
                    "  <- profitable" if e["profitable"] else "")

    any_profitable = any(b["profitable"] for b in buckets) or \
        any(e["profitable"] for e in per_outcome)
    logger.info("\nverdict: %s", (
        "at least one slice is profitable at 95% — treat as a lead, not a "
        "strategy, until it holds out of sample forward"
        if any_profitable else
        "no slice is profitable at 95%. The price is better than this model "
        "everywhere it was asked, including where they disagree most."))

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "model": "pi-ratings + Elo, gradient boosted, rolling origin. NO "
                     "market feature, so the disagreement is genuine",
            "roi": "at the offered decimal odds, vig included",
            "bins": EDGE_BINS,
            "bins_fixed_in_advance": True,
            "price_caveat": "the warehouse odds column is football-data's "
                            "PSH/B365H, not the closing PSCH/B365CH",
        },
        "n_fixtures": int(scored.sum()),
        "n_bets_considered": int(len(profit)),
        "test_seasons": test_seasons,
        "buckets": buckets,
        "by_outcome_over_5pp": per_outcome,
        "any_slice_profitable": bool(any_profitable),
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", op)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
