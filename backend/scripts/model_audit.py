"""
Run league-level diagnostics from completed prediction history.

Produces:
- backend/data/model_diagnostics.json (metrics + drift + walk-forward diagnostics)
- backend/data/model_tuning.json (per-league blend and draw-threshold tuning)

Usage:
    python -m backend.scripts.model_audit
    python -m backend.scripts.model_audit --apply
"""

import argparse
import json
import logging
import math
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
PREDICTIONS_DIR = BASE_DIR / "data" / "predictions"
DIAGNOSTICS_FILE = BASE_DIR / "data" / "model_diagnostics.json"
TUNING_FILE = BASE_DIR / "data" / "model_tuning.json"

VALID_OUTCOMES = ("home", "draw", "away")
OUTCOME_INDEX = {"home": 0, "draw": 1, "away": 2}

LEAGUE_NAME_TO_KEY = {
    "Premier League": "eng.1",
    "La Liga": "esp.1",
    "Bundesliga": "ger.1",
    "Serie A": "ita.1",
    "Ligue 1": "fra.1",
    "MLS": "usa.1",
    "Champions League": "uefa.champions",
    "Europa League": "uefa.europa",
    "Conference League": "uefa.europa.conf",
    "Eredivisie": "ned.1",
    "Primeira Liga": "por.1",
    "FIFA World Cup": "fifa.world",
    "UEFA European Championship": "uefa.euro",
    "Copa America": "conmebol.america",
}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def round4(value: float) -> float:
    return round(float(value), 4)


def normalize_probs(pred: Dict) -> Tuple[float, float, float]:
    home = float(pred.get("predicted_home_win") or 0.0)
    draw = float(pred.get("predicted_draw") or 0.0)
    away = float(pred.get("predicted_away_win") or 0.0)
    total = home + draw + away
    if total <= 0:
        return 1 / 3, 1 / 3, 1 / 3
    return home / total, draw / total, away / total


def get_predicted_winner(pred: Dict) -> str:
    winner = pred.get("predicted_winner")
    if winner in VALID_OUTCOMES:
        return winner

    home, draw, away = normalize_probs(pred)
    if home >= draw and home >= away:
        return "home"
    if away >= draw and away >= home:
        return "away"
    return "draw"


def brier_score(pred: Dict) -> float:
    actual = pred.get("actual_winner")
    if actual not in VALID_OUTCOMES:
        return 0.0

    probs = normalize_probs(pred)
    observed = [0.0, 0.0, 0.0]
    observed[OUTCOME_INDEX[actual]] = 1.0
    return sum((probs[i] - observed[i]) ** 2 for i in range(3)) / 3.0


def log_loss(pred: Dict) -> float:
    actual = pred.get("actual_winner")
    if actual not in VALID_OUTCOMES:
        return 0.0

    probs = normalize_probs(pred)
    actual_prob = probs[OUTCOME_INDEX[actual]]
    return -math.log(max(1e-12, actual_prob))


