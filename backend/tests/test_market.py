"""Tests for the market benchmark maths (`backend/services/prediction/market.py`)
and the harness that consumes it (`backend/scripts/benchmark_market.py`).

The point of this module is that the numbers on the scoreboard are only worth
anything if the arithmetic behind them is right, so almost every test here
asserts a **known value** derived by hand rather than a self-consistency
property:

* a book constructed with a deliberate 5% overround must de-vig back to exactly
  the probabilities it was constructed from,
* uniform 1/3 must score Brier 0.6667, log loss ln(3), RPS 5/18 on a home win,
* Kelly must return exactly 0.0 on a negative edge,
* Shin's solver is checked against the closed-form identity it must satisfy,
  independently of how it is implemented.

The CLI tests build a five-row SQLite warehouse and a one-file prediction set
in a tmp dir, so the join and the degradation paths are exercised without
touching `backend/data/`.
"""

from __future__ import annotations

import json
import math
import random

import pytest

from backend.services.prediction.market import (
    OUTCOMES,
    InvalidOddsError,
    ProbabilityError,
    argmax_outcome,
    booksum,
    brier_score,
    closing_line_value,
    coerce_probabilities,
    devig,
    devig_proportional,
    devig_shin,
    expected_calibration_error,
    expected_value,
    flatten_multiclass,
    has_complete_odds,
    implied_probabilities,
    kelly_fraction,
    log_loss_single,
    outcome_from_scores,
    outcome_index,
    overround,
    reliability_table,
    rps,
    shin_z,
    top_class_pairs,
    validate_odds,
)

UNIFORM = (1 / 3, 1 / 3, 1 / 3)


def book_with_margin(probs, margin: float):
    """Decimal odds for `probs` with `margin` loaded uniformly (proportionally).

    This is the exact inverse of :func:`devig_proportional`: quoting
    ``1 / (p * (1 + margin))`` produces a book whose raw implied probabilities
    sum to ``1 + margin`` and whose proportional de-vig returns ``probs``
    unchanged. Every "known value" de-vig test below is built with it.
    """
    scale = 1.0 + margin
    return tuple(1.0 / (p * scale) for p in probs)


# ==========================================================================
# Implied probabilities and the overround
# ==========================================================================

class TestImpliedProbabilities:
    def test_known_values(self):
        assert implied_probabilities(2.0, 4.0, 4.0) == pytest.approx((0.5, 0.25, 0.25))

    def test_fair_book_sums_to_one(self):
        assert booksum(2.0, 4.0, 4.0) == pytest.approx(1.0)
        assert overround(2.0, 4.0, 4.0) == pytest.approx(0.0, abs=1e-12)

    def test_raw_probabilities_keep_the_vig(self):
        # A real 1X2 book: these must sum to MORE than 1.
        raw = implied_probabilities(1.91, 3.40, 4.33)
        assert sum(raw) > 1.0

    def test_overround_of_a_five_percent_book(self):
        odds = book_with_margin((0.50, 0.28, 0.22), 0.05)
        assert overround(*odds) == pytest.approx(0.05)
        assert booksum(*odds) == pytest.approx(1.05)

    def test_overround_of_a_ten_percent_book(self):
        odds = book_with_margin((0.44, 0.27, 0.29), 0.10)
        assert overround(*odds) == pytest.approx(0.10)

    def test_negative_overround_is_reported_not_hidden(self):
        # Three prices from different books can cross; booksum < 1 is an arb.
        assert overround(3.2, 4.0, 3.5) < 0.0


# ==========================================================================
# De-vigging: proportional
# ==========================================================================

class TestDevigProportional:
    def test_recovers_the_probabilities_a_5pct_book_was_built_from(self):
        true = (0.50, 0.28, 0.22)
        odds = book_with_margin(true, 0.05)
        assert devig_proportional(*odds) == pytest.approx(true)

    def test_result_sums_to_exactly_one(self):
        odds = book_with_margin((0.50, 0.28, 0.22), 0.05)
        assert sum(devig_proportional(*odds)) == pytest.approx(1.0, abs=1e-12)

    @pytest.mark.parametrize(
        "odds",
        [
            (1.91, 3.40, 4.33),
            (1.20, 6.50, 15.0),
            (2.50, 3.30, 2.90),
            (10.0, 6.00, 1.33),
            (1.01, 40.0, 60.0),
        ],
    )
    def test_sums_to_one_for_real_looking_books(self, odds):
        probs = devig_proportional(*odds)
        assert sum(probs) == pytest.approx(1.0, abs=1e-12)
        assert all(0.0 < p < 1.0 for p in probs)

    def test_preserves_the_ordering_of_the_raw_prices(self):
        probs = devig_proportional(1.50, 4.20, 7.00)
        assert probs[0] > probs[1] > probs[2]

    def test_fair_book_is_unchanged(self):
        raw = implied_probabilities(2.0, 4.0, 4.0)
        assert devig_proportional(2.0, 4.0, 4.0) == pytest.approx(raw)


# ==========================================================================
# De-vigging: Shin
# ==========================================================================

