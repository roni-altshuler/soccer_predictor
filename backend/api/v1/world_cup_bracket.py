"""
World Cup knockout-bracket simulation endpoints.

Exposes the Monte Carlo bracket-path simulator at
`/api/v1/world-cup/bracket/paths` so the Next.js front end can fetch
live per-team reach probabilities (R16 -> Champion).

Results are cached in-process for 30 minutes per (n_simulations, seed)
tuple so repeated front-end fetches stay cheap.
"""

from __future__ import annotations

import threading
import time
from typing import Dict, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

from backend.services.simulation.bracket_paths import simulate_bracket

router = APIRouter(prefix="/world-cup/bracket", tags=["world-cup"])


_CACHE_TTL_SECONDS = 30 * 60  # 30 minutes
_cache: Dict[Tuple[str, int, Optional[int]], Tuple[float, Dict]] = {}
_cache_lock = threading.Lock()


def _cache_get(key: Tuple[str, int, Optional[int]]) -> Optional[Dict]:
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        ts, payload = entry
        if time.time() - ts > _CACHE_TTL_SECONDS:
            _cache.pop(key, None)
            return None
        return payload


def _cache_set(key: Tuple[str, int, Optional[int]], value: Dict) -> None:
    with _cache_lock:
        _cache[key] = (time.time(), value)


@router.get("/paths")
def world_cup_bracket_paths(
    n_simulations: int = Query(20_000, ge=500, le=200_000),
    seed: Optional[int] = Query(None),
    fresh: bool = Query(False, description="Bypass the 30-min in-process cache."),
) -> Dict:
    """Run the live knockout-bracket simulator and return per-team reach probabilities."""
    key = ("world_cup", n_simulations, seed)
    if not fresh:
        cached = _cache_get(key)
        if cached is not None:
            return cached

    try:
        result = simulate_bracket("world_cup", n_simulations=n_simulations, seed=seed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=f"Bracket simulation failed: {exc}")

    _cache_set(key, result)
    return result
