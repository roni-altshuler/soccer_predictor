"""Bounded injury availability metadata, never provider payloads or error text."""
from datetime import datetime, timezone
from pathlib import Path
import logging
import re

import httpx

from backend.services.data.provider_status import ProviderUnavailable, write_json_atomic
from backend.services.espn.client import ESPN_LEAGUE_IDS, ESPNRequestFailure

MAX_RECORDS = 128
logger = logging.getLogger(__name__)
REASONS = {
    "available", "http_error", "timeout", "transport_error", "invalid_json",
    "missing_injury_content", "invalid_schema", "malformed_entries", "unavailable",
    "unexpected_error", "invalid_cache", "invalid_context", "status_write_error",
    "initialization_error", "cleanup_error", "cache_write_error",
}
DETAILS = {
    "root_non_object", "injuries_null", "injuries_non_list", "entry_non_object",
    "athlete_missing", "athlete_identity", "invalid_status", "invalid_type",
    "invalid_details", "invalid_reason", "unknown_league", "unknown_provider", "invalid_team_identity",
    "missing_league_mapping", "conflicting_league_mapping", "unsupported_league_mapping",
    "invalid_routing_evidence",
}


class InjuryReportFailure(ProviderUnavailable):
    def __init__(self, reason: str, detail: str | None = None):
        self.reason = reason if reason in REASONS else "unexpected_error"
        self.detail = detail if detail in DETAILS else None
        super().__init__(self.reason)


def failure_metadata(error: Exception) -> tuple[str, str | None, int | None]:
    if isinstance(error, InjuryReportFailure):
        return error.reason, error.detail, None
    if isinstance(error, ESPNRequestFailure):
        return error.reason, None, error.http_status
    if isinstance(error, httpx.HTTPStatusError):
        return "http_error", None, error.response.status_code
    if isinstance(error, httpx.TimeoutException):
        return "timeout", None, None
    if isinstance(error, httpx.RequestError):
        return "transport_error", None, None
    if isinstance(error, ProviderUnavailable):
        return "unavailable", None, None
    return "unexpected_error", None, None


class InjuryDiagnostics:
    def __init__(self):
        self.records: list[dict] = []
        self.dropped_records = 0
        self.output_path: Path | None = None
        self._warned_write_failure = False

    def set_output(self, path: Path) -> None:
        self.output_path = path
        self._checkpoint()

    def _checkpoint(self) -> None:
        if self.output_path is not None:
            try:
                self.write(self.output_path)
            except (OSError, ValueError):
                if not self._warned_write_failure:
                    logger.warning("Could not checkpoint injury diagnostics")
                    self._warned_write_failure = True

    def record(self, source, team_id, league_key, reason, detail=None, http_status=None) -> dict:
        # Only allowlisted keys and scalar values enter an artifact. Cached
        # context and exception objects are not trusted diagnostic payloads.
        team = str(team_id) if isinstance(team_id, (str, int)) and not isinstance(team_id, bool) else ""
        league = league_key if isinstance(league_key, str) and league_key in ESPN_LEAGUE_IDS else None
        record = {
            "provider": source if isinstance(source, str) and source in {"espn", "fotmob"} else "unknown",
            "team_id": team if re.fullmatch(r"[1-9][0-9]{0,19}", team) else None,
            "league_key": league,
            "league_slug": ESPN_LEAGUE_IDS.get(league),
            "reason": reason if isinstance(reason, str) and reason in REASONS else "unexpected_error",
            "detail": detail if isinstance(detail, str) and detail in DETAILS else None,
            "http_status": http_status if type(http_status) is int and 100 <= http_status <= 599 else None,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }
        if len(self.records) < MAX_RECORDS:
            self.records.append(record)
        else:
            self.dropped_records += 1
        self._checkpoint()
        return record

    def write(self, path: Path) -> None:
        write_json_atomic(path, {
            "schema_version": 1,
            "records": self.records,
            "dropped_records": self.dropped_records,
        })
