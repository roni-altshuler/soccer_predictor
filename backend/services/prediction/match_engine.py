"""Match Engine v0 — a minute-conditioned, DC-nested goal intensity process.

VISION_2030's first world-model verb: instead of predicting a final-score
distribution directly, model the match as a discrete-time process over 90
regulation minute bins (added/extra time folds into the 45'/90' bins). At
minute ``t`` each side scores with per-minute intensity

    ν_home(t) = λ_DC(home, away) · f_θ(state_t) / 90
    ν_away(t) = μ_DC(home, away) · g_θ(state_t) / 90

DC-NESTED (the load-bearing de-risker): λ_DC/μ_DC come from the committed
Dixon-Coles machinery (``dixon_coles.py``), and f, g are one shared residual
network whose output multiplier is ``exp(net(state))`` with the final layer
initialised to zero — so a freshly initialised engine has f = g = 1 and the
forward DP reproduces Dixon-Coles' score distribution EXACTLY (unit-tested to
1e-6). Team identity enters ONLY through λ_DC/μ_DC; the residual net sees just
match state, which keeps it small (~21k params) and honest.

State features (per minute, per side): 5-minute minute bucket (18), an
added-time-folded flag (minute 45/90 bins), side-relative score difference
(clipped ±3, one-hot), side-relative red-card difference (clipped ±2,
one-hot), home flag, gender flag. 33 inputs total.

Training (see ``backend/scripts/train_match_engine.py``) is teacher-forced
Bernoulli likelihood over all (minute, side) cells: the observed label is
"side scored in this minute bin" and P(y=1) = 1 - exp(-ν) — the standard
discrete-hazard link, which keeps training consistent with the Poisson-thinned
DP below.

Inference is an EXACT forward dynamic program over the score lattice
(0..10 home goals × 0..10 away goals) × 90 minutes: per minute, each cell
(h, a) emits Poisson(ν_home)/Poisson(ν_away) goal increments (state-dependent,
because score difference h-a is known per cell), mass that would leave the
lattice is dropped, and the final matrix is tau-corrected (the DC low-score
dependence term, a no-op wherever those cells are unreachable) and
renormalised. With f = g = 1 the sum of 90 independent Poisson(λ/90)
increments is exactly Poisson(λ), which is why the nesting is exact rather
than approximate (a Bernoulli-transition DP could never match a Poisson
marginal to 1e-6).

``rollout_from_state`` runs the same kernel from an arbitrary
(minute, score, red cards) state — the live/counterfactual seed. Red cards in
v0 are an *observed covariate*: the DP holds red_diff fixed at its seed value
(kickoff value 0 for pre-match predictions) rather than modelling sendings-off
as a process. Documented limitation, revisit in v1.

Pure module discipline (mirrors ``dixon_coles.py``): no globals, no
singletons, no I/O. Everything needed is passed in; everything produced is
returned.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import numpy as np
import torch
from torch import nn

N_MINUTES = 90
MAX_GOALS = 10          # score lattice is 0..MAX_GOALS per side
MAX_INCREMENT = 6       # per-minute Poisson increments 0..MAX_INCREMENT
SCORE_DIFF_CLIP = 3     # side-relative score diff one-hot covers -3..+3
RED_DIFF_CLIP = 2       # side-relative red diff one-hot covers -2..+2
LOG_MULT_CLAMP = 3.0    # residual multiplier bounded to [e^-3, e^3]

_N_MINUTE_BUCKETS = N_MINUTES // 5          # 18 five-minute buckets
_N_SCORE_DIFF = 2 * SCORE_DIFF_CLIP + 1     # 7
_N_RED_DIFF = 2 * RED_DIFF_CLIP + 1         # 5
# minute buckets + added-time flag + score diff + red diff + home + gender
N_FEATURES = _N_MINUTE_BUCKETS + 1 + _N_SCORE_DIFF + _N_RED_DIFF + 1 + 1  # 33

DEFAULT_HIDDEN = 128


# ---------------------------------------------------------------------------
# Residual network (shared f/g; the side is a feature)
# ---------------------------------------------------------------------------
class ResidualNet(nn.Module):
    """MLP producing log-multiplier r(state); intensity multiplier = exp(r).

    The final layer's weights AND bias are zero-initialised, so a fresh
    network outputs r = 0 → multiplier = 1 → the engine IS Dixon-Coles.
    """

    def __init__(self, hidden: int = DEFAULT_HIDDEN) -> None:
        super().__init__()
        self.hidden = hidden
        self.net = nn.Sequential(
            nn.Linear(N_FEATURES, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )
        last = self.net[-1]
        nn.init.zeros_(last.weight)
        nn.init.zeros_(last.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        r = self.net(x).squeeze(-1)
        return torch.clamp(r, -LOG_MULT_CLAMP, LOG_MULT_CLAMP)

    def n_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters())


# ---------------------------------------------------------------------------
# Feature construction (pure numpy; shared by training and inference)
# ---------------------------------------------------------------------------
def minute_bucket_index(minute_bin: np.ndarray) -> np.ndarray:
    """5-minute bucket index for 0-based minute bins (0..89 -> 0..17)."""
    return np.clip(minute_bin, 0, N_MINUTES - 1) // 5


def build_feature_array(
    minute_bin: np.ndarray,
    score_diff: np.ndarray,
    red_diff: np.ndarray,
    is_home: np.ndarray,
    gender_f: np.ndarray,
) -> np.ndarray:
    """Feature matrix [n, N_FEATURES] float32 for n (minute, side) cells.

    Args are broadcast-compatible int/float arrays:
      minute_bin: 0-based minute bin (0..89)
      score_diff: own goals minus opponent goals BEFORE this minute
      red_diff:   own red cards minus opponent red cards BEFORE this minute
      is_home:    1.0 for the home side's hazard, 0.0 for away
      gender_f:   1.0 for women's competitions, 0.0 for men's
    """
    minute_bin = np.asarray(minute_bin, dtype=np.int64)
    n = minute_bin.shape[0]
    out = np.zeros((n, N_FEATURES), dtype=np.float32)
    rows = np.arange(n)

    col = 0
    out[rows, col + minute_bucket_index(minute_bin)] = 1.0
    col += _N_MINUTE_BUCKETS

    # Added-time-folded bins: minute 45 (bin 44) and minute 90 (bin 89).
    fold = (minute_bin == 44) | (minute_bin == N_MINUTES - 1)
    out[:, col] = fold.astype(np.float32)
    col += 1

    sd = np.clip(np.asarray(score_diff, dtype=np.int64), -SCORE_DIFF_CLIP, SCORE_DIFF_CLIP)
    out[rows, col + sd + SCORE_DIFF_CLIP] = 1.0
    col += _N_SCORE_DIFF

    rd = np.clip(np.asarray(red_diff, dtype=np.int64), -RED_DIFF_CLIP, RED_DIFF_CLIP)
    out[rows, col + rd + RED_DIFF_CLIP] = 1.0
    col += _N_RED_DIFF

    out[:, col] = np.asarray(is_home, dtype=np.float32)
    out[:, col + 1] = np.asarray(gender_f, dtype=np.float32)
    return out


def build_match_cell_features(
    goal_home: np.ndarray,
    goal_away: np.ndarray,
    red_home: np.ndarray,
    red_away: np.ndarray,
    gender_f: float,
) -> Tuple[np.ndarray, np.ndarray]:
    """Teacher-forced training cells for ONE match.

    Inputs are per-minute count grids [90] (uint8). Returns
    (features [180, N_FEATURES], labels [180]) — home cells first, then away.
    State at minute t uses counts STRICTLY BEFORE t (no peeking at the cell's
    own outcome).
    """
    gh = goal_home.astype(np.int64)
    ga = goal_away.astype(np.int64)
    rh = red_home.astype(np.int64)
    ra = red_away.astype(np.int64)
    # Cumulative counts strictly before each minute bin.
    cum_gh = np.concatenate(([0], np.cumsum(gh)[:-1]))
    cum_ga = np.concatenate(([0], np.cumsum(ga)[:-1]))
    cum_rh = np.concatenate(([0], np.cumsum(rh)[:-1]))
    cum_ra = np.concatenate(([0], np.cumsum(ra)[:-1]))
    minutes = np.arange(N_MINUTES, dtype=np.int64)

    feats_home = build_feature_array(
        minutes, cum_gh - cum_ga, cum_rh - cum_ra,
        np.ones(N_MINUTES), np.full(N_MINUTES, gender_f),
    )
    feats_away = build_feature_array(
        minutes, cum_ga - cum_gh, cum_ra - cum_rh,
        np.zeros(N_MINUTES), np.full(N_MINUTES, gender_f),
    )
    labels = np.concatenate([(gh > 0), (ga > 0)]).astype(np.float32)
    return np.concatenate([feats_home, feats_away]), labels


def batch_cell_features(
    goal_home: np.ndarray,
    goal_away: np.ndarray,
    red_home: np.ndarray,
    red_away: np.ndarray,
    gender_f: np.ndarray,
    lam_dc: np.ndarray,
    mu_dc: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vectorised teacher-forced cells for a BATCH of matches.

    Inputs: count grids [B, 90] and per-match gender/λ_DC/μ_DC [B].
    Returns (features [B*180, N_FEATURES], labels [B*180],
    base_rates [B*180]) with all home cells first, then all away cells.
    ``base_rates`` is λ_DC/90 for home cells and μ_DC/90 for away cells.
    """
    b = goal_home.shape[0]
    gh = goal_home.astype(np.int64)
    ga = goal_away.astype(np.int64)
    rh = red_home.astype(np.int64)
    ra = red_away.astype(np.int64)

    def cum_before(x: np.ndarray) -> np.ndarray:
        c = np.cumsum(x, axis=1)
        return np.concatenate([np.zeros((b, 1), dtype=np.int64), c[:, :-1]], axis=1)

    d_goals = cum_before(gh) - cum_before(ga)  # home-perspective, [B, 90]
    d_reds = cum_before(rh) - cum_before(ra)
    minutes = np.broadcast_to(np.arange(N_MINUTES, dtype=np.int64), (b, N_MINUTES))
    gender_cells = np.repeat(gender_f.astype(np.float32), N_MINUTES)

    feats_home = build_feature_array(
        minutes.ravel(), d_goals.ravel(), d_reds.ravel(),
        np.ones(b * N_MINUTES, dtype=np.float32), gender_cells,
    )
    feats_away = build_feature_array(
        minutes.ravel(), (-d_goals).ravel(), (-d_reds).ravel(),
        np.zeros(b * N_MINUTES, dtype=np.float32), gender_cells,
    )
    labels = np.concatenate(
        [(gh > 0).ravel(), (ga > 0).ravel()]
    ).astype(np.float32)
    base = np.concatenate(
        [
            np.repeat(lam_dc.astype(np.float64), N_MINUTES),
            np.repeat(mu_dc.astype(np.float64), N_MINUTES),
        ]
    ) / N_MINUTES
    return np.concatenate([feats_home, feats_away]), labels, base.astype(np.float32)


