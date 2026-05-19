"""Global omni-search endpoint.

Lazy-loads the on-disk :class:`SearchIndex` on first request, refreshing it
if the persisted file is older than 24 hours. Per-query responses are cached
in-process for 60 seconds to absorb keystroke bursts from the navbar.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Query

from backend.services.search import SearchIndex, get_search_index
from backend.services.search.index_builder import INDEX_STALE_AFTER_SECONDS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])

# In-process per-query response cache: key -> (expires_at, payload)
_RESPONSE_CACHE: Dict[Tuple[str, str, int], Tuple[float, Dict[str, Any]]] = {}
_RESPONSE_TTL_SECONDS = 60.0


def _ensure_fresh_index() -> Optional[SearchIndex]:
    """Return a usable index, refreshing it if the disk copy is stale.

    Returns ``None`` if the index could not be loaded or built. Callers
    should fail gracefully (empty results) rather than raise.
    """
    try:
        index = get_search_index()
    except Exception as exc:
        logger.warning("Failed to obtain search index: %s", exc)
        return None

    try:
        age = SearchIndex.index_age_seconds()
        if age is None or age > INDEX_STALE_AFTER_SECONDS:
            index = get_search_index(force_reload=True)
    except Exception as exc:
        logger.warning("Search index refresh failed: %s", exc)

    return index


@router.get("")
@router.get("/")
async def search(
    q: str = Query("", description="Search query"),
    kinds: str = Query(
        "",
        description="Comma-separated list of kinds: teams,leagues,matches,players",
    ),
    limit: int = Query(8, ge=1, le=25),
) -> Dict[str, Any]:
    """Run a global search across teams, leagues and (when available) matches."""
    query = (q or "").strip()
    kind_filter_raw = (kinds or "").strip()
    kind_list: Optional[List[str]] = None
    if kind_filter_raw:
        # Accept singular or plural forms.
        mapping = {
            "team": "team",
            "teams": "team",
            "league": "league",
            "leagues": "league",
            "match": "match",
            "matches": "match",
            "player": "player",
            "players": "player",
        }
        kind_list = []
        for part in kind_filter_raw.split(","):
            key = part.strip().lower()
            if not key:
                continue
            mapped = mapping.get(key)
            if mapped and mapped not in kind_list:
                kind_list.append(mapped)

    cache_key = (query.lower(), ",".join(kind_list or []), int(limit))
    now = time.time()
    cached = _RESPONSE_CACHE.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    # Drop expired entries opportunistically.
    if len(_RESPONSE_CACHE) > 256:
        for key, (expires_at, _) in list(_RESPONSE_CACHE.items()):
            if expires_at <= now:
                _RESPONSE_CACHE.pop(key, None)

    results: List[Dict[str, Any]] = []
    index = _ensure_fresh_index()
    if index is not None and query:
        try:
            results = index.search(query, kinds=kind_list, limit=limit)
        except Exception as exc:
            logger.warning("Search execution failed for %r: %s", query, exc)
            results = []

    payload: Dict[str, Any] = {
        "query": query,
        "results": results,
        "total": len(results),
        "generated_at": (
            index.generated_at
            if index is not None
            else datetime.now(timezone.utc).isoformat()
        ),
    }
    _RESPONSE_CACHE[cache_key] = (now + _RESPONSE_TTL_SECONDS, payload)
    return payload
