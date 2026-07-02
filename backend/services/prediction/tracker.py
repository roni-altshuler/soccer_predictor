"""
Prediction Tracking and Model Learning Service.

Tracks prediction outcomes and continuously improves the model:
- Stores predictions before matches
- Records actual outcomes after matches
- Calculates accuracy metrics
- Adjusts model parameters based on performance
"""

import json
import os
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict, field, fields as dataclass_fields
from datetime import datetime, timedelta
from pathlib import Path
import logging
import math

logger = logging.getLogger(__name__)

# Storage path for prediction history
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "predictions"


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


POLICY_MIN_CONFIDENCE = max(0.0, min(1.0, _env_float("PREDICTION_POLICY_MIN_CONFIDENCE", 0.55)))
POLICY_MIN_EDGE = max(0.0, min(1.0, _env_float("PREDICTION_POLICY_MIN_EDGE", 0.12)))


@dataclass
class PredictionRecord:
    """Record of a prediction and its outcome."""
    match_id: str
    home_team: str
    away_team: str
    league: str
    match_date: str
    
    # Pre-match prediction
    predicted_home_win: float
    predicted_draw: float
    predicted_away_win: float
    predicted_home_goals: float
    predicted_away_goals: float
    predicted_scoreline: str  # Most likely scoreline
    predicted_winner: str  # "home", "draw", "away"
    confidence: float
    edge_score: Optional[float] = None
    threshold_qualified: Optional[bool] = None

    # Scoreline product: the model's top-K most likely scorelines, each
    # {"score": "2-1", "probability": 0.09}. Written by the unified model;
    # legacy records leave this None.
    top_scorelines: Optional[List[Dict[str, Any]]] = None

    # "Why this prediction": top per-feature contributions to the served
    # pick, each {"feature", "value", "contribution"} (logit units).
    # Persisted so the explanation panel works on Vercel, where committed
    # JSON is the only transport. None for legacy-model records.
    attribution: Optional[List[Dict[str, Any]]] = None
    
    # Gender universe: 'M' (men's) or 'F' (women's). Records written before
    # the gender field existed default to 'M' on read — see from_dict below.
    gender: str = "M"

    # Model factors used
    home_elo: float = 0.0
    away_elo: float = 0.0
    weather_factor: float = 1.0
    referee_factor: float = 1.0
    model_used: Optional[str] = None
    nn_home_win: Optional[float] = None
    nn_draw: Optional[float] = None
    nn_away_win: Optional[float] = None
    blend_nn_weight: Optional[float] = None
    blend_elo_weight: Optional[float] = None
    blend_entropy: Optional[float] = None
    feature_vector: Optional[List[float]] = None
    venue: Optional[str] = None
    
    # Post-match actual outcome
    actual_home_goals: Optional[int] = None
    actual_away_goals: Optional[int] = None
    actual_winner: Optional[str] = None  # "home", "draw", "away"
    
    # Accuracy flags (populated after match)
    winner_correct: Optional[bool] = None
    scoreline_correct: Optional[bool] = None
    scoreline_in_top5: Optional[bool] = None  # actual score in top_scorelines
    goals_diff: Optional[int] = None  # Difference from predicted total
    
    # Timestamps
    prediction_timestamp: str = ""
    outcome_timestamp: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PredictionRecord":
        # Ignore unknown keys so older/newer prediction schemas still load safely.
        valid_keys = {f.name for f in dataclass_fields(cls)}
        filtered = {k: v for k, v in data.items() if k in valid_keys}

        # Normalize confidence for internal consistency (0..1).
        conf = filtered.get("confidence")
        if isinstance(conf, (int, float)) and conf > 1:
            filtered["confidence"] = conf / 100.0

        # Records written before the gender column existed default to men's.
        raw_gender = str(filtered.get("gender", "M") or "M").upper()
        filtered["gender"] = "F" if raw_gender == "F" else "M"

        # Backfill missing/invalid predicted winner from probabilities.
        if filtered.get("predicted_winner") not in {"home", "draw", "away"}:
            filtered["predicted_winner"] = cls._winner_from_probabilities(
                float(filtered.get("predicted_home_win", 0.0)),
                float(filtered.get("predicted_draw", 0.0)),
                float(filtered.get("predicted_away_win", 0.0)),
            )

        home = float(filtered.get("predicted_home_win", 0.0))
        draw = float(filtered.get("predicted_draw", 0.0))
        away = float(filtered.get("predicted_away_win", 0.0))

        if filtered.get("edge_score") is None:
            filtered["edge_score"] = cls._edge_from_probabilities(home, draw, away)

        if filtered.get("threshold_qualified") is None:
            conf_val = float(filtered.get("confidence", 0.0) or 0.0)
            edge_val = float(filtered.get("edge_score", 0.0) or 0.0)
            filtered["threshold_qualified"] = cls._is_threshold_qualified(conf_val, edge_val)

        return cls(**filtered)

    @staticmethod
    def _normalize_probabilities(home_win: float, draw: float, away_win: float) -> Tuple[float, float, float]:
        home = max(0.0, float(home_win))
        dr = max(0.0, float(draw))
        away = max(0.0, float(away_win))
        total = home + dr + away
        if total <= 0:
            return (1 / 3, 1 / 3, 1 / 3)
        return (home / total, dr / total, away / total)

    @classmethod
    def _edge_from_probabilities(cls, home_win: float, draw: float, away_win: float) -> float:
        normalized = cls._normalize_probabilities(home_win, draw, away_win)
        return float(max(normalized) - (1.0 / 3.0))

    @staticmethod
    def _is_threshold_qualified(confidence: float, edge_score: float) -> bool:
        conf_norm = confidence / 100.0 if confidence > 1 else confidence
        return conf_norm >= POLICY_MIN_CONFIDENCE and edge_score >= POLICY_MIN_EDGE

    @staticmethod
    def _winner_from_probabilities(home_win: float, draw: float, away_win: float) -> str:
        if home_win >= draw and home_win >= away_win:
            return "home"
        if away_win >= home_win and away_win >= draw:
            return "away"
        return "draw"


