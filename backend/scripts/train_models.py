"""
Train per-league neural network models on multi-season historical data.

Fetches 15+ seasons of match data from ESPN + football-data.co.uk, engineers
55-dimensional feature vectors (including market-implied probabilities, tactical
stats, and league characteristics), and trains per-league ensemble models
(NN + XGBoost + LightGBM + GBT + RF).

Season weighting: exponential decay with stronger emphasis on recent 5 seasons.
Older seasons still contribute to model robustness.

Usage:
    python -m backend.scripts.train_models
    python -m backend.scripts.train_models --leagues eng.1 esp.1
    python -m backend.scripts.train_models --min-season 2010 --force
"""

import asyncio
import argparse
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
PREDICTIONS_DIR = DATA_DIR / "predictions"
RESULTS_FILE = DATA_DIR / "training_results.json"


def compute_season_weights(seasons: np.ndarray, current_season: int = 2025) -> np.ndarray:
    """
    Compute sample weights with exponential decay for season recency.

    Uses smooth exponential decay: w = max(0.15, exp(-0.12 * age))
    This gives:
      current season:  1.00
      1 year ago:      0.89
      2 years ago:     0.79
      3 years ago:     0.70
      5 years ago:     0.55
      10 years ago:    0.30
      15+ years ago:   0.15 (floor)
    """
    weights = np.ones(len(seasons), dtype=np.float64)
    for i, s in enumerate(seasons):
        age = max(0, current_season - s)
        weights[i] = max(0.15, np.exp(-0.12 * age))
    return weights


async def fetch_historical_data(
    leagues: Optional[List[str]] = None,
    min_season: int = 2010,
    force: bool = False,
) -> Dict[str, List[dict]]:
    """Fetch multi-season historical data using the HistoricalDataCollector."""
    from backend.services.prediction.historical_data import get_historical_collector
    
    collector = get_historical_collector()
    logger.info(f"Fetching historical data (min_season={min_season}, force={force})...")
    
    data = await collector.fetch_all_historical_data(
        leagues=leagues,
        min_season=min_season,
        force=force,
    )
    
    total = sum(len(v) for v in data.values())
    logger.info(f"Fetched {total} matches across {len(data)} leagues")
    
    for league, matches in data.items():
        logger.info(f"  {league}: {len(matches)} matches")
    
    return data


def _load_existing_predictions() -> List[dict]:
    """Load all completed predictions for additional training data."""
    all_preds = []
    if not PREDICTIONS_DIR.exists():
        return all_preds
    
    for f in sorted(PREDICTIONS_DIR.glob("predictions_*.json")):
        try:
            with open(f) as fh:
                data = json.load(fh)
            for p in data.get("predictions", []):
                if p.get("actual_winner") is not None:
                    all_preds.append({
                        "match_id": p["match_id"],
                        "home_team": p["home_team"],
                        "away_team": p["away_team"],
                        "league": p.get("league", ""),
                        "date": p.get("match_date", ""),
                        "home_score": p.get("actual_home_goals", 0),
                        "away_score": p.get("actual_away_goals", 0),
                        "season": int(p.get("match_date", "2025")[:4]),
                    })
        except Exception:
            continue
    
    return all_preds


def build_features_and_labels(
    matches: List[dict],
) -> tuple:
    """
    Build feature matrix, outcome labels, goal targets, and season array
    from raw match data using the FeatureBuilder from training.py.
    """
    from backend.services.prediction.training import FeatureBuilder
    
    builder = FeatureBuilder()
    sorted_matches = sorted(matches, key=lambda m: m.get("date", ""))
    
    X_list = []
    y_outcome_list = []
    y_goals_list = []
    seasons_list = []
    
    for match in sorted_matches:
        hs = match.get("home_score")
        as_ = match.get("away_score")
        if hs is None or as_ is None:
            builder.update_state(match)
            continue
        
        # Build features BEFORE updating state (pre-match features)
        features = builder.build_features_for_match(match)
        builder.update_state(match)
        
        if features is None:
            continue
        
        # Outcome label
        if hs > as_:
            label = 0  # Home win
        elif hs == as_:
            label = 1  # Draw
        else:
            label = 2  # Away win
        
        X_list.append(features)
        y_outcome_list.append(label)
        y_goals_list.append([hs, as_])
        seasons_list.append(match.get("season", 2025))
    
    if not X_list:
        return np.array([]), np.array([]), np.array([]), np.array([])
    
    X = np.array(X_list, dtype=np.float64)
    y_outcome = np.array(y_outcome_list, dtype=np.int32)
    y_goals = np.array(y_goals_list, dtype=np.float64)
    seasons = np.array(seasons_list, dtype=np.int32)
    
    # Handle NaN/Inf
    X = np.nan_to_num(X, nan=0.0, posinf=5.0, neginf=-5.0)
    
    return X, y_outcome, y_goals, seasons


# ESPN ID → league key mapping
ESPN_TO_KEY = {
    "premier_league": "eng.1",
    "la_liga": "esp.1",
    "bundesliga": "ger.1",
    "serie_a": "ita.1",
    "ligue_1": "fra.1",
    "eredivisie": "ned.1",
    "primeira_liga": "por.1",
    "mls": "usa.1",
    "champions_league": "uefa.champions",
    "europa_league": "uefa.europa",
    "world_cup": "fifa.world",
}

KEY_TO_ESPN = {v: k for k, v in ESPN_TO_KEY.items()}


