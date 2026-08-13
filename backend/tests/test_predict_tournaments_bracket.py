"""Tests for the bracket the forward forecast publishes.

`_bracket` is what turned `tournaments.json` from a list of title odds into
something a page can draw a path from, and it carries two claims that are
silent when they break:

  * a tie is either SETTLED (score, winner) or PRICED (`p_team_a`), never
    both. A percentage beside a finished tie reads as a forecast of a result
    already known.
  * the heading above a round comes from the SLUG, while the structure comes
    from the counted depth. Those are different strings on purpose — the
    Champions League play-off round and the round of 16 are both eight ties,
    so both count as `round-of-16`, and an edition printed from the counted
    label alone shows the same heading twice.

Plus the status bug these tests were written for: an edition with nothing left
to play is FINISHED. It is not "awaiting a draw", whatever the bracket tree
could or could not be paired into.
"""
from __future__ import annotations

import pytest

from backend.scripts.predict_tournaments import _bracket, _round_display, _score
from backend.services.tournament import ties as T


def _leg(mid, date, h, a, hs, as_, *, so=None):
    return T.Leg(match_id=mid, date_utc=date, home_team_id=h, away_team_id=a,
                 home_score=hs, away_score=as_,
                 home_shootout=so[0] if so else None,
                 away_shootout=so[1] if so else None,
                 winner_side=None, status_detail=None)


def _tie(slug, a, b, legs, winner, *, remaining=2, resolution="single"):
    t = T.Tie(competition_id="uefa.champions", season=2025, round_slug=slug,
              team_a=a, team_b=b, legs=legs, winner=winner,
              resolution=resolution)
    t.teams_remaining = remaining
    return t


NAMES = {1: "Arsenal", 2: "Bayern Munich", 3: "Real Madrid", 4: "Inter"}


# ------------------------------------------------------------- the rounds ---
def test_rounds_are_emitted_in_the_order_given_and_never_dropped():
    played = _tie("semifinals", 1, 2, [_leg("m1", "2026-05-05", 1, 2, 2, 0)], 1,
                  remaining=4)
    final = _tie("final", 1, 3, [_leg("m2", "2026-05-30", 1, 3, 1, 0)], 1,
                 remaining=2)

    out = _bracket([("semifinals", [played]), ("final", [final])], NAMES)

    assert [r["slug"] for r in out] == ["semifinals", "final"]
    assert [r["display"] for r in out] == ["Semi-finals", "Final"]


def test_an_empty_round_is_skipped_rather_than_printed_as_a_heading():
    final = _tie("final", 1, 3, [_leg("m2", "2026-05-30", 1, 3, 1, 0)], 1)
    out = _bracket([("quarterfinals", []), ("final", [final])], NAMES)
    assert [r["slug"] for r in out] == ["final"]


def test_two_rounds_at_the_same_depth_get_different_headings():
    """The whole reason `display` exists.

    The Champions League play-off round and the round of 16 are both eight
    ties, so `round_label` is `round-of-16` for both. An edition printed from
    the counted label alone showed "Round of 16" twice.
    """
    playoff = _tie("knockoutroundplayoffs", 1, 2,
                   [_leg("m1", "2026-02-17", 1, 2, 1, 0)], 1, remaining=16)
    r16 = _tie("roundof16", 3, 4, [_leg("m2", "2026-03-10", 3, 4, 2, 1)], 3,
               remaining=16)

    out = _bracket([("knockoutroundplayoffs", [playoff]), ("roundof16", [r16])],
                   NAMES)

    assert [r["label"] for r in out] == ["round-of-16", "round-of-16"]
    assert [r["display"] for r in out] == ["Knockout play-offs", "Round of 16"]


# ---------------------------------------------------------------- the ties ---
def test_a_settled_tie_carries_the_score_and_no_probability():
    tie = _tie("final", 1, 2, [_leg("m1", "2026-05-30", 1, 2, 3, 1)], 1)
    # A price is offered for this pairing and must be ignored: the tie is over.
    row = _bracket([("final", [tie])], NAMES, {(1, 2): 0.61})[0]["ties"][0]

    assert row["score"] == "3-1"
    assert row["winner"] == "Arsenal"
    assert row["winner_id"] == 1
    assert row["pending"] is False
    assert row["p_team_a"] is None


