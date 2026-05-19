"""
Main prediction service combining all components.

Integrates:
- Trained ML ensemble model (XGBoost + LightGBM + GradientBoosting)
- Poisson-based probabilistic goal model
- ELO rating system
- Weather impact adjustments
- Referee tendency adjustments
- News sentiment analysis
- Team form and momentum tracking
"""

from typing import Dict, List, Optional
from datetime import datetime
import numpy as np
import logging

from backend.models.prediction import (
    MatchPrediction,
    OutcomeProbabilities,
    GoalsPrediction,
    ScorelinePrediction,
    PredictionFactors,
    ConfidenceBreakdown,
    TeamPredictionContext,
    InjuryInfo,
)
from backend.services.prediction.features import (
    MatchFeatures,
    build_features,
    calculate_form_points,
    calculate_injury_impact,
    calculate_weighted_form_points,
)
from backend.services.prediction.probabilistic import (
    PoissonModel,
    HybridPredictionModel,
    monte_carlo_simulation,
)

logger = logging.getLogger(__name__)


def _safe_import_weather():
    """Lazy import weather service to avoid circular imports."""
    try:
        from backend.services.weather.client import get_weather_service
        return get_weather_service()
    except Exception:
        return None


def _safe_import_referee():
    """Lazy import referee service to avoid circular imports."""
    try:
        from backend.services.referee.client import get_referee_service
        return get_referee_service()
    except Exception:
        return None


def _safe_import_tracker():
    """Lazy import prediction tracker to avoid circular imports."""
    try:
        from backend.services.prediction.tracker import get_prediction_tracker
        return get_prediction_tracker()
    except Exception:
        return None


