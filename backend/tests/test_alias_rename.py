"""A club that got renamed, and the two clubs that merely share a town.

An unaliased rename does not split a club's record — it DOUBLES it. When the
warehouse says `Belenenses` and FBref says `B-SAD` for the same league entry,
the two rows for one match no longer resolve to the same pair of teams, so
both are written. por.1 carried 4 x 34 = 136 fixtures twice until the rename
rule landed, and the New York Red Bulls entered MLS as two half-strength clubs
in a 31-team table.

The signature the rule keys on is contiguity: the club stops being called one
thing and starts being called the other, with no gap and no overlap. That is
narrow on purpose. Non-overlap ALONE merged Gazelec Ajaccio into AC Ajaccio —
two different clubs from one Corsican town that happen never to have shared a
Ligue 1 season — and a wrong merge is worse than a missing one, because the
corpus then contains a club that never existed and nothing reads as broken.

These tests pin both directions: every genuine rename in the corpus is
accepted, and the Ajaccio shape is refused.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

duckdb = pytest.importorskip("duckdb")

COMP = "fra.1"


def _rename_tables(con):
    """The two rules under test, verbatim from `build_canonical`.

    Read out of the module source rather than copied, so a change to the SQL
    cannot leave this file asserting the behaviour of code that no longer
    runs — the same contract `test_alias_alignment` uses.
    """
    src = (Path(__file__).resolve().parent.parent / "scripts"
           / "build_canonical.py").read_text()
    wanted = ("alias_seasons", "alias_by_rename")
    found = {}
    for stmt in re.findall(r'con\.execute\("""(.*?)"""\)', src, re.S):
        for name in wanted:
            if f"CREATE OR REPLACE TABLE {name} AS" in stmt:
                found[name] = stmt
    assert set(found) == set(wanted), f"missing SQL for {set(wanted) - set(found)}"
    for name in wanted:  # alias_by_rename reads alias_seasons
        con.execute(found[name])


@pytest.fixture()
def con():
    c = duckdb.connect(":memory:")
    yield c
    c.close()


def _renames(con, votes, seasons):
    """Run the rule over hand-built evidence and return the merges it makes.

    `votes`   : (fb_spelling, wh_club, vote_count)
    `seasons` : {fb_spelling: [season, ...]} — which years that spelling played
    """
    con.execute("CREATE TABLE alias_votes(competition_id VARCHAR, wh VARCHAR, "
                "fb VARCHAR, votes BIGINT)")
    for fb, wh, n in votes:
        con.execute("INSERT INTO alias_votes VALUES (?, ?, ?, ?)",
                    [COMP, wh, fb, n])

    # alias_seasons is derived from the FBref fixture list, so the seasons a
    # spelling played have to arrive as fixtures rather than as a table.
    con.execute("CREATE TABLE fb_matches(competition_id VARCHAR, "
                "season INTEGER, home_norm VARCHAR, away_norm VARCHAR)")
    for fb, years in seasons.items():
        for year in years:
            con.execute("INSERT INTO fb_matches VALUES (?, ?, ?, 'opponent')",
                        [COMP, year, fb])

    _rename_tables(con)
    return {(r[0], r[1]) for r in con.execute(
        "SELECT fb, wh FROM alias_by_rename").fetchall()}


def test_a_contiguous_rename_is_accepted(con):
    """The New York Red Bulls: `NY Red Bulls` to 2023, `RB New York` from 2024.

    The older spelling wins the mutual best on votes, so the CURRENT name is
    refused by the vote rule and the same club enters the corpus twice.
    """
    merges = _renames(
        con,
        votes=[("ny red bulls", "red bull new york", 106),
               ("rb new york", "red bull new york", 18)],
        seasons={"ny red bulls": [2020, 2021, 2022, 2023],
                 "rb new york": [2024, 2025]},
    )
    assert ("rb new york", "red bull new york") in merges


def test_a_rename_is_accepted_in_either_direction(con):
    """Contiguity is symmetric: the winner may be the EARLIER spelling or the
    later one, depending only on which accumulated more votes."""
    merges = _renames(
        con,
        votes=[("belenenses", "belenenses", 300), ("b sad", "belenenses", 136)],
        seasons={"belenenses": [2014, 2015, 2016, 2017],
                 "b sad": [2018, 2019, 2020, 2021]},
    )
    assert ("b sad", "belenenses") in merges


def test_two_clubs_from_one_town_are_refused(con):
    """Gazelec Ajaccio played Ligue 1 in 2015, AC Ajaccio in 2011-13 and 2022.

    They never share a season, so a non-overlap rule merges them. 2015 neither
    follows 2013 nor precedes 2022, so adjacency does not.
    """
    merges = _renames(
        con,
        votes=[("ajaccio", "ajaccio", 90), ("gazelec ajaccio", "ajaccio", 30)],
        seasons={"ajaccio": [2011, 2012, 2013, 2022],
                 "gazelec ajaccio": [2015]},
    )
    assert merges == set(), f"merged two different clubs: {merges}"


def test_spellings_that_share_a_season_are_refused(con):
    """Both names playing in the same year is the one thing a rename is not."""
    merges = _renames(
        con,
        votes=[("first name", "club", 90), ("second name", "club", 30)],
        seasons={"first name": [2020, 2021, 2022],
                 "second name": [2022, 2023]},
    )
    assert merges == set()


def test_a_spelling_with_too_little_evidence_is_refused(con):
    """Below the floor of five the pair is as likely to be an alignment fluke
    as a rename, and a wrong merge is permanent."""
    merges = _renames(
        con,
        votes=[("first name", "club", 90), ("second name", "club", 4)],
        seasons={"first name": [2020, 2021], "second name": [2022]},
    )
    assert merges == set()


def test_a_spelling_that_two_clubs_claim_is_refused(con):
    """Dominance, not just adjacency: if the runner-up spelling maps almost as
    well onto a DIFFERENT warehouse club, it is ambiguous rather than renamed."""
    merges = _renames(
        con,
        votes=[("first name", "club", 90),
               ("second name", "club", 20),
               ("second name", "other club", 18)],
        seasons={"first name": [2020, 2021], "second name": [2022],
                 "other club": [2020, 2021, 2022]},
    )
    assert merges == set()