def test_an_undecided_tie_carries_a_probability_and_no_score():
    tie = _tie("final", 1, 2, [_leg("m1", "2026-05-30", 1, 2, None, None)], None)
    row = _bracket([("final", [tie])], NAMES, {(1, 2): 0.6149})[0]["ties"][0]

    assert row["pending"] is True
    assert row["score"] is None
    assert row["winner"] is None
    assert row["winner_id"] is None
    assert row["p_team_a"] == 0.6149


def test_an_undecided_tie_with_no_price_is_published_unpriced_not_dropped():
    """A round the simulator did not reach is still part of the path."""
    tie = _tie("final", 1, 2, [_leg("m1", "2026-05-30", 1, 2, None, None)], None)
    round_ = _bracket([("final", [tie])], NAMES)[0]

    assert len(round_["ties"]) == 1
    assert round_["ties"][0]["p_team_a"] is None


def test_ties_are_ordered_by_kickoff_so_a_round_reads_as_a_matchday():
    late = _tie("roundof16", 1, 2, [_leg("m1", "2026-02-18", 1, 2, 1, 0)], 1)
    early = _tie("roundof16", 3, 4, [_leg("m2", "2026-02-17", 3, 4, 2, 0)], 3)
    rows = _bracket([("roundof16", [late, early])], NAMES)[0]["ties"]
    assert [r["kickoff"] for r in rows] == ["2026-02-17", "2026-02-18"]


def test_an_unknown_team_id_prints_as_itself_rather_than_disappearing():
    tie = _tie("final", 99, 1, [_leg("m1", "2026-05-30", 99, 1, 0, 1)], 1)
    row = _bracket([("final", [tie])], NAMES)[0]["ties"][0]
    assert row["team_a"] == "99"
    assert row["team_b"] == "Arsenal"


# -------------------------------------------------------------- the score ---
def test_a_shootout_is_shown_as_well_as_the_aggregate_not_instead_of_it():
    """1-1 alone reads as a drawn tie with a team advancing for no reason."""
    tie = _tie("final", 1, 2, [_leg("m1", "2026-05-30", 1, 2, 1, 1, so=(4, 2))], 1)
    assert _score(tie) == "1-1 (4-2 pens)"


def test_two_legs_are_aggregated_from_team_a_s_point_of_view():
    legs = [_leg("m1", "2026-04-07", 1, 2, 0, 2), _leg("m2", "2026-04-14", 2, 1, 1, 1)]
    tie = _tie("semifinals", 1, 2, legs, 2, resolution="aggregate")
    # team 1: 0 + 1 = 1. team 2: 2 + 1 = 3.
    assert _score(tie) == "1-3"


def test_a_half_played_tie_scores_only_the_leg_that_happened():
    legs = [_leg("m1", "2026-04-07", 1, 2, 2, 0),
            _leg("m2", "2026-04-14", 2, 1, None, None)]
    tie = _tie("semifinals", 1, 2, legs, None, resolution="pending")
    assert _score(tie) == "2-0"


def test_an_unplayed_tie_has_no_score_at_all():
    tie = _tie("final", 1, 2, [_leg("m1", "2026-05-30", 1, 2, None, None)], None)
    assert _score(tie) is None


# ------------------------------------------------------------- the headings ---
@pytest.mark.parametrize("slug,expected", [
    ("final", "Final"),
    ("semifinals", "Semi-finals"),
    ("quarterfinals", "Quarter-finals"),
    ("roundof16", "Round of 16"),
    ("knockoutroundplayoffs", "Knockout play-offs"),
    # One-word slugs the fallback cannot space out: it splits on separators,
    # and these have none, so they came through as "Firststage" and "Leaguea".
    ("firststage", "First stage"),
    ("secondstage", "Second stage"),
    ("thirdstage", "Third stage"),
    ("leaguea", "League A"),
    ("relegationplayoffs", "Relegation play-offs"),
])
def test_round_headings_are_what_a_reader_calls_the_round(slug, expected):
    assert _round_display(slug, "round-of-16") == expected


def test_an_unmapped_slug_is_spaced_out_rather_than_guessed_at():
    """A new format should print an ugly-but-true heading, not a wrong one."""
    assert _round_display("super-extra-round", "round-of-8") == "Super Extra Round"


def test_an_empty_slug_falls_back_to_the_counted_depth():
    assert _round_display("", "round-of-32") == "round-of-32"