class TestDevigShin:
    def test_result_sums_to_exactly_one(self):
        odds = book_with_margin((0.50, 0.28, 0.22), 0.05)
        assert sum(devig_shin(*odds)) == pytest.approx(1.0, abs=1e-12)

    @pytest.mark.parametrize(
        "odds",
        [
            (1.91, 3.40, 4.33),
            (1.20, 6.50, 15.0),
            (2.50, 3.30, 2.90),
            (10.0, 6.00, 1.33),
        ],
    )
    def test_sums_to_one_for_real_looking_books(self, odds):
        probs = devig_shin(*odds)
        assert sum(probs) == pytest.approx(1.0, abs=1e-12)
        assert all(0.0 < p < 1.0 for p in probs)

    def test_z_is_zero_on_a_fair_book_and_shin_equals_proportional(self):
        # No margin means no insider premium to attribute.
        assert shin_z(2.0, 4.0, 4.0) == 0.0
        assert devig_shin(2.0, 4.0, 4.0) == pytest.approx(devig_proportional(2.0, 4.0, 4.0))

    def test_z_grows_with_the_margin(self):
        true = (0.50, 0.28, 0.22)
        z_small = shin_z(*book_with_margin(true, 0.02))
        z_large = shin_z(*book_with_margin(true, 0.10))
        assert 0.0 < z_small < z_large < 1.0

    def test_z_satisfies_the_shin_fixed_point_identity(self):
        """Independent check of the solver.

        Shin's inversion sums to 1 exactly when
        ``sum_i sqrt(z^2 + 4(1-z) pi_i^2 / B) == 2 + (n-2) z``.
        With n = 3 that is ``... == 2 + z``. This is derived from the
        constraint, not from the implementation, so it catches a wrong root.
        """
        odds = (1.91, 3.40, 4.33)
        raw = implied_probabilities(*odds)
        book = sum(raw)
        z = shin_z(*odds)
        lhs = sum(math.sqrt(z * z + 4.0 * (1.0 - z) * pi * pi / book) for pi in raw)
        assert lhs == pytest.approx(2.0 + z, abs=1e-9)

    def test_corrects_the_favourite_longshot_bias_relative_to_proportional(self):
        """Shin must move probability toward the favourite, away from the longshot.

        That directional claim is the whole reason the pivot doc asks for both
        methods: proportional de-vigging is known to over-state longshots.
        """
        odds = (1.30, 5.50, 11.0)
        prop = devig_proportional(*odds)
        shin = devig_shin(*odds)
        assert shin[0] > prop[0], "Shin should raise the favourite"
        assert shin[2] < prop[2], "Shin should lower the longshot"

    def test_agrees_closely_with_proportional_on_a_balanced_book(self):
        # With three near-equal prices there is no favourite-longshot skew to
        # correct, so the two methods should be within a fraction of a point.
        odds = (3.15, 3.20, 3.25)
        prop = devig_proportional(*odds)
        shin = devig_shin(*odds)
        assert max(abs(a - b) for a, b in zip(prop, shin)) < 0.005

    def test_degrades_to_proportional_on_a_sub_fair_book(self):
        odds = (3.2, 4.0, 3.5)  # booksum < 1
        assert shin_z(*odds) == 0.0
        assert devig_shin(*odds) == pytest.approx(devig_proportional(*odds))


class TestDevigDispatcher:
    def test_dispatch(self):
        odds = (1.91, 3.40, 4.33)
        assert devig(*odds, method="proportional") == pytest.approx(devig_proportional(*odds))
        assert devig(*odds, method="shin") == pytest.approx(devig_shin(*odds))

    def test_unknown_method_raises(self):
        with pytest.raises(ValueError, match="unknown de-vig method"):
            devig(1.91, 3.40, 4.33, method="power")


# ==========================================================================
# Odds edge cases — missing, zero, sub-1.0
# ==========================================================================

class TestOddsEdgeCases:
    @pytest.mark.parametrize("bad", [None, 0.0, 1.0, 0.5, -2.0, float("nan"), float("inf")])
    def test_validate_odds_rejects(self, bad):
        with pytest.raises(InvalidOddsError):
            validate_odds(bad)

    @pytest.mark.parametrize("bad", ["", "abc", [], {}, True])
    def test_validate_odds_rejects_non_numeric(self, bad):
        with pytest.raises(InvalidOddsError):
            validate_odds(bad)

    def test_validate_odds_accepts_numeric_strings(self):
        assert validate_odds("2.75") == pytest.approx(2.75)

    def test_validate_odds_names_the_offending_field(self):
        with pytest.raises(InvalidOddsError, match="odds_draw"):
            validate_odds(None, name="odds_draw")

    @pytest.mark.parametrize(
        "triple",
        [
            (None, 3.4, 4.3),
            (1.9, None, 4.3),
            (1.9, 3.4, None),
            (0.0, 3.4, 4.3),      # CSV feeds encode "no price" as 0
            (1.9, 0.0, 4.3),
            (1.9, 3.4, 1.0),      # a 1.00 quote implies certainty
            (0.95, 3.4, 4.3),     # sub-1.0 implies probability > 1
        ],
    )
    def test_every_devig_entry_point_rejects_bad_triples(self, triple):
        for fn in (implied_probabilities, booksum, overround,
                   devig_proportional, devig_shin, shin_z):
            with pytest.raises(InvalidOddsError):
                fn(*triple)

    @pytest.mark.parametrize(
        "triple",
        [
            (None, 3.4, 4.3),
            (1.9, 0.0, 4.3),
            (1.9, 3.4, 1.0),
            ("", "", ""),
        ],
    )
    def test_has_complete_odds_is_false_and_never_raises(self, triple):
        assert has_complete_odds(*triple) is False

    def test_has_complete_odds_is_true_for_a_real_book(self):
        assert has_complete_odds(1.91, 3.40, 4.33) is True


# ==========================================================================
# Probability handling
# ==========================================================================

