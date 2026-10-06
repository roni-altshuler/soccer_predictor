"""
Tests for the /api/v1/teams/players/* endpoints.

The teams router is mounted on a bare FastAPI app (importing backend.main
would pull the full ML stack) and the ESPN client singleton is patched
with canned core-API / overview fixtures, mirroring the mocking style of
test_espn_client.py.
"""

from unittest.mock import AsyncMock, patch
from copy import deepcopy
from functools import partial
import hashlib
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1.teams import router as teams_router
from backend.services.data.player_portraits import player_portrait


# ---------------------------------------------------------------- fixtures

ATHLETE_PAYLOAD = {
    "id": "45843",
    "displayName": "Lionel Messi",
    "jersey": "10",
    "citizenship": "Argentina",
    "age": 38,
    "height": 67.0,
    "position": {"name": "Forward", "displayName": "Forward", "abbreviation": "F"},
    "headshot": {"href": "https://a.espncdn.com/i/headshots/soccer/players/full/45843.png"},
    "defaultTeam": {"$ref": "http://sports.core.api.espn.com/v2/sports/soccer/teams/20232?lang=en"},
}

TEAM_REF_PAYLOAD = {"id": "20232", "displayName": "Inter Miami CF", "color": "231f20"}

OVERVIEW_PAYLOAD = {
    "statistics": {
        "names": ["starts", "yellowCards", "redCards", "totalGoals", "goalAssists", "totalShots", "shotsOnTarget"],
        "splits": [
            {"displayName": "2026 International Friendly", "stats": ["1", "0", "0", "2", "0", "5", "2"]},
            {"displayName": "2026 MLS", "stats": ["14", "2", "0", "12", "8", "84", "34"]},
        ],
    },
    "gameLog": {
        "events": {
            "401867950": {
                "id": "401867950",
                "atVs": "vs",
                "gameDate": "2026-06-10T01:00:00.000+00:00",
                "score": "3-0",
                "gameResult": "W",
                "opponent": {"id": "470", "displayName": "Iceland"},
            },
            "761657": {
                "id": "761657",
                "atVs": "@",
                "gameDate": "2026-05-24T23:00:00.000+00:00",
                "score": "6-4",
                "gameResult": "W",
                "opponent": {"id": "10739", "displayName": "Philadelphia Union"},
            },
        },
        "statistics": [
            {
                "names": ["appearances", "totalGoals", "goalAssists"],
                "events": [
                    {"eventId": "401867950", "stats": ["1", "1", "0"]},
                    {"eventId": "761657", "stats": ["1", "0", "2"]},
                ],
            }
        ],
    },
}


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(teams_router, prefix="/api/v1")
    return TestClient(app)


def _mock_espn(athlete=None, overview=None, team_ref=None):
    espn = AsyncMock()
    espn.get_athlete = AsyncMock(return_value=athlete)
    espn.get_athlete_overview = AsyncMock(return_value=overview)
    espn.resolve_ref = AsyncMock(return_value=team_ref)
    return espn


# ----------------------------------------------------------------- profile


def test_player_profile_normalization(client):
    espn = _mock_espn(athlete=ATHLETE_PAYLOAD, team_ref=TEAM_REF_PAYLOAD)
    with patch("backend.api.v1.teams.get_espn_client", return_value=espn):
        response = client.get("/api/v1/teams/players/45843")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == 45843
    assert body["name"] == "Lionel Messi"
    assert body["position"] == "Forward"
    assert body["shirtNumber"] == 10
    assert body["nationality"] == "Argentina"
    assert body["age"] == 38
    assert body["height"] == 170  # 67 inches → cm
    # A provider headshot URL establishes neither publication rights nor a
    # verified local asset. Unknown portraits are omitted, not guessed.
    assert "imageUrl" not in body and "portrait" not in body
    assert body["identity"] == {"provider": "espn", "id": "45843"}
    assert body["teamId"] == 20232
    assert body["teamName"] == "Inter Miami CF"
    assert body["teamColor"] == "#231f20"


def test_player_profile_without_headshot_or_team(client):
    athlete = {"id": "999", "displayName": "Squad Player", "jersey": "n/a"}
    espn = _mock_espn(athlete=athlete)
    with patch("backend.api.v1.teams.get_espn_client", return_value=espn):
        response = client.get("/api/v1/teams/players/999")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Squad Player"
    # Absent provider data stays absent — no placeholder fields.
    for field in ("imageUrl", "teamId", "teamName", "shirtNumber", "age"):
        assert field not in body


def test_profile_publishes_only_a_verified_cached_portrait(client, tmp_path):
    # The permissions and identity record are synthetic test evidence only.
    contract = json.loads((Path(__file__).parent / 'fixtures/portraits/contract.json').read_text())
    entry = deepcopy(contract['cases'][0]['entry'])
    content = b'synthetic portrait cache bytes'
    digest = hashlib.sha256(content).hexdigest()
    entry.update(sha256=digest, path=f'/headshots/espn/123-{digest}.webp')
    (tmp_path / 'espn').mkdir()
    asset = tmp_path / entry['path'].removeprefix('/headshots/')
    asset.write_bytes(content)
    (tmp_path / 'manifest.json').write_text(json.dumps({'espn:123': entry}))
    espn = _mock_espn(athlete={'id': '123', 'displayName': 'Synthetic player'})
    with patch('backend.api.v1.teams.get_espn_client', return_value=espn), patch(
        'backend.api.v1.teams.player_portrait', partial(player_portrait, directory=tmp_path)
    ):
        body = client.get('/api/v1/teams/players/123?provider=espn').json()
        assert body['portrait'] == entry and body['imageUrl'] == entry['path']
        asset.write_bytes(b'different subject bytes')
        body = client.get('/api/v1/teams/players/123?provider=espn').json()
        assert 'portrait' not in body and 'imageUrl' not in body


