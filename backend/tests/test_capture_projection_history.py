"""The projection history: what it records, and what it refuses to invent.

`season_projections.json` is regenerated in place, so the previous value is
gone the moment the next run finishes. This capture is the only thing that
makes "what changed after Saturday" answerable — and the only thing that stops
that question being answered with a number nobody ever published.

The tests that matter are the ones about `played`. Two snapshots taken without
a match in between differ because the MODEL changed, and telling that as a
story about a team would be inventing football that did not happen.
"""
import json

import pytest

from backend.scripts import capture_projection_history as cph

STAMP = "2026-08-15T07:57:18.351161+00:00"


def payload(generated_at=STAMP, **over):
    base = {
        "generated_at": generated_at,
        "leagues": [
            {
                "competition_id": "eng.1",
                "season": 2026,
                "table": [
                    {
                        "team": "Arsenal",
                        "p_title": 0.34,
                        "p_top_cut": 0.81,
                        "p_relegated": 0.0,
                        "exp_points": 78.4,
                        "exp_position": 2.1,
                        "played": 3,
                        "points": 7,
                    },
                    {
                        "team": "Fulham",
                        "p_title": 0.01,
                        "p_top_cut": 0.09,
                        "p_relegated": 0.12,
                        "exp_points": 48.0,
                        "exp_position": 11.4,
                        "played": 3,
                        "points": 4,
                    },
                ],
            }
        ],
    }
    base.update(over)
    return base


class TestRows:
    def test_one_row_per_team_stamped_with_the_run(self):
        rows = cph.rows_for(payload())
        assert [r["team"] for r in rows] == ["Arsenal", "Fulham"]
        assert all(r["generated_at"] == STAMP for r in rows)
        assert all(r["competition_id"] == "eng.1" for r in rows)

    def test_it_keeps_the_figures_a_reader_follows(self):
        row = cph.rows_for(payload())[0]
        for key in cph.FIGURES:
            assert key in row
        assert row["p_title"] == pytest.approx(0.34)
        assert row["exp_position"] == pytest.approx(2.1)

    def test_it_keeps_played_so_a_delta_can_tell_football_from_a_retrain(self):
        # THE reason this column is here. Without it, a projection that moved
        # because the model was retrained is indistinguishable from one that
        # moved because a team won, and the second story is the tempting one.
        row = cph.rows_for(payload())[0]
        assert row["played"] == 3
        assert row["points"] == 7

    def test_a_run_with_no_timestamp_records_nothing(self):
        # Every row is keyed on the run that produced it. Without a stamp there
        # is no run to attribute it to, and an unattributed figure cannot be
        # ordered against another.
        assert cph.rows_for(payload(generated_at=None)) == []

    def test_it_skips_a_league_or_team_it_cannot_name(self):
        blob = payload()
        blob["leagues"].append({"season": 2026, "table": [{"team": "Nameless"}]})
        blob["leagues"][0]["table"].append({"p_title": 0.5})
        rows = cph.rows_for(blob)
        assert [r["team"] for r in rows] == ["Arsenal", "Fulham"]

    def test_it_survives_a_projection_with_no_tables(self):
        assert cph.rows_for({"generated_at": STAMP, "leagues": []}) == []
        assert cph.rows_for({}) == []


class TestAppendOnly:
    def test_a_second_run_of_the_same_forecast_captures_nothing(self, tmp_path):
        path = tmp_path / "h.jsonl"
        rows = cph.rows_for(payload())
        assert cph.append(cph.new_rows(rows, cph.already_captured(path)), path) == 2
        assert cph.append(cph.new_rows(rows, cph.already_captured(path)), path) == 0
        assert len(path.read_text(encoding="utf8").strip().splitlines()) == 2

    def test_the_next_forecast_is_a_new_row_not_a_replacement(self):
        # The whole point: the old value has to survive so the two can be
        # compared. Overwriting would leave the same single snapshot it started
        # with.
        first = cph.rows_for(payload())
        second = cph.rows_for(payload(generated_at="2026-08-16T07:00:00+00:00"))
        seen = set()
        assert len(cph.new_rows(first, seen)) == 2
        assert len(cph.new_rows(second, seen)) == 2

    def test_a_half_written_line_does_not_lose_the_rest(self, tmp_path):
        path = tmp_path / "h.jsonl"
        path.write_text(
            json.dumps({"generated_at": STAMP, "competition_id": "eng.1", "team": "Arsenal"})
            + "\n{ broken\n"
            + json.dumps({"generated_at": STAMP, "competition_id": "eng.1", "team": "Fulham"})
            + "\n",
            encoding="utf8",
        )
        seen = cph.already_captured(path)
        assert (STAMP, "eng.1", "Arsenal") in seen
        assert (STAMP, "eng.1", "Fulham") in seen

    def test_two_clubs_of_the_same_name_in_different_leagues_are_distinct(self, tmp_path):
        path = tmp_path / "h.jsonl"
        rows = [
            {"generated_at": STAMP, "competition_id": "eng.1", "team": "Arsenal"},
            {"generated_at": STAMP, "competition_id": "usa.1", "team": "Arsenal"},
        ]
        assert cph.append(cph.new_rows(rows, cph.already_captured(path)), path) == 2