def compute_metric_block(predictions: List[Dict]) -> Dict:
    total = len(predictions)
    if total == 0:
        return {
            "sample_size": 0,
            "accuracy": 0.0,
            "avg_confidence": 0.0,
            "brier_score": 0.0,
            "log_loss": 0.0,
            "expected_calibration_error": 0.0,
            "draw_actual_rate": 0.0,
            "draw_predicted_rate": 0.0,
            "draw_probability_gap": 0.0,
        }

    correct = 0
    conf_sum = 0.0
    brier_sum = 0.0
    logloss_sum = 0.0
    draw_actual_count = 0
    draw_pred_sum = 0.0

    bins = [{"count": 0, "conf": 0.0, "acc": 0.0} for _ in range(10)]

    for pred in predictions:
        actual = pred.get("actual_winner")
        if actual not in VALID_OUTCOMES:
            continue

        probs = normalize_probs(pred)
        predicted = get_predicted_winner(pred)
        confidence = max(probs)

        if predicted == actual:
            correct += 1

        if actual == "draw":
            draw_actual_count += 1

        draw_pred_sum += probs[1]
        conf_sum += confidence
        brier_sum += brier_score(pred)
        logloss_sum += log_loss(pred)

        idx = min(9, int(confidence * 10))
        bins[idx]["count"] += 1
        bins[idx]["conf"] += confidence
        bins[idx]["acc"] += 1.0 if predicted == actual else 0.0

    ece = 0.0
    for bucket in bins:
        if bucket["count"] == 0:
            continue
        avg_conf = bucket["conf"] / bucket["count"]
        avg_acc = bucket["acc"] / bucket["count"]
        ece += abs(avg_acc - avg_conf) * (bucket["count"] / total)

    accuracy = correct / total
    avg_confidence = conf_sum / total
    draw_actual_rate = draw_actual_count / total
    draw_predicted_rate = draw_pred_sum / total

    return {
        "sample_size": total,
        "accuracy": round4(accuracy),
        "avg_confidence": round4(avg_confidence),
        "brier_score": round4(brier_sum / total),
        "log_loss": round4(logloss_sum / total),
        "expected_calibration_error": round4(ece),
        "draw_actual_rate": round4(draw_actual_rate),
        "draw_predicted_rate": round4(draw_predicted_rate),
        "draw_probability_gap": round4(draw_actual_rate - draw_predicted_rate),
    }


def compute_reliability_bins(predictions: List[Dict]) -> List[Dict]:
    buckets = [{"count": 0, "conf": 0.0, "acc": 0.0} for _ in range(10)]

    for pred in predictions:
        actual = pred.get("actual_winner")
        if actual not in VALID_OUTCOMES:
            continue

        probs = normalize_probs(pred)
        predicted = get_predicted_winner(pred)
        confidence = max(probs)
        idx = min(9, int(confidence * 10))

        buckets[idx]["count"] += 1
        buckets[idx]["conf"] += confidence
        buckets[idx]["acc"] += 1.0 if predicted == actual else 0.0

    result = []
    for idx, bucket in enumerate(buckets):
        low = idx / 10
        high = (idx + 1) / 10
        count = bucket["count"]
        if count == 0:
            result.append(
                {
                    "bucket": f"{low:.1f}-{high:.1f}",
                    "range_min": round4(low),
                    "range_max": round4(high),
                    "sample_size": 0,
                    "avg_confidence": 0.0,
                    "accuracy": 0.0,
                    "calibration_gap": 0.0,
                }
            )
            continue

        avg_confidence = bucket["conf"] / count
        accuracy = bucket["acc"] / count
        result.append(
            {
                "bucket": f"{low:.1f}-{high:.1f}",
                "range_min": round4(low),
                "range_max": round4(high),
                "sample_size": count,
                "avg_confidence": round4(avg_confidence),
                "accuracy": round4(accuracy),
                "calibration_gap": round4(accuracy - avg_confidence),
            }
        )

    return result


def compute_confusion_matrix(predictions: List[Dict]) -> Dict:
    matrix = [[0, 0, 0] for _ in range(3)]

    for pred in predictions:
        actual = pred.get("actual_winner")
        if actual not in VALID_OUTCOMES:
            continue
        predicted = get_predicted_winner(pred)
        matrix[OUTCOME_INDEX[predicted]][OUTCOME_INDEX[actual]] += 1

    normalized = []
    for row in matrix:
        row_total = sum(row)
        if row_total == 0:
            normalized.append([0.0, 0.0, 0.0])
        else:
            normalized.append([round4(v / row_total) for v in row])

    return {
        "labels": ["home", "draw", "away"],
        "matrix": matrix,
        "normalized": normalized,
    }


def sort_predictions(predictions: List[Dict]) -> List[Dict]:
    return sorted(
        predictions,
        key=lambda p: (
            p.get("match_date", ""),
            p.get("prediction_timestamp", ""),
            p.get("match_id", ""),
        ),
    )


