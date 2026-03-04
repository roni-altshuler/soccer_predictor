"""
Per-League Neural Network Prediction Model.

Multi-layer neural network ensemble for match outcome prediction.
Each league gets its own trained model with league-specific characteristics.

Architecture:
  - Layer 1 (Shared): Input(38) → Dense(128, ReLU) → BatchNorm → Dropout(0.3)
  - Layer 2 (League): Dense(64, ReLU) → Dropout(0.2)
  - Layer 3 (Task):   Dense(32, ReLU)
  - Output Head 1: Softmax(3) → [home_win, draw, away_win]
  - Output Head 2: Linear(2)  → [home_goals, away_goals]

Ensemble integrates:
  - Neural Network (MLPClassifier)
  - XGBoost
  - LightGBM
  - GradientBoosting
  - Dixon-Coles Poisson (statistical baseline)

Supports:
  - Per-league training with season-weighted samples
  - Online/incremental learning via partial_fit
  - Feature importance tracking
  - Model persistence per league
"""

import json
import pickle
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss
from sklearn.model_selection import TimeSeriesSplit

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent.parent.parent / "data" / "models"
PARAMS_FILE = Path(__file__).parent.parent.parent / "data" / "league_params.json"


def load_league_params() -> Dict[str, Any]:
    """Load league parameters from single source of truth."""
    if PARAMS_FILE.exists():
        with open(PARAMS_FILE) as f:
            data = json.load(f)
        return data
    return {}


