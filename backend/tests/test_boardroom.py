"""Tests for the Boardroom grounding bundle, verifier, dissent index, and the
build_boardroom --dry-run pipeline.

The verifier is the safety-critical piece: it must accept grounded prose across
formatting variants and reject any ungrounded number or banned term.
"""

from __future__ import annotations

import json

import pytest

from backend.scripts.build_boardroom import main as build_main
from backend.services.llm.grounding import (
    BoardroomBundle,
    Precedent,
    RecentMiss,
    build_boardroom_bundle,
    dissent_index,
    dissent_level,
    parse_persona_output,
    verify_text,
)

# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

MATCH = {
    "match_id": "999",
    "home_team": "Alpha FC",
    "away_team": "Beta FC",
    "league": "Test League",
    "match_date": "2026-08-01",
    "predicted_home_win": 0.5,
    "predicted_draw": 0.3,
    "predicted_away_win": 0.2,
    "predicted_home_goals": 1.6,
    "predicted_away_goals": 1.1,
    "predicted_scoreline": "2-1",
    "predicted_winner": "home",
    "confidence": 50.0,
    "gender": "M",
}

METRICS = {
    "winner_accuracy": 0.606,
    "high_confidence_accuracy": 0.682,
    "brier_score": 0.62,
    "expected_calibration_error": 0.03,
    "completed_predictions": 11661,
}

RARITY_STATES = {
    "M:0:0": {"n": 66022, "w": 24847, "d": 16328, "l": 24847},
    "M:1:45": {"n": 13856, "w": 9408, "d": 2902, "l": 1546},
    "M:-1:45": {"n": 13856, "w": 1546, "d": 2902, "l": 9408},
    "M:0:45": {"n": 27804, "w": 8946, "d": 9912, "l": 8946},
}


def make_bundle(**overrides) -> BoardroomBundle:
    b = build_boardroom_bundle(MATCH, metrics=METRICS, rarity_states=RARITY_STATES)
    for k, v in overrides.items():
        setattr(b, k, v)
    return b


# --------------------------------------------------------------------------- #
# Bundle assembly
# --------------------------------------------------------------------------- #


def test_bundle_normalizes_probabilities_and_picks_lean():
    b = make_bundle()
    assert b.home_p == pytest.approx(0.5, abs=1e-3)
    assert b.lean == "home"
    assert b.winner_accuracy_pct == 60.6
    assert b.high_conf_accuracy_pct == 68.2
    assert b.calibration_sample == 11661


def test_bundle_builds_precedents_from_rarity_states():
    b = make_bundle()
    labels = [p.label for p in b.precedents]
    assert "level at kickoff" in labels
    assert b.base_rate is not None and b.base_rate.n == 66022


def test_bundle_omits_precedents_when_no_rarity():
    b = build_boardroom_bundle(MATCH, metrics=METRICS, rarity_states=None)
    assert b.precedents == []
    assert b.base_rate is None


def test_precedent_below_min_sample_is_dropped():
    thin = {"M:0:0": {"n": 10, "w": 4, "d": 3, "l": 3}}
    b = build_boardroom_bundle(MATCH, metrics=METRICS, rarity_states=thin)
    assert b.precedents == []


# --------------------------------------------------------------------------- #
# Verifier — accept
# --------------------------------------------------------------------------- #


def test_verifier_accepts_grounded_text_across_formats():
    b = make_bundle()
    # 50% (home 0.5), "30 percent" (draw 0.3), 0.20 (away 0.2), 60.6% accuracy,
    # 66022 precedent count — all present in the bundle, three different formats.
    text = (
        "The home side sits at 50%, the draw at 30 percent and the visitors 0.20. "
        "On settled calls winner accuracy is 60.6%, and across 66022 comparable "
        "matches the split was even."
    )
    v = verify_text(text, b)
    assert v.ok, v.reason


def test_verifier_accepts_percent_fraction_equivalence():
    b = make_bundle(home_p=0.64, draw_p=0.20, away_p=0.16)
    for phrasing in ("64%", "64 percent", "0.64"):
        v = verify_text(f"The hosts land at {phrasing} on the day.", b)
        assert v.ok, f"{phrasing}: {v.reason}"


def test_verifier_allows_team_name_containing_banned_substring():
    # "Real Betis" contains "bet" but is a proper noun we handed the persona.
    b = make_bundle(home_team="Real Betis")
    v = verify_text("Real Betis look the sharper side here.", b)
    assert v.ok, v.reason


# --------------------------------------------------------------------------- #
# Verifier — reject
# --------------------------------------------------------------------------- #


def test_verifier_rejects_ungrounded_number():
    b = make_bundle()
    v = verify_text("The home side wins 88% of matches like this.", b)
    assert not v.ok
    assert "88%" in v.ungrounded_numbers


