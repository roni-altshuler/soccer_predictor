"""Tests for integrated-gradients attribution on the unified model."""

from __future__ import annotations

import pytest
import torch

from backend.services.prediction.attribution import (
    EMBEDDING_GROUPS,
    explain_prediction,
    ig_completeness_gap,
)
from backend.services.prediction.unified_model import (
    UnifiedMatchModel,
    UnifiedModelConfig,
)

FEATURES = [f"f{i}" for i in range(12)]


@pytest.fixture()
def model() -> UnifiedMatchModel:
    torch.manual_seed(3)
    config = UnifiedModelConfig(
        feature_names=list(FEATURES),
        n_leagues=4,
        n_teams=10,
        n_referees=3,
    )
    m = UnifiedMatchModel(config)
    m.eval()
    return m


@pytest.fixture()
def tensor_in() -> dict:
    torch.manual_seed(5)
    return {
        "dense": torch.randn(1, len(FEATURES)),
        "league_id": torch.tensor([2], dtype=torch.long),
        "home_team_id": torch.tensor([4], dtype=torch.long),
        "away_team_id": torch.tensor([7], dtype=torch.long),
        "referee_id": torch.tensor([1], dtype=torch.long),
        "phase_id": torch.tensor([0], dtype=torch.long),
    }


def _dense_items(items):
    group_labels = {label for _, label in EMBEDDING_GROUPS}
    return [it for it in items if it["feature"] not in group_labels]


def test_returns_all_features_sorted(model, tensor_in):
    raw = list(range(len(FEATURES)))
    items = explain_prediction(model, tensor_in, raw_dense=raw, feature_names=FEATURES)
    dense = _dense_items(items)
    assert {it["feature"] for it in dense} == set(FEATURES)
    mags = [abs(it["contribution"]) for it in items]
    assert mags == sorted(mags, reverse=True)
    # Raw display values round-trip untouched.
    by_name = {it["feature"]: it["value"] for it in dense}
    assert by_name["f3"] == 3.0


def test_completeness_axiom(model, tensor_in):
    """Dense IG contributions must sum to logit(x) − logit(dense baseline)."""
    with torch.no_grad():
        out = model(**tensor_in)
        target = int(out.outcome_logits.argmax(dim=-1).item())
    items = explain_prediction(
        model, tensor_in,
        raw_dense=[0.0] * len(FEATURES), feature_names=FEATURES,
        target_class=target, steps=256,
    )
    contributions = [it["contribution"] for it in _dense_items(items)]
    gap = ig_completeness_gap(model, tensor_in, contributions, target)
    assert gap < 0.02, f"completeness gap too large: {gap}"


def test_deterministic(model, tensor_in):
    raw = [0.0] * len(FEATURES)
    a = explain_prediction(model, tensor_in, raw_dense=raw, feature_names=FEATURES)
    b = explain_prediction(model, tensor_in, raw_dense=raw, feature_names=FEATURES)
    assert a == b


def test_embedding_groups_present(model, tensor_in):
    items = explain_prediction(
        model, tensor_in, raw_dense=[0.0] * len(FEATURES), feature_names=FEATURES
    )
    labels = {it["feature"] for it in items}
    # All non-zero categorical ids get an occlusion entry; phase_id is 0
    # (the unknown/league bucket), so it is skipped by design.
    assert "league_context" in labels
    assert "home_team_identity" in labels
    assert "away_team_identity" in labels
    assert "referee_profile" in labels
    assert "competition_phase" not in labels


def test_unknown_ids_skipped(model):
    tensor_in = {
        "dense": torch.zeros(1, len(FEATURES)),
        "league_id": torch.tensor([0], dtype=torch.long),
        "home_team_id": torch.tensor([0], dtype=torch.long),
        "away_team_id": torch.tensor([0], dtype=torch.long),
        "referee_id": torch.tensor([0], dtype=torch.long),
        "phase_id": torch.tensor([0], dtype=torch.long),
    }
    items = explain_prediction(
        model, tensor_in, raw_dense=[0.0] * len(FEATURES), feature_names=FEATURES
    )
    group_labels = {label for _, label in EMBEDDING_GROUPS}
    assert not group_labels & {it["feature"] for it in items}


def test_model_weights_unchanged(model, tensor_in):
    before = {k: v.clone() for k, v in model.state_dict().items()}
    explain_prediction(
        model, tensor_in, raw_dense=[0.0] * len(FEATURES), feature_names=FEATURES
    )
    after = model.state_dict()
    for k in before:
        assert torch.equal(before[k], after[k])
