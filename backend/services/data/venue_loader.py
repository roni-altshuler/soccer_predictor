"""Static venue coordinates → `teams.venue_lat` / `venue_lon`.

Why a committed file instead of a geocoding API
-----------------------------------------------
`teams.venue_lat` and `venue_lon` were NULL for all 692 teams, which meant
two features could never be computed at all:

* `away_travel_km` was a hardcoded 0.0 on every row of the corpus.
* The Open-Meteo loader selects matches by joining `teams` on lat/lon, so
  its query matched nothing and the `weather` table stayed at 0 rows —
  which in turn left five weather features pinned to their defaults
  (15.0 °C, 0.0 mm, …) for every training example.

Coordinates for a few hundred stadiums are static facts that change maybe
once a decade. Resolving them from a live geocoder on every build would
make the warehouse non-reproducible, need network access in CI, and put a
third-party rate limit on the critical path. So they are resolved once,
committed to `backend/data/venues.yml` with the OSM record each came from,
and read offline from then on.

Provenance rule: an entry whose coordinates could not be established is
written with `lat: null` / `lon: null` and stays NULL in the warehouse.
A club with no venue simply gets no weather and no travel distance —
never a guessed city centre.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from backend.services.data.team_resolver import TeamResolver, _normalise
from backend.services.data.warehouse import Warehouse

logger = logging.getLogger(__name__)

VENUES_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "venues.yml"

EARTH_RADIUS_KM = 6371.0088


@dataclass
class LoadStats:
    entries: int = 0
    applied: int = 0
    unresolved: int = 0
    team_not_found: int = 0
    missing: List[str] = field(default_factory=list)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km. Used for `away_travel_km`."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _load_yaml(path: Path = VENUES_FILE) -> List[Dict]:
    if not path.exists():
        logger.warning("No venue table at %s; venue coordinates stay NULL", path)
        return []
    try:
        import yaml
    except ImportError:
        logger.warning("PyYAML not installed; skipping %s", path)
        return []
    try:
        data = yaml.safe_load(path.read_text()) or {}
    except Exception as exc:
        logger.warning("Failed to parse %s: %s", path, exc)
        return []
    entries = data.get("venues") if isinstance(data, dict) else None
    return entries if isinstance(entries, list) else []


def _coerce_coord(value) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _plausible(lat: Optional[float], lon: Optional[float]) -> bool:
    if lat is None or lon is None:
        return False
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return False
    # Null Island is what a failed geocode looks like, never a stadium.
    return not (abs(lat) < 0.01 and abs(lon) < 0.01)


def load_venues(
    warehouse: Warehouse,
    *,
    path: Path = VENUES_FILE,
    gender: str = "M",
) -> LoadStats:
    """Apply the committed venue table to `teams`.

    Teams are matched through the alias resolver, so a venue entry keyed on
    the canonical name still lands correctly if the warehouse happens to
    hold a different spelling. Teams absent from the warehouse are counted
    and skipped — the table is allowed to describe clubs a partial build
    has not ingested yet.
    """
    stats = LoadStats()
    entries = _load_yaml(path)
    stats.entries = len(entries)
    if not entries:
        return stats

    resolver = TeamResolver(warehouse, gender_default=gender)

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        team_name = entry.get("team")
        if not team_name:
            continue
        entry_gender = entry.get("gender", gender)

        team_id = warehouse.find_team_id_by_alias(str(team_name), entry_gender)
        if team_id is None:
            # The warehouse may hold the club under a different spelling
            # than venues.yml uses; team_aliases.yml knows the mapping.
            # Look up the canonical the alias file pins this name to and
            # retry with that. `_yaml_overrides` is keyed on the resolver's
            # own normalisation, so use it rather than a bare lower().
            override = resolver._yaml_overrides.get(  # noqa: SLF001
                (_normalise(str(team_name)), entry_gender)
            )
            if override is not None:
                canonical, _country, spellings = override
                for spelling in (canonical, *spellings):
                    team_id = warehouse.find_team_id_by_alias(spelling, entry_gender)
                    if team_id is not None:
                        break
        if team_id is None:
            stats.team_not_found += 1
            stats.missing.append(str(team_name))
            continue

        lat = _coerce_coord(entry.get("lat"))
        lon = _coerce_coord(entry.get("lon"))
        if not _plausible(lat, lon):
            # Honest missingness — do not write a placeholder.
            stats.unresolved += 1
            continue

        warehouse.set_team_venue(
            team_id,
            venue_lat=lat,
            venue_lon=lon,
            venue_indoor=bool(entry.get("indoor", False)),
        )
        stats.applied += 1

    logger.info(
        "Venues: %d applied, %d unresolved, %d not in warehouse (of %d entries)",
        stats.applied, stats.unresolved, stats.team_not_found, stats.entries,
    )
    return stats


def venue_coverage(warehouse: Warehouse) -> Dict[str, Tuple[int, int]]:
    """competition_id → (teams with coordinates, teams total)."""
    with warehouse._lock:  # noqa: SLF001
        cur = warehouse._conn.execute(  # noqa: SLF001
            """
            SELECT m.competition_id,
                   COUNT(DISTINCT t.team_id) AS total,
                   COUNT(DISTINCT CASE WHEN t.venue_lat IS NOT NULL
                                       THEN t.team_id END) AS located
            FROM matches m
            JOIN teams t ON t.team_id = m.home_team_id
            GROUP BY m.competition_id
            ORDER BY m.competition_id
            """
        )
        return {r["competition_id"]: (r["located"], r["total"]) for r in cur.fetchall()}


def run(**kwargs) -> LoadStats:
    return load_venues(**kwargs)
