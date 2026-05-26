"""
In-play (live) win-probability model.

A light Bayesian-style update of pre-match probabilities given the current
state of a live match. The approach is intentionally transparent rather than
ML-based:

1.  Use the pre-match three-way probabilities (home / draw / away) to derive
    each side's relative attacking strength.
2.  Model remaining goals as independent Poisson processes for each team
    using ``avg_total_goals * (minute_remaining / 90)`` as the joint
    expected-goals envelope, split by relative strength.
3.  Penalise red cards by reducing the offending team's ``lambda`` by ~25%
    per red card (capped at a 75% reduction).
4.  Sum over plausible future scorelines (up to 6 extra goals per side) to
    produce a posterior over final outcomes given the current score.
5.  Blend with the pre-match prior using a weight that decays with the
    minute, so early-game updates remain conservative.
"""

from __future__ import annotations

import math
from typing import Dict, Tuple


# Maximum additional goals per side that we enumerate when summing the
# Poisson product. With ``lambda`` typically below 2, 6 extra goals covers
# more than 99.9% of the probability mass.
_MAX_ADDITIONAL_GOALS = 6

# Per-red-card lambda multiplier. Each red card subtracts ~25% from the
# offending team's expected remaining goals.
_RED_CARD_PENALTY = 0.25
_MAX_RED_CARD_REDUCTION = 0.75


def _poisson_pmf(k: int, lam: float) -> float:
    """Poisson probability mass for ``k`` events given rate ``lam``."""
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def _strength_split(pre_match_probs: Tuple[float, float, float]) -> Tuple[float, float]:
    """
    Derive a relative-strength split (home_share, away_share) from the
    pre-match probabilities. Draw probability is split evenly.
    """
    home_p, draw_p, away_p = pre_match_probs
    home_share = home_p + draw_p / 2.0
    away_share = away_p + draw_p / 2.0
    total = home_share + away_share
    if total <= 0:
        return 0.5, 0.5
    return home_share / total, away_share / total


def _apply_red_card_penalty(lam: float, red_cards: int) -> float:
    """Reduce lambda by ~25% per red card, capped at 75% reduction."""
    if red_cards <= 0:
        return lam
    reduction = min(_MAX_RED_CARD_REDUCTION, _RED_CARD_PENALTY * red_cards)
    return max(0.0, lam * (1.0 - reduction))


def _normalise(probs: Dict[str, float]) -> Dict[str, float]:
    total = probs["home_win"] + probs["draw"] + probs["away_win"]
    if total <= 0:
        return {"home_win": 1 / 3, "draw": 1 / 3, "away_win": 1 / 3}
    return {k: v / total for k, v in probs.items()}


def compute_live_probability(
    pre_match_probs: Tuple[float, float, float],
    minute: int,
    home_score: int,
    away_score: int,
    red_cards_home: int = 0,
    red_cards_away: int = 0,
    avg_total_goals: float = 2.7,
) -> Dict[str, float]:
    """
    Compute live three-way outcome probabilities.

    Args:
        pre_match_probs: ``(home_win, draw, away_win)`` from the pre-match
            model. Should sum to ~1.0.
        minute: Current match minute (0-90+). Capped at 90 internally.
        home_score: Current home score.
        away_score: Current away score.
        red_cards_home: Number of red cards shown to the home team.
        red_cards_away: Number of red cards shown to the away team.
        avg_total_goals: Expected total goals over a full 90 minutes for
            this fixture (league-average is ~2.7).

    Returns:
        Dict with keys ``home_win``, ``draw``, ``away_win`` summing to 1.0.
    """
    minute = max(0, min(minute, 90))

    # Final state: deterministic outcome.
    if minute >= 90:
        if home_score > away_score:
            return {"home_win": 1.0, "draw": 0.0, "away_win": 0.0}
        if away_score > home_score:
            return {"home_win": 0.0, "draw": 0.0, "away_win": 1.0}
        return {"home_win": 0.0, "draw": 1.0, "away_win": 0.0}

    remaining_fraction = (90 - minute) / 90.0
    total_lambda = max(0.0, avg_total_goals * remaining_fraction)

    home_share, away_share = _strength_split(pre_match_probs)
    lam_home = total_lambda * home_share
    lam_away = total_lambda * away_share

    lam_home = _apply_red_card_penalty(lam_home, red_cards_home)
    lam_away = _apply_red_card_penalty(lam_away, red_cards_away)

    # Enumerate plausible additional scorelines.
    posterior = {"home_win": 0.0, "draw": 0.0, "away_win": 0.0}
    home_pmfs = [_poisson_pmf(i, lam_home) for i in range(_MAX_ADDITIONAL_GOALS + 1)]
    away_pmfs = [_poisson_pmf(j, lam_away) for j in range(_MAX_ADDITIONAL_GOALS + 1)]

    for i, p_h in enumerate(home_pmfs):
        final_home = home_score + i
        for j, p_a in enumerate(away_pmfs):
            final_away = away_score + j
            joint = p_h * p_a
            if final_home > final_away:
                posterior["home_win"] += joint
            elif final_home < final_away:
                posterior["away_win"] += joint
            else:
                posterior["draw"] += joint

    posterior = _normalise(posterior)

    # Blend with prior so that early-game updates stay conservative.
    # Prior weight: (90 - minute) / 180 -> 0.5 at kickoff, ~0 at 90'.
    prior_weight = (90 - minute) / 180.0
    posterior_weight = 1.0 - prior_weight
    home_prior, draw_prior, away_prior = pre_match_probs
    blended = {
        "home_win": posterior_weight * posterior["home_win"] + prior_weight * home_prior,
        "draw": posterior_weight * posterior["draw"] + prior_weight * draw_prior,
        "away_win": posterior_weight * posterior["away_win"] + prior_weight * away_prior,
    }
    return _normalise(blended)
