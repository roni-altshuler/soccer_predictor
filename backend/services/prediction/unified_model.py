"""The unified multi-task match model.

This module defines `UnifiedMatchModel`, the single PyTorch network that
replaces the 14 per-league scikit-learn ensembles. One trained instance
of this class is the entire ML engine for a gender universe (men's,
women's) — there is no further routing.

Architecture (matches `docs` plan section 1.1)
----------------------------------------------

    Inputs:
      - dense_features   ∈ ℝ^D           (~80 engineered features)
      - league_id        ∈ {0..L-1}      → Embedding(L, 16)
      - home_team_id     ∈ {0..T-1}      → shared TeamEmbedding(T, 32)
      - away_team_id     ∈ {0..T-1}      → shared TeamEmbedding(T, 32)
      - referee_id       ∈ {0..R-1}      → Embedding(R, 8)   (R[0] = "unknown")
      - phase_id         ∈ {0..P-1}      → Embedding(P, 4)

    Shared backbone:
      concat(dense, league_emb, home_emb, away_emb, ref_emb, phase_emb)
      → Linear(D + 92, 256) + GELU + Dropout + LayerNorm
      → Linear(256, 128)    + GELU + Dropout + LayerNorm
      → Linear(128, 64)     + GELU
      → shared representation h ∈ ℝ^64

    Three heads:
      outcome_head: Linear(64, 3)                  → softmax(home_win, draw, away_win)
      xg_head:      Linear(64, 2) + softplus       → (lam_home, lam_away)
      rho_head:     Linear(64, 1) + softplus       → lam_corr (positive correlation rate)

`lam_corr` is the correlation *rate* used by the bivariate Poisson model
(see `losses.py`). It is constrained to be small (softplus + clamp) so
the model approaches the independent-Poisson baseline when there's no
signal. The implied correlation coefficient is bounded in (-0.2, 0.2).

The outcome head and the (xg, rho) heads are *both* trained on the same
batch. Their predictions are reconciled at inference time: we use the
xg+rho heads to derive a scoreline grid and re-derive outcome
probabilities from it; the outcome head is calibrated on the resulting
distribution. This gives consistent scoreline + outcome + over/under
probabilities at serving time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn

from backend.services.prediction.losses import (
    bivariate_poisson_nll,
    focal_loss,
    outcome_probabilities_from_pmf,
    scoreline_distribution,
)

# Phase vocabulary used by the warehouse + feature builder. Index 0 is
# always "unknown / regular league fixture" so the model has a safe
# default when a fixture is missing phase metadata.
PHASE_VOCAB: Tuple[str, ...] = (
    "league",            # 0: ordinary league/regular-season match
    "group",             # 1: tournament group stage
    "round_of_16",       # 2
    "quarterfinal",      # 3
    "semifinal",         # 4
    "final",             # 5
    "playoff",           # 6 (MLS playoffs, qualifying rounds)
)
PHASE_TO_IDX: Dict[str, int] = {name: idx for idx, name in enumerate(PHASE_VOCAB)}


@dataclass
class UnifiedModelConfig:
    """Static metadata needed to instantiate / reload the model.

    The training script writes this alongside the weight checkpoint so
    inference can recreate exactly the same `nn.Module` shape. *Don't*
    change `feature_names` ordering after training — feature vector
    indexing is implicit in the forward pass.
    """

    feature_names: List[str]
    n_leagues: int
    n_teams: int
    n_referees: int
    n_phases: int = len(PHASE_VOCAB)

    dense_dim: int = 0  # set in __post_init__
    league_emb_dim: int = 16
    team_emb_dim: int = 32
    referee_emb_dim: int = 8
    phase_emb_dim: int = 4

    hidden_1: int = 256
    hidden_2: int = 128
    hidden_3: int = 64
    dropout: float = 0.2

    max_goals: int = 11  # cap on goals for the scoreline grid
    lam_corr_cap: float = 0.5  # softplus output is clipped to this maximum

    def __post_init__(self) -> None:
        if self.dense_dim == 0:
            self.dense_dim = len(self.feature_names)


class UnifiedMatchModel(nn.Module):
    """Multi-task soccer match model: outcome + bivariate Poisson xG + rho.

    Use `from_config(config)` to construct; the matching `forward` returns
    a `ModelOutputs` dataclass with all three heads' raw outputs. Call
    `predict(...)` for a calibrated inference dict matching the existing
    `MatchPrediction` schema.
    """

    def __init__(self, config: UnifiedModelConfig) -> None:
        super().__init__()
        self.config = config

        # Embedding tables. Idx 0 is reserved as "unknown" for each.
        self.league_emb = nn.Embedding(config.n_leagues, config.league_emb_dim)
        self.team_emb = nn.Embedding(config.n_teams, config.team_emb_dim)
        self.referee_emb = nn.Embedding(config.n_referees, config.referee_emb_dim)
        self.phase_emb = nn.Embedding(config.n_phases, config.phase_emb_dim)

        # Backbone input width = dense + all embedding widths.
        in_dim = (
            config.dense_dim
            + config.league_emb_dim
            + 2 * config.team_emb_dim
            + config.referee_emb_dim
            + config.phase_emb_dim
        )

        self.backbone = nn.Sequential(
            nn.Linear(in_dim, config.hidden_1),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.LayerNorm(config.hidden_1),
            nn.Linear(config.hidden_1, config.hidden_2),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.LayerNorm(config.hidden_2),
            nn.Linear(config.hidden_2, config.hidden_3),
            nn.GELU(),
        )

        # Three task heads share the 64-D representation `h`.
        self.outcome_head = nn.Linear(config.hidden_3, 3)
        # xG head outputs (log lam_home, log lam_away) to keep things in a
        # nice optimization regime; softplus turns them positive.
        self.xg_head = nn.Linear(config.hidden_3, 2)
        # rho head outputs a single positive correlation rate.
        self.rho_head = nn.Linear(config.hidden_3, 1)

        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Embedding):
                nn.init.normal_(m.weight, std=0.01)
        # Bias the xG head so the *initial* prediction is ≈1.3 goals (the
        # league-agnostic average) for both sides. softplus(0.31) ≈ 0.86,
        # softplus(0.95) ≈ 1.27 — start near the latter.
        nn.init.constant_(self.xg_head.bias, 0.95)
        # rho head starts ≈ 0.1, matching observed defensive correlation.
        nn.init.constant_(self.rho_head.bias, -2.2)

    # ---- forward / training ----

    @dataclass
    class Outputs:
        outcome_logits: torch.Tensor   # (B, 3) raw logits — softmax in loss/inference
        lam_home: torch.Tensor         # (B,) positive
        lam_away: torch.Tensor         # (B,) positive
        lam_corr: torch.Tensor         # (B,) positive, small

    def forward(
        self,
        *,
        dense: torch.Tensor,
        league_id: torch.Tensor,
        home_team_id: torch.Tensor,
        away_team_id: torch.Tensor,
        referee_id: torch.Tensor,
        phase_id: torch.Tensor,
    ) -> "UnifiedMatchModel.Outputs":
        league_e = self.league_emb(league_id)
        home_e = self.team_emb(home_team_id)
        away_e = self.team_emb(away_team_id)
        ref_e = self.referee_emb(referee_id)
        phase_e = self.phase_emb(phase_id)

        x = torch.cat([dense, league_e, home_e, away_e, ref_e, phase_e], dim=-1)
        h = self.backbone(x)

        outcome_logits = self.outcome_head(h)
        xg_raw = self.xg_head(h)
        lam_home = nn.functional.softplus(xg_raw[..., 0])
        lam_away = nn.functional.softplus(xg_raw[..., 1])
        lam_corr = nn.functional.softplus(self.rho_head(h).squeeze(-1)).clamp(
            min=1e-4, max=self.config.lam_corr_cap
        )
        return UnifiedMatchModel.Outputs(
            outcome_logits=outcome_logits,
            lam_home=lam_home,
            lam_away=lam_away,
            lam_corr=lam_corr,
        )

    # ---- joint loss ----

    def compute_loss(
        self,
        outputs: "UnifiedMatchModel.Outputs",
        *,
        outcome_target: torch.Tensor,    # (B,) int in {0=home_win, 1=draw, 2=away_win}
        home_goals: torch.Tensor,        # (B,) int
        away_goals: torch.Tensor,        # (B,) int
        outcome_weight: float = 1.0,
        bivariate_weight: float = 0.5,
        xg_mse_weight: float = 0.25,
        focal_gamma: float = 2.0,
        class_weights: Optional[torch.Tensor] = None,
    ) -> Tuple[torch.Tensor, Dict[str, float]]:
        """Combine focal outcome loss + bivariate Poisson NLL + MSE anchor."""
        outcome_loss = focal_loss(
            outputs.outcome_logits, outcome_target,
            gamma=focal_gamma, class_weights=class_weights,
        )
        biv_loss = bivariate_poisson_nll(
            home_goals.float(), away_goals.float(),
            outputs.lam_home, outputs.lam_away, outputs.lam_corr,
        )
        mse_loss = (
            (outputs.lam_home - home_goals.float()) ** 2
            + (outputs.lam_away - away_goals.float()) ** 2
        ).mean()

        total = (
            outcome_weight * outcome_loss
            + bivariate_weight * biv_loss
            + xg_mse_weight * mse_loss
        )
        return total, {
            "outcome": float(outcome_loss.item()),
            "bivariate": float(biv_loss.item()),
            "xg_mse": float(mse_loss.item()),
            "total": float(total.item()),
        }

    # ---- inference helpers ----

    @torch.no_grad()
    def predict_distribution(
        self,
        *,
        dense: torch.Tensor,
        league_id: torch.Tensor,
        home_team_id: torch.Tensor,
        away_team_id: torch.Tensor,
        referee_id: torch.Tensor,
        phase_id: torch.Tensor,
        outcome_blend: float = 0.5,
    ) -> Dict[str, torch.Tensor]:
        """Run inference and return the canonical distribution dict.

        ``outcome_blend`` mixes the outcome head's softmax with the
        scoreline-derived probabilities to produce the final reported
        outcome. With blend=0 the outcome is fully derived from the
        bivariate-Poisson grid (most consistent with the scoreline
        distribution); with blend=1 it's the outcome head verbatim
        (sharpest but can disagree with the scoreline). The training
        script calibrates this blend on the validation set.
        """
        self.eval()
        out = self.forward(
            dense=dense, league_id=league_id,
            home_team_id=home_team_id, away_team_id=away_team_id,
            referee_id=referee_id, phase_id=phase_id,
        )

        pmf = scoreline_distribution(
            out.lam_home, out.lam_away, out.lam_corr,
            max_goals=self.config.max_goals,
        )
        hw_pmf, dr_pmf, aw_pmf = outcome_probabilities_from_pmf(pmf)
        outcome_pmf = torch.stack([hw_pmf, dr_pmf, aw_pmf], dim=-1)
        outcome_head = torch.softmax(out.outcome_logits, dim=-1)

        outcome = outcome_blend * outcome_head + (1.0 - outcome_blend) * outcome_pmf
        # Re-normalize after the blend in case numerics drift.
        outcome = outcome / outcome.sum(dim=-1, keepdim=True).clamp(min=1e-12)

        return {
            "scoreline_pmf": pmf,                # (B, M, M)
            "outcome": outcome,                  # (B, 3) blended
            "outcome_from_head": outcome_head,   # (B, 3) raw head softmax
            "outcome_from_pmf": outcome_pmf,     # (B, 3) marginalised from grid
            "lam_home": out.lam_home,            # (B,) home xG
            "lam_away": out.lam_away,            # (B,) away xG
            "lam_corr": out.lam_corr,            # (B,) bivariate-Poisson rate
        }

    # ---- persistence ----

    def state_blob(self) -> Dict:
        """Return everything needed to reload the model."""
        return {
            "state_dict": self.state_dict(),
            "config": {
                "feature_names": self.config.feature_names,
                "n_leagues": self.config.n_leagues,
                "n_teams": self.config.n_teams,
                "n_referees": self.config.n_referees,
                "n_phases": self.config.n_phases,
                "dense_dim": self.config.dense_dim,
                "league_emb_dim": self.config.league_emb_dim,
                "team_emb_dim": self.config.team_emb_dim,
                "referee_emb_dim": self.config.referee_emb_dim,
                "phase_emb_dim": self.config.phase_emb_dim,
                "hidden_1": self.config.hidden_1,
                "hidden_2": self.config.hidden_2,
                "hidden_3": self.config.hidden_3,
                "dropout": self.config.dropout,
                "max_goals": self.config.max_goals,
                "lam_corr_cap": self.config.lam_corr_cap,
            },
        }

    @classmethod
    def from_state_blob(cls, blob: Dict) -> "UnifiedMatchModel":
        config = UnifiedModelConfig(**blob["config"])
        model = cls(config)
        model.load_state_dict(blob["state_dict"])
        model.eval()
        return model


def n_parameters(model: UnifiedMatchModel) -> int:
    """Quick sanity check: how big is this thing?"""
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
