"""Tests for backend/scripts/backtest_season_projections.py.

Every test here runs on SYNTHETIC data — hand-built fixture lists and a
throwaway SQLite warehouse in tmp_path — so the suite passes identically
whether the real warehouse is complete, partial, mid-rebuild or absent.

Three things are pinned:

1. The scoring functions. Brier, multiclass log loss, position MAE and the
   reliability table are the whole point of the artifact; if they drift, every
   published number drifts with them.
2. The season plumbing — table construction, matchday cuts, the completeness
   gate — because a wrong table means the ground truth is wrong and the metrics
   are meaningless even when the maths is right.
3. Graceful degradation. PIVOT_2026-08 forbids fabricated data: a missing or
   empty warehouse must produce an artifact that honestly reports zero
   coverage, never a crash and never a made-up number.
"""

from __future__ import annotations

import itertools
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import pytest

from backend.scripts.backtest_season_projections import (
    RELEGATION_SLOTS,
    CalibrationAccumulator,
    PointInTimeElo,
    actual_outcome,
    aggregate_by_matchday,
    aggregate_by_season_fraction,
    brier_score,
    build_table,
    convergence_thresholds,
    eligibility,
    first_sustained,
    main,
    margin,
    matchday_blocks,
    multiclass_log_loss,
    naive_baseline_projection,
    overall_summary,
    position_mae,
    preseeded_elo,
    run_backtest,
    score_projection,
    season_integrity,
    simulator_standings,
    top_k_recall,
)
from backend.services.data.warehouse import MatchRow, Warehouse

# ---------------------------------------------------------------------------
# Synthetic season fixtures
# ---------------------------------------------------------------------------
TEAMS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]


def make_match(home: str, away: str, hs: int, as_: int, date: str) -> Dict[str, Any]:
    return {
        "match_id": f"{date}-{home}-{away}",
        "date_utc": f"{date}T15:00:00+00:00",
        "home": home,
        "away": away,
        "home_score": hs,
        "away_score": as_,
    }


