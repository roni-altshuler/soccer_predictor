"""
Pydantic models for prediction-related data.
"""

from typing import List, Optional, Dict
from datetime import datetime
from pydantic import BaseModel, Field, validator


class OutcomeProbabilities(BaseModel):
    """Match outcome probabilities."""
    home_win: float = Field(..., ge=0, le=1)
    draw: float = Field(..., ge=0, le=1)
    away_win: float = Field(..., ge=0, le=1)
    confidence: float = Field(..., ge=0, le=1)
    
    @validator('home_win', 'draw', 'away_win')
    def probabilities_valid(cls, v):
        if v < 0 or v > 1:
            raise ValueError('Probability must be between 0 and 1')
        return round(v, 4)


class GoalsPrediction(BaseModel):
    """Predicted goals and related markets."""
    home_expected_goals: float = Field(..., ge=0)
    away_expected_goals: float = Field(..., ge=0)
    total_expected_goals: float = Field(..., ge=0)
    
    # Market probabilities
    over_1_5: float = Field(..., ge=0, le=1)
    over_2_5: float = Field(..., ge=0, le=1)
    over_3_5: float = Field(..., ge=0, le=1)
    btts_yes: float = Field(..., ge=0, le=1)  # Both Teams To Score


class ScorelinePrediction(BaseModel):
    """Predicted scoreline."""
    score: str  # e.g., "2-1"
    home_goals: int
    away_goals: int
    probability: float


class PredictionFactors(BaseModel):
    """Factors that influenced the prediction."""
    home_elo: float
    away_elo: float
    elo_difference: float
    home_form_score: float = Field(..., ge=0, le=1)
    away_form_score: float = Field(..., ge=0, le=1)
    home_advantage: float
    h2h_advantage: float  # Positive = home advantage, negative = away
    injury_impact: float  # Negative if key players missing
    rest_days_diff: int
    importance_factor: float = Field(default=1.0)


class ConfidenceBreakdown(BaseModel):
    """Breakdown of prediction confidence."""
    data_quality: float = Field(..., ge=0, le=1)  # How much data we have
    model_certainty: float = Field(..., ge=0, le=1)  # Model's internal confidence
    historical_accuracy: float = Field(..., ge=0, le=1)  # Past accuracy for similar matches
    overall: float = Field(..., ge=0, le=1)


class InjuryInfo(BaseModel):
    """Injury information for a player."""
    player_id: int
    player_name: str
    position: Optional[str] = None
    injury_type: Optional[str] = None
    expected_return: Optional[str] = None
    importance_score: float = Field(default=1.0, ge=0, le=1)  # How important the player is


class TeamPredictionContext(BaseModel):
    """Context about a team for the prediction."""
    team_id: int
    team_name: str
    elo_rating: float
    form: List[str]  # Last 5 results ['W', 'D', 'L', 'W', 'W']
    form_points: int  # Points from last 5 (W=3, D=1, L=0)
    goals_scored_avg: float
    goals_conceded_avg: float
    clean_sheet_rate: float
    injuries: List[InjuryInfo] = []
    days_since_last_match: int


class AttributionItem(BaseModel):
    """One feature's contribution to the served pick, in logit units.

    Positive pushes toward the predicted outcome, negative against it.
    Dense features come from integrated gradients; the grouped
    categorical identities (e.g. `home_team_identity`) from embedding
    occlusion. See `backend/services/prediction/attribution.py`.
    """
    feature: str
    value: float
    contribution: float


class MatchPrediction(BaseModel):
    """Complete match prediction."""
    match_id: int
    home_team: str
    away_team: str
    league: str
    kickoff_time: datetime

    # Core predictions
    outcome: OutcomeProbabilities
    goals: GoalsPrediction
    most_likely_score: ScorelinePrediction
    alternative_scores: List[ScorelinePrediction] = []

    # Context and explanation
    factors: PredictionFactors
    confidence: ConfidenceBreakdown
    home_context: Optional[TeamPredictionContext] = None
    away_context: Optional[TeamPredictionContext] = None

    # Derived betting markets (Over/Under, BTTS, Correct Score top-5).
    # Sourced from the Dixon-Coles corrected joint distribution.
    derived_markets: Optional[Dict] = None

    # "Why this prediction": per-feature contributions to the served pick
    # (top entries by |contribution|). Populated only when the caller asks
    # for an explanation (`?explain=true`) — None otherwise.
    attribution: Optional[List[AttributionItem]] = None

    # Metadata
    model_version: str = "2.0.0"
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    
    def get_prediction_summary(self) -> str:
        """Get a human-readable prediction summary."""
        outcome_probs = {
            'home': self.outcome.home_win,
            'draw': self.outcome.draw,
            'away': self.outcome.away_win
        }
        predicted_outcome = max(outcome_probs, key=outcome_probs.get)
        
        if predicted_outcome == 'home':
            prediction = f"{self.home_team} to win"
        elif predicted_outcome == 'away':
            prediction = f"{self.away_team} to win"
        else:
            prediction = "Draw"
        
        return (
            f"{prediction} ({outcome_probs[predicted_outcome]:.0%} probability). "
            f"Predicted score: {self.most_likely_score.score}"
        )


class PredictionResult(BaseModel):
    """Result of a prediction after the match is played."""
    prediction_id: int
    match_id: int
    
    # What we predicted
    predicted_outcome: str  # 'home', 'draw', 'away'
    predicted_home_goals: float
    predicted_away_goals: float
    predicted_score: str
    confidence: float
    
    # What actually happened
    actual_outcome: str
    actual_home_goals: int
    actual_away_goals: int
    actual_score: str
    
    # Accuracy metrics
    outcome_correct: bool
    score_correct: bool
    goals_error: float  # MAE of goal predictions
    
    evaluated_at: datetime = Field(default_factory=datetime.utcnow)


class AccuracyStats(BaseModel):
    """Prediction accuracy statistics."""
    total_predictions: int
    outcome_accuracy: float
    score_accuracy: float
    home_win_accuracy: float
    draw_accuracy: float
    away_win_accuracy: float
    avg_goals_error: float
    avg_confidence: float
    calibration_error: float  # How well probabilities match actual outcomes
    period: str  # e.g., "last_30_days", "this_season"
