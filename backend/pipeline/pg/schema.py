"""Canonical Postgres DDL for the Pitchverse data warehouse (Phase 1).

Why a dedicated SQL constant file instead of SQLAlchemy / Django models:

* The legacy SQLite warehouse (`backend/services/data/warehouse.py`) uses pure
  stdlib `sqlite3`. We deliberately stay close to that style — no ORM, no
  metaclass magic — so future contributors can copy-paste DDL into psql.
* Alembic still drives migrations (`migrations/versions/001_initial_core_schema.py`),
  but each migration just executes the corresponding constant from here. That
  keeps the canonical schema in one place rather than scattered across
  migration files.

Layout (matches the design doc):

* ``raw`` schema — per-source landing tables, append-only JSONB
* ``staging`` schema — typed but pre-merge
* ``core`` schema — canonical curated tables read by API + ML
* ``features`` schema — derived feature tables (regenerated, not authoritative)
* ``archive`` schema — older partitions detached from core

All time-series facts are partitioned by month on either ``kickoff_utc`` or
``source_ts``. Native partitioning, not TimescaleDB — Neon's free tier doesn't
support TS extensions.
"""

from __future__ import annotations

# Order matters: schemas first, then independent dims, then fact tables that
# reference them, then indexes.
SCHEMAS = ("raw", "staging", "core", "features", "archive")

DDL_SCHEMAS = tuple(f"CREATE SCHEMA IF NOT EXISTS {s}" for s in SCHEMAS)


# ---------------------------------------------------------------------------
# core dims
# ---------------------------------------------------------------------------

DDL_CORE_DIMS = (
    """
    CREATE TABLE IF NOT EXISTS core.dim_competitions (
        competition_id   TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        country          TEXT,
        gender           CHAR(1) NOT NULL CHECK (gender IN ('M','F')),
        tier             SMALLINT,
        confederation    TEXT,
        parent_id        TEXT REFERENCES core.dim_competitions(competition_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.dim_seasons (
        season_id        TEXT PRIMARY KEY,
        competition_id   TEXT NOT NULL REFERENCES core.dim_competitions(competition_id),
        label            TEXT NOT NULL,
        start_date       DATE,
        end_date         DATE,
        UNIQUE (competition_id, label)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.dim_venues (
        venue_id         BIGSERIAL PRIMARY KEY,
        name             TEXT NOT NULL,
        lat              DOUBLE PRECISION,
        lon              DOUBLE PRECISION,
        capacity         INTEGER,
        indoor           BOOLEAN NOT NULL DEFAULT FALSE,
        surface          TEXT,
        country          TEXT,
        UNIQUE (name, country)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.dim_teams (
        team_id          BIGSERIAL PRIMARY KEY,
        canonical_name   TEXT NOT NULL,
        gender           CHAR(1) NOT NULL CHECK (gender IN ('M','F')),
        country          TEXT,
        founded          SMALLINT,
        venue_id         BIGINT REFERENCES core.dim_venues(venue_id),
        UNIQUE (canonical_name, gender)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.dim_team_aliases (
        alias            TEXT NOT NULL,
        gender           CHAR(1) NOT NULL CHECK (gender IN ('M','F')),
        team_id          BIGINT NOT NULL REFERENCES core.dim_teams(team_id) ON DELETE CASCADE,
        source           TEXT,
        PRIMARY KEY (alias, gender)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.dim_players (
        player_id        BIGSERIAL PRIMARY KEY,
        canonical_name   TEXT NOT NULL,
        dob              DATE,
        nationality      TEXT,
        primary_position TEXT,
        UNIQUE (canonical_name, dob)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.dim_referees (
        referee_id       BIGSERIAL PRIMARY KEY,
        name             TEXT NOT NULL UNIQUE,
        country          TEXT
    )
    """,
)


# ---------------------------------------------------------------------------
# core facts (partitioned where appropriate)
# ---------------------------------------------------------------------------

