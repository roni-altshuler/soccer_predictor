"""Existing single standings request: proof metadata and atomic retention."""

import json
from copy import deepcopy
from datetime import datetime
from unittest.mock import Mock

import httpx
import pytest

from backend.scripts import build_conferences as bc
from backend.services.forecast.completed_season import ENDPOINT
from backend.tests.test_completed_mls import OBSERVED, make_evidence


def raw_response():
    groups = make_evidence()["raw"]
    return {
        "abbreviation": "MLS",
        "season": {"year": 2026},
        "children": [
            {
                "name": g["name"],
                "standings": {"season": 2026, "seasonType": 1, "entries": g["entries"]},
            }
            for g in groups
        ],
    }


def test_observation_is_stamped_after_the_existing_response_without_extra_requests(
    monkeypatch,
):
    parsed = []
    response = Mock()
    response.json.side_effect = lambda: (parsed.append(True) or raw_response())
    request = Mock(return_value=response)
    monkeypatch.setattr(bc.httpx, "get", request)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            assert parsed, "Provider availability must precede its observation stamp"
            return datetime.fromisoformat(OBSERVED)

    monkeypatch.setattr(bc, "datetime", Clock)
    groups = bc.fetch("usa.1", 2026)
    request.assert_called_once_with(
        "https://site.web.api.espn.com/apis/v2/sports/soccer/usa.1/standings",
        params={"season": 2026},
        timeout=30,
        headers={"User-Agent": "Pitchverse/1.0"},
    )
    assert all(
        g["source_url"] == ENDPOINT and g["observed_at"] == OBSERVED for g in groups
    )
    monkeypatch.setattr(bc, "fetch", lambda *args: groups)
    built = bc.build("usa.1", 2026)
    assert built["regular_season_standings"]["observed_at"] == OBSERVED
    assert len(built["regular_season_standings"]["rows"]) == 30
    assert [g["qualify"] for g in built["groups"]] == [9, 9]


@pytest.mark.parametrize(
    "case", ["wrong_root_season", "wrong_league", "wrong_phase", "missing_stats"]
)
def test_unvalidated_response_does_not_create_a_completion_observation(
    monkeypatch, case
):
    payload = raw_response()
    if case == "wrong_root_season":
        payload["season"]["year"] = 2025
    elif case == "wrong_league":
        payload["abbreviation"] = "OTHER"
    elif case == "wrong_phase":
        payload["children"][0]["standings"]["seasonType"] = 3
    else:
        payload["children"][0]["standings"]["entries"][0].pop("stats")
    response = httpx.Response(200, json=payload, request=httpx.Request("GET", ENDPOINT))
    monkeypatch.setattr(bc.httpx, "get", lambda *a, **k: response)
    built = bc.build("usa.1", 2026)
    assert "regular_season_standings" not in built
    assert built["teams"] == 30


def test_failing_provider_preserves_last_good_conference_bytes_and_timestamp(
    tmp_path, monkeypatch
):
    path = tmp_path / "conferences.json"
    previous = {"generated_at": OBSERVED, "competitions": {"usa.1": {"retained": True}}}
    path.write_text(json.dumps(previous))
    saved = path.read_bytes(), path.stat().st_mtime_ns
    response = httpx.Response(503, request=httpx.Request("GET", ENDPOINT))
    monkeypatch.setattr(bc.httpx, "get", lambda *a, **k: response)
    with pytest.raises(httpx.HTTPStatusError):
        bc.main(["--competition", "usa.1", "--season", "2026", "--output", str(path)])
    assert (path.read_bytes(), path.stat().st_mtime_ns) == saved


def test_missing_new_observation_never_relabels_old_standings_as_fresh(
    tmp_path, monkeypatch
):
    evidence = make_evidence()
    path = tmp_path / "conferences.json"
    path.write_text(
        json.dumps(
            {
                "competitions": {
                    "usa.1": {
                        "regular_season_standings": deepcopy(evidence["standings"])
                    }
                }
            }
        )
    )
    groups = evidence["raw"]
    groups[0]["entries"][0].pop("stats")
    monkeypatch.setattr(bc, "fetch", lambda *a: groups)
    assert (
        bc.main(["--competition", "usa.1", "--season", "2026", "--output", str(path)])
        == 0
    )
    assert (
        "regular_season_standings"
        not in json.loads(path.read_text())["competitions"]["usa.1"]
    )
