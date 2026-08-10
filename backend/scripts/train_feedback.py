"""
Training Feedback Loop — report how predictions scored, and update the nets.

Reads completed predictions and calculates per-league accuracy, Brier, and the
gap between predicted and actual draw / home-win rates. Those diagnostics land
in `model_adjustments.json` and are worth reading: a league whose draws are
systematically over-predicted is telling you something.

  1. predict_upcoming.py stores pre-match predictions
  2. fetch-outcomes API (or this script) fills in real results
  3. This script reports per-league accuracy and calibration gaps
  4. Neural heads are updated from stored real feature vectors

WHAT IT NO LONGER DOES, and why (2026-08-10). Steps 3 and 5 used to close a
loop: the measured gap was multiplied by a small learning rate and added to
`avg_goals`, `home_adv` and `draw_rate`, then clamped, then served. Nothing
compared the result to the truth, so the update had no reason to converge —
and it did not. Every one of the fourteen leagues walked to a clamp and stayed
there: the Premier League ended at `avg_goals` 0.75 and `home_adv` 0.05, which
says a top-flight match finishes 0.8-0.75. Those values were live on
`/predict`. A second copy of the same arithmetic reached serving through
`suggested_params` -> `predict_upcoming.load_learned_adjustments`.

Both paths are closed. Those three parameters are directly observable, so
`backend/scripts/fit_league_params.py` measures them from completed matches in
the warehouse instead — idempotent, convergent by construction, and loud when
an estimate lands on a sanity rail.

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

# The per-league goal/home-advantage/draw parameters this module used to write
# now live in backend/scripts/fit_league_params.py, which MEASURES them from
# completed matches rather than nudging them. Its sanity rails are defined
# there, where a value reaching one is treated as an estimator bug rather than
# a resting place. See _update_league_params() below for what went wrong.


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
    """Returns nothing. Serving parameters are fitted, not suggested.

    What this produced was a nudge on top of the current value, clamped — the
    same arithmetic as the drift loop in `_update_league_params`, and
    `predict_upcoming.load_learned_adjustments` applied its output on top of
    `league_params.json` at serve time. So a parameter could be pushed off a
    measured value twice over, by two paths, neither of which ever checked
    whether the push helped.

    `avg_goals`, `home_adv` and `draw_rate` are observable quantities.
    `backend.scripts.fit_league_params` measures them from completed matches;
    that is the only writer now. The key is kept in the artifact as an empty
    object so an older reader sees "no suggestions" rather than a KeyError.
    """
    return {}


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
    "UEFA European Championship": "uefa.euro",
    "Copa America": "conmebol.america",
}


def _online_learn(predictions: List[dict], adjustments: Dict[str, Dict]):
    """
    Run online/incremental learning on neural network models.
    
    For each league with new outcomes, calls partial_fit() on the NN
    to update weights with the latest match data. If a cross-league
    "global" model exists, update it from the latest real-feature
    samples across all competitions as the long-term challenger model.
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

    def _sample_arrays(recent_preds: List[dict]):
        # Use stored real feature vectors from predict_upcoming.py.
        # This prevents noisy updates from synthetic proxy features.
        X_list = []
        y_outcome = []
        y_goals = []

        for p in recent_preds:
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
                p.get("actual_away_goals", 0) or 0,
            ])

        if not X_list:
            return None, None, None

        return (
            np.array(X_list, dtype=np.float64),
            np.array(y_outcome, dtype=np.int32),
            np.array(y_goals, dtype=np.float64),
        )

    def _mark_online_update(model, sample_count: int):
        model.training_metadata["last_online_update"] = datetime.utcnow().isoformat()
        model.training_metadata["last_online_update_samples"] = sample_count

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
        X, y_out, y_g = _sample_arrays(recent)

        if X is None or len(X) < 8:
            skipped_no_features += 1
            continue

        try:
            model.partial_fit(X, y_out, y_g)
            _mark_online_update(model, len(X))
            model.save()
            updated += 1
            logger.info(f"  Online update: {league_display} ({len(X)} real-feature samples)")
        except Exception as e:
            logger.warning(f"  Online update failed for {league_display}: {e}")

    try:
        global_model = registry.get_model("global")
    except Exception as e:
        global_model = None
        logger.debug(f"  Global online model load skipped: {e}")

    if global_model is not None and global_model.is_fitted:
        recent_global = sorted(predictions, key=lambda p: p.get("match_date", ""))[-240:]
        X, y_out, y_g = _sample_arrays(recent_global)

        if X is not None and len(X) >= 24:
            try:
                global_model.partial_fit(X, y_out, y_g)
                _mark_online_update(global_model, len(X))
                global_model.save()
                updated += 1
                logger.info(f"  Online update: global model ({len(X)} real-feature samples)")
            except Exception as e:
                logger.warning(f"  Online update failed for global model: {e}")
        else:
            logger.info("  Global online learning skipped: need at least 24 completed real-feature samples")

    if updated > 0:
        logger.info(f"  Online learning: updated {updated} neural model(s)")
    elif skipped_no_features > 0:
        logger.info("  Online learning skipped: insufficient completed predictions with stored feature vectors")


def _update_league_params(adjustments: Dict[str, Dict]):
    """Deliberately a no-op. `league_params.json` is fitted, not nudged.

    This function used to add a fraction of the latest prediction error to
    `avg_goals`, `home_adv` and `draw_rate` on every run and clamp the result.
    Nothing in that loop compared the parameter to the truth, so the error term
    never had to shrink and each value performed a random walk until it reached
    a clamp and stopped. By 2026-08-10 every one of the fourteen leagues was
    resting on a rail: the Premier League at `avg_goals` 0.75 and `home_adv`
    0.05 — a league where a match finishes 0.8-0.75 and home advantage is worth
    a twentieth of a goal. Those values reached the `/predict` page.

    All three quantities are directly observable, so
    `backend/scripts/fit_league_params.py` measures them from completed matches
    in the warehouse instead. That estimator is idempotent and converges by
    construction; this one could not converge at all.

    The accuracy REPORTING above is untouched and still useful — knowing a
    league's draws are under-predicted is worth recording. What is removed is
    the part that let that observation write itself into a serving artifact
    without ever being scored.
    """
    logger.info(
        "  league_params.json is fitted from the warehouse by "
        "backend.scripts.fit_league_params — no drift applied here"
    )


if __name__ == "__main__":
    run_feedback()
