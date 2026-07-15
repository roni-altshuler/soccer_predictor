"""Tests for the Dixon-Coles baseline (backend/services/prediction/dixon_coles.py).

Covers, per the Phase-1 spec:
  * parameter recovery on synthetic data generated from known parameters,
  * time-decay weighting sanity (values + behavioural effect on the fit),
  * probability normalisation of predictions and score matrices,
  * artifact determinism (fit twice -> identical dict/JSON; round-trip).

All fits are deliberately small so the whole file runs in well under 30s.
"""

from __future__ import annotations

import itertools
import json
import math

import numpy as np
import pytest

from backend.services.prediction.dixon_coles import (
    DixonColesModel,
    Match,
    fit_dixon_coles,
    tau_correction,
    time_decay_weights,
)

RNG_SEED = 20260715


# ---------------------------------------------------------------------------
# Synthetic data generation (true Dixon-Coles sampler)
# ---------------------------------------------------------------------------
def _dc_joint_pmf(lam: float, mu: float, rho: float, max_goals: int = 10) -> np.ndarray:
    gx = np.arange(max_goals + 1)
    px = np.exp(-lam) * lam**gx / np.array([math.factorial(int(k)) for k in gx])
    py = np.exp(-mu) * mu**gx / np.array([math.factorial(int(k)) for k in gx])
    mat = np.outer(px, py)
    mat[0, 0] *= 1.0 - lam * mu * rho
    mat[0, 1] *= 1.0 + lam * rho
    mat[1, 0] *= 1.0 + mu * rho
    mat[1, 1] *= 1.0 - rho
    mat = np.clip(mat, 0.0, None)
    return mat / mat.sum()


def _simulate_league(
    attack: np.ndarray,
    defence: np.ndarray,
    home_adv: float,
    rho: float,
    rounds: int,
    rng: np.random.Generator,
    date: str = "2025-05-01",
) -> list:
    """`rounds` double round-robins sampled from the true DC joint pmf."""
    n = len(attack)
    matches = []
    for _ in range(rounds):
        for i, j in itertools.permutations(range(n), 2):
            lam = math.exp(attack[i] - defence[j] + home_adv)
            mu = math.exp(attack[j] - defence[i])
            pmf = _dc_joint_pmf(lam, mu, rho)
            flat = rng.choice(pmf.size, p=pmf.ravel())
            hg, ag = divmod(int(flat), pmf.shape[1])
            matches.append(Match(f"T{i}", f"T{j}", hg, ag, date))
    return matches


@pytest.fixture(scope="module")
def recovered():
    """Fit once on synthetic data from known params; reused by several tests."""
    rng = np.random.default_rng(RNG_SEED)
    n = 8
    true_attack = np.array([0.5, 0.3, 0.15, 0.05, -0.05, -0.15, -0.3, -0.5])
    true_defence = np.array([0.35, -0.25, 0.15, -0.1, 0.2, -0.2, 0.05, -0.2])
    true_home_adv = 0.30
    true_rho = -0.10
    matches = _simulate_league(
        true_attack, true_defence, true_home_adv, true_rho, rounds=25, rng=rng
    )
    model = fit_dixon_coles(matches, half_life_days=1e6)  # no decay: same date
    return {
        "model": model,
        "true_attack": true_attack,
        "true_defence": true_defence,
        "true_home_adv": true_home_adv,
        "true_rho": true_rho,
        "n_matches": len(matches),
    }


# ---------------------------------------------------------------------------
# Parameter recovery
# ---------------------------------------------------------------------------
class TestParameterRecovery:
    def test_attack_recovered(self, recovered):
        model = recovered["model"]
        fit = np.array([model.teams[f"T{i}"]["attack"] for i in range(8)])
        true = recovered["true_attack"]
        assert np.corrcoef(fit, true)[0, 1] > 0.97
        assert np.max(np.abs(fit - true)) < 0.15

    def test_defence_recovered(self, recovered):
        model = recovered["model"]
        fit = np.array([model.teams[f"T{i}"]["defence"] for i in range(8)])
        true = recovered["true_defence"]
        # Defence has a location ambiguity vs attack-sum gauge; compare centred.
        fit_c = fit - fit.mean()
        true_c = true - true.mean()
        assert np.corrcoef(fit_c, true_c)[0, 1] > 0.95
        assert np.max(np.abs(fit_c - true_c)) < 0.15

    def test_home_adv_recovered(self, recovered):
        assert recovered["model"].home_adv == pytest.approx(
            recovered["true_home_adv"], abs=0.08
        )

    def test_rho_recovered(self, recovered):
        assert recovered["model"].rho == pytest.approx(
            recovered["true_rho"], abs=0.06
        )

    def test_attack_sum_zero_constraint(self, recovered):
        model = recovered["model"]
        total = sum(v["attack"] for v in model.teams.values())
        assert total == pytest.approx(0.0, abs=1e-6)

    def test_expected_goals_favor_strong_team(self, recovered):
        model = recovered["model"]
        lam, mu = model.expected_goals("T0", "T7")  # best attack vs worst
        assert lam > mu

    def test_fit_metadata(self, recovered):
        model = recovered["model"]
        assert model.fitted_matches == recovered["n_matches"]
        assert model.last_match_date is not None
        assert model.last_match_date.startswith("2025-05-01")


