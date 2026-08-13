"""A competition's matches must not be written into another's history.

On 2026-08-13 football-data.co.uk answered the 2026-27 request for `E0`
(Premier League) with National League fixtures and the request for `SP1`
(La Liga) with the Portuguese Primeira Liga. Both of those leagues had not
kicked off yet; the ones served in their place had.

Twenty-two wrong-competition matches reached the warehouse. Every one of them
was a well-formed match between real clubs with a real score, so nothing that
checks rows found anything wrong. The damage only showed up two steps later,
as a shape: `eng.1` had forty-four entrants, which is 21% of a double round
robin, so `forecast_season` refused to publish a table for it — correctly, and
for a reason that had nothing to do with the Premier League. **The Premier
League and La Liga vanished from the site behind one warning line.**

These tests pin the guard using the real club lists from that incident.
"""
from __future__ import annotations

import sqlite3

import pytest

from backend.services.data.footballdata_loader import _belongs_to_competition

# The 2026-08-08 batch football-data served for `E0`. All English, all real,
# none of them ever in the Premier League.
NATIONAL_LEAGUE = [
    ("Altrincham", "Southend"), ("Boreham Wood", "Tamworth"),
    ("Boston Utd", "Aldershot"), ("Carlisle", "Worthing"),
    ("Eastleigh", "Gateshead"), ("Forest Green", "Halifax"),
    ("Fylde", "Wealdstone"), ("Harrogate", "Solihull"),
    ("Barrow", "Braintree"), ("Rochdale", "Yeovil"),
]

PREMIER_LEAGUE = [
    ("Arsenal", "Chelsea"), ("Liverpool", "Everton"),
    ("Man City", "Man United"), ("Tottenham", "Fulham"),
    ("Newcastle", "Brighton"), ("Aston Villa", "Brentford"),
    # Promoted sides the competition has never seen — a genuine file always
    # carries a few, which is exactly why the threshold is not 100%.
    ("Wrexham", "Oxford"),
]

PRIMEIRA_LIGA = [
    ("Porto", "Alverca"), ("Benfica", "Academico Viseu"),
    ("Sporting CP", "Braga"), ("Estoril", "Famalicao"),
    ("Maritimo", "Casa Pia"), ("Gil Vicente", "Rio Ave"),
]


class _FakeWarehouse:
    """Only `_conn` is touched by the guard."""

    def __init__(self, path, competition_clubs):
        self._conn = sqlite3.connect(path)
        self._conn.executescript("""
            CREATE TABLE teams(team_id INTEGER PRIMARY KEY,
                               canonical_name TEXT);
            CREATE TABLE matches(match_id INTEGER PRIMARY KEY,
                                 competition_id TEXT,
                                 home_team_id INTEGER, away_team_id INTEGER);
        """)
        tid = 0
        for comp, clubs in competition_clubs.items():
            ids = []
            for club in clubs:
                tid += 1
                self._conn.execute("INSERT INTO teams VALUES (?, ?)", (tid, club))
                ids.append(tid)
            for i in range(len(ids) - 1):
                self._conn.execute(
                    "INSERT INTO matches(competition_id, home_team_id, "
                    "away_team_id) VALUES (?, ?, ?)", (comp, ids[i], ids[i + 1]))
        self._conn.commit()


def _rows(pairs):
    return [{"home_team": h, "away_team": a} for h, a in pairs]


@pytest.fixture()
def warehouse(tmp_path):
    return _FakeWarehouse(tmp_path / "wh.sqlite", {
        "eng.1": ["Arsenal", "Chelsea", "Liverpool", "Everton", "Man City",
                  "Man United", "Tottenham", "Fulham", "Newcastle",
                  "Brighton", "Aston Villa", "Brentford"],
        "esp.1": ["Real Madrid", "Barcelona", "Atletico Madrid", "Sevilla",
                  "Valencia", "Villarreal", "Real Sociedad", "Athletic Bilbao",
                  "Betis", "Celta Vigo", "Getafe", "Osasuna"],
    })


def test_the_national_league_is_refused_for_the_premier_league(warehouse):
    ok, why = _belongs_to_competition(warehouse, "eng.1", _rows(NATIONAL_LEAGUE))
    assert not ok
    assert "eng.1" in why
    assert "altrincham" in why or "aldershot" in why


def test_the_primeira_liga_is_refused_for_la_liga(warehouse):
    ok, why = _belongs_to_competition(warehouse, "esp.1", _rows(PRIMEIRA_LIGA))
    assert not ok, "the Portuguese file was accepted as La Liga"


def test_a_genuine_file_is_accepted_despite_promoted_clubs(warehouse):
    """Three or four clubs in twenty are new every August. If that tripped the
    guard it would refuse every real file on the first weekend of a season."""
    ok, why = _belongs_to_competition(warehouse, "eng.1", _rows(PREMIER_LEAGUE))
    assert ok, why


def test_a_competition_with_no_history_is_not_refused(warehouse):
    """Otherwise the first ingest of a new league can never happen."""
    ok, _ = _belongs_to_competition(warehouse, "ita.1", _rows(PREMIER_LEAGUE))
    assert ok


def test_an_empty_file_is_not_treated_as_wrong(warehouse):
    ok, _ = _belongs_to_competition(warehouse, "eng.1", [])
    assert ok


def test_accents_and_club_prefixes_do_not_count_as_strangers(warehouse):
    """`norm_team` is what makes the share meaningful.

    The Portuguese batch reached the warehouse spelled `Academico Viseu` while
    the corpus had `Académico de Viseu`. If the comparison were literal, every
    accent and every dropped `de` would read as a foreign club and a genuine
    file would be refused.
    """
    wh = _FakeWarehouse.__new__(_FakeWarehouse)
    wh._conn = sqlite3.connect(":memory:")
    wh._conn.executescript("""
        CREATE TABLE teams(team_id INTEGER PRIMARY KEY, canonical_name TEXT);
        CREATE TABLE matches(match_id INTEGER PRIMARY KEY, competition_id TEXT,
                             home_team_id INTEGER, away_team_id INTEGER);
    """)
    clubs = ["Académico de Viseu", "FC Porto", "SL Benfica", "Sporting CP",
             "SC Braga", "Estoril Praia", "CS Marítimo", "Casa Pia AC",
             "Gil Vicente FC", "Rio Ave FC", "FC Arouca", "CD Nacional"]
    for i, c in enumerate(clubs, start=1):
        wh._conn.execute("INSERT INTO teams VALUES (?, ?)", (i, c))
        wh._conn.execute("INSERT INTO matches(competition_id, home_team_id, "
                         "away_team_id) VALUES ('por.1', ?, ?)",
                         (i, 1 + (i % len(clubs))))
    wh._conn.commit()

    ok, why = _belongs_to_competition(wh, "por.1", _rows(PRIMEIRA_LIGA))
    assert ok, why