class TestCoerceProbabilities:
    def test_accepts_a_sequence(self):
        assert coerce_probabilities([0.5, 0.3, 0.2]) == pytest.approx((0.5, 0.3, 0.2))

    def test_accepts_a_mapping(self):
        got = coerce_probabilities({"home": 0.5, "draw": 0.3, "away": 0.2})
        assert got == pytest.approx((0.5, 0.3, 0.2))

    def test_mapping_missing_a_key_raises(self):
        with pytest.raises(ProbabilityError):
            coerce_probabilities({"home": 0.5, "draw": 0.5})

    def test_renormalises_rounded_probabilities_by_default(self):
        # Exactly the shape of the committed prediction JSON: 4dp, sums to .9999.
        got = coerce_probabilities((0.3873, 0.2868, 0.3258))
        assert sum(got) == pytest.approx(1.0, abs=1e-12)
        assert got[0] == pytest.approx(0.3873, rel=1e-3)

    def test_strict_mode_rejects_a_vector_that_does_not_sum_to_one(self):
        with pytest.raises(ProbabilityError, match="outside tolerance"):
            coerce_probabilities((0.5, 0.3, 0.4), normalise=False)

    def test_strict_mode_tolerates_float_noise(self):
        assert coerce_probabilities((0.5, 0.3, 0.2), normalise=False) == pytest.approx(
            (0.5, 0.3, 0.2)
        )

    @pytest.mark.parametrize(
        "bad",
        [
            (0.5, 0.5),                     # wrong length
            (0.5, 0.3, 0.1, 0.1),           # wrong length
            (0.5, -0.1, 0.6),               # negative
            (0.5, None, 0.5),               # missing
            (0.0, 0.0, 0.0),                # nothing to normalise
            (float("nan"), 0.5, 0.5),       # nan
        ],
    )
    def test_rejects_malformed_vectors(self, bad):
        with pytest.raises(ProbabilityError):
            coerce_probabilities(bad)

    def test_unnormalised_counts_are_accepted_and_scaled(self):
        assert coerce_probabilities((2.0, 1.0, 1.0)) == pytest.approx((0.5, 0.25, 0.25))


class TestOutcomeVocabulary:
    @pytest.mark.parametrize(
        "value,expected",
        [
            ("home", 0), ("HOME", 0), (" home ", 0), ("H", 0), ("1", 0), (0, 0),
            ("draw", 1), ("D", 1), ("X", 1), (1, 1),
            ("away", 2), ("A", 2), ("2", 2), (2, 2),
        ],
    )
    def test_aliases(self, value, expected):
        assert outcome_index(value) == expected

    @pytest.mark.parametrize("bad", ["win", "", None, 3, -1, True, 1.0])
    def test_rejects_nonsense(self, bad):
        with pytest.raises(ProbabilityError):
            outcome_index(bad)

    @pytest.mark.parametrize(
        "home,away,expected",
        [(2, 1, "home"), (0, 0, "draw"), (1, 3, "away"), (5, 5, "draw")],
    )
    def test_outcome_from_scores(self, home, away, expected):
        assert outcome_from_scores(home, away) == expected

    def test_outcome_from_missing_score_raises(self):
        with pytest.raises(ProbabilityError):
            outcome_from_scores(None, 1)

    def test_argmax(self):
        assert argmax_outcome((0.5, 0.3, 0.2)) == "home"
        assert argmax_outcome((0.2, 0.5, 0.3)) == "draw"
        assert argmax_outcome((0.2, 0.3, 0.5)) == "away"

    def test_argmax_breaks_ties_toward_home(self):
        assert argmax_outcome(UNIFORM) == "home"


# ==========================================================================
# Scoring rules
# ==========================================================================

class TestBrierScore:
    def test_uniform_prior_is_two_thirds(self):
        """The reference value: (1/3-1)^2 + (1/3)^2 + (1/3)^2 = 6/9."""
        for outcome in OUTCOMES:
            assert brier_score(UNIFORM, outcome) == pytest.approx(0.6667, abs=5e-5)
            assert brier_score(UNIFORM, outcome) == pytest.approx(2 / 3)

    def test_perfect_forecast_scores_zero(self):
        assert brier_score((1.0, 0.0, 0.0), "home") == pytest.approx(0.0)

    def test_maximally_wrong_forecast_scores_two(self):
        assert brier_score((1.0, 0.0, 0.0), "away") == pytest.approx(2.0)

    def test_known_hand_computed_value(self):
        # (0.6-1)^2 + (0.25)^2 + (0.15)^2 = 0.16 + 0.0625 + 0.0225
        assert brier_score((0.60, 0.25, 0.15), "home") == pytest.approx(0.2450)

    def test_repo_reference_base_rate_value(self):
        # The constant baseline named in docs/PIVOT_2026-08.md, scored on a home win.
        base = (0.456, 0.236, 0.308)
        expected = (0.456 - 1) ** 2 + 0.236**2 + 0.308**2
        assert brier_score(base, "home") == pytest.approx(expected)

    def test_is_blind_to_outcome_ordering(self):
        """Brier cannot tell a near-miss from a far-miss. RPS can — see below."""
        probs = (0.8, 0.1, 0.1)
        assert brier_score(probs, "draw") == pytest.approx(brier_score(probs, "away"))