def hazard_nll(
    log_mult: torch.Tensor,
    base_rate: torch.Tensor,
    labels: torch.Tensor,
) -> torch.Tensor:
    """Mean Bernoulli NLL of per-minute goal indicators under the hazard link.

    ν = base_rate · exp(log_mult), P(goal in bin) = 1 - exp(-ν).
    ``base_rate`` is λ_DC/90 (or μ_DC/90) per cell. Numerically:
      log P(y=0) = -ν;  log P(y=1) = log(1 - exp(-ν)) = log(-expm1(-ν)).
    """
    nu = base_rate * torch.exp(log_mult)
    nu = torch.clamp(nu, 1e-8, 20.0)
    log_p0 = -nu
    log_p1 = torch.log(-torch.expm1(-nu))
    ll = labels * log_p1 + (1.0 - labels) * log_p0
    return -ll.mean()


# ---------------------------------------------------------------------------
# Multiplier tables for the DP (evaluate the net once per state combo)
# ---------------------------------------------------------------------------
def multiplier_table(
    net: Optional[ResidualNet],
    gender_f: float,
    red_diff_home: int = 0,
) -> np.ndarray:
    """f/g multipliers over (minute bin, home score diff, side) — [90, D, 2].

    D covers home-perspective score diffs -MAX_GOALS..+MAX_GOALS (the DP maps
    a lattice cell (h, a) to diff h-a; features clip at ±SCORE_DIFF_CLIP).
    ``red_diff_home`` is the home-perspective red-card difference, held FIXED
    over the rollout (v0 treats red cards as an observed covariate, not a
    process). ``net=None`` means f = g = 1 (the pure-DC engine).
    """
    n_diff = 2 * MAX_GOALS + 1
    if net is None:
        return np.ones((N_MINUTES, n_diff, 2), dtype=np.float64)
    minutes = np.repeat(np.arange(N_MINUTES, dtype=np.int64), n_diff)
    diffs = np.tile(np.arange(-MAX_GOALS, MAX_GOALS + 1, dtype=np.int64), N_MINUTES)
    table = np.empty((N_MINUTES, n_diff, 2), dtype=np.float64)
    was_training = net.training
    net.eval()
    with torch.no_grad():
        for side, (is_home, sign) in enumerate(((1.0, 1), (0.0, -1))):
            feats = build_feature_array(
                minutes,
                sign * diffs,
                sign * np.full_like(diffs, red_diff_home),
                np.full(diffs.shape[0], is_home),
                np.full(diffs.shape[0], gender_f),
            )
            r = net(torch.from_numpy(feats)).numpy()
            table[:, :, side] = np.exp(r).reshape(N_MINUTES, n_diff)
    if was_training:
        net.train()
    return table


