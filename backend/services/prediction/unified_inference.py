"""Runtime adapter that serves predictions from a trained unified model.

This is the thin bridge between `train_unified.py`'s saved artifacts
and the user-facing `MatchPrediction` schema.  Callers (the FastAPI
prediction route, the existing `PredictionService`, the scheduled
`predict_upcoming` script) ask `predict_one(home_id, away_id,
competition_id, kickoff_utc, gender)` and get back a fully populated
`MatchPrediction` payload — same Pydantic shape the frontend already
understands.

Lookup flow
-----------
1. `UnifiedModelStore` lazy-loads `unified_<gender>.pt`,
   `unified_<gender>_scaler.pkl`, and `unified_<gender>_calibrator.pkl`
   on first use.
2. Vocab maps (`league_id_map`, `team_id_map`, `referee_id_map`) are
   reattached so the inference-time `FeatureBuilderV2` produces the same
   embedding IDs that training used.
3. We build a single feature row for the requested fixture, scale it,
   forward through the network, derive a calibrated outcome
   distribution + a 12×12 scoreline grid, and pack the result.

If the model artifact is missing (e.g. a fresh repo before the first
training run), the loader returns `None` and the legacy `PredictionService`
falls back to its ELO-Poisson baseline. That keeps the API up while the
unified pipeline is bootstrapping.
"""

from __future__ import annotations

import logging
import pickle
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np
import torch
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import StandardScaler

from backend.models.prediction import (
    ConfidenceBreakdown,
    GoalsPrediction,
    MatchPrediction,
    OutcomeProbabilities,
    PredictionFactors,
    ScorelinePrediction,
)
from backend.services.data.warehouse import Warehouse, open_warehouse
from backend.services.prediction.feature_builder_v2 import (
    FEATURE_NAMES,
    FeatureBuilderV2,
)
from backend.services.prediction.losses import (
    btts_probability,
    outcome_probabilities_from_pmf,
    over_under_markets,
    scoreline_distribution,
    top_k_scorelines,
)
from backend.services.prediction.unified_model import (
    UnifiedMatchModel,
    UnifiedModelConfig,
)

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "models"
MODEL_VERSION = "unified-multitask-1.0"


class UnifiedModelStore:
    """Cache of loaded artifacts; one instance per (gender, process)."""

    def __init__(self, gender: str):
        self.gender = gender.upper()
        if self.gender not in ("M", "F"):
            raise ValueError(f"gender must be 'M' or 'F', got {gender!r}")
        self.suffix = "men" if self.gender == "M" else "women"

        self._model: Optional[UnifiedMatchModel] = None
        self._scaler: Optional[StandardScaler] = None
        self._calibrators: Optional[Dict[str, IsotonicRegression]] = None
        self._vocab: Optional[Dict] = None
        self._loaded = False

    @property
    def artifact_paths(self) -> Dict[str, Path]:
        return {
            "model": MODEL_DIR / f"unified_{self.suffix}.pt",
            "scaler": MODEL_DIR / f"unified_{self.suffix}_scaler.pkl",
            "calibrator": MODEL_DIR / f"unified_{self.suffix}_calibrator.pkl",
        }

    def is_available(self) -> bool:
        return all(p.exists() for p in self.artifact_paths.values())

    def load(self) -> bool:
        if self._loaded:
            return True
        if not self.is_available():
            logger.info("Unified %s artifacts not found under %s; skipping load.", self.suffix, MODEL_DIR)
            return False

        paths = self.artifact_paths
        blob = torch.load(paths["model"], map_location="cpu", weights_only=False)
        model = UnifiedMatchModel.from_state_blob(blob)
        model.eval()
        self._model = model
        self._vocab = blob.get("vocab", {})

        with open(paths["scaler"], "rb") as f:
            self._scaler = pickle.load(f)
        with open(paths["calibrator"], "rb") as f:
            self._calibrators = pickle.load(f)

        self._loaded = True
        logger.info(
            "Loaded unified %s model (params=%d, leagues=%d, teams=%d).",
            self.suffix,
            sum(p.numel() for p in self._model.parameters()),
            self._model.config.n_leagues,
            self._model.config.n_teams,
        )
        return True

    @property
    def model(self) -> UnifiedMatchModel:
        if not self._loaded:
            raise RuntimeError("UnifiedModelStore.load() must be called first")
        return self._model  # type: ignore[return-value]

    @property
    def scaler(self) -> StandardScaler:
        if not self._loaded:
            raise RuntimeError("UnifiedModelStore.load() must be called first")
        return self._scaler  # type: ignore[return-value]

    @property
    def calibrators(self) -> Dict[str, IsotonicRegression]:
        if not self._loaded:
            raise RuntimeError("UnifiedModelStore.load() must be called first")
        return self._calibrators  # type: ignore[return-value]

    def build_feature_builder(self, warehouse: Warehouse) -> FeatureBuilderV2:
        if not self._loaded:
            raise RuntimeError("Load store before constructing a builder")
        vocab = self._vocab or {}
        return FeatureBuilderV2(
            warehouse,
            league_id_map={k: int(v) for k, v in vocab.get("league_id_map", {}).items()},
            team_id_map={int(k): int(v) for k, v in vocab.get("team_id_map", {}).items()},
            referee_id_map={int(k): int(v) for k, v in vocab.get("referee_id_map", {}).items()},
        )


