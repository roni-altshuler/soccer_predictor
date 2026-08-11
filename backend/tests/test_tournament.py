"""Tests for the knockout-tournament layer.

The cases below are the ones that were actually wrong at some point while this
was being built, plus the two that would be silent if they broke:

  * `second-round` means the round of 32 in the Europa League and the round of
    16 at the 1998 World Cup. Depth must come from counting, not parsing.
  * A rating read at kickoff must not include the result of that kickoff.
"""
from __future__ import annotations

import sqlite3

import pytest

from backend.services.tournament import ratings as R
from backend.services.tournament import ties as T
from backend.services.tournament.rounds import (
    GROUP,
    KNOCKOUT,
    QUALIFYING,
    THIRD_PLACE,
    away_goals_applies,
    classify,
    depth_label,
    slug,
)


# ---------------------------------------------------------------- rounds ---
@pytest.mark.parametrize("phase,expected", [
    ("group-stage", GROUP),
    ("league-phase", GROUP),
    ("2010-first-phase", GROUP),
    ("201617-group-stage", GROUP),
    ("2014-first-round", GROUP),          # Europa League group stage
    ("group-stage-2004", GROUP),
    ("qualifying-third-round", QUALIFYING),
    ("third-qualifying-round", QUALIFYING),
    ("preliminary-round", QUALIFYING),
    ("third-place", THIRD_PLACE),
    ("3rd-place-match", THIRD_PLACE),
    ("round-of-16", KNOCKOUT),
    ("quarter-finals", KNOCKOUT),
    ("knockout-round-playoffs", KNOCKOUT),
    ("play-off-round", KNOCKOUT),
    ("second-round", KNOCKOUT),
    ("final", KNOCKOUT),
])
def test_classify(phase, expected):
    assert classify(phase) == expected


def test_bare_first_round_is_not_a_group_stage():
    """Only the year-prefixed form is the Europa League group stage."""
    assert classify("first-round") == KNOCKOUT
    assert classify("2014-first-round") == GROUP


def test_slug_collapses_label_variants():
    assert slug("quarter-finals") == slug("quarterfinals")
    assert slug("semi-finals") == slug("semifinals")
    assert slug("3rd-place") == slug("third-place") == "third-place"


def test_away_goals_cutoff():
    assert away_goals_applies(2020)
    assert not away_goals_applies(2021)


def test_depth_label():
    assert depth_label(2) == "final"
    assert depth_label(8) == "quarterfinals"
    assert depth_label(22) == "round-of-22"


# ------------------------------------------------------------------ ties ---
def _leg(mid, date, h, a, hs, as_, *, so=None, winner=None):
    return T.Leg(match_id=mid, date_utc=date, home_team_id=h, away_team_id=a,
                 home_score=hs, away_score=as_,
                 home_shootout=so[0] if so else None,
                 away_shootout=so[1] if so else None,
                 winner_side=winner, status_detail=None)


def test_single_leg_uses_espn_winner_not_the_scoreline():
    """Argentina 3-3 France is not a draw; it is a World Cup."""
    legs = [_leg("m1", "2022-12-18", 1, 2, 3, 3, so=(4, 2), winner="home")]
    assert T.resolve(legs, 2022) == (1, "single")


def test_two_legged_aggregate():
    legs = [_leg("m1", "2024-03-01", 1, 2, 0, 2),
            _leg("m2", "2024-03-08", 2, 1, 1, 1)]
    # team 1 aggregate 1, team 2 aggregate 3
    assert T.resolve(legs, 2024) == (2, "aggregate")


def test_two_legged_shootout_beats_level_aggregate():
    legs = [_leg("m1", "2024-03-01", 1, 2, 1, 0),
            _leg("m2", "2024-03-08", 2, 1, 1, 0, so=(2, 4))]
    assert T.resolve(legs, 2024) == (1, "shootout")


def test_away_goals_applied_before_2021_and_not_after():
    # 1-2 then 1-0: aggregate 2-2, team 2 scored 2 away, team 1 scored 1 away.
    legs = [_leg("m1", "2019-03-01", 1, 2, 1, 2),
            _leg("m2", "2019-03-08", 2, 1, 0, 1)]
    winner, how = T.resolve(legs, 2019)
    assert (winner, how) == (2, "away_goals")

    legs_modern = [_leg("m1", "2022-03-01", 1, 2, 1, 2),
                   _leg("m2", "2022-03-08", 2, 1, 0, 1)]
    _, how_modern = T.resolve(legs_modern, 2022)
    assert how_modern != "away_goals"


def test_second_leg_at_the_same_venue_still_aggregates_correctly():
    """A tie whose second leg is not venue-reversed must not be summed as if
    it were — that would credit the wrong side."""
    legs = [_leg("m1", "2021-03-01", 1, 2, 3, 0),
            _leg("m2", "2021-03-08", 1, 2, 0, 1)]
    assert T.resolve(legs, 2021) == (1, "aggregate")


