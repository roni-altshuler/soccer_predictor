"""Integration tests against a real Postgres.

Skipped automatically unless ``DATABASE_URL`` is set. To run::

    docker compose up -d postgres
    DATABASE_URL=postgresql://soccer:soccer@localhost:5432/soccer_predictor \
        pytest backend/tests/pipeline/test_pg_integration.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest


def test_migrate_is_idempotent(pg_warehouse):
    # Running migrate twice should not raise (DDL is IF NOT EXISTS)
    pg_warehouse.migrate()
    pg_warehouse.migrate()


def test_upsert_competition_team_and_match(pg_warehouse):
    pg_warehouse.upsert_competition("eng.1", "Premier League", "M",
                                    country="England", tier=1, confederation="UEFA")
    home = pg_warehouse.upsert_team("Arsenal", "M", country="England")
    away = pg_warehouse.upsert_team("Chelsea", "M", country="England")
    pg_warehouse.upsert_season("eng.1-2024", "eng.1", "2024-25")

    from backend.pipeline.pg.warehouse import MatchRecord
    rec = MatchRecord(
        match_id="m-1",
        source="test",
        competition_id="eng.1",
        season_id="eng.1-2024",
        kickoff_utc=datetime(2025, 8, 15, 15, 0, tzinfo=timezone.utc),
        home_team_id=home,
        away_team_id=away,
        home_score=2,
        away_score=1,
    )
    written = pg_warehouse.upsert_matches([rec])
    assert written == 1

    # Idempotent re-upsert with same data
    pg_warehouse.upsert_matches([rec])
    assert pg_warehouse.count_matches() == 1

    # Late row with older source_ts should NOT overwrite the score
    older = MatchRecord(
        **{**rec.__dict__, "home_score": 0, "away_score": 0,
           "source_ts": datetime(2020, 1, 1, tzinfo=timezone.utc)},
    )
    pg_warehouse.upsert_matches([older])
    stats = pg_warehouse.stats_by_competition()
    assert len(stats) == 1


def test_aliases_resolve_existing_team(pg_warehouse):
    tid = pg_warehouse.upsert_team("Arsenal", "M", country="England")
    pg_warehouse.add_team_alias("ARS", tid, "M", source="espn")
    assert pg_warehouse.find_team_id_by_alias("ARS", "M") == tid
    # canonical name also resolves
    assert pg_warehouse.find_team_id_by_alias("Arsenal", "M") == tid
    # gender separation
    assert pg_warehouse.find_team_id_by_alias("ARS", "F") is None


def test_ingest_run_context_records_status(pg_warehouse):
    with pg_warehouse.ingest_run("test_source", "test_task", params={"foo": "bar"}) as run_id:
        assert isinstance(run_id, int)
    with pg_warehouse.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT source, task, status, params FROM core.ingest_runs WHERE run_id = %s",
            (run_id,),
        )
        row = cur.fetchone()
    assert row[0] == "test_source"
    assert row[1] == "test_task"
    assert row[2] == "ok"
    # params is JSONB; Postgres returns it as dict
    assert row[3] == {"foo": "bar"} or row[3] == '{"foo": "bar"}'


def test_ingest_run_error_path(pg_warehouse):
    with pytest.raises(RuntimeError):
        with pg_warehouse.ingest_run("test_source", "fails") as run_id:
            raise RuntimeError("boom")
    with pg_warehouse.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, error FROM core.ingest_runs WHERE run_id = %s", (run_id,))
        status, error = cur.fetchone()
    assert status == "error"
    assert "boom" in (error or "")


def test_identity_resolver_link_and_resolve(pg_warehouse):
    from backend.pipeline.identity.resolver import EntityKind, IdentityResolver
    res = IdentityResolver(pg_warehouse)
    res.link(EntityKind.TEAM, "espn", "ars-123", "arsenal-canonical")
    hit = res.resolve(EntityKind.TEAM, "espn", "ars-123")
    assert hit is not None
    assert hit.canonical_id == "arsenal-canonical"
    assert hit.confidence == 1.0
    # absent source
    assert res.resolve(EntityKind.TEAM, "fotmob", "ars-123") is None


def test_dual_write_inserts_into_postgres(tmp_path, pg_dsn, monkeypatch):
    """Smoke test: configure dual-write, write to SQLite, see it land in PG."""
    monkeypatch.setenv("DATABASE_URL", pg_dsn)
    monkeypatch.setenv("PIPELINE_DUAL_WRITE", "true")
    from backend.pipeline.settings import reset_settings_cache_for_tests
    reset_settings_cache_for_tests()

    from backend.services.data.warehouse import MatchRow, Warehouse
    from backend.pipeline.pg.dual_write import dual_write_matches

    sqlite_path = tmp_path / "wh.sqlite"
    sqlite = Warehouse(sqlite_path)
    sqlite.migrate()
    sqlite.upsert_competition("eng.1", "Premier League", "M", country="England", tier=1)
    home_id = sqlite.upsert_team("Arsenal", "M", country="England")
    away_id = sqlite.upsert_team("Chelsea", "M", country="England")
    # mirror in PG so foreign keys resolve
    from backend.pipeline.pg.warehouse import get_pg_warehouse
    pg = get_pg_warehouse()
    pg.upsert_competition("eng.1", "Premier League", "M")
    pg_home = pg.upsert_team("Arsenal", "M")
    pg_away = pg.upsert_team("Chelsea", "M")

    row = MatchRow(
        match_id="m-dw-1",
        source="dual-write-test",
        competition_id="eng.1",
        season=2025,
        date_utc="2025-08-15T15:00:00+00:00",
        home_team_id=pg_home,         # use pg-resolved ids in the input row
        away_team_id=pg_away,
        home_score=2,
        away_score=1,
    )
    dual_write_matches(sqlite, [row])

    with pg.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT match_id, home_score, away_score FROM core.fact_matches WHERE match_id = %s", ("m-dw-1",))
        rec = cur.fetchone()
    assert rec is not None
    assert rec[1] == 2 and rec[2] == 1
    sqlite.close()
