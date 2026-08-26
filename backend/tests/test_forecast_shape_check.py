"""A dropped non-participant's fixtures leave with it.

On 2026-08-26 the Season Forecast run failed and the Premier League's table
was withdrawn by the round-robin shape check. The chain: the previous day's
ingest had filed football-data's "Coventry" (newly promoted, a spelling no
alias list had needed before) as a second club beside ESPN's "Coventry City",
so one played match entered eng.1 twice, once per identity.
`league_participants` did its job — one appearance against a median of 38, the
split identity was dropped — but the fixture filter ran AFTER the completeness
check, so the season still counted 381 fixtures against a 380-fixture
expectation, read as more than a double round robin, and the check refused the
league. The publish guard then (correctly) refused to ship a forecast with
eng.1 missing.

`league_participants` now drops a club and its fixtures in the same motion, so
the shape check and the points table only ever see matches between clubs that
are actually in the league.
"""
from __future__ import annotations

from itertools import permutations

from backend.scripts.forecast_season import league_participants


def _fixture(home: str, away: str) -> dict:
    return {"home_key": f"eng.1::{home}", "away_key": f"eng.1::{away}"}


def _entrants_and_appearances(rows):
    appearances: dict = {}
    for r in rows:
        for k in (r["home_key"], r["away_key"]):
            appearances[k] = appearances.get(k, 0) + 1
    return sorted(appearances), appearances


def _double_round_robin(teams):
    return [_fixture(h, a) for h, a in permutations(teams, 2)]


TEAMS = [f"club {i:02d}" for i in range(19)] + ["coventry city"]


def test_the_incident_a_split_identity_duplicate_cannot_poison_the_shape():
    """20 real clubs, 380 real fixtures, one duplicate under a split spelling:
    the split is dropped AND its fixture goes with it, so the season measures
    exactly 100% of a double round robin and the table publishes."""
    fixtures = _double_round_robin(TEAMS)
    played = [fixtures.pop()]                        # matchday has begun
    played.append(_fixture("club 00", "coventry"))   # the football-data twin
    entrants, appearances = _entrants_and_appearances(fixtures + played)
    assert len(entrants) == 21

    keep, fs, done = league_participants(entrants, appearances,
                                         fixtures, played)

    assert len(keep) == 20
    assert "eng.1::coventry" not in keep
    assert "eng.1::coventry city" in keep
    expected = len(keep) * (len(keep) - 1)
    assert len(fs) + len(done) == expected  # completeness exactly 1.0


def test_the_all_star_game_leaves_no_points_behind():
    """The usa.1 shape: two one-match sides in a league where everyone else
    plays a full season. Both clubs and their exhibition leave together, so
    the match cannot contribute points to whoever ESPN listed as home."""
    fixtures = _double_round_robin(TEAMS)
    exhibition = _fixture("mls all-stars", "liga mx all-stars")
    entrants, appearances = _entrants_and_appearances(fixtures + [exhibition])

    keep, fs, done = league_participants(entrants, appearances,
                                         fixtures, [exhibition])

    assert len(keep) == 20
    assert done == []
    assert len(fs) == len(fixtures)


def test_a_clean_league_passes_through_untouched():
    fixtures = _double_round_robin(TEAMS)
    entrants, appearances = _entrants_and_appearances(fixtures)

    keep, fs, done = league_participants(entrants, appearances, fixtures, [])

    assert keep == entrants
    assert fs == fixtures
    assert done == []


def test_no_entrants_is_not_an_error():
    assert league_participants([], {}, [], []) == ([], [], [])
