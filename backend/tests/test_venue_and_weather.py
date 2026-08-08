"""Venue coordinates and the weather join that depends on them.

`teams.venue_lat/venue_lon` being NULL for all 692 teams was a silent
two-feature outage: `away_travel_km` was a hardcoded 0.0, and the weather
loader — which selects work by joining `teams` on those columns — matched
nothing, so five weather features sat on their defaults for the whole
corpus. These tests pin both the committed table and the join.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from backend.services.data.venue_loader import (
    VENUES_FILE,
    _plausible,
    haversine_km,
    load_venues,
    venue_coverage,
)
from backend.services.data.warehouse import MatchRow, Warehouse
from backend.services.data.weather_loader import _index_hourly, load_weather

WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")

# Independently known coordinates, used to catch a geocoder that silently
# returns a city centre or the wrong country.
KNOWN_GROUNDS = {
    "Manchester United": (53.4631, -2.2913),
    "Barcelona": (41.3809, 2.1228),
    "Bayern Munich": (48.2188, 11.6247),
    "Inter": (45.4781, 9.1240),
    "Paris Saint-Germain": (48.8414, 2.2530),
    "Arsenal": (51.5549, -0.1084),
    "Real Madrid": (40.4531, -3.6883),
}


@pytest.fixture(scope="module")
def venues():
    data = yaml.safe_load(VENUES_FILE.read_text())
    return data["venues"]


class TestVenueTable:
    def test_table_exists_and_covers_wave_a(self, venues):
        assert len(venues) >= 160
        leagues = {v["league"] for v in venues}
        assert leagues == set(WAVE_A)

    def test_every_entry_has_the_required_keys(self, venues):
        for v in venues:
            assert v.get("team"), v
            assert "lat" in v and "lon" in v, v
            assert "source" in v, v

    def test_coordinates_are_in_range(self, venues):
        for v in venues:
            if v["lat"] is None:
                continue
            assert -90 <= v["lat"] <= 90, v
            assert -180 <= v["lon"] <= 180, v

    def test_no_entry_sits_on_null_island(self, venues):
        """(0, 0) is what a failed geocode looks like, never a stadium."""
        for v in venues:
            if v["lat"] is None:
                continue
            assert not (abs(v["lat"]) < 0.01 and abs(v["lon"]) < 0.01), v

    @pytest.mark.parametrize("team,expected", sorted(KNOWN_GROUNDS.items()))
    def test_known_grounds_are_where_they_actually_are(self, venues, team, expected):
        entry = next((v for v in venues if v["team"] == team), None)
        assert entry is not None, f"{team} missing from venues.yml"
        distance = haversine_km(entry["lat"], entry["lon"], *expected)
        assert distance < 2.0, f"{team} is {distance:.1f} km from its real ground"

    def test_teams_are_unique_within_a_league(self, venues):
        seen = set()
        for v in venues:
            key = (v["team"], v["league"])
            assert key not in seen, f"duplicate entry for {key}"
            seen.add(key)

    def test_only_ground_shares_share_coordinates(self, venues):
        """Two clubs on identical coordinates must be a real ground-share."""
        allowed = {
            frozenset(("Inter", "AC Milan")),
            frozenset(("Roma", "Lazio")),
            frozenset(("Genoa", "Sampdoria")),
            frozenset(("Hellas Verona", "Chievo Verona")),
        }
        by_coord = {}
        for v in venues:
            if v["lat"] is None:
                continue
            by_coord.setdefault((round(v["lat"], 4), round(v["lon"], 4)), []).append(v["team"])
        for coord, teams in by_coord.items():
            if len(teams) > 1:
                assert frozenset(teams) in allowed, f"unexpected shared coordinate {coord}: {teams}"

    def test_indoor_is_the_exception_not_the_default(self, venues):
        """A wrong `indoor: true` silently deletes that club's weather."""
        indoor = [v["team"] for v in venues if v.get("indoor")]
        assert len(indoor) <= 6, f"suspiciously many indoor grounds: {indoor}"


class TestHaversine:
    def test_zero_distance(self):
        assert haversine_km(51.5, -0.1, 51.5, -0.1) == pytest.approx(0.0, abs=1e-9)

    def test_known_distance(self):
        """Old Trafford to the Emirates is about 262 km."""
        d = haversine_km(53.4631, -2.2913, 51.5549, -0.1084)
        assert 255 < d < 270

    def test_symmetric(self):
        a = haversine_km(48.2188, 11.6247, 41.3809, 2.1228)
        b = haversine_km(41.3809, 2.1228, 48.2188, 11.6247)
        assert a == pytest.approx(b)