def test_flag_missing_legs_refuses_a_lone_leg_in_a_two_legged_round():
    def mk(a, b, two):
        legs = [_leg(f"x{a}{b}", "2009-07-01", a, b, 2, 0)]
        if two:
            legs.append(_leg(f"y{a}{b}", "2009-07-08", b, a, 0, 1))
        w, how = T.resolve(legs, 2009)
        return T.Tie(competition_id="uefa.champions", season=2009,
                     round_slug="qualifyingsecondround", team_a=a, team_b=b,
                     legs=legs, winner=w, resolution=how)

    ties = [mk(1, 2, True), mk(3, 4, True), mk(5, 6, True), mk(7, 8, False)]
    T._flag_missing_legs(ties)
    assert ties[-1].resolution == "incomplete"
    assert ties[-1].winner is None
    assert all(t.resolution == "aggregate" for t in ties[:3])


def test_depth_is_counted_not_parsed():
    """Two rounds both slugged `secondround` in different competitions get the
    depth their own bracket implies."""
    def mk(comp, a, b, rnd):
        legs = [_leg(f"{comp}{a}{b}", "2015-02-01", a, b, 1, 0)]
        return T.Tie(competition_id=comp, season=2015, round_slug=rnd,
                     team_a=a, team_b=b, legs=legs, winner=a, resolution="single")

    ties = [mk("uefa.europa", i, i + 100, "secondround") for i in range(16)]
    ties += [mk("fifa.world", i, i + 100, "secondround") for i in range(200, 208)]
    T._assign_depth(ties)
    europa = [t for t in ties if t.competition_id == "uefa.europa"][0]
    world = [t for t in ties if t.competition_id == "fifa.world"][0]
    assert europa.round_label == "round-of-32"
    assert world.round_label == "round-of-16"


# --------------------------------------------------------------- ratings ---
def _mem_warehouse() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE matches (
        match_id TEXT PRIMARY KEY, competition_id TEXT, date_utc TEXT,
        home_team_id INT, away_team_id INT, home_score INT, away_score INT,
        phase TEXT)""")
    return conn


def test_rating_is_read_strictly_before_the_match_that_produced_it():
    conn = _mem_warehouse()
    conn.executemany(
        "INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)",
        [("m1", "eng.1", "2020-01-01T15:00:00+00:00", 1, 2, 3, 0, None),
         ("m2", "eng.1", "2020-01-08T15:00:00+00:00", 1, 2, 3, 0, None)])
    table = R.build(conn)

    # Nothing preceded the first match, so there is no rating to read. None,
    # not 1500 — a debutant is unknown, not average.
    assert table.rating_before(1, "2020-01-01T15:00:00+00:00") is None

    # By the second match, exactly one result is in the rating: the first.
    # This is the assertion that fails if the table stores pre-match values,
    # because the lookup then bisects back past the first match and returns a
    # rating one game stale.
    r1 = table.rating_before(1, "2020-01-08T15:00:00+00:00")
    r2 = table.rating_before(2, "2020-01-08T15:00:00+00:00")
    assert r1 > R.BASE and r2 < R.BASE
    assert r1 + r2 == pytest.approx(2 * R.BASE)   # zero-sum after one match

    # And after both matches, both results are in.
    assert table.rating_before(1, "2020-02-01T00:00:00+00:00") > r1


def test_unknown_team_returns_none_not_a_default():
    table = R.EloTable()
    assert table.rating_before(999, "2020-01-01") is None
    assert table.matches_before(999, "2020-01-01") == 0


def test_neutral_competition_gets_no_home_advantage():
    """Two identical fixtures, one in a league and one at a World Cup. The
    away side's loss must cost it MORE in the league, because it was expected
    to do worse there."""
    def run(comp):
        conn = _mem_warehouse()
        conn.execute("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)",
                     ("m1", comp, "2020-01-01T15:00:00+00:00", 1, 2, 1, 0, None))
        conn.execute("INSERT INTO matches VALUES (?,?,?,?,?,?,?,?)",
                     ("m2", comp, "2020-06-01T15:00:00+00:00", 1, 2, 1, 0, None))
        return R.build(conn).rating_before(2, "2020-06-01T15:00:00+00:00")

    assert run("eng.1") > run("fifa.world")


def test_margin_of_victory_is_damped_not_linear():
    """A 6-0 must move a rating more than a 1-0, but not six times more."""
    one = R._mov_multiplier(1, 0.0)
    six = R._mov_multiplier(6, 0.0)
    assert one < six < 6 * one


def test_long_layoff_regresses_toward_the_mean():
    cfg = R.EloConfig()
    rating = {1: 1800.0}
    last = {1: "2020-01-01T00:00:00+00:00"}
    fresh = R._current(rating, last, 1, "2020-01-20T00:00:00+00:00", cfg)
    stale = R._current(rating, last, 1, "2022-01-01T00:00:00+00:00", cfg)
    assert fresh == 1800.0            # inside the grace window
    assert R.BASE < stale < 1800.0
