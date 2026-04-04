"""
Training Feedback Loop — Analyze prediction outcomes and adjust model parameters.

Reads completed predictions, calculates league-specific accuracy metrics,
and computes gradient-based adjustments to LEAGUE_PARAMS in probabilistic.py.

This creates a feedback cycle:
  1. predict_upcoming.py stores pre-match predictions
  2. fetch-outcomes API (or this script) fills in real results
  3. This script analyzes accuracy and adjusts league parameters
  4. Next run of predict_upcoming.py uses improved parameters

Usage:
    python -m backend.scripts.train_feedback
"""

import json
import logging
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data" / "predictions"
ADJUSTMENTS_FILE = DATA_DIR / "model_adjustments.json"


def load_completed_predictions() -> List[dict]:
    """Load all predictions that have outcomes."""
    preds = []
    for f in sorted(DATA_DIR.glob("predictions_*.json")):
        try:
            with open(f) as fh:
                data = json.load(fh)
            for p in data.get("predictions", []):
                if p.get("actual_winner") is not None:
                    preds.append(p)
        except Exception:
            continue
    return preds


def calculate_league_adjustments(predictions: List[dict]) -> Dict[str, Dict]:
    """
    Calculate per-league parameter adjustments based on prediction outcomes.
    
    For each league, computes:
    - Draw rate adjustment: if we under/over-predict draws
    - Home advantage adjustment: if we under/over-predict home wins
    - Goals scale adjustment: if total predicted goals are systematically off
    - Dixon-Coles rho adjustment: if low-scoring predictions are miscalibrated
    """
    by_league: Dict[str, List[dict]] = defaultdict(list)
    for p in predictions:
        by_league[p["league"]].append(p)

    adjustments = {}

    for league, preds in by_league.items():
        n = len(preds)
        if n < 10:
            continue

        # ── Draw rate analysis ──
        actual_draws = sum(1 for p in preds if p["actual_winner"] == "draw")
        predicted_draws = sum(1 for p in preds if p["predicted_winner"] == "draw")
        actual_draw_rate = actual_draws / n
        predicted_draw_rate = predicted_draws / n
        # We compare against the average predicted draw probability
        avg_pred_draw_prob = sum(p["predicted_draw"] for p in preds) / n
        draw_adjustment = (actual_draw_rate - avg_pred_draw_prob) * 0.3  # Conservative learning rate

        # ── Home advantage analysis ──
        actual_home_wins = sum(1 for p in preds if p["actual_winner"] == "home")
        predicted_home_wins = sum(1 for p in preds if p["predicted_winner"] == "home")
        actual_home_rate = actual_home_wins / n
        avg_pred_home_prob = sum(p["predicted_home_win"] for p in preds) / n
        home_adv_adjustment = (actual_home_rate - avg_pred_home_prob) * 0.2

        # ── Goals scale analysis ──
        total_goals_diffs = []
        for p in preds:
            if p.get("actual_home_goals") is not None:
                actual_total = (p["actual_home_goals"] or 0) + (p["actual_away_goals"] or 0)
                pred_total = p["predicted_home_goals"] + p["predicted_away_goals"]
                total_goals_diffs.append(actual_total - pred_total)
        
        avg_goals_diff = sum(total_goals_diffs) / len(total_goals_diffs) if total_goals_diffs else 0
        # If we consistently under-predict goals, increase avg_goals
        goals_scale_adj = avg_goals_diff * 0.05  # Very conservative

        # ── Accuracy metrics ──
        correct = sum(1 for p in preds if p.get("winner_correct"))
        accuracy = correct / n
        
        # Brier score
        brier_sum = 0
        for p in preds:
            actual_vec = [
                1.0 if p["actual_winner"] == "home" else 0.0,
                1.0 if p["actual_winner"] == "draw" else 0.0,
                1.0 if p["actual_winner"] == "away" else 0.0,
            ]
            pred_vec = [p["predicted_home_win"], p["predicted_draw"], p["predicted_away_win"]]
            brier_sum += sum((pv - av) ** 2 for pv, av in zip(pred_vec, actual_vec))
        brier = brier_sum / n

        # Scoreline accuracy
        scoreline_correct = sum(1 for p in preds if p.get("scoreline_correct"))
        scoreline_rate = scoreline_correct / n

        adjustments[league] = {
            "predictions": n,
            "accuracy": round(accuracy, 4),
            "brier_score": round(brier, 4),
            "scoreline_rate": round(scoreline_rate, 4),
            "actual_draw_rate": round(actual_draw_rate, 4),
            "predicted_draw_rate": round(avg_pred_draw_prob, 4),
            "draw_rate_adjustment": round(draw_adjustment, 5),
            "actual_home_win_rate": round(actual_home_rate, 4),
            "predicted_home_win_rate": round(avg_pred_home_prob, 4),
            "home_adv_adjustment": round(home_adv_adjustment, 5),
            "avg_goals_diff": round(avg_goals_diff, 3),
            "goals_scale_adjustment": round(goals_scale_adj, 5),
            "confidence_calibration": {
                "high": _calibration_bucket(preds, 0.5, 1.0),
                "medium": _calibration_bucket(preds, 0.35, 0.5),
                "low": _calibration_bucket(preds, 0.0, 0.35),
            },
        }

    return adjustments