# ---------------------------------------------------------------------------
# Exact forward DP over the score lattice
# ---------------------------------------------------------------------------
def _poisson_increment_pmfs(nu: np.ndarray) -> np.ndarray:
    """Stack of Poisson pmfs [MAX_INCREMENT+1, *nu.shape] for k = 0..K."""
    out = np.empty((MAX_INCREMENT + 1,) + nu.shape, dtype=np.float64)
    out[0] = np.exp(-nu)
    for k in range(1, MAX_INCREMENT + 1):
        out[k] = out[k - 1] * nu / k
    return out


def _apply_tau(mat: np.ndarray, lam: float, mu: float, rho: float) -> np.ndarray:
    """Dixon-Coles low-score dependence correction on the ABSOLUTE score grid."""
    mat = mat.copy()
    mat[0, 0] *= 1.0 - lam * mu * rho
    mat[0, 1] *= 1.0 + lam * rho
    mat[1, 0] *= 1.0 + mu * rho
    mat[1, 1] *= 1.0 - rho
    return np.clip(mat, 0.0, None)


def rollout_from_state(
    lam: float,
    mu: float,
    rho: float,
    net: Optional[ResidualNet],
    gender_f: float = 0.0,
    start_minute: int = 0,
    score: Tuple[int, int] = (0, 0),
    reds: Tuple[int, int] = (0, 0),
) -> np.ndarray:
    """Final-score distribution [MAX_GOALS+1, MAX_GOALS+1] from a match state.

    ``start_minute`` is the number of minute bins already played (0 = kickoff,
    45 = half time); minutes ``start_minute+1 .. 90`` remain. ``score`` and
    ``reds`` are (home, away) at that instant. Red-card difference is held
    fixed for the remainder (v0 covariate treatment). The tau correction is
    applied to the final absolute-score matrix — exactly DC's usage from
    kickoff, and a no-op on unreachable low-score cells mid-match.

    Returns the matrix renormalised over the lattice (mass that would exceed
    MAX_GOALS per side is dropped, as in a truncated Poisson grid).
    """
    h0, a0 = int(score[0]), int(score[1])
    if not (0 <= h0 <= MAX_GOALS and 0 <= a0 <= MAX_GOALS):
        raise ValueError("start score must lie on the 0..10 lattice")
    if not 0 <= start_minute <= N_MINUTES:
        raise ValueError("start_minute must be in 0..90")

    table = multiplier_table(net, gender_f, red_diff_home=int(reds[0]) - int(reds[1]))

    size = MAX_GOALS + 1
    prob = np.zeros((size, size), dtype=np.float64)
    prob[h0, a0] = 1.0

    # Per-cell home-perspective score diff index into the multiplier table.
    hh, aa = np.meshgrid(np.arange(size), np.arange(size), indexing="ij")
    diff_idx = (hh - aa) + MAX_GOALS  # -10..10 -> 0..20

    base_h = lam / N_MINUTES
    base_a = mu / N_MINUTES
    for t in range(start_minute, N_MINUTES):
        nu_h = base_h * table[t, diff_idx, 0]
        nu_a = base_a * table[t, diff_idx, 1]
        pmf_h = _poisson_increment_pmfs(nu_h)  # [K+1, size, size]
        pmf_a = _poisson_increment_pmfs(nu_a)
        new = np.zeros_like(prob)
        for k in range(MAX_INCREMENT + 1):
            weighted_k = prob * pmf_h[k]
            if k:
                weighted_k = weighted_k[: size - k, :]
            for j in range(MAX_INCREMENT + 1):
                w = weighted_k * (pmf_a[j][: size - k, :] if k else pmf_a[j])
                if j:
                    new[k:, j:] += w[:, : size - j]
                elif k:
                    new[k:, :] += w
                else:
                    new += w
        prob = new

    prob = _apply_tau(prob, lam, mu, rho)
    total = prob.sum()
    if total > 0:
        prob = prob / total
    return prob


