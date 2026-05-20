"""Loss functions and probability tools for the unified match model.

Three pieces live here:

1. **`focal_loss`** — replaces the naive `class_weight={draw: 1.15}` hack that
   leaves the draw class with recall ≈ 0.005 in the per-league baselines.
   Focal loss multiplies cross-entropy by `(1 - p_t)^γ` so easy positives
   stop dominating the gradient.

2. **`bivariate_poisson_nll`** — log-likelihood of an observed `(home_goals,
   away_goals)` under the bivariate Poisson model of Karlis & Ntzoufras
   (2003). With three learned parameters (λ_home, λ_away, λ_corr) the joint
   PMF is::

      P(X=x, Y=y) = exp(-(λh + λa + λc)) *
                    Σ_{k=0}^{min(x,y)}
                      λh^(x-k)/(x-k)! * λa^(y-k)/(y-k)! * λc^k / k!

   ρ ≈ tanh(λc / sqrt(λh λa)) captures defensive correlation that the
   independent-Poisson model misses (0-0/1-1 are more common than two
   independent Poissons predict). Implemented with `torch.lgamma` for
   numerical stability up to the score cap.

3. **`scoreline_distribution`** — emits the full PMF over a `max_goals+1 ×
   max_goals+1` grid for inference. From this we derive W/D/L probabilities,
   over/under markets, BTTS, and the top-K most-likely scorelines.

All functions operate on a batch dimension; the model trains with
batch_size=512 and inference unrolls one match at a time.
"""

from __future__ import annotations

from typing import Tuple

import torch
import torch.nn.functional as F


def focal_loss(
    logits: torch.Tensor,
    targets: torch.Tensor,
    *,
    gamma: float = 2.0,
    class_weights: torch.Tensor | None = None,
    reduction: str = "mean",
) -> torch.Tensor:
    """Multi-class focal loss.

    Args:
        logits: ``(B, C)`` raw class scores.
        targets: ``(B,)`` integer class indices in ``[0, C)``.
        gamma: focusing parameter; γ=2 is the paper default. Larger values
            push the loss harder onto rare/misclassified examples.
        class_weights: optional ``(C,)`` per-class weights; multiplied
            *after* the focal term so they still bias toward the rare class.
        reduction: one of ``"mean"``, ``"sum"``, ``"none"``.

    Returns:
        Scalar (or ``(B,)`` if reduction='none') loss.
    """
    log_probs = F.log_softmax(logits, dim=-1)               # (B, C)
    log_pt = log_probs.gather(1, targets.unsqueeze(1)).squeeze(1)  # (B,)
    pt = log_pt.exp().clamp(min=1e-7, max=1.0 - 1e-7)
    focal_term = (1.0 - pt).pow(gamma)
    loss = -focal_term * log_pt

    if class_weights is not None:
        loss = loss * class_weights[targets]

    if reduction == "mean":
        return loss.mean()
    if reduction == "sum":
        return loss.sum()
    return loss


def _log_factorial(k: torch.Tensor) -> torch.Tensor:
    """Numerically stable log(k!) via lgamma."""
    return torch.lgamma(k + 1.0)


def bivariate_poisson_log_pmf(
    home_goals: torch.Tensor,
    away_goals: torch.Tensor,
    lam_home: torch.Tensor,
    lam_away: torch.Tensor,
    lam_corr: torch.Tensor,
    *,
    eps: float = 1e-8,
) -> torch.Tensor:
    """Log-PMF P(X=h, Y=a) under bivariate Poisson(λh, λa, λc).

    Reference: Karlis & Ntzoufras (2003), "Analysis of sports data by
    using bivariate Poisson models," Journal of the Royal Statistical
    Society Series D. Used for soccer scoreline modelling because λc
    captures the empirical correlation between home and away goals that
    independent Poissons cannot.

    All tensors share the same batch shape.

    Args:
        home_goals, away_goals: non-negative integer goals (float dtype OK).
        lam_home, lam_away, lam_corr: positive rate parameters.
        eps: floor on rates / pmf for numerical safety.

    Returns:
        Tensor with the same batch shape, in log space.
    """
    lh = lam_home.clamp(min=eps)
    la = lam_away.clamp(min=eps)
    lc = lam_corr.clamp(min=eps)

    log_lh = torch.log(lh)
    log_la = torch.log(la)
    log_lc = torch.log(lc)
    exp_term = -(lh + la + lc)

    # The convolution sum runs k = 0..min(h, a). We compute it explicitly
    # up to a hard cap; for soccer scorelines, k > 10 never matters.
    max_k = int(torch.minimum(home_goals, away_goals).max().item()) if home_goals.numel() else 0
    max_k = max(max_k, 0)

    # log_sum starts at -inf so the log-sum-exp picks up real terms only.
    log_terms = []
    for k in range(max_k + 1):
        kt = torch.full_like(home_goals, k, dtype=torch.float32)
        valid = (kt <= home_goals) & (kt <= away_goals)
        term = (
            (home_goals - kt) * log_lh
            - _log_factorial(home_goals - kt)
            + (away_goals - kt) * log_la
            - _log_factorial(away_goals - kt)
            + kt * log_lc
            - _log_factorial(kt)
        )
        # Mask invalid k by sending term to -inf (no contribution).
        term = torch.where(valid, term, torch.full_like(term, -1e30))
        log_terms.append(term)

    if log_terms:
        stacked = torch.stack(log_terms, dim=0)  # (max_k+1, *batch)
        log_sum = torch.logsumexp(stacked, dim=0)
    else:
        log_sum = torch.zeros_like(home_goals)

    return exp_term + log_sum


