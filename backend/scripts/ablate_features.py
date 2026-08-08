"""Feature ablation harness — strictly temporal, market-referenced.

The engine already carries 87 features and scores Brier .6324 against a .6414
constant baseline. Adding more features without evidence adds variance. This
script is the evidence: it measures every candidate group in
`backend/services/prediction/features_v2.py` out of sample and reports what
each one is actually worth.

Method
------
* **Rolling-origin temporal folds.** Fold *k* trains on every season strictly
  before its test season and tests on that season alone. There is no random
  k-fold anywhere, and no shuffling: the 60.56%-holdout / 46%-live gap is
  exactly what random or feature-skewed evaluation produces.
* **Pooled scoring.** Out-of-sample predictions from every fold are pooled and
  scored once, so a variant's headline number covers several complete seasons.
* **Reference rows.** Uniform 1/3, the constant base rate computed on each
  fold's *training* seasons, and the de-vigged closing line are scored on the
  identical fixtures, so every delta is read against the real target.
* **Paired market block.** Because closing odds are missing for ~4% of rows,
  a second table restricts every variant to the fixtures where the market has
  a price, which is the only apples-to-apples model-vs-market comparison.
* **Greedy forward selection** runs on the earlier ("selection") folds only,
  and the winning set is then scored on later ("final") folds it never saw —
  so the selection itself is not evaluated in-sample.

Usage
-----
    .venv/bin/python -m backend.scripts.ablate_features
    .venv/bin/python -m backend.scripts.ablate_features --models logreg,hgb
    .venv/bin/python -m backend.scripts.ablate_features --test-seasons 2023,2024,2025

Output
------
    backend/data/diagnostics/feature_ablation.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.services.prediction.features_v2 import (
    ALL_FEATURE_NAMES,
    CANDIDATE_GROUPS,
    EUROPEAN_COMPETITIONS,
    FEATURE_GROUPS,
    WAVE_A_COMPETITIONS,
    build_feature_frame,
    no_vig_probabilities,
)

logger = logging.getLogger("ablate_features")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = REPO_ROOT / "backend" / "data" / "warehouse.sqlite"
DEFAULT_OUT = REPO_ROOT / "backend" / "data" / "diagnostics" / "feature_ablation.json"

EPS = 1e-12


# --------------------------------------------------------------------------
# metrics
# --------------------------------------------------------------------------


def _onehot(y: np.ndarray) -> np.ndarray:
    out = np.zeros((y.shape[0], 3), dtype=np.float64)
    out[np.arange(y.shape[0]), y] = 1.0
    return out


def score(probs: np.ndarray, y: np.ndarray) -> Dict[str, float]:
    """Multiclass Brier (sum-of-squares convention), log loss, accuracy, RPS.

    The Brier convention matches `docs/PIVOT_2026-08.md`: uniform 1/3 scores
    .6667 and the published engine scores .6324, so numbers here are directly
    comparable to the figures that triggered the pivot.
    """
    p = np.clip(np.asarray(probs, dtype=np.float64), EPS, 1.0)
    p = p / p.sum(axis=1, keepdims=True)
    oh = _onehot(y)
    brier = float(np.mean(np.sum((p - oh) ** 2, axis=1)))
    ll = float(-np.mean(np.log(p[np.arange(y.shape[0]), y])))
    acc = float(np.mean(np.argmax(p, axis=1) == y))
    # RPS over the ordered outcome scale home < draw < away
    cum_p = np.cumsum(p, axis=1)[:, :2]
    cum_y = np.cumsum(oh, axis=1)[:, :2]
    rps = float(np.mean(np.sum((cum_p - cum_y) ** 2, axis=1) / 2.0))
    return {
        "brier": round(brier, 6),
        "log_loss": round(ll, 6),
        "accuracy": round(acc, 6),
        "rps": round(rps, 6),
        "n": int(y.shape[0]),
    }


# --------------------------------------------------------------------------
# model factories
# --------------------------------------------------------------------------


def make_model(kind: str):
    from sklearn.compose import ColumnTransformer  # noqa: F401  (kept for clarity)
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    if kind == "logreg":
        return Pipeline(
            [
                ("impute", SimpleImputer(strategy="median")),
                ("scale", StandardScaler()),
                ("clf", LogisticRegression(C=0.5, max_iter=2000, n_jobs=1)),
            ]
        )
    if kind == "hgb":
        return Pipeline(
            [
                (
                    "clf",
                    HistGradientBoostingClassifier(
                        max_iter=200,
                        learning_rate=0.06,
                        max_leaf_nodes=15,
                        min_samples_leaf=60,
                        l2_regularization=1.0,
                        early_stopping=False,
                        random_state=0,
                    ),
                )
            ]
        )
    raise ValueError(f"unknown model kind: {kind}")


# --------------------------------------------------------------------------
# fold machinery
# --------------------------------------------------------------------------


class Dataset:
    """Feature matrix plus everything the splitter and the market need."""

    def __init__(self, X: np.ndarray, y: np.ndarray, meta: List[Dict[str, object]]):
        self.X = X
        self.y = y
        self.meta = meta
        self.season = np.array([int(m["season"]) for m in meta], dtype=np.int64)
        self.index = {name: i for i, name in enumerate(ALL_FEATURE_NAMES)}
        market = np.full((X.shape[0], 3), np.nan, dtype=np.float64)
        for i, m in enumerate(meta):
            devig = no_vig_probabilities(m["odds_home"], m["odds_draw"], m["odds_away"])
            if devig:
                market[i] = devig[:3]
        self.market = market
        self.has_market = ~np.isnan(market[:, 0])

    def columns(self, groups: Sequence[str]) -> np.ndarray:
        cols: List[int] = []
        for g in groups:
            cols.extend(self.index[name] for name in FEATURE_GROUPS[g])
        return np.array(cols, dtype=np.int64)

    def group_coverage(self) -> Dict[str, Dict[str, float]]:
        """Per-group diagnostics so an all-zero group is never read as 'no effect'."""
        out: Dict[str, Dict[str, float]] = {}
        for g, names in FEATURE_GROUPS.items():
            cols = self.columns([g])
            block = self.X[:, cols]
            const = int(np.sum(np.nanstd(block, axis=0) < 1e-12))
            entry = {
                "n_features": len(names),
                "n_constant_features": const,
                "usable": bool(const < len(names)),
            }
            for flag in (
                "ref_has_referee",
                "wx_has_weather",
                "xg_has_data",
                "ce_has_rating",
                "mkt_has_odds",
                "cal_has_real_kickoff_time",
            ):
                if flag in names:
                    entry["coverage_flag"] = flag
                    entry["coverage_rate"] = round(
                        float(np.mean(self.X[:, self.index[flag]])), 4
                    )
            out[g] = entry
        return out


def make_folds(seasons: Sequence[int], data: Dataset, min_train: int = 800) -> List[Dict]:
    folds = []
    for s in seasons:
        train_mask = data.season < s
        test_mask = data.season == s
        if int(train_mask.sum()) < min_train or int(test_mask.sum()) == 0:
            logger.warning(
                "skipping test season %s (train=%d test=%d)",
                s,
                int(train_mask.sum()),
                int(test_mask.sum()),
            )
            continue
        folds.append({"test_season": int(s), "train": train_mask, "test": test_mask})
    return folds


def run_variant(
    data: Dataset, groups: Sequence[str], folds: Sequence[Dict], model_kind: str
) -> Tuple[np.ndarray, np.ndarray, List[Dict]]:
    """Return (pooled_probs, pooled_row_indices, per_fold_metrics)."""
    cols = data.columns(groups)
    probs_parts: List[np.ndarray] = []
    idx_parts: List[np.ndarray] = []
    per_fold: List[Dict] = []
    for fold in folds:
        tr, te = fold["train"], fold["test"]
        model = make_model(model_kind)
        model.fit(data.X[tr][:, cols], data.y[tr])
        p = model.predict_proba(data.X[te][:, cols])
        # guard against a fold whose training seasons lack a class
        if p.shape[1] != 3:
            full = np.full((p.shape[0], 3), EPS)
            for j, cls in enumerate(model.classes_):
                full[:, int(cls)] = p[:, j]
            p = full / full.sum(axis=1, keepdims=True)
        probs_parts.append(p)
        idx_parts.append(np.where(te)[0])
        per_fold.append({"test_season": fold["test_season"], **score(p, data.y[te])})
    return np.vstack(probs_parts), np.concatenate(idx_parts), per_fold


def reference_rows(data: Dataset, folds: Sequence[Dict]) -> Dict[str, Tuple[np.ndarray, np.ndarray]]:
    """Baseline probability streams on the identical pooled fixtures."""
    idx_parts, uni_parts, base_parts, mkt_parts = [], [], [], []
    for fold in folds:
        tr, te = fold["train"], fold["test"]
        n = int(te.sum())
        idx_parts.append(np.where(te)[0])
        uni_parts.append(np.full((n, 3), 1.0 / 3.0))
        counts = np.bincount(data.y[tr], minlength=3).astype(np.float64)
        rate = counts / counts.sum()
        base_parts.append(np.tile(rate, (n, 1)))
        mkt_parts.append(data.market[te])
    idx = np.concatenate(idx_parts)
    return {
        "uniform_third": (np.vstack(uni_parts), idx),
        "constant_base_rate_train": (np.vstack(base_parts), idx),
        "market_closing_novig": (np.vstack(mkt_parts), idx),
    }


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------


def variant_report(
    name: str,
    groups: Sequence[str],
    probs: np.ndarray,
    idx: np.ndarray,
    data: Dataset,
    per_fold: List[Dict],
    baseline: Optional[Dict[str, float]],
    paired_mask: np.ndarray,
) -> Dict:
    y = data.y[idx]
    overall = score(probs, y)
    entry: Dict[str, object] = {
        "variant": name,
        "groups": list(groups),
        "n_features": int(sum(len(FEATURE_GROUPS[g]) for g in groups)) if groups else 0,
        **overall,
        "per_fold": per_fold,
    }
    sub = paired_mask
    if sub.any():
        entry["paired_vs_market"] = score(probs[sub], y[sub])
    if baseline:
        entry["delta_vs_baseline"] = {
            "brier": round(overall["brier"] - baseline["brier"], 6),
            "log_loss": round(overall["log_loss"] - baseline["log_loss"], 6),
            "accuracy": round(overall["accuracy"] - baseline["accuracy"], 6),
            "rps": round(overall["rps"] - baseline["rps"], 6),
        }
        entry["verdict"] = verdict_for(entry["delta_vs_baseline"])
    return entry


def verdict_for(delta: Dict[str, float], noise_band: float = 0.0005) -> str:
    """Lower Brier is better. A change inside the noise band is 'neutral'."""
    d = delta["brier"]
    if d < -noise_band:
        return "HELPS"
    if d > noise_band:
        return "HARMFUL"
    return "neutral"


def paired_bootstrap_p(
    probs_a: np.ndarray, probs_b: np.ndarray, y: np.ndarray, n_boot: int = 2000, seed: int = 0
) -> float:
    """P(variant is not better than baseline) from a paired bootstrap on Brier."""
    rng = np.random.default_rng(seed)
    oh = _onehot(y)
    la = np.sum((np.clip(probs_a, EPS, 1) - oh) ** 2, axis=1)
    lb = np.sum((np.clip(probs_b, EPS, 1) - oh) ** 2, axis=1)
    diff = la - lb  # negative => a (variant) better
    n = diff.shape[0]
    draws = rng.integers(0, n, size=(n_boot, n))
    means = diff[draws].mean(axis=1)
    return float(np.mean(means >= 0.0))


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--competitions", default=",".join(WAVE_A_COMPETITIONS))
    ap.add_argument("--min-season", type=int, default=2015)
    ap.add_argument(
        "--test-seasons",
        default="2021,2022,2023,2024,2025",
        help="rolling-origin test seasons; each trains on everything strictly before it",
    )
    ap.add_argument(
        "--selection-seasons",
        default="2021,2022,2023",
        help="folds used by greedy forward selection (must be a prefix of --test-seasons)",
    )
    ap.add_argument("--models", default="logreg", help="comma list: logreg,hgb")
    ap.add_argument("--greedy-model", default="logreg")
    ap.add_argument("--no-greedy", action="store_true")
    ap.add_argument("--bootstrap", type=int, default=2000)
    ap.add_argument(
        "--no-permutation-control",
        action="store_true",
        help="skip the leakage tripwire (refit the baseline on shuffled labels)",
    )
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    emit = [c.strip() for c in args.competitions.split(",") if c.strip()]
    test_seasons = [int(s) for s in args.test_seasons.split(",") if s.strip()]
    sel_seasons = [int(s) for s in args.selection_seasons.split(",") if s.strip()]
    model_kinds = [m.strip() for m in args.models.split(",") if m.strip()]

    if not args.db.exists():
        logger.error("warehouse not found at %s", args.db)
        return 2

    t0 = time.time()
    # Observe Wave A *and* the European competitions so continental midweek
    # load and cross-competition rest days are complete; emit Wave A only.
    observe = sorted(set(emit) | set(EUROPEAN_COMPETITIONS))
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    try:
        X, y, meta = build_feature_frame(
            conn,
            emit_competitions=emit,
            observe_competitions=observe,
            min_season=args.min_season,
            warmup_days=365,
        )
    finally:
        conn.close()
    data = Dataset(X, y, meta)
    logger.info(
        "built %d rows x %d features in %.1fs (seasons %d-%d)",
        X.shape[0],
        X.shape[1],
        time.time() - t0,
        int(data.season.min()),
        int(data.season.max()),
    )

    folds_all = make_folds(test_seasons, data)
    folds_sel = make_folds(sel_seasons, data)
    final_seasons = [s for s in test_seasons if s not in sel_seasons]
    folds_final = make_folds(final_seasons, data) if final_seasons else []
    if not folds_all:
        logger.error("no usable folds")
        return 3

    coverage = data.group_coverage()
    for g, c in sorted(coverage.items()):
        logger.info(
            "group %-22s features=%2d constant=%2d usable=%s %s",
            g,
            c["n_features"],
            c["n_constant_features"],
            c["usable"],
            f"coverage={c.get('coverage_rate')}" if "coverage_rate" in c else "",
        )

    report: Dict[str, object] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "split": "rolling-origin temporal; fold k trains on all seasons < k, tests on season k",
            "shuffling": "none — no random k-fold anywhere",
            "same_day_leakage_guard": (
                "features for every fixture on a calendar day are emitted before any of "
                "that day's results are folded into state"
            ),
            "brier_convention": "multiclass sum of squared errors; uniform 1/3 = 0.6667",
            "feature_source": "backend/services/prediction/features_v2.py",
        },
        "scope": {
            "emit_competitions": emit,
            "observe_competitions": observe,
            "min_season": args.min_season,
            "test_seasons": [f["test_season"] for f in folds_all],
            "selection_seasons": [f["test_season"] for f in folds_sel],
            "final_seasons": [f["test_season"] for f in folds_final],
            "n_rows": int(X.shape[0]),
            "n_rows_with_closing_odds": int(data.has_market.sum()),
        },
        "group_coverage": coverage,
        "references": {},
        "variants": {},
        "greedy_forward_selection": None,
        "warnings": [],
    }

    unusable = [g for g, c in coverage.items() if not c["usable"]]
    if unusable:
        report["warnings"].append(
            "groups with no varying feature in this scope (result is 'no data', not "
            f"'no signal'): {sorted(unusable)}"
        )

    # ---- reference rows on the pooled fixtures ----
    refs = reference_rows(data, folds_all)
    ref_idx = refs["uniform_third"][1]
    paired = data.has_market[ref_idx]
    for name, (p, idx) in refs.items():
        yy = data.y[idx]
        if name == "market_closing_novig":
            m = ~np.isnan(p[:, 0])
            report["references"][name] = {
                **score(p[m], yy[m]),
                "note": "de-vigged (proportional) closing line, rows with a price only",
            }
        else:
            entry = score(p, yy)
            entry["paired_vs_market"] = score(p[paired], yy[paired])
            report["references"][name] = entry

    # ---- leakage tripwire ----
    # Refit the baseline on randomly permuted labels. With the point-in-time
    # builder this MUST collapse to the constant base rate; anything better
    # means a feature is carrying information about its own match.
    if not args.no_permutation_control:
        shuffled = Dataset(data.X, data.y, data.meta)
        shuffled.y = np.random.default_rng(7).permutation(data.y)
        p, i, _ = run_variant(shuffled, ["baseline"], folds_all, "logreg")
        ctrl = score(p, shuffled.y[i])
        base_rate_brier = report["references"]["constant_base_rate_train"]["brier"]
        ctrl["expected_brier_if_clean"] = base_rate_brier
        ctrl["gap_vs_base_rate"] = round(ctrl["brier"] - base_rate_brier, 6)
        ctrl["leakage_suspected"] = bool(ctrl["brier"] < base_rate_brier - 0.005)
        ctrl["note"] = (
            "baseline refit on permuted labels; must land on the constant base rate"
        )
        report["references"]["label_permutation_control"] = ctrl
        logger.info(
            "permutation control brier=%.4f vs base rate %.4f -> leakage_suspected=%s",
            ctrl["brier"],
            base_rate_brier,
            ctrl["leakage_suspected"],
        )
        if ctrl["leakage_suspected"]:
            report["warnings"].append(
                "LEAKAGE TRIPWIRE FIRED: the baseline beats the base rate on permuted "
                "labels. A feature is reading its own match."
            )

    # ---- per-model sweep ----
    for kind in model_kinds:
        logger.info("=== model: %s ===", kind)
        model_block: Dict[str, object] = {}
        t = time.time()
        base_probs, base_idx, base_folds = run_variant(data, ["baseline"], folds_all, kind)
        base_metrics = score(base_probs, data.y[base_idx])
        model_block["baseline"] = variant_report(
            "baseline", ["baseline"], base_probs, base_idx, data, base_folds, None, paired
        )
        logger.info(
            "baseline               brier=%.4f ll=%.4f acc=%.4f (%.1fs)",
            base_metrics["brier"],
            base_metrics["log_loss"],
            base_metrics["accuracy"],
            time.time() - t,
        )

        for g in CANDIDATE_GROUPS:
            t = time.time()
            groups = ["baseline", g]
            probs, idx, per_fold = run_variant(data, groups, folds_all, kind)
            entry = variant_report(
                f"baseline+{g}", groups, probs, idx, data, per_fold, base_metrics, paired
            )
            if args.bootstrap:
                entry["p_not_better_than_baseline"] = round(
                    paired_bootstrap_p(probs, base_probs, data.y[idx], args.bootstrap), 4
                )
            model_block[f"baseline+{g}"] = entry
            logger.info(
                "baseline+%-14s brier=%.4f (%+.4f) ll=%.4f acc=%.4f %-8s (%.1fs)",
                g,
                entry["brier"],
                entry["delta_vs_baseline"]["brier"],
                entry["log_loss"],
                entry["accuracy"],
                entry["verdict"],
                time.time() - t,
            )

        # all candidate groups at once — the "throw everything in" variant
        t = time.time()
        everything = ["baseline", *CANDIDATE_GROUPS]
        probs, idx, per_fold = run_variant(data, everything, folds_all, kind)
        entry = variant_report(
            "baseline+ALL", everything, probs, idx, data, per_fold, base_metrics, paired
        )
        model_block["baseline+ALL"] = entry
        logger.info(
            "baseline+ALL           brier=%.4f (%+.4f) %-8s (%.1fs)",
            entry["brier"],
            entry["delta_vs_baseline"]["brier"],
            entry["verdict"],
            time.time() - t,
        )

        # everything except the market block (market odds are NOT available on
        # the live inference path today, so this is the shippable ceiling)
        no_market = [g for g in everything if g != "market"]
        probs, idx, per_fold = run_variant(data, no_market, folds_all, kind)
        model_block["baseline+ALL_no_market"] = variant_report(
            "baseline+ALL_no_market", no_market, probs, idx, data, per_fold, base_metrics, paired
        )

        report["variants"][kind] = model_block

    # ---- greedy forward selection ----
    if not args.no_greedy and folds_sel:
        kind = args.greedy_model
        logger.info("=== greedy forward selection (%s, selection folds %s) ===", kind, sel_seasons)
        selected = ["baseline"]
        sel_probs, sel_idx, _ = run_variant(data, selected, folds_sel, kind)
        best = score(sel_probs, data.y[sel_idx])["brier"]
        trail: List[Dict] = [{"step": 0, "added": None, "selection_brier": best}]
        remaining = list(CANDIDATE_GROUPS)
        while remaining:
            scored: List[Tuple[float, str]] = []
            for g in remaining:
                p, i, _ = run_variant(data, selected + [g], folds_sel, kind)
                scored.append((score(p, data.y[i])["brier"], g))
            scored.sort()
            cand_brier, cand = scored[0]
            if cand_brier >= best - 1e-5:
                trail.append(
                    {
                        "step": len(trail),
                        "added": None,
                        "stopped": True,
                        "best_rejected": cand,
                        "best_rejected_brier": round(cand_brier, 6),
                        "selection_brier": round(best, 6),
                    }
                )
                break
            selected.append(cand)
            remaining.remove(cand)
            best = cand_brier
            trail.append(
                {
                    "step": len(trail),
                    "added": cand,
                    "selection_brier": round(best, 6),
                    "all_candidates": [
                        {"group": g, "selection_brier": round(b, 6)} for b, g in scored
                    ],
                }
            )
            logger.info("  + %-20s selection brier -> %.5f", cand, best)

        greedy: Dict[str, object] = {
            "model": kind,
            "selection_seasons": [f["test_season"] for f in folds_sel],
            "selected_groups": selected,
            "trail": trail,
        }
        if folds_final:
            fp, fi, ff = run_variant(data, selected, folds_final, kind)
            bp, bi, bf = run_variant(data, ["baseline"], folds_final, kind)
            fin_base = score(bp, data.y[bi])
            fin_sel = score(fp, data.y[fi])
            greedy["final_holdout"] = {
                "seasons": [f["test_season"] for f in folds_final],
                "baseline": fin_base,
                "selected": fin_sel,
                "delta_brier": round(fin_sel["brier"] - fin_base["brier"], 6),
                "delta_log_loss": round(fin_sel["log_loss"] - fin_base["log_loss"], 6),
                "delta_accuracy": round(fin_sel["accuracy"] - fin_base["accuracy"], 6),
                "p_not_better_than_baseline": round(
                    paired_bootstrap_p(fp, bp, data.y[fi], args.bootstrap or 1000), 4
                ),
                "note": "selection never saw these seasons",
            }
            logger.info(
                "final holdout %s: baseline brier=%.4f selected=%.4f (%+.4f)",
                greedy["final_holdout"]["seasons"],
                fin_base["brier"],
                fin_sel["brier"],
                greedy["final_holdout"]["delta_brier"],
            )
        report["greedy_forward_selection"] = greedy

    # ---- harmful-group callout ----
    harmful = []
    for kind, block in report["variants"].items():
        for name, entry in block.items():
            if isinstance(entry, dict) and entry.get("verdict") == "HARMFUL":
                harmful.append(
                    {
                        "model": kind,
                        "variant": name,
                        "delta_brier": entry["delta_vs_baseline"]["brier"],
                    }
                )
    report["harmful_groups"] = harmful

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, default=str))
    logger.info("wrote %s (%.1fs total)", args.output, time.time() - t0)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
