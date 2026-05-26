"""Stream consumer base — Redis Streams consumer-group reader.

Workers (postgres_writer, prediction_recomputer, websocket gateway) subclass
this to react to events. Subclass contract:

    class MyWorker(StreamConsumer):
        STREAMS = (topics.LIVE_EVENTS,)
        GROUP = "postgres_writer"

        async def on_event(self, stream, envelope):
            ...

Then run it via ``await MyWorker().run()``.

Semantics
---------
* XREADGROUP with BLOCK ms — at-least-once delivery.
* On success, the consumer ACKs the message (XACK).
* On failure, the message is left pending and will be redelivered after
  ``stale_after_ms`` via ``XAUTOCLAIM``.
* DLQ: after ``max_redeliveries``, the message is XADDed to ``stream:dlq``
  with the original payload + the failing exception, and then ACKed so it
  doesn't keep getting redelivered.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import uuid
from typing import Optional, Sequence

from backend.pipeline.streams.envelope import EventEnvelope
from backend.pipeline.streams.topics import DLQ

logger = logging.getLogger(__name__)


class StreamConsumer:
    STREAMS: Sequence[str] = ()
    GROUP: str = "default"
    CONSUMER_NAME: Optional[str] = None       # autogen if None

    # tuning
    BLOCK_MS: int = 5_000
    COUNT: int = 16
    STALE_AFTER_MS: int = 60_000              # claim messages stuck >1m
    MAX_REDELIVERIES: int = 5

    def __init__(self, url: str, *, async_client=None):
        self.url = url
        self._async_client = async_client
        self.consumer_name = self.CONSUMER_NAME or f"{self.GROUP}-{socket.gethostname()}-{uuid.uuid4().hex[:6]}"
        self._stopped = asyncio.Event()

    def _client(self):
        if self._async_client is not None:
            return self._async_client
        import redis.asyncio as aioredis
        self._async_client = aioredis.from_url(self.url, decode_responses=True)
        return self._async_client

    # ---- subclass hook ----------------------------------------------------

    async def on_event(self, stream: str, envelope: EventEnvelope) -> None:
        raise NotImplementedError

    async def on_error(self, stream: str, raw: dict, exc: Exception) -> None:
        logger.exception("Consumer %s failed on %s: %s", self.GROUP, stream, exc)

    # ---- lifecycle --------------------------------------------------------

    async def ensure_group(self) -> None:
        client = self._client()
        for stream in self.STREAMS:
            try:
                await client.xgroup_create(stream, self.GROUP, id="$", mkstream=True)
            except Exception as exc:  # noqa: BLE001
                # BUSYGROUP means the group already exists — that's the desired state
                if "BUSYGROUP" not in str(exc):
                    logger.debug("xgroup_create on %s/%s: %s", stream, self.GROUP, exc)

    async def stop(self) -> None:
        self._stopped.set()

    async def run(self) -> None:
        await self.ensure_group()
        client = self._client()
        logger.info(
            "Consumer %s/%s started on streams %s",
            self.GROUP, self.consumer_name, list(self.STREAMS),
        )

        while not self._stopped.is_set():
            # 1) Reclaim any stuck messages first
            await self._reclaim(client)

            # 2) Read new messages
            try:
                streams = {s: ">" for s in self.STREAMS}
                resp = await client.xreadgroup(
                    self.GROUP,
                    self.consumer_name,
                    streams,
                    count=self.COUNT,
                    block=self.BLOCK_MS,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("xreadgroup failed: %s", exc)
                await asyncio.sleep(1.0)
                continue

            if not resp:
                continue

            for stream, msgs in resp:
                for msg_id, fields in msgs:
                    await self._dispatch(client, stream, msg_id, fields)

    async def _dispatch(self, client, stream: str, msg_id: str, fields: dict) -> None:
        try:
            envelope = EventEnvelope.from_redis(fields)
        except Exception as exc:  # noqa: BLE001
            await self.on_error(stream, fields, exc)
            await self._send_to_dlq(client, stream, msg_id, fields, exc)
            await client.xack(stream, self.GROUP, msg_id)
            return

        try:
            await self.on_event(stream, envelope)
            await client.xack(stream, self.GROUP, msg_id)
        except Exception as exc:  # noqa: BLE001
            await self.on_error(stream, fields, exc)
            # let pending logic / reclaim handle the retry; eventually DLQ

    async def _reclaim(self, client) -> None:
        for stream in self.STREAMS:
            try:
                start = "0-0"
                while True:
                    next_start, claimed, _ = await client.xautoclaim(
                        stream, self.GROUP, self.consumer_name,
                        min_idle_time=self.STALE_AFTER_MS,
                        start_id=start,
                        count=self.COUNT,
                    )
                    if not claimed:
                        break
                    for msg_id, fields in claimed:
                        # Check delivery count via XPENDING-style protocol
                        await self._handle_reclaimed(client, stream, msg_id, fields)
                    if next_start in ("0-0", b"0-0"):
                        break
                    start = next_start
            except Exception as exc:  # noqa: BLE001
                logger.debug("xautoclaim on %s failed: %s", stream, exc)

    async def _handle_reclaimed(self, client, stream: str, msg_id: str, fields: dict) -> None:
        # pending count check
        try:
            pending = await client.xpending_range(
                stream, self.GROUP, min=msg_id, max=msg_id, count=1,
            )
        except Exception:  # noqa: BLE001
            pending = []
        delivery_count = pending[0]["times_delivered"] if pending else 1
        if delivery_count > self.MAX_REDELIVERIES:
            await self._send_to_dlq(
                client, stream, msg_id, fields,
                Exception(f"max redeliveries exceeded ({delivery_count})"),
            )
            await client.xack(stream, self.GROUP, msg_id)
            return
        await self._dispatch(client, stream, msg_id, fields)

    async def _send_to_dlq(
        self,
        client,
        stream: str,
        msg_id: str,
        fields: dict,
        exc: Exception,
    ) -> None:
        try:
            payload = {
                "data": fields.get("data", ""),
                "original_stream": stream,
                "original_id": msg_id,
                "error": str(exc)[:1000],
            }
            await client.xadd(DLQ, payload, maxlen=10_000, approximate=True)
        except Exception as e2:  # noqa: BLE001
            logger.error("Failed to write to DLQ: %s", e2)