class TestLogLoss:
    def test_uniform_prior_is_ln_three(self):
        assert log_loss_single(UNIFORM, "draw") == pytest.approx(math.log(3))
        assert log_loss_single(UNIFORM, "draw") == pytest.approx(1.0986, abs=5e-5)

    def test_perfect_forecast_scores_zero(self):
        assert log_loss_single((1.0, 0.0, 0.0), "home") == pytest.approx(0.0)

    def test_confident_miss_is_large_but_finite(self):
        value = log_loss_single((1.0, 0.0, 0.0), "away")
        assert math.isfinite(value)
        assert value == pytest.approx(-math.log(1e-15))

    def test_clip_is_configurable(self):
        assert log_loss_single((1.0, 0.0, 0.0), "away", eps=1e-6) == pytest.approx(
            -math.log(1e-6)
        )

    def test_known_value(self):
        assert log_loss_single((0.5, 0.3, 0.2), "away") == pytest.approx(-math.log(0.2))


class TestRankedProbabilityScore:
    def test_uniform_prior_worked_example(self):
        """Hand-computed for probs (1/3, 1/3, 1/3).

        home: cum p = (1/3, 2/3), cum o = (1, 1)
              -> ((1/3-1)^2 + (2/3-1)^2)/2 = (4/9 + 1/9)/2 = 5/18
        draw: cum o = (0, 1) -> ((1/3)^2 + (2/3-1)^2)/2 = (1/9 + 1/9)/2 = 1/9
        away: cum o = (0, 0) -> ((1/3)^2 + (2/3)^2)/2 = (1/9 + 4/9)/2 = 5/18
        """
        assert rps(UNIFORM, "home") == pytest.approx(5 / 18)
        assert rps(UNIFORM, "draw") == pytest.approx(1 / 9)
        assert rps(UNIFORM, "away") == pytest.approx(5 / 18)
        assert rps(UNIFORM, "home") == pytest.approx(0.2778, abs=5e-5)

    def test_perfect_forecast_scores_zero(self):
        for i, outcome in enumerate(OUTCOMES):
            probs = [0.0, 0.0, 0.0]
            probs[i] = 1.0
            assert rps(probs, outcome) == pytest.approx(0.0)

    def test_maximally_wrong_forecast_scores_one(self):
        # (1,0,0) with an away win: cum p = (1,1), cum o = (0,0) -> (1+1)/2 = 1
        assert rps((1.0, 0.0, 0.0), "away") == pytest.approx(1.0)

    def test_adjacent_miss_is_cheaper_than_a_distant_miss(self):
        """The ordering property that makes RPS the football-forecasting default."""
        probs = (0.8, 0.1, 0.1)
        near = rps(probs, "draw")   # ((0.8)^2 + (0.9-1)^2)/2 = (0.64+0.01)/2
        far = rps(probs, "away")    # ((0.8)^2 + (0.9)^2)/2   = (0.64+0.81)/2
        assert near == pytest.approx(0.325)
        assert far == pytest.approx(0.725)
        assert near < far

    def test_bounded_in_zero_one(self):
        rng = random.Random(20260808)
        for _ in range(200):
            raw = [rng.random() + 1e-6 for _ in range(3)]
            total = sum(raw)
            probs = [x / total for x in raw]
            for outcome in OUTCOMES:
                assert 0.0 <= rps(probs, outcome) <= 1.0


class TestScoringSharesEdgeCaseHandling:
    @pytest.mark.parametrize("fn", [brier_score, log_loss_single, rps])
    def test_rounded_probabilities_are_renormalised(self, fn):
        assert fn((0.3873, 0.2868, 0.3258), "home") == pytest.approx(
            fn((0.3873 / 0.9999, 0.2868 / 0.9999, 0.3258 / 0.9999), "home")
        )

    @pytest.mark.parametrize("fn", [brier_score, log_loss_single, rps])
    def test_strict_mode_rejects_unnormalised_input(self, fn):
        with pytest.raises(ProbabilityError):
            fn((0.5, 0.3, 0.4), "home", normalise=False)

    @pytest.mark.parametrize("fn", [brier_score, log_loss_single, rps])
    def test_bad_outcome_rejected(self, fn):
        with pytest.raises(ProbabilityError):
            fn(UNIFORM, "penalties")


# ==========================================================================
# Value: CLV, EV, Kelly
# ==========================================================================

class TestClosingLineValue:
    def test_relative_clv_known_value(self):
        # Model 0.55 against a 0.50 close: 10% better than the closing price.
        assert closing_line_value(0.55, 0.50) == pytest.approx(0.10)

    def test_absolute_clv_known_value(self):
        assert closing_line_value(0.55, 0.50, mode="absolute") == pytest.approx(0.05)

    def test_zero_when_the_model_agrees_with_the_close(self):
        assert closing_line_value(0.42, 0.42) == pytest.approx(0.0)
        assert closing_line_value(0.42, 0.42, mode="absolute") == pytest.approx(0.0)

    def test_negative_when_the_model_is_below_the_close(self):
        assert closing_line_value(0.40, 0.50) == pytest.approx(-0.20)

    def test_relative_clv_is_comparable_across_price_ranges(self):
        """Same relative edge, very different absolute edge — the reason
        relative CLV is the aggregation unit."""
        short = closing_line_value(0.55, 0.50)
        longshot = closing_line_value(0.11, 0.10)
        assert short == pytest.approx(longshot)
        assert closing_line_value(0.55, 0.50, mode="absolute") > closing_line_value(
            0.11, 0.10, mode="absolute"
        )

    def test_zero_market_probability_raises(self):
        with pytest.raises(ProbabilityError):
            closing_line_value(0.5, 0.0)

    def test_unknown_mode_raises(self):
        with pytest.raises(ValueError, match="unknown CLV mode"):
            closing_line_value(0.5, 0.4, mode="sideways")

    @pytest.mark.parametrize("bad", [None, -0.1, 1.5, "x", float("nan")])
    def test_out_of_range_inputs_raise(self, bad):
        with pytest.raises(ProbabilityError):
            closing_line_value(bad, 0.5)


