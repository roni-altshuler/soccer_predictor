"""Per-client token-bucket rate limiting.

Stdlib-only (no slowapi/redis dependency) — buckets live in process
memory, which is sufficient for the single-instance FastAPI deployment.
Configure via RATE_LIMIT_PER_MINUTE (0 disables, e.g. for tests/CI).
"""

import os
import time
from typing import Callable, Dict, Tuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

DEFAULT_LIMIT_PER_MINUTE = 120
EXEMPT_PATHS = ("/api/health", "/docs", "/redoc", "/openapi.json")

# Drop buckets idle for this long so the dict can't grow unbounded.
_STALE_AFTER_SECONDS = 300.0
_PRUNE_EVERY_SECONDS = 60.0


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token bucket per client IP: `limit` requests/minute with burst up to `limit`."""

    def __init__(self, app, limit_per_minute: int | None = None) -> None:
        super().__init__(app)
        if limit_per_minute is None:
            limit_per_minute = int(os.getenv("RATE_LIMIT_PER_MINUTE", str(DEFAULT_LIMIT_PER_MINUTE)))
        self.limit = max(0, limit_per_minute)
        self.refill_per_second = self.limit / 60.0
        # ip -> (tokens, last_refill_monotonic)
        self._buckets: Dict[str, Tuple[float, float]] = {}
        self._last_prune = time.monotonic()

    def _take_token(self, client_ip: str) -> bool:
        now = time.monotonic()
        tokens, last = self._buckets.get(client_ip, (float(self.limit), now))
        tokens = min(float(self.limit), tokens + (now - last) * self.refill_per_second)
        allowed = tokens >= 1.0
        if allowed:
            tokens -= 1.0
        self._buckets[client_ip] = (tokens, now)

        if now - self._last_prune > _PRUNE_EVERY_SECONDS:
            self._last_prune = now
            stale = [ip for ip, (_, seen) in self._buckets.items() if now - seen > _STALE_AFTER_SECONDS]
            for ip in stale:
                del self._buckets[ip]
        return allowed

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if self.limit == 0 or request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        if not self._take_token(client_ip):
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Try again shortly."},
                headers={"Retry-After": "10"},
            )
        return await call_next(request)
