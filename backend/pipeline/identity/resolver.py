"""Canonical entity resolver.

When multiple sources (ESPN, FotMob, FBref, Understat, …) talk about the same
team / player / match, each gives it a different id. The pipeline writes a
single canonical row, and the ``core.entity_aliases`` table maps
``(source, source_id, kind) -> canonical_id``.

This module is the one place that knows how to:

1. **Look up** a canonical id given a source/source_id pair (resolve).
2. **Register** a new mapping (link).
3. **Fuzzy-match** a name against an existing canonical entity when no explicit
   mapping exists yet, returning a confidence score the caller can decide on.

Reads are cached in Redis (key ``alias:{kind}:{source}:{source_id}``, TTL 1h)
to keep the hot path off Postgres during live polling.

Implementation note: we deliberately keep ``canonical_id`` as a *string* in
the table, even for entities whose ids are numeric in `core.dim_*`. That lets
the same table cover teams (bigint id), competitions (text id), and matches
(text id) uniformly.
"""

from __future__ import annotations

import difflib
import logging
import threading
from dataclasses import dataclass
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class EntityKind(str, Enum):
    TEAM = "team"
    PLAYER = "player"
    MATCH = "match"
    COMPETITION = "competition"
    VENUE = "venue"
    REFEREE = "referee"


@dataclass(frozen=True)
class Resolution:
    canonical_id: str
    confidence: float       # 1.0 for explicit alias, 0.0–1.0 for fuzzy
    source: str
    source_id: str


class IdentityResolver:
    """Read+write surface for the ``core.entity_aliases`` table.

    Construct with a :class:`PgWarehouse` (sync) and optionally a cache. Each
    method is short and side-effect-clear; complex logic stays out.
    """

    def __init__(self, pg_warehouse, cache=None):
        self._pg = pg_warehouse
        self._cache = cache
        self._lock = threading.Lock()

    # ---- explicit mappings ------------------------------------------------

    def resolve(
        self,
        kind: EntityKind,
        source: str,
        source_id: str,
    ) -> Optional[Resolution]:
        """Return canonical id for ``(source, source_id)`` or None if unknown."""
        cache_key = f"alias:{kind.value}:{source}:{source_id}"
        if self._cache is not None:
            hit = self._cache.get(cache_key)
            if hit is not None:
                return Resolution(
                    canonical_id=str(hit["canonical_id"]),
                    confidence=float(hit["confidence"]),
                    source=source,
                    source_id=source_id,
                )

        with self._pg.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT canonical_id, confidence
                FROM core.entity_aliases
                WHERE kind = %s AND source = %s AND source_id = %s
                """,
                (kind.value, source, str(source_id)),
            )
            row = cur.fetchone()

        if not row:
            return None

        canonical_id, confidence = str(row[0]), float(row[1])
        if self._cache is not None:
            self._cache.set(
                cache_key,
                {"canonical_id": canonical_id, "confidence": confidence},
                ttl_sec=3600,
            )
        return Resolution(
            canonical_id=canonical_id,
            confidence=confidence,
            source=source,
            source_id=str(source_id),
        )

    def link(
        self,
        kind: EntityKind,
        source: str,
        source_id: str,
        canonical_id: str,
        *,
        confidence: float = 1.0,
    ) -> None:
        """Insert or update a (source, source_id) → canonical mapping."""
        with self._pg.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.entity_aliases (kind, source, source_id, canonical_id, confidence)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (kind, source, source_id) DO UPDATE SET
                    canonical_id = EXCLUDED.canonical_id,
                    confidence = GREATEST(EXCLUDED.confidence, core.entity_aliases.confidence)
                """,
                (kind.value, source, str(source_id), str(canonical_id), confidence),
            )
            conn.commit()
        # Invalidate cache
        if self._cache is not None:
            self._cache.delete(f"alias:{kind.value}:{source}:{source_id}")

    def aliases_of(self, kind: EntityKind, canonical_id: str) -> list[Resolution]:
        """List every (source, source_id) that maps to this canonical entity."""
        with self._pg.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT source, source_id, confidence
                FROM core.entity_aliases
                WHERE kind = %s AND canonical_id = %s
                """,
                (kind.value, str(canonical_id)),
            )
            return [
                Resolution(
                    canonical_id=str(canonical_id),
                    confidence=float(c),
                    source=s,
                    source_id=sid,
                )
                for s, sid, c in cur.fetchall()
            ]

    # ---- fuzzy fallback ---------------------------------------------------

    def fuzzy_team(
        self,
        name: str,
        gender: str,
        *,
        threshold: float = 0.85,
        limit: int = 5,
    ) -> Optional[Resolution]:
        """Best-effort fuzzy match against existing teams.

        Returns the highest-confidence hit ≥ ``threshold``, or None.
        Confidence is the python ``difflib.SequenceMatcher`` ratio.
        Callers should review low-confidence hits before linking them.
        """
        name_clean = name.strip().lower()
        if not name_clean:
            return None

        with self._pg.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT team_id, canonical_name FROM core.dim_teams
                WHERE gender = %s
                ORDER BY canonical_name
                """,
                (gender,),
            )
            rows = cur.fetchall()

        best_id: Optional[str] = None
        best_score = 0.0
        for team_id, canonical_name in rows:
            score = difflib.SequenceMatcher(None, name_clean, canonical_name.lower()).ratio()
            if score > best_score:
                best_score = score
                best_id = str(team_id)
                if best_score >= 0.99:
                    break
        if best_id and best_score >= threshold:
            return Resolution(
                canonical_id=best_id, confidence=best_score, source="fuzzy", source_id=name,
            )
        return None


# ---------------------------------------------------------------------------
# module-level accessor
# ---------------------------------------------------------------------------

_singleton: Optional[IdentityResolver] = None
_singleton_lock = threading.Lock()


def get_identity_resolver() -> Optional[IdentityResolver]:
    """Return a process-wide resolver if Postgres is configured, else None."""
    global _singleton
    from backend.pipeline.cache import get_cache
    from backend.pipeline.pg.warehouse import get_pg_warehouse

    pg = get_pg_warehouse()
    if pg is None:
        return None
    with _singleton_lock:
        if _singleton is None or _singleton._pg is not pg:
            _singleton = IdentityResolver(pg, cache=get_cache())
        return _singleton


def reset_resolver_singleton_for_tests() -> None:
    global _singleton
    _singleton = None
