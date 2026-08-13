"""A league may not leave the site quietly.

On 2026-08-13 the Premier League and La Liga stopped being published and
nothing failed. The chain was entirely made of correct steps: football-data
served the wrong file, twenty-two foreign matches entered `eng.1`, the league
came out with forty-four entrants, and the round-robin check refused — quite
rightly — to project a single table for a 44-team competition. It logged one
warning and the run exited 0 with six leagues where there had been nine.

The lesson is not that any of those steps was wrong. It is that "a league we
were publishing yesterday is not in today's output" is a fact the pipeline had
no opinion about, and it needs one.

The comparison is against the artifact on disk rather than against `LEAGUES`,
so a competition that has genuinely ended — absent yesterday and absent today
— does not trip it every summer.
"""
from __future__ import annotations

import json

from backend.scripts.forecast_season import _leagues_lost

NINE = ["eng.1", "esp.1", "fra.1", "ger.1", "ita.1", "ned.1", "por.1",
        "tur.1", "usa.1"]


def _artifact(tmp_path, competition_ids):
    path = tmp_path / "season_projections.json"
    path.write_text(json.dumps({
        "generated_at": "2026-08-12T09:56:00+00:00",
        "leagues": [{"competition_id": c} for c in competition_ids],
    }))
    return path


def test_the_incident_is_caught(tmp_path):
    """Nine published, six about to be — the exact 2026-08-13 shape."""
    path = _artifact(tmp_path, NINE)
    publishing = {"fra.1", "ger.1", "ita.1", "ned.1", "tur.1", "usa.1"}
    lost = _leagues_lost(path, publishing, set(NINE))
    assert lost == {"eng.1", "esp.1", "por.1"}


def test_an_unchanged_run_loses_nothing(tmp_path):
    path = _artifact(tmp_path, NINE)
    assert _leagues_lost(path, set(NINE), set(NINE)) == set()


def test_adding_a_league_is_not_a_loss(tmp_path):
    path = _artifact(tmp_path, NINE)
    grown = set(NINE) | {"sco.1"}
    assert _leagues_lost(path, grown, grown) == set()


def test_a_deliberate_single_league_run_is_not_a_loss(tmp_path):
    """`--competitions eng.1` is a local experiment, not a product that just
    dropped eight leagues. Only what the run was asked for counts."""
    path = _artifact(tmp_path, NINE)
    assert _leagues_lost(path, {"eng.1"}, {"eng.1"}) == set()


def test_a_league_absent_from_both_does_not_trip_it(tmp_path):
    """The between-seasons case: a competition with no fixtures and no table
    was already missing yesterday, so it is not a regression today."""
    path = _artifact(tmp_path, [c for c in NINE if c != "usa.1"])
    publishing = {c for c in NINE if c != "usa.1"}
    assert _leagues_lost(path, publishing, set(NINE)) == set()


def test_a_first_run_with_no_artifact_is_not_blocked(tmp_path):
    assert _leagues_lost(tmp_path / "nope.json", {"eng.1"}, {"eng.1"}) == set()


def test_a_corrupt_artifact_is_not_read_as_a_loss(tmp_path):
    path = tmp_path / "season_projections.json"
    path.write_text("{ truncated")
    assert _leagues_lost(path, {"eng.1"}, {"eng.1"}) == set()


class TestConferenceNameResolution:
    """One provider, two vocabularies.

    `conferences.json` is built from ESPN's STANDINGS ("Inter Miami CF") while
    the warehouse holds the name ESPN's SCOREBOARD uses for the same club
    ("Inter"). Those normalise to `inter miami` and `inter`, so exact matching
    placed 29 of 30 MLS clubs and refused the whole table over the 30th.
    """

    def _groups(self, tmp_path, monkeypatch, conference_teams, entrants):
        import json as _json
        from backend.scripts import forecast_season as fs

        path = tmp_path / "conferences.json"
        path.write_text(_json.dumps({"competitions": {"usa.1": {
            "season": 2026,
            "groups": [{"name": "Eastern Conference", "qualify": 9,
                        "teams": conference_teams}],
        }}}))
        monkeypatch.setattr(fs, "CONFERENCES", path)
        return fs.load_groups("usa.1", 2026, [f"usa.1::{e}" for e in entrants])

    def test_a_short_spelling_resolves_when_it_can_mean_one_club(
            self, tmp_path, monkeypatch):
        got = self._groups(tmp_path, monkeypatch,
                           ["Inter Miami CF", "Atlanta United FC"],
                           ["inter", "atlanta united"])
        assert got == {"usa.1::inter": "Eastern Conference",
                       "usa.1::atlanta united": "Eastern Conference"}

    def test_an_ambiguous_short_spelling_is_refused(self, tmp_path, monkeypatch):
        """Two candidates means guessing, and `inter` is Internazionale
        everywhere else we serve. No table beats the wrong table."""
        got = self._groups(tmp_path, monkeypatch,
                           ["Inter Miami CF", "Inter Miami CF II"],
                           ["inter", "atlanta united"])
        assert got is None

    def test_an_exact_match_still_wins(self, tmp_path, monkeypatch):
        got = self._groups(tmp_path, monkeypatch,
                           ["Atlanta United FC"], ["atlanta united"])
        assert got == {"usa.1::atlanta united": "Eastern Conference"}

    def test_a_club_the_map_does_not_know_still_refuses(
            self, tmp_path, monkeypatch):
        got = self._groups(tmp_path, monkeypatch,
                           ["Atlanta United FC"], ["atlanta united", "wrexham"])
        assert got is None
