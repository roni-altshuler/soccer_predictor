"""
Walk-forward backtesting harness for the match prediction ensemble.

Three evaluation modes:

1. Default (per-fold re-train, full ensemble).
   For each test season T: train the production-equivalent VotingClassifier
   on every match strictly before T, evaluate on every match in T. True
   walk-forward — no lookahead. Slow (~minutes/league).

2. --fast (per-fold re-train, single LightGBM).
   Same season-rolling split, but trains one LightGBM per fold instead of
   the 4-model voting ensemble. ~10-20x faster; signal is comparable
   accuracy and slightly higher log-loss vs the full ensemble. Useful for
   quick baseline sweeps.

3. --load-production (no re-train, evaluate saved artifacts).
   Loads each league's saved match_predictor.pkl + scaler + calibration
   buckets from backend/data/models/<espn_slug>/ and evaluates per season
   WITHOUT retraining. Measures the actual deployed model's confidence
   distribution and calibration on real matches.

   WARNING: this mode has *lookahead leakage* — the saved model was
   trained on all available history, including seasons it is now being
   asked to predict. Per-season accuracy will be optimistic. The value
   is in observing how the production model's *calibration* (ECE) and
   confidence distribution look on real seasons, NOT in claiming
   prediction accuracy.

   For an honest production-ensemble walk-forward, use the default mode
   (no --fast, no --load-production) and accept the longer runtime.

Output (per league):
    backend/data/diagnostics/walkforward_<league>.json

Each report contains, per test season:
    - accuracy, log_loss, brier_score, ECE (10-bin)
    - per-confidence-bucket accuracy and coverage
    - train_samples / test_samples / class distribution
And aggregate means across all reported seasons. The top-level report
includes an `eval_mode` field: "fresh_full_ensemble" | "fresh_fast_lgbm"
| "saved_production_artifacts".

CLI:
    # True walk-forward, full ensemble per fold (slow, no leakage)
    python -m backend.services.prediction.backtest_walkforward --all

    # Fast baseline (single LightGBM per fold, no leakage)
    python -m backend.services.prediction.backtest_walkforward --all --fast

    # Evaluate saved production artifacts (no re-train, has leakage)
    python -m backend.services.prediction.backtest_walkforward --all \\
        --load-production
"""

from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sklearn.metrics import accuracy_score, log_loss
from sklearn.preprocessing import StandardScaler

from .historical_data import (
    ESPN_LEAGUES,
    HISTORICAL_DATA_DIR,
)
from .training import FeatureBuilder, ModelTrainer, HAS_LIGHTGBM, HAS_XGBOOST, MODEL_DIR

try:
    from lightgbm import LGBMClassifier  # type: ignore
except ImportError:  # pragma: no cover
    LGBMClassifier = None  # type: ignore

try:
    from xgboost import XGBClassifier  # type: ignore
except ImportError:  # pragma: no cover
    XGBClassifier = None  # type: ignore

from sklearn.ensemble import GradientBoostingClassifier

logger = logging.getLogger(__name__)

DIAGNOSTICS_DIR = Path(__file__).parent.parent.parent / "data" / "diagnostics"
CONFIDENCE_BUCKETS: List[Tuple[float, float]] = [
    (0.00, 0.40),
    (0.40, 0.50),
    (0.50, 0.60),
    (0.60, 0.70),
    (0.70, 1.01),
]

# Match date -> season label. Use file-name season when possible; fall back to
# month-based bucketing for tournaments.
SUMMER_SEASON_LEAGUES = {
    "premier_league", "la_liga", "bundesliga", "serie_a", "ligue_1",
    "eredivisie", "primeira_liga", "champions_league", "europa_league",
}


@dataclass
class SeasonReport:
    season: str
    train_samples: int
    test_samples: int
    accuracy: float
    log_loss: float
    brier_score: float
    ece: float
    class_distribution: Dict[str, int]
    buckets: List[Dict[str, Any]]


