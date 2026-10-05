"""Bounded CC0 OpenFootball reader, deliberately separate from legacy loaders.

Reads only explicit big-five league-season paths at a full git SHA. No discovery,
warehouse resolver, backfill, training, primary-feed switch or paid service.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import httpx

from backend.services.data.fixture_contract import (
    SCHEMA_VERSION,
    Coverage,
    MatchScore,
    NormalizedFixture,
    ProviderIdentityMapping,
    ProviderSnapshot,
    SourceProvenance,
    TeamIdentity,
)
from backend.services.data.provider_status import ProviderUnavailable, observation_time

REPOSITORY = "https://github.com/openfootball/football.json"
RAW_BASE = "https://raw.githubusercontent.com/openfootball/football.json"
# Verified LICENSE.md at e6744429ee395bc86f247348c6184bb08d4eb361.
CC0_LICENSE_SHA256 = "36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673"
MAX_BYTES = 256_000
MAX_MATCHES = 512


@dataclass(frozen=True)
class CompetitionSpec:
    source_code: str
    normalized_id: str
    warehouse_catalog_code: str
    name_prefix: str
    teams: int


# Catalog correspondence only. This is not a team/fixture warehouse crosswalk.
COMPETITIONS = (
    CompetitionSpec(
        "en.1", "men.england.premier_league", "eng.1", "English Premier League", 20
    ),
    CompetitionSpec("es.1", "men.spain.la_liga", "esp.1", "Spain Primera División", 20),
    CompetitionSpec(
        "de.1", "men.germany.bundesliga", "ger.1", "Deutsche Bundesliga", 18
    ),
    CompetitionSpec("it.1", "men.italy.serie_a", "ita.1", "Italian Serie A", 20),
    CompetitionSpec("fr.1", "men.france.ligue_1", "fra.1", "French Ligue 1", 18),
)


class OpenFootballError(ProviderUnavailable):
    """Typed failure, never indistinguishable from valid empty/missing data."""

    def __init__(self, code: str, detail: str):
        self.code = code
        super().__init__(f"{code}: {detail}")


def _selection(commit: str, competition: str, year: int) -> tuple[CompetitionSpec, str]:
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise OpenFootballError(
            "selection", "full lowercase source commit SHA required"
        )
    spec = next((s for s in COMPETITIONS if s.source_code == competition), None)
    if spec is None or type(year) is not int or not 2010 <= year <= 2100:
        raise OpenFootballError(
            "selection", "explicit supported competition and season required"
        )
    return spec, f"{year}-{str(year + 1)[-2:]}/{spec.source_code}.json"


def _text(value, field: str, *, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise OpenFootballError("schema", f"invalid {field}")
    # Preserve exact source spellings, including accents; no fuzzy matching.
    return value


def _pair(value, field: str) -> tuple[int, int] | None:
    if value is None:
        return None
    if (
        not isinstance(value, list)
        or len(value) != 2
        or any(type(v) is not int or v < 0 for v in value)
    ):
        raise OpenFootballError("schema", f"invalid {field} score")
    return tuple(value)


def _score(value) -> MatchScore | None:
    if value is None:
        return None
    # Both shapes occur in the pinned audit, including explicit 0-0 draws.
    if isinstance(value, list):
        return MatchScore(full_time=_pair(value, "full-time"))
    if not isinstance(value, dict) or set(value) - {"ft", "ht"}:
        raise OpenFootballError("schema", "unsupported score shape/period")
    ft, ht = _pair(value.get("ft"), "full-time"), _pair(value.get("ht"), "half-time")
    return MatchScore(ft, ht) if ft is not None or ht is not None else None


def _identity(
    kind: str, key: tuple[str, ...], provenance: SourceProvenance
) -> ProviderIdentityMapping:
    encoded = json.dumps(key, ensure_ascii=False, separators=(",", ":"))
    provider_id = "synthetic:v1:" + hashlib.sha256(encoded.encode()).hexdigest()
    normalized_id = str(uuid5(NAMESPACE_URL, f"{REPOSITORY}/{kind}/{provider_id}"))
    return ProviderIdentityMapping(
        kind, key, provider_id, normalized_id, "synthetic", provenance
    )


def normalize(
    payload: bytes,
    *,
    source_commit: str,
    competition: str,
    season_start_year: int,
    observed_at: str,
) -> ProviderSnapshot:
    """Pure parser for a licensed source observation; rejects partial bad payloads.

    Direct callers must have verified the pinned license. OpenFootballAdapter
    enforces this before reading a league file. Empty matches are valid and
    explicitly incomplete; malformed matches are failures, never silently skipped.
    """
    spec, path = _selection(source_commit, competition, season_start_year)
    try:
        observed = observation_time(observed_at).isoformat()
    except ProviderUnavailable as exc:
        raise OpenFootballError("schema", "invalid observation timestamp") from exc
    if len(payload) > MAX_BYTES:
        raise OpenFootballError("limit", "source payload too large")
    try:
        data = json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise OpenFootballError("schema", "invalid JSON") from exc
    expected_name = (
        f"{spec.name_prefix} {season_start_year}/{str(season_start_year + 1)[-2:]}"
    )
    if not isinstance(data, dict) or data.get("name") != expected_name:
        raise OpenFootballError("schema", "competition/season name mismatch")
    if not isinstance(data.get("matches"), list):
        raise OpenFootballError("schema", "matches must be an explicit list")
    if len(data["matches"]) > MAX_MATCHES:
        raise OpenFootballError("limit", "too many matches")
    provenance = SourceProvenance(
        provider="openfootball",
        repository_url=REPOSITORY,
        source_commit=source_commit,
        source_path=path,
        source_url=f"{RAW_BASE}/{source_commit}/{path}",
        source_pointer="",
        payload_sha256=hashlib.sha256(payload).hexdigest(),
        license_spdx="CC0-1.0",
        license_url=f"{RAW_BASE}/{source_commit}/LICENSE.md",
        license_sha256=CC0_LICENSE_SHA256,
        observed_at=observed,
    )
    comp_identity = ProviderIdentityMapping(
        "competition",
        (spec.source_code,),
        spec.source_code,
        spec.normalized_id,
        "native",
        provenance,
    )
    identities = {("competition", spec.source_code): comp_identity}
    fixtures = []
    pairs = set()
    for index, match in enumerate(data["matches"]):
        if not isinstance(match, dict):
            raise OpenFootballError("schema", f"matches/{index} must be an object")
        if set(match) - {"round", "date", "time", "team1", "team2", "score", "status"}:
            raise OpenFootballError("schema", f"unsupported fields at matches/{index}")
        home, away = _text(match.get("team1"), "team1"), _text(
            match.get("team2"), "team2"
        )
        if home == away or (home, away) in pairs:
            raise OpenFootballError("identity", "self-match or repeated ordered pair")
        pairs.add((home, away))
        record_provenance = replace(provenance, source_pointer=f"/matches/{index}")
        participants = []
        for field, name in (("team1", home), ("team2", away)):
            team_key = ("team", spec.source_code, name)
            if team_key not in identities:
                identities[team_key] = _identity(
                    "team",
                    (spec.source_code, name),
                    replace(
                        record_provenance, source_pointer=f"/matches/{index}/{field}"
                    ),
                )
            participants.append(TeamIdentity(identities[team_key].normalized_id, name))
        fixture_identity = _identity(
            "fixture",
            (spec.source_code, str(season_start_year), home, away),
            record_provenance,
        )
        identities[("fixture", fixture_identity.provider_id)] = fixture_identity
        source_date = _text(match.get("date"), "date", optional=True)
        if source_date is not None:
            try:
                parsed_date = date.fromisoformat(source_date)
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", source_date):
                    raise ValueError("noncanonical date")
                if (
                    not date(season_start_year, 7, 1)
                    <= parsed_date
                    <= date(season_start_year + 1, 6, 30)
                ):
                    raise ValueError("date outside season")
            except ValueError as exc:
                raise OpenFootballError("schema", "invalid/out-of-season date") from exc
        local_time = _text(match.get("time"), "time", optional=True)
        if local_time is not None and not re.fullmatch(
            r"(?:[01]\d|2[0-3]):[0-5]\d", local_time
        ):
            raise OpenFootballError("schema", "invalid local time")
        score = _score(match.get("score"))
        source_status = _text(match.get("status"), "status", optional=True)
        status = {
            "canceled": "cancelled",
            "cancelled": "cancelled",
            "postponed": "postponed",
            "scheduled": "scheduled",
        }.get(source_status, "unknown")
        if source_status is not None and status == "unknown":
            raise OpenFootballError("schema", "unsupported source status")
        if score is not None and score.full_time is not None:
            if status in {"postponed", "cancelled", "scheduled"}:
                raise OpenFootballError("schema", "score conflicts with source status")
            status = "result_available"
        flags = ["synthetic_fixture_id", "upstream_freshness_unknown"]
        if source_date is None:
            flags.append("missing_date")
        if local_time is None:
            flags.append("missing_time")
        else:
            flags.append("timezone_unknown")
        if status == "unknown":
            flags.append("missing_status_or_result")
        fixtures.append(
            NormalizedFixture(
                fixture_identity.normalized_id,
                spec.normalized_id,
                season_start_year,
                *participants,
                _text(match.get("round"), "round", optional=True),
                source_date,
                local_time,
                None,
                None,
                status,
                source_status,
                score,
                tuple(flags),
                record_provenance,
            )
        )
    teams = {p.source_name for f in fixtures for p in (f.home, f.away)}
    expected_teams = (
        20 if competition == "fr.1" and season_start_year < 2023 else spec.teams
    )
    expected_count = expected_teams * (expected_teams - 1)
    dates = sorted(f.date for f in fixtures if f.date is not None)
    results = [f for f in fixtures if f.status == "result_available"]
    result_dates = sorted(f.date for f in results if f.date is not None)
    missing_pairs = len(teams) * (len(teams) - 1) - len(pairs)
    coverage = Coverage(
        fixture_count=len(fixtures),
        team_count=len(teams),
        expected_fixture_count=expected_count,
        expected_team_count=expected_teams,
        missing_ordered_pairs=missing_pairs,
        schedule_grid_complete=len(teams) == expected_teams
        and len(pairs) == expected_count,
        result_count=len(results),
        missing_full_time_count=len(fixtures) - len(results),
        postponed_count=sum(f.status == "postponed" for f in fixtures),
        cancelled_count=sum(f.status == "cancelled" for f in fixtures),
        unknown_status_count=sum(f.status == "unknown" for f in fixtures),
        missing_date_count=sum(f.date is None for f in fixtures),
        missing_time_count=sum(f.local_time is None for f in fixtures),
        unzoned_time_count=sum(f.local_time is not None for f in fixtures),
        synthetic_fixture_id_count=len(fixtures),
        earliest_date=dates[0] if dates else None,
        latest_date=dates[-1] if dates else None,
        latest_result_date=result_dates[-1] if result_dates else None,
        result_frontier_age_days=(
            (
                date.fromisoformat(observed[:10]) - date.fromisoformat(result_dates[-1])
            ).days
            if result_dates
            else None
        ),
    )
    return ProviderSnapshot(
        SCHEMA_VERSION,
        spec.normalized_id,
        season_start_year,
        data["name"],
        tuple(fixtures),
        tuple(identities.values()),
        coverage,
        provenance,
    )


class OpenFootballAdapter:
    """One-shot request budget with optional append-only on-disk observation cache.

    Incremental reads reuse (SHA, path) without network or new observation dates.
    New commits create separate entries; failures never alter prior evidence.
    Cached licenses are verified on every reuse. Cache is opt-in and independent
    of the production warehouse/cache. No automatic retries or branch polling.
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        cache_dir: Path | None = None,
        max_requests: int = 6,
    ):
        if type(max_requests) is not int or not 1 <= max_requests <= 10:
            raise OpenFootballError("limit", "request budget must be 1..10")
        self.client = client
        self.cache_dir = Path(cache_dir) if cache_dir is not None else None
        self.max_requests = max_requests
        self.requests_used = 0
        self._memory: dict[tuple[str, str], tuple[bytes, str]] = {}

    def _cached(self, commit: str, path: str) -> tuple[bytes, str] | None:
        if (commit, path) in self._memory:
            return self._memory[(commit, path)]
        if self.cache_dir is None:
            return None
        cache = self.cache_dir / commit / (path + ".observation.json")
        if not cache.exists():
            return None
        try:
            if cache.stat().st_size > MAX_BYTES * 3:
                raise ValueError("oversized cache")
            data = json.loads(cache.read_bytes())
            payload = data["payload"].encode("utf-8")
            observed = observation_time(data["observed_at"]).isoformat()
            if (
                data["source_commit"] != commit
                or data["source_path"] != path
                or data["schema_version"] != SCHEMA_VERSION
                or hashlib.sha256(payload).hexdigest() != data["payload_sha256"]
                or len(payload) > MAX_BYTES
            ):
                raise ValueError("cache provenance mismatch")
            return payload, observed
        except (
            OSError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            ProviderUnavailable,
        ) as exc:
            raise OpenFootballError(
                "cache", "invalid cached observation; preserve and review it"
            ) from exc

    async def _get(self, commit: str, path: str) -> tuple[bytes, str, bool]:
        cached = self._cached(commit, path)
        if cached is not None:
            return *cached, True
        if self.requests_used >= self.max_requests:
            raise OpenFootballError("budget", "request budget exhausted")
        self.requests_used += 1
        url = f"{RAW_BASE}/{commit}/{path}"
        try:
            async with self.client.stream(
                "GET", url, timeout=20, follow_redirects=False
            ) as response:
                if response.status_code == 404:
                    raise OpenFootballError(
                        "missing_source", f"source path absent: {path}"
                    )
                if response.status_code != 200:
                    raise OpenFootballError("http", f"HTTP {response.status_code}")
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise OpenFootballError("limit", "source payload too large")
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            raise OpenFootballError("transport", type(exc).__name__) from exc
        return b"".join(chunks), datetime.now(timezone.utc).isoformat(), False

    def _publish(self, commit: str, path: str, payload: bytes, observed: str):
        if self.cache_dir is not None:
            cache = self.cache_dir / commit / (path + ".observation.json")
            cache.parent.mkdir(parents=True, exist_ok=True)
            content = json.dumps(
                {
                    "schema_version": SCHEMA_VERSION,
                    "source_commit": commit,
                    "source_path": path,
                    "observed_at": observed,
                    "payload_sha256": hashlib.sha256(payload).hexdigest(),
                    "payload": payload.decode("utf-8"),
                },
                ensure_ascii=False,
            ).encode()
            # Hard-link publication makes the observation immutable, including
            # concurrent readers: no overwrite and no half-written cache entry.
            import os
            import tempfile

            with tempfile.NamedTemporaryFile(dir=cache.parent, delete=False) as fh:
                temporary = Path(fh.name)
                try:
                    fh.write(content)
                    fh.flush()
                    os.fsync(fh.fileno())
                    try:
                        os.link(temporary, cache)
                    except FileExistsError:
                        pass  # read() returns the original winning observation.
                finally:
                    temporary.unlink(missing_ok=True)
        else:
            self._memory.setdefault((commit, path), (payload, observed))

    async def read(
        self, *, source_commit: str, competition: str, season_start_year: int
    ) -> ProviderSnapshot:
        _, path = _selection(source_commit, competition, season_start_year)
        license_bytes, license_observed, cached_license = await self._get(
            source_commit, "LICENSE.md"
        )
        if hashlib.sha256(license_bytes).hexdigest() != CC0_LICENSE_SHA256:
            raise OpenFootballError(
                "license_changed", "pinned CC0 license no longer matches reviewed text"
            )
        if not cached_license:
            self._publish(source_commit, "LICENSE.md", license_bytes, license_observed)
        payload, observed, cached = await self._get(source_commit, path)
        snapshot = normalize(
            payload,
            source_commit=source_commit,
            competition=competition,
            season_start_year=season_start_year,
            observed_at=observed,
        )
        if not cached:
            self._publish(source_commit, path, payload, observed)
            winner = self._cached(source_commit, path)
            if winner is not None and winner != (payload, observed):
                snapshot = normalize(
                    winner[0],
                    source_commit=source_commit,
                    competition=competition,
                    season_start_year=season_start_year,
                    observed_at=winner[1],
                )
        return snapshot