# Process-wide singletons (per-gender) so artifacts load once.
_STORES: Dict[str, UnifiedModelStore] = {}


def get_store(gender: str) -> UnifiedModelStore:
    key = gender.upper()
    if key not in _STORES:
        _STORES[key] = UnifiedModelStore(key)
    return _STORES[key]


# ---------- prediction ----------


def _synthetic_match_row(
    warehouse: Warehouse,
    *,
    home_team_id: int,
    away_team_id: int,
    competition_id: str,
    date_utc: str,
    phase: Optional[str] = None,
    referee_id: Optional[int] = None,
) -> sqlite3.Row:
    """Build a row matching the `matches` schema for inference.

    The feature builder works off the warehouse row format. For a future
    fixture (with no actual score), we synthesise a row that has the
    same column structure but `home_score`/`away_score` = None.
    """
    season_year = int(date_utc[:4])
    sql_row = sqlite3.Row
    # Use the connection's row factory to manufacture a row-like object.
    conn = warehouse._conn  # noqa: SLF001
    # Build a temp transaction-free SELECT that returns the synthetic row.
    cur = conn.execute(
        """
        SELECT
            'synthetic_inference' AS match_id,
            'inference' AS source,
            ? AS competition_id,
            ? AS season,
            ? AS date_utc,
            ? AS home_team_id,
            ? AS away_team_id,
            NULL AS home_score,
            NULL AS away_score,
            ? AS phase,
            ? AS referee_id,
            NULL AS home_shots, NULL AS away_shots,
            NULL AS home_sot, NULL AS away_sot,
            NULL AS home_corners, NULL AS away_corners,
            NULL AS home_yellows, NULL AS away_yellows,
            NULL AS home_reds, NULL AS away_reds,
            NULL AS home_xg, NULL AS away_xg,
            NULL AS attendance,
            NULL AS odds_home, NULL AS odds_draw, NULL AS odds_away,
            NULL AS odds_over_2_5,
            NULL AS venue,
            datetime('now') AS fetched_at
        """,
        (competition_id, season_year, date_utc, home_team_id, away_team_id, phase, referee_id),
    )
    return cur.fetchone()


def _calibrated_outcome(
    outcome: torch.Tensor, calibrators: Dict[str, IsotonicRegression]
) -> np.ndarray:
    """Apply the per-class isotonic mapping and renormalise."""
    probs = outcome.cpu().numpy()
    home = calibrators["home_win"].predict(probs[:, 0])
    draw = calibrators["draw"].predict(probs[:, 1])
    away = calibrators["away_win"].predict(probs[:, 2])
    stacked = np.stack([home, draw, away], axis=-1)
    return stacked / stacked.sum(axis=-1, keepdims=True).clip(1e-9)


