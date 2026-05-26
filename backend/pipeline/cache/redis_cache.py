"""Redis-backed cache with a sane interface.

Goals
-----
* Replace the in-memory ``SimpleCache`` in ``backend/services/fotmob/client.py``
  for cross-process sharing (live pollers + FastAPI + workers all read/write
  the same hot data).
* Provide both sync and async surfaces so legacy and new code paths can both
  use it without one wrapping the other.
* Always degrade gracefully: if Redis is unreachable, every method returns
  None / writes are no-ops, and a warning is logged at most once per minute.

Cache key conventions are in the design doc (§7). This module enforces a
``"cache:"`` prefix on every key — callers pass logical keys like
``fixtures:2026-05-24:M`` and the cache adds the prefix.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any, Awaitable, Callable, Optional, Protocol

logger = logging.getLogger(__name__)

try:  # pragma: no cover - import side-effect
    import redis  # noqa: F401
    import redis.asyncio as aioredis
    REDIS_AVAILABLE = True
except Exception:  # pragma: no cover
    redis = None  # type: ignore[assignment]
    aioredis = None  # type: ignore[assignment]
    REDIS_AVAILABLE = False

CACHE_PREFIX = "cache:"
_WARN_INTERVAL_SEC = 60


class Cache(Protocol):
    """Minimal cache surface used by callers."""

    def get(self, key: str) -> Optional[Any]: ...
    def set(self, key: str, value: Any, *, ttl_sec: Optional[int] = None) -> None: ...
    def delete(self, key: str) -> None: ...
    async def aget(self, key: str) -> Optional[Any]: ...
    async def aset(self, key: str, value: Any, *, ttl_sec: Optional[int] = None) -> None: ...
    async def adelete(self, key: str) -> None: ...


class NullCache:
    """No-op cache. Used when ``REDIS_URL`` is unset.

    Every read returns None, every write is dropped. Lets call sites keep the
    same shape regardless of whether Redis is configured.
    """

    def get(self, key: str) -> Optional[Any]:
        return None

    def set(self, key: str, value: Any, *, ttl_sec: Optional[int] = None) -> None:
        return None

    def delete(self, key: str) -> None:
        return None

    async def aget(self, key: str) -> Optional[Any]:
        return None

    async def aset(self, key: str, value: Any, *, ttl_sec: Optional[int] = None) -> None:
        return None

    async def adelete(self, key: str) -> None:
        return None


class RedisCache:
    """Async + sync Redis cache wrapper.

    Connection is lazy — the first call constructs the client. We use a
    fakeredis-friendly interface so tests don't need a real Redis.
    """

    def __init__(
        self,
        url: str,
        *,
        default_ttl_sec: int = 300,
        client: Any = None,
        async_client: Any = None,
    ):
        self.url = url
        self.default_ttl_sec = default_ttl_sec
        self._lock = threading.Lock()
        self._client = client
        self._async_client = async_client
        self._last_warn = 0.0

    # ---- internals --------------------------------------------------------

    def _warn(self, msg: str, *args: Any) -> None:
        now = time.monotonic()
        if now - self._last_warn >= _WARN_INTERVAL_SEC:
            self._last_warn = now
            logger.warning(msg, *args)

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        if not REDIS_AVAILABLE:
            raise RuntimeError("redis-py not installed")
        with self._lock:
            if self._client is None:
                self._client = redis.Redis.from_url(self.url, decode_responses=True)
        return self._client

    def _get_async_client(self) -> Any:
        if self._async_client is not None:
            return self._async_client
        if not REDIS_AVAILABLE:
            raise RuntimeError("redis-py not installed")
        with self._lock:
            if self._async_client is None:
                self._async_client = aioredis.from_url(self.url, decode_responses=True)
        return self._async_client

    @staticmethod
    def _full_key(key: str) -> str:
        if key.startswith(CACHE_PREFIX):
            return key
        return CACHE_PREFIX + key

    @staticmethod
    def _encode(value: Any) -> str:
        return json.dumps(value, default=str)

    @staticmethod
    def _decode(raw: Optional[str]) -> Optional[Any]:
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return raw

    # ---- sync -------------------------------------------------------------

    def get(self, key: str) -> Optional[Any]:
        try:
            return self._decode(self._get_client().get(self._full_key(key)))
        except Exception as exc:  # noqa: BLE001
            self._warn("Redis GET failed for %s: %s", key, exc)
            return None

    def set(self, key: str, value: Any, *, ttl_sec: Optional[int] = None) -> None:
        ttl = ttl_sec if ttl_sec is not None else self.default_ttl_sec
        try:
            self._get_client().set(self._full_key(key), self._encode(value), ex=ttl)
        except Exception as exc:  # noqa: BLE001
            self._warn("Redis SET failed for %s: %s", key, exc)

    def delete(self, key: str) -> None:
        try:
            self._get_client().delete(self._full_key(key))
        except Exception as exc:  # noqa: BLE001
            self._warn("Redis DEL failed for %s: %s", key, exc)

    def ping(self) -> bool:
        try:
            return bool(self._get_client().ping())
        except Exception:  # noqa: BLE001
            return False

    # ---- async ------------------------------------------------------------

    async def aget(self, key: str) -> Optional[Any]:
        try:
            raw = await self._get_async_client().get(self._full_key(key))
            return self._decode(raw)
        except Exception as exc:  # noqa: BLE001
            self._warn("Redis async GET failed for %s: %s", key, exc)
            return None

    async def aset(self, key: str, value: Any, *, ttl_sec: Optional[int] = None) -> None:
        ttl = ttl_sec if ttl_sec is not None else self.default_ttl_sec
        try:
            await self._get_async_client().set(
                self._full_key(key), self._encode(value), ex=ttl
            )
        except Exception as exc:  # noqa: BLE001
            self._warn("Redis async SET failed for %s: %s", key, exc)

    async def adelete(self, key: str) -> None:
        try:
            await self._get_async_client().delete(self._full_key(key))
        except Exception as exc:  # noqa: BLE001
            self._warn("Redis async DEL failed for %s: %s", key, exc)

    # ---- stampede protection ---------------------------------------------

    async def aget_or_set(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        *,
        ttl_sec: Optional[int] = None,
        lock_ttl_sec: int = 30,
    ) -> Any:
        """Get from cache or compute via ``loader``, with stampede protection.

        Uses a short SET NX lock so only one caller computes the value at a time.
        Other concurrent callers wait briefly, then read the freshly-computed
        value. If the loader raises, the lock is released so the next attempt
        is not blocked.
        """
        cached = await self.aget(key)
        if cached is not None:
            return cached

        client = self._get_async_client()
        full_key = self._full_key(key)
        lock_key = full_key + ":lock"

        # Try to grab the lock. If we can't, another caller is computing.
        got_lock = False
        try:
            got_lock = bool(await client.set(lock_key, "1", nx=True, ex=lock_ttl_sec))
        except Exception:  # noqa: BLE001
            got_lock = True  # fall through and compute; Redis is down anyway

        if not got_lock:
            # brief wait, then read
            for _ in range(20):
                await asyncio.sleep(0.05)
                cached = await self.aget(key)
                if cached is not None:
                    return cached
            # fall through to compute ourselves if winner died
        try:
            value = await loader()
            await self.aset(key, value, ttl_sec=ttl_sec)
            return value
        finally:
            try:
                await client.delete(lock_key)
            except Exception:  # noqa: BLE001
                pass


# ---------------------------------------------------------------------------
# module-level accessor
# ---------------------------------------------------------------------------

_singleton: Optional[Cache] = None
_singleton_lock = threading.Lock()


def get_cache() -> Cache:
    """Return a process-wide cache instance based on settings.

    * If ``REDIS_URL`` is set and ``redis-py`` is importable → :class:`RedisCache`
    * Otherwise → :class:`NullCache` (no-op, safe to call)
    """
    global _singleton
    from backend.pipeline.settings import get_pipeline_settings

    settings = get_pipeline_settings()
    with _singleton_lock:
        if _singleton is None:
            if settings.redis_url and REDIS_AVAILABLE:
                _singleton = RedisCache(
                    settings.redis_url,
                    default_ttl_sec=settings.redis_cache_default_ttl_sec,
                )
            else:
                _singleton = NullCache()
        return _singleton


def reset_cache_singleton_for_tests() -> None:
    global _singleton
    _singleton = None
