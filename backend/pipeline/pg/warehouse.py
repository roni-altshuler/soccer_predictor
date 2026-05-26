"""Postgres warehouse — Phase 1 sink.

Mirrors the public surface of `backend.services.data.warehouse.Warehouse` so
that a loader can dual-write to both with the same call signature. The
SQLite warehouse remains the legacy source of truth until `PIPELINE_READ_FROM`
is flipped to ``pg``.

Design points worth knowing
---------------------------
* Uses **psycopg3** (sync) for batch ETL paths. The async surface
  (websocket gateway, postgres_writer worker) uses :class:`psycopg.AsyncConnection`
  via :mod:`backend.pipeline.pg.pool`.
* All upserts use ``INSERT ... ON CONFLICT ... DO UPDATE`` with COALESCE-on-null
  semantics so a partial late row never overwrites a richer earlier row with
  NULL.
* ``fact_matches`` is partitioned by month on ``kickoff_utc``. :func:`migrate`
  pre-creates ±12 months of partitions so the table is queryable on day one.
* Connection pool comes from :class:`psycopg_pool.ConnectionPool` with a small
  default (2-5) — Neon's free tier has a hard limit on concurrent connections.
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Iterator, Optional, Sequence

logger = logging.getLogger(__name__)

# psycopg / psycopg_pool are optional at *import* time so that
# `from backend.pipeline import ...` doesn't explode in environments where
# Postgres simply isn't installed. The first time a method is called, we
# import lazily and surface a clear error.
try:  # pragma: no cover - import side-effect only
    import psycopg
    from psycopg import sql
    from psycopg_pool import ConnectionPool
    PSYCOPG_AVAILABLE = True
except Exception:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]
    sql = None  # type: ignore[assignment]
    ConnectionPool = None  # type: ignore[assignment]
    PSYCOPG_AVAILABLE = False

from backend.pipeline.pg.schema import ALL_DDL


@dataclass
class MatchRecord:
    """Dual-write input. Mirrors ``backend.services.data.warehouse.MatchRow``
    plus a few Postgres-only columns (``season_id``, ``status``, ``source_ts``).
    """

    match_id: str
    source: str
    competition_id: str
    kickoff_utc: datetime
    home_team_id: int
    away_team_id: int
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    season_id: Optional[str] = None
    status: str = "scheduled"
    phase: Optional[str] = None
    venue_id: Optional[int] = None
    referee_id: Optional[int] = None
    home_xg: Optional[float] = None
    away_xg: Optional[float] = None
    home_shots: Optional[float] = None
    away_shots: Optional[float] = None
    home_sot: Optional[float] = None
    away_sot: Optional[float] = None
    home_corners: Optional[float] = None
    away_corners: Optional[float] = None
    home_yellows: Optional[int] = None
    away_yellows: Optional[int] = None
    home_reds: Optional[int] = None
    away_reds: Optional[int] = None
    odds_home: Optional[float] = None
    odds_draw: Optional[float] = None
    odds_away: Optional[float] = None
    odds_over_2_5: Optional[float] = None
    attendance: Optional[int] = None
    source_ts: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def _require_psycopg() -> None:
    if not PSYCOPG_AVAILABLE:
        raise RuntimeError(
            "psycopg is not installed. Add `psycopg[binary,pool]` to requirements.txt "
            "or install in dev with: pip install 'psycopg[binary,pool]'"
        )


def _month_floor(d: datetime) -> date:
    return date(d.year, d.month, 1)


def _next_month(d: date) -> date:
    return date(d.year + (d.month // 12), (d.month % 12) + 1, 1)


class PgWarehouse:
    """Sync Postgres warehouse handle.

    Holds a small connection pool. Cheap to construct (no eager connect).
    Call :meth:`migrate` once on startup; it's idempotent.
    """

    def __init__(self, dsn: str, *, min_size: int = 1, max_size: int = 5):
        _require_psycopg()
        self.dsn = dsn
        self._pool: Optional[ConnectionPool] = None
        self._lock = threading.Lock()
        self._pool_args = {"min_size": min_size, "max_size": max_size}

    # ---- lifecycle --------------------------------------------------------

    @property
    def pool(self) -> "ConnectionPool":
        with self._lock:
            if self._pool is None:
                self._pool = ConnectionPool(self.dsn, open=True, **self._pool_args)
            return self._pool

    @contextmanager
    def connection(self) -> Iterator["psycopg.Connection"]:
        with self.pool.connection() as conn:
            yield conn

    def close(self) -> None:
        with self._lock:
            if self._pool is not None:
                self._pool.close()
                self._pool = None

    def migrate(self) -> None:
        """Apply schema DDL. Idempotent; safe to call on every startup."""
        with self.connection() as conn, conn.cursor() as cur:
            for stmt in ALL_DDL:
                cur.execute(stmt)
            conn.commit()
        # Partition pre-creation runs in its own tx so a partition failure
        # doesn't roll back the schema DDL.
        self.ensure_partitions()

    def ensure_partitions(
        self,
        *,
        from_month: Optional[date] = None,
        through_month: Optional[date] = None,
    ) -> int:
        """Create monthly partitions for partitioned facts.

        Covers ``[from_month, through_month]`` inclusive. Defaults to
        last 12 + next 12 months, recomputed every call.
        Returns the number of CREATE TABLE statements executed.
        """
        today = datetime.now(timezone.utc)
        if from_month is None:
            from_month = _month_floor(today - timedelta(days=365))
        if through_month is None:
            through_month = _month_floor(today + timedelta(days=365))

        partitioned = (
            ("core", "fact_matches"),
            ("core", "fact_match_events"),
        )
        created = 0
        with self.connection() as conn, conn.cursor() as cur:
            cur_month = from_month
            while cur_month <= through_month:
                nxt = _next_month(cur_month)
                tag = cur_month.strftime("%Y_%m")
                for schema, parent in partitioned:
                    part_name = f"{parent}_{tag}"
                    cur.execute(
                        sql.SQL(
                            "CREATE TABLE IF NOT EXISTS {part_schema}.{part_name} "
                            "PARTITION OF {parent_schema}.{parent_name} "
                            "FOR VALUES FROM (%s) TO (%s)"
                        ).format(
                            part_schema=sql.Identifier(schema),
                            part_name=sql.Identifier(part_name),
                            parent_schema=sql.Identifier(schema),
                            parent_name=sql.Identifier(parent),
                        ),
                        (cur_month, nxt),
                    )
                    created += 1
                cur_month = nxt
            conn.commit()
        return created

    # ---- dims -------------------------------------------------------------

    def upsert_competition(
        self,
        competition_id: str,
        name: str,
        gender: str,
        *,
        country: Optional[str] = None,
        tier: Optional[int] = None,
        confederation: Optional[str] = None,
        parent_id: Optional[str] = None,
    ) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.dim_competitions
                    (competition_id, name, gender, country, tier, confederation, parent_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (competition_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    gender = EXCLUDED.gender,
                    country = COALESCE(EXCLUDED.country, core.dim_competitions.country),
                    tier = COALESCE(EXCLUDED.tier, core.dim_competitions.tier),
                    confederation = COALESCE(EXCLUDED.confederation, core.dim_competitions.confederation),
                    parent_id = COALESCE(EXCLUDED.parent_id, core.dim_competitions.parent_id)
                """,
                (competition_id, name, gender, country, tier, confederation, parent_id),
            )
            conn.commit()

    def upsert_team(
        self,
        canonical_name: str,
        gender: str,
        *,
        country: Optional[str] = None,
        venue_id: Optional[int] = None,
        founded: Optional[int] = None,
    ) -> int:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.dim_teams (canonical_name, gender, country, venue_id, founded)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (canonical_name, gender) DO UPDATE SET
                    country = COALESCE(EXCLUDED.country, core.dim_teams.country),
                    venue_id = COALESCE(EXCLUDED.venue_id, core.dim_teams.venue_id),
                    founded = COALESCE(EXCLUDED.founded, core.dim_teams.founded)
                RETURNING team_id
                """,
                (canonical_name, gender, country, venue_id, founded),
            )
            row = cur.fetchone()
            conn.commit()
            return int(row[0])

    def add_team_alias(
        self, alias: str, team_id: int, gender: str, *, source: Optional[str] = None
    ) -> None:
        if not alias:
            return
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.dim_team_aliases (alias, gender, team_id, source)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (alias, gender) DO UPDATE SET
                    team_id = EXCLUDED.team_id,
                    source = COALESCE(EXCLUDED.source, core.dim_team_aliases.source)
                """,
                (alias.strip(), gender, team_id, source),
            )
            conn.commit()

    def find_team_id_by_alias(self, alias: str, gender: str) -> Optional[int]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT team_id FROM core.dim_team_aliases WHERE alias = %s AND gender = %s
                UNION
                SELECT team_id FROM core.dim_teams WHERE canonical_name = %s AND gender = %s
                LIMIT 1
                """,
                (alias.strip(), gender, alias.strip(), gender),
            )
            row = cur.fetchone()
            return int(row[0]) if row else None

    def upsert_referee(self, name: str, *, country: Optional[str] = None) -> Optional[int]:
        if not name:
            return None
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.dim_referees (name, country) VALUES (%s,%s)
                ON CONFLICT (name) DO UPDATE SET
                    country = COALESCE(EXCLUDED.country, core.dim_referees.country)
                RETURNING referee_id
                """,
                (name.strip(), country),
            )
            row = cur.fetchone()
            conn.commit()
            return int(row[0]) if row else None

    def upsert_season(
        self,
        season_id: str,
        competition_id: str,
        label: str,
        *,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.dim_seasons (season_id, competition_id, label, start_date, end_date)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (season_id) DO UPDATE SET
                    label = EXCLUDED.label,
                    start_date = COALESCE(EXCLUDED.start_date, core.dim_seasons.start_date),
                    end_date = COALESCE(EXCLUDED.end_date, core.dim_seasons.end_date)
                """,
                (season_id, competition_id, label, start_date, end_date),
            )
            conn.commit()

    # ---- facts ------------------------------------------------------------

    def upsert_matches(self, rows: Sequence[MatchRecord]) -> int:
        """Bulk upsert into ``core.fact_matches``.

        Late rows with older source_ts cannot stomp newer rows.
        Returns the number of input rows (Postgres doesn't cleanly distinguish
        insert vs update counts via executemany).
        """
        if not rows:
            return 0
        cols = (
            "match_id, source, competition_id, season_id, kickoff_utc, status, phase, "
            "home_team_id, away_team_id, venue_id, referee_id, "
            "home_score, away_score, home_xg, away_xg, "
            "home_shots, away_shots, home_sot, away_sot, "
            "home_corners, away_corners, home_yellows, away_yellows, "
            "home_reds, away_reds, "
            "odds_home, odds_draw, odds_away, odds_over_2_5, "
            "attendance, source_ts"
        )
        placeholders = ",".join(["%s"] * 31)
        # Update only when the incoming row is at least as recent as the stored one.
        update_clause = """
            source = EXCLUDED.source,
            competition_id = EXCLUDED.competition_id,
            season_id = COALESCE(EXCLUDED.season_id, core.fact_matches.season_id),
            status = EXCLUDED.status,
            phase = COALESCE(EXCLUDED.phase, core.fact_matches.phase),
            home_team_id = EXCLUDED.home_team_id,
            away_team_id = EXCLUDED.away_team_id,
            venue_id = COALESCE(EXCLUDED.venue_id, core.fact_matches.venue_id),
            referee_id = COALESCE(EXCLUDED.referee_id, core.fact_matches.referee_id),
            home_score = COALESCE(EXCLUDED.home_score, core.fact_matches.home_score),
            away_score = COALESCE(EXCLUDED.away_score, core.fact_matches.away_score),
            home_xg = COALESCE(EXCLUDED.home_xg, core.fact_matches.home_xg),
            away_xg = COALESCE(EXCLUDED.away_xg, core.fact_matches.away_xg),
            home_shots = COALESCE(EXCLUDED.home_shots, core.fact_matches.home_shots),
            away_shots = COALESCE(EXCLUDED.away_shots, core.fact_matches.away_shots),
            home_sot = COALESCE(EXCLUDED.home_sot, core.fact_matches.home_sot),
            away_sot = COALESCE(EXCLUDED.away_sot, core.fact_matches.away_sot),
            home_corners = COALESCE(EXCLUDED.home_corners, core.fact_matches.home_corners),
            away_corners = COALESCE(EXCLUDED.away_corners, core.fact_matches.away_corners),
            home_yellows = COALESCE(EXCLUDED.home_yellows, core.fact_matches.home_yellows),
            away_yellows = COALESCE(EXCLUDED.away_yellows, core.fact_matches.away_yellows),
            home_reds = COALESCE(EXCLUDED.home_reds, core.fact_matches.home_reds),
            away_reds = COALESCE(EXCLUDED.away_reds, core.fact_matches.away_reds),
            odds_home = COALESCE(EXCLUDED.odds_home, core.fact_matches.odds_home),
            odds_draw = COALESCE(EXCLUDED.odds_draw, core.fact_matches.odds_draw),
            odds_away = COALESCE(EXCLUDED.odds_away, core.fact_matches.odds_away),
            odds_over_2_5 = COALESCE(EXCLUDED.odds_over_2_5, core.fact_matches.odds_over_2_5),
            attendance = COALESCE(EXCLUDED.attendance, core.fact_matches.attendance),
            source_ts = GREATEST(EXCLUDED.source_ts, core.fact_matches.source_ts),
            fetched_at = now()
        """
        stmt = (
            f"INSERT INTO core.fact_matches ({cols}) VALUES ({placeholders}) "
            "ON CONFLICT (match_id, kickoff_utc) DO UPDATE SET "
            + update_clause
            + " WHERE EXCLUDED.source_ts >= core.fact_matches.source_ts"
        )
        params = [
            (
                r.match_id, r.source, r.competition_id, r.season_id, r.kickoff_utc,
                r.status, r.phase, r.home_team_id, r.away_team_id, r.venue_id, r.referee_id,
                r.home_score, r.away_score, r.home_xg, r.away_xg,
                r.home_shots, r.away_shots, r.home_sot, r.away_sot,
                r.home_corners, r.away_corners, r.home_yellows, r.away_yellows,
                r.home_reds, r.away_reds,
                r.odds_home, r.odds_draw, r.odds_away, r.odds_over_2_5,
                r.attendance, r.source_ts,
            )
            for r in rows
        ]
        with self.connection() as conn, conn.cursor() as cur:
            cur.executemany(stmt, params)
            conn.commit()
        return len(rows)

    def upsert_clubelo(self, rows: Iterable[tuple[int, date, float]]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        with self.connection() as conn, conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO core.fact_clubelo_ratings (team_id, date, elo)
                VALUES (%s,%s,%s)
                ON CONFLICT (team_id, date) DO UPDATE SET elo = EXCLUDED.elo
                """,
                rows,
            )
            conn.commit()
        return len(rows)

    def upsert_weather(
        self,
        match_id: str,
        *,
        temp_c: Optional[float],
        precip_mm: Optional[float],
        wind_kmh: Optional[float],
        humidity: Optional[float],
        wind_dir_deg: Optional[float] = None,
        is_outdoor: bool = True,
    ) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.fact_weather
                    (match_id, temp_c, precip_mm, wind_kmh, humidity, wind_dir_deg, is_outdoor)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (match_id) DO UPDATE SET
                    temp_c = COALESCE(EXCLUDED.temp_c, core.fact_weather.temp_c),
                    precip_mm = COALESCE(EXCLUDED.precip_mm, core.fact_weather.precip_mm),
                    wind_kmh = COALESCE(EXCLUDED.wind_kmh, core.fact_weather.wind_kmh),
                    humidity = COALESCE(EXCLUDED.humidity, core.fact_weather.humidity),
                    wind_dir_deg = COALESCE(EXCLUDED.wind_dir_deg, core.fact_weather.wind_dir_deg),
                    is_outdoor = EXCLUDED.is_outdoor
                """,
                (match_id, temp_c, precip_mm, wind_kmh, humidity, wind_dir_deg, is_outdoor),
            )
            conn.commit()

    # ---- ingest lineage ---------------------------------------------------

    def start_ingest_run(
        self, source: str, task: str, *, params: Optional[dict] = None
    ) -> int:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO core.ingest_runs (source, task, params, status)
                VALUES (%s,%s,%s,'running')
                RETURNING run_id
                """,
                (source, task, _to_jsonb(params)),
            )
            row = cur.fetchone()
            conn.commit()
            return int(row[0])

    def finish_ingest_run(
        self,
        run_id: int,
        *,
        status: str = "ok",
        rows_in: Optional[int] = None,
        rows_out: Optional[int] = None,
        error: Optional[str] = None,
    ) -> None:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE core.ingest_runs
                SET finished_at = now(), status = %s, rows_in = %s, rows_out = %s, error = %s
                WHERE run_id = %s
                """,
                (status, rows_in, rows_out, error, run_id),
            )
            conn.commit()

    @contextmanager
    def ingest_run(
        self, source: str, task: str, *, params: Optional[dict] = None
    ) -> Iterator[int]:
        """Context manager that records start/finish/error in ``core.ingest_runs``."""
        run_id = self.start_ingest_run(source, task, params=params)
        try:
            yield run_id
        except Exception as exc:
            self.finish_ingest_run(run_id, status="error", error=str(exc)[:4000])
            raise
        else:
            self.finish_ingest_run(run_id, status="ok")

    # ---- introspection ----------------------------------------------------

    def count_matches(
        self,
        *,
        competition_id: Optional[str] = None,
        gender: Optional[str] = None,
        since: Optional[datetime] = None,
    ) -> int:
        clauses: list[str] = []
        args: list[Any] = []
        join = ""
        if gender is not None:
            join = " JOIN core.dim_competitions c ON c.competition_id = m.competition_id"
            clauses.append("c.gender = %s")
            args.append(gender)
        if competition_id is not None:
            clauses.append("m.competition_id = %s")
            args.append(competition_id)
        if since is not None:
            clauses.append("m.kickoff_utc >= %s")
            args.append(since)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        sql_ = f"SELECT COUNT(*) FROM core.fact_matches m{join}{where}"
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(sql_, args)
            return int(cur.fetchone()[0])

    def stats_by_competition(self) -> list[dict]:
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.competition_id, c.name, c.gender,
                       COUNT(*) AS matches,
                       MIN(m.kickoff_utc) AS first_match,
                       MAX(m.kickoff_utc) AS last_match
                FROM core.fact_matches m
                LEFT JOIN core.dim_competitions c ON c.competition_id = m.competition_id
                GROUP BY m.competition_id, c.name, c.gender
                ORDER BY matches DESC
                """
            )
            cols = [d.name for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# module-level singleton + helpers
# ---------------------------------------------------------------------------

_singleton: Optional[PgWarehouse] = None
_singleton_lock = threading.Lock()


def get_pg_warehouse() -> Optional[PgWarehouse]:
    """Return a cached :class:`PgWarehouse` if ``DATABASE_URL`` is set, else None.

    Lazy: doesn't connect until a method is called.
    """
    global _singleton
    from backend.pipeline.settings import get_pipeline_settings

    settings = get_pipeline_settings()
    if not settings.database_url:
        return None
    with _singleton_lock:
        if _singleton is None or _singleton.dsn != settings.database_url:
            if _singleton is not None:
                _singleton.close()
            _singleton = PgWarehouse(settings.database_url)
        return _singleton


@contextmanager
def open_pg_warehouse(dsn: Optional[str] = None) -> Iterator[PgWarehouse]:
    """One-shot warehouse handle for CLI scripts.

    Migrates on open. Closes the pool on exit so the process terminates.
    """
    from backend.pipeline.settings import get_pipeline_settings

    target_dsn = dsn or get_pipeline_settings().database_url
    if not target_dsn:
        raise RuntimeError("No DATABASE_URL configured")
    wh = PgWarehouse(target_dsn)
    try:
        wh.migrate()
        yield wh
    finally:
        wh.close()


def _to_jsonb(value: Optional[dict]) -> Optional[str]:
    if value is None:
        return None
    import json

    return json.dumps(value, default=str)
