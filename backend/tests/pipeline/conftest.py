"""Shared pipeline test fixtures.

Most of the pipeline can be exercised without a real Postgres or Redis:

* Redis → fakeredis (in-process)
* Postgres → integration tests are *skipped* unless ``DATABASE_URL`` is set
  (so CI without a Postgres service stays green)

This keeps the regular ``pytest`` run fast and dependency-free, while
allowing a full integration sweep when the user runs::

    DATABASE_URL=postgresql://soccer:soccer@localhost:5432/soccer_predictor pytest backend/tests/pipeline/ -v
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Make repo root importable for tests run via `pytest backend/tests/pipeline/`
ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def _reset_pipeline_singletons():
    """Make sure singletons don't leak between tests."""
    from backend.pipeline.settings import reset_settings_cache_for_tests
    from backend.pipeline.cache.redis_cache import reset_cache_singleton_for_tests
    from backend.pipeline.streams.producer import reset_producer_singleton_for_tests
    from backend.pipeline.identity.resolver import reset_resolver_singleton_for_tests

    reset_settings_cache_for_tests()
    reset_cache_singleton_for_tests()
    reset_producer_singleton_for_tests()
    reset_resolver_singleton_for_tests()
    yield
    reset_settings_cache_for_tests()
    reset_cache_singleton_for_tests()
    reset_producer_singleton_for_tests()
    reset_resolver_singleton_for_tests()


@pytest.fixture()
def fake_redis():
    """In-memory Redis substitute for sync calls."""
    fakeredis = pytest.importorskip("fakeredis")
    return fakeredis.FakeStrictRedis(decode_responses=True)


@pytest.fixture()
def fake_async_redis():
    """In-memory Redis substitute for async calls (redis.asyncio API)."""
    fakeredis = pytest.importorskip("fakeredis")
    return fakeredis.aioredis.FakeRedis(decode_responses=True)


@pytest.fixture()
def pg_dsn():
    """If ``DATABASE_URL`` is set we run integration tests against it; else skip."""
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        pytest.skip("DATABASE_URL not set; integration tests skipped")
    return dsn


@pytest.fixture()
def pg_warehouse(pg_dsn, monkeypatch):
    """Real Postgres warehouse, against a clean schema. Drops + recreates ``core``."""
    monkeypatch.setenv("DATABASE_URL", pg_dsn)
    from backend.pipeline.pg.warehouse import PgWarehouse

    wh = PgWarehouse(pg_dsn)
    # cleanup any leftover state from prior runs (single shared CI DB)
    with wh.connection() as conn, conn.cursor() as cur:
        for schema in ("archive", "features", "core", "staging", "raw"):
            cur.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        conn.commit()
    wh.migrate()
    yield wh
    wh.close()
