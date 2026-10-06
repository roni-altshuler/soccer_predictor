"""Serving-path evaluation must preserve chronological and paired knowledge."""

import copy
import json
from pathlib import Path

import numpy as np
import pytest

from backend.scripts import evaluate_season_adaptation as evaluator
from backend.scripts.train_layered import FeatureState, featurise, replay_features
from backend.tests.fixtures.make_season_adaptation_journal import demo_journal


@pytest.fixture
def payload():
    return demo_journal()


def run(payload):
    return evaluator.run_evaluation(payload, sims=100, seed=17)


def first_season(payload):
    payload["evaluations"] = payload["evaluations"][:1]
    return payload


def forecast_arrays(point):
    return {arm: [f[arm] for f in point["forecasts"]] for arm in evaluator.ARMS}


def test_replay_is_the_existing_featurise_path_and_day_blocked(payload, monkeypatch):
    journal = evaluator.Journal(payload)
    played = journal.results_before(evaluator.timestamp("2024-08-01T00:00:00Z"))
    seen, log = [], []
    old_emit, old_observe = FeatureState.emit, FeatureState.observe
    # Reproduce the former serving loop, independently of replay_features.
    previous, expected_rows = FeatureState(), []
    for day in sorted({m["local_date"] for m in played}):
        block = [m for m in played if m["local_date"] == day]
        expected_rows.extend(previous.emit(m) for m in block)
        for m in block:
            previous.observe(m)

    def emit(self, match):
        log.append((match["local_date"], tuple(seen)))
        return old_emit(self, match)

    def observe(self, match):
        seen.append(match["local_date"])
        return old_observe(self, match)

    monkeypatch.setattr(FeatureState, "emit", emit)
    monkeypatch.setattr(FeatureState, "observe", observe)
    X, names, y, elo, state = replay_features(played)
    np.testing.assert_equal(X, [[r[n] for n in names] for r in expected_rows])
    assert dict(state.elo.rating) == dict(previous.elo.rating)
    assert all(all(day < current for day in history) for current, history in log)
    assert sum(len(h) for h in state.results.values()) == 60
    seen.clear()
    X_old, names_old, y_old, elo_old = featurise(played)
    np.testing.assert_equal(X, X_old)
    np.testing.assert_equal(y, y_old)
    np.testing.assert_equal(elo, elo_old)
    assert names == names_old


def test_real_serving_functions_receive_identical_conditions(payload, monkeypatch):
    payload = first_season(payload)
    calls, fits = [], []
    simulate, fit = evaluator.simulate_season, evaluator.fit_head

    def record_sim(fixtures, table, *, sims, rng):
        # Input schedules never include a result/target label or score.
        assert all(
            not ({"result", "home_score", "away_score"} & set(f)) for f in fixtures
        )
        calls.append(
            (
                copy.deepcopy(table),
                [f["match_uid"] for f in fixtures],
                copy.deepcopy(rng.bit_generator.state),
            )
        )
        return simulate(fixtures, table, sims=sims, rng=rng)

    def record_fit(X, y, cols):
        fits.append(len(y))
        return fit(X, y, cols)

    monkeypatch.setattr(evaluator, "simulate_season", record_sim)
    monkeypatch.setattr(evaluator, "fit_head", record_fit)
    report = run(payload)
    assert all(calls[i] == calls[i + 1] for i in range(0, len(calls), 2))
    assert fits[-3:] == [300, 306, 315]
    preseason = report["points"][0]
    assert (
        preseason["arms"]["adaptive"] == preseason["arms"]["frozen_preseason_strength"]
    )
    later = report["points"][1]
    assert later["played_n"] == 6
    assert sum(r["played"] for r in later["standings"].values()) == 12
    assert (
        forecast_arrays(later)["adaptive"]
        != forecast_arrays(later)["frozen_preseason_strength"]
    )


def test_input_order_and_duplicate_results_do_not_influence_state_or_scores(payload):
    original = run(first_season(copy.deepcopy(payload)))
    payload = first_season(payload)
    payload["fixtures"] = list(reversed(payload["fixtures"])) + payload["fixtures"][:2]
    payload["observations"] = (
        list(reversed(payload["observations"])) + payload["observations"][:3]
    )
    repeated = copy.deepcopy(payload["observations"][0])
    repeated["observed_at"] = "2025-10-30T00:00:00Z"
    payload["observations"].append(repeated)
    duplicate = run(payload)
    assert duplicate["points"] == original["points"]
    assert duplicate["summary"] == original["summary"]
    assert duplicate["audit"]["unique_fixtures"] == 360
    assert duplicate["audit"]["input_result_observations"] == 364


def test_different_provider_ids_for_identical_fixture_are_one_match(payload):
    original = run(first_season(copy.deepcopy(payload)))
    payload = first_season(payload)
    alias = dict(payload["fixtures"][0], fixture_id="zz-alias")
    payload["fixtures"].append(alias)
    payload["observations"].append(
        dict(payload["observations"][0], fixture_id="zz-alias")
    )
    duplicate = run(payload)
    assert duplicate["points"] == original["points"]
    assert duplicate["audit"]["unique_result_observations"] == 360