def predict_one(
    *,
    warehouse: Warehouse,
    home_team_id: int,
    away_team_id: int,
    home_team_name: str,
    away_team_name: str,
    competition_id: str,
    competition_name: str,
    kickoff_utc: datetime,
    gender: str = "M",
    phase: Optional[str] = None,
    referee_id: Optional[int] = None,
    match_id: int = 0,
) -> Optional[MatchPrediction]:
    """Run the unified model end-to-end for one fixture.

    Returns a `MatchPrediction` payload, or ``None`` if the artifact for
    the requested gender hasn't been trained yet (caller should fall
    back to the legacy ELO-Poisson model in that case).
    """
    store = get_store(gender)
    if not store.load():
        return None

    builder = store.build_feature_builder(warehouse)
    row = _synthetic_match_row(
        warehouse,
        home_team_id=home_team_id, away_team_id=away_team_id,
        competition_id=competition_id, date_utc=kickoff_utc.astimezone(timezone.utc).isoformat(),
        phase=phase, referee_id=referee_id,
    )
    built = builder.build_from_row(row)

    dense = np.asarray(built.dense, dtype=np.float32).reshape(1, -1)
    dense = store.scaler.transform(dense).astype(np.float32)

    t = lambda v, dt=torch.long: torch.tensor([v], dtype=dt)
    tensor_in = {
        "dense": torch.from_numpy(dense),
        "league_id": t(built.context.league_id),
        "home_team_id": t(built.context.home_team_id),
        "away_team_id": t(built.context.away_team_id),
        "referee_id": t(built.context.referee_id),
        "phase_id": t(built.context.phase_id),
    }

    with torch.no_grad():
        out = store.model(**tensor_in)
        pmf = scoreline_distribution(
            out.lam_home, out.lam_away, out.lam_corr,
            max_goals=store.model.config.max_goals,
        )

    hw_pmf, dr_pmf, aw_pmf = outcome_probabilities_from_pmf(pmf)
    head_softmax = torch.softmax(out.outcome_logits, dim=-1)
    blended = 0.5 * head_softmax + 0.5 * torch.stack([hw_pmf, dr_pmf, aw_pmf], dim=-1)
    blended = blended / blended.sum(dim=-1, keepdim=True).clamp(min=1e-12)
    calibrated = _calibrated_outcome(blended, store.calibrators)[0]  # (3,)

    lam_home = float(out.lam_home.item())
    lam_away = float(out.lam_away.item())
    total_xg = lam_home + lam_away
    over_1_5 = float(over_under_markets(pmf, threshold=1.5).item())
    over_2_5 = float(over_under_markets(pmf, threshold=2.5).item())
    over_3_5 = float(over_under_markets(pmf, threshold=3.5).item())
    btts = float(btts_probability(pmf).item())

    h_top, a_top, p_top = top_k_scorelines(pmf, k=5)
    top_scores = [
        ScorelinePrediction(
            score=f"{int(h)}-{int(a)}",
            home_goals=int(h),
            away_goals=int(a),
            probability=float(p),
        )
        for h, a, p in zip(h_top[0].tolist(), a_top[0].tolist(), p_top[0].tolist())
    ]

    confidence = 1.0 - float(_entropy(calibrated)) / float(np.log(3))
    confidence = float(np.clip(confidence, 0.0, 1.0))

    # Pull a handful of named features for the `factors` panel.
    feat_by_name = dict(zip(FEATURE_NAMES, built.dense))

    outcome = OutcomeProbabilities(
        home_win=float(calibrated[0]),
        draw=float(calibrated[1]),
        away_win=float(calibrated[2]),
        confidence=confidence,
    )
    goals = GoalsPrediction(
        home_expected_goals=lam_home,
        away_expected_goals=lam_away,
        total_expected_goals=total_xg,
        over_1_5=over_1_5,
        over_2_5=over_2_5,
        over_3_5=over_3_5,
        btts_yes=btts,
    )
    most_likely = top_scores[0]
    factors = PredictionFactors(
        home_elo=feat_by_name["elo_home"],
        away_elo=feat_by_name["elo_away"],
        elo_difference=feat_by_name["elo_diff_signed"],
        home_form_score=min(max(feat_by_name["home_form_5_pts"] / 15.0, 0.0), 1.0),
        away_form_score=min(max(feat_by_name["away_form_5_pts"] / 15.0, 0.0), 1.0),
        home_advantage=0.25,
        h2h_advantage=feat_by_name["h2h_home_advantage"],
        injury_impact=feat_by_name["away_squad_form"] - feat_by_name["home_squad_form"],
        rest_days_diff=int(feat_by_name["rest_diff"]),
        importance_factor=1.0,
    )
    conf_breakdown = ConfidenceBreakdown(
        data_quality=min(1.0, feat_by_name["h2h_matches"] / 10.0 + 0.3),
        model_certainty=confidence,
        historical_accuracy=0.5,
        overall=confidence,
    )

    return MatchPrediction(
        match_id=match_id,
        home_team=home_team_name,
        away_team=away_team_name,
        league=competition_name,
        kickoff_time=kickoff_utc,
        outcome=outcome,
        goals=goals,
        most_likely_score=most_likely,
        alternative_scores=top_scores[1:],
        factors=factors,
        confidence=conf_breakdown,
        home_context=None,
        away_context=None,
        model_version=f"{MODEL_VERSION}-{store.suffix}",
    )


def _entropy(p: np.ndarray) -> float:
    p = np.asarray(p, dtype=np.float64)
    p = np.clip(p, 1e-12, 1.0)
    return float(-(p * np.log(p)).sum())


# ---------- convenience wrappers ----------


def predict_for_fixture(
    home_team_name: str,
    away_team_name: str,
    competition_id: str,
    competition_name: str,
    kickoff_utc: datetime,
    *,
    gender: str = "M",
) -> Optional[MatchPrediction]:
    """High-level entry point: name-based lookup, opens its own warehouse."""
    with open_warehouse() as wh:
        home_id = wh.find_team_id_by_alias(home_team_name, gender)
        away_id = wh.find_team_id_by_alias(away_team_name, gender)
        if home_id is None or away_id is None:
            logger.warning(
                "predict_for_fixture: team not found in warehouse — home=%r (%s) away=%r (%s)",
                home_team_name, "OK" if home_id else "missing",
                away_team_name, "OK" if away_id else "missing",
            )
            return None
        return predict_one(
            warehouse=wh,
            home_team_id=home_id, away_team_id=away_id,
            home_team_name=home_team_name, away_team_name=away_team_name,
            competition_id=competition_id, competition_name=competition_name,
            kickoff_utc=kickoff_utc, gender=gender,
        )
