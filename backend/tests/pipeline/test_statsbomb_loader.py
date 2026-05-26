"""Unit tests for the StatsBomb loader (HTTP is mocked)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from backend.pipeline.loaders.statsbomb import StatsBombLoader, SBCompetition


class _FakeHttp:
    def __init__(self, payloads: dict[str, object]):
        self._payloads = payloads
        self.calls: list[str] = []

    def get_json(self, url: str):
        self.calls.append(url)
        for key, payload in self._payloads.items():
            if url.endswith(key):
                return payload
        raise FileNotFoundError(url)


def test_competitions_filters_and_marks_gender():
    http = _FakeHttp({
        "competitions.json": [
            {"competition_id": 1, "season_id": 10, "competition_name": "Men's League",
             "competition_gender": "male", "season_name": "2024"},
            {"competition_id": 2, "season_id": 20, "competition_name": "WWC",
             "competition_gender": "female", "season_name": "2023"},
            {"competition_id": 3, "season_id": 30, "competition_name": "Bad row"},  # missing season fields
        ],
    })
    loader = StatsBombLoader(pg_warehouse=None, http_client=http)
    comps = loader.competitions()
    assert len(comps) == 3
    assert {c.gender for c in comps} == {"M", "F"}
    f_comps = [c for c in comps if c.gender == "F"]
    assert f_comps[0].name == "WWC"


def test_canonical_competition_id_falls_back_when_no_resolver():
    loader = StatsBombLoader(pg_warehouse=None)
    comp = SBCompetition(competition_id=37, season_id=42, name="FAWSL", gender="F", season_name="2020/21")
    assert loader._canonical_competition_id(comp) == "sb.37.F"


def test_kickoff_parser_handles_missing_time():
    dt = StatsBombLoader._parse_kickoff("2023-08-15", "15:00:00")
    assert dt.year == 2023
    assert dt.month == 8
    assert dt.day == 15
    assert dt.hour == 15
    assert dt.tzinfo is not None


def test_kickoff_parser_returns_now_when_date_missing():
    dt = StatsBombLoader._parse_kickoff(None, None)
    assert dt.tzinfo is not None