class TestExpectedValue:
    def test_break_even_price_is_zero(self):
        assert expected_value(0.5, 2.0) == pytest.approx(0.0)
        assert expected_value(0.25, 4.0) == pytest.approx(0.0)

    def test_positive_edge_known_value(self):
        # 0.60 * 2.00 - 1 = +0.20 per unit staked.
        assert expected_value(0.60, 2.00) == pytest.approx(0.20)

    def test_negative_edge_known_value(self):
        assert expected_value(0.40, 2.00) == pytest.approx(-0.20)

    def test_typical_bookmaker_hold_is_negative_on_the_true_probability(self):
        # Fair price 2.00 quoted at 1.91: the punter's EV is the margin.
        assert expected_value(0.5, 1.91) == pytest.approx(-0.045)

    def test_invalid_inputs_raise(self):
        with pytest.raises(InvalidOddsError):
            expected_value(0.5, None)
        with pytest.raises(ProbabilityError):
            expected_value(1.5, 2.0)


class TestKellyFraction:
    def test_returns_zero_on_negative_edge(self):
        """The headline safety property: no negative stakes, ever."""
        assert kelly_fraction(0.40, 2.00) == 0.0
        assert kelly_fraction(0.10, 3.00) == 0.0
        assert kelly_fraction(0.0, 50.0) == 0.0

    def test_returns_zero_at_exactly_break_even(self):
        assert kelly_fraction(0.5, 2.0) == 0.0
        assert kelly_fraction(0.25, 4.0) == 0.0

    def test_known_value_on_positive_edge(self):
        # f* = (bp - q)/b with b = 1, p = 0.6, q = 0.4  ->  0.2
        assert kelly_fraction(0.60, 2.00) == pytest.approx(0.20)

    def test_known_value_on_a_longshot(self):
        # b = 9, p = 0.15, q = 0.85 -> (1.35 - 0.85)/9 = 0.05555...
        assert kelly_fraction(0.15, 10.0) == pytest.approx(0.5 / 9)

    def test_fractional_kelly_multiplier(self):
        full = kelly_fraction(0.60, 2.00)
        assert kelly_fraction(0.60, 2.00, fraction=0.25) == pytest.approx(full * 0.25)
        assert kelly_fraction(0.60, 2.00, fraction=0.5) == pytest.approx(0.10)

    def test_fractional_kelly_still_zero_on_negative_edge(self):
        assert kelly_fraction(0.40, 2.00, fraction=0.25) == 0.0

    def test_cap_clamps_the_stake(self):
        assert kelly_fraction(0.90, 5.00, cap=0.05) == pytest.approx(0.05)

    def test_cap_does_not_inflate_a_small_stake(self):
        assert kelly_fraction(0.55, 2.00, cap=0.50) == pytest.approx(0.10)

    def test_certainty_stakes_the_whole_bankroll(self):
        assert kelly_fraction(1.0, 2.0) == pytest.approx(1.0)

    @pytest.mark.parametrize("bad_fraction", [0.0, -1.0, float("nan")])
    def test_invalid_fraction_raises(self, bad_fraction):
        with pytest.raises(ValueError):
            kelly_fraction(0.6, 2.0, fraction=bad_fraction)

    @pytest.mark.parametrize("bad_cap", [0.0, -0.1, float("nan")])
    def test_invalid_cap_raises(self, bad_cap):
        with pytest.raises(ValueError):
            kelly_fraction(0.6, 2.0, cap=bad_cap)

    @pytest.mark.parametrize("bad_odds", [None, 0.0, 1.0, -3.0])
    def test_invalid_odds_raise(self, bad_odds):
        with pytest.raises(InvalidOddsError):
            kelly_fraction(0.6, bad_odds)

    def test_kelly_is_positive_exactly_when_ev_is_positive(self):
        rng = random.Random(4242)
        for _ in range(300):
            prob = rng.random()
            odds = 1.01 + rng.random() * 15
            if expected_value(prob, odds) > 0:
                assert kelly_fraction(prob, odds) > 0
            else:
                assert kelly_fraction(prob, odds) == 0.0


# ==========================================================================
# Calibration
# ==========================================================================

