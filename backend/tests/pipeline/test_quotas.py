"""Tests for the quota report — make sure it never raises."""

from __future__ import annotations

from backend.pipeline.quotas import report


def test_report_runs_without_any_services(monkeypatch):
    """No env vars set → every section returns a non-raising 'no_*' status."""
    for k in ("DATABASE_URL", "REDIS_URL", "R2_ENDPOINT_URL", "R2_BUCKET", "API_FOOTBALL_KEY"):
        monkeypatch.delenv(k, raising=False)
    from backend.pipeline.settings import reset_settings_cache_for_tests
    from backend.pipeline.cache.redis_cache import reset_cache_singleton_for_tests
    reset_settings_cache_for_tests()
    reset_cache_singleton_for_tests()

    r = report()
    assert set(r) == {"api_football", "postgres", "redis", "r2"}
    # Every section returns a status; none raise
    for section in r.values():
        assert "status" in section


def test_health_quotas_endpoint_registers():
    """Smoke: the gateway exposes /health/quotas."""
    from backend.pipeline.gateway.app import create_app
    app = create_app()
    paths = [r.path for r in app.routes]
    assert "/health/quotas" in paths
    assert "/health" in paths