def _calibration_bucket(preds: List[dict], min_conf: float, max_conf: float) -> Dict:
    """Calculate accuracy for a confidence bucket."""
    bucket = [
        p for p in preds
        if min_conf <= max(p["predicted_home_win"], p["predicted_draw"], p["predicted_away_win"]) < max_conf
    ]
    if not bucket:
        return {"count": 0, "accuracy": 0}
    correct = sum(1 for p in bucket if p.get("winner_correct"))
    return {"count": len(bucket), "accuracy": round(correct / len(bucket), 4)}


def suggested_params(adjustments: Dict[str, Dict]) -> Dict[str, Dict]:
    """
    Generate suggested LEAGUE_PARAMS updates based on learned adjustments.
    """
    # Current base params (from probabilistic.py)
    from backend.services.prediction.probabilistic import LEAGUE_PARAMS, DEFAULT_PARAMS

    suggestions = {}
    for league, adj in adjustments.items():
        # Find matching params key
        params = None
        for key in LEAGUE_PARAMS:
            if key == league or LEAGUE_PARAMS[key] == league:
                params = LEAGUE_PARAMS[key].copy()
                break
        if params is None:
            params = DEFAULT_PARAMS.copy()

        new_params = {
            "avg_goals": round(params["avg_goals"] + adj["goals_scale_adjustment"], 3),
            "home_adv": round(
                max(0.10, min(0.40, params["home_adv"] + adj["home_adv_adjustment"])), 3
            ),
            "draw_rate": round(
                max(0.12, min(0.35, params["draw_rate"] + adj["draw_rate_adjustment"])), 3
            ),
            "rho": params["rho"],  # Keep rho stable unless we have strong evidence
        }

        # Only flag as changed if adjustments are meaningful
        changed = any(
            abs(new_params[k] - params[k]) > 0.005
            for k in ["avg_goals", "home_adv", "draw_rate"]
        )

        suggestions[league] = {
            "current": params,
            "suggested": new_params,
            "changed": changed,
        }

    return suggestions


