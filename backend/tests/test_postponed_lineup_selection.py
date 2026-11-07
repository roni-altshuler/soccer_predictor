"""Postponed fixtures are not upcoming lineup requests or empty observations."""

import json
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from backend.services.data import lineup_scraper as lineup
from backend.services.data.espn_event_status import is_explicitly_postponed
from backend.services.data.provider_status import ProviderUnavailable

FIXTURE = (
    Path(__file__).parent / "fixtures/espn/20261107_postponed_scoreboards_excerpt.json"
)
# Synthetic observer clock reproducing the original selection window. The
# fixture README records the actual, later response-retention times separately.
NOW = datetime(2026, 11, 7, 19, 50, tzinfo=timezone.utc)


class FixedClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz is not None else NOW.replace(tzinfo=None)


@pytest.fixture
def captured():
    return json.loads(FIXTURE.read_text())


@pytest.fixture
def service(tmp_path, monkeypatch):
    scraper = lineup.LineupScraper(data_dir=tmp_path)
    monkeypatch.setattr(lineup, "datetime", FixedClock)
    monkeypatch.setattr(scraper, "_pace", AsyncMock())
    monkeypatch.setattr(scraper.espn, "get_scoreboard", AsyncMock())
    monkeypatch.setattr(scraper.espn, "get_match_details", AsyncMock())
    monkeypatch.setattr(scraper.fotmob, "get_match_details", AsyncMock())
    return scraper


def future_scheduled(captured):
    """Synthetic scheduled control, not an additional provider capture."""
    event = deepcopy(captured["scoreboards"]["20261107"]["events"][0])
    event["id"] = event["competitions"][0]["id"] = "999"
    event["date"] = event["competitions"][0]["date"] = (
        NOW + timedelta(hours=1)
    ).isoformat()
    for node in [event, event["competitions"][0]]:
        node["status"] = {
            "type": {"name": "STATUS_SCHEDULED", "state": "pre", "completed": False}
        }
    return event


def save_cache(service, match_id, *, fresh):
    path = service._cache_path("laliga_2", match_id)
    stamp = NOW.isoformat() if fresh else "2026-01-01T00:00:00Z"
    path.write_text(
        json.dumps(
            {
                "match_id": match_id,
                "league": "laliga_2",
                "source": "espn",
                "fetched_at": stamp,
                "kickoff": "2026-11-08T13:00:00Z",
                "home_xi": [{"player_id": "111", "name": "Synthetic retained player"}],
            }
        )
    )
    return path, path.read_bytes(), path.stat().st_mtime_ns


@pytest.mark.asyncio
@pytest.mark.parametrize("cache_state", ["absent", "stale", "fresh"])
async def test_real_postponed_events_are_excluded_without_fetch_or_cache_refresh(
    service, captured, caplog, cache_state
):
    before = []
    if cache_state != "absent":
        before = [
            save_cache(service, mid, fresh=cache_state == "fresh")
            for mid in captured["summaries"]
        ]

    async def captured_summary(league, match_id):
        return captured["summaries"][match_id]

    service.espn.get_match_details.side_effect = captured_summary
    service.espn.get_scoreboard.side_effect = list(captured["scoreboards"].values())
    caplog.set_level("INFO", logger=lineup.__name__)
    assert await service.fetch_upcoming_lineups("laliga_2", days_ahead=1) == []
    service.espn.get_match_details.assert_not_awaited()
    service.fotmob.get_match_details.assert_not_awaited()
    assert service.espn.get_scoreboard.await_args_list[0].args == (
        "laliga_2",
        "20261107",
    )
    assert service.espn.get_scoreboard.await_args_list[1].args == (
        "laliga_2",
        "20261108",
    )
    for mid in captured["summaries"]:
        assert f"Skipping postponed ESPN event laliga_2/{mid}" in caplog.text
    for path, content, mtime in before:
        assert path.read_bytes() == content and path.stat().st_mtime_ns == mtime
    assert set(service.data_dir.rglob("*.json")) == {p for p, _, _ in before}


@pytest.mark.parametrize("mid", ["401883142", "401883122"])
def test_postponed_summary_is_still_unavailable_to_the_roster_parser(captured, mid):
    # The repair belongs in selection, not in a relaxed missing-roster rule.
    with pytest.raises(ProviderUnavailable, match="outside a valid scheduled event"):
        lineup.LineupScraper._parse_espn(captured["summaries"][mid])


