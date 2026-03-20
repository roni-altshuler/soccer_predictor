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
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from pathlib import Path
import logging
import math

logger = logging.getLogger(__name__)

# Storage path for prediction history
DATA_DIR = Path(__file__).parent.parent.parent / "data" / "predictions"


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
    
    # Model factors used
    home_elo: float = 0.0
    away_elo: float = 0.0
    weather_factor: float = 1.0
    referee_factor: float = 1.0
    
    # Post-match actual outcome
    actual_home_goals: Optional[int] = None
    actual_away_goals: Optional[int] = None
    actual_winner: Optional[str] = None  # "home", "draw", "away"
    
    # Accuracy flags (populated after match)
    winner_correct: Optional[bool] = None
    scoreline_correct: Optional[bool] = None
    goals_diff: Optional[int] = None  # Difference from predicted total
    
    # Timestamps
    prediction_timestamp: str = ""
    outcome_timestamp: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PredictionRecord":
        return cls(**data)


@dataclass
class ModelAccuracyMetrics:
    """Accuracy metrics for the prediction model."""
    total_predictions: int = 0
    completed_predictions: int = 0
    pending_predictions: int = 0
    
    # Winner prediction accuracy
    winner_correct_count: int = 0
    winner_accuracy: float = 0.0
    
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
    weighted_accuracy_score: float = 0.0
    
    # Goals accuracy
    avg_goals_difference: float = 0.0
    within_1_goal_rate: float = 0.0
    
    # Probability calibration (Brier score)
    brier_score: float = 0.0
    
    # By confidence level
    high_confidence_accuracy: float = 0.0  # >70% confidence
    medium_confidence_accuracy: float = 0.0  # 40-70% confidence
    low_confidence_accuracy: float = 0.0  # <40% confidence
    
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
        
        try:
            for file_path in self.storage_dir.glob("predictions_*.json"):
                with open(file_path, "r") as f:
                    data = json.load(f)
                    for record in data.get("predictions", []):
                        pred = PredictionRecord.from_dict(record)
                        self._predictions[pred.match_id] = pred
        except Exception as e:
            logger.error(f"Error loading predictions: {e}")
    
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
    ) -> PredictionRecord:
        """
        Store a prediction before a match.
        
        Returns the created PredictionRecord.
        """
        # Most likely scoreline (rounded xG)
        predicted_scoreline = f"{round(home_xG)}-{round(away_xG)}"
        
        # Use the highest outcome probability as the audited match result pick.
        # The scoreline remains a separate, stricter prediction target.
        if home_win_prob >= draw_prob and home_win_prob >= away_win_prob:
            predicted_winner = "home"
        elif away_win_prob >= home_win_prob and away_win_prob >= draw_prob:
            predicted_winner = "away"
        else:
            predicted_winner = "draw"
        
        record = PredictionRecord(
            match_id=match_id,
            home_team=home_team,
            away_team=away_team,
            league=league,
            match_date=match_date,
            predicted_home_win=home_win_prob,
            predicted_draw=draw_prob,
            predicted_away_win=away_win_prob,
            predicted_home_goals=home_xG,
            predicted_away_goals=away_xG,
            predicted_scoreline=predicted_scoreline,
            predicted_winner=predicted_winner,
            confidence=confidence,
            home_elo=home_elo,
            away_elo=away_elo,
            weather_factor=weather_factor,
            referee_factor=referee_factor,
            prediction_timestamp=datetime.utcnow().isoformat(),
        )
        
        self._predictions[match_id] = record
        self._save_predictions()
        
        logger.info(f"Stored prediction for match {match_id}: {home_team} vs {away_team}")
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
        
        # Derive predicted outcome from the predicted scoreline (source of truth)
        score_parts = (record.predicted_scoreline or "0-0").split("-")
        pred_h = int(score_parts[0]) if len(score_parts) >= 1 else 0
        pred_a = int(score_parts[1]) if len(score_parts) >= 2 else 0
        derived_pred_winner = (
            "home" if pred_h > pred_a
            else "away" if pred_a > pred_h
            else "draw"
        )
        # Ensure stored predicted_winner matches the scoreline
        record.predicted_winner = derived_pred_winner
        
        # Calculate accuracy flags
        record.winner_correct = derived_pred_winner == actual_winner
        record.scoreline_correct = record.predicted_scoreline == f"{home_goals}-{away_goals}"
        
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
    ) -> List[PredictionRecord]:
        """Get recent predictions, optionally filtered."""
        predictions = list(self._predictions.values())
        
        # Filter by league
        if league:
            predictions = [p for p in predictions if p.league.lower() == league.lower()]
        
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
    ) -> ModelAccuracyMetrics:
        """
        Calculate comprehensive accuracy metrics.
        
        Args:
            league: Filter to specific league
            days: Only consider predictions from last N days
        """
        metrics = ModelAccuracyMetrics()
        
        predictions = list(self._predictions.values())
        
        # Apply filters
        if league:
            predictions = [p for p in predictions if p.league.lower() == league.lower()]
        
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
        for pred in completed:
            if pred.actual_winner == "home":
                actual = (1, 0, 0)
            elif pred.actual_winner == "draw":
                actual = (0, 1, 0)
            else:
                actual = (0, 0, 1)
            
            predicted = (pred.predicted_home_win, pred.predicted_draw, pred.predicted_away_win)
            brier_sum += sum((p - a) ** 2 for p, a in zip(predicted, actual)) / 3.0
        
        metrics.brier_score = brier_sum / len(completed)
        
        # Accuracy by confidence level
        def normalized_confidence(value: float) -> float:
            return value / 100 if value > 1 else value

        high_conf = [p for p in completed if normalized_confidence(p.confidence) >= 0.55]
        med_conf = [p for p in completed if 0.42 <= normalized_confidence(p.confidence) < 0.55]
        low_conf = [p for p in completed if normalized_confidence(p.confidence) < 0.42]
        
        if high_conf:
            metrics.high_confidence_accuracy = sum(1 for p in high_conf if p.winner_correct) / len(high_conf)
        if med_conf:
            metrics.medium_confidence_accuracy = sum(1 for p in med_conf if p.winner_correct) / len(med_conf)
        if low_conf:
            metrics.low_confidence_accuracy = sum(1 for p in low_conf if p.winner_correct) / len(low_conf)
        
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
            home_precision = metrics.home_win_correct / metrics.home_win_predicted
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
            draw_precision = metrics.draw_correct / metrics.draw_predicted
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
    
    def get_league_performance(self) -> Dict[str, Dict[str, Any]]:
        """Get accuracy metrics broken down by league."""
        leagues = set(p.league for p in self._predictions.values() if p.league)
        
        results = {}
        for league in leagues:
            metrics = self.calculate_accuracy_metrics(league=league)
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