DDL_CORE_FACTS = (
    # fact_matches — partitioned by month on kickoff_utc.
    # We attach 24 monthly partitions covering ~ last 12 + next 12 months in
    # `ensure_partitions()` so the table is queryable immediately after migrate.
    """
    CREATE TABLE IF NOT EXISTS core.fact_matches (
        match_id         TEXT NOT NULL,
        source           TEXT NOT NULL,
        competition_id   TEXT NOT NULL REFERENCES core.dim_competitions(competition_id),
        season_id        TEXT REFERENCES core.dim_seasons(season_id),
        kickoff_utc      TIMESTAMPTZ NOT NULL,
        status           TEXT NOT NULL DEFAULT 'scheduled',
        phase            TEXT,
        home_team_id     BIGINT NOT NULL REFERENCES core.dim_teams(team_id),
        away_team_id     BIGINT NOT NULL REFERENCES core.dim_teams(team_id),
        venue_id         BIGINT REFERENCES core.dim_venues(venue_id),
        referee_id       BIGINT REFERENCES core.dim_referees(referee_id),
        home_score       SMALLINT,
        away_score       SMALLINT,
        home_xg          REAL,
        away_xg          REAL,
        home_shots       REAL,
        away_shots       REAL,
        home_sot         REAL,
        away_sot         REAL,
        home_corners     REAL,
        away_corners     REAL,
        home_yellows     SMALLINT,
        away_yellows     SMALLINT,
        home_reds        SMALLINT,
        away_reds        SMALLINT,
        odds_home        REAL,
        odds_draw        REAL,
        odds_away        REAL,
        odds_over_2_5    REAL,
        attendance       INTEGER,
        source_ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
        fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (match_id, kickoff_utc)
    ) PARTITION BY RANGE (kickoff_utc)
    """,
    "CREATE INDEX IF NOT EXISTS ix_fm_competition_kickoff ON core.fact_matches (competition_id, kickoff_utc)",
    "CREATE INDEX IF NOT EXISTS ix_fm_home_kickoff ON core.fact_matches (home_team_id, kickoff_utc)",
    "CREATE INDEX IF NOT EXISTS ix_fm_away_kickoff ON core.fact_matches (away_team_id, kickoff_utc)",
    """
    CREATE TABLE IF NOT EXISTS core.fact_match_events (
        event_id         UUID NOT NULL,
        match_id         TEXT NOT NULL,
        period           SMALLINT,
        minute           SMALLINT,
        added_minute     SMALLINT,
        event_type       TEXT NOT NULL,
        team_id          BIGINT REFERENCES core.dim_teams(team_id),
        player_id        BIGINT REFERENCES core.dim_players(player_id),
        related_player_id BIGINT REFERENCES core.dim_players(player_id),
        x                REAL,
        y                REAL,
        body_part        TEXT,
        outcome          TEXT,
        xg               REAL,
        source           TEXT NOT NULL,
        source_ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (event_id, source_ts)
    ) PARTITION BY RANGE (source_ts)
    """,
    "CREATE INDEX IF NOT EXISTS ix_fme_match_ts ON core.fact_match_events (match_id, source_ts)",
    """
    CREATE TABLE IF NOT EXISTS core.fact_lineups (
        lineup_id        BIGSERIAL PRIMARY KEY,
        match_id         TEXT NOT NULL,
        team_id          BIGINT NOT NULL REFERENCES core.dim_teams(team_id),
        player_id        BIGINT NOT NULL REFERENCES core.dim_players(player_id),
        role             TEXT,
        position         TEXT,
        shirt_number     SMALLINT,
        is_starter       BOOLEAN NOT NULL DEFAULT FALSE,
        captain          BOOLEAN NOT NULL DEFAULT FALSE,
        sub_minute_in    SMALLINT,
        sub_minute_out   SMALLINT,
        source           TEXT,
        UNIQUE (match_id, team_id, player_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_lineups_match ON core.fact_lineups (match_id)",
    """
    CREATE TABLE IF NOT EXISTS core.fact_player_stats_match (
        match_id         TEXT NOT NULL,
        player_id        BIGINT NOT NULL REFERENCES core.dim_players(player_id),
        minutes          SMALLINT,
        goals            SMALLINT,
        assists          SMALLINT,
        shots            SMALLINT,
        sot              SMALLINT,
        passes           SMALLINT,
        pass_acc         REAL,
        key_passes       SMALLINT,
        xg               REAL,
        xa               REAL,
        tackles          SMALLINT,
        interceptions    SMALLINT,
        fouls            SMALLINT,
        yellow           BOOLEAN NOT NULL DEFAULT FALSE,
        red              BOOLEAN NOT NULL DEFAULT FALSE,
        rating           REAL,
        source           TEXT,
        PRIMARY KEY (match_id, player_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.fact_standings_snapshot (
        competition_id   TEXT NOT NULL REFERENCES core.dim_competitions(competition_id),
        season_id        TEXT NOT NULL REFERENCES core.dim_seasons(season_id),
        snapshot_date    DATE NOT NULL,
        team_id          BIGINT NOT NULL REFERENCES core.dim_teams(team_id),
        rank             SMALLINT,
        played           SMALLINT,
        won              SMALLINT,
        drawn            SMALLINT,
        lost             SMALLINT,
        gf               SMALLINT,
        ga               SMALLINT,
        gd               SMALLINT,
        points           SMALLINT,
        PRIMARY KEY (competition_id, season_id, snapshot_date, team_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.fact_player_team_membership (
        membership_id    BIGSERIAL PRIMARY KEY,
        player_id        BIGINT NOT NULL REFERENCES core.dim_players(player_id),
        team_id          BIGINT NOT NULL REFERENCES core.dim_teams(team_id),
        valid_from       DATE NOT NULL,
        valid_to         DATE,
        role             TEXT,
        source           TEXT,
        UNIQUE (player_id, team_id, valid_from)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.fact_transfers (
        transfer_id      BIGSERIAL PRIMARY KEY,
        player_id        BIGINT NOT NULL REFERENCES core.dim_players(player_id),
        from_team_id     BIGINT REFERENCES core.dim_teams(team_id),
        to_team_id       BIGINT REFERENCES core.dim_teams(team_id),
        fee_eur          BIGINT,
        window           TEXT,
        confirmed_date   DATE,
        source           TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.fact_player_injuries (
        injury_id        BIGSERIAL PRIMARY KEY,
        player_id        BIGINT NOT NULL REFERENCES core.dim_players(player_id),
        start_date       DATE NOT NULL,
        expected_return  DATE,
        end_date         DATE,
        injury_type      TEXT,
        severity         TEXT,
        source           TEXT,
        last_updated     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.fact_clubelo_ratings (
        team_id          BIGINT NOT NULL REFERENCES core.dim_teams(team_id) ON DELETE CASCADE,
        date             DATE NOT NULL,
        elo              REAL NOT NULL,
        PRIMARY KEY (team_id, date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.fact_weather (
        match_id         TEXT PRIMARY KEY,
        temp_c           REAL,
        precip_mm        REAL,
        wind_kmh         REAL,
        humidity         REAL,
        wind_dir_deg     REAL,
        is_outdoor       BOOLEAN NOT NULL DEFAULT TRUE
    )
    """,
)


# ---------------------------------------------------------------------------
# pipeline ops: ingest lineage, canonical identity, archive manifest
# ---------------------------------------------------------------------------

DDL_OPS = (
    """
    CREATE TABLE IF NOT EXISTS core.ingest_runs (
        run_id           BIGSERIAL PRIMARY KEY,
        source           TEXT NOT NULL,
        task             TEXT NOT NULL,
        started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at      TIMESTAMPTZ,
        rows_in          INTEGER,
        rows_out         INTEGER,
        status           TEXT NOT NULL DEFAULT 'running',
        error            TEXT,
        params           JSONB
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_ingest_runs_source ON core.ingest_runs (source, started_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS core.entity_aliases (
        kind             TEXT NOT NULL CHECK (kind IN ('team','player','match','competition','venue','referee')),
        source           TEXT NOT NULL,
        source_id        TEXT NOT NULL,
        canonical_id     TEXT NOT NULL,
        confidence       REAL NOT NULL DEFAULT 1.0,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, source, source_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_entity_aliases_canonical ON core.entity_aliases (kind, canonical_id)",
    """
    CREATE TABLE IF NOT EXISTS core.archive_manifest (
        manifest_id      BIGSERIAL PRIMARY KEY,
        schema_name      TEXT NOT NULL,
        table_name       TEXT NOT NULL,
        partition_key    TEXT NOT NULL,
        r2_object_key    TEXT NOT NULL,
        rows             BIGINT,
        bytes            BIGINT,
        sha256           TEXT,
        archived_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (schema_name, table_name, partition_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.pipeline_meta (
        key              TEXT PRIMARY KEY,
        value            JSONB NOT NULL,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
)


# ---------------------------------------------------------------------------
# raw landing tables (one per source, all share a generic shape)
# ---------------------------------------------------------------------------

RAW_SOURCES = (
    "espn", "fotmob", "fbref", "understat", "clubelo", "openfootball",
    "footballdata", "statsbomb", "wikidata", "api_football", "transfermarkt",
    "open_meteo",
)

DDL_RAW = tuple(
    f"""
    CREATE TABLE IF NOT EXISTS raw.{src} (
        ingest_id     BIGSERIAL PRIMARY KEY,
        source_id     TEXT,
        kind          TEXT NOT NULL,
        payload       JSONB NOT NULL,
        fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """
    for src in RAW_SOURCES
) + tuple(
    f"CREATE INDEX IF NOT EXISTS ix_raw_{src}_kind_fetched ON raw.{src} (kind, fetched_at DESC)"
    for src in RAW_SOURCES
)


# ---------------------------------------------------------------------------
# Order in which migrate_core() applies the DDL.
# ---------------------------------------------------------------------------

ALL_DDL = DDL_SCHEMAS + DDL_RAW + DDL_CORE_DIMS + DDL_CORE_FACTS + DDL_OPS
