"""Baseline schema DDL — pure SQL, no Alembic, no SQLAlchemy.

Used by both the Alembic migration (executes each block in a transaction)
and the offline syntax validator (parses each block via libpg_query / pglast).
"""
from __future__ import annotations

EXTENSIONS = """
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS timescaledb;
"""

ENUMS = """
CREATE TYPE gender_t AS ENUM ('M','F');
CREATE TYPE match_status_t AS ENUM (
    'scheduled','live','half_time','full_time','extra_time',
    'penalties','final','postponed','cancelled','suspended','awarded'
);
CREATE TYPE event_type_t AS ENUM (
    'kick_off','goal','own_goal','penalty_scored','penalty_missed',
    'yellow_card','second_yellow','red_card','substitution',
    'var_review','injury','half_time','full_time','extra_time_start',
    'penalty_shootout','commentary'
);
CREATE TYPE competition_format_t AS ENUM ('league','cup','group_then_knockout','league_with_playoff');
CREATE TYPE prediction_kind_t AS ENUM ('pre_match','in_play','post_match_audit');
CREATE TYPE simulation_kind_t AS ENUM ('league_table','knockout_bracket','season_progression');
CREATE TYPE subscription_tier_t AS ENUM ('free','pro','enterprise');
CREATE TYPE model_status_t AS ENUM ('staged','canary','production','retired');
"""

TENANCY = """
CREATE TABLE users (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clerk_user_id    TEXT UNIQUE NOT NULL,
    email            CITEXT UNIQUE NOT NULL,
    display_name     TEXT,
    locale           TEXT NOT NULL DEFAULT 'en-US',
    preferred_gender gender_t,
    timezone         TEXT NOT NULL DEFAULT 'UTC',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ,
    deleted_at       TIMESTAMPTZ
);
CREATE INDEX idx_users_clerk_id ON users (clerk_user_id);

CREATE TABLE organizations (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    clerk_org_id     TEXT UNIQUE NOT NULL,
    name             TEXT NOT NULL,
    slug             CITEXT UNIQUE NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
    org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role             TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE subscriptions (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject_kind        TEXT NOT NULL CHECK (subject_kind IN ('user','organization')),
    subject_id          BIGINT NOT NULL,
    tier                subscription_tier_t NOT NULL DEFAULT 'free',
    stripe_customer_id  TEXT,
    stripe_sub_id       TEXT UNIQUE,
    current_period_end  TIMESTAMPTZ,
    trial_ends_at       TIMESTAMPTZ,
    status              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sub_per_subject ON subscriptions (subject_kind, subject_id)
    WHERE status IN ('active','trialing');

CREATE TABLE api_keys (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    key_prefix       TEXT NOT NULL,
    key_hash         BYTEA NOT NULL,
    scopes           TEXT[] NOT NULL DEFAULT '{read}',
    rate_tier        subscription_tier_t NOT NULL DEFAULT 'free',
    last_used_at     TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ,
    revoked_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_org    ON api_keys (org_id)     WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_prefix ON api_keys (key_prefix) WHERE revoked_at IS NULL;
"""