def score_matrix(
    lam: float,
    mu: float,
    rho: float,
    net: Optional[ResidualNet],
    gender_f: float = 0.0,
) -> np.ndarray:
    """Pre-match final-score distribution (kickoff state: 0-0, no reds)."""
    return rollout_from_state(lam, mu, rho, net, gender_f)


def outcome_probs(matrix: np.ndarray) -> Tuple[float, float, float]:
    """(p_home, p_draw, p_away) from a score matrix; renormalised to sum to 1."""
    idx = np.arange(matrix.shape[0])
    home = float(matrix[idx[:, None] > idx[None, :]].sum())
    draw = float(np.trace(matrix))
    away = float(matrix[idx[:, None] < idx[None, :]].sum())
    s = home + draw + away
    if s > 0:
        return home / s, draw / s, away / s
    return 1 / 3, 1 / 3, 1 / 3


# ---------------------------------------------------------------------------
# Serialisation helpers (pure: dict in, dict out — file I/O stays in scripts)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class EngineConfig:
    hidden: int = DEFAULT_HIDDEN
    version: str = "v0"

    def to_dict(self) -> Dict[str, object]:
        return {"hidden": self.hidden, "version": self.version,
                "n_features": N_FEATURES}


def engine_state_dict(net: ResidualNet, config: EngineConfig) -> Dict[str, object]:
    return {"config": config.to_dict(), "state_dict": net.state_dict()}