def _load_matches_with_season(league: str) -> List[Dict[str, Any]]:
    """Load all cached matches for a league, tagging each with its season label."""
    matches: List[Dict[str, Any]] = []
    for path in sorted(HISTORICAL_DATA_DIR.glob(f"{league}_*.json")):
        try:
            with open(path) as f:
                blob = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("skipping %s: %s", path.name, exc)
            continue

        if blob.get("league") != league:
            continue

        # Filename: <league>_<startYear>_<endYear>.json — use that as the season tag.
        stem = path.stem
        try:
            _, start_year, end_year = stem.rsplit("_", 2)
            season_label = f"{start_year}_{end_year}"
        except ValueError:
            season_label = stem

        for match in blob.get("matches", []):
            # Skip matches without a usable result (still fed to FeatureBuilder for state).
            match["_season"] = season_label
            matches.append(match)

    # Sort chronologically — feature builder is stateful, order matters.
    matches.sort(key=lambda m: m.get("date", ""))
    return matches


def _expected_calibration_error(y_true: np.ndarray, y_proba: np.ndarray, n_bins: int = 10) -> float:
    """Standard ECE on the predicted-class confidence."""
    confidences = y_proba.max(axis=1)
    predictions = y_proba.argmax(axis=1)
    correct = (predictions == y_true).astype(np.float64)

    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    n = len(y_true)
    ece = 0.0
    for lo, hi in zip(bin_edges[:-1], bin_edges[1:]):
        mask = (confidences > lo) & (confidences <= hi)
        if not mask.any():
            continue
        bin_conf = confidences[mask].mean()
        bin_acc = correct[mask].mean()
        ece += (mask.sum() / n) * abs(bin_conf - bin_acc)
    return float(ece)


def _bucket_breakdown(y_true: np.ndarray, y_proba: np.ndarray) -> List[Dict[str, Any]]:
    """Per-confidence-bucket accuracy + coverage."""
    confidences = y_proba.max(axis=1)
    predictions = y_proba.argmax(axis=1)
    out: List[Dict[str, Any]] = []
    n = len(y_true)
    for lo, hi in CONFIDENCE_BUCKETS:
        mask = (confidences > lo) & (confidences <= hi)
        count = int(mask.sum())
        if count == 0:
            out.append({"bucket": f"{lo:.2f}-{hi:.2f}", "count": 0, "coverage": 0.0,
                        "accuracy": None, "mean_confidence": None})
            continue
        out.append({
            "bucket": f"{lo:.2f}-{hi:.2f}",
            "count": count,
            "coverage": round(count / n, 4),
            "accuracy": round(float((predictions[mask] == y_true[mask]).mean()), 4),
            "mean_confidence": round(float(confidences[mask].mean()), 4),
        })
    return out


def _build_features_chronologically(matches: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray, List[str], List[str]]:
    """
    Single chronological pass that yields (X, y, season_labels, match_dates) for every
    match with a resolved score and a successfully built feature vector.

    Critically, FeatureBuilder.update_state is called on EVERY match (even those
    where build_features_for_match returns None), so ELO/form state stays coherent.
    """
    builder = FeatureBuilder()
    X_list: List[np.ndarray] = []
    y_list: List[int] = []
    seasons: List[str] = []
    dates: List[str] = []

    for match in matches:
        hs = match.get("home_score")
        as_ = match.get("away_score")
        if hs is None or as_ is None:
            builder.update_state(match)
            continue

        features = builder.build_features_for_match(match)
        builder.update_state(match)
        if features is None:
            continue

        hs_i, as_i = int(hs), int(as_)
        if hs_i > as_i:
            label = 0
        elif hs_i == as_i:
            label = 1
        else:
            label = 2

        X_list.append(features)
        y_list.append(label)
        seasons.append(match.get("_season", ""))
        dates.append(match.get("date", ""))

    X = np.array(X_list, dtype=np.float64)
    y = np.array(y_list, dtype=np.int32)
    X = np.nan_to_num(X, nan=0.0, posinf=5.0, neginf=-5.0)
    return X, y, seasons, dates