def test_future_results_and_corrections_cannot_move_earlier_predictions(payload):
    original = run(first_season(copy.deepcopy(payload)))
    payload = first_season(payload)
    result = copy.deepcopy(payload["observations"][300])
    result.update(observed_at="2024-08-25T00:00:00Z", home_score=2, away_score=0)
    payload["observations"].append(result)
    revised = run(payload)
    assert all(
        forecast_arrays(a) == forecast_arrays(b)
        for a, b in zip(original["points"][:2], revised["points"][:2])
    )
    assert forecast_arrays(original["points"][2]) != forecast_arrays(
        revised["points"][2]
    )
    assert revised["points"][2]["train_n"] == original["points"][2]["train_n"]
    assert revised["points"][2]["played_n"] == original["points"][2]["played_n"]
    changed = copy.deepcopy(payload)
    for result in changed["observations"]:
        if result["fixture_id"].startswith("synthetic-2025"):
            result.update(home_score=10, away_score=0)
    assert [forecast_arrays(p) for p in run(changed)["points"]] == [
        forecast_arrays(p) for p in revised["points"]
    ]


def test_delayed_observations_and_exact_horizon_are_excluded(payload):
    journal = evaluator.Journal(payload)
    cutoff = evaluator.timestamp("2024-08-16T00:00:00Z")
    assert len(journal.results_before(cutoff)) == 306
    delayed = payload["observations"][300]
    delayed["observed_at"] = cutoff.isoformat()
    journal = evaluator.Journal(payload)
    assert len(journal.results_before(cutoff)) == 305
    assert (
        len(journal.results_before(evaluator.timestamp("2024-08-17T00:00:00Z"))) == 309
    )
    # Even a known result cannot be consumed during its own date.
    assert (
        len(journal.results_before(evaluator.timestamp("2024-08-02T00:00:00Z"))) == 300
    )
    with pytest.raises(ValueError, match="Past unresolved"):
        run(first_season(payload))


def test_correction_replaces_result_and_rebuilds_rolling_state(payload):
    correction = dict(
        payload["observations"][300],
        observed_at="2024-08-25T00:00:00Z",
        home_score=7,
        away_score=0,
    )
    payload["observations"].append(correction)
    journal = evaluator.Journal(payload)
    before = journal.results_before(evaluator.timestamp("2024-08-20T00:00:00Z"))
    after = journal.results_before(evaluator.timestamp("2024-09-06T00:00:00Z"))
    target = correction["fixture_id"]
    assert next(m for m in before if m["match_uid"] == target)["home_score"] != 7
    assert [m["home_score"] for m in after if m["match_uid"] == target] == [7]
    expected = FeatureState()
    for match in after:
        expected.observe(match)
    _, _, _, _, state = replay_features(after)
    assert dict(state.elo.rating) == dict(expected.elo.rating)
    assert dict(state.results) == dict(expected.results)


def test_season_rollover_freezes_a_new_preseason_and_resets_only_standings(payload):
    report = run(payload)
    second = report["points"][3]
    assert second["season"] == 2025
    assert second["train_n"] == 330
    assert second["played_n"] == 0
    assert all(r["points"] == r["played"] == 0 for r in second["standings"].values())
    assert second["arms"]["adaptive"] == second["arms"]["frozen_preseason_strength"]
    assert forecast_arrays(second) != forecast_arrays(report["points"][0])
    assert report["n_unique_scored_fixtures"] == 60
    assert report["summary"]["adaptive"]["match_1x2"]["n"] == 138
    assert report["summary"]["adaptive"]["title"]["n_seasons"] == 2
    assert report["summary"]["adaptive"]["title"]["calibration"]["n"] == 36
    assert report["production_eligible"] is False


@pytest.mark.parametrize(
    "mutation, message",
    [
        (
            lambda p: p["observations"].append(
                dict(p["observations"][0], home_score=9)
            ),
            "Conflicting",
        ),
        (
            lambda p: p["fixtures"].append(
                dict(p["fixtures"][0], away_key="demo.1::Other")
            ),
            "changes identity",
        ),
        (
            lambda p: p["fixtures"].append(
                dict(p["fixtures"][0], fixture_id="new", local_date="2014-08-03")
            ),
            "Repeated ordered pair",
        ),
        (lambda p: p["observations"].pop(), "partial truth"),
        (
            lambda p: p["fixtures"][300].update(known_at="2024-08-01T00:00:00Z"),
            "Full schedule",
        ),
        (
            lambda p: p["observations"][0].update(home_score=None),
            "nonnegative integers",
        ),
        (
            lambda p: p["observations"][0].update(home_score=True),
            "nonnegative integers",
        ),
        (
            lambda p: p["observations"][0].update(observed_at="2014-08-01T00:00:00Z"),
            "before its fixture",
        ),
        (
            lambda p: p["evaluations"][0]["cuts"].append(
                p["evaluations"][0]["cuts"][0]
            ),
            "Unique cuts",
        ),
        (
            lambda p: p["evaluations"].append(p["evaluations"][0]),
            "Duplicate evaluation",
        ),
        (lambda p: p.update(score_as_of="2025-09-06T00:00:00Z"), "Scoring horizon"),
        (
            lambda p: p["evaluations"][0].update(
                preseason_as_of="2024-08-16T00:00:00Z", cuts=["2024-08-16T00:00:00Z"]
            ),
            "Full schedule",
        ),
    ],
)
def test_ambiguous_incomplete_or_leaky_inputs_fail_closed(payload, mutation, message):
    mutation(payload)
    with pytest.raises(ValueError, match=message):
        run(payload)


