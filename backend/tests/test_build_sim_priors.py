"""Tests for backend/scripts/build_sim_priors.py — alias resolution + priors.

No network: the frontend team lists are injected. The alias matcher must be
conservative — ambiguity means unmatched, never a guessed binding.
"""

from __future__ import annotations

import math

import pytest

from backend.scripts.build_sim_priors import (
    build_artifact,
    build_competition_entry,
    compute_prior_ppg,
    normalize_team_name,
    resolve_aliases,
)
from backend.services.prediction.dixon_coles import DixonColesModel


def frontend(*names: str) -> list:
    return [{"name": n, "id": str(1000 + i)} for i, n in enumerate(names)]


# ---------------------------------------------------------------------------
# normalize_team_name — must mirror the frontend's normalizeTeamName
# ---------------------------------------------------------------------------
class TestNormalize:
    def test_case_and_suffixes(self):
        assert normalize_team_name("AFC Bournemouth") == "bournemouth"
        assert normalize_team_name("Bournemouth") == "bournemouth"
        assert normalize_team_name("Arsenal FC") == "arsenal"
        assert normalize_team_name("Athletic Club") == "athletic"

    def test_diacritics(self):
        assert normalize_team_name("Alavés") == "alaves"
        assert normalize_team_name("Atlético Madrid") == "atletico madrid"

    def test_punctuation_and_ampersand(self):
        assert (
            normalize_team_name("Brighton & Hove Albion")
            == "brighton and hove albion"
        )
        assert normalize_team_name("NJ/NY Gotham FC") == "nj ny gotham"
        assert normalize_team_name("Nott'm Forest") == "nott m forest"

    def test_word_boundary_suffix_only(self):
        # "fc"/"sc" must be stripped only as whole words.
        assert normalize_team_name("San Diego Wave FC") == "san diego wave"
        assert "barcelona" == normalize_team_name("Barcelona")  # 'sc' inside stays
        assert normalize_team_name("FC Barcelona") == "barcelona"


# ---------------------------------------------------------------------------
# resolve_aliases — conservative matching
# ---------------------------------------------------------------------------
class TestResolveAliases:
    def test_exact_match_wins(self):
        res = resolve_aliases(["Arsenal"], frontend("Arsenal", "Aston Villa"))
        assert res["matched"]["Arsenal"]["frontend_name"] == "Arsenal"
        assert res["matched"]["Arsenal"]["match"] == "exact"
        assert res["unmatched_params"] == []
        assert res["unmatched_frontend"] == ["Aston Villa"]

    def test_normalized_match(self):
        res = resolve_aliases(["Bournemouth"], frontend("AFC Bournemouth"))
        assert res["matched"]["Bournemouth"]["frontend_name"] == "AFC Bournemouth"
        assert res["matched"]["Bournemouth"]["match"] == "normalized"

    def test_override_binds_stubborn_spellings(self):
        res = resolve_aliases(
            ["Ath Madrid"],
            frontend("Atlético Madrid"),
            overrides={"Ath Madrid": "Atlético Madrid"},
        )
        assert res["matched"]["Ath Madrid"]["frontend_name"] == "Atlético Madrid"
        assert res["matched"]["Ath Madrid"]["match"] == "override"

    def test_stale_override_is_unmatched_not_guessed(self):
        res = resolve_aliases(
            ["Ath Madrid"],
            frontend("Real Madrid"),
            overrides={"Ath Madrid": "Atlético Madrid"},
        )
        assert res["matched"] == {}
        assert res["unmatched_params"] == ["Ath Madrid"]

    def test_no_partial_name_guessing(self):
        # "Ipswich" vs "Ipswich Town" must NOT match without an override.
        res = resolve_aliases(["Ipswich"], frontend("Ipswich Town"))
        assert res["matched"] == {}
        assert res["unmatched_params"] == ["Ipswich"]
        assert res["unmatched_frontend"] == ["Ipswich Town"]

    def test_ambiguous_normalized_key_is_unmatched(self):
        # Two frontend teams collapse to the same normalized key — refuse both.
        res = resolve_aliases(
            ["United"], frontend("United FC", "United SC")
        )
        assert res["matched"] == {}
        assert res["unmatched_params"] == ["United"]

    def test_two_params_teams_cannot_claim_one_frontend_team(self):
        res = resolve_aliases(
            ["Wave", "Wave FC"], frontend("San Diego Wave"),
            overrides={"Wave": "San Diego Wave", "Wave FC": "San Diego Wave"},
        )
        # Exactly one claims it (deterministically, sorted order); the other
        # is honestly unmatched.
        assert len(res["matched"]) == 1
        assert len(res["unmatched_params"]) == 1
        assert res["unmatched_frontend"] == []

    def test_unmatched_lists_are_sorted_and_complete(self):
        res = resolve_aliases(
            ["Zebra", "Arsenal"], frontend("Arsenal", "Yak City", "Boar Town")
        )
        assert res["unmatched_params"] == ["Zebra"]
        assert res["unmatched_frontend"] == ["Boar Town", "Yak City"]


# ---------------------------------------------------------------------------
# compute_prior_ppg — expected-goals-based tendencies
# ---------------------------------------------------------------------------
def toy_model() -> DixonColesModel:
    return DixonColesModel(
        teams={
            "Strong": {"attack": 0.5, "defence": 0.3},
            "Mid": {"attack": 0.0, "defence": 0.0},
            "Weak": {"attack": -0.5, "defence": -0.3},
        },
        home_adv=0.2,
        rho=-0.05,
    )