def compute_walk_forward(predictions: List[Dict]) -> Dict:
    ordered = sort_predictions(predictions)
    n = len(ordered)

    if n < 60:
        return {
            "window_size": 0,
            "step_size": 0,
            "folds": [],
        }

    min_train = max(36, min(120, n // 2))
    test_window = max(12, min(24, n // 6))
    step = test_window

    folds = []
    fold_number = 1
    idx = min_train
    while idx + test_window <= n:
        test_slice = ordered[idx:idx + test_window]
        metrics = compute_metric_block(test_slice)
        folds.append(
            {
                "fold": fold_number,
                "train_size": idx,
                "test_size": len(test_slice),
                "end_date": test_slice[-1].get("match_date"),
                "accuracy": metrics["accuracy"],
                "brier_score": metrics["brier_score"],
                "log_loss": metrics["log_loss"],
                "expected_calibration_error": metrics["expected_calibration_error"],
            }
        )
        fold_number += 1
        idx += step

    return {
        "window_size": test_window,
        "step_size": step,
        "folds": folds,
    }


def compute_drift_alerts(predictions: List[Dict]) -> List[Dict]:
    ordered = sort_predictions(predictions)
    n = len(ordered)
    if n < 50:
        return []

    window = min(30, n // 2)
    prev = ordered[-(2 * window):-window]
    recent = ordered[-window:]
    prev_metrics = compute_metric_block(prev)
    recent_metrics = compute_metric_block(recent)

    alerts: List[Dict] = []

    acc_delta = recent_metrics["accuracy"] - prev_metrics["accuracy"]
    if acc_delta <= -0.08:
        alerts.append(
            {
                "severity": "high",
                "metric": "accuracy",
                "change": round4(acc_delta),
                "message": "Accuracy dropped sharply in the most recent window.",
            }
        )
    elif acc_delta <= -0.05:
        alerts.append(
            {
                "severity": "medium",
                "metric": "accuracy",
                "change": round4(acc_delta),
                "message": "Accuracy drift detected versus previous matches.",
            }
        )

    brier_delta = recent_metrics["brier_score"] - prev_metrics["brier_score"]
    if brier_delta >= 0.04:
        alerts.append(
            {
                "severity": "high",
                "metric": "brier_score",
                "change": round4(brier_delta),
                "message": "Probability quality worsened (higher Brier score).",
            }
        )
    elif brier_delta >= 0.02:
        alerts.append(
            {
                "severity": "medium",
                "metric": "brier_score",
                "change": round4(brier_delta),
                "message": "Brier score trending upward.",
            }
        )

    ece_level = recent_metrics["expected_calibration_error"]
    if ece_level >= 0.12:
        alerts.append(
            {
                "severity": "high",
                "metric": "expected_calibration_error",
                "change": round4(ece_level),
                "message": "Model confidence is materially miscalibrated.",
            }
        )
    elif ece_level >= 0.08:
        alerts.append(
            {
                "severity": "medium",
                "metric": "expected_calibration_error",
                "change": round4(ece_level),
                "message": "Calibration drift emerging; confidence exceeds hit rate.",
            }
        )

    return alerts


def suggest_tuning(predictions: List[Dict], metrics: Dict) -> Dict:
    accuracy = float(metrics["accuracy"])
    avg_conf = float(metrics["avg_confidence"])
    ece = float(metrics["expected_calibration_error"])
    draw_gap = float(metrics["draw_probability_gap"])

    overconfidence = avg_conf - accuracy

    blend_nn_base = 0.69 - overconfidence * 0.35 - max(0.0, ece - 0.08) * 0.30
    blend_nn_base = clamp(blend_nn_base, 0.58, 0.82)

    entropy_sensitivity = 0.16 + max(0.0, accuracy - 0.50) * 0.20
    entropy_sensitivity = clamp(entropy_sensitivity, 0.10, 0.25)

    draw_min_prob = 0.23 + draw_gap * 0.55
    draw_min_prob = clamp(draw_min_prob, 0.16, 0.35)

    draw_margin = 0.02 + draw_gap * 0.40
    draw_margin = clamp(draw_margin, 0.00, 0.10)

    blend_nn_min = clamp(blend_nn_base - 0.11, 0.50, 0.76)
    blend_nn_max = clamp(blend_nn_base + 0.13, 0.64, 0.90)

    return {
        "blend_nn_base": round4(blend_nn_base),
        "blend_nn_min": round4(blend_nn_min),
        "blend_nn_max": round4(blend_nn_max),
        "entropy_sensitivity": round4(entropy_sensitivity),
        "draw_min_prob": round4(draw_min_prob),
        "draw_margin": round4(draw_margin),
        "source_sample_size": len(predictions),
    }


def load_completed_predictions() -> Dict[str, List[Dict]]:
    by_league: Dict[str, List[Dict]] = defaultdict(list)

    if not PREDICTIONS_DIR.exists():
        return by_league

    for file_path in sorted(PREDICTIONS_DIR.glob("predictions_*.json")):
        try:
            with open(file_path) as f:
                data = json.load(f)
        except Exception as e:
            logger.warning(f"Could not parse {file_path.name}: {e}")
            continue

        for pred in data.get("predictions", []):
            if pred.get("actual_winner") not in VALID_OUTCOMES:
                continue
            league = pred.get("league") or "Unknown"
            by_league[league].append(pred)

    for league in by_league:
        by_league[league] = sort_predictions(by_league[league])

    return by_league


def build_outputs() -> Tuple[Dict, Dict]:
    by_league = load_completed_predictions()

    diagnostics = {
        "generated_at": datetime.now().isoformat(),
        "total_completed_predictions": sum(len(rows) for rows in by_league.values()),
        "league_count": len(by_league),
        "leagues": {},
        "top_alerts": [],
    }

    tuning = {
        "version": "1.0.0",
        "generated_at": diagnostics["generated_at"],
        "description": "Auto-tuned blend and draw-threshold parameters from completed prediction diagnostics.",
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

    all_alerts: List[Dict] = []

    for league_name in sorted(by_league.keys()):
        rows = by_league[league_name]
        metrics = compute_metric_block(rows)
        reliability_bins = compute_reliability_bins(rows)
        confusion = compute_confusion_matrix(rows)
        walk_forward = compute_walk_forward(rows)
        drift_alerts = compute_drift_alerts(rows)
        tuning_params = suggest_tuning(rows, metrics)

        diagnostics["leagues"][league_name] = {
            **metrics,
            "reliability_bins": reliability_bins,
            "confusion_matrix": confusion,
            "walk_forward": walk_forward,
            "drift_alerts": drift_alerts,
            "tuning": tuning_params,
        }

        league_key = LEAGUE_NAME_TO_KEY.get(league_name, league_name)
        tuning["leagues"][league_key] = {
            "display_name": league_name,
            **tuning_params,
        }

        for alert in drift_alerts:
            all_alerts.append({"league": league_name, **alert})

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    diagnostics["top_alerts"] = sorted(
        all_alerts,
        key=lambda a: (severity_rank.get(a.get("severity", "low"), 2), -abs(float(a.get("change", 0.0)))),
    )[:25]

    return diagnostics, tuning


def save_json(file_path: Path, payload: Dict):
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, "w") as f:
        json.dump(payload, f, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Run model diagnostics and tuning")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write model_tuning.json used by predict_upcoming.py",
    )
    args = parser.parse_args()

    diagnostics, tuning = build_outputs()
    save_json(DIAGNOSTICS_FILE, diagnostics)

    logger.info("=" * 68)
    logger.info("MODEL DIAGNOSTIC AUDIT")
    logger.info("=" * 68)
    logger.info(f"Leagues analyzed: {diagnostics['league_count']}")
    logger.info(f"Completed predictions: {diagnostics['total_completed_predictions']}")
    logger.info(f"Diagnostics written: {DIAGNOSTICS_FILE}")

    if args.apply:
        save_json(TUNING_FILE, tuning)
        logger.info(f"Tuning written: {TUNING_FILE}")
    else:
        logger.info("Tuning file not written (run with --apply to persist tuning)")

    logger.info("=" * 68)


if __name__ == "__main__":
    main()