def _build_fast_model(class_weights: Dict[int, float]):
    """Single-model fast baseline for the backtest harness.

    Skips the full production ensemble (XGB+LGBM+RF+GB voting) which is slow
    per fold. Prefers LightGBM (fast, calibrated) then XGBoost then GBM.
    """
    sklearn_cw = class_weights
    if LGBMClassifier is not None and HAS_LIGHTGBM:
        return LGBMClassifier(
            n_estimators=200, max_depth=5, learning_rate=0.05,
            subsample=0.85, colsample_bytree=0.85, min_child_samples=10,
            class_weight=sklearn_cw, random_state=42, verbose=-1,
        )
    if XGBClassifier is not None and HAS_XGBOOST:
        return XGBClassifier(
            n_estimators=200, max_depth=5, learning_rate=0.05,
            subsample=0.85, colsample_bytree=0.85, min_child_weight=6,
            eval_metric="mlogloss", random_state=42,
            use_label_encoder=False, verbosity=0,
        )
    return GradientBoostingClassifier(
        n_estimators=200, max_depth=4, learning_rate=0.05,
        subsample=0.85, min_samples_leaf=15, random_state=42,
    )


def _load_production_model(league: str) -> Optional[ModelTrainer]:
    """Load the production ModelTrainer for a league key.

    Translates the friendly league key (e.g. ``premier_league``) to the
    ESPN slug used as the model-dir name (e.g. ``eng.1``) via the
    ``ESPN_LEAGUES`` table. Returns ``None`` if no saved artifact exists.
    """
    espn_slug = ESPN_LEAGUES.get(league)
    if not espn_slug:
        logger.warning("no ESPN slug mapped for league=%s; cannot load production artifacts", league)
        return None
    league_dir = MODEL_DIR / espn_slug
    if not league_dir.exists():
        logger.warning("no model dir at %s; cannot load production artifacts", league_dir)
        return None
    trainer = ModelTrainer(model_dir=league_dir)
    if not trainer.load_model(name="match_predictor"):
        logger.warning("ModelTrainer.load_model returned False for %s", league_dir)
        return None
    return trainer