FOOTBALL_DOMAIN = """
CREATE TABLE competitions (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug              CITEXT UNIQUE NOT NULL,
    name              TEXT NOT NULL,
    country_code      CHAR(3),
    confederation     TEXT,
    gender            gender_t NOT NULL,
    format            competition_format_t NOT NULL,
    tier              SMALLINT,
    espn_slug         TEXT,
    fotmob_id         INT,
    fbref_id          TEXT,
    open_football_key TEXT,
    accent_hex        CHAR(7),
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_competition_espn ON competitions (espn_slug) WHERE espn_slug IS NOT NULL;
CREATE INDEX idx_competition_gender    ON competitions (gender, is_active);

CREATE TABLE seasons (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    competition_id   BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    is_current       BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (competition_id, name)
);
CREATE INDEX idx_seasons_current ON seasons (competition_id) WHERE is_current;

CREATE TABLE teams (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    canonical_name   TEXT NOT NULL,
    short_name       TEXT,
    tla              CHAR(3),
    country_code     CHAR(3),
    gender           gender_t NOT NULL,
    crest_url        TEXT,
    founded_year     SMALLINT,
    espn_id          TEXT,
    fotmob_id        INT,
    fbref_id         TEXT,
    understat_id     INT,
    clubelo_name     TEXT,
    venue_name       TEXT,
    venue_lat        NUMERIC(8,5),
    venue_lon        NUMERIC(8,5),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_teams_gender_country ON teams (gender, country_code);
CREATE INDEX idx_teams_canonical_trgm ON teams USING gin (canonical_name gin_trgm_ops);

CREATE TABLE team_source_aliases (
    team_id          BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    source           TEXT NOT NULL,
    source_team_id   TEXT NOT NULL,
    alias_name       TEXT,
    PRIMARY KEY (source, source_team_id)
);
CREATE INDEX idx_team_alias_team_id ON team_source_aliases (team_id);

CREATE TABLE players (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name        TEXT NOT NULL,
    known_as         TEXT,
    nationality_code CHAR(3),
    date_of_birth    DATE,
    gender           gender_t NOT NULL,
    primary_position TEXT,
    foot             TEXT CHECK (foot IN ('left','right','both')),
    height_cm        SMALLINT,
    espn_id          TEXT,
    fotmob_id        INT,
    fbref_id         TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_players_name_trgm ON players USING gin (full_name gin_trgm_ops);

CREATE TABLE squad_memberships (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    player_id        BIGINT NOT NULL REFERENCES players(id),
    team_id          BIGINT NOT NULL REFERENCES teams(id),
    season_id        BIGINT NOT NULL REFERENCES seasons(id),
    shirt_number     SMALLINT,
    joined_at        DATE,
    left_at          DATE,
    UNIQUE (player_id, team_id, season_id)
);
CREATE INDEX idx_squad_team_season ON squad_memberships (team_id, season_id);

CREATE TABLE matches (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    competition_id   BIGINT NOT NULL REFERENCES competitions(id),
    season_id        BIGINT NOT NULL REFERENCES seasons(id),
    gender           gender_t NOT NULL,
    home_team_id     BIGINT NOT NULL REFERENCES teams(id),
    away_team_id     BIGINT NOT NULL REFERENCES teams(id),
    kickoff_utc      TIMESTAMPTZ NOT NULL,
    matchday         SMALLINT,
    status           match_status_t NOT NULL DEFAULT 'scheduled',
    venue_name       TEXT,
    referee_name     TEXT,
    weather_payload  JSONB,
    home_score       SMALLINT,
    away_score       SMALLINT,
    home_score_ht    SMALLINT,
    away_score_ht    SMALLINT,
    home_score_et    SMALLINT,
    away_score_et    SMALLINT,
    home_score_pens  SMALLINT,
    away_score_pens  SMALLINT,
    source_ids       JSONB NOT NULL DEFAULT '{}'::jsonb,
    data_provenance  TEXT[] NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (home_team_id <> away_team_id)
);
CREATE INDEX idx_matches_competition_kickoff ON matches (competition_id, kickoff_utc DESC);
CREATE INDEX idx_matches_status_kickoff      ON matches (status, kickoff_utc)
    WHERE status IN ('scheduled','live','half_time','extra_time','penalties');
CREATE INDEX idx_matches_home_team           ON matches (home_team_id, kickoff_utc DESC);
CREATE INDEX idx_matches_away_team           ON matches (away_team_id, kickoff_utc DESC);
CREATE INDEX idx_matches_gender_date         ON matches (gender, kickoff_utc DESC);
CREATE INDEX idx_matches_kickoff_date        ON matches ((kickoff_utc::date));
"""

