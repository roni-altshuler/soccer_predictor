"""
Scalable ML Training Pipeline for Match Prediction.

Trains ensemble models on historical match data with rich feature engineering.
Supports:
- Multi-season training data across all leagues
- Feature engineering with form, ELO, weather, referee, context
- Ensemble of XGBoost + LightGBM + Gradient Boosting
- Automated retraining with performance tracking
- Model persistence and versioning
"""

import json
import pickle
import os
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from pathlib import Path
import logging

import numpy as np
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    accuracy_score,
    log_loss,
    brier_score_loss,
    classification_report,
)
from sklearn.ensemble import (
    GradientBoostingClassifier,
    VotingClassifier,
    RandomForestClassifier,
)

logger = logging.getLogger(__name__)

# Directory for model artifacts
MODEL_DIR = Path(__file__).parent.parent.parent / "data" / "models"

# Attempt optional imports for XGBoost / LightGBM
try:
    from xgboost import XGBClassifier
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False
    logger.warning("XGBoost not available, falling back to sklearn ensemble")

try:
    from lightgbm import LGBMClassifier
    HAS_LIGHTGBM = True
except ImportError:
    HAS_LIGHTGBM = False
    logger.warning("LightGBM not available, falling back to sklearn ensemble")


class FeatureBuilder:
    """
    Builds feature vectors from historical match data.
    
    Features include:
    - ELO ratings and difference
    - Rolling form (last 5 and 10 matches)
    - Weighted form with recency bias
    - Goals scored/conceded rolling averages
    - Home/away splits
    - Head-to-head records
    - Rest days between matches
    - Season context (matchday, positions)
    - Derby flag
    - League strength coefficient
    """

    LEAGUE_COEFFICIENTS = {
        "premier_league": 1.15,
        "la_liga": 1.10,
        "bundesliga": 1.05,
        "serie_a": 1.05,
        "ligue_1": 1.00,
        "eredivisie": 0.90,
        "primeira_liga": 0.90,
        "mls": 0.80,
        "champions_league": 1.20,
        "europa_league": 1.05,
    }

    DERBY_PAIRS = {
        "Manchester United": ["Manchester City", "Liverpool"],
        "Manchester City": ["Manchester United"],
        "Liverpool": ["Manchester United", "Everton"],
        "Everton": ["Liverpool"],
        "Arsenal": ["Tottenham Hotspur", "Chelsea"],
        "Tottenham Hotspur": ["Arsenal", "Chelsea", "West Ham United"],
        "Chelsea": ["Arsenal", "Tottenham Hotspur"],
        "Real Madrid": ["Barcelona", "Atletico Madrid"],
        "Barcelona": ["Real Madrid", "Espanyol"],
        "Atletico Madrid": ["Real Madrid"],
        "AC Milan": ["Inter Milan", "Juventus"],
        "Inter Milan": ["AC Milan", "Juventus"],
        "Juventus": ["Inter Milan", "AC Milan", "Torino"],
        "Bayern Munich": ["Borussia Dortmund"],
        "Borussia Dortmund": ["Bayern Munich", "Schalke 04"],
        "Paris Saint-Germain": ["Marseille"],
        "Marseille": ["Paris Saint-Germain"],
    }

    FEATURE_NAMES = [
        # ELO features (3)
        "home_elo", "away_elo", "elo_diff",
        # Form features (12)
        "home_form_5", "away_form_5",
        "home_form_10", "away_form_10",
        "home_weighted_form", "away_weighted_form",
        "home_goals_scored_avg5", "away_goals_scored_avg5",
        "home_goals_conceded_avg5", "away_goals_conceded_avg5",
        "home_goals_scored_avg10", "away_goals_scored_avg10",
        # Home/away splits (4)
        "home_home_win_pct", "away_away_win_pct",
        "home_home_goals_avg", "away_away_goals_avg",
        # H2H (3)
        "h2h_home_advantage", "h2h_avg_total_goals", "h2h_matches",
        # Context (6)
        "matchday_pct", "is_derby", "league_coefficient",
        "home_days_rest", "away_days_rest", "rest_diff",
        # Season stats (6)
        "home_ppg", "away_ppg",
        "home_clean_sheet_pct", "away_clean_sheet_pct",
        "home_gd_per_game", "away_gd_per_game",
        # Momentum (4)
        "home_streak", "away_streak",
        "home_unbeaten_run", "away_unbeaten_run",
    ]

    def __init__(self):
        self.elo_ratings: Dict[str, float] = {}
        self.team_history: Dict[str, List[Dict]] = {}  # team -> list of matches
        self.h2h_cache: Dict[str, List[Dict]] = {}  # "team1_vs_team2" -> matches

    def _get_elo(self, team: str) -> float:
        return self.elo_ratings.get(team, 1500.0)

    def _update_elo(
        self, home: str, away: str, home_goals: int, away_goals: int, league: str
    ):
        """Update ELO ratings after a match."""
        K = 32.0
        home_elo = self._get_elo(home)
        away_elo = self._get_elo(away)

        # Home advantage
        home_elo_adj = home_elo + 65.0

        # Expected score
        exp_home = 1.0 / (1.0 + 10 ** ((away_elo - home_elo_adj) / 400))
        exp_away = 1.0 - exp_home

        # Actual score
        if home_goals > away_goals:
            actual_home, actual_away = 1.0, 0.0
        elif away_goals > home_goals:
            actual_home, actual_away = 0.0, 1.0
        else:
            actual_home, actual_away = 0.5, 0.5

        # Goal difference multiplier
        gd = abs(home_goals - away_goals)
        gd_mult = 1.0 if gd <= 1 else (1.5 if gd == 2 else 1.75 + (gd - 3) * 0.125)

        # League coefficient
        league_coef = self.LEAGUE_COEFFICIENTS.get(league, 0.85)

        k = K * gd_mult * league_coef
        self.elo_ratings[home] = home_elo + k * (actual_home - exp_home)
        self.elo_ratings[away] = away_elo + k * (actual_away - exp_away)

    def _get_form(self, team: str, n: int = 5) -> float:
        """Get form points for last n matches (normalized to 0-1)."""
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.5
        points = sum(
            3 if m["result_for_team"] == "W" else (1 if m["result_for_team"] == "D" else 0)
            for m in history
        )
        max_points = n * 3
        return points / max_points if max_points > 0 else 0.5

    def _get_weighted_form(self, team: str, n: int = 5) -> float:
        """Get exponentially weighted form."""
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.5

        weights = [0.4, 0.55, 0.7, 0.85, 1.0][-len(history):]
        total_w = sum(weights)
        weighted = 0.0
        for m, w in zip(history, weights):
            pts = 3 if m["result_for_team"] == "W" else (1 if m["result_for_team"] == "D" else 0)
            weighted += pts * w
        return weighted / (total_w * 3) if total_w > 0 else 0.5

    def _get_goals_avg(
        self, team: str, n: int = 5, scored: bool = True
    ) -> float:
        """Average goals scored or conceded in last n matches."""
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 1.3
        key = "goals_scored" if scored else "goals_conceded"
        return sum(m[key] for m in history) / len(history)

    def _get_home_away_stats(
        self, team: str, is_home: bool, n: int = 10
    ) -> Tuple[float, float]:
        """Get win% and avg goals for home or away matches."""
        history = self.team_history.get(team, [])
        venue_matches = [
            m for m in history[-30:]
            if m.get("is_home") == is_home
        ][-n:]
        if not venue_matches:
            return 0.4 if is_home else 0.3, 1.3

        wins = sum(1 for m in venue_matches if m["result_for_team"] == "W")
        goals = sum(m["goals_scored"] for m in venue_matches)
        return wins / len(venue_matches), goals / len(venue_matches)

    def _get_h2h(self, team1: str, team2: str) -> Tuple[float, float, int]:
        """Get H2H advantage, avg total goals, and match count."""
        key = f"{min(team1, team2)}_vs_{max(team1, team2)}"
        matches = self.h2h_cache.get(key, [])[-10:]
        if not matches:
            return 0.0, 2.5, 0

        t1_wins = sum(1 for m in matches if m.get("winner") == team1)
        t2_wins = sum(1 for m in matches if m.get("winner") == team2)
        total_goals = sum(m.get("total_goals", 0) for m in matches)
        advantage = (t1_wins - t2_wins) / len(matches)
        avg_goals = total_goals / len(matches) if matches else 2.5
        return advantage, avg_goals, len(matches)

    def _get_streak(self, team: str) -> Tuple[int, int]:
        """Get current streak (positive=wins, 0=draws, negative=losses) and unbeaten run."""
        history = self.team_history.get(team, [])
        if not history:
            return 0, 0

        streak = 0
        first_result = history[-1]["result_for_team"]
        for m in reversed(history):
            if m["result_for_team"] == first_result:
                streak += 1
            else:
                break
        if first_result == "L":
            streak = -streak

        unbeaten = 0
        for m in reversed(history):
            if m["result_for_team"] != "L":
                unbeaten += 1
            else:
                break

        return streak, unbeaten

    def _get_ppg(self, team: str, n: int = 10) -> float:
        """Points per game over last n matches."""
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 1.3
        pts = sum(
            3 if m["result_for_team"] == "W" else (1 if m["result_for_team"] == "D" else 0)
            for m in history
        )
        return pts / len(history)

    def _get_clean_sheet_pct(self, team: str, n: int = 10) -> float:
        """Clean sheet percentage over last n matches."""
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.3
        cs = sum(1 for m in history if m["goals_conceded"] == 0)
        return cs / len(history)

    def _get_gd_per_game(self, team: str, n: int = 10) -> float:
        """Goal difference per game."""
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.0
        gd = sum(m["goals_scored"] - m["goals_conceded"] for m in history)
        return gd / len(history)

    def _get_rest_days(self, team: str, match_date: str) -> int:
        """Days since last match."""
        history = self.team_history.get(team, [])
        if not history:
            return 7
        try:
            current = datetime.fromisoformat(match_date.replace("Z", "+00:00"))
            last = datetime.fromisoformat(
                history[-1]["date"].replace("Z", "+00:00")
            )
            return max(1, (current - last).days)
        except Exception:
            return 7

    def build_features_for_match(self, match: Dict) -> Optional[np.ndarray]:
        """
        Build feature vector for a single match using accumulated state.
        Returns None if insufficient data.
        """
        home = match["home_team"]
        away = match["away_team"]
        league = match.get("league", "")
        date = match.get("date", "")
        matchday = match.get("matchday") or 0
        total_matchdays = 38 if league not in ("champions_league", "europa_league", "mls") else 34

        # Need at least some history
        home_hist = self.team_history.get(home, [])
        away_hist = self.team_history.get(away, [])
        if len(home_hist) < 3 or len(away_hist) < 3:
            return None

        home_elo = self._get_elo(home)
        away_elo = self._get_elo(away)

        home_hw_pct, home_h_goals = self._get_home_away_stats(home, True)
        away_aw_pct, away_a_goals = self._get_home_away_stats(away, False)

        h2h_adv, h2h_goals, h2h_count = self._get_h2h(home, away)

        home_rest = self._get_rest_days(home, date)
        away_rest = self._get_rest_days(away, date)

        home_streak, home_unbeaten = self._get_streak(home)
        away_streak, away_unbeaten = self._get_streak(away)

        is_derby = 1.0 if away in self.DERBY_PAIRS.get(home, []) else 0.0
        league_coef = self.LEAGUE_COEFFICIENTS.get(league, 0.85)
        matchday_pct = matchday / total_matchdays if total_matchdays > 0 else 0.5

        features = np.array([
            # ELO (3)
            home_elo, away_elo, home_elo - away_elo,
            # Form (12)
            self._get_form(home, 5), self._get_form(away, 5),
            self._get_form(home, 10), self._get_form(away, 10),
            self._get_weighted_form(home), self._get_weighted_form(away),
            self._get_goals_avg(home, 5, True), self._get_goals_avg(away, 5, True),
            self._get_goals_avg(home, 5, False), self._get_goals_avg(away, 5, False),
            self._get_goals_avg(home, 10, True), self._get_goals_avg(away, 10, True),
            # Home/away splits (4)
            home_hw_pct, away_aw_pct, home_h_goals, away_a_goals,
            # H2H (3)
            h2h_adv, h2h_goals, min(h2h_count, 10),
            # Context (6)
            matchday_pct, is_derby, league_coef,
            home_rest, away_rest, home_rest - away_rest,
            # Season stats (6)
            self._get_ppg(home), self._get_ppg(away),
            self._get_clean_sheet_pct(home), self._get_clean_sheet_pct(away),
            self._get_gd_per_game(home), self._get_gd_per_game(away),
            # Momentum (4)
            home_streak, away_streak, home_unbeaten, away_unbeaten,
        ], dtype=np.float64)

        return features

    def update_state(self, match: Dict):
        """
        Update internal state (ELO, team history, H2H) after processing a match.
        Must be called in chronological order.
        """
        home = match["home_team"]
        away = match["away_team"]
        home_score = match["home_score"]
        away_score = match["away_score"]
        league = match.get("league", "")
        date = match.get("date", "")

        # Determine results
        if home_score > away_score:
            home_res, away_res, winner = "W", "L", home
        elif away_score > home_score:
            home_res, away_res, winner = "L", "W", away
        else:
            home_res, away_res, winner = "D", "D", None

        # Update team history
        for team, is_home, res, gs, gc in [
            (home, True, home_res, home_score, away_score),
            (away, False, away_res, away_score, home_score),
        ]:
            if team not in self.team_history:
                self.team_history[team] = []
            self.team_history[team].append({
                "date": date,
                "is_home": is_home,
                "result_for_team": res,
                "goals_scored": gs,
                "goals_conceded": gc,
                "opponent": away if team == home else home,
            })

        # Update H2H
        key = f"{min(home, away)}_vs_{max(home, away)}"
        if key not in self.h2h_cache:
            self.h2h_cache[key] = []
        self.h2h_cache[key].append({
            "date": date,
            "winner": winner,
            "total_goals": home_score + away_score,
        })

        # Update ELO
        self._update_elo(home, away, home_score, away_score, league)


