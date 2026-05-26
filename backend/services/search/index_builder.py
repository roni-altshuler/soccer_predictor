"""Build and query a lightweight global search index.

The index is built from cached data only — no network calls — so it is safe
to (re)build on cold start or via a background cron. Documents are stored on
disk at ``backend/data/search_index.json`` so subsequent boots can skip the
scan when the file is < 24h old.

Scoring is intentionally simple:
    * exact (case-insensitive) name match            -> 1.00
    * name starts with the query                     -> 0.90
    * any token in the name starts with the query    -> 0.75
    * substring match anywhere in the name           -> 0.55
    * substring match in the subtitle (league hint)  -> 0.35

A small length penalty (shorter names are usually less ambiguous and the
ones the user is more likely to want) is applied as ``+ 0.05 / len(name)``.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
HISTORICAL_DATA_DIR = _BACKEND_DIR / "data" / "historical"
INDEX_FILE = _BACKEND_DIR / "data" / "search_index.json"

# Stale-after window for the on-disk index.
INDEX_STALE_AFTER_SECONDS = 24 * 60 * 60


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_TOKEN_SPLIT = re.compile(r"[\s\-_/.,()\[\]'\"]+")


def _slugify(value: str) -> str:
    """Stable slug: lowercase + replace any non-alphanum run with '-'."""
    if not value:
        return ""
    slug = _SLUG_NON_ALNUM.sub("-", value.lower()).strip("-")
    return slug


def _tokenize(value: str) -> List[str]:
    """Split a string into lowercase tokens for prefix matching."""
    if not value:
        return []
    return [t for t in _TOKEN_SPLIT.split(value.lower()) if t]


def _humanize_league(key: str) -> str:
    """Map an internal league key (``premier_league``) to a display name."""
    overrides = {
        "premier_league": "Premier League",
        "la_liga": "La Liga",
        "bundesliga": "Bundesliga",
        "serie_a": "Serie A",
        "ligue_1": "Ligue 1",
        "eredivisie": "Eredivisie",
        "primeira_liga": "Primeira Liga",
        "mls": "MLS",
        "champions_league": "Champions League",
        "europa_league": "Europa League",
        "world_cup": "World Cup",
        "euro": "UEFA Euro",
        "copa_america": "Copa America",
    }
    if key in overrides:
        return overrides[key]
    return " ".join(part.capitalize() for part in key.split("_"))


# ---------------------------------------------------------------------------
# SearchIndex
# ---------------------------------------------------------------------------


class SearchIndex:
    """In-memory search index over teams, leagues and recent matches."""

    def __init__(self) -> None:
        self.documents: List[Dict[str, Any]] = []
        self.generated_at: Optional[str] = None
        self.stats: Dict[str, int] = {"teams": 0, "leagues": 0, "matches": 0, "players": 0}

    # --- Public API ------------------------------------------------------

    def build_from_caches(self) -> None:
        """Scan local caches and (re)build the index.

        Never hits the network. Safe to call on cold start.
        """
        documents: List[Dict[str, Any]] = []

        # Leagues -----------------------------------------------------
        league_docs = list(self._index_leagues())
        documents.extend(league_docs)

        # Teams -------------------------------------------------------
        team_docs = list(self._index_teams_from_historical())
        documents.extend(team_docs)

        # Matches (best-effort; skip if unavailable) -----------------
        match_docs = list(self._index_recent_matches())
        documents.extend(match_docs)

        self.documents = documents
        self.stats = {
            "teams": len(team_docs),
            "leagues": len(league_docs),
            "matches": len(match_docs),
            "players": 0,
        }
        self.generated_at = datetime.now(timezone.utc).isoformat()

        self._persist()

    def search(
        self,
        query: str,
        kinds: Optional[List[str]] = None,
        limit: int = 8,
    ) -> List[Dict[str, Any]]:
        """Run a substring + prefix search over the index."""
        if not query:
            return []

        q = query.strip().lower()
        if not q:
            return []

        allowed_kinds = set(kinds) if kinds else None

        scored: List[Dict[str, Any]] = []
        for doc in self.documents:
            if allowed_kinds and doc.get("kind") not in allowed_kinds:
                continue
            score = self._score(q, doc)
            if score <= 0:
                continue
            hit = {
                "kind": doc["kind"],
                "id": doc["id"],
                "name": doc["name"],
                "subtitle": doc.get("subtitle", ""),
                "href": doc.get("href", ""),
                "score": round(score, 4),
            }
            scored.append(hit)

        scored.sort(key=lambda h: (-h["score"], len(h["name"]), h["name"].lower()))
        return scored[: max(1, int(limit))]

    # --- Persistence -----------------------------------------------------

    def _persist(self) -> None:
        try:
            INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "generated_at": self.generated_at,
                "stats": self.stats,
                "documents": self.documents,
            }
            INDEX_FILE.write_text(json.dumps(payload, ensure_ascii=False))
        except Exception as exc:  # pragma: no cover - disk failures
            logger.warning("Failed to persist search index: %s", exc)

    def load_from_disk(self) -> bool:
        """Load a previously persisted index. Returns True on success."""
        if not INDEX_FILE.exists():
            return False
        try:
            payload = json.loads(INDEX_FILE.read_text())
            self.documents = list(payload.get("documents", []))
            self.generated_at = payload.get("generated_at")
            self.stats = payload.get(
                "stats",
                {"teams": 0, "leagues": 0, "matches": 0, "players": 0},
            )
            return True
        except Exception as exc:
            logger.warning("Failed to load search index from disk: %s", exc)
            return False

    @staticmethod
    def index_age_seconds() -> Optional[float]:
        """Age of the on-disk index file in seconds, or ``None`` if missing."""
        try:
            return time.time() - INDEX_FILE.stat().st_mtime
        except FileNotFoundError:
            return None

    # --- Index builders --------------------------------------------------

    def _index_leagues(self) -> Iterable[Dict[str, Any]]:
        """Yield one document per known league (from ``ESPN_LEAGUES``)."""
        try:
            from backend.services.prediction.historical_data import ESPN_LEAGUES
        except Exception as exc:
            logger.warning("Could not import ESPN_LEAGUES: %s", exc)
            return

        for key, espn_id in ESPN_LEAGUES.items():
            display = _humanize_league(key)
            yield {
                "kind": "league",
                "id": key,
                "name": display,
                "subtitle": f"League · {espn_id}",
                "href": f"/leagues/{key}",
                "tokens": _tokenize(display) + _tokenize(key),
            }

    def _index_teams_from_historical(self) -> Iterable[Dict[str, Any]]:
        """Yield one document per unique team across historical match files."""
        if not HISTORICAL_DATA_DIR.exists():
            return

        # team_slug -> {"name": ..., "league": ..., "last_seen": int}
        teams: Dict[str, Dict[str, Any]] = {}

        for path in sorted(HISTORICAL_DATA_DIR.glob("*.json")):
            try:
                payload = json.loads(path.read_text())
            except Exception as exc:
                logger.debug("Skipping unreadable historical file %s: %s", path.name, exc)
                continue

            league_key = payload.get("league") or ""
            # Best-effort season-as-int for "most recent" tracking.
            season_raw = payload.get("season") or ""
            try:
                season_year = int(str(season_raw).split("/")[0])
            except (TypeError, ValueError):
                season_year = 0

            for match in payload.get("matches", []) or []:
                for team_key in ("home_team", "away_team"):
                    name = (match.get(team_key) or "").strip()
                    if not name:
                        continue
                    slug = _slugify(name)
                    if not slug:
                        continue
                    existing = teams.get(slug)
                    if existing is None or season_year > existing["last_seen"]:
                        teams[slug] = {
                            "name": name,
                            "league": league_key,
                            "last_seen": season_year,
                        }

        for slug, info in teams.items():
            league_display = (
                _humanize_league(info["league"]) if info.get("league") else ""
            )
            subtitle = (
                f"Team · {league_display}" if league_display else "Team"
            )
            yield {
                "kind": "team",
                "id": slug,
                "name": info["name"],
                "subtitle": subtitle,
                "href": f"/teams/{slug}",
                "tokens": _tokenize(info["name"]),
            }

    def _index_recent_matches(self) -> Iterable[Dict[str, Any]]:
        """Best-effort: include recent/upcoming fixtures from cached scoreboards.

        The constraint says **do not hit the network**. The ESPN client has a
        disk cache, but we don't have a stable known location here. We
        instead pick the most recent historical season per league and surface
        a handful of recent fixtures (last 14 days + next 14 days) — if the
        cache happens to contain them. Otherwise we yield nothing rather than
        risk a slow/expensive scan.
        """
        if not HISTORICAL_DATA_DIR.exists():
            return

        from datetime import timedelta

        now = datetime.now(timezone.utc)
        window_start = now - timedelta(days=14)
        window_end = now + timedelta(days=14)

        seen_ids: set[str] = set()

        for path in sorted(HISTORICAL_DATA_DIR.glob("*.json"), reverse=True):
            try:
                payload = json.loads(path.read_text())
            except Exception:
                continue
            for match in payload.get("matches", []) or []:
                match_id = str(match.get("match_id") or "")
                if not match_id or match_id in seen_ids:
                    continue
                date_raw = match.get("date") or ""
                try:
                    dt = datetime.fromisoformat(date_raw.replace("Z", "+00:00"))
                except (TypeError, ValueError):
                    continue
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt < window_start or dt > window_end:
                    continue
                home = match.get("home_team") or ""
                away = match.get("away_team") or ""
                if not home or not away:
                    continue
                name = f"{home} vs {away}"
                league_display = _humanize_league(match.get("league") or payload.get("league") or "")
                subtitle = f"Match · {dt.strftime('%Y-%m-%d')} · {league_display}".rstrip(" ·")
                seen_ids.add(match_id)
                yield {
                    "kind": "match",
                    "id": match_id,
                    "name": name,
                    "subtitle": subtitle,
                    "href": f"/matches/{match_id}",
                    "tokens": _tokenize(name),
                }

    # --- Scoring ---------------------------------------------------------

    @staticmethod
    def _score(query: str, doc: Dict[str, Any]) -> float:
        name = (doc.get("name") or "").lower()
        if not name:
            return 0.0

        score = 0.0
        if name == query:
            score = 1.0
        elif name.startswith(query):
            score = 0.9
        else:
            tokens = doc.get("tokens") or _tokenize(name)
            if any(tok.startswith(query) for tok in tokens):
                score = 0.75
            elif query in name:
                score = 0.55
            else:
                subtitle = (doc.get("subtitle") or "").lower()
                if query in subtitle:
                    score = 0.35

        if score <= 0:
            return 0.0

        # Small boost for shorter names — they tend to be less ambiguous and
        # better aligned with what a user typing a short query intends.
        score += 0.05 / max(len(name), 1)
        return score


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

_index: Optional[SearchIndex] = None


def get_search_index(force_reload: bool = False) -> SearchIndex:
    """Return the process-wide :class:`SearchIndex` instance.

    Loads from disk if present and fresh; otherwise rebuilds from caches.
    """
    global _index

    if _index is None or force_reload:
        _index = SearchIndex()
        age = SearchIndex.index_age_seconds()
        if (
            not force_reload
            and age is not None
            and age < INDEX_STALE_AFTER_SECONDS
            and _index.load_from_disk()
        ):
            return _index
        try:
            _index.build_from_caches()
        except Exception as exc:
            logger.warning("Search index build failed: %s", exc)
            # Try to fall back to whatever is on disk.
            _index.load_from_disk()
    return _index