LIVE_TICKER = """
CREATE TABLE match_events (
    match_id          BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_seq         BIGINT NOT NULL,
    occurred_at       TIMESTAMPTZ NOT NULL,
    minute            SMALLINT,
    added_minute      SMALLINT,
    event_type        event_type_t NOT NULL,
    team_id           BIGINT REFERENCES teams(id),
    player_id         BIGINT REFERENCES players(id),
    related_player_id BIGINT REFERENCES players(id),
    payload           JSONB NOT NULL DEFAULT '{}',
    source            TEXT NOT NULL,
    ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, event_seq, occurred_at)
);
SELECT create_hypertable('match_events','occurred_at', chunk_time_interval => INTERVAL '7 days');
CREATE INDEX idx_match_events_match_recent
    ON match_events (match_id, occurred_at DESC);
SELECT add_retention_policy('match_events', INTERVAL '24 months');
SELECT add_compression_policy('match_events', INTERVAL '14 days');

CREATE TABLE match_stats (
    match_id         BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id          BIGINT NOT NULL REFERENCES teams(id),
    period           TEXT NOT NULL CHECK (period IN ('1H','2H','FT','ET','FULL')),
    shots            SMALLINT,
    shots_on_target  SMALLINT,
    xg               NUMERIC(5,3),
    xga              NUMERIC(5,3),
    possession_pct   NUMERIC(4,1),
    passes           INT,
    pass_accuracy_pct NUMERIC(4,1),
    corners          SMALLINT,
    fouls            SMALLINT,
    yellows          SMALLINT,
    reds             SMALLINT,
    saves            SMALLINT,
    payload          JSONB NOT NULL DEFAULT '{}',
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, team_id, period)
);

CREATE TABLE match_lineups (
    match_id         BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    team_id          BIGINT NOT NULL REFERENCES teams(id),
    player_id        BIGINT NOT NULL REFERENCES players(id),
    role             TEXT NOT NULL CHECK (role IN ('start','bench','sub_in','sub_out')),
    formation_slot   TEXT,
    position_x       NUMERIC(5,2),
    position_y       NUMERIC(5,2),
    is_captain       BOOLEAN NOT NULL DEFAULT false,
    rating           NUMERIC(3,1),
    PRIMARY KEY (match_id, team_id, player_id)
);
"""

# TimescaleDB requires the partitioning column to be part of every unique
# index, so the predictions PK is (id, generated_at, gender) — a deviation
# from the blueprint text but a hard requirement of gender-partitioned
# hypertables. See ADR-0006 for the trade-off discussion.
PREDICTIONS_AND_SIMS = """
CREATE TABLE prediction_models (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    family              TEXT NOT NULL,
    gender              gender_t NOT NULL,
    version             TEXT NOT NULL,
    git_sha             TEXT,
    mlflow_run_id       TEXT,
    artefact_uri        TEXT NOT NULL,
    scaler_uri          TEXT,
    calibrator_uri      TEXT,
    metadata            JSONB NOT NULL DEFAULT '{}',
    test_log_loss       NUMERIC(6,4),
    test_accuracy       NUMERIC(5,4),
    test_brier          NUMERIC(6,4),
    promoted_at         TIMESTAMPTZ,
    retired_at          TIMESTAMPTZ,
    status              model_status_t NOT NULL DEFAULT 'staged',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (family, gender, version)
);
CREATE INDEX idx_models_active
    ON prediction_models (family, gender, status)
    WHERE status IN ('canary','production');

CREATE TABLE predictions (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    match_id            BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    model_id            BIGINT NOT NULL REFERENCES prediction_models(id),
    kind                prediction_kind_t NOT NULL,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    gender              gender_t NOT NULL,
    p_home_win          NUMERIC(5,4) NOT NULL,
    p_draw              NUMERIC(5,4) NOT NULL,
    p_away_win          NUMERIC(5,4) NOT NULL,
    xg_home             NUMERIC(5,3),
    xg_away             NUMERIC(5,3),
    most_likely_score   TEXT,
    most_likely_score_p NUMERIC(5,4),
    score_grid          JSONB,
    confidence          NUMERIC(5,4),
    factors             JSONB,
    features_hash       TEXT,
    feature_snapshot    JSONB,
    PRIMARY KEY (id, generated_at, gender)
);
SELECT create_hypertable('predictions','generated_at',
    chunk_time_interval => INTERVAL '7 days',
    partitioning_column => 'gender',
    number_partitions   => 2);
CREATE INDEX idx_predictions_match_latest ON predictions (match_id, generated_at DESC);
CREATE INDEX idx_predictions_model        ON predictions (model_id, generated_at DESC);
SELECT add_compression_policy('predictions', INTERVAL '30 days');

CREATE TABLE prediction_outcomes (
    prediction_id    BIGINT NOT NULL,
    generated_at     TIMESTAMPTZ NOT NULL,
    match_id         BIGINT NOT NULL REFERENCES matches(id),
    outcome          CHAR(1) NOT NULL CHECK (outcome IN ('H','D','A')),
    log_loss         NUMERIC(7,4),
    brier            NUMERIC(7,4),
    score_match      BOOLEAN,
    settled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (prediction_id, generated_at)
);

CREATE TABLE simulations (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind              simulation_kind_t NOT NULL,
    competition_id    BIGINT NOT NULL REFERENCES competitions(id),
    season_id         BIGINT NOT NULL REFERENCES seasons(id),
    gender            gender_t NOT NULL,
    model_id          BIGINT REFERENCES prediction_models(id),
    n_iterations      INT NOT NULL,
    seed              BIGINT,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ,
    s3_result_uri     TEXT,
    summary           JSONB,
    input_hash        TEXT NOT NULL
);
CREATE INDEX idx_sim_latest_per_comp ON simulations (competition_id, kind, started_at DESC);
CREATE UNIQUE INDEX uq_sim_input_hash ON simulations (input_hash);

CREATE TABLE simulation_team_results (
    simulation_id         BIGINT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
    team_id               BIGINT NOT NULL REFERENCES teams(id),
    avg_points            NUMERIC(6,2),
    avg_goal_diff         NUMERIC(6,2),
    p_position_1          NUMERIC(5,4),
    position_distribution JSONB,
    p_title               NUMERIC(5,4),
    p_top_4               NUMERIC(5,4),
    p_top_6               NUMERIC(5,4),
    p_relegation          NUMERIC(5,4),
    PRIMARY KEY (simulation_id, team_id)
);
"""

