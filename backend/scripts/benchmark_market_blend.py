"""Can the model add anything to the price you can actually take?

The reframing this script exists for
------------------------------------
Every benchmark in this repo has been scored against a column the code calls
"the closing line". It is not the closing line. `historical_data.py` reads
`PSH` / `B365H` from football-data.co.uk; the closing columns on that feed are
`PSCH` / `B365CH`, and **no file in this repository references them** (grep for
`PSC` or `B365C`: zero hits). What the warehouse holds is the price collected
before kickoff, not the number the market settled on.

That cuts two ways and both matter.

  * Every "gap to the market" figure is a gap to a SOFTER number than
    advertised. The real closing line is harder to beat than .5749.
  * But a pre-kickoff price is KNOWN AT SERVE TIME. The standing claim that
    market features cannot serve — the reason the single biggest measured
    feature block (-.0102 Brier, ten times anything else ever tested here) was
    left on the shelf — rests on the belief that the price only arrives after
    the match. If the column is the early price, it does not.

And beating the early price is the commercially meaningful target anyway. You
cannot bet the close; you bet what is on the board when you look. A model that
beats the opening line is a model with closing line value, which is the only
thing that predicts long-run profit.

What is measured
----------------
    market alone      de-vigged (Shin) price, the row to beat
    ratings alone     pi-ratings + Elo, no price anywhere
    blend             both, so the trees can disagree with the price

Rolling origin by season, paired bootstrap on the fixtures all three scored.
The blend only counts as a result if it beats the market row significantly —
matching it means the trees learned to copy the price, which is not an edge.

    python3 -m backend.scripts.benchmark_market_blend --min-season 2010

Writes backend/data/diagnostics/market_blend.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.benchmark_pi_ratings import (  # noqa: E402
    WAVE_A,
    build_pi_features,
    load_matches,
)
from backend.scripts.sweep_classifiers import elo_features  # noqa: E402
from backend.services.prediction.market import devig_shin, has_complete_odds  # noqa: E402

logger = logging.getLogger("benchmark_market_blend")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "market_blend.json"

MARKET_FEATURES = ["mkt_home", "mkt_draw", "mkt_away", "mkt_overround",
                   "mkt_fav_edge", "mkt_entropy"]


def brier(p: Sequence[float], idx: int) -> float:
    """Multiclass summed Brier; uniform 1/3 scores .6667."""
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def market_block(rows) -> Tuple[np.ndarray, np.ndarray]:
    """De-vigged price plus three shape features. Returns (X, priced_mask)."""
    X = np.full((len(rows), len(MARKET_FEATURES)), np.nan)
    priced = np.zeros(len(rows), dtype=bool)
    for i, r in enumerate(rows):
        oh, od, oa = r["oh"], r["od"], r["oa"]
        if not has_complete_odds(oh, od, oa):
            continue
        try:
            p = devig_shin(oh, od, oa)
        except Exception:  # noqa: BLE001 — a malformed price is not priced
            continue
        ph, pd, pa = float(p[0]), float(p[1]), float(p[2])
        book = 1.0 / oh + 1.0 / od + 1.0 / oa
        probs = np.array([ph, pd, pa])
        entropy = float(-(probs * np.log(np.clip(probs, 1e-9, 1))).sum())
        X[i] = [ph, pd, pa, book - 1.0, float(probs.max() - probs.min()), entropy]
        priced[i] = True
    return X, priced


def rolling(X: np.ndarray, y: np.ndarray, seasons: np.ndarray,
            test_seasons: Sequence[int]) -> np.ndarray:
    from sklearn.base import clone
    from sklearn.ensemble import HistGradientBoostingClassifier

    proto = HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.05, max_depth=3, l2_regularization=1.0,
        early_stopping=True, validation_fraction=0.15, random_state=17)
    out = np.full(len(y), np.nan)
    for s in test_seasons:
        tr = np.flatnonzero(seasons < s)
        te = np.flatnonzero(seasons == s)
        if len(tr) < 2000 or not len(te):
            continue
        m = clone(proto)
        m.fit(X[tr], y[tr])
        proba = m.predict_proba(X[te])
        for j, i in enumerate(te):
            out[i] = brier(proba[j], int(y[i]))
    return out


def paired(a: np.ndarray, b: np.ndarray, n: int = 4000, seed: int = 17) -> Dict:
    """P(a better than b) on the same fixtures."""
    rng = np.random.default_rng(seed)
    d = a - b
    idx = rng.integers(0, len(d), size=(n, len(d)))
    means = d[idx].mean(axis=1)
    return {"mean_delta": float(d.mean()),
            "ci_low": float(np.percentile(means, 2.5)),
            "ci_high": float(np.percentile(means, 97.5)),
            "p_better": float((means < 0).mean())}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--min-season", type=int, default=2010)
    ap.add_argument("--test-from", type=int, default=2016)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    import sqlite3
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")

    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]
    rows = load_matches(conn, comps)
    logger.info("%d matches", len(rows))

    Xpi, y, _ = build_pi_features(rows)
    Xelo = elo_features(conn, rows)
    Xmkt, priced = market_block(rows)
    seasons = np.array([int(r["season"] or 0) for r in rows])

    keep = priced & (seasons >= args.min_season)
    Xpi, Xelo, Xmkt, y, seasons = (Xpi[keep], Xelo[keep], Xmkt[keep],
                                   y[keep], seasons[keep])
    logger.info("priced corpus: %d fixtures, seasons %d-%d",
                len(y), seasons.min(), seasons.max())

    test_seasons = sorted({int(s) for s in seasons if s >= args.test_from})

    ratings = np.nan_to_num(np.hstack([Xpi, Xelo]), nan=0.0)
    blend = np.nan_to_num(np.hstack([Xpi, Xelo, Xmkt]), nan=0.0)

    # The price itself, scored directly — no model, no fitting.
    raw_market = np.array([brier(Xmkt[i, :3], int(y[i])) for i in range(len(y))])

    s_ratings = rolling(ratings, y, seasons, test_seasons)
    s_blend = rolling(blend, y, seasons, test_seasons)
    s_market_only = rolling(np.nan_to_num(Xmkt, nan=0.0), y, seasons, test_seasons)

    both = ~np.isnan(s_ratings) & ~np.isnan(s_blend) & ~np.isnan(s_market_only)
    n = int(both.sum())
    logger.info("\nscored on %d fixtures (%s-%s)\n", n, test_seasons[0], test_seasons[-1])

    table = [
        ("the price itself (Shin de-vig)", float(raw_market[both].mean())),
        ("price, recalibrated by a model", float(s_market_only[both].mean())),
        ("ratings only, no price", float(s_ratings[both].mean())),
        ("blend: ratings + price", float(s_blend[both].mean())),
    ]
    for label, v in table:
        logger.info("  %-32s brier %.5f", label, v)

    vs_price = paired(s_blend[both], raw_market[both])
    vs_ratings = paired(s_blend[both], s_ratings[both])
    logger.info("\nblend vs the raw price:  %+.5f  95%% CI [%+.5f, %+.5f]  p=%.3f",
                vs_price["mean_delta"], vs_price["ci_low"], vs_price["ci_high"],
                vs_price["p_better"])
    logger.info("blend vs ratings only:   %+.5f  95%% CI [%+.5f, %+.5f]  p=%.3f",
                vs_ratings["mean_delta"], vs_ratings["ci_low"],
                vs_ratings["ci_high"], vs_ratings["p_better"])

    beats_price = vs_price["ci_high"] < 0
    logger.info("\nverdict: %s", "the blend beats the price significantly"
                if beats_price else
                "no significant edge over the price — the trees are copying it")

    # Accuracy, because it is the number a person actually feels.
    acc_market = float(np.mean([Xmkt[i, :3].argmax() == y[i]
                                for i in np.flatnonzero(both)]))
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "caveat": {
            "which_price": "football-data PSH/B365H, read by historical_data.py. "
                           "These are NOT the closing columns (PSCH/B365CH), "
                           "which no file in this repo references. Treat every "
                           "'closing line' label in this codebase as suspect "
                           "until the feed's notes.txt is re-read.",
            "why_it_matters": "a pre-kickoff price is available at serve time, "
                              "so the market feature block may be servable after all",
        },
        "n_scored": n,
        "test_seasons": test_seasons,
        "brier": {k.replace(" ", "_"): round(v, 5) for k, v in table},
        "market_accuracy": round(acc_market, 4),
        "blend_vs_price": {k: round(v, 5) for k, v in vs_price.items()},
        "blend_vs_ratings": {k: round(v, 5) for k, v in vs_ratings.items()},
        "blend_beats_price_significantly": bool(beats_price),
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", op)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