@pytest.mark.parametrize(
    "path,value",
    [
        (("id",), True),
        (("id",), "invalid"),
        (("competitions",), []),
        (("competitions", 0, "id"), "different"),
        (("status",), None),
        (("status", "type", "name"), "STATUS_SCHEDULED"),
        (("status", "type", "state"), "pre"),
        (("status", "type", "completed"), 0),
        (("competitions", 0, "status", "type", "name"), "STATUS_SCHEDULED"),
        (("competitions", 0, "status", "type", "completed"), True),
        (("competitions", 0, "competitors"), []),
        (("competitions", 0, "competitors", 0, "homeAway"), {}),
        (("competitions", 0, "competitors", 1, "homeAway"), "home"),
        (("competitions", 0, "competitors", 1, "team", "id"), "3747"),
        (("competitions", 0, "competitors", 0, "team", "id"), False),
    ],
)
def test_unknown_or_inconsistent_context_is_not_excluded(captured, path, value):
    event = captured["scoreboards"]["20261107"]["events"][0]
    node = event
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    assert is_explicitly_postponed(event) is False


@pytest.mark.asyncio
async def test_conflicting_scoreboard_still_fetches_and_fails_visibly(
    service, captured
):
    event = deepcopy(captured["scoreboards"]["20261107"]["events"][0])
    event["competitions"][0]["status"]["type"]["name"] = "STATUS_SCHEDULED"
    service.espn.get_scoreboard.side_effect = [{"events": [event]}, {"events": []}]
    service.espn.get_match_details.return_value = captured["summaries"][event["id"]]
    saved = save_cache(service, event["id"], fresh=False)
    with pytest.raises(ProviderUnavailable, match="failed to fetch 1 lineup"):
        await service.fetch_upcoming_lineups("laliga_2", days_ahead=1)
    service.espn.get_match_details.assert_awaited_once_with("laliga_2", event["id"])
    assert saved[0].read_bytes() == saved[1] and saved[0].stat().st_mtime_ns == saved[2]
    service.fotmob.get_match_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_scheduled_requests_continue_and_genuine_failure_still_blocks(
    service, captured
):
    postponed = captured["scoreboards"]["20261107"]["events"][0]
    scheduled = future_scheduled(captured)
    service.espn.get_scoreboard.side_effect = [
        {"events": [postponed, scheduled]},
        {"events": []},
    ]
    service.espn.get_match_details.return_value = None
    with pytest.raises(ProviderUnavailable, match="failed to fetch 1 lineup"):
        await service.fetch_upcoming_lineups("laliga_2", days_ahead=1)
    service.espn.get_match_details.assert_awaited_once_with("laliga_2", "999")
    service.fotmob.get_match_details.assert_not_awaited()
    assert list(service.data_dir.rglob("*.json")) == []


@pytest.mark.asyncio
async def test_scheduled_unpublished_lineup_keeps_its_existing_behavior(
    service, captured
):
    scheduled = future_scheduled(captured)
    service.espn.get_scoreboard.side_effect = [{"events": [scheduled]}, {"events": []}]
    summary = deepcopy(captured["summaries"]["401883142"])
    summary["header"]["id"] = "999"
    summary["header"]["competitions"] = scheduled["competitions"]
    service.espn.get_match_details.return_value = summary
    saved = save_cache(service, "999", fresh=False)
    assert await service.fetch_upcoming_lineups("laliga_2", days_ahead=1) == []
    service.espn.get_match_details.assert_awaited_once_with("laliga_2", "999")
    assert saved[0].read_bytes() == saved[1] and saved[0].stat().st_mtime_ns == saved[2]
    service.fotmob.get_match_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_announced_scheduled_lineup_still_publishes_with_provider_identity(
    service, captured
):
    postponed = captured["scoreboards"]["20261107"]["events"][0]
    scheduled = future_scheduled(captured)
    service.espn.get_scoreboard.side_effect = [
        {"events": [postponed, scheduled]},
        {"events": []},
    ]
    summary = deepcopy(captured["summaries"]["401883142"])
    summary["header"]["id"] = "999"
    summary["header"]["competitions"] = scheduled["competitions"]
    for i, side in enumerate(summary["rosters"]):
        side["roster"] = [
            {
                "starter": True,
                "athlete": {
                    "id": str(100 + i),
                    "displayName": f"Synthetic starter {i}",
                },
            }
        ]
    service.espn.get_match_details.return_value = summary
    result = await service.fetch_upcoming_lineups("laliga_2", days_ahead=1)
    assert len(result) == 1
    assert (result[0]["match_id"], result[0]["league"], result[0]["source"]) == (
        "999",
        "laliga_2",
        "espn",
    )
    assert result[0]["fetched_at"] == NOW.isoformat()
    assert result[0]["kickoff"] == scheduled["date"]
    assert result[0]["home_team_id"] == summary["rosters"][0]["team"]["id"]
    assert result[0]["away_team_id"] == summary["rosters"][1]["team"]["id"]
    assert json.loads(service._cache_path("laliga_2", "999").read_text()) == result[0]
    assert not service._cache_path("laliga_2", postponed["id"]).exists()
    service.espn.get_match_details.assert_awaited_once_with("laliga_2", "999")
    service.fotmob.get_match_details.assert_not_awaited()
