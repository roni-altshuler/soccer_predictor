"""Dixon-Coles (1997) bivariate-Poisson match model with time decay.

This is the *calibrated, explainable baseline* the VISION_2030 roadmap (§8)
names as "the yardstick the Match Engine must beat". It is intentionally a pure,
side-effect-free module: no globals, no singletons, no I/O. Everything it needs
is passed in; everything it produces is returned.

Model
-----
For a match between home team ``i`` and away team ``j`` the goal expectations are

    log λ (home) = attack[i] - defence[j] + home_adv
    log μ (away) = attack[j] - defence[i]

with ``home_goals ~ Poisson(λ)`` and ``away_goals ~ Poisson(μ)``. Dixon & Coles
add a low-score dependence correction ``τ(x, y; λ, μ, ρ)`` that inflates/deflates
the four lowest joint scorelines (the Poisson independence assumption is worst
exactly there):

    τ(0,0) = 1 - λ·μ·ρ
    τ(0,1) = 1 + λ·ρ
    τ(1,0) = 1 + μ·ρ
    τ(1,1) = 1 - ρ
    τ(x,y) = 1            otherwise

The joint pmf is ``P(X=x, Y=y) = τ(x,y) · Poisson(x; λ) · Poisson(y; μ)``.

Fitting
-------
Parameters are estimated by *weighted* maximum likelihood, where each match
carries an exponential time-decay weight

    w(t) = exp(-ξ · Δt)   with   ξ = ln(2) / half_life_days

so a match ``half_life_days`` old counts half as much as one played today. The
default half-life is ~390 days (a little over one season), matching Dixon-Coles'
recommendation that recent form dominates.

Identifiability: attack ratings are constrained to sum to zero (one team's
attack is pinned to the negative sum of the others), which removes the additive
gauge freedom ``(attack, defence) → (attack + c, defence + c)``.

The fit uses ``scipy.optimize.minimize`` (L-BFGS-B). scipy is a hard project
dependency (see ``requirements.txt``); if it is ever removed this module raises a
clear error at fit time rather than silently degrading.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Mapping, Optional, Sequence, Tuple, Union

import numpy as np

DEFAULT_HALF_LIFE_DAYS: float = 390.0
DEFAULT_MAX_GOALS: int = 6
# Internal grid used for outcome probabilities (wider than the returned display
# matrix so almost no tail mass is lost when collapsing to 1X2).
_INTERNAL_MAX_GOALS: int = 12
# Bound |rho| so the tau correction stays positive for realistic (λ, μ). With
# λ, μ up to ~4 goals, 1 + λρ > 0 requires |ρ| < 0.25; 0.18 keeps a safe margin.
RHO_BOUND: float = 0.18
_EPS: float = 1e-12

DateLike = Union[str, datetime, None]


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Match:
    """A single completed match used for fitting."""

    home: str
    away: str
    home_goals: int
    away_goals: int
    date: DateLike = None


def _to_datetime(value: DateLike) -> Optional[datetime]:
    """Parse an ISO-8601 string or pass a datetime through; None stays None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    # Python's fromisoformat handles the warehouse's "...+00:00" offsets.
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        # Fall back to a date-only parse.
        return datetime.fromisoformat(text[:10])