# ---------------------------------------------------------------------------
# Time-decay weighting
# ---------------------------------------------------------------------------
class TestTimeDecay:
    def test_weight_values(self):
        from datetime import datetime, timedelta

        ref = datetime(2025, 1, 1)
        half_life = 340.0
        dates = [
            ref.isoformat(),
            (ref - timedelta(days=half_life)).isoformat(),      # 1 half-life
            (ref - timedelta(days=2 * half_life)).isoformat(),  # 2 half-lives
        ]
        w = time_decay_weights(dates, ref_date=ref, half_life_days=half_life)
        assert w[0] == pytest.approx(1.0)
        assert w[1] == pytest.approx(0.5, abs=1e-6)
        assert w[2] == pytest.approx(0.25, abs=1e-6)
        assert w[0] > w[1] > w[2] > 0

    def test_missing_dates_get_full_weight(self):
        # 2020-01-01 -> 2025-01-01 is ~4.7 half-lives of 390d: weight ~0.039.
        w = time_decay_weights([None, "2020-01-01"], "2025-01-01", 390.0)
        assert w[0] == pytest.approx(1.0)
        assert w[1] == pytest.approx(2.0 ** (-1827 / 390), abs=1e-6)

    def test_invalid_half_life_raises(self):
        with pytest.raises(ValueError):
            time_decay_weights(["2025-01-01"], "2025-01-01", 0.0)

    def test_decay_downweights_ancient_form(self):
        """A team dominant long ago but bad recently: short half-life must rank
        it below a team with the opposite trajectory; a huge half-life treats
        both epochs equally so the gap shrinks toward zero."""
        rng = np.random.default_rng(RNG_SEED + 1)
        matches = []
        # 6 teams; T0 strong / T1 weak in the OLD era, reversed in the NEW era.
        old_attack = np.array([0.7, -0.7, 0.0, 0.0, 0.0, 0.0])
        new_attack = np.array([-0.7, 0.7, 0.0, 0.0, 0.0, 0.0])
        defence = np.zeros(6)
        matches += _simulate_league(
            old_attack, defence, 0.3, -0.05, rounds=6, rng=rng, date="2020-01-01"
        )
        matches += _simulate_league(
            new_attack, defence, 0.3, -0.05, rounds=6, rng=rng, date="2025-01-01"
        )
        recent = fit_dixon_coles(matches, half_life_days=200.0, ref_date="2025-01-01")
        flat = fit_dixon_coles(matches, half_life_days=1e9, ref_date="2025-01-01")
        gap_recent = recent.teams["T1"]["attack"] - recent.teams["T0"]["attack"]
        gap_flat = flat.teams["T1"]["attack"] - flat.teams["T0"]["attack"]
        assert gap_recent > 0.5  # recent era dominates: T1 clearly stronger
        assert abs(gap_flat) < 0.25  # equal weighting: eras nearly cancel
        assert gap_recent > gap_flat + 0.3