def test_verifier_rejects_ungrounded_scoreline():
    b = make_bundle()  # predicted scoreline is 2-1
    v = verify_text("Expect a comfortable 4-0 for the hosts.", b)
    assert not v.ok
    # 4 and 0 are not grounded (0 is only grounded if a fact is 0; none here)
    assert any(tok in ("4", "0") for tok in v.ungrounded_numbers)


@pytest.mark.parametrize(
    "text",
    [
        "The odds strongly favour the hosts.",
        "Place a small bet on the draw.",
        "The Elo gap is decisive here.",
        "A Poisson read gives the edge to Alpha.",
        "Our data comes from FotMob and ESPN feeds.",
        "The bookmaker consensus disagrees.",
    ],
)
def test_verifier_rejects_banned_terms(text):
    b = make_bundle()
    v = verify_text(text, b)
    assert not v.ok
    assert v.banned_terms


def test_verifier_checks_claims_too():
    b = make_bundle()
    v = verify_text("A grounded sentence at 50%.", b, extra_claims=["hidden 88% claim"])
    assert not v.ok
    assert "88%" in v.ungrounded_numbers


# --------------------------------------------------------------------------- #
# Dissent index
# --------------------------------------------------------------------------- #


def test_dissent_index_zero_when_all_agree():
    d = {"home": 0.5, "draw": 0.3, "away": 0.2}
    assert dissent_index([d, d, d]) == 0.0
    assert dissent_level(0.0) == "low"


def test_dissent_index_grows_with_disagreement():
    idx = dissent_index(
        [
            {"home": 0.8, "draw": 0.1, "away": 0.1},
            {"home": 0.1, "draw": 0.1, "away": 0.8},
            {"home": 0.33, "draw": 0.34, "away": 0.33},
        ]
    )
    assert 0.0 < idx <= 1.0
    assert dissent_level(idx) in ("moderate", "high")


def test_dissent_index_needs_two_views():
    assert dissent_index([{"home": 0.5, "draw": 0.3, "away": 0.2}]) == 0.0


# --------------------------------------------------------------------------- #
# Persona output parsing
# --------------------------------------------------------------------------- #


def test_parse_persona_output_tolerates_code_fence():
    raw = '```json\n{"stance":"home","implied_probs":{"home":0.6,"draw":0.2,"away":0.2},"text":"hi","claims":["c"]}\n```'
    out = parse_persona_output(raw)
    assert out is not None
    assert out["stance"] == "home"
    assert out["text"] == "hi"
    assert sum(out["implied_probs"].values()) == pytest.approx(1.0)


def test_parse_persona_output_returns_none_on_garbage():
    assert parse_persona_output("not json at all") is None


# --------------------------------------------------------------------------- #
# End-to-end build --dry-run
# --------------------------------------------------------------------------- #


def test_build_dry_run_writes_valid_artifact(tmp_path):
    out = tmp_path / "debates.json"
    rc = build_main(["--dry-run", "--days", "120", "--limit", "3", "--output", str(out)])
    assert rc == 0
    assert out.exists()
    artifact = json.loads(out.read_text())
    assert artifact["schema"] == 1
    assert artifact["provider"] == "fake"
    assert artifact["model"]
    assert artifact["count"] == len(artifact["debates"])
    for entry in artifact["debates"].values():
        assert len(entry["personas"]) >= 2
        assert 0.0 <= entry["dissent_index"] <= 1.0
        assert entry["dissent_level"] in ("low", "moderate", "high")
        for p in entry["personas"]:
            assert p["name"] and p["text"]


# --------------------------------------------------------------------------- #
# Request pacing (free-tier RPM budgets)
# --------------------------------------------------------------------------- #


def test_request_pacer_spaces_calls_to_budget():
    from backend.scripts.build_boardroom import RequestPacer

    now = [0.0]
    slept = []

    def clock():
        return now[0]

    def sleep(s):
        slept.append(s)
        now[0] += s

    pace = RequestPacer(rpm=6, sleep=sleep, clock=clock)  # 10s interval
    pace()  # first call: no wait
    assert slept == []
    now[0] += 3.0  # 3s of work
    pace()  # must wait the remaining 7s
    assert slept == [pytest.approx(7.0)]
    now[0] += 12.0  # slower than the budget
    pace()  # no wait needed
    assert len(slept) == 1


def test_request_pacer_zero_rpm_is_noop():
    from backend.scripts.build_boardroom import RequestPacer

    pace = RequestPacer(rpm=0, sleep=lambda s: (_ for _ in ()).throw(AssertionError), clock=lambda: 0.0)
    pace()
    pace()