def load_engine(payload: Dict[str, object]) -> Tuple[ResidualNet, EngineConfig]:
    cfg_raw = dict(payload["config"])  # type: ignore[arg-type]
    config = EngineConfig(hidden=int(cfg_raw.get("hidden", DEFAULT_HIDDEN)),
                          version=str(cfg_raw.get("version", "v0")))
    if int(cfg_raw.get("n_features", N_FEATURES)) != N_FEATURES:
        raise ValueError(
            "engine checkpoint feature layout does not match this code version"
        )
    net = ResidualNet(hidden=config.hidden)
    net.load_state_dict(payload["state_dict"])  # type: ignore[arg-type]
    net.eval()
    return net, config


def predict(
    lam: float,
    mu: float,
    rho: float,
    net: Optional[ResidualNet],
    gender_f: float = 0.0,
    display_max_goals: int = 6,
) -> Dict[str, object]:
    """Match prediction mirroring ``DixonColesModel.predict``'s contract."""
    mat = score_matrix(lam, mu, rho, net, gender_f)
    p_home, p_draw, p_away = outcome_probs(mat)
    display = mat[: display_max_goals + 1, : display_max_goals + 1]
    total = display.sum()
    if total > 0:
        display = display / total
    return {
        "p_home": p_home,
        "p_draw": p_draw,
        "p_away": p_away,
        "score_matrix": display.tolist(),
        "lambda_home": float(lam),
        "lambda_away": float(mu),
    }
