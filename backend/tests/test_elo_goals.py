"""Guard the calibrated Elo->expected-goals coupling.

These tests pin the behaviour (and a sane band for the calibrated constant)
so the coupling can't silently regress to the old, far-too-flat value. If a
fresh calibration genuinely moves the constant, re-run
`python -m backend.scripts.calibrate_elo_xg` and update the band intentionally.
"""

from backend.services.ratings.elo_goals import (
    GOALS_SUPREMACY_PER_ELO,
    coupling_for,
    expected_goals,
)


def test_constant_in_calibrated_band():
    # Calibrated at ~0.0048 goals/Elo-pt from the committed corpus; the band
    # rejects both the old flat ~0.30-coupling value and any runaway value.
    assert 0.0035 <= GOALS_SUPREMACY_PER_ELO <= 0.0065


def test_coupling_scales_inversely_with_avg_goals():
    # c = beta * 400 / (2 * avg_goals)
    assert coupling_for(1.30) > coupling_for(1.35)
    assert abs(coupling_for(1.30) - GOALS_SUPREMACY_PER_ELO * 400 / (2 * 1.30)) < 1e-9


def test_equal_elo_gives_symmetric_plus_home_adv():
    home, away = expected_goals(1500, 1500, avg_goals=1.35, home_adv=0.25)
    assert abs(home - (1.35 + 0.25)) < 1e-9
    assert abs(away - 1.35) < 1e-9


def test_neutral_drops_home_advantage():
    home, away = expected_goals(1500, 1500, avg_goals=1.30, home_adv=0.20, neutral=True)
    assert abs(home - 1.30) < 1e-9
    assert abs(away - 1.30) < 1e-9


def test_favourite_outscores_underdog_and_supremacy_grows():
    h1, a1 = expected_goals(1600, 1500, avg_goals=1.35, home_adv=0.0)
    h2, a2 = expected_goals(1800, 1500, avg_goals=1.35, home_adv=0.0)
    assert h1 > a1  # favourite expects more goals
    assert (h2 - a2) > (h1 - a1)  # bigger Elo gap -> bigger supremacy


def test_calibrated_supremacy_matches_slope():
    # 100 Elo of edge should produce ~0.48 goals of supremacy (the empirical
    # slope), well above the old coupling's ~0.20.
    home, away = expected_goals(1600, 1500, avg_goals=1.35, home_adv=0.0)
    supremacy = home - away
    assert 0.40 <= supremacy <= 0.55


def test_clamps_respected_for_extreme_gaps():
    home, away = expected_goals(2200, 1300, avg_goals=1.35, home_adv=0.25,
                                home_clamp=(0.5, 4.0), away_clamp=(0.3, 3.5))
    assert 0.5 <= home <= 4.0
    assert 0.3 <= away <= 3.5
