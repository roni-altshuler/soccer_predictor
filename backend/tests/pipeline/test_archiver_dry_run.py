"""Archiver dry-run tests (no R2 needed)."""

from __future__ import annotations

from datetime import date

import pytest

from backend.pipeline.workers.archiver import (
    RETENTION_POLICY, RetentionEntry, _month_start, _next_month,
)


def test_month_start_and_next_month():
    assert _month_start(date(2026, 5, 24)) == date(2026, 5, 1)
    assert _next_month(date(2026, 5, 1)) == date(2026, 6, 1)
    assert _next_month(date(2026, 12, 1)) == date(2027, 1, 1)


def test_retention_policy_covers_required_tables():
    tables = {e.table for e in RETENTION_POLICY}
    # Fact tables that grow without bound must be in the policy
    assert "fact_matches" in tables
    assert "fact_match_events" in tables
    assert "fact_standings_snapshot" in tables
    assert "ingest_runs" in tables


def test_partitioned_entries_use_correct_keys():
    by_table = {e.table: e for e in RETENTION_POLICY}
    assert by_table["fact_matches"].partition_key == "kickoff_utc"
    assert by_table["fact_match_events"].partition_key == "source_ts"
    assert by_table["fact_matches"].partitioned is True
    assert by_table["fact_match_events"].partitioned is True


def test_dry_run_does_not_require_r2(pg_warehouse):
    """A dry-run on an empty partition should return zero rows."""
    from backend.pipeline.workers.archiver import archive_month
    entry = next(e for e in RETENTION_POLICY if e.table == "fact_matches")
    result = archive_month(entry, date(2024, 1, 1), dry_run=True)
    assert result["rows"] == 0
    assert result["bytes"] == 0
    assert result["uploaded"] is False