@dataclass
class ModelAccuracyMetrics:
    """Accuracy metrics for the prediction model."""
    total_predictions: int = 0
    completed_predictions: int = 0
    pending_predictions: int = 0
    
    # Winner prediction accuracy
    winner_correct_count: int = 0
    winner_accuracy: float = 0.0
    avg_confidence: float = 0.0
    
    # Detailed accuracy
    home_win_predicted: int = 0
    home_win_correct: int = 0
    draw_predicted: int = 0
    draw_correct: int = 0
    away_win_predicted: int = 0
    away_win_correct: int = 0
    
    # Scoreline accuracy
    exact_scoreline_count: int = 0
    exact_scoreline_rate: float = 0.0
    # Top-5 scoreline coverage — computed only over records that stored a
    # top_scorelines list, so legacy records don't dilute the rate.
    scoreline_top5_count: int = 0
    scoreline_top5_eligible: int = 0
    scoreline_top5_rate: float = 0.0
    weighted_accuracy_score: float = 0.0
    
    # Goals accuracy
    avg_goals_difference: float = 0.0
    within_1_goal_rate: float = 0.0
    
    # Probability calibration (Brier score)
    brier_score: float = 0.0
    log_loss: float = 0.0
    expected_calibration_error: float = 0.0
    calibration_bins: List[Dict[str, Any]] = field(default_factory=list)
    
    # By confidence level
    high_confidence_accuracy: float = 0.0  # >70% confidence
    medium_confidence_accuracy: float = 0.0  # 40-70% confidence
    low_confidence_accuracy: float = 0.0  # <40% confidence

    # Policy-filtered picks (confidence + edge)
    threshold_qualified_predictions: int = 0
    threshold_qualified_accuracy: float = 0.0
    threshold_qualification_rate: float = 0.0
    threshold_lift: float = 0.0
    
    # Trend
    recent_accuracy: float = 0.0  # Last 50 predictions
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class PredictionTracker:
    """
    Service for tracking predictions and measuring model accuracy.
    
    Implements continuous learning:
    1. Stores predictions before matches
    2. Updates with actual outcomes
    3. Calculates accuracy metrics
    4. Provides feedback for model adjustment
    """
    
    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or DATA_DIR
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._predictions: Dict[str, PredictionRecord] = {}
        self._load_predictions()
    
    def _get_storage_file(self, date: str) -> Path:
        """Get storage file path for a date."""
        return self.storage_dir / f"predictions_{date[:7]}.json"  # Monthly files
    
    def _load_predictions(self):
        """Load existing predictions from storage."""
        self._predictions = {}

        for file_path in self.storage_dir.glob("predictions_*.json"):
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
            except Exception as e:
                logger.error(f"Error reading predictions file {file_path.name}: {e}")
                continue

            for record in data.get("predictions", []):
                try:
                    pred = PredictionRecord.from_dict(record)
                    self._predictions[pred.match_id] = pred
                except Exception as e:
                    logger.debug(f"Skipping malformed prediction record in {file_path.name}: {e}")

    @staticmethod
    def _normalize_confidence(value: float) -> float:
        return value / 100.0 if value > 1 else value

    @staticmethod
    def _winner_from_probabilities(home_win: float, draw: float, away_win: float) -> str:
        if home_win >= draw and home_win >= away_win:
            return "home"
        if away_win >= home_win and away_win >= draw:
            return "away"
        return "draw"

    @staticmethod
    def _normalize_probabilities(home_win: float, draw: float, away_win: float) -> Tuple[float, float, float]:
        return PredictionRecord._normalize_probabilities(home_win, draw, away_win)

    @staticmethod
    def _edge_from_probabilities(home_win: float, draw: float, away_win: float) -> float:
        return PredictionRecord._edge_from_probabilities(home_win, draw, away_win)

    @staticmethod
    def _is_threshold_qualified(confidence: float, edge_score: float) -> bool:
        return PredictionRecord._is_threshold_qualified(confidence, edge_score)
    
    def _save_predictions(self):
        """Save predictions to storage."""
        # Group by month
        by_month: Dict[str, List[PredictionRecord]] = {}
        
        for pred in self._predictions.values():
            month = pred.match_date[:7]
            if month not in by_month:
                by_month[month] = []
            by_month[month].append(pred)
        
        # Save each month's file
        for month, predictions in by_month.items():
            file_path = self.storage_dir / f"predictions_{month}.json"
            try:
                with open(file_path, "w") as f:
                    json.dump({
                        "month": month,
                        "count": len(predictions),
                        "predictions": [p.to_dict() for p in predictions],
                    }, f, indent=2)
            except Exception as e:
                logger.error(f"Error saving predictions: {e}")
    
    def store_prediction(
        self,
        match_id: str,
        home_team: str,
        away_team: str,
        league: str,
        match_date: str,
        home_win_prob: float,
        draw_prob: float,
        away_win_prob: float,
        home_xG: float,
        away_xG: float,
        confidence: float,
        home_elo: float = 0.0,
        away_elo: float = 0.0,
        weather_factor: float = 1.0,
        referee_factor: float = 1.0,
        gender: str = "M",
        predicted_scoreline: Optional[str] = None,
        top_scorelines: Optional[List[Dict[str, Any]]] = None,
        attribution: Optional[List[Dict[str, Any]]] = None,
    ) -> PredictionRecord:
        """
        Store a prediction before a match.

        `predicted_scoreline` / `top_scorelines` come from the model's
        scoreline PMF when available; older callers omit them and get the
        rounded-xG fallback that legacy records always used.

        Returns the created PredictionRecord.
        """
        home_win_prob, draw_prob, away_win_prob = self._normalize_probabilities(
            home_win_prob,
            draw_prob,
            away_win_prob,
        )

        if predicted_scoreline is None:
            # Most likely scoreline (rounded xG) — legacy fallback.
            predicted_scoreline = f"{round(home_xG)}-{round(away_xG)}"
        
        # Use the highest outcome probability as the audited match result pick.
        # The scoreline remains a separate, stricter prediction target.
        predicted_winner = self._winner_from_probabilities(home_win_prob, draw_prob, away_win_prob)
        normalized_confidence = self._normalize_confidence(confidence)
        edge_score = self._edge_from_probabilities(home_win_prob, draw_prob, away_win_prob)
        threshold_qualified = self._is_threshold_qualified(normalized_confidence, edge_score)
        
        normalised_gender = "F" if str(gender or "M").upper() == "F" else "M"
        record = PredictionRecord(
            match_id=match_id,
            home_team=home_team,
            away_team=away_team,
            league=league,
            match_date=match_date,
            gender=normalised_gender,
            predicted_home_win=home_win_prob,
            predicted_draw=draw_prob,
            predicted_away_win=away_win_prob,
            predicted_home_goals=home_xG,
            predicted_away_goals=away_xG,
            predicted_scoreline=predicted_scoreline,
            top_scorelines=top_scorelines,
            attribution=attribution,
            predicted_winner=predicted_winner,
            confidence=normalized_confidence,
            edge_score=edge_score,
            threshold_qualified=threshold_qualified,
            home_elo=home_elo,
            away_elo=away_elo,
            weather_factor=weather_factor,
            referee_factor=referee_factor,
            prediction_timestamp=datetime.utcnow().isoformat(),
        )
        
        self._predictions[match_id] = record
        self._save_predictions()
        
        logger.info(
            "Stored prediction for match %s: %s vs %s (edge=%.3f, qualified=%s)",
            match_id,
            home_team,
            away_team,
            edge_score,
            threshold_qualified,
        )
        return record
    
    def update_outcome(
        self,
        match_id: str,
        home_goals: int,
        away_goals: int,
    ) -> Optional[PredictionRecord]:
        """
        Update a prediction with the actual match outcome.
        
        Returns updated PredictionRecord or None if not found.
        """
        if match_id not in self._predictions:
            logger.warning(f"No prediction found for match {match_id}")
            return None
        
        record = self._predictions[match_id]
        
        # Determine actual winner
        if home_goals > away_goals:
            actual_winner = "home"
        elif away_goals > home_goals:
            actual_winner = "away"
        else:
            actual_winner = "draw"
        
        # Update record
        record.actual_home_goals = home_goals
        record.actual_away_goals = away_goals
        record.actual_winner = actual_winner
        record.outcome_timestamp = datetime.utcnow().isoformat()

        # Keep predicted_winner tied to pre-match outcome probabilities.
        # For legacy records with missing/invalid values, backfill from probs.
        if record.predicted_winner not in {"home", "draw", "away"}:
            record.predicted_winner = self._winner_from_probabilities(
                record.predicted_home_win,
                record.predicted_draw,
                record.predicted_away_win,
            )
        
        # Calculate accuracy flags
        actual_scoreline = f"{home_goals}-{away_goals}"
        record.winner_correct = record.predicted_winner == actual_winner
        record.scoreline_correct = record.predicted_scoreline == actual_scoreline
        if record.top_scorelines:
            record.scoreline_in_top5 = any(
                s.get("score") == actual_scoreline for s in record.top_scorelines
            )
        
        predicted_total = record.predicted_home_goals + record.predicted_away_goals
        actual_total = home_goals + away_goals
        record.goals_diff = abs(round(predicted_total) - actual_total)
        
        self._save_predictions()
        
        logger.info(
            f"Updated outcome for match {match_id}: {home_goals}-{away_goals}, "
            f"prediction {'correct' if record.winner_correct else 'incorrect'}"
        )
        return record
    
    def get_prediction(self, match_id: str) -> Optional[PredictionRecord]:
        """Get a prediction record by match ID."""
        return self._predictions.get(match_id)
    
    def get_recent_predictions(
        self,
        limit: int = 50,
        league: Optional[str] = None,
        completed_only: bool = False,
        gender: Optional[str] = None,
    ) -> List[PredictionRecord]:
        """Get recent predictions, optionally filtered."""
        predictions = list(self._predictions.values())

        # Filter by league
        if league:
            predictions = [p for p in predictions if p.league.lower() == league.lower()]

        # Filter by gender
        if gender:
            wanted = "F" if str(gender).upper() == "F" else "M"
            predictions = [p for p in predictions if (p.gender or "M").upper() == wanted]
        
        # Filter to completed only
        if completed_only:
            predictions = [p for p in predictions if p.actual_winner is not None]
        
        # Sort by date descending
        predictions.sort(key=lambda p: p.match_date, reverse=True)
        
        return predictions[:limit]
    
    def calculate_accuracy_metrics(
        self,
        league: Optional[str] = None,
        days: Optional[int] = None,
        gender: Optional[str] = None,
    ) -> ModelAccuracyMetrics:
        """
        Calculate comprehensive accuracy metrics.

        Args:
            league: Filter to specific league
            days: Only consider predictions from last N days
            gender: 'M' or 'F' to scope to one universe; None returns combined.
        """
        metrics = ModelAccuracyMetrics()

        predictions = list(self._predictions.values())

        # Apply filters
        if league:
            predictions = [p for p in predictions if p.league.lower() == league.lower()]

        if gender:
            wanted = "F" if str(gender).upper() == "F" else "M"
            predictions = [p for p in predictions if (p.gender or "M").upper() == wanted]

        if days:
            cutoff = (datetime.utcnow() - timedelta(days=days)).date().isoformat()
            predictions = [p for p in predictions if p.match_date >= cutoff]
        
        metrics.total_predictions = len(predictions)
        
        # Filter to completed predictions
        completed = [p for p in predictions if p.actual_winner is not None]
        metrics.completed_predictions = len(completed)
        metrics.pending_predictions = metrics.total_predictions - metrics.completed_predictions
        
        if not completed:
            return metrics
        
        # Winner accuracy
        correct_count = sum(1 for p in completed if p.winner_correct)
        metrics.winner_correct_count = correct_count
        metrics.winner_accuracy = correct_count / len(completed)
        metrics.avg_confidence = sum(self._normalize_confidence(p.confidence) for p in completed) / len(completed)
        
        # Detailed accuracy by outcome type
        for pred in completed:
            if pred.predicted_winner == "home":
                metrics.home_win_predicted += 1
                if pred.winner_correct:
                    metrics.home_win_correct += 1
            elif pred.predicted_winner == "draw":
                metrics.draw_predicted += 1
                if pred.winner_correct:
                    metrics.draw_correct += 1
            else:
                metrics.away_win_predicted += 1
                if pred.winner_correct:
                    metrics.away_win_correct += 1
        
        # Scoreline accuracy
        exact_count = sum(1 for p in completed if p.scoreline_correct)
        metrics.exact_scoreline_count = exact_count
        metrics.exact_scoreline_rate = exact_count / len(completed)

        # Top-5 scoreline coverage over records that carry the PMF list.
        top5_eligible = [p for p in completed if p.scoreline_in_top5 is not None]
        metrics.scoreline_top5_eligible = len(top5_eligible)
        metrics.scoreline_top5_count = sum(1 for p in top5_eligible if p.scoreline_in_top5)
        if top5_eligible:
            metrics.scoreline_top5_rate = metrics.scoreline_top5_count / len(top5_eligible)
        metrics.weighted_accuracy_score = (
            (0.65 * correct_count) + (0.35 * exact_count)
        ) / len(completed)
        
        # Goals accuracy
        goals_diffs = [p.goals_diff for p in completed if p.goals_diff is not None]
        if goals_diffs:
            metrics.avg_goals_difference = sum(goals_diffs) / len(goals_diffs)
            within_1 = sum(1 for d in goals_diffs if d <= 1)
            metrics.within_1_goal_rate = within_1 / len(goals_diffs)
        
        # Brier score (probability calibration) — standard 3-class Brier score
        brier_sum = 0.0
        log_loss_sum = 0.0
        n_bins = 10
        bin_counts = [0] * n_bins
        bin_conf = [0.0] * n_bins
        bin_acc = [0.0] * n_bins
        for pred in completed:
            if pred.actual_winner == "home":
                actual = (1, 0, 0)
                actual_idx = 0
            elif pred.actual_winner == "draw":
                actual = (0, 1, 0)
                actual_idx = 1
            else:
                actual = (0, 0, 1)
                actual_idx = 2
            
            probs = [
                max(0.0, float(pred.predicted_home_win)),
                max(0.0, float(pred.predicted_draw)),
                max(0.0, float(pred.predicted_away_win)),
            ]
            p_sum = sum(probs)
            if p_sum <= 0:
                probs = [1 / 3, 1 / 3, 1 / 3]
            else:
                probs = [p / p_sum for p in probs]

            predicted = (probs[0], probs[1], probs[2])
            brier_sum += sum((p - a) ** 2 for p, a in zip(predicted, actual)) / 3.0

            p_true = max(1e-12, probs[actual_idx])
            log_loss_sum += -math.log(p_true)

            conf = max(probs)
            pred_idx = probs.index(conf)
            correct = 1.0 if pred_idx == actual_idx else 0.0
            bin_idx = min(n_bins - 1, int(conf * n_bins))
            bin_counts[bin_idx] += 1
            bin_conf[bin_idx] += conf
            bin_acc[bin_idx] += correct
        
        metrics.brier_score = brier_sum / len(completed)
        metrics.log_loss = log_loss_sum / len(completed)

        ece = 0.0
        total_completed = float(len(completed))
        for i in range(n_bins):
            if bin_counts[i] == 0:
                continue
            avg_conf = bin_conf[i] / bin_counts[i]
            avg_acc = bin_acc[i] / bin_counts[i]
            ece += abs(avg_acc - avg_conf) * (bin_counts[i] / total_completed)
            metrics.calibration_bins.append({
                "bucket": f"{i * 10}-{(i + 1) * 10}%",
                "count": bin_counts[i],
                "avg_confidence": round(avg_conf, 4),
                "accuracy": round(avg_acc, 4),
            })
        metrics.expected_calibration_error = ece
        
        # Accuracy by confidence level
        high_conf = [p for p in completed if self._normalize_confidence(p.confidence) >= 0.55]
        med_conf = [p for p in completed if 0.42 <= self._normalize_confidence(p.confidence) < 0.55]
        low_conf = [p for p in completed if self._normalize_confidence(p.confidence) < 0.42]
        
        if high_conf:
            metrics.high_confidence_accuracy = sum(1 for p in high_conf if p.winner_correct) / len(high_conf)
        if med_conf:
            metrics.medium_confidence_accuracy = sum(1 for p in med_conf if p.winner_correct) / len(med_conf)
        if low_conf:
            metrics.low_confidence_accuracy = sum(1 for p in low_conf if p.winner_correct) / len(low_conf)

        qualified = []
        for pred in completed:
            edge = pred.edge_score
            if edge is None:
                edge = self._edge_from_probabilities(
                    pred.predicted_home_win,
                    pred.predicted_draw,
                    pred.predicted_away_win,
                )
            is_qualified = pred.threshold_qualified
            if is_qualified is None:
                is_qualified = self._is_threshold_qualified(
                    self._normalize_confidence(pred.confidence),
                    edge,
                )
            if is_qualified:
                qualified.append(pred)

        metrics.threshold_qualified_predictions = len(qualified)
        metrics.threshold_qualification_rate = len(qualified) / len(completed)
        if qualified:
            metrics.threshold_qualified_accuracy = (
                sum(1 for p in qualified if p.winner_correct) / len(qualified)
            )
            metrics.threshold_lift = metrics.threshold_qualified_accuracy - metrics.winner_accuracy
        
        # Recent accuracy (last 50 completed)
        recent = sorted(completed, key=lambda p: p.match_date, reverse=True)[:50]
        if recent:
            metrics.recent_accuracy = sum(1 for p in recent if p.winner_correct) / len(recent)
        
        return metrics
    
    def get_model_adjustments(self) -> Dict[str, float]:
        """
        Calculate model adjustments based on prediction performance.
        
        Uses gradient-inspired adjustments proportional to the error magnitude,
        not just threshold-based rules.
        """
        metrics = self.calculate_accuracy_metrics(days=90)
        
        adjustments = {
            "home_advantage_factor": 1.0,
            "elo_weight": 1.0,
            "draw_bias": 0.0,
            "goals_scale": 1.0,
            "dixon_coles_rho": -0.13,
        }
        
        if metrics.completed_predictions < 20:
            return adjustments  # Not enough data
        
        # ── Home advantage calibration ──
        # Proportional adjustment based on how far home precision is from true rate
        if metrics.home_win_predicted > 0:
            # Actual home win rate in the dataset
            completed = [p for p in self._predictions.values() if p.actual_winner is not None]
            actual_home_rate = sum(1 for p in completed if p.actual_winner == "home") / max(1, len(completed))
            predicted_home_rate = metrics.home_win_predicted / max(1, metrics.completed_predictions)
            
            # Adjust proportionally: if we predict 55% home but actual is 45%, reduce by ratio
            if predicted_home_rate > 0:
                ratio = actual_home_rate / predicted_home_rate
                adjustments["home_advantage_factor"] = max(0.7, min(1.3, ratio))
        
        # ── Draw calibration ──
        # If we're under-predicting draws, increase draw bias; if over-predicting, decrease
        if metrics.draw_predicted > 0:
            completed = [p for p in self._predictions.values() if p.actual_winner is not None]
            actual_draw_rate = sum(1 for p in completed if p.actual_winner == "draw") / max(1, len(completed))
            predicted_draw_rate = metrics.draw_predicted / max(1, metrics.completed_predictions)
            
            # Continuous adjustment: difference between actual and predicted draw rates
            draw_gap = actual_draw_rate - predicted_draw_rate
            adjustments["draw_bias"] = max(-0.08, min(0.08, draw_gap * 0.5))
        
        # ── Goal calibration ──
        if metrics.avg_goals_difference > 2.0:
            adjustments["goals_scale"] = 0.88
        elif metrics.avg_goals_difference > 1.5:
            adjustments["goals_scale"] = 0.93
        elif metrics.avg_goals_difference > 1.0:
            adjustments["goals_scale"] = 0.97

        if metrics.weighted_accuracy_score < 0.45:
            adjustments["goals_scale"] *= 0.96
        elif metrics.weighted_accuracy_score > 0.62:
            adjustments["goals_scale"] *= 1.01
        
        # ── Dixon-Coles rho tuning based on scoreline accuracy ──
        # If we're getting draw scorelines wrong, adjust correlation
        if metrics.exact_scoreline_rate < 0.05:
            adjustments["dixon_coles_rho"] = -0.16  # Stronger correction
        elif metrics.exact_scoreline_rate > 0.12:
            adjustments["dixon_coles_rho"] = -0.08  # Lighter correction
        
        return adjustments
    
    def get_league_performance(self, gender: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
        """Get accuracy metrics broken down by league.

        Args:
            gender: 'M' or 'F' to scope to one universe; None aggregates both.
        """
        gender_filter = None
        if gender:
            gender_filter = "F" if str(gender).upper() == "F" else "M"

        leagues = set(
            p.league
            for p in self._predictions.values()
            if p.league and (gender_filter is None or (p.gender or "M").upper() == gender_filter)
        )

        results = {}
        for league in leagues:
            metrics = self.calculate_accuracy_metrics(league=league, gender=gender_filter)
            results[league] = {
                "total": metrics.total_predictions,
                "completed": metrics.completed_predictions,
                "pending": metrics.pending_predictions,
                "accuracy": round(metrics.winner_accuracy, 3),
                "weightedAccuracy": round(metrics.weighted_accuracy_score, 3),
                "exactScoreline": round(metrics.exact_scoreline_rate, 3),
                "brierScore": round(metrics.brier_score, 4),
            }

        return results


# Singleton instance
_prediction_tracker: Optional[PredictionTracker] = None


def get_prediction_tracker() -> PredictionTracker:
    """Get or create prediction tracker singleton."""
    global _prediction_tracker
    if _prediction_tracker is None:
        _prediction_tracker = PredictionTracker()
    return _prediction_tracker
