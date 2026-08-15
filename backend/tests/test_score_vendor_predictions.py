"""The vendor scorer: the join, the drop taxonomy, and the pre-registered rule.

Three things can quietly turn this comparison into a lie, and each has tests
here:

1. **A silent drop.** A fixture that fails to join is a fixture removed from the
   sample, and if the failures correlate with anything (one league's spellings,
   one vendor's naming) the remaining sample is biased. Every vendor row must
   land in exactly one reported bucket.
2. **A join that guesses.** The relaxed comparison exists to catch "D.C. United"
   vs "DC United". Behind the uniqueness gate it is safe; without the gate it
   would happily pair the wrong two clubs.
3. **A moved goalpost.** The decision rule is written down before the data
   arrives, so it is tested like any other logic.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.scripts import score_vendor_predictions as svp

ROOT = Path(__file__).resolve().parents[2]
KICK = datetime(2026, 8, 15, 17, 30, tzinfo=timezone.utc)
KICK_ISO = KICK.isoformat()


def vendor_row(home="Alaves", away="Getafe", cid="esp.1", **over):
    row = {
        "vendor": "api-football",
        "captured_at": (KICK - timedelta(hours=3)).isoformat(),
        "fixture_id": 1,
        "competition_id": cid,
        "kickoff": KICK_ISO,
        "home": home,
        "away": away,
        "p_home": 0.45,
        "p_draw": 0.45,
        "p_away": 0.10,
        "before_kickoff": True,
    }
    row.update(over)
    return row


def our_pred(home="Alavés", away="Getafe", league="La Liga", winner="home", **over):
    pred = {
        "match_id": "401879301",
        "league": league,
        "match_date": "2026-08-15",
        "home_team": home,
        "away_team": away,
        "prediction_timestamp": (KICK - timedelta(days=1)).isoformat(),
        "predicted_home_win": 0.44,
        "predicted_draw": 0.29,
        "predicted_away_win": 0.27,
        "actual_winner": winner,
    }
    pred.update(over)
    return pred


def ours_map(*preds):
    out = {}
    for p in preds:
        cid = svp.LEAGUE_TO_ESPN[p["league"]]
        out[svp.fixture_key(cid, p["match_date"], p["home_team"], p["away_team"])] = p
    return out


class TestScoringRules:
    def test_brier_matches_the_benchmark_definition(self):
        # Summed over three outcomes, so a perfect call is 0 and a confident
        # miss is 2. Every number in CLAUDE.md is on this scale; a mean-squared
        # variant would silently third them.
        assert svp.brier([1.0, 0.0, 0.0], 0) == pytest.approx(0.0)
        assert svp.brier([0.0, 0.0, 1.0], 0) == pytest.approx(2.0)
        assert svp.brier([1 / 3, 1 / 3, 1 / 3], 1) == pytest.approx(0.6667, abs=1e-4)

    def test_log_loss_is_clamped_not_infinite(self):
        # A vendor that says 0% and is wrong deserves an unbounded penalty, but
        # an inf mean prints as nan and hides every other number in the row.
        assert svp.log_loss([0.0, 0.5, 0.5], 0) > 30
        assert svp.log_loss([0.5, 0.3, 0.2], 0) == pytest.approx(0.6931, abs=1e-4)

    def test_a_zero_call_is_counted_even_though_it_is_clamped(self):
        rows = [{"vendor": [0.0, 0.5, 0.5], "outcome_index": 0}]
        assert svp.score_set(rows, "vendor")["impossible_calls"] == 1
        rows = [{"vendor": [0.1, 0.5, 0.4], "outcome_index": 0}]
        assert svp.score_set(rows, "vendor")["impossible_calls"] == 0


class TestPairedBootstrap:
    def test_a_consistent_winner_is_significant(self):
        a = [0.1] * 400
        b = [0.5] * 400
        out = svp.paired_bootstrap(a, b, iters=500)
        assert out["mean_diff"] == pytest.approx(-0.4)
        assert out["significant"] is True
        assert out["p_a_better"] == 1.0

    def test_noise_is_not(self):
        a = [0.4, 0.6] * 200
        b = [0.6, 0.4] * 200
        out = svp.paired_bootstrap(a, b, iters=500)
        assert out["significant"] is False

    def test_required_n_falls_as_the_pair_agrees(self):
        # Paired differences are far tighter than either series; quoting a
        # sample size off the raw spread would overstate the wait badly.
        tight = svp.required_n([0.50, 0.51, 0.52] * 30, [0.49, 0.51, 0.50] * 30)
        loose = svp.required_n([0.1, 0.9, 0.5] * 30, [0.9, 0.1, 0.5] * 30)
        assert tight < loose

    def test_required_n_refuses_on_a_single_fixture(self):
        assert svp.required_n([0.5], [0.4]) is None

    def test_required_n_refuses_when_the_pair_never_disagrees(self):
        # A constant difference has no spread to extrapolate from. Returning a
        # confident "n = 1" there would be the worst possible answer.
        assert svp.required_n([0.5] * 20, [0.4] * 20) is None


class TestSharedConstants:
    def test_the_normaliser_still_agrees_with_the_resolver(self):
        # Two normalisers that drift apart join 96% of the time and lose the
        # other 4% in silence. team_resolver cannot be imported directly (its
        # package __init__ pulls in httpx), so it is loaded from the file.
        import importlib.util
        import sys

        path = ROOT / "backend" / "services" / "data" / "team_resolver.py"
        spec = importlib.util.spec_from_file_location("_tr_for_test", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules["_tr_for_test"] = module
        spec.loader.exec_module(module)

        names = [
            "Alavés", "Kasımpaşa", "Atlético Madrid", "FC Barcelona",
            "Manchester United", "1. FC Köln", "Borussia M'gladbach",
            "AZ Alkmaar", "D.C. United", "Nott'm Forest", "SC Cambuur",
            "Académico de Viseu", "VfB Stuttgart", "Real Madrid CF",
        ]
        for name in names:
            assert svp.norm_team(name) == module._normalise(name), name

    def test_the_league_map_still_agrees_with_fetch_outcomes(self):
        # Parsed rather than imported, for the same httpx reason. If someone
        # renames a league in one file this fails instead of dropping a
        # competition out of the comparison.
        source = (ROOT / "backend" / "scripts" / "fetch_outcomes.py").read_text(encoding="utf8")
        block = re.search(r"LEAGUE_TO_ESPN.*?=\s*\{(.*?)\n\}", source, re.S)
        assert block, "LEAGUE_TO_ESPN is no longer where this test looks for it"
        theirs = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', block.group(1)))
        for league, cid in svp.LEAGUE_TO_ESPN.items():
            assert theirs.get(league) == cid, f"{league} disagrees with fetch_outcomes"


class TestRelaxedKey:
    @pytest.mark.parametrize(
        "a,b",
        [
            ("Academico Viseu", "Académico de Viseu"),   # a connector word
            ("Cambuur", "SC Cambuur"),                   # a tag in front
            ("DC United", "D.C. United"),                # split on its dots
            ("New York Red Bulls", "Red Bull New York"), # reordered + plural
        ],
    )
    def test_it_joins_the_four_spellings_that_actually_failed(self, a, b):
        assert svp.relaxed_key(a) == svp.relaxed_key(b)

    @pytest.mark.parametrize(
        "a,b",
        [
            ("Manchester United", "Manchester City"),
            ("Sheffield United", "Sheffield Wednesday"),
            ("Real Madrid", "Real Sociedad"),
            ("Rangers", "Queens Park Rangers"),
            ("Atletico Madrid", "Athletic Bilbao"),
        ],
    )
    def test_it_does_not_merge_different_clubs(self, a, b):
        assert svp.relaxed_key(a) != svp.relaxed_key(b)


class TestUniquenessGate:
    def _same_day(self, *pairs):
        return [
            (svp.fixture_key("usa.1", "2026-08-15", h, a), {"home_team": h, "away_team": a})
            for h, a in pairs
        ]

    def test_one_loose_match_is_accepted(self):
        key = svp.fixture_key("usa.1", "2026-08-15", "DC United", "Toronto")
        found, how = svp.relaxed_lookup(key, self._same_day(("D.C. United", "Toronto FC")))
        assert how == "relaxed" and found is not None

    def test_two_loose_matches_are_refused(self):
        # THE test for this file. Without the gate the relaxed comparison
        # returns whichever fixture happens to come first, and a wrong join is
        # worse than a missing one — it puts a real number on the wrong result.
        key = svp.fixture_key("usa.1", "2026-08-15", "DC United", "Toronto")
        same_day = self._same_day(("D.C. United", "Toronto FC"), ("D C United", "Toronto"))
        found, how = svp.relaxed_lookup(key, same_day)
        assert found is None and how == "name_join_ambiguous"

    def test_no_match_is_reported_as_a_failure_not_a_guess(self):
        key = svp.fixture_key("usa.1", "2026-08-15", "DC United", "Toronto")
        found, how = svp.relaxed_lookup(key, self._same_day(("Orlando City", "Cincinnati")))
        assert found is None and how == "name_join_failed"


class TestDropTaxonomy:
    def test_a_clean_pair_is_scored(self):
        paired, dropped = svp.pair_rows([vendor_row()], ours_map(our_pred()), {})
        assert len(paired) == 1 and not dropped
        assert paired[0]["outcome"] == "home" and paired[0]["joined_by"] == "exact"

    def test_a_vendor_capture_after_kickoff_is_refused(self):
        paired, dropped = svp.pair_rows(
            [vendor_row(before_kickoff=False)], ours_map(our_pred()), {}
        )
        assert not paired and dropped["vendor_captured_after_kickoff"] == 1

    def test_our_own_forecast_is_held_to_the_same_rule(self):
        # The asymmetry this guards against is the tempting one: enforce
        # point-in-time on the challenger, wave it through for the incumbent,
        # and win by construction.
        late = our_pred(prediction_timestamp=(KICK + timedelta(minutes=1)).isoformat())
        paired, dropped = svp.pair_rows([vendor_row()], ours_map(late), {})
        assert not paired and dropped["ours_not_stamped_before_kickoff"] == 1

    def test_an_unstamped_forecast_of_ours_is_also_refused(self):
        blank = our_pred(prediction_timestamp=None)
        paired, dropped = svp.pair_rows([vendor_row()], ours_map(blank), {})
        assert not paired and dropped["ours_not_stamped_before_kickoff"] == 1

    def test_an_unplayed_fixture_waits_rather_than_scoring(self):
        paired, dropped = svp.pair_rows(
            [vendor_row()], ours_map(our_pred(actual_winner=None)), {}
        )
        assert not paired and dropped["no_result_yet"] == 1

    def test_a_competition_we_do_not_forecast_is_named_as_such(self):
        # Süper Lig is captured and never scoreable. That is a scope fact worth
        # reading, not a join bug worth chasing.
        paired, dropped = svp.pair_rows([vendor_row(cid="tur.1")], ours_map(our_pred()), {})
        assert not paired and dropped["ours_never_forecast_this_competition"] == 1

    def test_a_missing_triple_is_refused_before_anything_else(self):
        paired, dropped = svp.pair_rows(
            [vendor_row(p_draw=None)], ours_map(our_pred()), {}
        )
        assert not paired and dropped["vendor_gave_no_triple"] == 1

    def test_every_row_lands_in_exactly_one_bucket(self):
        rows = [
            vendor_row(fixture_id=1),
            vendor_row(fixture_id=2, before_kickoff=False),
            vendor_row(fixture_id=3, cid="tur.1"),
            vendor_row(fixture_id=4, p_home=None),
            vendor_row(fixture_id=5, home="Nowhere United", away="Nobody"),
        ]
        paired, dropped = svp.pair_rows(rows, ours_map(our_pred()), {})
        assert len(paired) + sum(dropped.values()) == len(rows)


class TestPrices:
    def test_it_takes_the_last_price_before_kickoff(self):
        snaps = [
            {"captured_at": (KICK - timedelta(days=2)).isoformat(),
             "odds_home": 2.0, "odds_draw": 4.0, "odds_away": 4.0},
            {"captured_at": (KICK - timedelta(hours=1)).isoformat(),
             "odds_home": 1.5, "odds_draw": 4.0, "odds_away": 8.0},
        ]
        got = svp.latest_price_before(snaps, KICK)
        assert got[0] > 0.6  # the later, shorter price, not the earlier one

    def test_a_price_taken_after_kickoff_is_not_a_price(self):
        snaps = [{"captured_at": (KICK + timedelta(minutes=5)).isoformat(),
                  "odds_home": 1.5, "odds_draw": 4.0, "odds_away": 8.0}]
        assert svp.latest_price_before(snaps, KICK) is None

    def test_devig_sums_to_one(self):
        p = svp.devig(2.0, 4.0, 4.0)
        assert sum(p) == pytest.approx(1.0)
        assert p[0] == pytest.approx(0.5)


class TestDegeneracy:
    def test_it_counts_triples_with_two_identical_legs(self):
        rows = [
            {"p_home": 0.45, "p_draw": 0.45, "p_away": 0.10},
            {"p_home": 0.00, "p_draw": 0.50, "p_away": 0.50},
            {"p_home": 0.44, "p_draw": 0.29, "p_away": 0.27},
        ]
        out = svp.degeneracy(rows)
        assert out["two_legs_identical"] == 2 and out["n"] == 3
        assert out["share"] == pytest.approx(0.6667, abs=1e-3)

    def test_it_survives_rows_with_no_triple(self):
        assert svp.degeneracy([{"p_home": None, "p_draw": None, "p_away": None}])["n"] == 0


class TestPreRegisteredRule:
    def _summary(self, n, boot, price_block=None):
        return {
            "scored_fixtures": n,
            "paired_brier_bootstrap_vendor_minus_ours": boot,
            "on_fixtures_with_a_price": price_block,
        }

    def test_a_small_sample_decides_nothing(self):
        v = svp.verdict(self._summary(12, {"mean_diff": -0.4, "significant": True}))
        assert v["decision"] == "keep ours" and v["final"] is False

    def test_losing_on_paired_brier_keeps_ours(self):
        v = svp.verdict(self._summary(500, {"mean_diff": 0.02, "significant": True}))
        assert v["decision"] == "keep ours" and v["final"] is True

    def test_winning_without_significance_keeps_ours(self):
        # The sign of a point estimate is not a result. This is the clause that
        # stops a lucky fortnight promoting a vendor.
        v = svp.verdict(self._summary(500, {"mean_diff": -0.004, "significant": False}))
        assert v["decision"] == "keep ours"

    def test_winning_overall_but_not_where_a_price_exists_makes_it_a_feature(self):
        # The priced fixtures are a subset, so the two comparisons can disagree.
        # When they do, the priced one is the stricter read.
        block = {
            "market": {"brier": 0.57}, "ours": {"brier": 0.585}, "vendor": {"brier": 0.59},
        }
        v = svp.verdict(self._summary(500, {"mean_diff": -0.005, "significant": True}, block))
        assert "feature" in v["decision"]

    def test_winning_and_closing_the_market_gap_adopts_it(self):
        block = {
            "market": {"brier": 0.57}, "ours": {"brier": 0.60}, "vendor": {"brier": 0.575},
        }
        v = svp.verdict(self._summary(500, {"mean_diff": -0.025, "significant": True}, block))
        assert v["decision"] == "adopt the vendor's triple" and v["final"] is True

    def test_beating_the_price_sends_us_to_the_harness_not_to_adoption(self):
        # This repo has lost months to a benchmark bug that announced itself
        # exactly this way. A bought 1X2 out-predicting the price it is derived
        # from is a claim to audit, never a result to ship.
        block = {
            "market": {"brier": 0.57}, "ours": {"brier": 0.59}, "vendor": {"brier": 0.54},
        }
        v = svp.verdict(self._summary(500, {"mean_diff": -0.05, "significant": True}, block))
        assert v["decision"] == "do not adopt yet — audit the harness"
        assert v["final"] is False

    def test_no_price_means_the_third_clause_cannot_be_read(self):
        v = svp.verdict(self._summary(500, {"mean_diff": -0.025, "significant": True}, None))
        assert v["final"] is False and "price" in v["because"]


class TestEndToEnd:
    def test_it_scores_a_played_fixture_and_names_the_winner(self, tmp_path):
        vendor = tmp_path / "v.jsonl"
        vendor.write_text(json.dumps(vendor_row()) + "\n", encoding="utf8")
        rows = svp.load_vendor(vendor)
        paired, _ = svp.pair_rows(rows, ours_map(our_pred(winner="away")), {})
        summary = svp.summarise(paired, svp.Counter(), rows)
        # Vendor said 10% away, we said 27%, and away happened.
        assert summary["vendor"]["brier"] > summary["ours"]["brier"]
        assert summary["scored_fixtures"] == 1
        assert summary["verdict"]["decision"] == "keep ours"

    def test_a_broken_line_does_not_lose_the_file(self, tmp_path):
        vendor = tmp_path / "v.jsonl"
        vendor.write_text(
            json.dumps(vendor_row(fixture_id=1)) + "\n{ broken\n"
            + json.dumps(vendor_row(fixture_id=2)) + "\n",
            encoding="utf8",
        )
        assert len(svp.load_vendor(vendor)) == 2