class TestCalibration:
    def test_reliability_table_has_a_row_per_bucket(self):
        table = reliability_table([(0.5, 1), (0.5, 0)], n_buckets=10)
        assert len(table) == 10
        assert sum(bucket.count for bucket in table) == 2

    def test_empty_buckets_are_retained_with_null_statistics(self):
        table = reliability_table([(0.05, 1)], n_buckets=10)
        assert table[0].count == 1
        assert table[5].count == 0
        assert table[5].mean_predicted is None
        assert table[5].as_dict()["gap"] is None

    def test_top_bucket_is_closed_so_probability_one_lands_in_it(self):
        table = reliability_table([(1.0, 1)], n_buckets=10)
        assert table[-1].count == 1

    def test_perfect_calibration_scores_zero_ece(self):
        pairs = [(0.5, 1)] * 50 + [(0.5, 0)] * 50
        assert expected_calibration_error(pairs) == pytest.approx(0.0)

    def test_known_miscalibration_value(self):
        # Claims 0.9, is right half the time: |0.9 - 0.5| = 0.4.
        pairs = [(0.9, 1)] * 5 + [(0.9, 0)] * 5
        assert expected_calibration_error(pairs) == pytest.approx(0.4)

    def test_ece_is_count_weighted_across_buckets(self):
        # 90 rows perfectly calibrated at 0.5, 10 rows 0.4 off at 0.9.
        pairs = ([(0.5, 1)] * 45 + [(0.5, 0)] * 45
                 + [(0.9, 1)] * 5 + [(0.9, 0)] * 5)
        assert expected_calibration_error(pairs) == pytest.approx(0.04)

    def test_empty_input_is_zero_not_nan(self):
        assert expected_calibration_error([]) == 0.0

    def test_rejects_a_non_binary_hit_indicator(self):
        with pytest.raises(ProbabilityError):
            reliability_table([(0.5, 2)])

    def test_rejects_an_out_of_range_probability(self):
        with pytest.raises(ProbabilityError):
            reliability_table([(1.4, 1)])

    def test_flatten_multiclass_emits_three_points_per_fixture(self):
        pairs = flatten_multiclass([(0.5, 0.3, 0.2), (0.2, 0.3, 0.5)], ["home", "away"])
        assert len(pairs) == 6
        assert sum(hit for _, hit in pairs) == 2
        assert (0.5, 1) in pairs and (0.5, 1) in pairs

    def test_top_class_pairs_emit_one_point_per_fixture(self):
        pairs = top_class_pairs([(0.5, 0.3, 0.2), (0.2, 0.3, 0.5)], ["home", "draw"])
        assert pairs == [(0.5, 1), (0.5, 0)]

    def test_a_calibrated_forecaster_has_near_zero_ece_on_simulated_data(self):
        """End-to-end: sample outcomes FROM the forecast, so it is calibrated
        by construction, and check the estimator agrees."""
        rng = random.Random(20260808)
        rows, outcomes = [], []
        for _ in range(4000):
            raw = [rng.random() + 0.05 for _ in range(3)]
            total = sum(raw)
            probs = tuple(x / total for x in raw)
            draw = rng.random()
            cumulative = 0.0
            picked = OUTCOMES[-1]
            for label, p in zip(OUTCOMES, probs):
                cumulative += p
                if draw <= cumulative:
                    picked = label
                    break
            rows.append(probs)
            outcomes.append(picked)
        ece = expected_calibration_error(flatten_multiclass(rows, outcomes))
        assert ece < 0.02


# ==========================================================================
# Cross-cutting: the market must beat the constant baselines on real prices
# ==========================================================================

class TestMarketBeatsBaselinesOnKnownPrices:
    """A sanity net for the whole pipeline.

    These are real 1X2 closing lines with the actual results. If a refactor
    breaks de-vigging or scoring, the market will stop beating uniform 1/3 on
    this handful of fixtures long before anyone notices in the JSON report.
    """

    FIXTURES = [
        ((1.30, 5.50, 11.0), "home"),
        ((1.91, 3.40, 4.33), "home"),
        ((2.50, 3.30, 2.90), "draw"),
        ((4.50, 3.60, 1.85), "away"),
        ((2.10, 3.40, 3.70), "home"),
        ((6.50, 4.20, 1.55), "away"),
        ((1.45, 4.50, 7.00), "home"),
        ((3.10, 3.30, 2.40), "draw"),
    ]

    def _mean_brier(self, forecaster):
        return sum(
            brier_score(forecaster(odds), outcome) for odds, outcome in self.FIXTURES
        ) / len(self.FIXTURES)

    def test_market_beats_uniform(self):
        market = self._mean_brier(lambda odds: devig_shin(*odds))
        uniform = self._mean_brier(lambda _odds: UNIFORM)
        assert market < uniform

    def test_both_devig_methods_land_close_to_each_other(self):
        prop = self._mean_brier(lambda odds: devig_proportional(*odds))
        shin = self._mean_brier(lambda odds: devig_shin(*odds))
        assert abs(prop - shin) < 0.02


# ==========================================================================
# The harness: joining, scoring and degrading
# ==========================================================================

@pytest.fixture()
def tiny_warehouse(tmp_path):
    """A five-fixture warehouse: four priced, one unpriced."""
    from backend.services.data.warehouse import MatchRow, Warehouse

    path = tmp_path / "warehouse.sqlite"
    warehouse = Warehouse(path)
    warehouse.migrate()
    warehouse.upsert_competition("eng.1", "Premier League", "M", country="GB", tier=1)
    warehouse.upsert_competition("esp.1", "La Liga", "M", country="ES", tier=1)

    teams = {
        name: warehouse.upsert_team(name, "M")
        for name in ("Arsenal", "Chelsea", "Liverpool", "Everton", "Real Madrid", "Sevilla")
    }
    rows = [
        # (comp, date, home, away, hs, as, odds)
        ("eng.1", "2026-01-10", "Arsenal", "Chelsea", 2, 0, (1.80, 3.60, 4.50)),
        ("eng.1", "2026-01-11", "Liverpool", "Everton", 1, 1, (1.40, 4.80, 7.50)),
        ("eng.1", "2026-01-17", "Chelsea", "Arsenal", 0, 1, (2.90, 3.40, 2.50)),
        ("esp.1", "2026-01-12", "Real Madrid", "Sevilla", 3, 1, (1.35, 5.20, 8.00)),
        # No odds on this one: it must join but never be scored.
        ("eng.1", "2026-01-24", "Everton", "Liverpool", 0, 2, None),
    ]
    match_rows = []
    for comp, day, home, away, hs, aws, odds in rows:
        match_rows.append(
            MatchRow(
                match_id=f"test_{comp}_{day}_{home}_{away}".replace(" ", "_"),
                source="test",
                competition_id=comp,
                season=2025,
                date_utc=f"{day}T15:00:00+00:00",
                home_team_id=teams[home],
                away_team_id=teams[away],
                home_score=hs,
                away_score=aws,
                odds_home=odds[0] if odds else None,
                odds_draw=odds[1] if odds else None,
                odds_away=odds[2] if odds else None,
            )
        )
    warehouse.upsert_matches(match_rows)
    warehouse.close()
    return path