class PredictionService:
    """
    Main service for generating match predictions.
    
    Combines:
    - Trained ML ensemble (XGBoost + LightGBM + GradientBoosting) on historical data
    - ELO-based team ratings with league-adjusted coefficients
    - Probabilistic Poisson model for goal predictions
    - Weather impact adjustments (temperature, wind, precipitation)
    - Referee tendency adjustments (cards, penalties, home bias)
    - News sentiment analysis from ESPN
    - Team form and momentum tracking with recency weighting
    - Head-to-head historical patterns
    - Injury and squad availability analysis
    """
    
    def __init__(
        self,
        ml_model=None,
        league_avg_goals: float = 1.35,
        home_advantage: float = 0.25,
        model_version: str = "3.1.0"
    ):
        self.league_avg_goals = league_avg_goals
        self.home_advantage = home_advantage
        self.model_version = model_version
        
        # Try to load trained ensemble model
        self.ml_model = ml_model
        self._trained_model = None
        self._load_trained_model()
        
        effective_model = self._trained_model or ml_model
        
        self.poisson = PoissonModel()
        self.hybrid = HybridPredictionModel(
            outcome_model=effective_model,
            poisson_model=self.poisson,
            league_avg_goals=league_avg_goals,
            home_advantage=home_advantage
        )
        
        # Lazy-loaded services
        self._weather_service = None
        self._referee_service = None
        self._tracker = None
    
    def _load_trained_model(self):
        """Attempt to load the pre-trained ML ensemble model."""
        try:
            from backend.services.prediction.training import get_model_trainer
            trainer = get_model_trainer()
            if trainer.model is not None:
                # Use the trainer wrapper so serving calls include feature scaling
                # and optional probability calibration.
                self._trained_model = trainer
                if getattr(trainer, "calibrator", None) is not None:
                    self.model_version = "3.2.0-ensemble-calibrated"
                else:
                    self.model_version = "3.2.0-ensemble"
                logger.info("Loaded pre-trained ensemble model for predictions")
        except Exception as e:
            logger.debug(f"No pre-trained model available: {e}")
    
    async def _get_weather_adjustment(
        self, home_team: str, kickoff_time: Optional[datetime] = None
    ) -> Dict[str, float]:
        """Fetch weather data and calculate prediction adjustments."""
        try:
            if self._weather_service is None:
                self._weather_service = _safe_import_weather()
            if self._weather_service is None:
                return {"goal_factor": 1.0, "home_advantage_boost": 0.0}
            
            weather = await self._weather_service.get_weather_for_venue(
                home_team, kickoff_time
            )
            return self._weather_service.calculate_weather_adjustment(weather)
        except Exception as e:
            logger.debug(f"Weather data unavailable: {e}")
            return {"goal_factor": 1.0, "home_advantage_boost": 0.0}
    
    def _get_referee_adjustment(
        self, referee_name: Optional[str], home_team: str, away_team: str
    ) -> Dict[str, float]:
        """Get referee-based prediction adjustments."""
        try:
            if not referee_name:
                return {"card_factor": 1.0, "penalty_factor": 1.0, "home_advantage": 0.0}
            
            if self._referee_service is None:
                self._referee_service = _safe_import_referee()
            if self._referee_service is None:
                return {"card_factor": 1.0, "penalty_factor": 1.0, "home_advantage": 0.0}
            
            return self._referee_service.calculate_referee_adjustment(
                referee_name, home_team, away_team
            )
        except Exception as e:
            logger.debug(f"Referee data unavailable: {e}")
            return {"card_factor": 1.0, "penalty_factor": 1.0, "home_advantage": 0.0}
    
    def _get_tracker_adjustments(self) -> Dict[str, float]:
        """Get model adjustments from prediction tracking feedback loop."""
        try:
            if self._tracker is None:
                self._tracker = _safe_import_tracker()
            if self._tracker is None:
                return {}
            return self._tracker.get_model_adjustments()
        except Exception:
            return {}

    def _get_historical_accuracy(self) -> float:
        """Use live tracked outcome accuracy instead of a hardcoded placeholder."""
        try:
            if self._tracker is None:
                self._tracker = _safe_import_tracker()
            if self._tracker is None:
                return 0.65

            metrics = self._tracker.calculate_accuracy_metrics(days=180)
            if metrics.completed_predictions >= 20:
                weighted = getattr(metrics, "weighted_accuracy_score", 0.0) or 0.0
                return max(0.45, min(0.85, (metrics.winner_accuracy * 0.7) + (weighted * 0.3)))
        except Exception:
            pass
        return 0.65
    
    async def predict_match(
        self,
        match_id: int,
        home_team_data: Dict,
        away_team_data: Dict,
        h2h_data: Optional[Dict] = None,
        match_context: Optional[Dict] = None,
        kickoff_time: Optional[datetime] = None,
        news_factors: Optional[Dict] = None,
        referee_name: Optional[str] = None,
    ) -> MatchPrediction:
        """
        Generate a complete prediction for a match.
        
        Integrates weather, referee, sentiment, form, and ML model predictions.
        
        Args:
            match_id: Unique match identifier
            home_team_data: Home team stats, form, injuries, etc.
            away_team_data: Away team stats, form, injuries, etc.
            h2h_data: Head-to-head history
            match_context: Additional context (league positions, importance, etc.)
            kickoff_time: Match kickoff time
            news_factors: News sentiment analysis from ESPN
            referee_name: Name of assigned referee
        
        Returns:
            Complete MatchPrediction
        """
        home_name = home_team_data.get('name', 'Home')
        away_name = away_team_data.get('name', 'Away')
        
        # Fetch weather and referee adjustments in parallel
        weather_adj = await self._get_weather_adjustment(home_name, kickoff_time)
        referee_adj = self._get_referee_adjustment(referee_name, home_name, away_name)
        tracker_adj = self._get_tracker_adjustments()
        
        # Apply tracker feedback to model parameters
        effective_home_adv = self.home_advantage * tracker_adj.get("home_advantage_factor", 1.0)
        effective_home_adv += weather_adj.get("home_advantage_boost", 0.0)
        effective_home_adv += referee_adj.get("home_advantage", 0.0)
        
        goal_scale = tracker_adj.get("goals_scale", 1.0) * weather_adj.get("goal_factor", 1.0)
        
        # Apply referee goal factor (e.g. strict refs → fewer goals)
        referee_goal_factor = referee_adj.get("goal_factor", 1.0)
        goal_scale *= referee_goal_factor
        
        # Build features with news factors
        features = build_features(
            home_team_data,
            away_team_data,
            h2h_data,
            match_context,
            news_factors,
        )
        
        # Get core prediction from hybrid model with adjusted parameters
        effective_model = self._trained_model or self.ml_model
        prediction = self.hybrid.predict(
            home_elo=features.home_elo,
            away_elo=features.away_elo,
            home_goals_pg=features.home_goals_per_game * goal_scale,
            home_conceded_pg=features.home_conceded_per_game,
            away_goals_pg=features.away_goals_per_game * goal_scale,
            away_conceded_pg=features.away_conceded_per_game,
            features=features.to_array() if effective_model else None,
            referee_factor=referee_goal_factor if referee_goal_factor != 1.0 else None,
        )
        
        # Per-league bucketed calibration (optional, gated by buckets file).
        league_name = (match_context or {}).get("league") if match_context else None
        if league_name and self._trained_model is not None:
            try:
                buckets = getattr(self._trained_model, "calibration_buckets", None)
                if buckets is None and hasattr(self._trained_model, "_load_calibration_buckets"):
                    self._trained_model._load_calibration_buckets()
                    buckets = getattr(self._trained_model, "calibration_buckets", None)
                if buckets:
                    raw = np.array([[
                        prediction["outcome"]["home_win"],
                        prediction["outcome"]["draw"],
                        prediction["outcome"]["away_win"],
                    ]], dtype=np.float64)
                    adj = self._trained_model.apply_bucket_calibration(raw, league_name)[0]
                    prediction["outcome"]["home_win"] = round(float(adj[0]), 4)
                    prediction["outcome"]["draw"] = round(float(adj[1]), 4)
                    prediction["outcome"]["away_win"] = round(float(adj[2]), 4)
            except Exception as cal_err:
                logger.debug(f"Bucket calibration skipped: {cal_err}")

        # Apply draw bias from tracker
        draw_bias = tracker_adj.get("draw_bias", 0.0)
        if abs(draw_bias) > 0.001:
            hw = prediction["outcome"]["home_win"]
            dr = prediction["outcome"]["draw"] + draw_bias
            aw = prediction["outcome"]["away_win"]
            total = hw + dr + aw
            prediction["outcome"]["home_win"] = round(hw / total, 4)
            prediction["outcome"]["draw"] = round(dr / total, 4)
            prediction["outcome"]["away_win"] = round(aw / total, 4)
        
        # Build outcome probabilities
        outcome = OutcomeProbabilities(
            home_win=prediction["outcome"]["home_win"],
            draw=prediction["outcome"]["draw"],
            away_win=prediction["outcome"]["away_win"],
            confidence=prediction["outcome"]["confidence"]
        )

        # ── Derived markets (Over/Under, BTTS, Correct Score top-5) ──
        # Source from the same xG estimates the unified prediction already produced.
        # All three helpers reuse the Dixon-Coles corrected joint distribution.
        derived_markets = None
        try:
            home_xg_for_markets = float(prediction["goals"]["home_xG"])
            away_xg_for_markets = float(prediction["goals"]["away_xG"])
            rho_for_markets = float(getattr(self.hybrid, "rho", -0.13))
            derived_markets = {
                "over_under": self.poisson.over_under_probabilities(
                    home_xg_for_markets, away_xg_for_markets, rho=rho_for_markets,
                ),
                "btts": self.poisson.btts_probability(
                    home_xg_for_markets, away_xg_for_markets, rho=rho_for_markets,
                ),
                "correct_score_top5": self.poisson.top_n_scorelines(
                    home_xg_for_markets, away_xg_for_markets, n=5, rho=rho_for_markets,
                ),
            }
        except Exception as derived_err:
            logger.debug(f"Derived markets computation skipped: {derived_err}")
            derived_markets = None
        
        # Build goals prediction
        goals = GoalsPrediction(
            home_expected_goals=prediction["goals"]["home_xG"],
            away_expected_goals=prediction["goals"]["away_xG"],
            total_expected_goals=prediction["goals"]["total_xG"],
            over_1_5=prediction["goals"]["over_1_5"],
            over_2_5=prediction["goals"]["over_2_5"],
            over_3_5=prediction["goals"]["over_3_5"],
            btts_yes=prediction["goals"]["btts"]
        )
        
        # Build scoreline predictions
        scorelines = prediction["scorelines"]
        most_likely = ScorelinePrediction(
            score=scorelines[0]["score"],
            home_goals=int(scorelines[0]["score"].split("-")[0]),
            away_goals=int(scorelines[0]["score"].split("-")[1]),
            probability=scorelines[0]["probability"]
        )
        
        alternatives = [
            ScorelinePrediction(
                score=s["score"],
                home_goals=int(s["score"].split("-")[0]),
                away_goals=int(s["score"].split("-")[1]),
                probability=s["probability"]
            )
            for s in scorelines[1:5]
        ]
        
        # Build factors
        h2h = h2h_data or {}
        h2h_home_wins = h2h.get('home_wins', 0)
        h2h_away_wins = h2h.get('away_wins', 0)
        h2h_total = h2h_home_wins + h2h.get('draws', 0) + h2h_away_wins
        h2h_advantage = 0.0
        if h2h_total > 0:
            h2h_advantage = (h2h_home_wins - h2h_away_wins) / h2h_total
        
        factors = PredictionFactors(
            home_elo=features.home_elo,
            away_elo=features.away_elo,
            elo_difference=features.elo_diff,
            home_form_score=min(1.0, features.home_form_points / 15.0),
            away_form_score=min(1.0, features.away_form_points / 15.0),
            home_advantage=self.home_advantage,
            h2h_advantage=h2h_advantage,
            injury_impact=-(features.home_injuries_impact - features.away_injuries_impact),
            rest_days_diff=features.home_rest_days - features.away_rest_days,
            importance_factor=features.match_importance
        )
        
        # Build confidence breakdown
        data_quality = self._calculate_data_quality(home_team_data, away_team_data, h2h_data)
        historical_accuracy = self._get_historical_accuracy()
        overall_confidence = (
            prediction["outcome"]["confidence"] * 0.5
            + data_quality * 0.25
            + historical_accuracy * 0.25
        )
        confidence = ConfidenceBreakdown(
            data_quality=data_quality,
            model_certainty=prediction["outcome"]["confidence"],
            historical_accuracy=historical_accuracy,
            overall=min(0.95, max(0.1, overall_confidence))
        )
        
        # Build team contexts
        home_context = self._build_team_context(home_team_data, features, is_home=True)
        away_context = self._build_team_context(away_team_data, features, is_home=False)
        
        return MatchPrediction(
            match_id=match_id,
            home_team=home_team_data.get('name', 'Home'),
            away_team=away_team_data.get('name', 'Away'),
            league=match_context.get('league', 'Unknown') if match_context else 'Unknown',
            kickoff_time=kickoff_time or datetime.utcnow(),
            outcome=outcome,
            goals=goals,
            most_likely_score=most_likely,
            alternative_scores=alternatives,
            factors=factors,
            confidence=confidence,
            home_context=home_context,
            away_context=away_context,
            derived_markets=derived_markets,
            model_version=self.model_version
        )
    
    def _calculate_data_quality(
        self,
        home_data: Dict,
        away_data: Dict,
        h2h_data: Optional[Dict]
    ) -> float:
        """Calculate data quality score based on available information."""
        score = 0.3  # Base score
        
        # Check home team data
        if home_data.get('form'):
            score += 0.1
        if home_data.get('season_stats'):
            score += 0.1
        if home_data.get('elo_rating'):
            score += 0.05
        
        # Check away team data
        if away_data.get('form'):
            score += 0.1
        if away_data.get('season_stats'):
            score += 0.1
        if away_data.get('elo_rating'):
            score += 0.05
        
        # Check H2H
        if h2h_data and h2h_data.get('total_matches', 0) > 0:
            score += 0.1
            if h2h_data.get('total_matches', 0) >= 5:
                score += 0.1
        
        return min(1.0, score)
    
    def _build_team_context(
        self,
        team_data: Dict,
        features: MatchFeatures,
        is_home: bool
    ) -> TeamPredictionContext:
        """Build team prediction context."""
        form = team_data.get('form', [])
        injuries = [
            InjuryInfo(
                player_id=inj.get('player_id', 0),
                player_name=inj.get('player_name', 'Unknown'),
                position=inj.get('position'),
                injury_type=inj.get('injury'),
                expected_return=inj.get('expected_return'),
                importance_score=inj.get('importance_score', 0.5)
            )
            for inj in team_data.get('injuries', [])
        ]
        
        stats = team_data.get('season_stats', {})
        
        return TeamPredictionContext(
            team_id=team_data.get('id', 0),
            team_name=team_data.get('name', 'Unknown'),
            elo_rating=features.home_elo if is_home else features.away_elo,
            form=form[:5],
            form_points=calculate_form_points(form),
            goals_scored_avg=stats.get('goals_per_game', 1.5),
            goals_conceded_avg=stats.get('conceded_per_game', 1.0),
            clean_sheet_rate=stats.get('clean_sheet_pct', 0.3),
            injuries=injuries,
            days_since_last_match=team_data.get('days_since_last_match', 7)
        )
    
    async def predict_multiple(
        self,
        matches: List[Dict]
    ) -> List[MatchPrediction]:
        """
        Generate predictions for multiple matches.
        
        Args:
            matches: List of match data dicts
        
        Returns:
            List of MatchPredictions
        """
        predictions = []
        
        for match in matches:
            try:
                pred = await self.predict_match(
                    match_id=match.get('match_id', 0),
                    home_team_data=match.get('home_team', {}),
                    away_team_data=match.get('away_team', {}),
                    h2h_data=match.get('h2h'),
                    match_context=match.get('context'),
                    kickoff_time=match.get('kickoff_time')
                )
                predictions.append(pred)
            except Exception as e:
                logger.error(f"Error predicting match {match.get('match_id')}: {e}")
                continue
        
        return predictions


# Singleton instance
_service: Optional[PredictionService] = None


def get_prediction_service() -> PredictionService:
    """Get or create prediction service singleton."""
    global _service
    if _service is None:
        _service = PredictionService()
    return _service
