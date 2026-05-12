"""
Tune 1X2 decision thresholds against chronological holdout data.

This script does not retrain neural weights. It simulates the current
league/global/hybrid model-routing policy, tunes the post-probability draw
decision rule on the calibration split, and evaluates it on the untouched
test split. The resulting artifact updates only deployable decision policy
parameters when the test split does not regress.

Usage:
    python -m backend.scripts.tune_decision_policy --min-season 1998
    python -m backend.scripts.tune_decision_policy --min-season 1998 --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

import numpy as np
from sklearn.metrics import accuracy_score, log_loss, precision_recall_fscore_support

from backend.scripts.train_models import (
    ESPN_TO_KEY,
    OUTCOME_LABELS,
    OUTCOME_NAMES,
    _load_existing_predictions,
    build_features_and_labels,
    fetch_historical_data,
)
from backend.services.prediction.model_selection import (
    get_global_blend_weight,
    get_model_selection_decision,
    load_model_selection_policy,
)
from backend.services.prediction.neural_model import get_league_model_registry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_TUNING_FILE = DATA_DIR / "model_tuning.json"
EXPERIMENT_FILE = DATA_DIR / "model_decision_policy_tuning.json"

LEAGUE_DISPLAY = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
    "ned.1": "Eredivisie",
    "por.1": "Primeira Liga",
    "usa.1": "MLS",
    "uefa.champions": "Champions League",
    "uefa.europa": "Europa League",
    "uefa.europa.conf": "Conference League",
    "fifa.world": "FIFA World Cup",
    "uefa.euro": "UEFA European Championship",
    "conmebol.america": "Copa America",
}

LEAGUE_DRAW_RATES = {
    "eng.1": 0.26,
    "esp.1": 0.24,
    "ger.1": 0.24,
    "ita.1": 0.26,
    "fra.1": 0.23,
    "ned.1": 0.23,
    "por.1": 0.24,
    "usa.1": 0.21,
    "uefa.champions": 0.20,
    "uefa.europa": 0.22,
    "uefa.europa.conf": 0.22,
    "fifa.world": 0.18,
    "uefa.euro": 0.22,
    "conmebol.america": 0.20,
}


def _normalize_probabilities(proba: np.ndarray) -> np.ndarray:
    probs = np.asarray(proba, dtype=np.float64)
    probs = np.clip(probs, 1e-12, 1.0)
    row_sums = probs.sum(axis=1, keepdims=True)
    row_sums[row_sums <= 0] = 1.0
    return probs / row_sums


def _decision_predictions(
    proba: np.ndarray,
    draw_min_prob: float,
    draw_margin: float,
) -> np.ndarray:
    probs = _normalize_probabilities(proba)
    home = probs[:, 0]
    draw = probs[:, 1]
    away = probs[:, 2]
    preds = np.where(home >= away, 0, 2).astype(np.int32)
    draw_mask = (draw >= draw_min_prob) & (draw + draw_margin >= np.maximum(home, away))
    preds[draw_mask] = 1
    return preds


def _elo_proxy_probabilities(X: np.ndarray, league_labels: np.ndarray) -> np.ndarray:
    """
    Reconstruct the runtime ELO prior from pre-match ELO features.

    This lets the tuning job evaluate the same deployable neural/ELO blend used
    by `/api/predict/unified` and `predict_upcoming.py`, without relying on
    unavailable future odds feeds.
    """
    home_elo = X[:, 0].astype(np.float64)
    away_elo = X[:, 1].astype(np.float64)
    diff = (home_elo + 30.0) - away_elo

    draw_rates = np.array(
        [LEAGUE_DRAW_RATES.get(str(label), 0.24) for label in league_labels],
        dtype=np.float64,
    )
    elo_closeness = np.exp(-(diff ** 2) / (2 * 250 ** 2))
    draw = draw_rates * (0.7 + 0.9 * elo_closeness)
    draw = np.clip(draw, 0.12, 0.42)

    win_pool = 1.0 - draw
    home_raw = 1.0 / (1.0 + np.power(10.0, -diff / 400.0))
    home = win_pool * home_raw
    away = win_pool * (1.0 - home_raw)
    return _normalize_probabilities(np.column_stack([home, draw, away]))


def _multiclass_brier(y_true: np.ndarray, y_proba: np.ndarray) -> float:
    probs = _normalize_probabilities(y_proba)
    one_hot = np.zeros_like(probs)
    one_hot[np.arange(len(y_true)), y_true.astype(int)] = 1.0
    return float(np.mean(np.sum((probs - one_hot) ** 2, axis=1)))


def _metrics_from_predictions(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    preds: np.ndarray,
) -> Dict[str, Any]:
    if len(y_true) == 0:
        return {"sample_size": 0}

    probs = _normalize_probabilities(y_proba)
    macro_precision, macro_recall, macro_f1, _ = precision_recall_fscore_support(
        y_true,
        preds,
        labels=OUTCOME_LABELS,
        average="macro",
        zero_division=0,
    )
    weighted_precision, weighted_recall, weighted_f1, _ = precision_recall_fscore_support(
        y_true,
        preds,
        labels=OUTCOME_LABELS,
        average="weighted",
        zero_division=0,
    )
    class_precision, class_recall, class_f1, class_support = precision_recall_fscore_support(
        y_true,
        preds,
        labels=OUTCOME_LABELS,
        zero_division=0,
    )
    try:
        logloss_value = float(log_loss(y_true, probs, labels=OUTCOME_LABELS))
    except Exception:
        logloss_value = None

    return {
        "sample_size": int(len(y_true)),
        "accuracy": float(accuracy_score(y_true, preds)),
        "precision_macro": float(macro_precision),
        "recall_macro": float(macro_recall),
        "f1_macro": float(macro_f1),
        "precision_weighted": float(weighted_precision),
        "recall_weighted": float(weighted_recall),
        "f1_weighted": float(weighted_f1),
        "log_loss": logloss_value,
        "brier_score": _multiclass_brier(y_true, probs),
        "predicted_draw_rate": float((preds == 1).mean()),
        "actual_draw_rate": float((y_true == 1).mean()),
        "class_distribution": {
            "home_win": int((y_true == 0).sum()),
            "draw": int((y_true == 1).sum()),
            "away_win": int((y_true == 2).sum()),
        },
        "predicted_distribution": {
            "home_win": int((preds == 0).sum()),
            "draw": int((preds == 1).sum()),
            "away_win": int((preds == 2).sum()),
        },
        "per_class": {
            name: {
                "precision": float(class_precision[index]),
                "recall": float(class_recall[index]),
                "f1": float(class_f1[index]),
                "support": int(class_support[index]),
            }
            for index, name in enumerate(OUTCOME_NAMES)
        },
    }


def _metric_score(metrics: Dict[str, Any]) -> float:
    accuracy = float(metrics.get("accuracy") or 0.0)
    macro_f1 = float(metrics.get("f1_macro") or 0.0)
    logloss_value = float(metrics.get("log_loss") or 1.1)
    brier_value = float(metrics.get("brier_score") or 0.67)
    draw_gap = abs(float(metrics.get("predicted_draw_rate") or 0.0) - float(metrics.get("actual_draw_rate") or 0.0))
    return accuracy + (0.18 * macro_f1) - (0.06 * logloss_value) - (0.03 * brier_value) - (0.03 * draw_gap)


def _load_current_tuning() -> Dict[str, Any]:
    if not MODEL_TUNING_FILE.exists():
        return {
            "version": "1.0.0",
            "generated_at": None,
            "default": {
                "blend_nn_base": 0.66,
                "blend_nn_min": 0.55,
                "blend_nn_max": 0.82,
                "entropy_sensitivity": 0.18,
                "draw_min_prob": 0.24,
                "draw_margin": 0.02,
            },
            "leagues": {},
        }
    try:
        with open(MODEL_TUNING_FILE) as f:
            return json.load(f)
    except Exception as exc:
        logger.warning("Could not load existing model tuning: %s", exc)
        return {"default": {}, "leagues": {}}


def _thresholds_from_tuning(tuning: Dict[str, Any], league_key: str) -> tuple[float, float]:
    default = tuning.get("default", {})
    league = tuning.get("leagues", {}).get(league_key, {})
    return (
        float(league.get("draw_min_prob", default.get("draw_min_prob", 0.24))),
        float(league.get("draw_margin", default.get("draw_margin", 0.02))),
    )


def _blend_params_from_tuning(tuning: Dict[str, Any], league_key: str) -> Dict[str, float]:
    default = tuning.get("default", {})
    league = tuning.get("leagues", {}).get(league_key, {})
    return {
        "blend_nn_base": float(league.get("blend_nn_base", default.get("blend_nn_base", 0.66))),
        "blend_nn_min": float(league.get("blend_nn_min", default.get("blend_nn_min", 0.55))),
        "blend_nn_max": float(league.get("blend_nn_max", default.get("blend_nn_max", 0.82))),
        "entropy_sensitivity": float(league.get("entropy_sensitivity", default.get("entropy_sensitivity", 0.18))),
    }


def _blend_arrays_with_params(
    model_proba: np.ndarray,
    elo_proba: np.ndarray,
    params: Dict[str, float],
) -> np.ndarray:
    model = _normalize_probabilities(model_proba)
    elo = _normalize_probabilities(elo_proba)
    entropy = -np.sum(np.clip(model, 1e-12, 1.0) * np.log(np.clip(model, 1e-12, 1.0)), axis=1)
    entropy_norm = np.minimum(1.0, entropy / np.log(3.0))
    weights = float(params["blend_nn_base"]) + (1.0 - entropy_norm) * float(params["entropy_sensitivity"])
    weights = np.clip(weights, float(params["blend_nn_min"]), float(params["blend_nn_max"]))
    blended = (weights[:, None] * model) + ((1.0 - weights)[:, None] * elo)
    return _normalize_probabilities(blended)


def _blend_model_with_elo(
    model_proba: np.ndarray,
    elo_proba: np.ndarray,
    league_labels: np.ndarray,
    tuning: Dict[str, Any],
    blend_overrides: Optional[Dict[str, Dict[str, float]]] = None,
) -> np.ndarray:
    blended = np.zeros_like(model_proba, dtype=np.float64)
    for league_key in sorted(set(str(label) for label in league_labels)):
        indices = np.where(league_labels == league_key)[0]
        if len(indices) == 0:
            continue
        params = (
            blend_overrides.get(league_key)
            if blend_overrides and league_key in blend_overrides
            else _blend_params_from_tuning(tuning, league_key)
        )
        blended[indices] = _blend_arrays_with_params(model_proba[indices], elo_proba[indices], params)
    return _normalize_probabilities(blended)


def _tune_thresholds(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    candidates: Iterable[tuple[float, float]],
) -> Dict[str, Any]:
    best: Optional[Dict[str, Any]] = None
    for draw_min_prob, draw_margin in candidates:
        preds = _decision_predictions(y_proba, draw_min_prob, draw_margin)
        metrics = _metrics_from_predictions(y_true, y_proba, preds)
        score = _metric_score(metrics)
        item = {
            "draw_min_prob": round(float(draw_min_prob), 4),
            "draw_margin": round(float(draw_margin), 4),
            "score": score,
            "metrics": metrics,
        }
        if best is None or score > best["score"]:
            best = item
    return best or {
        "draw_min_prob": 0.24,
        "draw_margin": 0.02,
        "score": 0.0,
        "metrics": {"sample_size": int(len(y_true))},
    }


def _blend_weight_grid() -> list[float]:
    return [round(float(value), 4) for value in np.arange(0.50, 0.861, 0.03)]


def _params_from_base_weight(base_weight: float, current_params: Dict[str, float]) -> Dict[str, float]:
    sensitivity = float(current_params.get("entropy_sensitivity", 0.16))
    return {
        "blend_nn_base": round(float(base_weight), 4),
        "blend_nn_min": round(max(0.45, float(base_weight) - 0.11), 4),
        "blend_nn_max": round(min(0.9, float(base_weight) + 0.13), 4),
        "entropy_sensitivity": round(max(0.08, min(0.24, sensitivity)), 4),
    }


def _tune_runtime_policy(
    y_true: np.ndarray,
    model_proba: np.ndarray,
    elo_proba: np.ndarray,
    threshold_candidates: Iterable[tuple[float, float]],
    blend_weight_candidates: Iterable[float],
    current_params: Dict[str, float],
) -> Dict[str, Any]:
    best: Optional[Dict[str, Any]] = None
    for blend_weight in blend_weight_candidates:
        params = _params_from_base_weight(blend_weight, current_params)
        blended = _blend_arrays_with_params(model_proba, elo_proba, params)
        for draw_min_prob, draw_margin in threshold_candidates:
            preds = _decision_predictions(blended, draw_min_prob, draw_margin)
            metrics = _metrics_from_predictions(y_true, blended, preds)
            score = _metric_score(metrics)
            item = {
                "blend": params,
                "draw_min_prob": round(float(draw_min_prob), 4),
                "draw_margin": round(float(draw_margin), 4),
                "score": score,
                "metrics": metrics,
            }
            if best is None or score > best["score"]:
                best = item
    return best or {
        "blend": current_params,
        "draw_min_prob": 0.24,
        "draw_margin": 0.02,
        "score": 0.0,
        "metrics": {"sample_size": int(len(y_true))},
    }


def _candidate_grid() -> list[tuple[float, float]]:
    draw_thresholds = np.round(np.arange(0.14, 0.501, 0.02), 4)
    margins = np.round(np.arange(0.00, 0.081, 0.02), 4)
    return [(float(t), float(m)) for t in draw_thresholds for m in margins]


def _predict_policy_probabilities(
    X: np.ndarray,
    league_labels: np.ndarray,
) -> tuple[np.ndarray, Dict[str, Any]]:
    registry = get_league_model_registry()
    policy = load_model_selection_policy()
    global_model = registry.get_model("global")
    proba = np.full((len(X), 3), 1.0 / 3.0, dtype=np.float64)
    routing: Dict[str, Any] = {}

    for league_key in sorted(set(str(label) for label in league_labels)):
        indices = np.where(league_labels == league_key)[0]
        if len(indices) == 0:
            continue

        league_X = X[indices]
        league_model = registry.get_model(league_key)
        decision = get_model_selection_decision(league_key, policy)
        decision_name = str(decision.get("decision") or "league")
        route = "uniform_fallback"
        global_weight = 0.0

        try:
            if decision_name == "blend" and league_model.is_fitted and global_model.is_fitted:
                global_weight = get_global_blend_weight(league_key, policy)
                league_weight = 1.0 - global_weight
                league_proba = _normalize_probabilities(league_model.predict_proba(league_X))
                global_proba = _normalize_probabilities(global_model.predict_proba(league_X))
                proba[indices] = (global_weight * global_proba) + (league_weight * league_proba)
                route = "blend"
            elif decision_name == "global" and global_model.is_fitted:
                proba[indices] = _normalize_probabilities(global_model.predict_proba(league_X))
                route = "global"
                global_weight = 1.0
            elif league_model.is_fitted:
                proba[indices] = _normalize_probabilities(league_model.predict_proba(league_X))
                route = "league"
            elif global_model.is_fitted and policy.get("fallback_to_global_when_league_missing", True):
                proba[indices] = _normalize_probabilities(global_model.predict_proba(league_X))
                route = "global_fallback"
                global_weight = 1.0
        except Exception as exc:
            route = f"error:{exc.__class__.__name__}"

        routing[league_key] = {
            "route": route,
            "global_weight": round(float(global_weight), 4),
            "samples": int(len(indices)),
            "policy_reason": decision.get("reason", "policy"),
        }

    return _normalize_probabilities(proba), routing


def _policy_metrics(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    league_labels: np.ndarray,
    tuning: Dict[str, Any],
    league_overrides: Optional[Dict[str, tuple[float, float]]] = None,
) -> Dict[str, Any]:
    preds = np.zeros(len(y_true), dtype=np.int32)
    for league_key in sorted(set(str(label) for label in league_labels)):
        indices = np.where(league_labels == league_key)[0]
        if len(indices) == 0:
            continue
        if league_overrides and league_key in league_overrides:
            draw_min, draw_margin = league_overrides[league_key]
        else:
            draw_min, draw_margin = _thresholds_from_tuning(tuning, league_key)
        preds[indices] = _decision_predictions(y_proba[indices], draw_min, draw_margin)
    return _metrics_from_predictions(y_true, y_proba, preds)


def _argmax_metrics(y_true: np.ndarray, y_proba: np.ndarray) -> Dict[str, Any]:
    return _metrics_from_predictions(y_true, y_proba, np.argmax(_normalize_probabilities(y_proba), axis=1))


def _pct(value: Optional[float]) -> str:
    if not isinstance(value, (int, float)):
        return "N/A"
    return f"{value * 100:.2f}%"


async def run_tuning(args: argparse.Namespace) -> Dict[str, Any]:
    historical = await fetch_historical_data(None, args.min_season, args.force_fetch)
    all_matches: list[dict] = []
    for hist_league, matches in historical.items():
        league_key = ESPN_TO_KEY.get(hist_league, hist_league)
        for match in matches:
            match["league"] = league_key
        all_matches.extend(matches)

    extra_matches = _load_existing_predictions()
    all_matches.extend(extra_matches)
    logger.info("Loaded %s total historical/prediction matches for tuning", len(all_matches))

    X, y_outcome, _y_goals, _seasons, league_labels = build_features_and_labels(all_matches, include_leagues=True)
    if len(X) < 100:
        raise RuntimeError(f"Not enough feature rows for tuning: {len(X)}")

    n = len(X)
    train_end = int(n * 0.70)
    cal_end = int(n * 0.85)
    X_cal, y_cal, labels_cal = X[train_end:cal_end], y_outcome[train_end:cal_end], league_labels[train_end:cal_end]
    X_test, y_test, labels_test = X[cal_end:], y_outcome[cal_end:], league_labels[cal_end:]

    logger.info(
        "Chronological split: train=%s calibration=%s test=%s",
        train_end,
        len(X_cal),
        len(X_test),
    )

    model_proba_cal, routing_cal = _predict_policy_probabilities(X_cal, labels_cal)
    model_proba_test, routing_test = _predict_policy_probabilities(X_test, labels_test)
    elo_proba_cal = _elo_proxy_probabilities(X_cal, labels_cal)
    elo_proba_test = _elo_proxy_probabilities(X_test, labels_test)
    candidates = _candidate_grid()
    blend_candidates = _blend_weight_grid()
    tuning = _load_current_tuning()

    current_proba_cal = _blend_model_with_elo(model_proba_cal, elo_proba_cal, labels_cal, tuning)
    current_proba_test = _blend_model_with_elo(model_proba_test, elo_proba_test, labels_test, tuning)

    argmax_test = _argmax_metrics(y_test, current_proba_test)
    current_policy_test = _policy_metrics(y_test, current_proba_test, labels_test, tuning)
    default_blend_params = _blend_params_from_tuning(tuning, "__default__")
    overall_selected = _tune_runtime_policy(
        y_cal,
        model_proba_cal,
        elo_proba_cal,
        candidates,
        blend_candidates,
        default_blend_params,
    )
    overall_test_proba = _blend_arrays_with_params(model_proba_test, elo_proba_test, overall_selected["blend"])
    overall_test = _metrics_from_predictions(
        y_test,
        overall_test_proba,
        _decision_predictions(
            overall_test_proba,
            float(overall_selected["draw_min_prob"]),
            float(overall_selected["draw_margin"]),
        ),
    )

    league_results: Dict[str, Any] = {}
    decision_overrides: Dict[str, tuple[float, float]] = {}
    blend_overrides: Dict[str, Dict[str, float]] = {}
    applied_leagues: list[str] = []

    for league_key in sorted(set(str(label) for label in np.concatenate([labels_cal, labels_test]))):
        cal_idx = np.where(labels_cal == league_key)[0]
        test_idx = np.where(labels_test == league_key)[0]
        if len(test_idx) == 0:
            continue

        current_draw_min, current_draw_margin = _thresholds_from_tuning(tuning, league_key)
        current_blend_params = _blend_params_from_tuning(tuning, league_key)
        current_metrics = _metrics_from_predictions(
            y_test[test_idx],
            current_proba_test[test_idx],
            _decision_predictions(current_proba_test[test_idx], current_draw_min, current_draw_margin),
        )

        selected = None
        selected_test = None
        apply_recommended = False
        reason = "insufficient_calibration_samples"

        if len(cal_idx) >= args.min_cal_samples:
            selected = _tune_runtime_policy(
                y_cal[cal_idx],
                model_proba_cal[cal_idx],
                elo_proba_cal[cal_idx],
                candidates,
                blend_candidates,
                current_blend_params,
            )
            selected_test_proba = _blend_arrays_with_params(
                model_proba_test[test_idx],
                elo_proba_test[test_idx],
                selected["blend"],
            )
            selected_test = _metrics_from_predictions(
                y_test[test_idx],
                selected_test_proba,
                _decision_predictions(
                    selected_test_proba,
                    float(selected["draw_min_prob"]),
                    float(selected["draw_margin"]),
                ),
            )
            if len(test_idx) < args.min_test_samples:
                reason = "monitor_only_small_test_sample"
            else:
                accuracy_lift = float(selected_test.get("accuracy") or 0.0) - float(current_metrics.get("accuracy") or 0.0)
                f1_lift = float(selected_test.get("f1_macro") or 0.0) - float(current_metrics.get("f1_macro") or 0.0)
                apply_recommended = (
                    accuracy_lift >= -args.max_accuracy_regression
                    and f1_lift >= -args.max_f1_regression
                    and _metric_score(selected_test) >= _metric_score(current_metrics)
                )
                reason = "test_guard_passed" if apply_recommended else "test_guard_failed"
            if apply_recommended:
                decision_overrides[league_key] = (
                    float(selected["draw_min_prob"]),
                    float(selected["draw_margin"]),
                )
                blend_overrides[league_key] = selected["blend"]
                applied_leagues.append(league_key)

        league_results[league_key] = {
            "display_name": LEAGUE_DISPLAY.get(league_key, league_key),
            "calibration_samples": int(len(cal_idx)),
            "test_samples": int(len(test_idx)),
            "routing": routing_test.get(league_key, routing_cal.get(league_key, {})),
            "current": {
                "blend": current_blend_params,
                "draw_min_prob": round(current_draw_min, 4),
                "draw_margin": round(current_draw_margin, 4),
                "metrics": current_metrics,
            },
            "selected": selected,
            "selected_test": selected_test,
            "apply_recommended": apply_recommended,
            "reason": reason,
        }

    tuned_proba_test = _blend_model_with_elo(
        model_proba_test,
        elo_proba_test,
        labels_test,
        tuning,
        blend_overrides,
    )
    tuned_policy_test = _policy_metrics(y_test, tuned_proba_test, labels_test, tuning, decision_overrides)
    payload = {
        "version": "2026-05-12",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "description": "Chronological calibration/test simulation for runtime neural/ELO blend weights plus tuned draw decision thresholds on current league/global/hybrid model probabilities.",
        "guarantee": False,
        "split": {
            "train_samples": int(train_end),
            "calibration_samples": int(len(X_cal)),
            "test_samples": int(len(X_test)),
            "train_fraction": 0.70,
            "calibration_fraction": 0.15,
            "test_fraction": 0.15,
        },
        "routing": {
            "calibration": routing_cal,
            "test": routing_test,
        },
        "baseline_argmax_test": argmax_test,
        "current_policy_test": current_policy_test,
        "overall_calibration_selected": overall_selected,
        "overall_selected_test": overall_test,
        "tuned_policy_test": tuned_policy_test,
        "applied_leagues": applied_leagues,
        "league_results": league_results,
        "notes": [
            "Runtime neural/ELO blend weights and draw thresholds are fit only on the calibration split and judged on the untouched chronological test split.",
            "The ELO prior is reconstructed from pre-match ELO features so this remains deployable without unlicensed future odds feeds.",
            "The model remains probabilistic; this artifact improves decision selection and calibration governance but does not guarantee betting outcomes.",
        ],
    }

    EXPERIMENT_FILE.write_text(json.dumps(payload, indent=2))
    logger.info("Wrote %s", EXPERIMENT_FILE)
    logger.info("Argmax test accuracy: %s", _pct(argmax_test.get("accuracy")))
    logger.info("Current policy test accuracy: %s", _pct(current_policy_test.get("accuracy")))
    logger.info("Tuned policy test accuracy: %s", _pct(tuned_policy_test.get("accuracy")))

    if args.apply:
        _apply_tuning_updates(tuning, payload)

    return payload


def _apply_tuning_updates(tuning: Dict[str, Any], payload: Dict[str, Any]) -> None:
    generated_at = datetime.now(timezone.utc).isoformat()
    tuning.setdefault("default", {})
    tuning.setdefault("leagues", {})
    tuning["version"] = "1.1.0"
    tuning["generated_at"] = generated_at
    tuning["description"] = (
        "Auto-tuned neural/ELO blending and draw-threshold parameters from completed "
        "prediction diagnostics plus chronological model decision-policy tuning."
    )
    tuning["decision_policy_experiment"] = {
        "generated_at": payload.get("generated_at"),
        "artifact": str(EXPERIMENT_FILE.relative_to(DATA_DIR.parent)),
        "guarantee": False,
        "baseline_argmax_accuracy": payload.get("baseline_argmax_test", {}).get("accuracy"),
        "current_policy_accuracy": payload.get("current_policy_test", {}).get("accuracy"),
        "tuned_policy_accuracy": payload.get("tuned_policy_test", {}).get("accuracy"),
        "current_policy_log_loss": payload.get("current_policy_test", {}).get("log_loss"),
        "tuned_policy_log_loss": payload.get("tuned_policy_test", {}).get("log_loss"),
        "applied_leagues": payload.get("applied_leagues", []),
    }

    for league_key in payload.get("applied_leagues", []):
        result = payload.get("league_results", {}).get(league_key, {})
        selected = result.get("selected") or {}
        selected_test = result.get("selected_test") or {}
        current = result.get("current", {}).get("metrics", {})
        league_tuning = tuning["leagues"].setdefault(league_key, {})
        league_tuning["display_name"] = result.get("display_name", LEAGUE_DISPLAY.get(league_key, league_key))
        for field, value in (selected.get("blend") or {}).items():
            league_tuning[field] = round(float(value), 4)
        league_tuning["draw_min_prob"] = round(float(selected.get("draw_min_prob", 0.24)), 4)
        league_tuning["draw_margin"] = round(float(selected.get("draw_margin", 0.02)), 4)
        league_tuning["decision_policy_source"] = "chronological_runtime_blend_and_decision_tuning"
        league_tuning["decision_policy_generated_at"] = payload.get("generated_at")
        league_tuning["decision_policy_calibration_samples"] = int(result.get("calibration_samples") or 0)
        league_tuning["decision_policy_test_samples"] = int(result.get("test_samples") or 0)
        league_tuning["decision_policy_test_accuracy"] = selected_test.get("accuracy")
        league_tuning["decision_policy_accuracy_lift"] = (
            float(selected_test.get("accuracy") or 0.0) - float(current.get("accuracy") or 0.0)
        )
        league_tuning["decision_policy_log_loss_lift"] = (
            float(current.get("log_loss") or 0.0) - float(selected_test.get("log_loss") or 0.0)
        )
        league_tuning["decision_policy_brier_lift"] = (
            float(current.get("brier_score") or 0.0) - float(selected_test.get("brier_score") or 0.0)
        )
        league_tuning["source_sample_size"] = int(result.get("calibration_samples") or 0)

    MODEL_TUNING_FILE.write_text(json.dumps(tuning, indent=2))
    logger.info("Applied threshold updates for %s leagues to %s", len(payload.get("applied_leagues", [])), MODEL_TUNING_FILE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tune soccer 1X2 draw decision thresholds")
    parser.add_argument("--min-season", type=int, default=1998)
    parser.add_argument("--force-fetch", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Update backend/data/model_tuning.json for leagues that pass test guards")
    parser.add_argument("--min-cal-samples", type=int, default=25)
    parser.add_argument("--min-test-samples", type=int, default=25)
    parser.add_argument("--max-accuracy-regression", type=float, default=0.0)
    parser.add_argument("--max-f1-regression", type=float, default=0.01)
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(run_tuning(parse_args()))
