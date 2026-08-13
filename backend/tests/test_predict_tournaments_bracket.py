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

from backend.scripts.predict_tournaments import (
    _bracket,
    _bracket_slots,
    _round_display,
    _score,
)
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


# ------------------------------------------------------------- the placement ---
#
# A bracket is only a bracket if the tie at slot s is fed by slots 2s and 2s+1.
# Getting that wrong does not crash anything — it draws a tidy bracket in which
# the wrong two teams appear to have played each other.

def _pairs(*rounds):
    """Rounds of (team_a, team_b), the shape `_bracket_slots` takes."""
    return list(rounds)


def test_the_final_sits_at_slot_zero_and_earlier_rounds_double():
    qf = [(1, 2), (3, 4), (5, 6), (7, 8)]
    sf = [(1, 3), (5, 7)]
    final = [(1, 5)]
    slots, to_come = _bracket_slots(_pairs(qf, sf, final))

    assert to_come == 0
    assert slots[(2, 0)] == 0                      # the final
    assert sorted(slots[(1, i)] for i in range(2)) == [0, 1]
    assert sorted(slots[(0, i)] for i in range(4)) == [0, 1, 2, 3]


def test_a_tie_is_fed_by_the_two_slots_below_it():
    """The rule the whole drawing rests on, checked on a real shape."""
    qf = [(1, 2), (3, 4), (5, 6), (7, 8)]
    sf = [(1, 3), (5, 7)]                          # 1 beat 2, 3 beat 4, ...
    final = [(1, 5)]
    slots, _ = _bracket_slots(_pairs(qf, sf, final))

    # Whichever slot each semi-final took, its two feeders are 2s and 2s+1.
    for j, (a, b) in enumerate(sf):
        s = slots[(1, j)]
        feeders = {slots[(0, i)] for i, (x, y) in enumerate(qf)
                   if a in (x, y) or b in (x, y)}
        assert feeders == {2 * s, 2 * s + 1}


def test_two_ties_in_a_round_never_share_a_slot():
    qf = [(1, 2), (3, 4), (5, 6), (7, 8)]
    sf = [(1, 3), (5, 7)]
    final = [(1, 5)]
    slots, _ = _bracket_slots(_pairs(qf, sf, final))
    per_round = {}
    for (depth, _), s in slots.items():
        per_round.setdefault(depth, []).append(s)
    for depth, ss in per_round.items():
        assert len(ss) == len(set(ss)), f"round {depth} double-booked a slot"


def test_an_entry_round_is_left_out_of_the_tree():
    """The Champions League bolts an 8-tie play-off onto an 8-tie round of 16.

    It is a way into the bracket, not a round of it. Forcing it in doubles the
    drawing and misaligns every pairing above it.
    """
    playoff = [(11, 12), (13, 14), (15, 16), (17, 18),
               (19, 20), (21, 22), (23, 24), (25, 26)]
    r16 = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 13), (15, 17), (19, 21)]
    qf = [(1, 3), (5, 7), (9, 11), (15, 19)]
    sf = [(1, 5), (9, 15)]
    final = [(1, 9)]
    slots, _ = _bracket_slots(_pairs(playoff, r16, qf, sf, final))

    assert all((0, i) not in slots for i in range(len(playoff)))
    assert sorted(slots[(1, i)] for i in range(8)) == list(range(8))


def test_a_live_bracket_projects_the_rounds_that_are_not_drawn_yet():
    """The case that matters most, and the one bracket_tree refuses.

    The Libertadores stops at a drawn round of 16 because the quarter-finals do
    not exist yet. Requiring a final meant the two competitions actually being
    played were the only ones with no bracket at all.
    """
    r16 = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)]
    slots, to_come = _bracket_slots(_pairs(r16), project=True)

    assert to_come == 3                             # quarters, semis, final
    assert sorted(slots[(0, i)] for i in range(8)) == list(range(8))


def test_a_finished_edition_never_sprouts_empty_rounds():
    """Projection is gated on there being fixtures left, and must be.

    The 2020-21 Europa League is finished and carries a malformed trailing
    round of 16. Projecting from its shape would print four empty rounds above
    a competition that was decided five years ago.
    """
    trailing = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)]
    slots, to_come = _bracket_slots(_pairs(trailing), project=False)

    assert to_come == 0
    assert slots == {}


def test_a_round_that_is_not_a_power_of_two_is_not_a_bracket():
    # Three semi-finals is a data fault, not a format.
    slots, to_come = _bracket_slots(_pairs([(1, 2), (3, 4), (5, 6)]), project=True)
    assert (slots, to_come) == ({}, 0)


def test_a_tie_whose_feeder_cannot_be_traced_still_gets_a_slot():
    """A hole in the data must not drop a round out of the drawing."""
    qf = [(1, 2), (3, 4), (5, 6), (7, 8)]
    # 99 never appears in the quarter-finals — an untraceable participant.
    sf = [(1, 99), (5, 7)]
    final = [(1, 5)]
    slots, _ = _bracket_slots(_pairs(qf, sf, final))

    assert len([i for i in range(4) if (0, i) in slots]) == 4
    assert sorted(slots[(0, i)] for i in range(4)) == [0, 1, 2, 3]


def test_bracket_publishes_the_slot_and_the_round_width():
    qf = [_tie("quarterfinals", 1, 2, [_leg("m1", "2026-04-01", 1, 2, 1, 0)], 1),
          _tie("quarterfinals", 3, 4, [_leg("m2", "2026-04-02", 3, 4, 1, 0)], 3)]
    sf = [_tie("final", 1, 3, [_leg("m3", "2026-05-01", 1, 3, 2, 0)], 1)]
    out = _bracket([("quarterfinals", qf), ("final", sf)], NAMES)

    assert [r["slots"] for r in out] == [2, 1]
    assert sorted(t["slot"] for t in out[0]["ties"]) == [0, 1]
    assert out[1]["ties"][0]["slot"] == 0
    assert all(r["projected"] is False for r in out)