def backtest_league(
    league: str,
    warmup_seasons: int = 3,
    min_train_samples: int = 500,
    min_test_samples: int = 60,
    fast: bool = False,
    incremental_write: bool = True,
    load_production: bool = False,
) -> Dict[str, Any]:
    """Run the full walk-forward backtest for a single league."""
    matches = _load_matches_with_season(league)
    if not matches:
        logger.warning("no cached matches found for league=%s", league)
        return {"league": league, "error": "no_cached_matches", "seasons": []}

    X, y, seasons, dates = _build_features_chronologically(matches)
    logger.info("league=%s: %d feature-ready samples across %d unique seasons",
                league, len(X), len(set(seasons)))

    season_order = sorted({s for s in seasons if s})
    if len(season_order) <= warmup_seasons:
        return {
            "league": league,
            "error": "insufficient_seasons",
            "available_seasons": season_order,
            "warmup_seasons": warmup_seasons,
        }

    seasons_arr = np.array(seasons)
    reports: List[SeasonReport] = []

    if fast and load_production:
        raise ValueError("--fast and --load-production are mutually exclusive; pick one mode.")

    if load_production:
        eval_mode = "saved_production_artifacts"
    elif fast:
        eval_mode = "fresh_fast_lgbm"
    else:
        eval_mode = "fresh_full_ensemble"

    trainer = ModelTrainer()
    production_trainer: Optional[ModelTrainer] = None
    espn_slug = ESPN_LEAGUES.get(league)
    if load_production:
        production_trainer = _load_production_model(league)
        if production_trainer is None:
            return {
                "league": league,
                "error": "production_artifacts_unavailable",
                "eval_mode": eval_mode,
                "note": "No saved match_predictor.pkl found for this league; run train_models first.",
            }

    for test_season in season_order[warmup_seasons:]:
        train_mask = seasons_arr < test_season  # lexicographic on YYYY_YYYY works
        test_mask = seasons_arr == test_season

        X_train, y_train = X[train_mask], y[train_mask]
        X_test, y_test = X[test_mask], y[test_mask]

        # In production-load mode the model is already trained; ignore the
        # train-size threshold (history is informational only).
        effective_min_train = 0 if load_production else min_train_samples
        if len(X_train) < effective_min_train or len(X_test) < min_test_samples:
            logger.info("  skip season=%s (train=%d test=%d)",
                        test_season, len(X_train), len(X_test))
            continue
        if not load_production and len(np.unique(y_train)) < 3:
            continue
        if len(np.unique(y_test)) < 2:
            continue

        if load_production:
            # Use the saved production model directly. The trainer's
            # predict_proba handles scaler.transform + bucket calibration.
            assert production_trainer is not None
            try:
                proba = ModelTrainer._normalize_probabilities(
                    production_trainer.predict_proba(X_test, league=espn_slug)
                )
            except Exception as exc:
                logger.warning("  season=%s production predict_proba failed: %s", test_season, exc)
                continue
        else:
            scaler = StandardScaler()
            X_train_s = scaler.fit_transform(X_train)
            X_test_s = scaler.transform(X_test)

            class_weights = ModelTrainer.compute_class_weights(y_train)
            if fast:
                model = _build_fast_model(class_weights)
            else:
                model = trainer._build_ensemble(class_weights, n_samples=len(X_train_s))
            sample_weights = np.array([class_weights[int(label)] for label in y_train], dtype=np.float64)

            try:
                model.fit(X_train_s, y_train, sample_weight=sample_weights)
            except TypeError:
                model.fit(X_train_s, y_train)

            proba = ModelTrainer._normalize_probabilities(model.predict_proba(X_test_s))

        pred = np.argmax(proba, axis=1)

        acc = float(accuracy_score(y_test, pred))
        ll = float(log_loss(y_test, proba, labels=[0, 1, 2]))
        brier = ModelTrainer._multiclass_brier(y_test, proba)
        ece = _expected_calibration_error(y_test, proba)

        report = SeasonReport(
            season=test_season,
            train_samples=int(len(X_train)),
            test_samples=int(len(X_test)),
            accuracy=round(acc, 4),
            log_loss=round(ll, 4),
            brier_score=round(brier, 4),
            ece=round(ece, 4),
            class_distribution={
                "H": int((y_test == 0).sum()),
                "D": int((y_test == 1).sum()),
                "A": int((y_test == 2).sum()),
            },
            buckets=_bucket_breakdown(y_test, proba),
        )
        reports.append(report)
        logger.info(
            "  season=%s acc=%.4f log_loss=%.4f brier=%.4f ece=%.4f (n_train=%d n_test=%d) [%s]",
            test_season, acc, ll, brier, ece, len(X_train), len(X_test), eval_mode,
        )

        if incremental_write:
            partial = _build_league_report(league, warmup_seasons, reports, partial=True, eval_mode=eval_mode)
            write_report(league, partial)

    if not reports:
        return {"league": league, "error": "no_eligible_seasons", "seasons": [], "eval_mode": eval_mode}

    return _build_league_report(league, warmup_seasons, reports, partial=False, eval_mode=eval_mode)


