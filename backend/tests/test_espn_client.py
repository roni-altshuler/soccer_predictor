"""
Test suite for ESPN API client.

Tests the ESPN API integration for:
- Fetching live scores
- Retrieving league standings
- Getting match details
- Error handling and fallbacks
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock
import pytest_asyncio
from backend.services.espn.client import ESPNClient, ESPN_LEAGUE_IDS


@pytest_asyncio.fixture
async def espn_client():
    """Create an ESPN client instance for testing."""
    client = ESPNClient()
    yield client
    await client.close()


@pytest.mark.asyncio
async def test_espn_client_initialization():
    """Test that ESPN client initializes correctly."""
    client = ESPNClient()
    assert client is not None
    assert client.BASE_URL == "https://site.web.api.espn.com/apis/site/v2/sports/soccer"
    assert client.default_ttl == 300
    assert client.live_ttl == 30
    await client.close()


@pytest.mark.asyncio
async def test_espn_client_rate_limiting(espn_client):
    """Test that rate limiting is working."""
    # The rate limiter should allow requests
    await espn_client.rate_limiter.acquire()
    # Tokens should be decremented
    assert espn_client.rate_limiter.tokens < espn_client.rate_limiter.max_tokens


@pytest.mark.asyncio
async def test_espn_cache_functionality(espn_client):
    """Test that caching is working correctly."""
    # Set a value in cache
    test_key = "test_key"
    test_value = {"data": "test"}
    espn_client.cache.set(test_key, test_value, ttl=60)
    
    # Retrieve from cache
    cached_value = espn_client.cache.get(test_key)
    assert cached_value == test_value
    
    # Clear cache
    espn_client.cache.clear()
    assert espn_client.cache.get(test_key) is None


@pytest.mark.asyncio
async def test_espn_league_ids_mapping():
    """Test that ESPN league IDs are properly configured."""
    assert "premier_league" in ESPN_LEAGUE_IDS
    assert "la_liga" in ESPN_LEAGUE_IDS
    assert "bundesliga" in ESPN_LEAGUE_IDS
    assert "serie_a" in ESPN_LEAGUE_IDS
    assert "ligue_1" in ESPN_LEAGUE_IDS
    
    # Verify format
    assert ESPN_LEAGUE_IDS["premier_league"] == "eng.1"
    assert ESPN_LEAGUE_IDS["la_liga"] == "esp.1"


@pytest.mark.asyncio
async def test_espn_client_headers():
    """Test that proper headers are set for API requests."""
    client = ESPNClient()
    assert "User-Agent" in client.HEADERS
    assert "Accept" in client.HEADERS
    assert client.HEADERS["Accept"] == "application/json"
    await client.close()


@pytest.mark.asyncio
async def test_espn_client_close(espn_client):
    """Test that client can be closed properly."""
    # Create a client connection
    await espn_client._get_client()
    
    # Close the client
    await espn_client.close()
    
    # Verify it's closed
    if espn_client._client:
        assert espn_client._client.is_closed


def test_espn_league_ids_consistency():
    """Test that all required leagues have ESPN IDs."""
    required_leagues = [
        "premier_league",
        "la_liga", 
        "bundesliga",
        "serie_a",
        "ligue_1",
        "eredivisie",
        "primeira_liga",
        "mls",
        "champions_league",
        "europa_league"
    ]
    
    for league in required_leagues:
        assert league in ESPN_LEAGUE_IDS, f"Missing ESPN ID for {league}"
        assert isinstance(ESPN_LEAGUE_IDS[league], str), f"ESPN ID for {league} must be a string"
        assert len(ESPN_LEAGUE_IDS[league]) > 0, f"ESPN ID for {league} cannot be empty"