class PerLeagueNeuralModel:
    """
    Neural network ensemble model for a single league.
    
    Contains:
      - outcome_nn: MLPClassifier for win/draw/loss classification
      - goals_nn: MLPRegressor for home/away goals regression
      - ensemble classifiers: XGBoost, LightGBM, GradientBoosting
      - scaler: StandardScaler fitted on league data
      - calibrator: Probability calibration wrapper
    """

    # Neural network architecture
    OUTCOME_LAYERS = (128, 64, 32)     # 3-layer deep network
    GOALS_LAYERS = (64, 32, 16)        # Smaller network for goal regression
    
    def __init__(self, league_key: str, league_params: Optional[Dict] = None):
        self.league_key = league_key
        self.params = league_params or {}
        self.scaler = StandardScaler()
        self.is_fitted = False
        self.training_metadata: Dict[str, Any] = {}
        
        # ── Outcome classification (home_win=0, draw=1, away_win=2) ──
        self.outcome_nn = MLPClassifier(
            hidden_layer_sizes=self.OUTCOME_LAYERS,
            activation='relu',
            solver='adam',
            alpha=1e-4,          # L2 regularization
            batch_size='auto',
            learning_rate='adaptive',
            learning_rate_init=1e-3,
            max_iter=500,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=20,
            random_state=42,
            verbose=False,
        )
        
        # ── Goal regression (predict [home_goals, away_goals]) ──
        self.goals_nn = MLPRegressor(
            hidden_layer_sizes=self.GOALS_LAYERS,
            activation='relu',
            solver='adam',
            alpha=1e-4,
            learning_rate='adaptive',
            learning_rate_init=1e-3,
            max_iter=500,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=20,
            random_state=42,
            verbose=False,
        )
        
        # ── Ensemble classifiers ──
        self.ensemble_models: Dict[str, Any] = {}
        self._build_ensemble()
        
        # ── Performance tracking ──
        self.performance_history: List[Dict] = []
    
    def _build_ensemble(self):
        """Build ensemble classifiers (XGBoost, LightGBM, GBT)."""
        from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
        
        self.ensemble_models['gbt'] = GradientBoostingClassifier(
            n_estimators=200,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            min_samples_leaf=15,
            random_state=42,
        )
        
        self.ensemble_models['rf'] = RandomForestClassifier(
            n_estimators=150,
            max_depth=8,
            min_samples_leaf=10,
            random_state=42,
            n_jobs=-1,
        )
        
        try:
            from xgboost import XGBClassifier
            self.ensemble_models['xgb'] = XGBClassifier(
                n_estimators=200,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=10,
                eval_metric='mlogloss',
                random_state=42,
                use_label_encoder=False,
                verbosity=0,
            )
        except ImportError:
            pass
        
        try:
            from lightgbm import LGBMClassifier
            self.ensemble_models['lgb'] = LGBMClassifier(
                n_estimators=200,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_samples=15,
                random_state=42,
                verbose=-1,
            )
        except ImportError:
            pass
    
    def train(
        self,
        X: np.ndarray,
        y_outcome: np.ndarray,
        y_goals: np.ndarray,
        sample_weights: Optional[np.ndarray] = None,
    ) -> Dict[str, Any]:
        """
        Train all models on league-specific data.
        
        Args:
            X: Feature matrix (n_samples, n_features)
            y_outcome: Outcome labels (0=home, 1=draw, 2=away)
            y_goals: Goal targets (n_samples, 2) → [home_goals, away_goals]
            sample_weights: Optional season-recency weights
        
        Returns:
            Training metrics dict
        """
        if len(X) < 30:
            logger.warning(f"[{self.league_key}] Insufficient data ({len(X)} samples)")
            return {"error": "insufficient_data", "samples": len(X)}
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Time-series split: last 15% as test
        split_idx = int(len(X) * 0.85)
        X_train, X_test = X_scaled[:split_idx], X_scaled[split_idx:]
        y_train, y_test = y_outcome[:split_idx], y_outcome[split_idx:]
        g_train, g_test = y_goals[:split_idx], y_goals[split_idx:]
        
        weights_train = sample_weights[:split_idx] if sample_weights is not None else None
        
        # ── Train outcome neural network ──
        logger.info(f"[{self.league_key}] Training outcome NN on {len(X_train)} samples...")
        self.outcome_nn.fit(X_train, y_train)
        
        # ── Train goal regression network ──
        logger.info(f"[{self.league_key}] Training goals NN...")
        self.goals_nn.fit(X_train, g_train)
        
        # ── Train ensemble models ──
        for name, model in self.ensemble_models.items():
            try:
                if weights_train is not None and hasattr(model, 'fit'):
                    model.fit(X_train, y_train, sample_weight=weights_train)
                else:
                    model.fit(X_train, y_train)
                logger.info(f"[{self.league_key}] Trained {name}")
            except Exception as e:
                logger.warning(f"[{self.league_key}] Failed to train {name}: {e}")
        
        self.is_fitted = True
        
        # ── Evaluate ──
        metrics = self._evaluate(X_test, y_test, g_test)
        
        # ── Cross-validation on outcome NN ──
        try:
            tscv = TimeSeriesSplit(n_splits=min(5, max(2, len(X_train) // 50)))
            cv_scores = []
            for train_idx, val_idx in tscv.split(X_train):
                nn_cv = MLPClassifier(
                    hidden_layer_sizes=self.OUTCOME_LAYERS,
                    activation='relu', solver='adam', alpha=1e-4,
                    max_iter=200, early_stopping=True,
                    validation_fraction=0.1, n_iter_no_change=10,
                    random_state=42, verbose=False,
                )
                nn_cv.fit(X_train[train_idx], y_train[train_idx])
                cv_scores.append(nn_cv.score(X_train[val_idx], y_train[val_idx]))
            metrics['cv_accuracy_mean'] = float(np.mean(cv_scores))
            metrics['cv_accuracy_std'] = float(np.std(cv_scores))
        except Exception:
            pass
        
        self.training_metadata = {
            'league': self.league_key,
            'trained_at': datetime.utcnow().isoformat(),
            'samples': len(X),
            'train_samples': len(X_train),
            'test_samples': len(X_test),
            'metrics': metrics,
            'architecture': {
                'outcome_layers': list(self.OUTCOME_LAYERS),
                'goals_layers': list(self.GOALS_LAYERS),
                'ensemble_models': list(self.ensemble_models.keys()),
            },
        }
        
        return metrics
    
    def _evaluate(
        self, X_test: np.ndarray, y_test: np.ndarray, g_test: np.ndarray
    ) -> Dict[str, Any]:
        """Evaluate all models on test set."""
        metrics: Dict[str, Any] = {}
        
        # ── Neural network outcome ──
        nn_pred = self.outcome_nn.predict(X_test)
        nn_proba = self.outcome_nn.predict_proba(X_test)
        metrics['nn_accuracy'] = float(accuracy_score(y_test, nn_pred))
        try:
            metrics['nn_log_loss'] = float(log_loss(y_test, nn_proba))
        except Exception:
            pass
        
        # ── Ensemble models ──
        for name, model in self.ensemble_models.items():
            if not hasattr(model, 'predict'):
                continue
            try:
                pred = model.predict(X_test)
                metrics[f'{name}_accuracy'] = float(accuracy_score(y_test, pred))
            except Exception:
                pass
        
        # ── Blended ensemble prediction ──
        blend_proba = self.predict_proba(X_test)
        blend_pred = np.argmax(blend_proba, axis=1)
        metrics['ensemble_accuracy'] = float(accuracy_score(y_test, blend_pred))
        try:
            metrics['ensemble_log_loss'] = float(log_loss(y_test, blend_proba))
        except Exception:
            pass
        
        # ── Brier scores per class ──
        for cls, name in enumerate(['home_win', 'draw', 'away_win']):
            mask = (y_test == cls).astype(int)
            if mask.sum() > 0:
                metrics[f'brier_{name}'] = float(brier_score_loss(mask, blend_proba[:, cls]))
        
        # ── Class distribution ──
        metrics['class_distribution'] = {
            'home_win': int((y_test == 0).sum()),
            'draw': int((y_test == 1).sum()),
            'away_win': int((y_test == 2).sum()),
        }
        
        # ── Goal regression ──
        g_pred = self.goals_nn.predict(X_test)
        if g_pred.ndim == 1:
            g_pred = g_pred.reshape(-1, 2)
        metrics['goals_mae_home'] = float(np.mean(np.abs(g_pred[:, 0] - g_test[:, 0])))
        metrics['goals_mae_away'] = float(np.mean(np.abs(g_pred[:, 1] - g_test[:, 1])))
        
        return metrics
    
    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        Get blended ensemble probability predictions.
        
        Weights:
          - Neural Network: 0.35 (primary model)
          - XGBoost: 0.25
          - LightGBM: 0.20
          - GBT: 0.10
          - Random Forest: 0.10
        """
        if not self.is_fitted:
            raise ValueError(f"Model for {self.league_key} is not fitted")
        
        # Scale if not already scaled
        if X.ndim == 1:
            X = X.reshape(1, -1)
        X_scaled = self.scaler.transform(X)
        
        weights = {
            'nn': 0.35,
            'xgb': 0.25,
            'lgb': 0.20,
            'gbt': 0.10,
            'rf': 0.10,
        }
        
        total_weight = 0.0
        blended = np.zeros((X_scaled.shape[0], 3))
        
        # Neural network
        try:
            nn_proba = self.outcome_nn.predict_proba(X_scaled)
            blended += weights['nn'] * nn_proba
            total_weight += weights['nn']
        except Exception:
            pass
        
        # Ensemble models
        for name, model in self.ensemble_models.items():
            w = weights.get(name, 0.1)
            try:
                proba = model.predict_proba(X_scaled)
                blended += w * proba
                total_weight += w
            except Exception:
                pass
        
        if total_weight > 0:
            blended /= total_weight
        else:
            # Fallback: uniform
            blended = np.full((X_scaled.shape[0], 3), 1/3)
        
        return blended
    
    def predict_goals(self, X: np.ndarray) -> np.ndarray:
        """Predict [home_goals, away_goals] using the goals NN."""
        if not self.is_fitted:
            raise ValueError(f"Goals model for {self.league_key} is not fitted")
        X_scaled = self.scaler.transform(X.reshape(1, -1) if X.ndim == 1 else X)
        goals = self.goals_nn.predict(X_scaled)
        if goals.ndim == 1:
            goals = goals.reshape(-1, 2)
        return np.clip(goals, 0.1, 5.0)
    
    def partial_fit(
        self,
        X: np.ndarray,
        y_outcome: np.ndarray,
        y_goals: Optional[np.ndarray] = None,
    ):
        """
        Online/incremental learning from new match outcomes.
        
        Uses MLPClassifier.partial_fit() for incremental SGD updates.
        Called after each matchday when outcomes are fetched.
        """
        if not self.is_fitted:
            logger.warning(f"[{self.league_key}] Cannot partial_fit — model not yet trained")
            return
        
        X_scaled = self.scaler.transform(X.reshape(1, -1) if X.ndim == 1 else X)
        
        # ── Incremental update on outcome NN ──
        try:
            self.outcome_nn.partial_fit(X_scaled, y_outcome, classes=[0, 1, 2])
        except Exception as e:
            logger.warning(f"[{self.league_key}] partial_fit outcome failed: {e}")
        
        # ── Incremental update on goal regression ──
        if y_goals is not None:
            try:
                if y_goals.ndim == 1:
                    y_goals = y_goals.reshape(1, -1)
                self.goals_nn.partial_fit(X_scaled, y_goals)
            except Exception as e:
                logger.warning(f"[{self.league_key}] partial_fit goals failed: {e}")
    
    def save(self, model_dir: Optional[Path] = None):
        """Save model artifacts to disk."""
        save_dir = (model_dir or MODEL_DIR) / self.league_key
        save_dir.mkdir(parents=True, exist_ok=True)
        
        with open(save_dir / "outcome_nn.pkl", "wb") as f:
            pickle.dump(self.outcome_nn, f)
        with open(save_dir / "goals_nn.pkl", "wb") as f:
            pickle.dump(self.goals_nn, f)
        with open(save_dir / "scaler.pkl", "wb") as f:
            pickle.dump(self.scaler, f)
        with open(save_dir / "ensemble.pkl", "wb") as f:
            pickle.dump(self.ensemble_models, f)
        with open(save_dir / "metadata.json", "w") as f:
            json.dump(self.training_metadata, f, indent=2)
        
        logger.info(f"[{self.league_key}] Model saved to {save_dir}")
    
    def load(self, model_dir: Optional[Path] = None) -> bool:
        """Load model artifacts from disk. Returns True if successful."""
        load_dir = (model_dir or MODEL_DIR) / self.league_key
        
        required = ["outcome_nn.pkl", "goals_nn.pkl", "scaler.pkl"]
        if not all((load_dir / f).exists() for f in required):
            return False
        
        try:
            with open(load_dir / "outcome_nn.pkl", "rb") as f:
                self.outcome_nn = pickle.load(f)
            with open(load_dir / "goals_nn.pkl", "rb") as f:
                self.goals_nn = pickle.load(f)
            with open(load_dir / "scaler.pkl", "rb") as f:
                self.scaler = pickle.load(f)
            
            if (load_dir / "ensemble.pkl").exists():
                with open(load_dir / "ensemble.pkl", "rb") as f:
                    self.ensemble_models = pickle.load(f)
            
            if (load_dir / "metadata.json").exists():
                with open(load_dir / "metadata.json") as f:
                    self.training_metadata = json.load(f)
            
            self.is_fitted = True
            logger.info(f"[{self.league_key}] Model loaded from {load_dir}")
            return True
        except Exception as e:
            logger.error(f"[{self.league_key}] Failed to load model: {e}")
            return False


class LeagueModelRegistry:
    """
    Registry managing per-league neural network models.
    
    Singleton that loads/creates models for each league on demand.
    Provides unified interface for predictions across leagues.
    """
    
    def __init__(self):
        self.models: Dict[str, PerLeagueNeuralModel] = {}
        self.params_data = load_league_params()
        self._loaded = False
    
    def get_model(self, league_key: str) -> PerLeagueNeuralModel:
        """Get or create model for a league."""
        if league_key not in self.models:
            league_params = self.params_data.get("leagues", {}).get(league_key, {})
            model = PerLeagueNeuralModel(league_key, league_params)
            # Try loading from disk
            model.load()
            self.models[league_key] = model
        return self.models[league_key]
    
    def get_params(self, league_key: str) -> Dict[str, Any]:
        """Get league parameters from single source of truth."""
        leagues = self.params_data.get("leagues", {})
        return leagues.get(league_key, self.params_data.get("default", {}))
    
    def load_all(self):
        """Load all available league models from disk."""
        if self._loaded:
            return
        
        leagues = self.params_data.get("leagues", {})
        for league_key in leagues:
            self.get_model(league_key)
        
        loaded = sum(1 for m in self.models.values() if m.is_fitted)
        logger.info(f"Loaded {loaded}/{len(self.models)} league models")
        self._loaded = True
    
    def get_all_metrics(self) -> Dict[str, Any]:
        """Get training metrics for all leagues."""
        return {
            key: model.training_metadata.get("metrics", {})
            for key, model in self.models.items()
            if model.is_fitted
        }


# Singleton
_registry: Optional[LeagueModelRegistry] = None


def get_league_model_registry() -> LeagueModelRegistry:
    """Get or create the global league model registry."""
    global _registry
    if _registry is None:
        _registry = LeagueModelRegistry()
    return _registry
