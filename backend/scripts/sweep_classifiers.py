"""Sweep tree classifiers over rating features, and say which features earned it.

Where this comes from
---------------------
The approach is the one Green Code applies to Wimbledon in
`jdlamstein/tennispredictor`: Elo-style ratings as the primary skill signal,
tree ensembles (random forest, XGBoost) over them, a sweep across
hyperparameters to find the best configuration, feature importance to see what
the trees leaned on, and a train-on-all-previous-years / test-on-this-year
split.

Every one of those transfers. The expected payoff does not, and it is worth
being explicit about why before reading any number below:

  tennis                          soccer
  binary — someone wins           three-way, and 25.6% of matches are drawn
  one player, one rating          eleven players, rotation, injuries
  favourite wins ~70%             home side wins 43%; the closing line gets 54%

A 93% accuracy in tennis and a 93% accuracy in soccer are not the same claim;
the second is not attainable. On this corpus the closing line — thousands of
bettors and professional syndicates — reaches 54.0%. That is the ceiling.

The guard that makes a sweep meaningful
---------------------------------------
Searching many configurations and reporting the best one is how a sweep
manufactures a result: with enough candidates something wins on noise. So the
search happens on SELECTION seasons only, and the winner is then scored once on
FINAL seasons it has never been fitted or chosen on. The gap between those two
numbers is the honest cost of the search, and it is reported.

    python3 -m backend.scripts.sweep_classifiers --min-season 2015

Writes backend/data/diagnostics/classifier_sweep.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sqlite3
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.inspection import permutation_importance

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.benchmark_pi_ratings import (  # noqa: E402
    WAVE_A,
    build_pi_features,
    load_matches,
)

logger = logging.getLogger("sweep_classifiers")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "classifier_sweep.json"

FEATURE_NAMES = [
    "pi_home_at_home", "pi_home_away", "pi_away_at_home", "pi_away_away",
    "pi_matchup", "pi_home_mean", "pi_away_mean", "pi_expected_gd",
    "elo_home", "elo_away", "elo_diff",
]


def brier(p: Sequence[float], idx: int) -> float:
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def candidates() -> List[Tuple[str, object]]:
    """The grid. Deliberately small — every extra candidate buys noise."""
    out: List[Tuple[str, object]] = []
    for lr in (0.03, 0.06, 0.12):
        for depth in (3, 4, 6):
            out.append((
                f"hgb_lr{lr}_d{depth}",
                HistGradientBoostingClassifier(
                    max_iter=400, learning_rate=lr, max_depth=depth,
                    l2_regularization=1.0, early_stopping=True,
                    validation_fraction=0.15, random_state=17),
            ))
    for n in (300, 600):
        for leaf in (20, 60):
            out.append((
                f"rf_n{n}_leaf{leaf}",
                RandomForestClassifier(
                    n_estimators=n, min_samples_leaf=leaf, n_jobs=-1,
                    random_state=17),
            ))
    try:
        from xgboost import XGBClassifier
        for lr in (0.03, 0.08):
            for depth in (3, 5):
                out.append((
                    f"xgb_lr{lr}_d{depth}",
                    XGBClassifier(
                        n_estimators=500, learning_rate=lr, max_depth=depth,
                        subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
                        objective="multi:softprob", num_class=3,
                        tree_method="hist", random_state=17, verbosity=0),
                ))
    except ImportError:
        logger.warning("xgboost not installed — skipping that family")
    return out


def elo_features(conn: sqlite3.Connection, rows: Sequence[sqlite3.Row]) -> np.ndarray:
    """Last ClubElo published strictly before kickoff, per side."""
    import bisect
    idx: Dict[int, Tuple[List[str], List[float]]] = {}
    for r in conn.execute("SELECT team_id, date, elo FROM clubelo_ratings ORDER BY team_id, date"):
        d, e = idx.setdefault(int(r[0]), ([], []))
        d.append(r[1])
        e.append(float(r[2]))

    def at(team_id, date):
        ent = idx.get(team_id)
        if not ent:
            return np.nan
        dates, elos = ent
        i = bisect.bisect_left(dates, date)
        return elos[i - 1] if i > 0 else np.nan

    out = np.empty((len(rows), 3), dtype=np.float64)
    for i, r in enumerate(rows):
        h = at(int(r["home_team_id"]), r["date_utc"])
        a = at(int(r["away_team_id"]), r["date_utc"])
        out[i] = (h, a, (h - a) if (h == h and a == a) else np.nan)
    return out


def score(model, X, y, tr, te) -> Tuple[float, float, np.ndarray]:
    model.fit(X[tr], y[tr])
    proba = model.predict_proba(X[te])
    b = float(np.mean([brier(proba[j], int(y[i])) for j, i in enumerate(te)]))
    acc = float(np.mean(proba.argmax(axis=1) == y[te]))
    return b, acc, proba


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--min-season", type=int, default=2015)
    ap.add_argument("--final-seasons", type=int, default=2,
                    help="most recent N seasons held out of the search entirely")
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]

    rows = load_matches(conn, comps)
    Xpi, y, _ = build_pi_features(rows)
    Xelo = elo_features(conn, rows)
    X = np.hstack([Xpi, Xelo])
    # Trees here handle NaN natively except RandomForest, which does not.
    X = np.nan_to_num(X, nan=0.0)
    seasons = np.array([int(r["season"] or 0) for r in rows])

    all_test = sorted({int(s) for s in seasons if s >= args.min_season})
    final = all_test[-args.final_seasons:]
    selection = [s for s in all_test if s not in final]
    logger.info("selection seasons %s | final holdout %s (never searched on)",
                selection, final)

    grid = candidates()
    logger.info("%d candidate configurations", len(grid))

    # --- search, on selection seasons only ------------------------------------
    results = []
    for name, model in grid:
        briers, accs, n = [], [], 0
        for ts in selection:
            tr = np.flatnonzero(seasons < ts)
            te = np.flatnonzero(seasons == ts)
            if len(tr) < 2000 or not len(te):
                continue
            b, a, _ = score(model, X, y, tr, te)
            briers.append(b)
            accs.append(a)
            n += len(te)
        if not briers:
            continue
        entry = {"config": name, "selection_brier": round(float(np.mean(briers)), 5),
                 "selection_accuracy": round(float(np.mean(accs)), 4), "n": n}
        results.append(entry)
        logger.info("  %-22s brier=%.5f acc=%.4f", name, entry["selection_brier"],
                    entry["selection_accuracy"])

    results.sort(key=lambda e: e["selection_brier"])
    best_name = results[0]["config"]
    best_model = dict(grid)[best_name]
    logger.info("\nbest on selection: %s (brier %.5f)", best_name, results[0]["selection_brier"])

    # --- score the winner ONCE on seasons the search never saw ----------------
    fb, fa, fn = [], [], 0
    for ts in final:
        tr = np.flatnonzero(seasons < ts)
        te = np.flatnonzero(seasons == ts)
        if len(tr) < 2000 or not len(te):
            continue
        b, a, _ = score(best_model, X, y, tr, te)
        fb.append(b)
        fa.append(a)
        fn += len(te)
    final_brier = float(np.mean(fb)) if fb else float("nan")
    final_acc = float(np.mean(fa)) if fa else float("nan")
    search_cost = final_brier - results[0]["selection_brier"]

    logger.info("final holdout %s: brier=%.5f acc=%.4f  (search cost %+.5f)",
                final, final_brier, final_acc, search_cost)

    # --- what did it lean on? -------------------------------------------------
    # Permutation importance, not gini. Gini importance is biased toward
    # high-cardinality continuous features and is computed on the training data,
    # so it reports what the tree USED rather than what actually helps out of
    # sample — with correlated ratings features that is a meaningful difference.
    tr = np.flatnonzero(seasons < final[0])
    te = np.flatnonzero(seasons >= final[0])
    best_model.fit(X[tr], y[tr])
    perm = permutation_importance(best_model, X[te], y[te], n_repeats=8,
                                  random_state=17, scoring="neg_log_loss", n_jobs=-1)
    importance = sorted(
        ({"feature": FEATURE_NAMES[i],
          "importance": round(float(perm.importances_mean[i]), 5),
          "std": round(float(perm.importances_std[i]), 5)}
         for i in range(len(FEATURE_NAMES))),
        key=lambda d: -d["importance"],
    )
    logger.info("\npermutation importance (higher = removing it hurts more):")
    for e in importance:
        logger.info("  %-20s %+.5f ± %.5f", e["feature"], e["importance"], e["std"])

    out = {
        "method": {
            "inspiration": "jdlamstein/tennispredictor — Elo + tree ensembles + sweep",
            "features": FEATURE_NAMES,
            "ratings_strictly_pre_match": True,
            "selection_seasons": selection,
            "final_seasons": final,
            "search_guard": "the winner is scored once on seasons never searched on; "
                            "the selection-to-final gap is the cost of the search",
            "importance": "permutation on held-out seasons, not gini on training data",
            "brier": "multiclass summed; uniform 1/3 = .6667",
        },
        "candidates": results,
        "best": {
            "config": best_name,
            "selection_brier": results[0]["selection_brier"],
            "final_brier": round(final_brier, 5),
            "final_accuracy": round(final_acc, 4),
            "search_cost_brier": round(search_cost, 5),
            "n_final": fn,
        },
        "permutation_importance": importance,
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(out, indent=2))
    logger.info("\nwrote %s", op)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
