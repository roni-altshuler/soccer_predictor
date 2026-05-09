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
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from sklearn.metrics import accuracy_score, log_loss, precision_recall_fscore_support

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
PREDICTIONS_DIR = DATA_DIR / "predictions"
RESULTS_FILE = DATA_DIR / "training_results.json"
MODEL_SELECTION_FILE = DATA_DIR / "models" / "model_selection.json"
OUTCOME_LABELS = [0, 1, 2]
OUTCOME_NAMES = ["home_win", "draw", "away_win"]


def compute_season_weights(seasons: np.ndarray, current_season: Optional[int] = None) -> np.ndarray:
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
    if current_season is None:
        current_season = datetime.utcnow().year

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
    include_leagues: bool = False,
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
    leagues_list = []
    
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
        leagues_list.append(normalize_league_key(match.get("league", "unknown")))
    
    if not X_list:
        empty = (np.array([]), np.array([]), np.array([]), np.array([]))
        return (*empty, np.array([])) if include_leagues else empty
    
    X = np.array(X_list, dtype=np.float64)
    y_outcome = np.array(y_outcome_list, dtype=np.int32)
    y_goals = np.array(y_goals_list, dtype=np.float64)
    seasons = np.array(seasons_list, dtype=np.int32)
    league_labels = np.array(leagues_list, dtype=object)
    
    # Handle NaN/Inf
    X = np.nan_to_num(X, nan=0.0, posinf=5.0, neginf=-5.0)
    
    if include_leagues:
        return X, y_outcome, y_goals, seasons, league_labels
    return X, y_outcome, y_goals, seasons


def compute_global_sample_weights(seasons: np.ndarray, league_labels: np.ndarray) -> np.ndarray:
    """
    Combine recency weights with league-balancing weights for one global model.

    Without balancing, the biggest domestic leagues dominate the objective and
    tournaments like UCL/UEL/World Cup barely move the loss.
    """
    weights = compute_season_weights(seasons)
    counts = Counter(str(label) for label in league_labels)
    if not counts:
        return weights

    target = len(league_labels) / max(1, len(counts))
    league_weights = np.array(
        [
            max(0.45, min(3.0, target / max(1, counts[str(label)])))
            for label in league_labels
        ],
        dtype=np.float64,
    )
    combined = weights * league_weights
    mean = combined.mean() if len(combined) else 1.0
    return combined / mean if mean > 0 else combined


def _normalize_probabilities(proba: np.ndarray) -> np.ndarray:
    probs = np.asarray(proba, dtype=np.float64)
    probs = np.clip(probs, 1e-12, 1.0)
    row_sums = probs.sum(axis=1, keepdims=True)
    row_sums[row_sums <= 0] = 1.0
    return probs / row_sums


def _multiclass_brier(y_true: np.ndarray, y_proba: np.ndarray) -> float:
    probs = _normalize_probabilities(y_proba)
    one_hot = np.zeros_like(probs)
    one_hot[np.arange(len(y_true)), y_true.astype(int)] = 1.0
    return float(np.mean(np.sum((probs - one_hot) ** 2, axis=1)))


def _model_objective(metric_block: Dict) -> Optional[float]:
    logloss_value = metric_block.get("log_loss")
    brier_value = metric_block.get("brier_score")
    if not isinstance(logloss_value, (int, float)) or not isinstance(brier_value, (int, float)):
        return None
    return float((0.65 * float(logloss_value)) + (0.35 * float(brier_value)))


