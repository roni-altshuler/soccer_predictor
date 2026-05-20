"""Tests for the UnifiedMatchModel.

Covers:
* forward pass produces the documented output shapes
* joint loss returns a finite scalar with all three terms positive
* a single training step decreases the loss on synthetic data
* save/load round-trip preserves outputs
* `predict_distribution` outputs are consistent with the scoreline grid
"""

from __future__ import annotations

import math

import pytest
import torch

from backend.services.prediction.losses import outcome_probabilities_from_pmf
from backend.services.prediction.unified_model import (
    PHASE_VOCAB,
    UnifiedMatchModel,
    UnifiedModelConfig,
    n_parameters,
)


def _make_model(seed: int = 0) -> UnifiedMatchModel:
    torch.manual_seed(seed)
    cfg = UnifiedModelConfig(
        feature_names=[f"f_{i}" for i in range(40)],
        n_leagues=10,
        n_teams=50,
        n_referees=20,
    )
    return UnifiedMatchModel(cfg)


def _synthetic_batch(B: int = 8, dense: int = 40, *, seed: int = 1):
    g = torch.Generator().manual_seed(seed)
    return {
        "dense": torch.randn(B, dense, generator=g),
        "league_id": torch.randint(0, 10, (B,), generator=g),
        "home_team_id": torch.randint(0, 50, (B,), generator=g),
        "away_team_id": torch.randint(0, 50, (B,), generator=g),
        "referee_id": torch.randint(0, 20, (B,), generator=g),
        "phase_id": torch.randint(0, len(PHASE_VOCAB), (B,), generator=g),
    }


def test_model_parameter_count_is_reasonable():
    model = _make_model()
    n = n_parameters(model)
    assert 30_000 < n < 200_000


def test_forward_output_shapes_match_contract():
    model = _make_model().eval()
    batch = _synthetic_batch(B=16)
    with torch.no_grad():
        out = model(**batch)
    assert out.outcome_logits.shape == (16, 3)
    assert out.lam_home.shape == (16,)
    assert out.lam_away.shape == (16,)
    assert out.lam_corr.shape == (16,)
    assert (out.lam_home > 0).all() and (out.lam_away > 0).all()
    assert (out.lam_corr > 0).all() and (out.lam_corr <= model.config.lam_corr_cap).all()


def test_compute_loss_is_finite_with_positive_terms():
    model = _make_model()
    batch = _synthetic_batch(B=32)
    out = model(**batch)
    loss, parts = model.compute_loss(
        out,
        outcome_target=torch.randint(0, 3, (32,)),
        home_goals=torch.randint(0, 5, (32,)),
        away_goals=torch.randint(0, 5, (32,)),
    )
    assert torch.isfinite(loss)
    for name in ("outcome", "bivariate", "xg_mse", "total"):
        assert math.isfinite(parts[name]) and parts[name] >= 0


def test_one_training_step_decreases_loss():
    model = _make_model().train()
    batch = _synthetic_batch(B=32, seed=7)
    target = torch.randint(0, 3, (32,))
    h_goals = torch.randint(0, 4, (32,))
    a_goals = torch.randint(0, 4, (32,))

    opt = torch.optim.AdamW(model.parameters(), lr=3e-3)
    initial = None
    final = None
    for step in range(20):
        opt.zero_grad()
        out = model(**batch)
        loss, parts = model.compute_loss(
            out, outcome_target=target, home_goals=h_goals, away_goals=a_goals,
        )
        loss.backward()
        opt.step()
        if step == 0:
            initial = parts["total"]
        final = parts["total"]
    assert final is not None and initial is not None
    assert final < initial


def test_state_blob_roundtrip_preserves_outputs():
    model = _make_model().eval()
    batch = _synthetic_batch(B=4)
    with torch.no_grad():
        out_a = model(**batch)
    blob = model.state_blob()
    other = UnifiedMatchModel.from_state_blob(blob).eval()
    with torch.no_grad():
        out_b = other(**batch)
    assert torch.allclose(out_a.outcome_logits, out_b.outcome_logits, atol=1e-6)
    assert torch.allclose(out_a.lam_home, out_b.lam_home, atol=1e-6)
    assert torch.allclose(out_a.lam_away, out_b.lam_away, atol=1e-6)
    assert torch.allclose(out_a.lam_corr, out_b.lam_corr, atol=1e-6)


def test_predict_distribution_consistent_with_scoreline_grid():
    """When `outcome_blend=0`, reported outcome must equal the pmf-derived one."""
    model = _make_model().eval()
    batch = _synthetic_batch(B=4)
    dist = model.predict_distribution(**batch, outcome_blend=0.0)
    pmf = dist["scoreline_pmf"]
    hw, dr, aw = outcome_probabilities_from_pmf(pmf)
    expected = torch.stack([hw, dr, aw], dim=-1)
    expected = expected / expected.sum(dim=-1, keepdim=True).clamp(min=1e-12)
    assert torch.allclose(dist["outcome"], expected, atol=1e-5)


def test_predict_distribution_outcome_sums_to_one():
    model = _make_model().eval()
    batch = _synthetic_batch(B=16)
    dist = model.predict_distribution(**batch, outcome_blend=0.5)
    sums = dist["outcome"].sum(dim=-1)
    assert torch.allclose(sums, torch.ones(16), atol=1e-5)