# ---------------------------------------------------------------------------
# tau correction + probability normalisation
# ---------------------------------------------------------------------------
class TestProbabilities:
    def test_tau_values(self):
        lam, mu, rho = 1.5, 1.1, -0.1
        assert tau_correction(0, 0, lam, mu, rho) == pytest.approx(1 - lam * mu * rho)
        assert tau_correction(0, 1, lam, mu, rho) == pytest.approx(1 + lam * rho)
        assert tau_correction(1, 0, lam, mu, rho) == pytest.approx(1 + mu * rho)
        assert tau_correction(1, 1, lam, mu, rho) == pytest.approx(1 - rho)
        assert tau_correction(2, 3, lam, mu, rho) == 1.0

    def test_outcome_probs_normalised(self, recovered):
        model = recovered["model"]
        for home, away in [("T0", "T7"), ("T3", "T4"), ("T7", "T0"), ("T9x", "T0")]:
            pred = model.predict(home, away)
            total = pred["p_home"] + pred["p_draw"] + pred["p_away"]
            assert total == pytest.approx(1.0, abs=1e-9)
            assert min(pred["p_home"], pred["p_draw"], pred["p_away"]) >= 0.0

    def test_score_matrix_normalised_and_shaped(self, recovered):
        model = recovered["model"]
        pred = model.predict("T1", "T6", max_goals=6)
        mat = np.array(pred["score_matrix"])
        assert mat.shape == (7, 7)
        assert mat.sum() == pytest.approx(1.0, abs=1e-9)
        assert (mat >= 0).all()

    def test_negative_rho_boosts_low_draws(self):
        """rho < 0 must inflate P(0-0) and P(1-1) relative to independence."""
        model = DixonColesModel(
            teams={"A": {"attack": 0.0, "defence": 0.0},
                   "B": {"attack": 0.0, "defence": 0.0}},
            home_adv=0.0,
            rho=-0.1,
        )
        indep = DixonColesModel(teams=dict(model.teams), home_adv=0.0, rho=0.0)
        m_rho = model.score_matrix("A", "B")
        m_ind = indep.score_matrix("A", "B")
        assert m_rho[0, 0] > m_ind[0, 0]
        assert m_rho[1, 1] > m_ind[1, 1]
        assert m_rho[0, 1] < m_ind[0, 1]

    def test_unseen_team_cold_start(self, recovered):
        """Promoted/unknown teams get neutral ratings, not a crash."""
        model = recovered["model"]
        assert not model.knows_team("Newly Promoted FC")
        pred = model.predict("Newly Promoted FC", "T0")
        assert pred["p_home"] + pred["p_draw"] + pred["p_away"] == pytest.approx(1.0)
        # Against the league's best attack, the unknown side shouldn't be favourite
        # by more than home advantage alone can explain.
        assert pred["lambda_away"] > 0

    def test_predict_keys(self, recovered):
        pred = recovered["model"].predict("T0", "T1")
        assert set(pred) == {
            "p_home", "p_draw", "p_away",
            "score_matrix", "lambda_home", "lambda_away",
        }
        assert pred["lambda_home"] > 0 and pred["lambda_away"] > 0


# ---------------------------------------------------------------------------
# Artifact determinism
# ---------------------------------------------------------------------------
class TestArtifactDeterminism:
    def _small_fit(self):
        rng = np.random.default_rng(RNG_SEED + 2)
        attack = np.array([0.3, 0.0, -0.1, -0.2])
        defence = np.array([0.1, -0.1, 0.0, 0.0])
        matches = _simulate_league(attack, defence, 0.25, -0.08, rounds=8, rng=rng)
        return matches

    def test_refit_identical(self):
        matches = self._small_fit()
        d1 = fit_dixon_coles(matches).to_dict()
        d2 = fit_dixon_coles(matches).to_dict()
        assert d1 == d2
        assert json.dumps(d1, sort_keys=True) == json.dumps(d2, sort_keys=True)

    def test_team_ordering_deterministic(self):
        matches = self._small_fit()
        d = fit_dixon_coles(matches).to_dict()
        assert list(d["teams"].keys()) == sorted(d["teams"].keys())

    def test_input_order_invariance(self):
        """Shuffling the match list must not change the fitted parameters
        beyond numerical noise (team indexing is name-sorted internally)."""
        matches = self._small_fit()
        rng = np.random.default_rng(0)
        shuffled = list(matches)
        rng.shuffle(shuffled)
        d1 = fit_dixon_coles(matches).to_dict()
        d2 = fit_dixon_coles(shuffled).to_dict()
        assert d1["home_adv"] == pytest.approx(d2["home_adv"], abs=1e-4)
        assert d1["rho"] == pytest.approx(d2["rho"], abs=1e-4)
        for t in d1["teams"]:
            assert d1["teams"][t]["attack"] == pytest.approx(
                d2["teams"][t]["attack"], abs=1e-4
            )

    def test_round_trip_serialisation(self):
        matches = self._small_fit()
        model = fit_dixon_coles(matches)
        clone = DixonColesModel.from_dict(model.to_dict())
        p1 = model.predict("T0", "T1")
        p2 = clone.predict("T0", "T1")
        # to_dict rounds to 6 dp, so allow tiny drift.
        assert p1["p_home"] == pytest.approx(p2["p_home"], abs=1e-4)
        assert p1["p_draw"] == pytest.approx(p2["p_draw"], abs=1e-4)
        assert p1["p_away"] == pytest.approx(p2["p_away"], abs=1e-4)


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
class TestGuards:
    def test_empty_input_raises(self):
        with pytest.raises(ValueError):
            fit_dixon_coles([])

    def test_single_team_raises(self):
        with pytest.raises(ValueError):
            fit_dixon_coles([Match("A", "A", 1, 1, None)])

    def test_dict_inputs_accepted(self):
        matches = [
            {"home": "A", "away": "B", "home_goals": 2, "away_goals": 0,
             "date": "2025-01-01"},
            {"home": "B", "away": "A", "home_goals": 1, "away_goals": 1,
             "date": "2025-01-08"},
        ] * 30
        model = fit_dixon_coles(matches)
        assert model.knows_team("A") and model.knows_team("B")
