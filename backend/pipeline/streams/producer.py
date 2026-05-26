"""Stream producer — wraps Redis ``XADD`` with the typed envelope.

Loaders and live pollers call ``producer.publish(LIVE_EVENTS, envelope)`` and
trust the producer to add the right MAXLEN trimming hint.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from backend.pipeline.streams.envelope import EventEnvelope

logger = logging.getLogger(__name__)


class StreamProducer:
    """Thin wrapper around redis-py ``xadd``.

    Supports both sync and async via a shared client. The async variant uses
    ``redis.asyncio``; the sync variant uses the regular client.
    """

    def __init__(self, url: str, *, maxlen: int = 100_000, client=None, async_client=None):
        self.url = url
        self.maxlen = maxlen
        self._client = client
        self._async_client = async_client
        self._lock = threading.Lock()

    def _sync(self):
        if self._client is not None:
            return self._client
        import redis
        with self._lock:
            if self._client is None:
                self._client = redis.Redis.from_url(self.url, decode_responses=True)
        return self._client

    def _async(self):
        if self._async_client is not None:
            return self._async_client
        import redis.asyncio as aioredis
        with self._lock:
            if self._async_client is None:
                self._async_client = aioredis.from_url(self.url, decode_responses=True)
        return self._async_client

    # ---- sync ------------------------------------------------------------

    def publish(self, stream: str, envelope: EventEnvelope) -> str:
        """Write to ``stream`` with ``MAXLEN ~``. Returns the Redis stream id."""
        try:
            return self._sync().xadd(
                stream,
                envelope.to_redis(),
                maxlen=self.maxlen,
                approximate=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Stream publish failed for %s: %s", stream, exc)
            raise

    # ---- async -----------------------------------------------------------

    async def apublish(self, stream: str, envelope: EventEnvelope) -> str:
        try:
            return await self._async().xadd(
                stream,
                envelope.to_redis(),
                maxlen=self.maxlen,
                approximate=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Stream async publish failed for %s: %s", stream, exc)
            raise


# ---------------------------------------------------------------------------

_singleton: Optional[StreamProducer] = None
_singleton_lock = threading.Lock()


def get_producer() -> Optional[StreamProducer]:
    """Return a process-wide stream producer if Redis is configured, else None."""
    global _singleton
    from backend.pipeline.settings import get_pipeline_settings

    settings = get_pipeline_settings()
    if not settings.redis_url:
        return None
    with _singleton_lock:
        if _singleton is None or _singleton.url != settings.redis_url:
            _singleton = StreamProducer(
                settings.redis_url,
                maxlen=settings.stream_maxlen,
            )
        return _singleton


def reset_producer_singleton_for_tests() -> None:
    global _singleton
    _singleton = None