def _build_league_report(
    league: str,
    warmup_seasons: int,
    reports: List[SeasonReport],
    partial: bool,
    eval_mode: str = "fresh_fast_lgbm",
) -> Dict[str, Any]:
    accs = [r.accuracy for r in reports]
    lls = [r.log_loss for r in reports]
    briers = [r.brier_score for r in reports]
    eces = [r.ece for r in reports]
    leakage_note = (
        "WARNING: this report was produced with --load-production. The saved "
        "model was trained on all available history including the test seasons "
        "below, so per-season accuracy is optimistic and not a true generalization "
        "measurement. Use the ECE, Brier, and confidence-bucket coverage as the "
        "calibration signal; ignore the raw accuracy."
        if eval_mode == "saved_production_artifacts" else None
    )
    return {
        "league": league,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "partial": partial,
        "eval_mode": eval_mode,
        "leakage_warning": leakage_note,
        "warmup_seasons": warmup_seasons,
        "n_test_seasons": len(reports),
        "aggregate": {
            "accuracy_mean": round(float(np.mean(accs)), 4),
            "accuracy_std": round(float(np.std(accs)), 4),
            "log_loss_mean": round(float(np.mean(lls)), 4),
            "brier_mean": round(float(np.mean(briers)), 4),
            "ece_mean": round(float(np.mean(eces)), 4),
        },
        "seasons": [asdict(r) for r in reports],
    }


def write_report(league: str, report: Dict[str, Any]) -> Path:
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)
    out = DIAGNOSTICS_DIR / f"walkforward_{league}.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    return out


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Walk-forward backtest for FotPredict ensemble")
    parser.add_argument("--league", help="single league key (e.g. premier_league)")
    parser.add_argument("--all", action="store_true", help="run for all known leagues")
    parser.add_argument("--warmup-seasons", type=int, default=3,
                        help="number of earliest seasons used only for training warmup")
    parser.add_argument("--min-train-samples", type=int, default=500)
    parser.add_argument("--min-test-samples", type=int, default=60)
    parser.add_argument("--fast", action="store_true",
                        help="use a single fast model (LightGBM) instead of the full production ensemble")
    parser.add_argument("--load-production", action="store_true",
                        help="evaluate the saved production model (no re-train). "
                             "WARNING: introduces lookahead leakage since the saved model "
                             "was trained on all available history. Use ECE / Brier / "
                             "confidence-bucket coverage as the signal, not raw accuracy. "
                             "Mutually exclusive with --fast.")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    if not args.league and not args.all:
        parser.error("specify --league <name> or --all")

    leagues = list(ESPN_LEAGUES.keys()) if args.all else [args.league]
    summary: List[Dict[str, Any]] = []
    for lg in leagues:
        if lg not in ESPN_LEAGUES:
            logger.error("unknown league: %s", lg)
            continue
        logger.info("=== walk-forward backtest: %s ===", lg)
        report = backtest_league(
            lg,
            warmup_seasons=args.warmup_seasons,
            min_train_samples=args.min_train_samples,
            min_test_samples=args.min_test_samples,
            fast=args.fast,
            load_production=args.load_production,
        )
        path = write_report(lg, report)
        logger.info("wrote %s", path)
        if "aggregate" in report:
            summary.append({"league": lg, **report["aggregate"],
                            "n_test_seasons": report["n_test_seasons"],
                            "eval_mode": report.get("eval_mode")})
        else:
            summary.append({"league": lg, "error": report.get("error"),
                            "eval_mode": report.get("eval_mode")})

    if summary:
        if args.load_production:
            eval_mode_summary = "saved_production_artifacts"
        elif args.fast:
            eval_mode_summary = "fresh_fast_lgbm"
        else:
            eval_mode_summary = "fresh_full_ensemble"
        summary_path = DIAGNOSTICS_DIR / "walkforward_summary.json"
        with open(summary_path, "w") as f:
            json.dump({"generated_at": datetime.utcnow().isoformat() + "Z",
                       "eval_mode": eval_mode_summary,
                       "leakage_warning": (
                           "Per-season accuracy is optimistic in this mode — the saved "
                           "model was trained on all available history including the test "
                           "seasons. Use ECE / Brier as the calibration signal."
                       ) if eval_mode_summary == "saved_production_artifacts" else None,
                       "leagues": summary}, f, indent=2)
        logger.info("wrote summary -> %s (mode=%s)", summary_path, eval_mode_summary)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
