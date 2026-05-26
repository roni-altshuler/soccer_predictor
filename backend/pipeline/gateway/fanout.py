"""Per-process connection registry and Redis fan-out wiring.

Two layers:

1. **Local registry** — in-process map of ``channel -> set of WebSocket``.
   Constant-time subscribe/unsubscribe, used to deliver events to clients
   actually connected to *this* instance.
2. **Cross-instance** — every event also goes through Redis Pub/Sub on
   ``ws:broadcast``. All gateway instances subscribe to this channel; each
   one filters by its local registry. This means workers (e.g. the
   ``postgres_writer`` or ``prediction_recomputer``) only need to publish
   once, not N times.

Backpressure: each WebSocket gets an asyncio.Queue of bounded size. Overflow
drops the *oldest* event (cheaper than blocking the publisher) and bumps a
counter so we can see drops in metrics.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any, Dict, Optional, Set

logger = logging.getLogger(__name__)


class ConnectionRegistry:
    """Local channel ↔ websocket map.

    A "websocket" here is anything with an ``async def send_text(str)`` and a
    ``client_id`` attribute. FastAPI's :class:`fastapi.WebSocket` works; in
    tests we use a stub.
    """

    def __init__(self, *, queue_size: int = 256):
        self._channels: Dict[str, Set[str]] = defaultdict(set)
        self._connections: Dict[str, "ManagedConnection"] = {}
        self._lock = asyncio.Lock()
        self._queue_size = queue_size

    async def register(self, conn: "ManagedConnection") -> None:
        async with self._lock:
            self._connections[conn.client_id] = conn

    async def unregister(self, client_id: str) -> None:
        async with self._lock:
            conn = self._connections.pop(client_id, None)
            if conn is None:
                return
            for ch in list(conn.channels):
                self._channels[ch].discard(client_id)
                if not self._channels[ch]:
                    self._channels.pop(ch, None)

    async def subscribe(self, client_id: str, channel: str) -> None:
        async with self._lock:
            conn = self._connections.get(client_id)
            if conn is None:
                return
            self._channels[channel].add(client_id)
            conn.channels.add(channel)

    async def unsubscribe(self, client_id: str, channel: str) -> None:
        async with self._lock:
            conn = self._connections.get(client_id)
            if conn is not None:
                conn.channels.discard(channel)
            self._channels[channel].discard(client_id)
            if not self._channels[channel]:
                self._channels.pop(channel, None)

    async def broadcast(self, channel: str, message: dict) -> int:
        """Enqueue ``message`` to every connection subscribed to ``channel``.

        Returns the number of recipients. Drops on overflow (per-connection).
        """
        text = json.dumps(message, default=str)
        async with self._lock:
            client_ids = list(self._channels.get(channel, ()))
        delivered = 0
        for cid in client_ids:
            conn = self._connections.get(cid)
            if conn is None:
                continue
            try:
                conn.queue.put_nowait(text)
                delivered += 1
            except asyncio.QueueFull:
                # drop oldest, append newest
                try:
                    conn.queue.get_nowait()
                    conn.queue.put_nowait(text)
                    conn.dropped += 1
                except Exception:  # noqa: BLE001
                    pass
        return delivered

    def make_queue(self) -> asyncio.Queue:
        return asyncio.Queue(maxsize=self._queue_size)


class ManagedConnection:
    """Pairing of a websocket and its bounded outbound queue."""

    __slots__ = ("client_id", "websocket", "principal", "channels", "queue", "dropped")

    def __init__(self, client_id: str, websocket, principal, queue: asyncio.Queue):
        self.client_id = client_id
        self.websocket = websocket
        self.principal = principal
        self.channels: set[str] = set()
        self.queue = queue
        self.dropped = 0


class RedisFanout:
    """Bridges Redis Pub/Sub ``ws:broadcast`` ↔ local :class:`ConnectionRegistry`.

    Workers publish payloads of shape ``{"channel": "match.12345", "message": {...}}``
    on the ``ws:broadcast`` channel. We deliver to local subscribers and ignore
    the rest.
    """

    def __init__(self, url: str, registry: ConnectionRegistry, *, async_client=None):
        self.url = url
        self.registry = registry
        self._async_client = async_client
        self._task: Optional[asyncio.Task] = None
        self._subscribed = asyncio.Event()

    def _client(self):
        if self._async_client is not None:
            return self._async_client
        import redis.asyncio as aioredis
        self._async_client = aioredis.from_url(self.url, decode_responses=True)
        return self._async_client

    async def start(self) -> None:
        if self._task is not None:
            return
        self._subscribed.clear()
        self._task = asyncio.create_task(self._run())
        # Wait until the subscription is actually live so publishers after
        # start() are guaranteed to be delivered. Cap at 2s so a broken Redis
        # doesn't deadlock startup.
        try:
            await asyncio.wait_for(self._subscribed.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            logger.warning("RedisFanout subscription not confirmed after 2s")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _run(self) -> None:
        from backend.pipeline.streams.topics import WS_BROADCAST
        client = self._client()
        pubsub = client.pubsub()
        await pubsub.subscribe(WS_BROADCAST)
        self._subscribed.set()
        try:
            async for raw in pubsub.listen():
                if raw.get("type") not in {"message", "pmessage"}:
                    continue
                try:
                    payload = json.loads(raw.get("data"))
                except (TypeError, ValueError):
                    continue
                channel = payload.get("channel")
                message = payload.get("message")
                if channel and message:
                    await self.registry.broadcast(channel, message)
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.exception("RedisFanout loop crashed: %s", exc)
        finally:
            try:
                await pubsub.unsubscribe(WS_BROADCAST)
                await pubsub.close()
            except Exception:  # noqa: BLE001
                pass

    @staticmethod
    async def publish(url: str, channel: str, message: Dict[str, Any]) -> None:
        """Helper for workers — publish a message to the fan-out channel."""
        import redis.asyncio as aioredis
        from backend.pipeline.streams.topics import WS_BROADCAST
        client = aioredis.from_url(url, decode_responses=True)
        try:
            await client.publish(
                WS_BROADCAST,
                json.dumps({"channel": channel, "message": message}, default=str),
            )
        finally:
            await client.close()
