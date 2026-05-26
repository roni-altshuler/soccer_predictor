"""Event-driven prediction recomputer.

Listens for events that materially change a match's state — goals scored,
lineups published, key player subbed off — and re-runs inference. The new
probabilities are:

1. Published to ``stream:predictions`` (durable, replayable)
2. Broadcast on ``ws:broadcast`` so the gateway can push to clients

Inference uses the existing ``backend/main.predict_match`` endpoint (via the
``EloPredictor`` runtime + neural strategy selection). We don't reimplement —
the recomputer is just a thin orchestrator.

Throttling
----------
Each match gets at most one recomputation per ``MIN_RECOMPUTE_INTERVAL_SEC``
seconds. When events arrive faster than that, intermediate events are
absorbed (the latest world-state is reflected on the next tick).
"""

from __future__ import annotations

import asyncio
import logging
import signal
from datetime import datetime, timezone
from typing import Optional

from backend.pipeline.gateway.fanout import RedisFanout
from backend.pipeline.gateway.protocol import channel_for_match
from backend.pipeline.settings import get_pipeline_settings
from backend.pipeline.streams import topics
from backend.pipeline.streams.consumer import StreamConsumer
from backend.pipeline.streams.envelope import EventEnvelope, EventType
from backend.pipeline.streams.producer import get_producer

logger = logging.getLogger(__name__)

# Events that warrant re-inference
TRIGGER_EVENTS = {
    EventType.MATCH_STARTED,
    EventType.MATCH_SCORE_CHANGED,
    EventType.MATCH_EVENT_ADDED,
    EventType.LINEUP_PUBLISHED,
    EventType.LINEUP_CONFIRMED,
    EventType.MATCH_PHASE_CHANGED,
}

MIN_RECOMPUTE_INTERVAL_SEC = 5.0


class PredictionRecomputer(StreamConsumer):
    STREAMS = (topics.LIVE_EVENTS,)
    GROUP = "prediction_recomputer"

    def __init__(self, url: str, *, async_client=None):
        super().__init__(url, async_client=async_client)
        self._last_recompute: dict[str, float] = {}
        self._inflight: dict[str, asyncio.Task] = {}

    async def on_event(self, stream: str, envelope: EventEnvelope) -> None:
        if envelope.event_type not in TRIGGER_EVENTS:
            return
        if not envelope.match_id:
            return
        match_id = envelope.match_id
        now = asyncio.get_event_loop().time()
        last = self._last_recompute.get(match_id, 0.0)
        if now - last < MIN_RECOMPUTE_INTERVAL_SEC:
            # absorbed — a later trigger will pick it up
            return
        self._last_recompute[match_id] = now

        # Cancel any in-flight prior task for this match (we want the latest)
        prior = self._inflight.get(match_id)
        if prior is not None and not prior.done():
            prior.cancel()
        self._inflight[match_id] = asyncio.create_task(
            self._recompute_and_publish(match_id, envelope),
        )

    async def _recompute_and_publish(self, match_id: str, envelope: EventEnvelope) -> None:
        try:
            probs, model_version = await asyncio.to_thread(_run_inference, envelope)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Inference failed for %s: %s", match_id, exc)
            return
        if probs is None:
            return

        # Publish to durable stream
        producer = get_producer()
        out_envelope = EventEnvelope(
            event_type=EventType.PREDICTION_UPDATED,
            source="prediction_recomputer",
            source_ts=datetime.now(timezone.utc),
            match_id=match_id,
            competition_id=envelope.competition_id,
            gender=envelope.gender,
            payload={
                "probabilities": probs,
                "model_version": model_version,
                "trigger_event_id": envelope.event_id,
                "trigger_event_type": envelope.event_type.value,
            },
        )
        if producer is not None:
            try:
                await producer.apublish(topics.PREDICTIONS, out_envelope)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to publish prediction: %s", exc)

        # Push to websocket gateway fan-out
        settings = get_pipeline_settings()
        if settings.redis_url:
            try:
                await RedisFanout.publish(
                    settings.redis_url,
                    channel_for_match(match_id),
                    {
                        "type": "prediction",
                        "channel": channel_for_match(match_id),
                        "probabilities": probs,
                        "model_version": model_version,
                    },
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to broadcast prediction: %s", exc)


def _run_inference(envelope: EventEnvelope) -> tuple[Optional[dict], Optional[str]]:
    """Invoke the existing prediction pipeline.

    Returns ``(probabilities, model_version)`` or ``(None, None)`` if no model is loaded.
    Runs in a thread because the existing code uses sync ELO/PyTorch.
    """
    payload = envelope.payload or {}
    home = payload.get("home_team_name")
    away = payload.get("away_team_name")
    league = payload.get("competition_id") or envelope.competition_id
    if not home or not away or not league:
        logger.debug("Recompute skipped: missing team names or league in payload")
        return None, None

    try:
        # Reuse the runtime ELO + neural strategy from the existing app.
        from backend.scripts.predict_upcoming import EloPredictor, _build_match_features
        elo = EloPredictor()
        elo_probs = elo.predict(home, away, league)
        elo_home_xg, elo_away_xg = elo.predict_goals(home, away, league)
    except Exception as exc:  # noqa: BLE001
        logger.debug("ELO predictor unavailable: %s", exc)
        return None, None

    probs = {
        "home_win": float(elo_probs["home_win"]),
        "draw": float(elo_probs["draw"]),
        "away_win": float(elo_probs["away_win"]),
    }

    # Try neural override
    try:
        from backend.services.prediction.neural_model import get_league_model_registry
        registry = get_league_model_registry()
        model = registry.get_model(league)
        if model.is_fitted:
            features = _build_match_features(
                elo, home, away, league, elo_probs, elo_home_xg, elo_away_xg,
                league_results=None, match_date=datetime.utcnow().isoformat(),
            )
            raw = model.predict_proba(features)[0]
            total = sum(float(p) for p in raw) or 1.0
            probs = {
                "home_win": float(raw[0]) / total,
                "draw": float(raw[1]) / total,
                "away_win": float(raw[2]) / total,
            }
            return probs, "neural_unified_v1"
    except Exception as exc:  # noqa: BLE001
        logger.debug("Neural recompute unavailable: %s", exc)

    return probs, "elo_poisson"


# ---------------------------------------------------------------------------

async def _main_async() -> int:
    settings = get_pipeline_settings()
    if not settings.redis_url:
        logger.error("REDIS_URL not set")
        return 1
    worker = PredictionRecomputer(settings.redis_url)
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.ensure_future(worker.stop()))
        except NotImplementedError:
            pass
    await worker.run()
    return 0


def main() -> int:  # pragma: no cover
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    return asyncio.run(_main_async())


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