def _metric_block(y_true: np.ndarray, y_proba: np.ndarray) -> Dict:
    if len(y_true) == 0:
        return {"sample_size": 0}

    probs = _normalize_probabilities(y_proba)
    preds = np.argmax(probs, axis=1)
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

    block = {
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
        "class_distribution": {
            "home_win": int((y_true == 0).sum()),
            "draw": int((y_true == 1).sum()),
            "away_win": int((y_true == 2).sum()),
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
    block["objective"] = _model_objective(block)
    return block


def _mean_brier_from_metrics(metrics: Dict) -> Optional[float]:
    values = [
        metrics.get("brier_home_win"),
        metrics.get("brier_draw"),
        metrics.get("brier_away_win"),
    ]
    numeric = [float(value) for value in values if isinstance(value, (int, float))]
    return float(np.mean(numeric)) if numeric else None


def evaluate_global_holdout_by_league(
    model,
    X: np.ndarray,
    y_outcome: np.ndarray,
    league_labels: np.ndarray,
    holdout_fraction: float = 0.15,
) -> Dict[str, Dict]:
    """
    Evaluate the trained global model on the recent chronological holdout.

    This is the minimum safety layer before allowing a global artifact to
    override a trained league-specific artifact in runtime prediction.
    """
    n = len(X)
    if n < 80:
        return {"overall": {"sample_size": 0}, "by_league": {}}

    split_idx = max(1, min(n - 1, int(n * (1 - holdout_fraction))))
    X_test = X[split_idx:]
    y_test = y_outcome[split_idx:]
    leagues_test = league_labels[split_idx:]

    proba = _normalize_probabilities(model.predict_proba(X_test))

    def metric_block(indices: np.ndarray) -> Dict:
        if len(indices) == 0:
            return {"sample_size": 0}
        return _metric_block(y_test[indices], proba[indices])

    by_league: Dict[str, Dict] = {}
    for league_key in sorted(set(str(label) for label in leagues_test)):
        indices = np.where(leagues_test == league_key)[0]
        by_league[league_key] = metric_block(indices)

    return {
        "overall": metric_block(np.arange(len(y_test))),
        "by_league": by_league,
    }


def evaluate_hybrid_holdout_by_league(
    global_model,
    registry,
    X: np.ndarray,
    y_outcome: np.ndarray,
    league_labels: np.ndarray,
    holdout_fraction: float = 0.15,
) -> Dict[str, Dict]:
    """
    Compare league, global, and blended probabilities on the same holdout rows.

    This creates a league-by-league architecture policy: keep the league model,
    promote the global model, or use a calibrated hybrid blend.
    """
    n = len(X)
    if n < 80:
        return {"overall": {"sample_size": 0}, "by_league": {}}

    split_idx = max(1, min(n - 1, int(n * (1 - holdout_fraction))))
    X_test = X[split_idx:]
    y_test = y_outcome[split_idx:]
    leagues_test = league_labels[split_idx:]
    global_proba_all = _normalize_probabilities(global_model.predict_proba(X_test))

    by_league: Dict[str, Dict] = {}
    for league_key in sorted(set(str(label) for label in leagues_test)):
        indices = np.where(leagues_test == league_key)[0]
        if len(indices) == 0:
            continue

        league_y = y_test[indices]
        league_X = X_test[indices]
        global_proba = global_proba_all[indices]
        global_metrics = _metric_block(league_y, global_proba)

        league_model = registry.get_model(league_key)
        league_proba = None
        league_metrics = {"sample_size": 0, "error": "league_model_unavailable"}
        if league_model.is_fitted:
            try:
                league_proba = _normalize_probabilities(league_model.predict_proba(league_X))
                league_metrics = _metric_block(league_y, league_proba)
            except Exception as exc:
                league_metrics = {"sample_size": int(len(indices)), "error": exc.__class__.__name__}

        candidates = {
            "global": {
                "global_blend_weight": 1.0,
                "metrics": global_metrics,
            }
        }
        if league_proba is not None:
            candidates["league"] = {
                "global_blend_weight": 0.0,
                "metrics": league_metrics,
            }
            for global_weight in np.arange(0.15, 0.90, 0.10):
                blend = (float(global_weight) * global_proba) + ((1.0 - float(global_weight)) * league_proba)
                candidates[f"blend_{global_weight:.2f}"] = {
                    "global_blend_weight": round(float(global_weight), 2),
                    "metrics": _metric_block(league_y, blend),
                }

        best_name = min(
            candidates,
            key=lambda name: (
                candidates[name]["metrics"].get("objective")
                if candidates[name]["metrics"].get("objective") is not None
                else float("inf")
            ),
        )
        best = candidates[best_name]

        by_league[league_key] = {
            "sample_size": int(len(indices)),
            "best_candidate": best_name,
            "best_global_blend_weight": best["global_blend_weight"],
            "best_metrics": best["metrics"],
            "league": league_metrics,
            "global": global_metrics,
            "candidates": candidates,
        }

    return {
        "overall": _metric_block(y_test, global_proba_all),
        "by_league": by_league,
    }


def build_global_promotion_policy(results: Dict[str, dict], challenger_eval: Dict[str, Dict]) -> Dict:
    """
    Build a fail-closed runtime policy for global-vs-league model selection.

    A league is promoted to the global model only when the global model has
    enough recent holdout samples and is not meaningfully worse on accuracy,
    log-loss, or Brier score than the league artifact. This protects against
    global sample-size gains being erased by league-specific calibration loss.
    """
    gates = {
        "min_global_holdout_samples": 25,
        "max_accuracy_drop": 0.015,
        "max_log_loss_increase": 0.025,
        "max_brier_increase": 0.015,
    }
    by_league = challenger_eval.get("by_league", {})
    promoted_leagues: List[str] = []
    league_decisions: Dict[str, Dict] = {}

    for league_key, league_result in sorted(results.items()):
        if league_key == "global":
            continue

        comparison = by_league.get(league_key, {})
        global_metrics = comparison.get("global", {})
        same_fixture_league_metrics = comparison.get("league", {})
        best_candidate = str(comparison.get("best_candidate") or "league")
        best_metrics = comparison.get("best_metrics", {})
        league_metrics = league_result.get("metrics", {}) if isinstance(league_result, dict) else {}
        sample_size = int(comparison.get("sample_size") or global_metrics.get("sample_size") or 0)

        decision = "league"
        reason = "league_model_preferred"
        global_blend_weight = 0.0

        league_status = league_result.get("status") if isinstance(league_result, dict) else None
        if league_status != "success":
            decision = "global_fallback"
            reason = "league_model_not_available"
            global_blend_weight = 1.0
        elif sample_size < gates["min_global_holdout_samples"]:
            reason = "insufficient_global_holdout"
        else:
            league_acc = same_fixture_league_metrics.get("accuracy")
            league_logloss = same_fixture_league_metrics.get("log_loss")
            league_brier = same_fixture_league_metrics.get("brier_score")
            best_acc = best_metrics.get("accuracy")
            best_logloss = best_metrics.get("log_loss")
            best_brier = best_metrics.get("brier_score")
            best_objective = best_metrics.get("objective")
            league_objective = same_fixture_league_metrics.get("objective")

            checks = {
                "accuracy_gate": (
                    isinstance(league_acc, (int, float))
                    and isinstance(best_acc, (int, float))
                    and best_acc >= float(league_acc) - gates["max_accuracy_drop"]
                ),
                "log_loss_gate": (
                    league_logloss is None
                    or best_logloss is None
                    or float(best_logloss) <= float(league_logloss) + gates["max_log_loss_increase"]
                ),
                "brier_gate": (
                    league_brier is None
                    or best_brier is None
                    or float(best_brier) <= float(league_brier) + gates["max_brier_increase"]
                ),
                "objective_gate": (
                    isinstance(best_objective, (int, float))
                    and isinstance(league_objective, (int, float))
                    and float(best_objective) < float(league_objective)
                ),
            }

            if all(checks.values()) and best_candidate == "global":
                decision = "global"
                reason = "benchmark_gates_passed"
                global_blend_weight = 1.0
                promoted_leagues.append(league_key)
            elif all(checks.values()) and best_candidate.startswith("blend_"):
                decision = "blend"
                reason = "hybrid_blend_benchmark_winner"
                global_blend_weight = float(comparison.get("best_global_blend_weight") or 0.5)
            else:
                reason = "benchmark_gates_failed"

        league_decisions[league_key] = {
            "decision": decision,
            "reason": reason,
            "global_blend_weight": round(global_blend_weight, 2),
            "global_holdout": global_metrics,
            "same_fixture_comparison": comparison,
            "league_model": {
                "samples": league_result.get("samples") if isinstance(league_result, dict) else None,
                "ensemble_accuracy": league_metrics.get("ensemble_accuracy"),
                "ensemble_log_loss": league_metrics.get("ensemble_log_loss"),
                "mean_brier_score": _mean_brier_from_metrics(league_metrics),
                "same_fixture": same_fixture_league_metrics,
            },
        }

    return {
        "policy_version": "2026-05-09",
        "generated_at": datetime.utcnow().isoformat(),
        "global_default": False,
        "fallback_to_global_when_league_missing": True,
        "promoted_leagues": promoted_leagues,
        "gates": gates,
        "global_holdout_overall": challenger_eval.get("overall", {}),
        "league_decisions": league_decisions,
        "notes": "Fail-closed: runtime can use league, global, or a calibrated hybrid blend only when same-fixture benchmark gates pass.",
    }


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
    "euro": "uefa.euro",
    "copa_america": "conmebol.america",
}

KEY_TO_ESPN = {v: k for k, v in ESPN_TO_KEY.items()}

LEAGUE_LABEL_TO_KEY = {
    **ESPN_TO_KEY,
    "Premier League": "eng.1",
    "La Liga": "esp.1",
    "Bundesliga": "ger.1",
    "Serie A": "ita.1",
    "Ligue 1": "fra.1",
    "Eredivisie": "ned.1",
    "Primeira Liga": "por.1",
    "MLS": "usa.1",
    "Champions League": "uefa.champions",
    "UEFA Champions League": "uefa.champions",
    "Europa League": "uefa.europa",
    "UEFA Europa League": "uefa.europa",
    "FIFA World Cup": "fifa.world",
    "World Cup": "fifa.world",
    "Euro": "uefa.euro",
    "UEFA Euro": "uefa.euro",
    "Copa America": "conmebol.america",
    "Copa América": "conmebol.america",
}


def normalize_league_key(value: object) -> str:
    """Normalize source/display league labels to canonical runtime keys."""
    raw = str(value or "unknown").strip()
    if raw in LEAGUE_LABEL_TO_KEY:
        return LEAGUE_LABEL_TO_KEY[raw]
    lowered = raw.lower().replace(" ", "_").replace("-", "_")
    return LEAGUE_LABEL_TO_KEY.get(lowered, raw)


def _load_existing_model_result(league_key: str, matches: int = 0) -> Dict:
    """Build a training-result entry from an already saved model artifact."""
    metadata_path = DATA_DIR / "models" / league_key / "metadata.json"
    if not metadata_path.exists():
        return {"error": "model_metadata_missing", "matches": matches}

    try:
        with open(metadata_path) as f:
            metadata = json.load(f)
    except Exception as exc:
        return {"error": exc.__class__.__name__, "matches": matches}

    return {
        "status": "success",
        "matches": matches,
        "features": int(metadata.get("n_features") or 0),
        "samples": int(metadata.get("samples") or 0),
        "metrics": metadata.get("metrics", {}),
        "reused_existing_artifact": True,
    }


async def train_all_models(
    leagues: Optional[List[str]] = None,
    min_season: int = 2010,
    force_fetch: bool = False,
    train_global_model: bool = False,
    train_league_models: bool = True,
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
    global_training_matches: List[dict] = []
    
    for hist_league, matches in historical.items():
        league_key = ESPN_TO_KEY.get(hist_league, hist_league)
        
        if leagues and league_key not in leagues:
            continue
        
        # Add extra matches for this league's display name
        league_display = registry.get_params(league_key).get("display_name", hist_league)
        league_extra = [m for m in extra_matches if m.get("league") == league_display]
        all_matches = matches + league_extra
        global_training_matches.extend(all_matches)

        if not train_league_models:
            results[league_key] = _load_existing_model_result(league_key, len(all_matches))
            continue
        
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

    # ── Optional: train one cross-league global model ──
    if train_global_model:
        logger.info(f"\n{'='*60}")
        logger.info("Training global cross-league model")
        logger.info(f"  Candidate matches: {len(global_training_matches)}")
        logger.info(f"{'='*60}")

        if len(global_training_matches) < 100:
            results["global"] = {
                "error": "insufficient_data",
                "matches": len(global_training_matches),
            }
        else:
            X, y_outcome, y_goals, seasons, league_labels = build_features_and_labels(
                global_training_matches,
                include_leagues=True,
            )

            if len(X) < 80:
                results["global"] = {
                    "error": "insufficient_features",
                    "samples": len(X),
                }
            else:
                weights = compute_global_sample_weights(seasons, league_labels)
                model = PerLeagueNeuralModel("global", registry.params_data.get("default", {}))
                metrics = model.train(X, y_outcome, y_goals, sample_weights=weights)
                global_holdout = evaluate_global_holdout_by_league(model, X, y_outcome, league_labels)
                challenger_eval = evaluate_hybrid_holdout_by_league(
                    model,
                    registry,
                    X,
                    y_outcome,
                    league_labels,
                )
                model.training_metadata["league_scope"] = "cross_league_global"
                model.training_metadata["league_sample_distribution"] = {
                    str(k): int(v) for k, v in Counter(league_labels).items()
                }
                model.training_metadata["recent_holdout_by_league"] = global_holdout
                model.training_metadata["same_fixture_challenger_eval"] = challenger_eval
                model.save()

                promotion_policy = build_global_promotion_policy(
                    {
                        **results,
                        "global": {
                            "status": "success",
                            "metrics": metrics,
                            "samples": len(X),
                        },
                    },
                    challenger_eval,
                )
                MODEL_SELECTION_FILE.parent.mkdir(parents=True, exist_ok=True)
                with open(MODEL_SELECTION_FILE, "w") as f:
                    json.dump(promotion_policy, f, indent=2)

                results["global"] = {
                    "status": "success",
                    "matches": len(global_training_matches),
                    "features": int(X.shape[1]) if X.ndim > 1 else 0,
                    "samples": len(X),
                    "metrics": metrics,
                    "recent_holdout_by_league": global_holdout,
                    "same_fixture_challenger_eval": challenger_eval,
                    "promotion_policy_file": str(MODEL_SELECTION_FILE),
                    "promoted_leagues": promotion_policy.get("promoted_leagues", []),
                    "league_sample_distribution": model.training_metadata["league_sample_distribution"],
                }
    
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
    parser.add_argument(
        "--global-model", action="store_true",
        help="Also train one cross-league global neural ensemble."
    )
    parser.add_argument(
        "--global-only", action="store_true",
        help="Reuse saved league artifacts and retrain only the cross-league global model."
    )
    args = parser.parse_args()
    
    await train_all_models(
        leagues=args.leagues,
        min_season=args.min_season,
        force_fetch=args.force,
        train_global_model=args.global_model or args.global_only,
        train_league_models=not args.global_only,
    )


if __name__ == "__main__":
    asyncio.run(main())