def bivariate_poisson_nll(
    home_goals: torch.Tensor,
    away_goals: torch.Tensor,
    lam_home: torch.Tensor,
    lam_away: torch.Tensor,
    lam_corr: torch.Tensor,
    *,
    reduction: str = "mean",
) -> torch.Tensor:
    """Negative log-likelihood loss for bivariate Poisson.

    Pass home and away *actual goals* alongside the network's predicted
    rate parameters. Use as one term in the joint multi-task loss.
    """
    log_pmf = bivariate_poisson_log_pmf(
        home_goals.float(),
        away_goals.float(),
        lam_home, lam_away, lam_corr,
    )
    nll = -log_pmf
    if reduction == "mean":
        return nll.mean()
    if reduction == "sum":
        return nll.sum()
    return nll


def scoreline_distribution(
    lam_home: torch.Tensor,
    lam_away: torch.Tensor,
    lam_corr: torch.Tensor,
    *,
    max_goals: int = 11,
) -> torch.Tensor:
    """Compute the full bivariate-Poisson PMF over a ``(max_goals+1)^2`` grid.

    Args:
        lam_home, lam_away, lam_corr: ``(B,)`` rate parameters.
        max_goals: cap on goals per side. 11 covers >99.9% of mass for
            realistic soccer rates and keeps the grid small.

    Returns:
        ``(B, max_goals+1, max_goals+1)`` probability tensor.
        ``pmf[b, h, a]`` ≈ P(home=h, away=a) for match b.

    Notes:
        The PMF is normalized to sum to 1 in each batch element (any mass
        above ``max_goals`` is folded into the corner cells via the
        truncation — small but non-zero in extreme blowouts). Downstream
        consumers should treat the grid as exact within the cap.
    """
    if lam_home.dim() == 0:
        lam_home = lam_home.unsqueeze(0)
        lam_away = lam_away.unsqueeze(0)
        lam_corr = lam_corr.unsqueeze(0)

    B = lam_home.size(0)
    M = max_goals + 1
    device = lam_home.device

    # Build the (M, M) grid of (h, a) outcomes once.
    h_grid = torch.arange(M, device=device).float().unsqueeze(1).expand(M, M).reshape(-1)  # (M*M,)
    a_grid = torch.arange(M, device=device).float().unsqueeze(0).expand(M, M).reshape(-1)

    # Broadcast: lambdas are (B,1), grid cells are (1, M*M).
    lh = lam_home.unsqueeze(1).expand(B, M * M)
    la = lam_away.unsqueeze(1).expand(B, M * M)
    lc = lam_corr.unsqueeze(1).expand(B, M * M)
    h = h_grid.unsqueeze(0).expand(B, M * M)
    a = a_grid.unsqueeze(0).expand(B, M * M)

    log_pmf = bivariate_poisson_log_pmf(h, a, lh, la, lc)
    pmf = log_pmf.exp()
    pmf = pmf.view(B, M, M)
    # Normalise to compensate for truncation at max_goals.
    pmf = pmf / pmf.sum(dim=(-2, -1), keepdim=True).clamp(min=1e-12)
    return pmf


def outcome_probabilities_from_pmf(pmf: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Sum the scoreline grid into (P(home_win), P(draw), P(away_win)).

    `pmf` is ``(B, M, M)`` where ``pmf[b, h, a]`` = P(home=h, away=a).
    """
    home_win = torch.triu(pmf, diagonal=1).sum(dim=(-2, -1))   # away < home
    draw = pmf.diagonal(dim1=-2, dim2=-1).sum(dim=-1)
    away_win = torch.tril(pmf, diagonal=-1).sum(dim=(-2, -1))  # away > home
    return home_win, draw, away_win


def top_k_scorelines(pmf: torch.Tensor, k: int = 4) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Return the top-K most likely (home_score, away_score) per match.

    Args:
        pmf: ``(B, M, M)`` distribution from ``scoreline_distribution``.

    Returns:
        ``(home_scores, away_scores, probs)`` each shaped ``(B, k)``.
    """
    B, M, _ = pmf.shape
    flat = pmf.reshape(B, M * M)
    top_p, top_idx = flat.topk(k, dim=-1)
    home_scores = (top_idx // M).long()
    away_scores = (top_idx % M).long()
    return home_scores, away_scores, top_p


def over_under_markets(pmf: torch.Tensor, threshold: float = 2.5) -> torch.Tensor:
    """Probability that total goals > `threshold`. Threshold is e.g. 2.5 for Over 2.5."""
    B, M, _ = pmf.shape
    device = pmf.device
    h = torch.arange(M, device=device).float().unsqueeze(1).expand(M, M)
    a = torch.arange(M, device=device).float().unsqueeze(0).expand(M, M)
    mask = (h + a) > threshold
    return (pmf * mask.unsqueeze(0)).sum(dim=(-2, -1))


def btts_probability(pmf: torch.Tensor) -> torch.Tensor:
    """P(Both Teams To Score) = P(home >= 1 AND away >= 1)."""
    return pmf[:, 1:, 1:].sum(dim=(-2, -1))
