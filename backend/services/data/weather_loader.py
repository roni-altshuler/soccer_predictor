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
  is known (`teams.venue_lat` / `venue_lon`), which
  `backend/services/data/venue_loader.py` fills from the committed
  `backend/data/venues.yml`. Until that existed this join matched nothing
  and the `weather` table stayed empty — which is why five weather
  features sat at their hardcoded defaults for the entire corpus.
* Indoor stadiums (`teams.venue_indoor = 1`) are recorded with NULL
  readings and `is_outdoor = 0` rather than skipped, so "roof closed" is
  distinguishable from "never fetched".
* **A match with no kickoff time gets no weather.** Rows sourced from
  football-data before the 2019-20 season know the calendar day but not
  the hour, and conditions at an unknown hour are not a measurement. The
  honest outcome is a missing row, not midnight's weather relabelled as
  kickoff weather.

Request batching
----------------
One archive request covers a whole year at one venue, and every match at
that venue in that year is served from it. That is ~1,100 requests for
Wave A rather than one per match (~12,500), and each response is cached
on disk so a re-run is free.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

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
    skipped_no_kickoff: int = 0
    skipped_existing: int = 0
    requests: int = 0
    errors: int = 0


def _range_cache_key(lat: float, lon: float, start: str, end: str) -> str:
    return f"{round(lat, 4)}_{round(lon, 4)}_{start}_{end}"


async def _fetch_range(
    client: httpx.AsyncClient,
    *,
    lat: float,
    lon: float,
    start: str,
    end: str,
) -> Optional[Dict]:
    """One venue, one date range, hourly. Cached on disk indefinitely —
    historical reanalysis for a past year does not change."""
    key = _range_cache_key(lat, lon, start, end)
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        try:
            import json
            return json.loads(path.read_text())
        except Exception:
            pass

    params = {
        "latitude": str(lat),
        "longitude": str(lon),
        "start_date": start,
        "end_date": end,
        "hourly": "temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,wind_direction_10m",
        "timezone": "UTC",
    }
    try:
        resp = await client.get(OPEN_METEO_BASE, params=params, timeout=60)
    except Exception as exc:
        logger.debug("Open-Meteo HTTP error %s/%s %s..%s: %s", lat, lon, start, end, exc)
        return None
    if resp.status_code != 200:
        logger.debug("Open-Meteo %s for %s/%s %s..%s", resp.status_code, lat, lon, start, end)
        return None
    try:
        payload = resp.json()
    except Exception:
        return None

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        import json
        path.write_text(json.dumps(payload))
    except Exception as exc:
        logger.debug("Failed to cache weather range %s: %s", key, exc)
    return payload


def _index_hourly(payload: Dict) -> Dict[str, Dict[str, Optional[float]]]:
    """Open-Meteo's parallel arrays → {'YYYY-MM-DDTHH': readings}."""
    hourly = payload.get("hourly") or {}
    times: List[str] = hourly.get("time") or []
    fields = {
        "temp_c": hourly.get("temperature_2m") or [],
        "precip_mm": hourly.get("precipitation") or [],
        "wind_kmh": hourly.get("wind_speed_10m") or [],
        "humidity": hourly.get("relative_humidity_2m") or [],
        "wind_dir_deg": hourly.get("wind_direction_10m") or [],
    }
    out: Dict[str, Dict[str, Optional[float]]] = {}
    for idx, stamp in enumerate(times):
        reading: Dict[str, Optional[float]] = {}
        for name, arr in fields.items():
            try:
                reading[name] = float(arr[idx]) if idx < len(arr) and arr[idx] is not None else None
            except (TypeError, ValueError):
                reading[name] = None
        out[str(stamp)[:13]] = reading
    return out


async def load_weather(
    warehouse: Warehouse,
    *,
    only_after: Optional[str] = None,
    only_before: Optional[str] = None,
    competitions: Optional[Sequence[str]] = None,
    sleep_between_requests: float = 0.6,
) -> LoadStats:
    """Fetch kickoff-hour weather for matches with a venue and a kickoff."""
    stats = LoadStats()

    sql = """
        SELECT m.match_id, m.date_utc, m.home_team_id,
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
    if competitions:
        sql += " AND m.competition_id IN ({})".format(", ".join("?" * len(competitions)))
        args.extend(competitions)
    sql += " ORDER BY m.date_utc ASC"

    with warehouse._lock:  # noqa: SLF001
        rows = warehouse._conn.execute(sql, args).fetchall()  # noqa: SLF001

    # Bucket the work by (venue, year) so one request serves many matches.
    buckets: Dict[Tuple[float, float, int], List] = {}
    for row in rows:
        stats.matches_considered += 1
        lat, lon = row["lat"], row["lon"]
        if lat is None or lon is None:
            stats.skipped_no_venue += 1
            continue
        if row["indoor"]:
            # Recorded, not skipped: "roof closed" is a real state.
            stats.skipped_indoor += 1
            warehouse.upsert_weather(
                row["match_id"], temp_c=None, precip_mm=None, wind_kmh=None,
                humidity=None, wind_dir_deg=None, is_outdoor=False,
            )
            continue
        raw = str(row["date_utc"])
        try:
            kickoff = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            stats.errors += 1
            continue
        if raw[11:19] == "00:00:00":
            # Date known, kickoff unknown — see the module docstring.
            stats.skipped_no_kickoff += 1
            continue
        buckets.setdefault((float(lat), float(lon), kickoff.year), []).append((row["match_id"], kickoff))

    logger.info(
        "Weather: %d matches need %d (venue, year) requests "
        "(%d indoor, %d without a kickoff, %d without a venue)",
        sum(len(v) for v in buckets.values()), len(buckets),
        stats.skipped_indoor, stats.skipped_no_kickoff, stats.skipped_no_venue,
    )

    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor/4.0 (+research)"},
        follow_redirects=True,
    ) as client:
        for done, ((lat, lon, year), matches) in enumerate(sorted(buckets.items()), 1):
            start = min(k for _m, k in matches).strftime("%Y-%m-%d")
            end = max(k for _m, k in matches).strftime("%Y-%m-%d")
            cached = (CACHE_DIR / f"{_range_cache_key(lat, lon, start, end)}.json").exists()
            payload = await _fetch_range(client, lat=lat, lon=lon, start=start, end=end)
            stats.requests += 1
            if not payload:
                stats.errors += len(matches)
                if not cached:
                    await asyncio.sleep(sleep_between_requests)
                continue

            index = _index_hourly(payload)
            for match_id, kickoff in matches:
                reading = index.get(kickoff.strftime("%Y-%m-%dT%H"))
                if reading is None:
                    stats.errors += 1
                    continue
                warehouse.upsert_weather(
                    match_id,
                    temp_c=reading["temp_c"],
                    precip_mm=reading["precip_mm"],
                    wind_kmh=reading["wind_kmh"],
                    humidity=reading["humidity"],
                    wind_dir_deg=reading["wind_dir_deg"],
                    is_outdoor=True,
                )
                stats.weather_written += 1

            if done % 100 == 0:
                logger.info("Weather: %d/%d venue-years, %d rows written",
                            done, len(buckets), stats.weather_written)
            if not cached:
                await asyncio.sleep(sleep_between_requests)

    return stats


def run(**kwargs) -> LoadStats:
    return asyncio.run(load_weather(**kwargs))