def _as_utc_naive(dt: datetime) -> datetime:
    """Normalise to a tz-naive UTC datetime so subtraction never raises."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def time_decay_weights(
    dates: Sequence[DateLike],
    ref_date: DateLike,
    half_life_days: float = DEFAULT_HALF_LIFE_DAYS,
) -> np.ndarray:
    """Exponential decay weights: 1.0 at ``ref_date``, 0.5 one half-life earlier.

    Matches dated after ``ref_date`` (should not happen in a walk-forward fit)
    and matches with no date are given weight 1.0.
    """
    if half_life_days <= 0:
        raise ValueError("half_life_days must be positive")
    xi = math.log(2.0) / float(half_life_days)
    ref = _as_utc_naive(_to_datetime(ref_date)) if ref_date is not None else None
    out = np.ones(len(dates), dtype=np.float64)
    if ref is None:
        return out
    for k, d in enumerate(dates):
        dt = _to_datetime(d)
        if dt is None:
            continue
        delta_days = (ref - _as_utc_naive(dt)).total_seconds() / 86400.0
        if delta_days <= 0:
            out[k] = 1.0
        else:
            out[k] = math.exp(-xi * delta_days)
    return out


# ---------------------------------------------------------------------------
# tau correction
# ---------------------------------------------------------------------------
def tau_correction(
    x: int, y: int, lam: float, mu: float, rho: float
) -> float:
    """Dixon-Coles low-score dependence factor for a single scoreline."""
    if x == 0 and y == 0:
        return 1.0 - lam * mu * rho
    if x == 0 and y == 1:
        return 1.0 + lam * rho
    if x == 1 and y == 0:
        return 1.0 + mu * rho
    if x == 1 and y == 1:
        return 1.0 - rho
    return 1.0


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
@dataclass
class DixonColesModel:
    """A fitted Dixon-Coles model for a single competition.

    ``teams`` maps team name -> {"attack": float, "defence": float}. Higher
    attack means more goals scored; higher defence means fewer goals conceded.
    """

    teams: Dict[str, Dict[str, float]]
    home_adv: float
    rho: float
    half_life_days: float = DEFAULT_HALF_LIFE_DAYS
    fitted_matches: int = 0
    last_match_date: Optional[str] = None

    # -- ratings access --------------------------------------------------
    def _rating(self, team: str) -> Tuple[float, float]:
        """(attack, defence) for a team; a neutral (0, 0) for unseen teams.

        Cold-starting unseen (e.g. just-promoted) teams at the league-average
        rating is deliberate: the model still returns a sensible prediction
        driven by home advantage rather than crashing.
        """
        r = self.teams.get(team)
        if r is None:
            return 0.0, 0.0
        return float(r["attack"]), float(r["defence"])

    def knows_team(self, team: str) -> bool:
        return team in self.teams

    def expected_goals(self, home: str, away: str) -> Tuple[float, float]:
        a_h, d_h = self._rating(home)
        a_a, d_a = self._rating(away)
        lam = math.exp(a_h - d_a + self.home_adv)
        mu = math.exp(a_a - d_h)
        return lam, mu

    # -- prediction ------------------------------------------------------
    def score_matrix(
        self, home: str, away: str, max_goals: int = DEFAULT_MAX_GOALS
    ) -> np.ndarray:
        """Joint scoreline probability matrix P[x, y] over 0..max_goals.

        Renormalised to sum to 1 across the returned grid (the tau correction
        and finite truncation both perturb the raw sum slightly).
        """
        lam, mu = self.expected_goals(home, away)
        return self._score_matrix_from_lambda(lam, mu, max_goals)

    def _score_matrix_from_lambda(
        self, lam: float, mu: float, max_goals: int
    ) -> np.ndarray:
        gx = np.arange(max_goals + 1)
        px = np.exp(-lam) * np.power(lam, gx) / np.array(
            [math.factorial(int(k)) for k in gx]
        )
        py = np.exp(-mu) * np.power(mu, gx) / np.array(
            [math.factorial(int(k)) for k in gx]
        )
        mat = np.outer(px, py)
        # Apply the tau correction to the 2x2 low-score corner.
        if max_goals >= 1:
            mat[0, 0] *= 1.0 - lam * mu * self.rho
            mat[0, 1] *= 1.0 + lam * self.rho
            mat[1, 0] *= 1.0 + mu * self.rho
            mat[1, 1] *= 1.0 - self.rho
        mat = np.clip(mat, 0.0, None)
        total = mat.sum()
        if total > 0:
            mat = mat / total
        return mat

    def predict(
        self, home: str, away: str, max_goals: int = DEFAULT_MAX_GOALS
    ) -> Dict[str, object]:
        """Predict a match.

        Returns a dict with:
          p_home, p_draw, p_away  -- 1X2 outcome probabilities (sum to 1)
          score_matrix            -- (max_goals+1) x (max_goals+1) list of lists
          lambda_home, lambda_away -- expected goals
        """
        lam, mu = self.expected_goals(home, away)
        # Outcome probabilities from a wide internal grid to avoid losing mass.
        wide = self._score_matrix_from_lambda(lam, mu, _INTERNAL_MAX_GOALS)
        idx = np.arange(_INTERNAL_MAX_GOALS + 1)
        home_mask = idx[:, None] > idx[None, :]
        away_mask = idx[:, None] < idx[None, :]
        draw_mask = idx[:, None] == idx[None, :]
        p_home = float(wide[home_mask].sum())
        p_draw = float(wide[draw_mask].sum())
        p_away = float(wide[away_mask].sum())
        s = p_home + p_draw + p_away
        if s > 0:
            p_home, p_draw, p_away = p_home / s, p_draw / s, p_away / s
        display = self.score_matrix(home, away, max_goals)
        return {
            "p_home": p_home,
            "p_draw": p_draw,
            "p_away": p_away,
            "score_matrix": display.tolist(),
            "lambda_home": lam,
            "lambda_away": mu,
        }

    # -- serialisation ---------------------------------------------------
    def to_dict(self) -> Dict[str, object]:
        """Deterministic, JSON-ready representation (teams sorted by name)."""
        return {
            "home_adv": round(float(self.home_adv), 6),
            "rho": round(float(self.rho), 6),
            "half_life_days": round(float(self.half_life_days), 3),
            "fitted_matches": int(self.fitted_matches),
            "last_match_date": self.last_match_date,
            "teams": {
                name: {
                    "attack": round(float(self.teams[name]["attack"]), 6),
                    "defence": round(float(self.teams[name]["defence"]), 6),
                }
                for name in sorted(self.teams)
            },
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> "DixonColesModel":
        teams = {
            str(name): {
                "attack": float(vals["attack"]),  # type: ignore[index]
                "defence": float(vals["defence"]),  # type: ignore[index]
            }
            for name, vals in dict(data["teams"]).items()  # type: ignore[arg-type]
        }
        return cls(
            teams=teams,
            home_adv=float(data["home_adv"]),  # type: ignore[arg-type]
            rho=float(data["rho"]),  # type: ignore[arg-type]
            half_life_days=float(data.get("half_life_days", DEFAULT_HALF_LIFE_DAYS)),  # type: ignore[arg-type]
            fitted_matches=int(data.get("fitted_matches", 0)),  # type: ignore[arg-type]
            last_match_date=(
                str(data["last_match_date"])
                if data.get("last_match_date") is not None
                else None
            ),
        )


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------
def _coerce_matches(
    matches: Sequence[Union[Match, Mapping[str, object]]]
) -> List[Match]:
    out: List[Match] = []
    for m in matches:
        if isinstance(m, Match):
            out.append(m)
            continue
        out.append(
            Match(
                home=str(m["home"]),
                away=str(m["away"]),
                home_goals=int(m["home_goals"]),
                away_goals=int(m["away_goals"]),
                date=m.get("date"),  # type: ignore[union-attr]
            )
        )
    return out


def fit_dixon_coles(
    matches: Sequence[Union[Match, Mapping[str, object]]],
    half_life_days: float = DEFAULT_HALF_LIFE_DAYS,
    ref_date: DateLike = None,
    max_iter: int = 500,
    ridge: float = 1e-4,
) -> DixonColesModel:
    """Fit a Dixon-Coles model to a set of completed matches (one competition).

    Args:
        matches: completed matches (home/away names, integer goals, optional date).
        half_life_days: time-decay half-life; set very large to (effectively)
            disable decay.
        ref_date: reference "now" for decay; defaults to the most recent match.
        max_iter: optimiser iteration cap.
        ridge: tiny L2 penalty on ratings for numerical stability (negligible
            bias; pins the otherwise-flat attack-sum nuisance direction).

    Returns:
        A fitted :class:`DixonColesModel`.
    """
    try:
        from scipy.optimize import minimize
    except ImportError as exc:  # pragma: no cover - scipy is a hard dependency
        raise RuntimeError(
            "scipy is required to fit Dixon-Coles (see requirements.txt)"
        ) from exc

    ms = _coerce_matches(matches)
    if not ms:
        raise ValueError("cannot fit Dixon-Coles on zero matches")

    # Deterministic team ordering.
    team_names = sorted({m.home for m in ms} | {m.away for m in ms})
    index = {name: i for i, name in enumerate(team_names)}
    n_teams = len(team_names)
    if n_teams < 2:
        raise ValueError("need at least two distinct teams to fit")

    home_idx = np.array([index[m.home] for m in ms], dtype=np.int64)
    away_idx = np.array([index[m.away] for m in ms], dtype=np.int64)
    x = np.array([m.home_goals for m in ms], dtype=np.float64)
    y = np.array([m.away_goals for m in ms], dtype=np.float64)

    # Time-decay weights.
    dates = [m.date for m in ms]
    parsed = [_to_datetime(d) for d in dates]
    resolved_ref = ref_date
    if resolved_ref is None:
        present = [d for d in parsed if d is not None]
        resolved_ref = max(present) if present else None
    weights = time_decay_weights(dates, resolved_ref, half_life_days)

    # Masks for the tau low-score corner (computed once).
    m00 = (x == 0) & (y == 0)
    m01 = (x == 0) & (y == 1)
    m10 = (x == 1) & (y == 0)
    m11 = (x == 1) & (y == 1)

    # Parameter layout: [attack_free (n_teams-1), defence (n_teams), gamma, rho].
    n_attack_free = n_teams - 1

    def unpack(theta: np.ndarray) -> Tuple[np.ndarray, np.ndarray, float, float]:
        a_free = theta[:n_attack_free]
        attack = np.empty(n_teams, dtype=np.float64)
        attack[:n_attack_free] = a_free
        attack[-1] = -a_free.sum()  # sum(attack) == 0 constraint
        defence = theta[n_attack_free : n_attack_free + n_teams]
        gamma = theta[-2]
        rho = theta[-1]
        return attack, defence, gamma, rho

    n_rating = n_attack_free + n_teams  # params carrying the ridge penalty

    def neg_log_likelihood_and_grad(
        theta: np.ndarray,
    ) -> Tuple[float, np.ndarray]:
        """Weighted NLL and its analytic gradient (exact; enables fast L-BFGS)."""
        attack, defence, gamma, rho = unpack(theta)
        log_lam = attack[home_idx] - defence[away_idx] + gamma
        log_mu = attack[away_idx] - defence[home_idx]
        lam = np.exp(log_lam)
        mu = np.exp(log_mu)
        # Poisson log-pmf without the constant log(x!) term (irrelevant to MLE).
        ll = x * log_lam - lam + y * log_mu - mu
        # tau correction.
        tau = np.ones_like(lam)
        tau[m00] = 1.0 - lam[m00] * mu[m00] * rho
        tau[m01] = 1.0 + lam[m01] * rho
        tau[m10] = 1.0 + mu[m10] * rho
        tau[m11] = 1.0 - rho
        ll = ll + np.log(np.clip(tau, _EPS, None))
        nll = -float(np.sum(weights * ll))
        # Tiny ridge for stability (pins attack-sum nuisance direction; the
        # constraint already zeroes its mean, this just keeps values bounded).
        nll += ridge * float(np.sum(theta[:n_rating] ** 2))

        # ---- gradient ----
        # d(log tau)/d(lam, mu, rho); contributions zeroed where the clip in
        # the objective is active (tau <= eps) so value and grad stay coherent.
        d_lam = np.zeros_like(lam)
        d_mu = np.zeros_like(lam)
        d_rho = np.zeros_like(lam)
        valid = tau > _EPS
        v00 = m00 & valid
        v01 = m01 & valid
        v10 = m10 & valid
        v11 = m11 & valid
        d_lam[v00] = -mu[v00] * rho / tau[v00]
        d_lam[v01] = rho / tau[v01]
        d_mu[v00] = -lam[v00] * rho / tau[v00]
        d_mu[v10] = rho / tau[v10]
        d_rho[v00] = -lam[v00] * mu[v00] / tau[v00]
        d_rho[v01] = lam[v01] / tau[v01]
        d_rho[v10] = mu[v10] / tau[v10]
        d_rho[v11] = -1.0 / tau[v11]

        # d(weighted ll)/d(log lam) and d(log mu), per match.
        gl = weights * (x - lam + lam * d_lam)
        gm = weights * (y - mu + mu * d_mu)

        g_attack = np.zeros(n_teams, dtype=np.float64)
        g_def = np.zeros(n_teams, dtype=np.float64)
        np.add.at(g_attack, home_idx, gl)   # log lam has +attack[home]
        np.add.at(g_attack, away_idx, gm)   # log mu  has +attack[away]
        np.add.at(g_def, away_idx, -gl)     # log lam has -defence[away]
        np.add.at(g_def, home_idx, -gm)     # log mu  has -defence[home]

        grad = np.zeros_like(theta)
        # attack[-1] = -sum(a_free)  =>  d/d a_free[i] = g_attack[i] - g_attack[-1]
        grad[:n_attack_free] = -(g_attack[:n_attack_free] - g_attack[-1])
        grad[n_attack_free : n_attack_free + n_teams] = -g_def
        grad[-2] = -float(np.sum(gl))
        grad[-1] = -float(np.sum(weights * d_rho))
        grad[:n_rating] += 2.0 * ridge * theta[:n_rating]
        return nll, grad

    # Initial guess: flat ratings, mild home advantage, small negative rho.
    theta0 = np.zeros(n_attack_free + n_teams + 2, dtype=np.float64)
    theta0[-2] = 0.25  # gamma (home advantage in log space)
    theta0[-1] = -0.05  # rho

    bounds = (
        [(-3.0, 3.0)] * n_attack_free
        + [(-3.0, 3.0)] * n_teams
        + [(-1.0, 1.0)]  # gamma
        + [(-RHO_BOUND, RHO_BOUND)]  # rho
    )

    result = minimize(
        neg_log_likelihood_and_grad,
        theta0,
        method="L-BFGS-B",
        jac=True,
        bounds=bounds,
        options={"maxiter": max_iter, "ftol": 1e-10, "gtol": 1e-7},
    )

    attack, defence, gamma, rho = unpack(result.x)
    teams = {
        name: {"attack": float(attack[i]), "defence": float(defence[i])}
        for name, i in index.items()
    }
    last_date = None
    present = [d for d in parsed if d is not None]
    if present:
        last_date = max(present).isoformat()

    return DixonColesModel(
        teams=teams,
        home_adv=float(gamma),
        rho=float(rho),
        half_life_days=float(half_life_days),
        fitted_matches=len(ms),
        last_match_date=last_date,
    )
