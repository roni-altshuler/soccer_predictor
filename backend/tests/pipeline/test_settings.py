"""Tests for pipeline settings — env parsing + defaults."""

from backend.pipeline.settings import get_pipeline_settings, reset_settings_cache_for_tests


def test_defaults_when_env_unset(monkeypatch):
    for key in (
        "DATABASE_URL", "PIPELINE_DUAL_WRITE", "PIPELINE_READ_FROM",
        "REDIS_URL", "PIPELINE_PUBLISH_LIVE", "JWT_SECRET",
        "R2_BUCKET", "API_FOOTBALL_KEY",
    ):
        monkeypatch.delenv(key, raising=False)
    reset_settings_cache_for_tests()
    s = get_pipeline_settings()
    assert s.database_url is None
    assert s.dual_write_enabled is False
    assert s.read_from == "sqlite"
    assert s.redis_url is None
    assert s.publish_live_events is False
    assert s.jwt_secret is None
    assert s.r2_bucket is None
    assert s.api_football_key is None
    assert s.api_football_daily_budget == 100


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@h/db")
    monkeypatch.setenv("PIPELINE_DUAL_WRITE", "true")
    monkeypatch.setenv("PIPELINE_READ_FROM", "pg")
    monkeypatch.setenv("REDIS_URL", "redis://r:6379/0")
    monkeypatch.setenv("PIPELINE_PUBLISH_LIVE", "yes")
    monkeypatch.setenv("PIPELINE_CACHE_TTL_SEC", "120")
    monkeypatch.setenv("API_FOOTBALL_DAILY_BUDGET", "50")
    reset_settings_cache_for_tests()
    s = get_pipeline_settings()
    assert s.database_url == "postgresql://u:p@h/db"
    assert s.dual_write_enabled is True
    assert s.read_from == "pg"
    assert s.redis_url == "redis://r:6379/0"
    assert s.publish_live_events is True
    assert s.redis_cache_default_ttl_sec == 120
    assert s.api_football_daily_budget == 50