def test_player_profile_espn_miss_is_404(client):
    espn = _mock_espn(athlete=None)
    with patch("backend.api.v1.teams.get_espn_client", return_value=espn):
        response = client.get("/api/v1/teams/players/123456789")
    assert response.status_code == 404


@pytest.mark.parametrize('payload', [
    {'id': '999', 'displayName': 'Different player'},
    {'displayName': 'Anonymous identifier'},
    {'id': '45843', 'displayName': {}},
])
def test_profile_rejects_unmatched_or_malformed_subject(client, payload):
    espn = _mock_espn(athlete=payload)
    with patch('backend.api.v1.teams.get_espn_client', return_value=espn):
        assert client.get('/api/v1/teams/players/45843').status_code == 404
    espn.resolve_ref.assert_not_awaited()


@pytest.mark.parametrize('endpoint', ['', '/stats'])
def test_colliding_fotmob_id_is_not_sent_to_espn(client, endpoint):
    espn = _mock_espn(athlete=ATHLETE_PAYLOAD, overview=OVERVIEW_PAYLOAD)
    with patch('backend.api.v1.teams.get_espn_client', return_value=espn):
        assert client.get(f'/api/v1/teams/players/45843{endpoint}?provider=fotmob').status_code == 422
    espn.get_athlete.assert_not_awaited()
    espn.get_athlete_overview.assert_not_awaited()


def test_profile_context_and_canonical_team_link_are_retained(client):
    espn = _mock_espn(athlete=ATHLETE_PAYLOAD, team_ref=TEAM_REF_PAYLOAD)
    with patch('backend.api.v1.teams.get_espn_client', return_value=espn):
        body = client.get('/api/v1/teams/players/45843?provider=espn&league=usa.1&gender=F').json()
    espn.get_athlete.assert_awaited_once_with('45843', league_slug='usa.1')
    assert body['links']['self'] == '/api/v1/teams/players/45843?provider=espn&league=usa.1&gender=F'
    assert body['links']['team'] == '/teams/20232?provider=espn&league=usa.1&gender=F'


def test_profile_omits_other_provider_team_reference(client):
    athlete = deepcopy(ATHLETE_PAYLOAD)
    athlete['defaultTeam'] = {'$ref': 'https://www.fotmob.com/teams/20232'}
    espn = _mock_espn(athlete=athlete)
    with patch('backend.api.v1.teams.get_espn_client', return_value=espn):
        body = client.get('/api/v1/teams/players/45843').json()
    assert 'teamId' not in body and 'team' not in body['links']
    espn.resolve_ref.assert_not_awaited()


# ------------------------------------------------------------------- stats


def test_player_stats_picks_primary_split(client):
    espn = _mock_espn(overview=OVERVIEW_PAYLOAD)
    with patch("backend.api.v1.teams.get_espn_client", return_value=espn):
        response = client.get("/api/v1/teams/players/45843/stats")

    assert response.status_code == 200
    body = response.json()
    # The MLS split has the most starts → primary competition.
    assert body["season"] == "2026 MLS"
    assert body["starts"] == 14
    assert body["goals"] == 12
    assert body["assists"] == 8
    assert body["shots"] == 84
    assert body["shotsOnTarget"] == 34
    # ESPN has no minutes/xG/ratings — they must not be fabricated.
    for field in ("minutes", "xG", "xA", "rating", "form"):
        assert field not in body


def test_player_stats_match_log_join(client):
    espn = _mock_espn(overview=OVERVIEW_PAYLOAD)
    with patch("backend.api.v1.teams.get_espn_client", return_value=espn):
        body = client.get("/api/v1/teams/players/45843/stats").json()

    matches = body["matches"]
    assert len(matches) == 2
    # Sorted most-recent first.
    assert matches[0]["id"] == "401867950"
    assert matches[0]["opponent"]["name"] == "Iceland"
    assert matches[0]["result"] == "W"
    assert matches[0]["isHome"] is True
    assert matches[0]["goals"] == 1
    assert matches[1]["isHome"] is False
    assert matches[1]["assists"] == 2


def test_player_stats_espn_miss_is_404(client):
    espn = _mock_espn(overview=None)
    with patch("backend.api.v1.teams.get_espn_client", return_value=espn):
        response = client.get("/api/v1/teams/players/123456789/stats")
    assert response.status_code == 404


def test_player_stats_empty_overview_degrades_gracefully(client):
    espn = _mock_espn(overview={})
    with patch("backend.api.v1.teams.get_espn_client", return_value=espn):
        response = client.get("/api/v1/teams/players/45843/stats")

    assert response.status_code == 200
    body = response.json()
    assert body["player_id"] == 45843
    assert body["matches"] == []
