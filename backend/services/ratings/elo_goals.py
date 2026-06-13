"""Shared, empirically-calibrated Elo -> expected-goals coupling.

Every Monte Carlo simulator (World Cup groups + bracket, club league, club
knockout) converts an Elo rating difference into a pair of expected-goals
(Poisson lambdas) the same way. Historically each site hard-coded its own
coupling coefficient (0.30 / 0.30 / 0.30 / 0.25), all of which were roughly
half the empirically-correct value — which made the simulated win/advancement
probabilities far too flat (favourites under-rated, minnows over-rated).

`GOALS_SUPREMACY_PER_ELO` is calibrated from the committed historical corpus by
`backend/scripts/calibrate_elo_xg.py`: build a chronological Elo from real
results and OLS-regress the observed goal supremacy on the pre-match Elo
difference. The club corpus (~46k domestic-league matches) and the national
corpus (~4.7k tournament matches, built with the same K=40 Elo the World Cup
simulator consumes) independently agree at ~0.0048 goals of supremacy per Elo
point (~0.48 goals per 100 Elo). The multiplicative coupling is recovered as

    c = GOALS_SUPREMACY_PER_ELO * 400 / (2 * avg_goals)

so that the home-minus-away supremacy reproduces the calibrated slope at any
competition's average-goals level.
"""

from __future__ import annotations

from typing import Tuple

# Goals of expected supremacy per point of Elo difference. Re-run
# `python -m backend.scripts.calibrate_elo_xg` to reproduce / refresh.
GOALS_SUPREMACY_PER_ELO = 0.0048


def coupling_for(avg_goals: float) -> float:
    """The multiplicative coupling `c` such that the model's goal supremacy
    matches the empirical slope at this competition's average-goals level."""
    return GOALS_SUPREMACY_PER_ELO * 400.0 / (2.0 * max(0.5, avg_goals))


def expected_goals(
    home_elo: float,
    away_elo: float,
    *,
    avg_goals: float,
    home_adv: float,
    neutral: bool = False,
    home_clamp: Tuple[float, float] = (0.25, 4.5),
    away_clamp: Tuple[float, float] = (0.20, 4.0),
) -> Tuple[float, float]:
    """Calibrated Elo -> (home_xg, away_xg).

    `avg_goals` and `home_adv` stay competition-specific (tournaments score
    less than domestic leagues; neutral-venue ties drop the home term); only
    the Elo->supremacy coupling is shared and calibrated.
    """
    c = coupling_for(avg_goals)
    z = (home_elo - away_elo) / 400.0
    home_xg = avg_goals * (1.0 + c * z) + (0.0 if neutral else home_adv)
    away_xg = avg_goals * (1.0 - c * z)
    return (
        max(home_clamp[0], min(home_clamp[1], home_xg)),
        max(away_clamp[0], min(away_clamp[1], away_xg)),
    )
