"""Free-tier quota reporting.

Cost-optimization rule 5 from the design doc: monitor every free tier and
alert at 80%. This module is the read side — it inspects whatever is reachable
and returns a JSON report. Wired into ``/health/quotas`` on the gateway.

Probes are best-effort. A probe that errors returns its status alongside the
error rather than crashing the whole endpoint.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def report() -> dict[str, Any]:
    """Return a dict suitable for ``/health/quotas``."""
    return {
        "api_football": _api_football_quota(),
        "postgres": _postgres_quota(),
        "redis": _redis_quota(),
        "r2": _r2_quota(),
    }


def _api_football_quota() -> dict[str, Any]:
    """Read the daily counter we maintain in ``core.pipeline_meta``."""
    try:
        from backend.pipeline.pg.warehouse import get_pg_warehouse
        from backend.pipeline.settings import get_pipeline_settings
        pg = get_pg_warehouse()
        s = get_pipeline_settings()
        if pg is None:
            return {"configured": bool(s.api_football_key), "status": "no_db"}
        with pg.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT value FROM core.pipeline_meta WHERE key = 'api_football.budget'")
            row = cur.fetchone()
        state = row[0] if row else None
        remaining = (state or {}).get("remaining") if state else s.api_football_daily_budget
        return {
            "configured": bool(s.api_football_key),
            "daily_budget": s.api_football_daily_budget,
            "remaining": remaining,
            "day": (state or {}).get("day"),
            "status": "ok",
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc)}


def _postgres_quota() -> dict[str, Any]:
    """Database size + connection count. Neon free tier caps at 0.5 GB."""
    try:
        from backend.pipeline.pg.warehouse import get_pg_warehouse
        pg = get_pg_warehouse()
        if pg is None:
            return {"configured": False, "status": "no_db"}
        with pg.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT pg_database_size(current_database())")
            size_bytes = int(cur.fetchone()[0])
            cur.execute("SELECT count(*) FROM pg_stat_activity")
            conns = int(cur.fetchone()[0])
        return {
            "configured": True,
            "size_bytes": size_bytes,
            "size_mb": round(size_bytes / 1_000_000, 2),
            "free_tier_cap_mb": 500,
            "fraction_of_free_tier": round(size_bytes / (500 * 1_000_000), 3),
            "active_connections": conns,
            "status": "ok",
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc)}


def _redis_quota() -> dict[str, Any]:
    """INFO memory + stream lengths."""
    try:
        from backend.pipeline.cache.redis_cache import RedisCache, NullCache, get_cache
        from backend.pipeline.streams import topics
        cache = get_cache()
        if isinstance(cache, NullCache):
            return {"configured": False, "status": "no_redis"}
        if not isinstance(cache, RedisCache):
            return {"status": "ok", "configured": True}
        client = cache._get_client()  # noqa: SLF001
        info = client.info("memory")
        used = int(info.get("used_memory", 0))
        used_human = info.get("used_memory_human", "?")
        stream_lengths = {}
        for s in topics.ALL_STREAMS:
            try:
                stream_lengths[s] = int(client.xlen(s))
            except Exception:  # noqa: BLE001
                stream_lengths[s] = None
        return {
            "configured": True,
            "used_memory_bytes": used,
            "used_memory_human": used_human,
            "stream_lengths": stream_lengths,
            "status": "ok",
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc)}


def _r2_quota() -> dict[str, Any]:
    """List the archive manifest as a proxy for R2 usage (avoids extra API calls)."""
    try:
        from backend.pipeline.pg.warehouse import get_pg_warehouse
        from backend.pipeline.settings import get_pipeline_settings
        s = get_pipeline_settings()
        if not (s.r2_endpoint_url and s.r2_bucket):
            return {"configured": False, "status": "no_r2"}
        pg = get_pg_warehouse()
        if pg is None:
            return {"configured": True, "status": "no_db"}
        with pg.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(SUM(bytes), 0), COUNT(*) FROM core.archive_manifest"
            )
            row = cur.fetchone()
        total_bytes, count = int(row[0]), int(row[1])
        return {
            "configured": True,
            "archived_objects": count,
            "archived_bytes": total_bytes,
            "archived_mb": round(total_bytes / 1_000_000, 2),
            "free_tier_cap_mb": 10_000,
            "fraction_of_free_tier": round(total_bytes / (10_000 * 1_000_000), 4),
            "status": "ok",
        }
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc)}