USER_META = """
CREATE TABLE user_favorites (
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL CHECK (kind IN ('team','competition','match')),
    target_id        BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, target_id)
);

CREATE TABLE notification_subscriptions (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel          TEXT NOT NULL CHECK (channel IN ('web_push','email','webhook')),
    endpoint         TEXT,
    rule             JSONB NOT NULL,
    enabled          BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id               BIGINT GENERATED ALWAYS AS IDENTITY,
    actor_kind       TEXT NOT NULL CHECK (actor_kind IN ('user','api_key','system')),
    actor_id         BIGINT,
    action           TEXT NOT NULL,
    resource_kind    TEXT NOT NULL,
    resource_id      TEXT,
    payload          JSONB,
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, occurred_at)
);
SELECT create_hypertable('audit_log','occurred_at', chunk_time_interval => INTERVAL '30 days');
SELECT add_retention_policy('audit_log', INTERVAL '13 months');
"""

UPGRADE_BLOCKS: list[tuple[str, str]] = [
    ("extensions", EXTENSIONS),
    ("enums", ENUMS),
    ("tenancy", TENANCY),
    ("football_domain", FOOTBALL_DOMAIN),
    ("live_ticker", LIVE_TICKER),
    ("predictions_and_sims", PREDICTIONS_AND_SIMS),
    ("user_meta", USER_META),
]

DOWNGRADE_SQL = """
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS notification_subscriptions CASCADE;
DROP TABLE IF EXISTS user_favorites CASCADE;
DROP TABLE IF EXISTS simulation_team_results CASCADE;
DROP TABLE IF EXISTS simulations CASCADE;
DROP TABLE IF EXISTS prediction_outcomes CASCADE;
DROP TABLE IF EXISTS predictions CASCADE;
DROP TABLE IF EXISTS prediction_models CASCADE;
DROP TABLE IF EXISTS match_lineups CASCADE;
DROP TABLE IF EXISTS match_stats CASCADE;
DROP TABLE IF EXISTS match_events CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS squad_memberships CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS team_source_aliases CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;
DROP TABLE IF EXISTS competitions CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS model_status_t;
DROP TYPE IF EXISTS subscription_tier_t;
DROP TYPE IF EXISTS simulation_kind_t;
DROP TYPE IF EXISTS prediction_kind_t;
DROP TYPE IF EXISTS competition_format_t;
DROP TYPE IF EXISTS event_type_t;
DROP TYPE IF EXISTS match_status_t;
DROP TYPE IF EXISTS gender_t;
"""