@pytest.fixture()
def tiny_predictions(tmp_path):
    """One month file: five settled predictions plus one unsettled."""
    directory = tmp_path / "predictions"
    directory.mkdir()
    records = [
        # Team names deliberately use the *other* provider's spelling to
        # exercise the fuzzy join.
        ("Arsenal FC", "Chelsea FC", "2026-01-10", 0.50, 0.28, 0.22, "home"),
        ("Liverpool FC", "Everton FC", "2026-01-11", 0.70, 0.20, 0.10, "draw"),
        ("Chelsea FC", "Arsenal FC", "2026-01-17", 0.35, 0.30, 0.35, "away"),
        ("Everton FC", "Liverpool FC", "2026-01-24", 0.20, 0.25, 0.55, "away"),
        ("Brighton", "Fulham", "2026-01-31", 0.40, 0.30, 0.30, "home"),  # not in warehouse
    ]
    payload = {"month": "2026-01", "count": len(records) + 1, "predictions": []}
    for home, away, day, ph, pd_, pa, actual in records:
        payload["predictions"].append({
            "match_id": f"{home}-{away}",
            "home_team": home,
            "away_team": away,
            "league": "Premier League",
            "match_date": day,
            "predicted_home_win": ph,
            "predicted_draw": pd_,
            "predicted_away_win": pa,
            "actual_winner": actual,
        })
    payload["predictions"].append({
        "match_id": "pending",
        "home_team": "Arsenal FC",
        "away_team": "Liverpool FC",
        "league": "Premier League",
        "match_date": "2026-02-07",
        "predicted_home_win": 0.4,
        "predicted_draw": 0.3,
        "predicted_away_win": 0.3,
        "actual_winner": None,
    })
    (directory / "predictions_2026-01.json").write_text(json.dumps(payload))
    return directory


def _run_benchmark(tmp_path, warehouse, predictions_dir, *extra):
    from backend.scripts.benchmark_market import main

    output = tmp_path / "report.json"
    code = main([
        "--warehouse", str(warehouse),
        "--predictions-dir", str(predictions_dir),
        "--output", str(output),
        "--min-league-n", "1",
        "--quiet",
        *extra,
    ])
    assert code == 0
    return json.loads(output.read_text())


class TestBenchmarkHarness:
    def test_pairs_only_fixtures_with_both_a_forecast_and_odds(
        self, tmp_path, tiny_warehouse, tiny_predictions
    ):
        report = _run_benchmark(tmp_path, tiny_warehouse, tiny_predictions)
        coverage = report["paired_benchmark"]["coverage"]

        assert coverage["settled_predictions"] == 5
        assert coverage["in_scope"] == 5
        assert coverage["joined_to_warehouse_fixture"] == 4   # Brighton/Fulham absent
        assert coverage["no_warehouse_fixture"] == 1
        assert coverage["joined_but_no_closing_odds"] == 1    # Everton/Liverpool unpriced
        assert coverage["paired_with_closing_odds"] == 3
        assert report["paired_benchmark"]["overall"]["n"] == 3

    def test_reports_both_devig_methods_and_all_baselines(
        self, tmp_path, tiny_warehouse, tiny_predictions
    ):
        report = _run_benchmark(tmp_path, tiny_warehouse, tiny_predictions)
        metrics = report["paired_benchmark"]["overall"]["metrics"]
        for key in ("model", "market_proportional", "market_shin",
                    "baseline_base_rate", "baseline_uniform"):
            assert metrics[key]["n"] == 3
            for metric in ("brier", "log_loss", "rps", "accuracy"):
                assert metrics[key][metric] is not None

    def test_uniform_baseline_scores_the_textbook_value(
        self, tmp_path, tiny_warehouse, tiny_predictions
    ):
        report = _run_benchmark(tmp_path, tiny_warehouse, tiny_predictions)
        uniform = report["paired_benchmark"]["overall"]["metrics"]["baseline_uniform"]
        assert uniform["brier"] == pytest.approx(0.6667, abs=5e-5)
        assert uniform["log_loss"] == pytest.approx(1.0986, abs=5e-5)

    def test_gap_is_model_minus_market(self, tmp_path, tiny_warehouse, tiny_predictions):
        report = _run_benchmark(tmp_path, tiny_warehouse, tiny_predictions)
        overall = report["paired_benchmark"]["overall"]
        gap = overall["gap_model_vs_market"]
        model = overall["metrics"]["model"]["brier"]
        market = overall["metrics"]["market_shin"]["brier"]
        assert gap["brier"] == pytest.approx(model - market, abs=1e-4)

    def test_reliability_table_has_ten_buckets(
        self, tmp_path, tiny_warehouse, tiny_predictions
    ):
        report = _run_benchmark(tmp_path, tiny_warehouse, tiny_predictions)
        table = report["paired_benchmark"]["overall"]["metrics"]["model"]["reliability"]
        assert len(table) == 10
        assert sum(bucket["count"] for bucket in table) == 9  # 3 fixtures x 3 classes

    def test_league_filter_accepts_ids_and_display_names(
        self, tmp_path, tiny_warehouse, tiny_predictions
    ):
        by_id = _run_benchmark(
            tmp_path, tiny_warehouse, tiny_predictions, "--league", "eng.1"
        )
        by_name = _run_benchmark(
            tmp_path, tiny_warehouse, tiny_predictions, "--league", "Premier League"
        )
        assert by_id["filters"]["leagues"] == ["eng.1"]
        assert by_name["filters"]["leagues"] == ["eng.1"]
        assert by_id["paired_benchmark"]["overall"]["n"] == \
            by_name["paired_benchmark"]["overall"]["n"]

    def test_since_filter_narrows_the_set(self, tmp_path, tiny_warehouse, tiny_predictions):
        report = _run_benchmark(
            tmp_path, tiny_warehouse, tiny_predictions, "--since", "2026-01-15"
        )
        assert report["paired_benchmark"]["overall"]["n"] == 1
        assert report["filters"]["since"] == "2026-01-15"

    def test_devig_flag_selects_the_headline_method(
        self, tmp_path, tiny_warehouse, tiny_predictions
    ):
        report = _run_benchmark(
            tmp_path, tiny_warehouse, tiny_predictions, "--devig", "proportional"
        )
        overall = report["paired_benchmark"]["overall"]
        assert overall["primary_market_method"] == "proportional"
        assert overall["gap_model_vs_market"]["brier"] == pytest.approx(
            overall["metrics"]["model"]["brier"]
            - overall["metrics"]["market_proportional"]["brier"],
            abs=1e-4,
        )

    def test_market_corpus_scores_every_priced_warehouse_fixture(
        self, tmp_path, tiny_warehouse, tiny_predictions
    ):
        report = _run_benchmark(tmp_path, tiny_warehouse, tiny_predictions)
        corpus = report["market_corpus"]
        # 4 priced fixtures, including the La Liga one the model never predicted.
        assert corpus["overall"]["n"] == 4
        assert set(corpus["by_league"]) == {"Premier League", "La Liga"}
        assert corpus["by_season"]["2025"]["n"] == 4

    def test_no_market_corpus_flag(self, tmp_path, tiny_warehouse, tiny_predictions):
        report = _run_benchmark(
            tmp_path, tiny_warehouse, tiny_predictions, "--no-market-corpus"
        )
        assert report["market_corpus"] is None