class TestComputePriorPpg:
    def test_orders_teams_by_strength(self):
        ppg = compute_prior_ppg(toy_model(), ["Strong", "Mid", "Weak"])
        assert ppg["Strong"] > ppg["Mid"] > ppg["Weak"]

    def test_values_are_valid_ppg(self):
        ppg = compute_prior_ppg(toy_model(), ["Strong", "Mid", "Weak"])
        for v in ppg.values():
            assert 0.0 < v < 3.0
        # A round robin awards between 2 and 3 points per match in total, so
        # the mean PPG must land in that band (≈1.3-1.4 in practice).
        mean = sum(ppg.values()) / len(ppg)
        assert 1.0 < mean < 1.5

    def test_fewer_than_two_teams_yields_no_priors(self):
        assert compute_prior_ppg(toy_model(), ["Strong"]) == {}
        assert compute_prior_ppg(toy_model(), []) == {}

    def test_deterministic(self):
        a = compute_prior_ppg(toy_model(), ["Weak", "Strong", "Mid"])
        b = compute_prior_ppg(toy_model(), ["Mid", "Weak", "Strong"])
        assert a == b


# ---------------------------------------------------------------------------
# build_competition_entry / build_artifact — full pipeline, injected fetcher
# ---------------------------------------------------------------------------
def toy_params() -> dict:
    return {
        "generated_at": "2026-07-15T00:00:00+00:00",
        "competitions": {
            "test.1": {
                "home_adv": 0.2,
                "rho": -0.05,
                "half_life_days": 390.0,
                "fitted_matches": 100,
                "last_match_date": "2026-05-01T00:00:00+00:00",
                "teams": {
                    "Strong": {"attack": 0.5, "defence": 0.3},
                    "Mid FC": {"attack": 0.0, "defence": 0.0},
                    "Weak": {"attack": -0.5, "defence": -0.3},
                    "Ghost Town": {"attack": 0.1, "defence": 0.1},
                },
            }
        },
    }


def toy_fetcher(_competition_id: str) -> list:
    # "Newly Promoted" exists only frontend-side; "Ghost Town" only params-side.
    return frontend("Strong", "Mid", "Weak", "Newly Promoted")


class TestBuildArtifact:
    def test_entry_keys_are_frontend_names_with_prior_ppg(self):
        params = toy_params()
        entry = build_competition_entry(
            "test.1", params["competitions"]["test.1"], toy_fetcher("test.1")
        )
        assert set(entry["teams"].keys()) == {"Strong", "Mid", "Weak"}
        assert entry["teams"]["Mid"]["params_name"] == "Mid FC"
        assert entry["teams"]["Mid"]["match"] == "normalized"
        assert entry["unmatched_params_teams"] == ["Ghost Town"]
        assert entry["unmatched_frontend_teams"] == ["Newly Promoted"]
        # Priors ordered by strength, and rounded floats.
        strong = entry["teams"]["Strong"]["prior_ppg"]
        weak = entry["teams"]["Weak"]["prior_ppg"]
        assert strong > weak
        assert math.isclose(strong, round(strong, 4))

    def test_prior_round_robin_uses_only_matched_teams(self):
        # Ghost Town is unmatched, so priors must be computed over the 3
        # matched teams (2*(3-1)=4 matches each), not over all 4 params teams.
        params = toy_params()
        entry = build_competition_entry(
            "test.1", params["competitions"]["test.1"], toy_fetcher("test.1")
        )
        model = DixonColesModel.from_dict(params["competitions"]["test.1"])
        expected = compute_prior_ppg(model, ["Strong", "Mid FC", "Weak"])
        assert entry["teams"]["Strong"]["prior_ppg"] == round(
            expected["Strong"], 4
        )

    def test_artifact_shape_and_determinism(self):
        params = toy_params()
        now = "2026-07-15T12:00:00+00:00"
        a = build_artifact(params, ["test.1"], fetcher=toy_fetcher, now=now)
        b = build_artifact(params, ["test.1"], fetcher=toy_fetcher, now=now)
        assert a == b
        assert a["schema"] == 1
        assert a["params_generated_at"] == "2026-07-15T00:00:00+00:00"
        assert "test.1" in a["competitions"]

    def test_fetch_failure_skips_competition(self):
        def failing_fetcher(_cid: str) -> list:
            raise ValueError("boom")

        artifact = build_artifact(
            toy_params(), ["test.1"], fetcher=failing_fetcher, now="x"
        )
        assert artifact["competitions"] == {}

    def test_unknown_competition_skipped(self):
        artifact = build_artifact(
            toy_params(), ["nope.9"], fetcher=toy_fetcher, now="x"
        )
        assert artifact["competitions"] == {}


# ---------------------------------------------------------------------------
# Committed artifact integrity (repo state, no network)
# ---------------------------------------------------------------------------
class TestCommittedArtifact:
    def test_committed_artifact_is_consistent(self):
        import json
        from backend.scripts.build_sim_priors import DEFAULT_OUTPUT, PARAMS_PATH

        if not DEFAULT_OUTPUT.exists():
            pytest.skip("sim_priors.json not built yet")
        artifact = json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))
        params = json.loads(PARAMS_PATH.read_text(encoding="utf-8"))
        assert artifact["schema"] == 1
        for cid, comp in artifact["competitions"].items():
            param_teams = set(params["competitions"][cid]["teams"])
            for frontend_name, entry in comp["teams"].items():
                # Every emitted prior traces back to a real params team.
                assert entry["params_name"] in param_teams
                assert 0.0 < entry["prior_ppg"] < 3.0
                assert entry["match"] in {"exact", "normalized", "override"}
            # Unmatched params teams are real params names too.
            for name in comp["unmatched_params_teams"]:
                assert name in param_teams