def deterministic_season(
    teams: List[str] = TEAMS, start: str = "2020-08-08"
) -> List[Dict[str, Any]]:
    """A complete double round-robin where the table is known by construction.

    Every team is assigned a strength equal to its index; the stronger side
    always wins by exactly one goal, so the final table is the reverse of
    ``teams`` with no ties anywhere. One fixture per calendar day per round,
    rounds spaced a week apart so the date-gap matchday blocking produces
    exactly one block per round.
    """
    day = datetime.fromisoformat(start)
    pairs = [(h, a) for h, a in itertools.permutations(teams, 2)]
    n_rounds = len(teams) - 1
    per_round = max(1, len(pairs) // (2 * n_rounds))
    matches: List[Dict[str, Any]] = []
    round_idx = 0
    for i in range(0, len(pairs), per_round):
        date = (day + timedelta(days=7 * round_idx)).date().isoformat()
        for home, away in pairs[i : i + per_round]:
            if teams.index(home) > teams.index(away):
                hs, as_ = 2, 1
            else:
                hs, as_ = 1, 2
            matches.append(make_match(home, away, hs, as_, date))
        round_idx += 1
    matches.sort(key=lambda m: (m["date_utc"], m["match_id"]))
    return matches


# ---------------------------------------------------------------------------
# build_table
# ---------------------------------------------------------------------------
class TestBuildTable:
    def test_points_and_goal_difference(self):
        matches = [
            make_match("Alpha", "Bravo", 3, 0, "2020-08-08"),
            make_match("Charlie", "Delta", 1, 1, "2020-08-08"),
        ]
        table = {r["team"]: r for r in build_table(matches)}
        assert table["Alpha"]["points"] == 3
        assert table["Alpha"]["goal_diff"] == 3
        assert table["Bravo"]["points"] == 0
        assert table["Bravo"]["goal_diff"] == -3
        assert table["Charlie"]["points"] == 1 and table["Delta"]["points"] == 1
        assert table["Alpha"]["position"] == 1

    def test_teams_seed_puts_unplayed_clubs_on_zero(self):
        table = build_table([], teams=TEAMS)
        assert len(table) == len(TEAMS)
        assert {r["points"] for r in table} == {0}
        assert {r["played"] for r in table} == {0}
        # Positions must still be a full 1..n permutation, deterministically.
        assert [r["position"] for r in table] == list(range(1, len(TEAMS) + 1))
        assert [r["team"] for r in table] == sorted(TEAMS)

    def test_ordering_is_points_then_gd_then_gf(self):
        matches = [
            # Bravo and Charlie both finish on 3 points; Bravo has the better GD.
            make_match("Bravo", "Delta", 5, 0, "2020-08-08"),
            make_match("Charlie", "Echo", 1, 0, "2020-08-08"),
        ]
        order = [r["team"] for r in build_table(matches)]
        assert order.index("Bravo") < order.index("Charlie")

    def test_unfinished_matches_are_ignored(self):
        matches = [
            make_match("Alpha", "Bravo", 1, 0, "2020-08-08"),
            {
                "match_id": "x",
                "date_utc": "2020-08-09T15:00:00+00:00",
                "home": "Alpha",
                "away": "Charlie",
                "home_score": None,
                "away_score": None,
            },
        ]
        table = {r["team"]: r for r in build_table(matches)}
        assert table["Alpha"]["played"] == 1

    def test_deterministic_season_final_table_is_known(self):
        season = deterministic_season()
        table = build_table(season, teams=TEAMS)
        assert [r["team"] for r in table] == list(reversed(TEAMS))
        assert table[0]["played"] == 2 * (len(TEAMS) - 1)


# ---------------------------------------------------------------------------
# matchday blocking / integrity / eligibility
# ---------------------------------------------------------------------------
class TestSeasonPlumbing:
    def test_matchday_blocks_split_on_gaps(self):
        matches = [
            make_match("Alpha", "Bravo", 1, 0, "2020-08-08"),
            make_match("Charlie", "Delta", 1, 0, "2020-08-09"),  # same block
            make_match("Echo", "Foxtrot", 1, 0, "2020-08-15"),  # new block
        ]
        blocks = matchday_blocks(matches)
        assert [len(b) for b in blocks] == [2, 1]

    def test_deterministic_season_has_one_block_per_round(self):
        season = deterministic_season()
        blocks = matchday_blocks(season)
        assert len(blocks) == 2 * (len(TEAMS) - 1)
        assert sum(len(b) for b in blocks) == len(season)

    def test_season_integrity_counts(self):
        integ = season_integrity(deterministic_season())
        assert integ["n_teams"] == 6
        assert integ["expected_matches"] == 30
        assert integ["n_matches"] == 30
        assert integ["completeness"] == pytest.approx(1.0)
        assert integ["min_team_matches"] == integ["max_team_matches"] == 10

    def test_eligibility_accepts_a_finished_complete_season(self):
        integ = season_integrity(deterministic_season())
        assert eligibility(integ, "2020-11-01", 0.95) is None

    def test_eligibility_rejects_incomplete_season(self):
        season = deterministic_season()[:20]
        reason = eligibility(season_integrity(season), "2020-11-01", 0.95)
        assert reason is not None and "complete" in reason

    def test_eligibility_rejects_season_still_in_progress(self):
        integ = season_integrity(deterministic_season())
        today = datetime.now(timezone.utc).date().isoformat()
        reason = eligibility(integ, today, 0.95)
        assert reason is not None and "grace" in reason

    def test_eligibility_rejects_tiny_league(self):
        matches = [make_match("Alpha", "Bravo", 1, 0, "2020-08-08")]
        reason = eligibility(season_integrity(matches), "2020-11-01", 0.5)
        assert reason is not None and "teams" in reason

    def test_simulator_standings_uses_keys_the_simulator_reads(self):
        table = build_table(deterministic_season(), teams=TEAMS)
        rows = simulator_standings(table)
        assert set(rows[0]) == {"name", "position", "points", "played", "goal_diff"}
        # The simulator uses `row.get("idx") or row.get("position")` chains, so
        # the FotMob-style keys must be absent rather than present-and-zero.
        assert "idx" not in rows[0] and "pts" not in rows[0]
        assert "goalConDiff" not in rows[0]


# ---------------------------------------------------------------------------
# actual_outcome
# ---------------------------------------------------------------------------
class TestActualOutcome:
    def test_champion_relegation_and_top4(self):
        table = build_table(deterministic_season(), teams=TEAMS)
        actual = actual_outcome(table)
        assert actual["champion"] == "Foxtrot"  # strongest by construction
        assert actual["relegated"] == {"Charlie", "Bravo", "Alpha"}
        assert len(actual["relegated"]) == RELEGATION_SLOTS
        assert actual["top_4"] == {"Foxtrot", "Echo", "Delta", "Charlie"}
        assert actual["position"]["Foxtrot"] == 1
        assert actual["position"]["Alpha"] == 6

    def test_empty_table_raises(self):
        with pytest.raises(ValueError):
            actual_outcome([])


# ---------------------------------------------------------------------------
# Scoring primitives
# ---------------------------------------------------------------------------
class TestBrier:
    def test_perfect_forecast_scores_zero(self):
        probs = {"Alpha": 1.0, "Bravo": 0.0, "Charlie": 0.0}
        assert brier_score(probs, {"Alpha"}) == pytest.approx(0.0)

    def test_confident_and_wrong_is_the_worst_case(self):
        probs = {"Alpha": 1.0, "Bravo": 0.0}
        # (1-0)^2 + (0-1)^2 = 2, averaged over 2 teams = 1.0
        assert brier_score(probs, {"Bravo"}) == pytest.approx(1.0)

    def test_known_value(self):
        probs = {"Alpha": 0.6, "Bravo": 0.3, "Charlie": 0.1}
        expected = ((0.6 - 1) ** 2 + 0.3**2 + 0.1**2) / 3
        assert brier_score(probs, {"Alpha"}) == pytest.approx(expected)

    def test_averaged_over_teams_so_league_size_is_comparable(self):
        # Same forecast quality in a 4-team and an 8-team league.
        four = {f"t{i}": (1.0 if i == 0 else 0.0) for i in range(4)}
        eight = {f"t{i}": (1.0 if i == 0 else 0.0) for i in range(8)}
        assert brier_score(four, {"t0"}) == brier_score(eight, {"t0"}) == 0.0

    def test_multi_positive_event(self):
        probs = {"a": 0.5, "b": 0.5, "c": 0.0, "d": 0.0}
        # ((0.5-1)^2 + (0.5-1)^2 + 0 + 0) / 4
        assert brier_score(probs, {"a", "b"}) == pytest.approx(0.125)

    def test_empty_probs_raises(self):
        with pytest.raises(ValueError):
            brier_score({}, set())

    def test_unknown_positive_raises_rather_than_silently_scoring(self):
        with pytest.raises(ValueError):
            brier_score({"Alpha": 1.0}, {"Ghost"})


class TestMulticlassLogLoss:
    def test_certain_and_right_is_zero(self):
        probs = {"Alpha": 1.0, "Bravo": 0.0, "Charlie": 0.0}
        assert multiclass_log_loss(probs, "Alpha", eps=1e-9) == pytest.approx(
            0.0, abs=1e-6
        )

    def test_uniform_over_n_is_log_n(self):
        probs = {f"t{i}": 0.05 for i in range(20)}
        assert multiclass_log_loss(probs, "t3") == pytest.approx(math.log(20))

    def test_unnormalised_monte_carlo_output_is_renormalised(self):
        # 4dp rounding in the simulator means these need not sum to 1.
        probs = {"Alpha": 0.5001, "Bravo": 0.4998}
        expected = -math.log(0.5001 / (0.5001 + 0.4998))
        assert multiclass_log_loss(probs, "Alpha") == pytest.approx(expected)

    def test_zero_probability_is_clipped_not_infinite(self):
        probs = {"Alpha": 1.0, "Bravo": 0.0}
        loss = multiclass_log_loss(probs, "Bravo", eps=1e-6)
        assert math.isfinite(loss)
        assert loss == pytest.approx(-math.log(1e-6 / (1.0 + 1e-6)), rel=1e-6)

    def test_smaller_eps_penalises_a_wrong_certainty_harder(self):
        probs = {"Alpha": 1.0, "Bravo": 0.0}
        assert multiclass_log_loss(probs, "Bravo", eps=1e-9) > multiclass_log_loss(
            probs, "Bravo", eps=1e-3
        )

    def test_unknown_winner_raises(self):
        with pytest.raises(ValueError):
            multiclass_log_loss({"Alpha": 1.0}, "Ghost")


class TestPositionMae:
    def test_perfect_projection(self):
        assert position_mae({"a": 1.0, "b": 2.0}, {"a": 1, "b": 2}) == 0.0

    def test_known_value(self):
        projected = {"a": 1.5, "b": 3.0, "c": 2.5}
        actual = {"a": 1, "b": 2, "c": 3}
        assert position_mae(projected, actual) == pytest.approx((0.5 + 1.0 + 0.5) / 3)

    def test_missing_actual_raises(self):
        with pytest.raises(ValueError):
            position_mae({"a": 1.0}, {"b": 1})


class TestTopKRecall:
    def test_all_three_found(self):
        probs = {"a": 0.9, "b": 0.8, "c": 0.7, "d": 0.1}
        assert top_k_recall(probs, {"a", "b", "c"}, 3) == pytest.approx(1.0)

    def test_partial(self):
        probs = {"a": 0.9, "b": 0.8, "c": 0.7, "d": 0.1}
        assert top_k_recall(probs, {"a", "d"}, 3) == pytest.approx(0.5)

    def test_empty_positives_is_nan(self):
        assert math.isnan(top_k_recall({"a": 1.0}, set(), 3))


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------
class TestCalibration:
    def test_bin_assignment_and_edges(self):
        acc = CalibrationAccumulator()
        acc.add(0.0, False)
        acc.add(0.05, False)
        acc.add(0.999, True)
        acc.add(1.0, True)
        assert acc.counts[0] == 2
        assert acc.counts[9] == 2
        assert acc.n == 4

    def test_perfectly_calibrated_stream_has_near_zero_ece(self):
        acc = CalibrationAccumulator()
        for bin_idx in range(10):
            p = bin_idx / 10 + 0.05
            n = 1000
            hits = round(p * n)
            for i in range(n):
                acc.add(p, i < hits)
        ece = acc.ece()
        assert ece is not None and ece < 0.001

    def test_systematically_overconfident_stream_has_large_ece(self):
        acc = CalibrationAccumulator()
        for _ in range(500):
            acc.add(0.95, False)  # says 95%, never happens
        ece = acc.ece()
        assert ece is not None and ece > 0.9

    def test_bins_report_predicted_and_observed(self):
        acc = CalibrationAccumulator()
        for _ in range(3):
            acc.add(0.3, True)
        acc.add(0.3, False)
        b = acc.bins()[3]
        assert b["n"] == 4
        assert b["mean_predicted"] == pytest.approx(0.3)
        assert b["observed_frequency"] == pytest.approx(0.75)
        assert b["gap"] == pytest.approx(0.45)

    def test_empty_accumulator_is_null_not_a_crash(self):
        acc = CalibrationAccumulator()
        assert acc.ece() is None
        assert acc.n == 0
        assert all(b["mean_predicted"] is None for b in acc.bins())

    def test_add_many_marks_positives(self):
        acc = CalibrationAccumulator()
        acc.add_many({"a": 0.9, "b": 0.1}, {"a"})
        assert acc.counts[9] == 1 and acc.obs_sum[9] == 1.0
        assert acc.counts[1] == 1 and acc.obs_sum[1] == 0.0


# ---------------------------------------------------------------------------
# Baseline + scoring a whole projection
# ---------------------------------------------------------------------------
class TestNaiveBaseline:
    def test_carries_the_current_table_forward(self):
        table = build_table(deterministic_season(), teams=TEAMS)
        base = naive_baseline_projection(table)
        assert base["title"]["Foxtrot"] == 1.0
        assert sum(base["title"].values()) == 1.0
        assert {t for t, p in base["relegation"].items() if p == 1.0} == {
            "Charlie",
            "Bravo",
            "Alpha",
        }
        assert base["position"]["Foxtrot"] == 1.0

    def test_at_matchday_zero_it_knows_nothing(self):
        base = naive_baseline_projection(build_table([], teams=TEAMS))
        # Every team level on zero points; the ordering is the name tiebreak.
        assert base["title"]["Alpha"] == 1.0
        assert sum(base["title"].values()) == 1.0

    def test_perfect_baseline_scores_zero_brier(self):
        table = build_table(deterministic_season(), teams=TEAMS)
        actual = actual_outcome(table)
        scores = score_projection(naive_baseline_projection(table), actual)
        assert scores["title_brier"] == pytest.approx(0.0)
        assert scores["relegation_brier"] == pytest.approx(0.0)
        assert scores["position_mae"] == pytest.approx(0.0)
        assert scores["champion_hit"] == 1.0
        assert scores["relegation_recall"] == pytest.approx(1.0)

    def test_empty_table_raises(self):
        with pytest.raises(ValueError):
            naive_baseline_projection([])


class TestScoreProjection:
    def _actual(self):
        return actual_outcome(build_table(deterministic_season(), teams=TEAMS))

    def test_all_metrics_present_and_finite(self):
        projection = {
            "title": {t: 1.0 / len(TEAMS) for t in TEAMS},
            "relegation": {t: 0.5 for t in TEAMS},
            "top_4": {t: 4 / len(TEAMS) for t in TEAMS},
            "position": {t: 3.5 for t in TEAMS},
        }
        scores = score_projection(projection, self._actual())
        assert set(scores) == {
            "title_brier",
            "relegation_brier",
            "top_4_brier",
            "position_mae",
            "title_log_loss",
            "champion_hit",
            "relegation_recall",
        }
        assert all(math.isfinite(v) for v in scores.values())
        assert scores["title_log_loss"] == pytest.approx(math.log(len(TEAMS)))

    def test_margin_is_positive_when_the_simulator_is_better(self):
        good = {"title_brier": 0.01, "champion_hit": 1.0}
        bad = {"title_brier": 0.10, "champion_hit": 0.0}
        m = margin(good, bad)
        assert m["title_brier"] == pytest.approx(0.09)  # lower-is-better metric
        assert m["champion_hit"] == pytest.approx(1.0)  # higher-is-better metric

    def test_margin_is_none_when_either_side_is_missing(self):
        m = margin({"title_brier": 0.01}, {})
        assert m["title_brier"] is None


# ---------------------------------------------------------------------------
# Convergence aggregation
# ---------------------------------------------------------------------------
def _point(md: int, sim_brier: float, base_brier: float, fraction: float) -> Dict:
    sim = {k: None for k in ("relegation_brier", "top_4_brier", "position_mae",
                             "title_log_loss", "champion_hit", "relegation_recall")}
    base = dict(sim)
    sim["title_brier"] = sim_brier
    base["title_brier"] = base_brier
    return {
        "matchday": md,
        "fraction_complete": fraction,
        "simulator": sim,
        "baseline": base,
        "margin": margin(sim, base),
    }


class TestAggregation:
    def _seasons(self):
        return [
            {
                "competition_id": "eng.1",
                "league_name": "Premier League",
                "matchdays": [
                    _point(0, 0.10, 0.20, 0.0),
                    _point(1, 0.05, 0.20, 0.5),
                ],
            },
            {
                "competition_id": "esp.1",
                "league_name": "La Liga",
                "matchdays": [
                    _point(0, 0.20, 0.20, 0.0),
                    _point(1, 0.15, 0.10, 0.5),
                ],
            },
        ]

    def test_by_matchday_pools_across_leagues(self):
        curve = aggregate_by_matchday(self._seasons())
        assert [r["matchday"] for r in curve] == [0, 1]
        assert curve[0]["n_league_seasons"] == 2
        assert curve[0]["n_leagues"] == 2
        assert curve[0]["simulator"]["title_brier"] == pytest.approx(0.15)
        assert curve[1]["simulator"]["title_brier"] == pytest.approx(0.10)

    def test_margin_aggregates_with_the_right_sign(self):
        curve = aggregate_by_matchday(self._seasons())
        # md0: (0.20-0.10 + 0.20-0.20)/2 = 0.05, simulator ahead.
        assert curve[0]["margin"]["title_brier"] == pytest.approx(0.05)

    def test_by_season_fraction_buckets(self):
        buckets = aggregate_by_season_fraction(self._seasons(), n_buckets=2)
        assert [b["bucket"] for b in buckets] == [0, 1]
        assert buckets[0]["n_projection_points"] == 2

    def test_overall_summary_reports_share_beating_baseline(self):
        ov = overall_summary(self._seasons())
        assert ov["n_projection_points"] == 4
        # simulator better on 2 of 4 points, tied on 1.
        assert ov["share_simulator_better"]["title_brier"] == pytest.approx(0.5)
        assert ov["share_tied"]["title_brier"] == pytest.approx(0.25)

    def test_overall_summary_on_no_points(self):
        assert overall_summary([])["n_projection_points"] == 0

    def test_aggregation_of_empty_input(self):
        assert aggregate_by_matchday([]) == []
        assert aggregate_by_season_fraction([]) == []


class TestFirstSustained:
    def _curve(self, values):
        return [
            {"matchday": i, "simulator": {"title_brier": v}, "margin": {"title_brier": v}}
            for i, v in enumerate(values)
        ]

    def test_requires_the_condition_to_hold_to_the_end(self):
        # Dips under 0.05 at md1 but pops back out at md2 — not converged there.
        curve = self._curve([0.2, 0.01, 0.2, 0.01, 0.01])
        got = first_sustained(curve, lambda r: r["simulator"]["title_brier"] <= 0.05)
        assert got == 3

    def test_never_satisfied_returns_none(self):
        curve = self._curve([0.2, 0.3, 0.4])
        assert first_sustained(curve, lambda r: r["simulator"]["title_brier"] <= 0.05) is None

    def test_always_satisfied_returns_zero(self):
        curve = self._curve([0.01, 0.01])
        assert first_sustained(curve, lambda r: r["simulator"]["title_brier"] <= 0.05) == 0

    def test_undefined_points_are_ignored_not_treated_as_failures(self):
        curve = self._curve([0.2, 0.01, None, 0.01])
        got = first_sustained(
            curve,
            lambda r: None
            if r["simulator"]["title_brier"] is None
            else r["simulator"]["title_brier"] <= 0.05,
        )
        assert got == 1

    def test_convergence_thresholds_shape(self):
        curve = aggregate_by_matchday(
            [
                {
                    "competition_id": "eng.1",
                    "league_name": "Premier League",
                    "matchdays": [_point(0, 0.10, 0.20, 0.0), _point(1, 0.001, 0.2, 0.5)],
                }
            ]
        )
        th = convergence_thresholds(curve)
        assert th["title_brier_le_0.01"] == 1
        assert th["title_brier_le_0.05"] == 1
        assert "definition" in th


# ---------------------------------------------------------------------------
# Point-in-time Elo — the leakage guard
# ---------------------------------------------------------------------------
class TestPointInTimeElo:
    def _history(self):
        return [
            {
                "date_utc": f"2020-0{i}-01T00:00:00+00:00",
                "home": "Alpha",
                "away": "Bravo",
                "home_score": 3,
                "away_score": 0,
                "competition_name": "Premier League",
            }
            for i in range(1, 6)
        ]

    def test_starts_every_team_at_the_default(self):
        pit = PointInTimeElo(self._history())
        elo = pit.advance_to("2019-01-01")
        assert pit.matches_applied == 0
        assert elo.get_elo("Alpha") == pytest.approx(elo.DEFAULT_ELO)

    def test_only_the_past_is_applied(self):
        pit = PointInTimeElo(self._history())
        pit.advance_to("2020-03-01T00:00:00+00:00")
        assert pit.matches_applied == 2  # Jan and Feb only

    def test_ratings_move_in_the_right_direction(self):
        pit = PointInTimeElo(self._history())
        elo = pit.advance_to("2021-01-01")
        assert pit.matches_applied == 5
        assert elo.get_elo("Alpha") > elo.get_elo("Bravo")

    def test_a_backwards_query_rebuilds_rather_than_leaking_the_future(self):
        pit = PointInTimeElo(self._history())
        pit.advance_to("2021-01-01")
        elo = pit.advance_to("2020-02-01T00:00:00+00:00")
        assert pit.matches_applied == 1
        # Exactly one result folded in, not five.
        assert elo.get_elo("Alpha") < 1550

    def test_preseeded_elo_is_a_private_copy(self):
        from backend.services.ratings.elo import get_elo_system

        private = preseeded_elo()
        private.set_elo("Manchester City", 1.0)
        assert get_elo_system().get_elo("Manchester City") != 1.0


# ---------------------------------------------------------------------------
# End-to-end on a synthetic warehouse
# ---------------------------------------------------------------------------
def build_synthetic_warehouse(path, matches, competition="eng.1", season=2020):
    wh = Warehouse(path)
    wh.migrate()
    wh.upsert_competition(competition, "Premier League", "M", country="England", tier=1)
    ids = {t: wh.upsert_team(t, "M", country="England") for t in TEAMS}
    rows = [
        MatchRow(
            match_id=m["match_id"],
            source="synthetic",
            competition_id=competition,
            season=season,
            date_utc=m["date_utc"],
            home_team_id=ids[m["home"]],
            away_team_id=ids[m["away"]],
            home_score=m["home_score"],
            away_score=m["away_score"],
        )
        for m in matches
    ]
    wh.upsert_matches(rows)
    wh.close()
    return path


class TestEndToEnd:
    def test_full_replay_on_a_synthetic_season(self, tmp_path):
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()
        )
        art = run_backtest(
            db_path=db,
            leagues=["eng.1"],
            iterations=40,
            n_seasons=1,
            seed=7,
            verbose=False,
        )
        cov = art["coverage"]
        assert cov["warehouse_readable"] is True
        assert cov["n_league_seasons_scored"] == 1
        assert cov["n_projection_points"] > 0
        assert cov["seasons_skipped"] == []

        season = art["per_season"][0]
        assert season["champion"] == "Foxtrot"
        assert season["n_teams"] == 6
        assert season["completeness"] == pytest.approx(1.0)
        assert season["matchdays"][0]["matchday"] == 0

        # Every scored point carries all three sides.
        for point in season["matchdays"]:
            for side in ("simulator", "baseline", "margin"):
                assert side in point
            assert 0.0 <= point["fraction_complete"] < 1.0
            assert point["remaining_fixtures"] > 0

        # The convergence curve and calibration table must be populated.
        assert art["convergence"]["by_matchday"]
        assert art["convergence"]["by_season_fraction"]
        assert art["calibration"]["overall"]["n"] > 0
        assert set(art["calibration"]["by_metric"]) == {
            "title",
            "relegation",
            "top_4",
        }
        assert art["overall"]["n_projection_points"] == cov["n_projection_points"]

    def test_artifact_is_strict_json(self, tmp_path):
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()
        )
        art = run_backtest(
            db_path=db, leagues=["eng.1"], iterations=20, n_seasons=1, verbose=False
        )
        # allow_nan=False is what the CLI writes with: NaN/Infinity would be
        # invalid JSON and would break every downstream consumer.
        json.loads(json.dumps(art, allow_nan=False))

    def test_projection_is_a_real_forecast_not_a_constant(self, tmp_path):
        """The simulator must actually converge on the eventual champion.

        With a season this deterministic, by the closing matchdays the Monte
        Carlo has essentially no uncertainty left, so title Brier must be far
        better at the end than at the start. If this fails the harness is not
        driving the simulator correctly.
        """
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()
        )
        art = run_backtest(
            db_path=db,
            leagues=["eng.1"],
            iterations=200,
            n_seasons=1,
            seed=11,
            verbose=False,
        )
        points = art["per_season"][0]["matchdays"]
        assert points[-1]["simulator"]["title_brier"] < points[0]["simulator"][
            "title_brier"
        ]
        assert points[-1]["simulator"]["champion_hit"] == 1.0
        assert points[-1]["simulator"]["position_mae"] < points[0]["simulator"][
            "position_mae"
        ]

    def test_incomplete_season_is_skipped_and_reported(self, tmp_path):
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()[:18]
        )
        art = run_backtest(
            db_path=db, leagues=["eng.1"], iterations=20, verbose=False
        )
        assert art["coverage"]["n_league_seasons_scored"] == 0
        skipped = art["coverage"]["seasons_skipped"]
        assert len(skipped) == 1
        assert skipped[0]["competition_id"] == "eng.1"
        assert "complete" in skipped[0]["reason"]
        assert art["notes"]  # states plainly that nothing was scored

    def test_league_absent_from_warehouse_is_reported_not_crashed(self, tmp_path):
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()
        )
        art = run_backtest(
            db_path=db, leagues=["esp.1"], iterations=20, verbose=False
        )
        assert art["coverage"]["n_league_seasons_scored"] == 0
        assert art["coverage"]["seasons_skipped"][0]["reason"] == (
            "no matches in warehouse"
        )

    def test_preseeded_elo_mode_is_flagged_as_leaky(self, tmp_path):
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()
        )
        art = run_backtest(
            db_path=db,
            leagues=["eng.1"],
            iterations=20,
            n_seasons=1,
            elo_mode="preseeded",
            verbose=False,
        )
        assert any("LEAKAGE" in w for w in art["warnings"])