class TestPlausible:
    @pytest.mark.parametrize("lat,lon,ok", [
        (51.5, -0.1, True), (None, -0.1, False), (51.5, None, False),
        (0.0, 0.0, False), (91.0, 0.0, False), (0.0, 181.0, False),
    ])
    def test_plausible(self, lat, lon, ok):
        assert _plausible(lat, lon) is ok


@pytest.fixture()
def wh(tmp_path):
    warehouse = Warehouse(tmp_path / "venue.sqlite")
    warehouse.migrate()
    warehouse.upsert_competition("eng.1", "Premier League", "M", country="GB", tier=1)
    yield warehouse
    warehouse.close()


def _seed(wh: Warehouse, name="Arsenal", *, date="2020-09-05T15:00:00+00:00", indoor=False):
    home = wh.upsert_team(canonical_name=name, gender="M")
    away = wh.upsert_team(canonical_name="Chelsea", gender="M")
    if indoor:
        wh.set_team_venue(home, venue_lat=51.5, venue_lon=-0.1, venue_indoor=True)
    wh.upsert_matches([MatchRow(
        match_id="m1", source="espn", competition_id="eng.1", season=2020,
        date_utc=date, home_team_id=home, away_team_id=away, home_score=1, away_score=0,
    )])
    return home, away


class TestVenueLoader:
    def test_applies_coordinates_to_the_warehouse(self, wh, tmp_path):
        home, _ = _seed(wh)
        path = tmp_path / "v.yml"
        path.write_text(yaml.safe_dump({"venues": [
            {"team": "Arsenal", "league": "eng.1", "lat": 51.55504, "lon": -0.1084, "indoor": False}
        ]}))
        stats = load_venues(wh, path=path)
        assert stats.applied == 1
        row = wh._conn.execute("SELECT venue_lat, venue_lon FROM teams WHERE team_id = ?", (home,)).fetchone()
        assert row["venue_lat"] == pytest.approx(51.55504)

    def test_null_coordinates_stay_null(self, wh, tmp_path):
        """Provenance rule: an unresolved venue must not get a placeholder."""
        home, _ = _seed(wh)
        path = tmp_path / "v.yml"
        path.write_text(yaml.safe_dump({"venues": [
            {"team": "Arsenal", "league": "eng.1", "lat": None, "lon": None, "source": "unresolved"}
        ]}))
        stats = load_venues(wh, path=path)
        assert stats.applied == 0
        assert stats.unresolved == 1
        row = wh._conn.execute("SELECT venue_lat FROM teams WHERE team_id = ?", (home,)).fetchone()
        assert row["venue_lat"] is None

    def test_null_island_is_rejected(self, wh, tmp_path):
        home, _ = _seed(wh)
        path = tmp_path / "v.yml"
        path.write_text(yaml.safe_dump({"venues": [
            {"team": "Arsenal", "league": "eng.1", "lat": 0.0, "lon": 0.0}
        ]}))
        assert load_venues(wh, path=path).unresolved == 1

    def test_a_wrong_coordinate_can_be_corrected(self, wh, tmp_path):
        """upsert_team only fills NULLs; set_team_venue must overwrite, or a
        bad coordinate would be permanent."""
        home, _ = _seed(wh)
        wh.set_team_venue(home, venue_lat=1.0, venue_lon=1.0)
        path = tmp_path / "v.yml"
        path.write_text(yaml.safe_dump({"venues": [
            {"team": "Arsenal", "league": "eng.1", "lat": 51.55504, "lon": -0.1084}
        ]}))
        load_venues(wh, path=path)
        row = wh._conn.execute("SELECT venue_lat FROM teams WHERE team_id = ?", (home,)).fetchone()
        assert row["venue_lat"] == pytest.approx(51.55504)

    def test_resolves_through_team_aliases_when_spellings_differ(self, wh, tmp_path):
        """venues.yml may name a club differently from the warehouse; the
        alias file is what reconciles them."""
        home = wh.upsert_team(canonical_name="FC Cologne", gender="M")
        away = wh.upsert_team(canonical_name="Chelsea", gender="M")
        wh.upsert_matches([MatchRow(
            match_id="m1", source="espn", competition_id="eng.1", season=2020,
            date_utc="2020-09-05T15:00:00+00:00", home_team_id=home, away_team_id=away,
            home_score=1, away_score=0,
        )])
        path = tmp_path / "v.yml"
        # "FC Koln" is football-data's spelling, pinned to FC Cologne.
        path.write_text(yaml.safe_dump({"venues": [
            {"team": "FC Koln", "league": "ger.1", "lat": 50.93361, "lon": 6.87500}
        ]}))
        stats = load_venues(wh, path=path)
        assert stats.applied == 1
        row = wh._conn.execute("SELECT venue_lat FROM teams WHERE team_id = ?", (home,)).fetchone()
        assert row["venue_lat"] == pytest.approx(50.93361)

    def test_unknown_team_is_counted_not_fatal(self, wh, tmp_path):
        _seed(wh)
        path = tmp_path / "v.yml"
        path.write_text(yaml.safe_dump({"venues": [
            {"team": "Nonexistent United", "league": "eng.1", "lat": 51.5, "lon": -0.1}
        ]}))
        stats = load_venues(wh, path=path)
        assert stats.team_not_found == 1
        assert stats.applied == 0

    def test_missing_file_is_not_fatal(self, wh, tmp_path):
        _seed(wh)
        stats = load_venues(wh, path=tmp_path / "absent.yml")
        assert stats.entries == 0 and stats.applied == 0

    def test_coverage_report(self, wh, tmp_path):
        home, _ = _seed(wh)
        assert venue_coverage(wh)["eng.1"] == (0, 1)
        wh.set_team_venue(home, venue_lat=51.5, venue_lon=-0.1)
        assert venue_coverage(wh)["eng.1"] == (1, 1)


