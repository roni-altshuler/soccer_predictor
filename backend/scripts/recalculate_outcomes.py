"""
Recalculate predicted_scoreline, predicted_winner, and winner_correct for
all existing predictions.

Two fixes applied:
1. Re-derive predicted_scoreline from stored xG using the improved
   poisson_scoreline function (fixes the "always 1-1" problem).
2. Re-derive predicted_winner from the new scoreline (consistency).
3. Recalculate winner_correct for completed matches.

Usage:
    python -m backend.scripts.recalculate_outcomes
"""

import json
import math
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data" / "predictions"


def _smart_round(xg: float) -> int:
    """Round xG to nearest integer (round-half-up).

    Standard rounding is more intuitive: xG 1.6 → 2 goals.
    The Poisson mode approach always favours the floor for
    typical soccer xG (0.8–1.8), producing too many draws.
    """
    return max(0, int(xg + 0.5))


def _poisson_scoreline(home_xg: float, away_xg: float) -> str:
    """Predict the most likely scoreline from expected goals."""
    h = _smart_round(home_xg)
    a = _smart_round(away_xg)
    xg_diff = home_xg - away_xg
    if h == a and abs(xg_diff) >= 0.30:
        if xg_diff > 0:
            h += 1
        else:
            a += 1
    return f"{h}-{a}"


def recalculate() -> dict:
    """Recalculate scoreline & winner for all predictions."""
    if not DATA_DIR.exists():
        logger.warning(f"Data directory not found: {DATA_DIR}")
        return {"files": 0, "fixed": 0, "total_completed": 0}

    files = sorted(DATA_DIR.glob("predictions_*.json"))
    total_fixed = 0
    total_completed = 0
    total_scoreline_fixed = 0
    files_modified = 0

    for file_path in files:
        try:
            with open(file_path) as f:
                file_data = json.load(f)
        except Exception:
            continue

        predictions = file_data.get("predictions", [])
        file_modified = False

        for pred in predictions:
            # Re-derive scoreline from xG
            home_xg = pred.get("predicted_home_goals")
            away_xg = pred.get("predicted_away_goals")
            if home_xg is None or away_xg is None:
                continue

            new_scoreline = _poisson_scoreline(float(home_xg), float(away_xg))
            old_scoreline = pred.get("predicted_scoreline", "")

            if new_scoreline != old_scoreline:
                pred["predicted_scoreline"] = new_scoreline
                file_modified = True
                total_scoreline_fixed += 1

            # Derive the correct predicted_winner from the new scoreline
            parts = new_scoreline.split("-")
            pred_h = int(parts[0])
            pred_a = int(parts[1])
            derived_winner = (
                "home" if pred_h > pred_a
                else "away" if pred_a > pred_h
                else "draw"
            )

            old_winner = pred.get("predicted_winner")
            if old_winner != derived_winner:
                pred["predicted_winner"] = derived_winner
                file_modified = True

            # If the match is completed, recalculate winner_correct
            actual_winner = pred.get("actual_winner")
            if actual_winner is not None:
                total_completed += 1
                old_correct = pred.get("winner_correct")
                new_correct = derived_winner == actual_winner

                if old_correct != new_correct or old_winner != derived_winner or old_scoreline != new_scoreline:
                    pred["winner_correct"] = new_correct
                    file_modified = True
                    total_fixed += 1

                # Fix scoreline_correct
                if pred.get("actual_home_goals") is not None and pred.get("actual_away_goals") is not None:
                    actual_sl = f"{pred['actual_home_goals']}-{pred['actual_away_goals']}"
                    pred["scoreline_correct"] = new_scoreline == actual_sl

        if file_modified:
            file_data["predictions"] = predictions
            with open(file_path, "w") as f:
                json.dump(file_data, f, indent=2)
            files_modified += 1
            logger.info(f"Updated {file_path.name}")

    return {
        "files": files_modified,
        "fixed": total_fixed,
        "scoreline_fixed": total_scoreline_fixed,
        "total_completed": total_completed,
    }


def main():
    logger.info("=" * 60)
    logger.info("RECALCULATING PREDICTION OUTCOMES")
    logger.info("Re-deriving scorelines from xG + winners from scorelines")
    logger.info("=" * 60)

    result = recalculate()

    logger.info(f"\n{'=' * 60}")
    logger.info("RECALCULATION COMPLETE")
    logger.info(f"  Completed predictions reviewed: {result['total_completed']}")
    logger.info(f"  Scorelines re-derived: {result['scoreline_fixed']}")
    logger.info(f"  Outcome records fixed: {result['fixed']}")
    logger.info(f"  Files modified: {result['files']}")
    logger.info(f"{'=' * 60}")


if __name__ == "__main__":
    main()
