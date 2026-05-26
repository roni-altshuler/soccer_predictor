"""Pipeline-specific settings, kept separate from ``backend.config.Settings``.

We don't extend the existing settings class so that the legacy app keeps booting
without any new env vars set. The pipeline only reads its own env, and every
flag defaults to "off / legacy behavior".
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class PipelineSettings:
    # --- Phase 1: Postgres -------------------------------------------------
    # ``postgresql://user:pass@host:5432/db`` — None means "no Postgres"
    # (the dual-write hook becomes a no-op).
    database_url: Optional[str]
    dual_write_enabled: bool

    # ``pg`` switches read paths from SQLite to Postgres; ``sqlite`` (default)
    # keeps the legacy code path.
    read_from: str

    # --- Phase 2: Redis ----------------------------------------------------
    redis_url: Optional[str]
    redis_cache_default_ttl_sec: int
    redis_live_ttl_sec: int

    # --- Phase 3: Streams --------------------------------------------------
    publish_live_events: bool
    stream_maxlen: int             # XADD MAXLEN ~ trimming
    consumer_group: str            # default consumer group name for workers
    consumer_block_ms: int

    # --- Phase 4: Gateway --------------------------------------------------
    gateway_port: int
    jwt_secret: Optional[str]
    jwt_algorithm: str
    ws_heartbeat_sec: int
    ws_queue_size: int

    # --- Phase 6: Archive --------------------------------------------------
    r2_endpoint_url: Optional[str]
    r2_access_key_id: Optional[str]
    r2_secret_access_key: Optional[str]
    r2_bucket: Optional[str]

    # --- Phase 7: New sources ---------------------------------------------
    api_football_key: Optional[str]
    api_football_daily_budget: int


@lru_cache(maxsize=1)
def get_pipeline_settings() -> PipelineSettings:
    return PipelineSettings(
        database_url=os.getenv("DATABASE_URL"),
        dual_write_enabled=_env_bool("PIPELINE_DUAL_WRITE", default=False),
        read_from=os.getenv("PIPELINE_READ_FROM", "sqlite").strip().lower(),
        redis_url=os.getenv("REDIS_URL"),
        redis_cache_default_ttl_sec=_env_int("PIPELINE_CACHE_TTL_SEC", 300),
        redis_live_ttl_sec=_env_int("PIPELINE_LIVE_TTL_SEC", 5),
        publish_live_events=_env_bool("PIPELINE_PUBLISH_LIVE", default=False),
        stream_maxlen=_env_int("PIPELINE_STREAM_MAXLEN", 100_000),
        consumer_group=os.getenv("PIPELINE_CONSUMER_GROUP", "pipeline"),
        consumer_block_ms=_env_int("PIPELINE_CONSUMER_BLOCK_MS", 5_000),
        gateway_port=_env_int("GATEWAY_PORT", 8001),
        jwt_secret=os.getenv("JWT_SECRET"),
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        ws_heartbeat_sec=_env_int("WS_HEARTBEAT_SEC", 25),
        ws_queue_size=_env_int("WS_QUEUE_SIZE", 256),
        r2_endpoint_url=os.getenv("R2_ENDPOINT_URL"),
        r2_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
        r2_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
        r2_bucket=os.getenv("R2_BUCKET"),
        api_football_key=os.getenv("API_FOOTBALL_KEY"),
        api_football_daily_budget=_env_int("API_FOOTBALL_DAILY_BUDGET", 100),
    )


def reset_settings_cache_for_tests() -> None:
    """Clear the lru_cache so tests can flip env vars between cases."""
    get_pipeline_settings.cache_clear()