def run_feedback():
    """Main feedback loop with online learning for neural network models."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    predictions = load_completed_predictions()
    if not predictions:
        logger.info("No completed predictions found. Run seed_predictions.py first.")
        return

    logger.info(f"Analyzing {len(predictions)} completed predictions...")

    adjustments = calculate_league_adjustments(predictions)

    # Overall metrics
    total = len(predictions)
    correct = sum(1 for p in predictions if p.get("winner_correct"))
    overall_accuracy = correct / total if total > 0 else 0

    # Save adjustments
    output = {
        "generated_at": datetime.now().isoformat(),
        "total_predictions_analyzed": total,
        "overall_accuracy": round(overall_accuracy, 4),
        "by_league": adjustments,
    }

    # Add suggested param updates
    try:
        suggestions = suggested_params(adjustments)
        output["suggested_params"] = suggestions
    except (ImportError, Exception) as e:
        logger.warning(f"Could not generate param suggestions: {e}")

    # ── Online learning: partial_fit neural network models ──
    try:
        _online_learn(predictions, adjustments)
    except Exception as e:
        logger.warning(f"Online learning step failed: {e}")

    # ── Update single-source-of-truth league_params.json ──
    try:
        _update_league_params(adjustments)
    except Exception as e:
        logger.warning(f"Failed to update league_params.json: {e}")

    with open(ADJUSTMENTS_FILE, "w") as f:
        json.dump(output, f, indent=2)

    logger.info(f"\n{'='*60}")
    logger.info("TRAINING FEEDBACK ANALYSIS COMPLETE")
    logger.info(f"  Overall accuracy: {overall_accuracy:.1%} ({correct}/{total})")
    logger.info(f"")

    for league, adj in sorted(adjustments.items()):
        indicator = "✓" if adj["accuracy"] >= 0.45 else "△" if adj["accuracy"] >= 0.35 else "✗"
        logger.info(
            f"  {indicator} {league}: {adj['accuracy']:.1%} accuracy ({adj['predictions']} matches), "
            f"Brier={adj['brier_score']:.4f}"
        )
        if abs(adj["draw_rate_adjustment"]) > 0.005:
            direction = "↑" if adj["draw_rate_adjustment"] > 0 else "↓"
            logger.info(
                f"     Draw rate: predicted {adj['predicted_draw_rate']:.1%} vs actual {adj['actual_draw_rate']:.1%} "
                f"→ adjust {direction}{abs(adj['draw_rate_adjustment']):.3f}"
            )
        if abs(adj["home_adv_adjustment"]) > 0.005:
            direction = "↑" if adj["home_adv_adjustment"] > 0 else "↓"
            logger.info(
                f"     Home adv: predicted {adj['predicted_home_win_rate']:.1%} vs actual {adj['actual_home_win_rate']:.1%} "
                f"→ adjust {direction}{abs(adj['home_adv_adjustment']):.3f}"
            )
        if abs(adj["avg_goals_diff"]) > 0.15:
            direction = "↑" if adj["avg_goals_diff"] > 0 else "↓"
            logger.info(
                f"     Goals: avg diff {adj['avg_goals_diff']:+.2f} → adjust {direction}{abs(adj['goals_scale_adjustment']):.4f}"
            )

    logger.info(f"")
    logger.info(f"  Adjustments saved to: {ADJUSTMENTS_FILE}")
    logger.info(f"{'='*60}")


# ── Display name → ESPN league key mapping ──
_DISPLAY_TO_KEY = {
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
}


def _online_learn(predictions: List[dict], adjustments: Dict[str, Dict]):
    """
    Run online/incremental learning on per-league neural network models.
    
    For each league with new outcomes, calls partial_fit() on the NN
    to update weights with the latest match data.
    """
    import numpy as np

    try:
        from backend.services.prediction.neural_model import get_league_model_registry
    except ImportError:
        logger.info("Neural model module not available — skipping online learning")
        return

    registry = get_league_model_registry()
    
    # Group recent predictions by league (latest outcomes per league).
    by_league: Dict[str, List[dict]] = defaultdict(list)
    for p in predictions:
        by_league[p["league"]].append(p)

    from backend.services.prediction.training import N_FEATURES

    updated = 0
    skipped_no_features = 0
    for league_display, preds in by_league.items():
        league_key = _DISPLAY_TO_KEY.get(league_display)
        if not league_key:
            continue

        model = registry.get_model(league_key)
        if not model.is_fitted:
            continue

        # Sort by date and use the latest finished matches.
        recent = sorted(preds, key=lambda p: p.get("match_date", ""))[-80:]

        # Use stored real feature vectors from predict_upcoming.py.
        # This prevents noisy updates from synthetic proxy features.
        X_list = []
        y_outcome = []
        y_goals = []

        for p in recent:
            if p.get("actual_winner") is None:
                continue

            fv = p.get("feature_vector")
            if not isinstance(fv, list) or len(fv) != N_FEATURES:
                continue

            try:
                features = np.array(fv, dtype=np.float64)
            except Exception:
                continue

            if not np.isfinite(features).all():
                continue

            # Outcome label
            actual = p["actual_winner"]
            if actual == "home":
                label = 0
            elif actual == "draw":
                label = 1
            else:
                label = 2

            X_list.append(features)
            y_outcome.append(label)
            y_goals.append([
                p.get("actual_home_goals", 0) or 0,
                p.get("actual_away_goals", 0) or 0
            ])

        if len(X_list) < 8:
            skipped_no_features += 1
            continue

        X = np.array(X_list, dtype=np.float64)
        y_out = np.array(y_outcome, dtype=np.int32)
        y_g = np.array(y_goals, dtype=np.float64)

        try:
            model.partial_fit(X, y_out, y_g)
            model.save()
            updated += 1
            logger.info(f"  Online update: {league_display} ({len(X_list)} real-feature samples)")
        except Exception as e:
            logger.warning(f"  Online update failed for {league_display}: {e}")

    if updated > 0:
        logger.info(f"  Online learning: updated {updated} league models")
    elif skipped_no_features > 0:
        logger.info("  Online learning skipped: insufficient completed predictions with stored feature vectors")


def _update_league_params(adjustments: Dict[str, Dict]):
    """
    Update the single-source-of-truth league_params.json with learned adjustments.
    """
    params_file = Path(__file__).parent.parent / "data" / "league_params.json"
    if not params_file.exists():
        return
    
    with open(params_file) as f:
        params_data = json.load(f)
    
    leagues = params_data.get("leagues", {})
    updated = 0
    
    for league_display, adj in adjustments.items():
        league_key = _DISPLAY_TO_KEY.get(league_display)
        if not league_key or league_key not in leagues:
            continue
        
        lp = leagues[league_key]
        
        # Apply conservative adjustments
        if abs(adj.get("draw_rate_adjustment", 0)) > 0.005:
            new_dr = round(max(0.12, min(0.35, lp["draw_rate"] + adj["draw_rate_adjustment"])), 4)
            lp["draw_rate"] = new_dr
            updated += 1
        
        if abs(adj.get("home_adv_adjustment", 0)) > 0.005:
            new_ha = round(max(0.10, min(0.40, lp["home_adv"] + adj["home_adv_adjustment"])), 4)
            lp["home_adv"] = new_ha
            updated += 1
        
        if abs(adj.get("goals_scale_adjustment", 0)) > 0.003:
            new_ag = round(lp["avg_goals"] + adj["goals_scale_adjustment"], 4)
            lp["avg_goals"] = new_ag
            updated += 1
    
    if updated > 0:
        params_data["updated_at"] = datetime.now().isoformat()
        with open(params_file, "w") as f:
            json.dump(params_data, f, indent=2)
        logger.info(f"  Updated league_params.json ({updated} parameter changes)")


if __name__ == "__main__":
    run_feedback()
