"""Club identity on the opening weekend, when there are no votes yet.

The canonical layer resolves FBref's vocabulary onto the warehouse's through
the fixture graph: align the two sources on date and scoreline, collect a name
pair per aligned match, and accept a mapping only when it wins by a margin
over a whole season of evidence. That rule is right and it stays — but it
needs five aligned fixtures, and on matchday one every club has one.

What broke without a cold-start path: the first Ligue 2 results reached the
warehouse spelled `Dijon FCO` while the schedule said `Dijon`, so the same
match entered the corpus twice and the league appeared to have 25 clubs. The
structural check that decides whether a table can be projected refused one,
and three leagues silently lost their table on the site.

The evidence used instead of a vote count is whether an alignment could be
anything else. These tests pin both readings of that, and — as importantly —
pin the case where the honest answer is to refuse.
"""
from __future__ import annotations

import pytest

duckdb = pytest.importorskip("duckdb")


def _alias_tables(con):
    """The two rules under test, verbatim from `build_canonical`.

    Imported by execution rather than by copy: the SQL is read out of the
    module source so a change there cannot leave this test asserting the
    behaviour of code that no longer runs.
    """
    import re
    from pathlib import Path

    src = (Path(__file__).resolve().parent.parent / "scripts"
           / "build_canonical.py").read_text()
    wanted = ("alias_alignments", "alias_identified", "alias_by_alignment")
    found = {}
    for stmt in re.findall(r'con\.execute\("""(.*?)"""\)', src, re.S):
        for name in wanted:
            if f"CREATE OR REPLACE TABLE {name} AS" in stmt:
                found[name] = stmt
    assert set(found) == set(wanted), f"missing SQL for {set(wanted) - set(found)}"
    for name in wanted:  # order matters; each builds on the last
        con.execute(found[name])


def _fixtures(con, warehouse, fbref):
    con.execute("""CREATE TABLE wh_matches(source_id VARCHAR,
                   competition_id VARCHAR, season INTEGER, local_date DATE,
                   home_norm VARCHAR, away_norm VARCHAR,
                   home_score INTEGER, away_score INTEGER)""")
    con.execute("""CREATE TABLE fb_matches(source_id VARCHAR,
                   competition_id VARCHAR, season INTEGER, local_date DATE,
                   home_norm VARCHAR, away_norm VARCHAR,
                   home_score INTEGER, away_score INTEGER)""")
    for i, (h, a, hs, as_) in enumerate(warehouse):
        con.execute("INSERT INTO wh_matches VALUES (?, 'fra.2', 2026, "
                    "DATE '2026-08-08', ?, ?, ?, ?)", [f"w{i}", h, a, hs, as_])
    for i, (h, a, hs, as_) in enumerate(fbref):
        con.execute("INSERT INTO fb_matches VALUES (?, 'fra.2', 2026, "
                    "DATE '2026-08-08', ?, ?, ?, ?)", [f"f{i}", h, a, hs, as_])
    _alias_tables(con)
    return {(r[0], r[1]) for r in con.execute(
        "SELECT fb, wh FROM alias_by_alignment WHERE fb <> wh").fetchall()}


@pytest.fixture()
def con():
    c = duckdb.connect(":memory:")
    yield c
    c.close()


def test_a_scoreline_nothing_else_shares_identifies_both_clubs(con):
    """`USL Dunkerque 4-2 Grenoble Foot` against `Dunkerque 4-2 Grenoble`:
    no other match that day was 4-2, so there is nothing else it could be."""
    pairs = _fixtures(
        con,
        warehouse=[("dunkerque", "grenoble", 4, 2), ("metz", "guingamp", 2, 1)],
        fbref=[("usl dunkerque", "grenoble foot", 4, 2), ("metz", "guingamp", 2, 1)],
    )
    assert ("usl dunkerque", "dunkerque") in pairs
    assert ("grenoble foot", "grenoble") in pairs


def test_one_side_already_agreeing_identifies_the_other(con):
    """Two 0-0s that day, so the scoreline alone is not enough — but only one
    of them is `Clermont Foot` at home."""
    pairs = _fixtures(
        con,
        warehouse=[("clermont foot", "stade reims", 0, 0),
                   ("boulogne", "nancy lorraine", 0, 0)],
        fbref=[("clermont foot", "reims", 0, 0),
               ("us boulogne", "nancy", 0, 0)],
    )
    assert ("reims", "stade reims") in pairs


def test_a_match_with_neither_side_agreeing_is_left_alone(con):
    """The other 0-0 in that same fixture list. Two candidates, no club in
    common with either: nothing distinguishes them, so nothing is claimed.
    It resolves by itself once a club has played enough to be voted in."""
    pairs = _fixtures(
        con,
        warehouse=[("clermont foot", "stade reims", 0, 0),
                   ("boulogne", "nancy lorraine", 0, 0)],
        fbref=[("clermont foot", "reims", 0, 0),
               ("us boulogne", "nancy", 0, 0)],
    )
    assert ("us boulogne", "boulogne") not in pairs
    assert ("nancy", "nancy lorraine") not in pairs


def test_a_name_that_would_mean_two_clubs_is_refused(con):
    """A contradiction is not evidence, and the larger side does not win it."""
    pairs = _fixtures(
        con,
        warehouse=[("alpha", "beta", 3, 1), ("gamma", "delta", 5, 0)],
        fbref=[("alpha fc", "beta", 3, 1), ("alpha fc", "delta", 5, 0)],
    )
    assert not any(fb == "alpha fc" for fb, _ in pairs)


def test_an_ambiguous_scoreline_alone_identifies_nothing(con):
    """Same scoreline twice, no side in common: refuse both rather than pick."""
    pairs = _fixtures(
        con,
        warehouse=[("alpha", "beta", 1, 0), ("gamma", "delta", 1, 0)],
        fbref=[("alpha fc", "beta fc", 1, 0), ("gamma fc", "delta fc", 1, 0)],
    )
    assert not pairs


def test_votes_outrank_an_alignment_for_the_same_name():
    """A club with a season of evidence behind it is not overruled by one
    unambiguous night. Pinned on the real builder's final union."""
    import re
    from pathlib import Path

    src = (Path(__file__).resolve().parent.parent / "scripts"
           / "build_canonical.py").read_text()
    union = re.search(r"CREATE OR REPLACE TABLE team_aliases AS(.*?)\"\"\"",
                      src, re.S).group(1)
    assert "NOT EXISTS" in union and "alias_by_votes v" in union, (
        "alignment-derived aliases must yield to vote-derived ones")