class TestWeatherJoin:
    def test_no_venue_means_no_weather_and_no_crash(self, wh):
        _seed(wh)
        stats = asyncio.run(load_weather(wh))
        assert stats.skipped_no_venue == 1
        assert stats.weather_written == 0
        assert wh._conn.execute("SELECT COUNT(*) FROM weather").fetchone()[0] == 0

    def test_indoor_venue_is_recorded_as_such(self, wh):
        """'Roof closed' must be distinguishable from 'never fetched'."""
        _seed(wh, indoor=True)
        stats = asyncio.run(load_weather(wh))
        assert stats.skipped_indoor == 1
        row = wh._conn.execute("SELECT * FROM weather").fetchone()
        assert row["is_outdoor"] == 0
        assert row["temp_c"] is None

    def test_match_without_a_kickoff_gets_no_weather(self, wh):
        """Midnight means the hour is unknown; conditions at an unknown hour
        are not a measurement."""
        home, _ = _seed(wh, date="2020-09-05T00:00:00+00:00")
        wh.set_team_venue(home, venue_lat=51.5, venue_lon=-0.1)
        stats = asyncio.run(load_weather(wh))
        assert stats.skipped_no_kickoff == 1
        assert stats.weather_written == 0

    def test_hourly_index_picks_the_kickoff_hour(self):
        payload = {"hourly": {
            "time": ["2020-09-05T14:00", "2020-09-05T15:00", "2020-09-05T16:00"],
            "temperature_2m": [18.1, 19.2, 17.4],
            "precipitation": [0.0, 0.3, 1.1],
            "wind_speed_10m": [11.0, 12.5, 9.0],
            "relative_humidity_2m": [70, 68, 74],
            "wind_direction_10m": [210, 215, 190],
        }}
        index = _index_hourly(payload)
        assert index["2020-09-05T15"]["temp_c"] == 19.2
        assert index["2020-09-05T15"]["precip_mm"] == 0.3
        assert index["2020-09-05T16"]["wind_kmh"] == 9.0

    def test_hourly_index_tolerates_nulls(self):
        payload = {"hourly": {
            "time": ["2020-09-05T15:00"],
            "temperature_2m": [None],
            "precipitation": [],
            "wind_speed_10m": [12.5],
            "relative_humidity_2m": [68],
            "wind_direction_10m": [215],
        }}
        reading = _index_hourly(payload)["2020-09-05T15"]
        assert reading["temp_c"] is None
        assert reading["precip_mm"] is None
        assert reading["wind_kmh"] == 12.5

    def test_empty_payload_yields_empty_index(self):
        assert _index_hourly({}) == {}
