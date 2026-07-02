"""Per-prediction feature attribution for the unified model.

Answers "why this prediction" with real numbers instead of hand-picked
factors, using two complementary techniques:

* **Integrated gradients** (Sundararajan et al., 2017) over the ~80
  dense features: interpolate the scaled input from the training-mean
  baseline (all-zeros after StandardScaler) to the actual input and
  accumulate gradients of the predicted class's logit. Contributions
  satisfy the completeness axiom: they sum to
  ``logit(x) - logit(baseline)`` for the dense pathway.

* **Embedding occlusion** for the categorical identities (league, home
  team, away team, referee, phase): the contribution of e.g. the home
  team's identity is the change in the predicted-class logit when that
  embedding is swapped to the reserved "unknown" index 0.

Contributions are in logit units for the served pick — positive pushes
toward the pick, negative pushes against it. SHAP was considered and
rejected: the multi-input embedding model doesn't fit its Deep/Kernel
explainers cleanly and the dependency is heavy; IG is ~40 lines of
plain PyTorch and exactly fits this architecture.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence

import torch

from backend.services.prediction.unified_model import UnifiedMatchModel

# Grouped categorical identities surfaced alongside dense features.
EMBEDDING_GROUPS = (
    ("league_id", "league_context"),
    ("home_team_id", "home_team_identity"),
    ("away_team_id", "away_team_identity"),
    ("referee_id", "referee_profile"),
    ("phase_id", "competition_phase"),
)


def _target_logit(model: UnifiedMatchModel, tensor_in: Dict[str, torch.Tensor], target_class: int) -> torch.Tensor:
    out = model(
        dense=tensor_in["dense"], league_id=tensor_in["league_id"],
        home_team_id=tensor_in["home_team_id"], away_team_id=tensor_in["away_team_id"],
        referee_id=tensor_in["referee_id"], phase_id=tensor_in["phase_id"],
    )
    return out.outcome_logits[:, target_class]


def explain_prediction(
    model: UnifiedMatchModel,
    tensor_in: Dict[str, torch.Tensor],
    *,
    raw_dense: Sequence[float],
    feature_names: Sequence[str],
    target_class: Optional[int] = None,
    steps: int = 32,
) -> List[Dict[str, float]]:
    """Attribute one prediction to its inputs.

    Args:
        tensor_in: the exact batch-of-1 tensor dict `predict_one` forwards
            (``dense`` already scaled).
        raw_dense: unscaled feature values, for display alongside each name.
        target_class: outcome class to explain (0/1/2). Defaults to the
            model head's argmax — the served pick.
        steps: integration steps; 32 is plenty for an MLP this size.

    Returns:
        ``[{"feature", "value", "contribution"}]`` sorted by
        ``|contribution|`` descending, dense features first computed via
        integrated gradients, then the grouped categorical identities.
    """
    model.eval()
    dense = tensor_in["dense"].detach()

    with torch.no_grad():
        if target_class is None:
            out = model(
                dense=dense, league_id=tensor_in["league_id"],
                home_team_id=tensor_in["home_team_id"], away_team_id=tensor_in["away_team_id"],
                referee_id=tensor_in["referee_id"], phase_id=tensor_in["phase_id"],
            )
            target_class = int(out.outcome_logits.argmax(dim=-1).item())

    # ---- integrated gradients over the dense features ----
    baseline = torch.zeros_like(dense)  # train mean, post-StandardScaler
    # Midpoint-rule interpolation path: baseline → input in `steps` slices.
    alphas = (torch.arange(steps, dtype=dense.dtype) + 0.5) / steps
    interpolated = baseline + alphas.view(-1, 1) * (dense - baseline)  # (steps, D)
    interpolated.requires_grad_(True)

    expand = lambda t: t.expand(steps)
    logit = _target_logit(
        model,
        {
            "dense": interpolated,
            "league_id": expand(tensor_in["league_id"]),
            "home_team_id": expand(tensor_in["home_team_id"]),
            "away_team_id": expand(tensor_in["away_team_id"]),
            "referee_id": expand(tensor_in["referee_id"]),
            "phase_id": expand(tensor_in["phase_id"]),
        },
        target_class,
    )
    grads = torch.autograd.grad(logit.sum(), interpolated)[0]  # (steps, D)
    ig = (grads.mean(dim=0) * (dense - baseline)[0]).detach()  # (D,)

    items: List[Dict[str, float]] = [
        {
            "feature": name,
            "value": float(raw),
            "contribution": float(contrib),
        }
        for name, raw, contrib in zip(feature_names, raw_dense, ig.tolist())
    ]

    # ---- embedding occlusion for categorical identities ----
    with torch.no_grad():
        actual_logit = float(_target_logit(model, tensor_in, target_class).item())
        for key, label in EMBEDDING_GROUPS:
            if int(tensor_in[key].item()) == 0:
                continue  # already the unknown bucket — nothing to occlude
            occluded = dict(tensor_in)
            occluded[key] = torch.zeros_like(tensor_in[key])
            occluded_logit = float(_target_logit(model, occluded, target_class).item())
            items.append(
                {
                    "feature": label,
                    "value": float(tensor_in[key].item()),
                    "contribution": actual_logit - occluded_logit,
                }
            )

    items.sort(key=lambda d: abs(d["contribution"]), reverse=True)
    return items


def ig_completeness_gap(
    model: UnifiedMatchModel,
    tensor_in: Dict[str, torch.Tensor],
    dense_contributions: Sequence[float],
    target_class: int,
) -> float:
    """Return |Σ IG − (logit(x) − logit(dense-baseline))| — test helper for
    the completeness axiom on the dense pathway."""
    with torch.no_grad():
        actual = float(_target_logit(model, tensor_in, target_class).item())
        at_baseline = dict(tensor_in)
        at_baseline["dense"] = torch.zeros_like(tensor_in["dense"])
        base = float(_target_logit(model, at_baseline, target_class).item())
    return abs(sum(dense_contributions) - (actual - base))


__all__ = ["EMBEDDING_GROUPS", "explain_prediction", "ig_completeness_gap"]