class ModelTrainer:
    """
    Trains and evaluates the match prediction ML model.
    
    Architecture:
    - Ensemble of XGBoost, LightGBM, and GradientBoosting
    - Soft voting for probability calibration
    - Time-series cross-validation to respect temporal ordering
    - Feature scaling with StandardScaler
    """

    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = model_dir or MODEL_DIR
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.scaler = StandardScaler()
        self.model = None
        self.feature_names = FeatureBuilder.FEATURE_NAMES
        self.training_metadata: Dict[str, Any] = {}

    def prepare_training_data(
        self, matches: List[Dict]
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Process raw historical matches into feature matrix and labels.
        
        Matches must be sorted chronologically.
        Labels: 0 = home win, 1 = draw, 2 = away win
        """
        builder = FeatureBuilder()

        # Sort by date
        sorted_matches = sorted(matches, key=lambda m: m.get("date", ""))

        X_list = []
        y_list = []

        for match in sorted_matches:
            if match.get("home_score") is None or match.get("away_score") is None:
                continue

            # Build features BEFORE updating state (pre-match features)
            features = builder.build_features_for_match(match)

            # Update state regardless (to build history)
            builder.update_state(match)

            if features is None:
                continue

            # Label
            hs, as_ = match["home_score"], match["away_score"]
            if hs > as_:
                label = 0  # Home win
            elif hs == as_:
                label = 1  # Draw
            else:
                label = 2  # Away win

            X_list.append(features)
            y_list.append(label)

        X = np.array(X_list, dtype=np.float64)
        y = np.array(y_list, dtype=np.int32)

        # Handle NaN/Inf
        X = np.nan_to_num(X, nan=0.0, posinf=5.0, neginf=-5.0)

        logger.info(
            f"Prepared {len(X)} training samples from {len(sorted_matches)} matches. "
            f"Distribution: H={sum(y==0)}, D={sum(y==1)}, A={sum(y==2)}"
        )

        return X, y

    def _build_ensemble(self) -> Any:
        """Build the ensemble classifier."""
        estimators = []

        # Gradient Boosting (always available)
        gb = GradientBoostingClassifier(
            n_estimators=300,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            min_samples_leaf=20,
            random_state=42,
        )
        estimators.append(("gb", gb))

        # Random Forest
        rf = RandomForestClassifier(
            n_estimators=200,
            max_depth=8,
            min_samples_leaf=15,
            random_state=42,
            n_jobs=-1,
        )
        estimators.append(("rf", rf))

        # XGBoost (if available)
        if HAS_XGBOOST:
            xgb = XGBClassifier(
                n_estimators=300,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=10,
                eval_metric="mlogloss",
                random_state=42,
                use_label_encoder=False,
            )
            estimators.append(("xgb", xgb))

        # LightGBM (if available)
        if HAS_LIGHTGBM:
            lgb = LGBMClassifier(
                n_estimators=300,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_samples=20,
                random_state=42,
                verbose=-1,
            )
            estimators.append(("lgb", lgb))

        # Voting ensemble
        ensemble = VotingClassifier(
            estimators=estimators,
            voting="soft",
            weights=[1.0, 0.8] + ([1.2] if HAS_XGBOOST else []) + ([1.1] if HAS_LIGHTGBM else []),
        )

        return ensemble

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        test_size: float = 0.15,
    ) -> Dict[str, Any]:
        """
        Train the ensemble model with time-series aware evaluation.
        
        Returns training metrics.
        """
        n_samples = len(X)
        split_idx = int(n_samples * (1 - test_size))

        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)

        # Build and train ensemble
        logger.info(
            f"Training ensemble on {len(X_train)} samples, testing on {len(X_test)}"
        )
        self.model = self._build_ensemble()
        self.model.fit(X_train_scaled, y_train)

        # Evaluate
        y_pred = self.model.predict(X_test_scaled)
        y_proba = self.model.predict_proba(X_test_scaled)

        accuracy = accuracy_score(y_test, y_pred)
        logloss = log_loss(y_test, y_proba)

        # Brier score per class
        brier_scores = {}
        for cls, name in enumerate(["home_win", "draw", "away_win"]):
            mask = y_test == cls
            if mask.any():
                brier_scores[name] = float(
                    brier_score_loss(mask.astype(int), y_proba[:, cls])
                )

        # Time-series cross-validation
        tscv = TimeSeriesSplit(n_splits=5)
        cv_scores = cross_val_score(
            self._build_ensemble(),
            X_train_scaled,
            y_train,
            cv=tscv,
            scoring="accuracy",
        )

        metrics = {
            "accuracy": float(accuracy),
            "log_loss": float(logloss),
            "brier_scores": brier_scores,
            "cv_accuracy_mean": float(cv_scores.mean()),
            "cv_accuracy_std": float(cv_scores.std()),
            "train_samples": len(X_train),
            "test_samples": len(X_test),
            "class_distribution": {
                "home_win": int(sum(y == 0)),
                "draw": int(sum(y == 1)),
                "away_win": int(sum(y == 2)),
            },
            "feature_count": X.shape[1],
        }

        # Feature importances (from gradient boosting sub-model)
        try:
            gb_model = self.model.named_estimators_.get("gb")
            if gb_model and hasattr(gb_model, "feature_importances_"):
                importances = gb_model.feature_importances_
                top_features = sorted(
                    zip(self.feature_names, importances),
                    key=lambda x: x[1],
                    reverse=True,
                )[:15]
                metrics["top_features"] = [
                    {"name": f, "importance": round(float(v), 4)}
                    for f, v in top_features
                ]
        except Exception:
            pass

        self.training_metadata = {
            "trained_at": datetime.utcnow().isoformat(),
            "model_version": "3.1.0",
            "metrics": metrics,
        }

        logger.info(
            f"Training complete — Accuracy: {accuracy:.3f}, "
            f"Log Loss: {logloss:.3f}, CV: {cv_scores.mean():.3f}±{cv_scores.std():.3f}"
        )

        return metrics

    def save_model(self, name: str = "match_predictor"):
        """Save trained model and scaler to disk."""
        if self.model is None:
            raise ValueError("No trained model to save")

        model_path = self.model_dir / f"{name}.pkl"
        scaler_path = self.model_dir / f"{name}_scaler.pkl"
        meta_path = self.model_dir / f"{name}_metadata.json"

        with open(model_path, "wb") as f:
            pickle.dump(self.model, f)
        with open(scaler_path, "wb") as f:
            pickle.dump(self.scaler, f)
        with open(meta_path, "w") as f:
            json.dump(self.training_metadata, f, indent=2)

        logger.info(f"Model saved to {model_path}")

    def load_model(self, name: str = "match_predictor") -> bool:
        """Load trained model from disk. Returns True if successful."""
        model_path = self.model_dir / f"{name}.pkl"
        scaler_path = self.model_dir / f"{name}_scaler.pkl"
        meta_path = self.model_dir / f"{name}_metadata.json"

        if not model_path.exists():
            logger.warning(f"No saved model found at {model_path}")
            return False

        try:
            with open(model_path, "rb") as f:
                self.model = pickle.load(f)
            with open(scaler_path, "rb") as f:
                self.scaler = pickle.load(f)
            if meta_path.exists():
                with open(meta_path, "r") as f:
                    self.training_metadata = json.load(f)
            logger.info(f"Model loaded from {model_path}")
            return True
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            return False

    def predict(self, features: np.ndarray) -> np.ndarray:
        """Predict class probabilities for feature vectors."""
        if self.model is None:
            raise ValueError("No model loaded. Train or load a model first.")
        scaled = self.scaler.transform(
            features.reshape(1, -1) if features.ndim == 1 else features
        )
        return self.model.predict_proba(scaled)


async def train_model_pipeline(
    leagues: Optional[List[str]] = None,
    min_season: int = 2018,
    force_fetch: bool = False,
) -> Dict[str, Any]:
    """
    Complete training pipeline:
    1. Fetch historical data
    2. Build features
    3. Train ensemble model
    4. Save model artifacts
    
    Returns training metrics.
    """
    from backend.services.prediction.historical_data import get_historical_collector

    collector = get_historical_collector()

    # Step 1: Fetch data
    logger.info("Step 1/4: Fetching historical match data...")
    all_data = await collector.fetch_all_historical_data(
        leagues=leagues, min_season=min_season, force=force_fetch
    )

    # Flatten all matches
    all_matches = []
    for league_matches in all_data.values():
        all_matches.extend(league_matches)

    if len(all_matches) < 100:
        return {"error": "Insufficient data", "match_count": len(all_matches)}

    logger.info(f"Step 2/4: Building features from {len(all_matches)} matches...")

    # Step 2: Build features
    trainer = ModelTrainer()
    X, y = trainer.prepare_training_data(all_matches)

    if len(X) < 50:
        return {"error": "Insufficient valid samples", "sample_count": len(X)}

    # Step 3: Train
    logger.info("Step 3/4: Training ensemble model...")
    metrics = trainer.train(X, y)

    # Step 4: Save
    logger.info("Step 4/4: Saving model artifacts...")
    trainer.save_model()

    return {
        "status": "success",
        "total_matches": len(all_matches),
        "training_samples": len(X),
        "metrics": metrics,
    }


# Singleton trainer with loaded model
_trainer: Optional[ModelTrainer] = None


def get_model_trainer() -> ModelTrainer:
    """Get or create model trainer singleton, loading saved model if available."""
    global _trainer
    if _trainer is None:
        _trainer = ModelTrainer()
        _trainer.load_model()
    return _trainer