class TestBenchmarkDegradesGracefully:
    """The warehouse is gitignored and rebuilt out of band. None of these
    states may crash the harness, and none may produce a fabricated number."""

    def test_missing_warehouse(self, tmp_path, tiny_predictions):
        report = _run_benchmark(tmp_path, tmp_path / "absent.sqlite", tiny_predictions)
        assert report["warehouse"]["available"] is False
        assert report["paired_benchmark"]["overall"]["n"] == 0
        assert report["paired_benchmark"]["overall"]["metrics"]["model"]["brier"] is None
        assert any("missing, empty, or unreadable" in note for note in report["notes"])

    def test_zero_byte_warehouse(self, tmp_path, tiny_predictions):
        empty = tmp_path / "empty.sqlite"
        empty.touch()
        report = _run_benchmark(tmp_path, empty, tiny_predictions)
        assert report["warehouse"]["available"] is False
        assert report["paired_benchmark"]["overall"]["n"] == 0

    def test_warehouse_with_schema_but_no_odds(self, tmp_path, tiny_predictions):
        from backend.services.data.warehouse import Warehouse

        path = tmp_path / "bare.sqlite"
        warehouse = Warehouse(path)
        warehouse.migrate()
        warehouse.close()

        report = _run_benchmark(tmp_path, path, tiny_predictions)
        assert report["warehouse"]["available"] is True
        assert report["warehouse"]["matches_with_closing_odds"] == 0
        assert report["paired_benchmark"]["overall"]["n"] == 0
        assert report["market_corpus"]["overall"]["n"] == 0
        assert any("Zero fixtures were paired" in note for note in report["notes"])

    def test_missing_predictions_directory(self, tmp_path, tiny_warehouse):
        report = _run_benchmark(tmp_path, tiny_warehouse, tmp_path / "no_such_dir")
        assert report["paired_benchmark"]["coverage"]["settled_predictions"] == 0
        assert report["paired_benchmark"]["overall"]["n"] == 0
        # The market corpus does not depend on predictions and must survive.
        assert report["market_corpus"]["overall"]["n"] == 4
        assert any("No settled predictions" in note for note in report["notes"])

    def test_corrupt_prediction_file_is_skipped(self, tmp_path, tiny_warehouse):
        directory = tmp_path / "preds"
        directory.mkdir()
        (directory / "predictions_2026-01.json").write_text("{not json")
        report = _run_benchmark(tmp_path, tiny_warehouse, directory)
        assert report["paired_benchmark"]["overall"]["n"] == 0

    def test_unknown_league_filter_exits_nonzero(self, tmp_path, tiny_warehouse,
                                                 tiny_predictions):
        from backend.scripts.benchmark_market import main

        code = main([
            "--warehouse", str(tiny_warehouse),
            "--predictions-dir", str(tiny_predictions),
            "--output", str(tmp_path / "unused.json"),
            "--league", "Kabaddi Premier League",
            "--quiet",
        ])
        assert code == 2

    def test_bad_since_exits_nonzero(self, tmp_path, tiny_warehouse, tiny_predictions):
        from backend.scripts.benchmark_market import main

        code = main([
            "--warehouse", str(tiny_warehouse),
            "--predictions-dir", str(tiny_predictions),
            "--output", str(tmp_path / "unused.json"),
            "--since", "last tuesday",
            "--quiet",
        ])
        assert code == 2
