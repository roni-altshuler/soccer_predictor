"""An absent announcement must not hide malformed data or refresh cached lineups."""
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from backend.services.data.lineup_scraper import LineupScraper
from backend.services.data.provider_status import ProviderUnavailable


@pytest.fixture
def scheduled_summary():
    # Synthetic context for structural variations. This is not a provider
    # capture; no live request is used by these regressions.
    sides = [{"homeAway": "home", "team": {"id": "456"}},
             {"homeAway": "away", "team": {"id": "789"}}]
    return {
        "header": {"id": "123", "competitions": [{
            "id": "123", "date": "2026-12-01T20:00:00Z",
            "status": {"type": {"state": "pre", "name": "STATUS_SCHEDULED", "completed": False}},
            "competitors": deepcopy(sides),
        }]},
        "rosters": sides,
    }


@pytest.fixture
def scraper(tmp_path, monkeypatch):
    service = LineupScraper(data_dir=tmp_path)
    monkeypatch.setattr(service, "_pace", AsyncMock())
    monkeypatch.setattr(service.espn, "get_match_details", AsyncMock())
    monkeypatch.setattr(service.fotmob, "get_match_details", AsyncMock())
    return service


def last_good(service, match_id="123"):
    path = service._cache_path("mls", match_id)
    path.write_bytes(b'{"fetched_at":"2026-01-01T00:00:00Z","source":"espn","home_xi":[{"name":"Known"}]}')
    return path, path.read_bytes(), path.stat().st_mtime_ns


@pytest.mark.asyncio
@pytest.mark.parametrize("announced_side", [None, 0, 1])
async def test_unpublished_scheduled_side_keeps_last_good_cache(scraper, scheduled_summary, announced_side):
    if announced_side is not None:
        scheduled_summary["rosters"][announced_side]["roster"] = [
            {"starter": True, "athlete": {"id": "999", "displayName": "Known player"}},
        ]
    path, before, stamp = last_good(scraper)
    scraper.espn.get_match_details.return_value = scheduled_summary
    assert await scraper.fetch_match_lineup("123", "mls") is None
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp
    assert list(path.parent.iterdir()) == [path]
    scraper.fotmob.get_match_details.assert_not_awaited()


@pytest.mark.asyncio
async def test_absent_announcement_creates_no_empty_cache(scraper, scheduled_summary):
    # Array order and scalar representation do not change the side identities.
    scheduled_summary["rosters"].reverse()
    scheduled_summary["rosters"][0]["team"]["id"] = 789
    scraper.espn.get_match_details.return_value = scheduled_summary
    assert await scraper.fetch_match_lineup("123", "mls") is None
    assert not scraper._cache_path("mls", "123").exists()
    scraper.fotmob.get_match_details.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("side", [0, 1])
@pytest.mark.parametrize("roster", [
    {}, None, "", False,
    [{"starter": True, "athlete": {}}],
    [{"starter": False, "athlete": {}}],
    [{"starter": True, "athlete": {"id": True, "displayName": "Player"}}],
])
async def test_missing_other_side_does_not_hide_bad_roster(scraper, scheduled_summary, side, roster):
    scheduled_summary["rosters"][side]["roster"] = roster
    path, before, stamp = last_good(scraper)
    scraper.espn.get_match_details.return_value = scheduled_summary
    with pytest.raises(ProviderUnavailable):
        await scraper.fetch_match_lineup("123", "mls")
    assert path.read_bytes() == before and path.stat().st_mtime_ns == stamp
    scraper.fotmob.get_match_details.assert_not_awaited()


@pytest.mark.parametrize("path, value", [
    (("header",), None),
    (("header", "id"), True),
    (("header", "competitions"), []),
    (("header", "competitions", 0, "id"), "456"),
    (("header", "competitions", 0, "date"), "2026-12-01T20:00:00"),
    (("header", "competitions", 0, "status"), None),
    (("header", "competitions", 0, "status", "type", "state"), "in"),
    (("header", "competitions", 0, "status", "type", "state"), "post"),
    (("header", "competitions", 0, "status", "type", "name"), "STATUS_POSTPONED"),
    (("header", "competitions", 0, "status", "type", "completed"), True),
    (("header", "competitions", 0, "status", "type", "completed"), 0),
    (("header", "competitions", 0, "competitors"), []),
    (("header", "competitions", 0, "competitors", 1, "homeAway"), "home"),
    (("header", "competitions", 0, "competitors", 1, "team", "id"), "456"),
    (("rosters",), [{"homeAway": "home"}]),
    (("rosters", 0, "homeAway"), {}),
    (("rosters", 0, "team"), None),
    (("rosters", 0, "team", "id"), False),
    (("rosters", 1, "team", "id"), "999"),
])
def test_missing_roster_requires_consistent_scheduled_context(scheduled_summary, path, value):
    node = scheduled_summary
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    with pytest.raises(ProviderUnavailable):
        LineupScraper._parse_espn(scheduled_summary)