@pytest.mark.parametrize(
    "value", ["2024-08-01", "2024-08-01T00:00:00+02:00", "2024-08-01T12:00:00Z"]
)
def test_horizons_require_explicit_midnight_utc(value):
    with pytest.raises(ValueError):
        evaluator.timestamp(value, horizon=True)


def test_cli_reproducible_json_and_refusal_preserves_output(payload, tmp_path):
    source, output = tmp_path / "journal.json", tmp_path / "evaluation.json"
    source.write_text(json.dumps(payload))
    args = ["--input", str(source), "--output", str(output), "--sims", "100"]
    assert evaluator.main(args) == 0
    previous = output.read_bytes()
    assert evaluator.main(args) == 0
    assert output.read_bytes() == previous
    payload["observations"].pop()
    source.write_text(json.dumps(payload))
    with pytest.raises(SystemExit) as error:
        evaluator.main(args)
    assert error.value.code == 2
    assert output.read_bytes() == previous


def test_cli_refuses_input_overwrite_and_production_artifact_output(payload, tmp_path):
    source = tmp_path / "journal.json"
    source.write_text(json.dumps(payload))
    for output in (
        source,
        Path(__file__).parents[1] / "data" / "predictions" / "no.json",
    ):
        with pytest.raises(SystemExit) as error:
            evaluator.main(["--input", str(source), "--output", str(output)])
        assert error.value.code == 2


@pytest.mark.parametrize("sims", [0, 99, 5001])
def test_simulation_budget_is_bounded(payload, sims):
    with pytest.raises(ValueError, match="Simulation count"):
        evaluator.run_evaluation(payload, sims=sims)


def test_metric_scales_and_calibration_counts():
    scored = evaluator.metrics(
        np.array([[1 / 3, 1 / 3, 1 / 3]] * 3), np.array([0, 1, 2])
    )
    assert scored["n"] == 3
    assert scored["brier"] == pytest.approx(2 / 3)
    assert scored["log_loss"] == pytest.approx(np.log(3))
    assert (
        scored["calibration"]["n"]
        == sum(b["n"] for b in scored["calibration"]["bins"])
        == 9
    )
    assert scored["calibration"]["ece"] == pytest.approx(0)


def test_serving_coherence_failure_refuses_partial_evaluation(payload, monkeypatch):
    monkeypatch.setattr(evaluator, "reconcile", lambda *args: (0.1, 6.0))
    with pytest.raises(ValueError, match="Serving scoreline reconciliation failed"):
        run(first_season(payload))


def test_club_with_no_prior_history_keeps_serving_default(payload):
    journal = evaluator.Journal(payload)
    played = journal.results_before(evaluator.timestamp("2024-08-01T00:00:00Z"))
    state = replay_features(played)[4]
    fixture = dict(played[-1], home_key="demo.1::Promoted")
    features = state.emit(fixture)
    assert features["elo_home"] == 1500
    assert features["form_h_played"] == 0
    assert np.isnan(features["form_h_pts_5"])
    assert features["elo_away"] != 1500


@pytest.mark.parametrize(
    "field, values",
    [
        ("fixtures", [0, evaluator.MAX_FIXTURES + 1]),
        ("observations", [0, evaluator.MAX_OBSERVATIONS + 1]),
    ],
)
def test_journal_count_budgets(payload, field, values):
    row = payload[field][0]
    for count in values:
        payload[field] = [row] * count
        with pytest.raises(ValueError, match="bounded evaluation budget"):
            evaluator.Journal(payload)


def test_horizon_budget_and_insufficient_warmup(payload):
    too_many = copy.deepcopy(payload)
    too_many["evaluations"][0]["cuts"] *= 5
    with pytest.raises(ValueError, match="bounded forecast horizons"):
        run(too_many)
    payload["observations"] = [
        o for o in payload["observations"] if int(o["fixture_id"].split("-")[1]) >= 2024
    ]
    with pytest.raises(ValueError, match="earlier results covering"):
        run(payload)