# ---------------------------------------------------------------------------
# Graceful degradation — PIVOT_2026-08 "no fabricated data"
# ---------------------------------------------------------------------------
class TestDegradesGracefully:
    def test_missing_warehouse_file(self, tmp_path):
        art = run_backtest(db_path=tmp_path / "nope.sqlite", verbose=False)
        assert art["coverage"]["warehouse_readable"] is False
        assert "cannot open warehouse" in art["coverage"]["error"]
        assert art["coverage"]["n_league_seasons_scored"] == 0
        assert art["per_season"] == []
        assert art["convergence"]["by_matchday"] == []
        assert art["notes"]

    def test_zero_byte_warehouse(self, tmp_path):
        empty = tmp_path / "empty.sqlite"
        empty.write_bytes(b"")
        art = run_backtest(db_path=empty, verbose=False)
        assert art["coverage"]["n_league_seasons_scored"] == 0
        assert art["coverage"].get("error")
        assert art["notes"]

    def test_migrated_but_empty_warehouse(self, tmp_path):
        wh = Warehouse(tmp_path / "wh.sqlite")
        wh.migrate()
        wh.close()
        art = run_backtest(db_path=tmp_path / "wh.sqlite", verbose=False)
        assert art["coverage"]["warehouse_readable"] is True
        assert art["coverage"]["warehouse_matches"] == 0
        assert art["coverage"]["n_league_seasons_scored"] == 0
        assert art["notes"]

    def test_cli_writes_an_artifact_even_with_no_data(self, tmp_path):
        out = tmp_path / "diag" / "season_projection_backtest.json"
        rc = main(
            [
                "--db",
                str(tmp_path / "missing.sqlite"),
                "--output",
                str(out),
                "--quiet",
            ]
        )
        assert rc == 0
        assert out.exists()
        art = json.loads(out.read_text())
        assert art["artifact"] == "season_projection_backtest"
        assert art["coverage"]["n_league_seasons_scored"] == 0

    def test_cli_end_to_end_writes_scored_artifact(self, tmp_path):
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()
        )
        out = tmp_path / "out.json"
        rc = main(
            [
                "--db",
                str(db),
                "--league",
                "eng.1",
                "--iterations",
                "30",
                "--output",
                str(out),
                "--quiet",
            ]
        )
        assert rc == 0
        art = json.loads(out.read_text())
        assert art["coverage"]["n_league_seasons_scored"] == 1
        assert art["config"]["iterations"] == 30
        assert art["config"]["elo_mode"] == "point-in-time"

    def test_comma_separated_league_flag(self, tmp_path):
        db = build_synthetic_warehouse(
            tmp_path / "wh.sqlite", deterministic_season()
        )
        out = tmp_path / "out.json"
        main(
            [
                "--db",
                str(db),
                "--league",
                "eng.1,esp.1",
                "--iterations",
                "20",
                "--output",
                str(out),
                "--quiet",
            ]
        )
        art = json.loads(out.read_text())
        assert art["config"]["leagues"] == ["eng.1", "esp.1"]
