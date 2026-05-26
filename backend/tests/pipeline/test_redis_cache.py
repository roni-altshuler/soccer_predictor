"""Tests for the Redis cache layer."""

from __future__ import annotations

import asyncio
import time

import pytest

from backend.pipeline.cache.redis_cache import NullCache, RedisCache


def test_null_cache_methods_are_noops():
    c = NullCache()
    c.set("k", {"a": 1})
    assert c.get("k") is None
    c.delete("k")
    assert c.get("k") is None


def test_redis_cache_sync_round_trip(fake_redis):
    c = RedisCache("redis://injected", client=fake_redis)
    c.set("fixtures:2026-05-24:M", [{"id": 1}], ttl_sec=60)
    assert c.get("fixtures:2026-05-24:M") == [{"id": 1}]
    c.delete("fixtures:2026-05-24:M")
    assert c.get("fixtures:2026-05-24:M") is None


def test_redis_cache_ttl_expires(fake_redis):
    c = RedisCache("redis://injected", client=fake_redis)
    c.set("ephemeral", "v", ttl_sec=1)
    raw_ttl = fake_redis.ttl("cache:ephemeral")
    assert 0 < raw_ttl <= 1


def test_redis_cache_handles_outage_gracefully():
    class _Broken:
        def get(self, *a, **kw):
            raise ConnectionError("redis down")
        def set(self, *a, **kw):
            raise ConnectionError("redis down")
        def delete(self, *a, **kw):
            raise ConnectionError("redis down")
        def ping(self):
            raise ConnectionError("redis down")
    c = RedisCache("redis://broken", client=_Broken())
    # Should not raise — should return None
    assert c.get("anything") is None
    c.set("anything", "x")
    assert c.ping() is False


def test_async_round_trip(fake_async_redis):
    c = RedisCache("redis://injected", async_client=fake_async_redis)
    asyncio.run(_async_round_trip(c))


async def _async_round_trip(c):
    await c.aset("k", 42)
    assert await c.aget("k") == 42
    await c.adelete("k")
    assert await c.aget("k") is None


def test_get_or_set_loads_once_under_contention(fake_async_redis):
    c = RedisCache("redis://injected", async_client=fake_async_redis)
    counter = {"n": 0}

    async def loader():
        counter["n"] += 1
        await asyncio.sleep(0.02)
        return {"value": 7}

    async def run():
        results = await asyncio.gather(
            c.aget_or_set("k1", loader, ttl_sec=60),
            c.aget_or_set("k1", loader, ttl_sec=60),
            c.aget_or_set("k1", loader, ttl_sec=60),
        )
        return results

    results = asyncio.run(run())
    assert all(r == {"value": 7} for r in results)
    assert counter["n"] == 1
