"""Tests for the loss functions and probability tooling.

These are the math contracts the rest of the pipeline depends on:
* focal_loss collapses to cross-entropy when γ=0
* bivariate Poisson NLL is finite and gradients flow
* scoreline PMF sums to 1 and matches independent-Poisson when ρ=0
* W/D/L derivation from the PMF sums to 1
* Over/Under and BTTS markets are in [0,1]
"""

from __future__ import annotations

import math

import pytest
import torch
import torch.nn.functional as F

from backend.services.prediction.losses import (
    btts_probability,
    bivariate_poisson_log_pmf,
    bivariate_poisson_nll,
    focal_loss,
    outcome_probabilities_from_pmf,
    over_under_markets,
    scoreline_distribution,
    top_k_scorelines,
)


def test_focal_loss_equals_cross_entropy_when_gamma_zero():
    logits = torch.tensor([[1.0, 2.0, 0.5], [0.1, 3.0, 0.0], [0.0, 0.0, 1.0]])
    targets = torch.tensor([1, 0, 2])
    fl = focal_loss(logits, targets, gamma=0.0)
    ce = F.cross_entropy(logits, targets)
    assert torch.allclose(fl, ce, atol=1e-5)


def test_focal_loss_downweights_confident_examples():
    logits = torch.tensor([[1.0, 2.0, 0.5], [0.1, 3.0, 0.0]])
    targets = torch.tensor([1, 1])  # both target the same easy class
    fl = focal_loss(logits, targets, gamma=2.0)
    ce = F.cross_entropy(logits, targets)
    assert fl < ce


def test_focal_loss_applies_class_weights():
    logits = torch.tensor([[1.0, 2.0, 0.5]])
    targets = torch.tensor([1])
    weighted = focal_loss(logits, targets, gamma=2.0, class_weights=torch.tensor([1.0, 5.0, 1.0]))
    base = focal_loss(logits, targets, gamma=2.0)
    assert torch.allclose(weighted, 5 * base, atol=1e-5)


def test_bivariate_poisson_nll_is_finite_and_differentiable():
    home = torch.tensor([2.0, 1.0, 0.0, 4.0])
    away = torch.tensor([1.0, 1.0, 0.0, 2.0])
    lh = torch.tensor([1.5, 1.0, 0.5, 2.5], requires_grad=True)
    la = torch.tensor([1.0, 1.2, 0.6, 1.5], requires_grad=True)
    lc = torch.tensor([0.2, 0.1, 0.05, 0.3], requires_grad=True)
    loss = bivariate_poisson_nll(home, away, lh, la, lc)
    assert torch.isfinite(loss)
    loss.backward()
    assert torch.isfinite(lh.grad).all()
    assert torch.isfinite(la.grad).all()
    assert torch.isfinite(lc.grad).all()


def test_scoreline_distribution_sums_to_one():
    lh = torch.tensor([1.4, 0.8, 2.5])
    la = torch.tensor([1.0, 1.3, 1.2])
    lc = torch.tensor([0.2, 0.1, 0.4])
    pmf = scoreline_distribution(lh, la, lc, max_goals=11)
    sums = pmf.sum(dim=(-2, -1))
    assert torch.allclose(sums, torch.ones(3), atol=1e-4)


def test_outcome_probabilities_sum_to_one():
    lh = torch.tensor([1.4, 0.8, 2.5])
    la = torch.tensor([1.0, 1.3, 1.2])
    lc = torch.tensor([0.2, 0.1, 0.4])
    pmf = scoreline_distribution(lh, la, lc)
    hw, dr, aw = outcome_probabilities_from_pmf(pmf)
    total = hw + dr + aw
    assert torch.allclose(total, torch.ones(3), atol=1e-4)


def test_outcome_probabilities_correctly_assign_home_and_away():
    """Regression test: ``home_win`` must be probability mass where home > away.

    The bug we caught: torch.triu(pmf, diagonal=1) gathers cells where
    column-index > row-index, i.e. away > home — that's away_win, not
    home_win. This test pins the correct mapping so it can't regress.
    """
    # Build a one-batch hand-crafted PMF where mass lives on three cells only:
    #   pmf[2, 0] = 0.6  (home 2, away 0 → home_win)
    #   pmf[1, 1] = 0.2  (home 1, away 1 → draw)
    #   pmf[0, 2] = 0.2  (home 0, away 2 → away_win)
    M = 3
    pmf = torch.zeros(1, M, M)
    pmf[0, 2, 0] = 0.6
    pmf[0, 1, 1] = 0.2
    pmf[0, 0, 2] = 0.2
    hw, dr, aw = outcome_probabilities_from_pmf(pmf)
    assert torch.allclose(hw, torch.tensor([0.6]))
    assert torch.allclose(dr, torch.tensor([0.2]))
    assert torch.allclose(aw, torch.tensor([0.2]))


def test_outcome_consistent_with_xg_dominance():
    """Sanity: when home xG strongly dominates away xG, home_win > away_win."""
    lh = torch.tensor([3.0])  # high home xG
    la = torch.tensor([0.5])  # low away xG
    lc = torch.tensor([0.1])
    pmf = scoreline_distribution(lh, la, lc)
    hw, dr, aw = outcome_probabilities_from_pmf(pmf)
    assert float(hw) > float(aw)
    assert float(hw) > float(dr)


def test_top_k_scorelines_returns_descending_probabilities():
    lh = torch.tensor([1.4])
    la = torch.tensor([1.0])
    lc = torch.tensor([0.2])
    pmf = scoreline_distribution(lh, la, lc)
    h, a, p = top_k_scorelines(pmf, k=5)
    assert h.shape == (1, 5)
    # Each successive probability is no greater than the prior.
    assert (p[:, :-1] >= p[:, 1:]).all()
    # Top 5 must collectively account for a non-trivial fraction of mass.
    assert float(p.sum()) > 0.3


def test_over_under_and_btts_are_valid_probabilities():
    lh = torch.tensor([1.4])
    la = torch.tensor([1.0])
    lc = torch.tensor([0.2])
    pmf = scoreline_distribution(lh, la, lc)
    over_25 = over_under_markets(pmf, threshold=2.5)
    under_15 = 1.0 - over_under_markets(pmf, threshold=1.5)
    btts = btts_probability(pmf)
    assert 0.0 <= float(over_25) <= 1.0
    assert 0.0 <= float(under_15) <= 1.0
    assert 0.0 <= float(btts) <= 1.0
    # Sanity: over 2.5 should be smaller than over 1.5 (more goals → less likely).
    assert float(over_25) <= float(1.0 - under_15) + 1e-6


def test_bivariate_log_pmf_matches_independent_poisson_when_lc_tiny():
    """When the bivariate correlation term goes to zero, the joint PMF should
    factor into the product of two independent Poisson PMFs."""
    home = torch.tensor([2.0])
    away = torch.tensor([1.0])
    lh = torch.tensor([1.5])
    la = torch.tensor([1.0])
    lc = torch.tensor([1e-6])  # effectively zero
    log_pmf_biv = bivariate_poisson_log_pmf(home, away, lh, la, lc)
    # Independent log-PMF: log P(X=h) + log P(Y=a) for Poisson(λh), Poisson(λa).
    log_indep_h = home * lh.log() - lh - math.lgamma(home.item() + 1)
    log_indep_a = away * la.log() - la - math.lgamma(away.item() + 1)
    log_indep = log_indep_h + log_indep_a
    assert torch.allclose(log_pmf_biv, log_indep, atol=1e-4)