async def train_all_models(
    leagues: Optional[List[str]] = None,
    min_season: int = 2010,
    force_fetch: bool = False,
) -> Dict[str, dict]:
    """
    Full training pipeline:
    1. Fetch multi-season historical data from ESPN + football-data.co.uk
    2. Also incorporate existing prediction outcomes
    3. Build features per league
    4. Train per-league neural network ensemble models
    5. Save model artifacts
    6. Return training results
    """
    from backend.services.prediction.neural_model import (
        PerLeagueNeuralModel,
        get_league_model_registry,
    )
    
    registry = get_league_model_registry()
    
    # ── Step 1: Fetch historical data ──
    espn_leagues = None
    if leagues:
        espn_leagues = [KEY_TO_ESPN.get(lk, lk) for lk in leagues]
    
    historical = await fetch_historical_data(espn_leagues, min_season, force_fetch)
    
    # ── Step 2: Load existing prediction outcomes for extra training data ──
    extra_matches = _load_existing_predictions()
    logger.info(f"Loaded {len(extra_matches)} additional matches from prediction outcomes")
    
    # ── Step 3: Train per-league models ──
    results: Dict[str, dict] = {}
    
    for hist_league, matches in historical.items():
        league_key = ESPN_TO_KEY.get(hist_league, hist_league)
        
        if leagues and league_key not in leagues:
            continue
        
        # Add extra matches for this league's display name
        league_display = registry.get_params(league_key).get("display_name", hist_league)
        league_extra = [m for m in extra_matches if m.get("league") == league_display]
        all_matches = matches + league_extra
        
        if len(all_matches) < 50:
            logger.warning(f"[{league_key}] Only {len(all_matches)} matches — skipping")
            results[league_key] = {"error": "insufficient_data", "matches": len(all_matches)}
            continue
        
        logger.info(f"\n{'='*60}")
        logger.info(f"Training {league_key} ({league_display})")
        logger.info(f"  Historical: {len(matches)}, Predictions: {len(league_extra)}")
        logger.info(f"{'='*60}")
        
        # Build features
        X, y_outcome, y_goals, seasons = build_features_and_labels(all_matches)
        
        if len(X) < 30:
            logger.warning(f"[{league_key}] Only {len(X)} valid samples after feature engineering")
            results[league_key] = {"error": "insufficient_features", "samples": len(X)}
            continue
        
        # Compute season weights (emphasis on recent 5 seasons)
        weights = compute_season_weights(seasons)
        
        logger.info(f"[{league_key}] Feature matrix: {X.shape}, weighted by season recency")
        logger.info(f"  Distribution: H={int((y_outcome==0).sum())}, D={int((y_outcome==1).sum())}, A={int((y_outcome==2).sum())}")
        
        # Get or create model
        model = registry.get_model(league_key)
        
        # Train
        metrics = model.train(X, y_outcome, y_goals, sample_weights=weights)
        
        # Save
        model.save()
        
        results[league_key] = {
            "status": "success",
            "matches": len(all_matches),
            "features": int(X.shape[1]) if X.ndim > 1 else 0,
            "samples": len(X),
            "metrics": metrics,
        }
        
        # Log results
        if "error" not in metrics:
            nn_acc = metrics.get("nn_accuracy", 0)
            ens_acc = metrics.get("ensemble_accuracy", 0)
            cv_acc = metrics.get("cv_accuracy_mean", 0)
            logger.info(f"[{league_key}] Results:")
            logger.info(f"  NN accuracy:       {nn_acc:.3f}")
            logger.info(f"  Ensemble accuracy:  {ens_acc:.3f}")
            logger.info(f"  CV accuracy:        {cv_acc:.3f}")
    
    # ── Step 4: Save overall results ──
    overall = {
        "trained_at": datetime.utcnow().isoformat(),
        "min_season": min_season,
        "leagues": results,
    }
    
    with open(RESULTS_FILE, "w") as f:
        json.dump(overall, f, indent=2)
    
    logger.info(f"\nTraining results saved to {RESULTS_FILE}")
    
    # Summary
    logger.info(f"\n{'='*60}")
    logger.info("TRAINING COMPLETE")
    logger.info(f"{'='*60}")
    success = sum(1 for r in results.values() if r.get("status") == "success")
    failed = len(results) - success
    logger.info(f"  Leagues trained: {success}")
    if failed:
        logger.info(f"  Leagues failed:  {failed}")
    
    for lk, r in results.items():
        if r.get("status") == "success":
            m = r.get("metrics", {})
            logger.info(f"  {lk}: ensemble={m.get('ensemble_accuracy', 0):.3f}, "
                        f"nn={m.get('nn_accuracy', 0):.3f}, "
                        f"samples={r.get('samples', 0)}")
    
    return results


async def main():
    parser = argparse.ArgumentParser(description="Train per-league neural network models")
    parser.add_argument(
        "--leagues", nargs="*", default=None,
        help="League keys to train (e.g., eng.1 esp.1). Default: all leagues."
    )
    parser.add_argument(
        "--min-season", type=int, default=2010,
        help="Earliest season to fetch (default: 2010)"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Force re-fetch of historical data"
    )
    args = parser.parse_args()
    
    await train_all_models(
        leagues=args.leagues,
        min_season=args.min_season,
        force_fetch=args.force,
    )


if __name__ == "__main__":
    asyncio.run(main())
