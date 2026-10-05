"""Provider-independent, immutable observation contract. No warehouse writes."""

from dataclasses import asdict, dataclass
from typing import Literal, Protocol

SCHEMA_VERSION = "football-fixtures/v1"


@dataclass(frozen=True)
class SourceProvenance:
    provider: str
    repository_url: str
    source_commit: str
    source_path: str
    source_url: str
    source_pointer: str
    payload_sha256: str
    license_spdx: str
    license_url: str
    license_sha256: str
    observed_at: str
    # Observation time and a git commit are not upstream fact-update times.
    upstream_updated_at: str | None = None


@dataclass(frozen=True)
class ProviderIdentityMapping:
    entity_kind: Literal["competition", "team", "fixture"]
    provider_key: tuple[str, ...]
    provider_id: str
    normalized_id: str
    identifier_origin: Literal["native", "synthetic"]
    provenance: SourceProvenance
    # Filling this requires a separately reviewed, evidence-backed mapping.
    warehouse_id: str | None = None


@dataclass(frozen=True)
class TeamIdentity:
    team_id: str
    source_name: str


@dataclass(frozen=True)
class MatchScore:
    full_time: tuple[int, int] | None
    half_time: tuple[int, int] | None = None


@dataclass(frozen=True)
class NormalizedFixture:
    fixture_id: str
    competition_id: str
    season_start_year: int
    home: TeamIdentity
    away: TeamIdentity
    round: str | None
    date: str | None
    local_time: str | None
    timezone: str | None
    kickoff_utc: str | None
    status: Literal[
        "result_available", "scheduled", "postponed", "cancelled", "unknown"
    ]
    source_status: str | None
    score: MatchScore | None
    quality_flags: tuple[str, ...]
    provenance: SourceProvenance


@dataclass(frozen=True)
class Coverage:
    fixture_count: int
    team_count: int
    expected_fixture_count: int
    expected_team_count: int
    missing_ordered_pairs: int
    schedule_grid_complete: bool
    result_count: int
    missing_full_time_count: int
    postponed_count: int
    cancelled_count: int
    unknown_status_count: int
    missing_date_count: int
    missing_time_count: int
    unzoned_time_count: int
    synthetic_fixture_id_count: int
    earliest_date: str | None
    latest_date: str | None
    latest_result_date: str | None
    result_frontier_age_days: int | None
    # A complete pair grid does not certify dates, results or freshness.
    upstream_freshness: str = "unknown"


@dataclass(frozen=True)
class ProviderSnapshot:
    schema_version: str
    competition_id: str
    season_start_year: int
    source_name: str
    fixtures: tuple[NormalizedFixture, ...]
    identities: tuple[ProviderIdentityMapping, ...]
    coverage: Coverage
    provenance: SourceProvenance

    def to_dict(self) -> dict:
        """A disposable serialization copy; cannot mutate this observation."""
        return asdict(self)


class FixtureProvider(Protocol):
    async def read(
        self, *, source_commit: str, competition: str, season_start_year: int
    ) -> ProviderSnapshot: ...
