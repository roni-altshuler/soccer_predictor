"""Prediction service module."""

from backend.services.prediction.model import (
    PredictionService,
    get_prediction_service,
)
from backend.services.prediction.features import (
    MatchFeatures,
    build_features,
    calculate_form_points,
    calculate_injury_impact,
    is_derby_match,
)
from backend.services.prediction.probabilistic import (
    PoissonModel,
    HybridPredictionModel,
    monte_carlo_simulation,
    GoalDistribution,
    ScoreMatrix,
)
from backend.services.prediction.training import (
    ModelTrainer,
    FeatureBuilder,
    get_model_trainer,
    train_model_pipeline,
)
from backend.services.prediction.historical_data import (
    HistoricalDataCollector,
    get_historical_collector,
)

__all__ = [
    "PredictionService",
    "get_prediction_service",
    "MatchFeatures",
    "build_features",
    "calculate_form_points",
    "calculate_injury_impact",
    "is_derby_match",
    "PoissonModel",
    "HybridPredictionModel",
    "monte_carlo_simulation",
    "GoalDistribution",
    "ScoreMatrix",
    "ModelTrainer",
    "FeatureBuilder",
    "get_model_trainer",
    "train_model_pipeline",
    "HistoricalDataCollector",
    "get_historical_collector",
]
