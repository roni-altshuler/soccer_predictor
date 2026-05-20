"""Open-Meteo → warehouse weather loader.

Open-Meteo (open-meteo.com) is a free non-commercial weather API with no
key required, generous rate limits, and a historical-archive endpoint
that lets us pull conditions for any past date+location:

    GET https://archive-api.open-meteo.com/v1/archive
        ?latitude=51.55&longitude=-0.10
        &start_date=2018-08-12&end_date=2018-08-12
        &hourly=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,wind_direction_10m
        &timezone=UTC

For matches with a kickoff time and venue lat/lon, we pull the closest
hourly reading. Weather is then keyed by `match_id` and joined into the
feature vector at training time.

Coverage caveats
----------------
* We only fetch weather for matches where the home team's venue lat/lon
  is known (`teams.venue_lat` and `teams.venue_lon`). Use a separate
  venue-geocoding pass (Wikidata, manual) to enrich the `teams` table —
  out of scope here.
* Indoor stadiums (`teams.venue_indoor = 1`) skip weather entirely.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import httpx

from backend.services.data.warehouse import Warehouse

logger = logging.getLogger(__name__)

OPEN_METEO_BASE = "https://archive-api.open-meteo.com/v1/archive"
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cache" / "weather"


@dataclass
class LoadStats:
    matches_considered: int = 0
    weather_written: int = 0
    skipped_no_venue: int = 0
    skipped_indoor: int = 0
    skipped_existing: int = 0
    errors: int = 0


def _cache_key(lat: float, lon: float, date_str: str) -> str:
    return f"{round(lat, 3)}_{round(lon, 3)}_{date_str}"


def _read_cache(key: str) -> Optional[Dict]:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    if time.time() - path.stat().st_mtime > 86_400 * 30:  # 30-day TTL
        return None
    try:
        import json
        return json.loads(path.read_text())
    except Exception:
        return None


def _write_cache(key: str, payload: Dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        import json
        (CACHE_DIR / f"{key}.json").write_text(json.dumps(payload))
    except Exception as exc:
        logger.debug("Failed to cache weather %s: %s", key, exc)


async def _fetch_weather(
    client: httpx.AsyncClient,
    *,
    lat: float,
    lon: float,
    date_str: str,
) -> Optional[Dict]:
    key = _cache_key(lat, lon, date_str)
    cached = _read_cache(key)
    if cached is not None:
        return cached

    params = {
        "latitude": str(lat),
        "longitude": str(lon),
        "start_date": date_str,
        "end_date": date_str,
        "hourly": "temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,wind_direction_10m",
        "timezone": "UTC",
    }
    try:
        resp = await client.get(OPEN_METEO_BASE, params=params, timeout=15)
    except Exception as exc:
        logger.debug("Open-Meteo HTTP error %s/%s: %s", lat, lon, exc)
        return None
    if resp.status_code != 200:
        return None
    try:
        payload = resp.json()
    except Exception:
        return None

    _write_cache(key, payload)
    return payload


def _pick_hourly(payload: Dict, target_hour_utc: int) -> Dict[str, Optional[float]]:
    """Return the row of the requested UTC hour (or closest)."""
    hourly = payload.get("hourly", {})
    times: List[str] = hourly.get("time", []) or []
    if not times:
        return {"temp_c": None, "precip_mm": None, "wind_kmh": None, "humidity": None, "wind_dir_deg": None}

    # times are ISO local strings like "2018-08-12T15:00"
    target_idx = 0
    best_delta = None
    for idx, ts in enumerate(times):
        try:
            hr = int(ts[11:13])
        except (TypeError, ValueError):
            continue
        delta = abs(hr - target_hour_utc)
        if best_delta is None or delta < best_delta:
            best_delta = delta
            target_idx = idx

    def _g(name: str) -> Optional[float]:
        arr = hourly.get(name)
        if not arr or target_idx >= len(arr):
            return None
        try:
            return float(arr[target_idx])
        except (TypeError, ValueError):
            return None

    return {
        "temp_c": _g("temperature_2m"),
        "precip_mm": _g("precipitation"),
        "wind_kmh": _g("wind_speed_10m"),
        "humidity": _g("relative_humidity_2m"),
        "wind_dir_deg": _g("wind_direction_10m"),
    }


async def load_weather(
    warehouse: Warehouse,
    *,
    only_after: Optional[str] = None,
    only_before: Optional[str] = None,
    sleep_between_requests: float = 0.6,
) -> LoadStats:
    """Fetch weather for every warehouse match with a known venue lat/lon."""
    stats = LoadStats()

    sql = """
        SELECT m.match_id, m.date_utc,
               t.venue_lat AS lat, t.venue_lon AS lon, t.venue_indoor AS indoor
        FROM matches m
        JOIN teams t ON t.team_id = m.home_team_id
        LEFT JOIN weather w ON w.match_id = m.match_id
        WHERE w.match_id IS NULL
    """
    args: List = []
    if only_after:
        sql += " AND m.date_utc >= ?"
        args.append(only_after)
    if only_before:
        sql += " AND m.date_utc < ?"
        args.append(only_before)
    sql += " ORDER BY m.date_utc DESC LIMIT 50000"

    with warehouse._lock:  # noqa: SLF001
        rows = warehouse._conn.execute(sql, args).fetchall()  # noqa: SLF001

    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor/4.0 (+research)"},
        follow_redirects=True,
    ) as client:
        for row in rows:
            stats.matches_considered += 1
            lat, lon = row["lat"], row["lon"]
            if lat is None or lon is None:
                stats.skipped_no_venue += 1
                continue
            if row["indoor"]:
                stats.skipped_indoor += 1
                warehouse.upsert_weather(
                    row["match_id"],
                    temp_c=None, precip_mm=None, wind_kmh=None,
                    humidity=None, wind_dir_deg=None,
                    is_outdoor=False,
                )
                continue

            try:
                kickoff = datetime.fromisoformat(str(row["date_utc"]).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                stats.errors += 1
                continue

            payload = await _fetch_weather(
                client,
                lat=float(lat),
                lon=float(lon),
                date_str=kickoff.strftime("%Y-%m-%d"),
            )
            if not payload:
                stats.errors += 1
                await asyncio.sleep(sleep_between_requests)
                continue

            picked = _pick_hourly(payload, kickoff.hour)
            warehouse.upsert_weather(
                row["match_id"],
                temp_c=picked["temp_c"],
                precip_mm=picked["precip_mm"],
                wind_kmh=picked["wind_kmh"],
                humidity=picked["humidity"],
                wind_dir_deg=picked["wind_dir_deg"],
                is_outdoor=True,
            )
            stats.weather_written += 1
            await asyncio.sleep(sleep_between_requests)

    return stats


def run(**kwargs) -> LoadStats:
    return asyncio.run(load_weather(**kwargs))
