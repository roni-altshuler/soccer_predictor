"""FastAPI WebSocket gateway.

Deployed as a separate service from the main API so connection load can't
degrade REST traffic. In dev, run with::

    uvicorn backend.pipeline.gateway.app:app --port 8001 --reload

In Docker (see ``backend/pipeline/Dockerfile.gateway``) it's:

    uvicorn backend.pipeline.gateway.app:app --host 0.0.0.0 --port $GATEWAY_PORT

Endpoints:

* ``GET /ws/match/{match_id}``        — subscribe to one match's live events
* ``GET /ws/competition/{comp_id}``   — subscribe to all live matches in a comp
* ``GET /ws/user/{user_id}``          — auth required, user prediction outcomes
* ``GET /health``                     — liveness probe
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from backend.pipeline.gateway.auth import ANONYMOUS, AuthPrincipal, verify_token
from backend.pipeline.gateway.fanout import ConnectionRegistry, ManagedConnection, RedisFanout
from backend.pipeline.gateway.protocol import (
    AuthMessage, ErrorMessage, PingMessage, PongMessage,
    SnapshotMessage, SubscribeMessage, UnsubscribeMessage,
    channel_for_competition, channel_for_match, channel_for_user,
    is_user_channel, parse_client_message,
)
from backend.pipeline.settings import get_pipeline_settings

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_pipeline_settings()
    registry = ConnectionRegistry(queue_size=settings.ws_queue_size)
    fanout: Optional[RedisFanout] = None
    if settings.redis_url:
        fanout = RedisFanout(settings.redis_url, registry)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if fanout is not None:
            await fanout.start()
        try:
            yield
        finally:
            if fanout is not None:
                await fanout.stop()

    app = FastAPI(title="Pitchverse Gateway", lifespan=lifespan)
    app.state.registry = registry
    app.state.fanout = fanout

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "service": "gateway",
            "redis_configured": bool(settings.redis_url),
            "connections": len(registry._connections),  # noqa: SLF001
        }

    @app.get("/health/quotas")
    async def health_quotas():
        from backend.pipeline.quotas import report
        return report()

    @app.websocket("/ws/match/{match_id}")
    async def ws_match(websocket: WebSocket, match_id: str) -> None:
        await _ws_loop(websocket, registry, [channel_for_match(match_id)], require_auth=False)

    @app.websocket("/ws/competition/{competition_id}")
    async def ws_competition(websocket: WebSocket, competition_id: str) -> None:
        await _ws_loop(websocket, registry, [channel_for_competition(competition_id)], require_auth=False)

    @app.websocket("/ws/user/{user_id}")
    async def ws_user(websocket: WebSocket, user_id: str) -> None:
        await _ws_loop(
            websocket, registry,
            [channel_for_user(user_id)],
            require_auth=True,
            expected_user_id=user_id,
        )

    return app


async def _ws_loop(
    websocket: WebSocket,
    registry: ConnectionRegistry,
    auto_subscribe_channels: list[str],
    *,
    require_auth: bool,
    expected_user_id: Optional[str] = None,
) -> None:
    settings = get_pipeline_settings()
    await websocket.accept()
    client_id = uuid.uuid4().hex
    queue = registry.make_queue()
    principal: AuthPrincipal = ANONYMOUS
    conn: Optional[ManagedConnection] = None
    sender_task: Optional[asyncio.Task] = None

    try:
        # 1) Optional auth handshake (clients may skip auth for public channels)
        if require_auth:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
                msg = parse_client_message(raw)
            except (asyncio.TimeoutError, Exception) as exc:
                await _send_error(websocket, "auth_required", f"send auth: {exc}")
                return
            if not isinstance(msg, AuthMessage):
                await _send_error(websocket, "auth_required", "first message must be auth")
                return
            try:
                principal = verify_token(
                    msg.token, secret=settings.jwt_secret, algorithm=settings.jwt_algorithm,
                )
            except ValueError as exc:
                await _send_error(websocket, "auth_failed", str(exc))
                return
            if principal.is_anonymous:
                await _send_error(websocket, "auth_failed", "token required")
                return
            if expected_user_id and principal.user_id != expected_user_id:
                await _send_error(websocket, "forbidden", "user mismatch")
                return

        # 2) Register connection
        conn = ManagedConnection(client_id, websocket, principal, queue)
        await registry.register(conn)
        for ch in auto_subscribe_channels:
            await registry.subscribe(client_id, ch)
            # Send an empty snapshot so the client knows the channel is live
            await queue.put(SnapshotMessage(channel=ch, state={}).model_dump_json())

        # 3) Spin up the writer
        sender_task = asyncio.create_task(_drain_queue(websocket, queue))

        # 4) Receive loop
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            try:
                msg = parse_client_message(raw)
            except Exception as exc:  # noqa: BLE001
                await _send_error(websocket, "bad_message", str(exc))
                continue

            if isinstance(msg, PingMessage):
                await websocket.send_text(PongMessage().model_dump_json())
            elif isinstance(msg, SubscribeMessage):
                if is_user_channel(msg.channel) and (principal.is_anonymous or msg.channel != channel_for_user(principal.user_id or "")):
                    await _send_error(websocket, "forbidden", f"cannot subscribe to {msg.channel}")
                    continue
                await registry.subscribe(client_id, msg.channel)
                await websocket.send_text(SnapshotMessage(channel=msg.channel, state={}).model_dump_json())
            elif isinstance(msg, UnsubscribeMessage):
                await registry.unsubscribe(client_id, msg.channel)
            elif isinstance(msg, AuthMessage):
                # auth re-handshake on public channels — allow upgrading principal
                try:
                    new_principal = verify_token(
                        msg.token, secret=settings.jwt_secret, algorithm=settings.jwt_algorithm,
                    )
                except ValueError as exc:
                    await _send_error(websocket, "auth_failed", str(exc))
                    continue
                principal = new_principal
                if conn is not None:
                    conn.principal = principal

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.exception("Gateway loop crashed: %s", exc)
    finally:
        if sender_task is not None:
            sender_task.cancel()
            try:
                await sender_task
            except (asyncio.CancelledError, Exception):
                pass
        await registry.unregister(client_id)


async def _drain_queue(websocket: WebSocket, queue: asyncio.Queue) -> None:
    while True:
        try:
            text = await queue.get()
        except asyncio.CancelledError:
            return
        try:
            await websocket.send_text(text)
        except Exception:  # noqa: BLE001
            return


async def _send_error(websocket: WebSocket, code: str, message: str) -> None:
    try:
        await websocket.send_text(ErrorMessage(code=code, message=message).model_dump_json())
        await websocket.close()
    except Exception:  # noqa: BLE001
        pass


# Default ASGI app, used by uvicorn.
app = create_app()
