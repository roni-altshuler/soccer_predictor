"""Tests for the per-IP token-bucket RateLimitMiddleware."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.middleware.rate_limit import RateLimitMiddleware


def _build_app(limit_per_minute: int) -> TestClient:
    app = FastAPI()
    app.add_middleware(RateLimitMiddleware, limit_per_minute=limit_per_minute)

    @app.get("/api/thing")
    def thing():
        return {"ok": True}

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return TestClient(app)


def test_requests_within_limit_pass():
    client = _build_app(limit_per_minute=5)
    for _ in range(5):
        assert client.get("/api/thing").status_code == 200


def test_bucket_exhaustion_returns_429_with_retry_after():
    client = _build_app(limit_per_minute=3)
    for _ in range(3):
        assert client.get("/api/thing").status_code == 200
    response = client.get("/api/thing")
    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_zero_limit_disables_rate_limiting():
    client = _build_app(limit_per_minute=0)
    for _ in range(50):
        assert client.get("/api/thing").status_code == 200


def test_health_endpoint_is_exempt():
    client = _build_app(limit_per_minute=1)
    assert client.get("/api/thing").status_code == 200
    assert client.get("/api/thing").status_code == 429
    # /api/health bypasses the bucket entirely.
    for _ in range(10):
        assert client.get("/api/health").status_code == 200
