"""SQLite-backed match warehouse.

The warehouse is the single source of truth for historical match data used
by `backend/scripts/train_unified.py`. Every external source (ESPN,
football-data.co.uk, ClubElo, OpenFootball, FBref, Understat, Open-Meteo)
writes canonical rows here, and the training pipeline reads features from
joins over these tables — never from the original JSON caches.

Design choices
--------------
* **Pure stdlib `sqlite3`.** No ORM, no extra dependencies. Simple enough
  to inspect with the `sqlite3` CLI from anywhere.
* **Idempotent migrations.** `Warehouse.migrate()` creates tables and indexes
  if they don't exist; safe to call on every process start.
* **Upsert semantics.** Every loader writes via `INSERT OR REPLACE` keyed on
  `match_id` / `(team_id, date)` / etc. so re-running a loader cannot create
  duplicate rows but always reflects the newest source data.
* **Source provenance retained.** `matches.source` records which loader
  produced the row so a stats-quality audit can prefer e.g. Understat xG over
  FBref xG when both exist for the same match.
* **No async.** Warehouse writes happen during ETL, not on the request path.
  Keeping this synchronous avoids `aiosqlite` complexity.

Schema
------
* `teams(team_id, canonical_name, country, gender, venue_lat, venue_lon,
   venue_indoor)`
* `team_aliases(alias PRIMARY KEY, team_id)`  -- many aliases → one team
* `competitions(competition_id PRIMARY KEY, name, country, gender, tier,
   confederation)`
* `referees(referee_id PRIMARY KEY, name UNIQUE, country)`
* `matches(match_id PRIMARY KEY, source, competition_id, season, date_utc,
   home_team_id, away_team_id, home_score, away_score, phase, referee_id,
   home_shots, away_shots, home_sot, away_sot, home_corners, away_corners,
   home_yellows, away_yellows, home_reds, away_reds, home_xg, away_xg,
   attendance, odds_home, odds_draw, odds_away, odds_over_2_5, venue,
   fetched_at)`
* `clubelo_ratings(team_id, date, elo, PRIMARY KEY(team_id, date))`
* `weather(match_id PRIMARY KEY, temp_c, precip_mm, wind_kmh, humidity,
   wind_dir_deg, is_outdoor)`
* `player_form(team_id, date, squad_form, missing_top3, total_xg_available,
   PRIMARY KEY(team_id, date))`
* `match_events(match_id, seq, event_type, minute, added_time, team_side,
   player, source, PRIMARY KEY(match_id, seq))` -- minute-level goal/red-card
   timeline (schema v3, feeds the Rarity Engine)
* `match_event_coverage(match_id PRIMARY KEY, source, events, verified_at)`
   -- verification marker (schema v4). A row means the match's timeline was
   integrity-checked against its final score; `events = 0` marks a VERIFIED
   EMPTY timeline (0-0, no cards). Without this marker such matches are
   indistinguishable from never-backfilled ones, which biases the rarity
   engine's level-score denominators.
* `schema_version(version, applied_at)`
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# The warehouse lives under backend/data/. Resolved here so any caller can
# import it without hand-rolling paths.
WAREHOUSE_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "warehouse.sqlite"

# v1: original schema. v2: players/player_match_stats/lineups (applied to the
# live warehouse 2026-05-24 by a since-removed one-off migration — those tables
# exist in the data file but their DDL no longer lives here). v3: match_events
# (minute-level goal + red-card timeline for the Rarity Engine). v4:
# match_event_coverage (verified-empty marker; migrate() also backfills
# coverage rows for matches whose events were stored under v3).
SCHEMA_VERSION = 4

_DDL_STATEMENTS: Tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS teams (
        team_id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_name TEXT NOT NULL,
        country TEXT,
        gender TEXT NOT NULL CHECK (gender IN ('M','F')),
        venue_lat REAL,
        venue_lon REAL,
        venue_indoor INTEGER NOT NULL DEFAULT 0,
        UNIQUE(canonical_name, gender)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS team_aliases (
        alias TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('M','F')),
        team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        PRIMARY KEY (alias, gender)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS competitions (
        competition_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT,
        gender TEXT NOT NULL CHECK (gender IN ('M','F')),
        tier INTEGER,
        confederation TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS referees (
        referee_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        country TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        competition_id TEXT NOT NULL REFERENCES competitions(competition_id),
        season INTEGER NOT NULL,
        date_utc TEXT NOT NULL,
        home_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        away_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        home_score INTEGER,
        away_score INTEGER,
        phase TEXT,
        referee_id INTEGER REFERENCES referees(referee_id),
        home_shots REAL,
        away_shots REAL,
        home_sot REAL,
        away_sot REAL,
        home_corners REAL,
        away_corners REAL,
        home_yellows INTEGER,
        away_yellows INTEGER,
        home_reds INTEGER,
        away_reds INTEGER,
        home_xg REAL,
        away_xg REAL,
        attendance INTEGER,
        odds_home REAL,
        odds_draw REAL,
        odds_away REAL,
        odds_over_2_5 REAL,
        venue TEXT,
        fetched_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date_utc)",
    "CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(competition_id, season)",
    "CREATE INDEX IF NOT EXISTS idx_matches_home_team ON matches(home_team_id, date_utc)",
    "CREATE INDEX IF NOT EXISTS idx_matches_away_team ON matches(away_team_id, date_utc)",
    """
    CREATE TABLE IF NOT EXISTS clubelo_ratings (
        team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        elo REAL NOT NULL,
        PRIMARY KEY (team_id, date)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_clubelo_date ON clubelo_ratings(date)",
    """
    CREATE TABLE IF NOT EXISTS weather (
        match_id TEXT PRIMARY KEY REFERENCES matches(match_id) ON DELETE CASCADE,
        temp_c REAL,
        precip_mm REAL,
        wind_kmh REAL,
        humidity REAL,
        wind_dir_deg REAL,
        is_outdoor INTEGER NOT NULL DEFAULT 1
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS player_form (
        team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        squad_form REAL,
        missing_top3 INTEGER,
        total_xg_available REAL,
        PRIMARY KEY (team_id, date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS match_events (
        match_id   TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('goal','own_goal','penalty_goal','red_card')),
        minute     INTEGER NOT NULL CHECK (minute BETWEEN 1 AND 120),
        added_time INTEGER,
        team_side  TEXT NOT NULL CHECK (team_side IN ('home','away')),
        player     TEXT,
        source     TEXT NOT NULL,
        PRIMARY KEY (match_id, seq)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_match_events_match ON match_events(match_id)",
    """
    CREATE TABLE IF NOT EXISTS match_event_coverage (
        match_id    TEXT PRIMARY KEY,
        source      TEXT NOT NULL,
        events      INTEGER NOT NULL,
        verified_at TEXT NOT NULL
    )
    """,
)

# Event vocabulary for `match_events`. Own goals are credited to the SCORING
# side (the team awarded the goal), never the unlucky defender's team — so a
# per-side sum of goal-type events always reconciles with the final score.
GOAL_EVENT_TYPES: Tuple[str, ...] = ("goal", "own_goal", "penalty_goal")
EVENT_TYPES: Tuple[str, ...] = GOAL_EVENT_TYPES + ("red_card",)
TEAM_SIDES: Tuple[str, ...] = ("home", "away")


@dataclass
class MatchRow:
    """Canonical match row written into the warehouse.

    Every loader builds one of these per match, then bulk-inserts via
    `Warehouse.upsert_matches`. Optional fields are `None` when the source
    didn't provide them; never use synthetic placeholders — the training
    pipeline imputes missing values with NaN-aware logic.
    """

    match_id: str
    source: str
    competition_id: str
    season: int
    date_utc: str
    home_team_id: int
    away_team_id: int
    home_score: Optional[int]
    away_score: Optional[int]
    phase: Optional[str] = None
    referee_id: Optional[int] = None
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
    home_xg: Optional[float] = None
    away_xg: Optional[float] = None
    attendance: Optional[int] = None
    odds_home: Optional[float] = None
    odds_draw: Optional[float] = None
    odds_away: Optional[float] = None
    odds_over_2_5: Optional[float] = None
    venue: Optional[str] = None
    fetched_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def as_tuple(self) -> Tuple[Any, ...]:
        return (
            self.match_id,
            self.source,
            self.competition_id,
            self.season,
            self.date_utc,
            self.home_team_id,
            self.away_team_id,
            self.home_score,
            self.away_score,
            self.phase,
            self.referee_id,
            self.home_shots,
            self.away_shots,
            self.home_sot,
            self.away_sot,
            self.home_corners,
            self.away_corners,
            self.home_yellows,
            self.away_yellows,
            self.home_reds,
            self.away_reds,
            self.home_xg,
            self.away_xg,
            self.attendance,
            self.odds_home,
            self.odds_draw,
            self.odds_away,
            self.odds_over_2_5,
            self.venue,
            self.fetched_at,
        )


@dataclass
class MatchEvent:
    """One minute-stamped event inside a match.

    `minute` is the regulation minute (1..120); `added_time` carries stoppage
    minutes (e.g. a 90'+3' goal is `minute=90, added_time=3`), NULL when the
    event happened inside regulation. `team_side` is the CREDITED team: own
    goals belong to the side awarded the goal, not the defender's side.
    """

    event_type: str
    minute: int
    team_side: str
    added_time: Optional[int] = None
    player: Optional[str] = None

    def validate(self) -> None:
        if self.event_type not in EVENT_TYPES:
            raise ValueError(f"invalid event_type {self.event_type!r}")
        if self.team_side not in TEAM_SIDES:
            raise ValueError(f"invalid team_side {self.team_side!r}")
        if not isinstance(self.minute, int) or not (1 <= self.minute <= 120):
            raise ValueError(f"minute out of range: {self.minute!r}")
        if self.added_time is not None and (
            not isinstance(self.added_time, int) or self.added_time < 0
        ):
            raise ValueError(f"invalid added_time: {self.added_time!r}")


_MATCH_COLUMNS = (
    "match_id, source, competition_id, season, date_utc, home_team_id, away_team_id, "
    "home_score, away_score, phase, referee_id, home_shots, away_shots, home_sot, "
    "away_sot, home_corners, away_corners, home_yellows, away_yellows, home_reds, "
    "away_reds, home_xg, away_xg, attendance, odds_home, odds_draw, odds_away, "
    "odds_over_2_5, venue, fetched_at"
)
_MATCH_PLACEHOLDERS = ", ".join(["?"] * 30)


class Warehouse:
    """Thin wrapper over a `sqlite3.Connection` that exposes upsert helpers.

    Treat it as a unit of work — open one, run a batch of inserts, then close.
    Re-opening is cheap (SQLite is just a file).
    """

    def __init__(self, path: Path = WAREHOUSE_PATH):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), isolation_level=None, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")

    # ---- lifecycle ----

    def migrate(self) -> None:
        """Apply schema DDL. Idempotent."""
        now = datetime.now(timezone.utc).isoformat()
        with self._lock, self._conn:
            for stmt in _DDL_STATEMENTS:
                self._conn.execute(stmt)
            cur = self._conn.execute("SELECT MAX(version) FROM schema_version")
            row = cur.fetchone()
            current = (row[0] if row and row[0] is not None else 0)
            if current < 4:
                # v4 data fix: events stored under v3 predate the coverage
                # table but were integrity-verified at write time (the backfill
                # script is the only writer and always applies the score
                # guard), so derive their coverage rows. INSERT OR IGNORE
                # keeps this idempotent and never overwrites newer markers.
                self._conn.execute(
                    """
                    INSERT OR IGNORE INTO match_event_coverage(match_id, source, events, verified_at)
                    SELECT match_id, MIN(source), COUNT(*), ?
                    FROM match_events GROUP BY match_id
                    """,
                    (now,),
                )
            if current < SCHEMA_VERSION:
                self._conn.execute(
                    "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
                    (SCHEMA_VERSION, now),
                )

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Group multiple writes into one transaction for ETL speed."""
        with self._lock:
            try:
                self._conn.execute("BEGIN")
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    # ---- teams / aliases ----

    def upsert_team(
        self,
        canonical_name: str,
        gender: str,
        *,
        country: Optional[str] = None,
        venue_lat: Optional[float] = None,
        venue_lon: Optional[float] = None,
        venue_indoor: bool = False,
    ) -> int:
        """Insert team if missing; return its team_id."""
        with self._lock:
            cur = self._conn.execute(
                "SELECT team_id FROM teams WHERE canonical_name = ? AND gender = ?",
                (canonical_name, gender),
            )
            row = cur.fetchone()
            if row:
                team_id = row["team_id"]
                # Backfill venue/country if the new info is non-null.
                if country or venue_lat is not None or venue_lon is not None or venue_indoor:
                    self._conn.execute(
                        """
                        UPDATE teams
                        SET country = COALESCE(?, country),
                            venue_lat = COALESCE(?, venue_lat),
                            venue_lon = COALESCE(?, venue_lon),
                            venue_indoor = CASE WHEN ? THEN 1 ELSE venue_indoor END
                        WHERE team_id = ?
                        """,
                        (country, venue_lat, venue_lon, 1 if venue_indoor else 0, team_id),
                    )
                return int(team_id)

            cur = self._conn.execute(
                """
                INSERT INTO teams(canonical_name, country, gender, venue_lat, venue_lon, venue_indoor)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (canonical_name, country, gender, venue_lat, venue_lon, 1 if venue_indoor else 0),
            )
            return int(cur.lastrowid)

    def add_alias(self, alias: str, team_id: int, gender: str) -> None:
        if not alias:
            return
        with self._lock:
            self._conn.execute(
                """
                INSERT OR IGNORE INTO team_aliases(alias, gender, team_id)
                VALUES (?, ?, ?)
                """,
                (alias.strip(), gender, team_id),
            )

    def find_team_id_by_alias(self, alias: str, gender: str) -> Optional[int]:
        with self._lock:
            cur = self._conn.execute(
                """
                SELECT team_id FROM team_aliases WHERE alias = ? AND gender = ?
                UNION
                SELECT team_id FROM teams WHERE canonical_name = ? AND gender = ?
                LIMIT 1
                """,
                (alias.strip(), gender, alias.strip(), gender),
            )
            row = cur.fetchone()
            return int(row["team_id"]) if row else None

    # ---- competitions ----

    def upsert_competition(
        self,
        competition_id: str,
        name: str,
        gender: str,
        *,
        country: Optional[str] = None,
        tier: Optional[int] = None,
        confederation: Optional[str] = None,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO competitions(competition_id, name, country, gender, tier, confederation)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(competition_id) DO UPDATE SET
                    name = excluded.name,
                    country = COALESCE(excluded.country, competitions.country),
                    gender = excluded.gender,
                    tier = COALESCE(excluded.tier, competitions.tier),
                    confederation = COALESCE(excluded.confederation, competitions.confederation)
                """,
                (competition_id, name, country, gender, tier, confederation),
            )

    # ---- referees ----

    def upsert_referee(self, name: str, country: Optional[str] = None) -> Optional[int]:
        if not name:
            return None
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO referees(name, country) VALUES (?, ?)",
                (name.strip(), country),
            )
            cur = self._conn.execute(
                "SELECT referee_id FROM referees WHERE name = ?", (name.strip(),)
            )
            row = cur.fetchone()
            return int(row["referee_id"]) if row else None

    # ---- matches ----

    def upsert_matches(self, rows: Sequence[MatchRow]) -> int:
        """Bulk INSERT OR REPLACE. Returns row count written."""
        if not rows:
            return 0
        with self._lock, self._conn:
            self._conn.executemany(
                f"INSERT OR REPLACE INTO matches({_MATCH_COLUMNS}) VALUES ({_MATCH_PLACEHOLDERS})",
                [r.as_tuple() for r in rows],
            )
            return len(rows)

    def count_matches(
        self,
        *,
        competition_id: Optional[str] = None,
        gender: Optional[str] = None,
        since: Optional[str] = None,
    ) -> int:
        sql = "SELECT COUNT(*) AS n FROM matches m"
        clauses: List[str] = []
        args: List[Any] = []
        if gender is not None:
            sql += " JOIN competitions c ON c.competition_id = m.competition_id"
            clauses.append("c.gender = ?")
            args.append(gender)
        if competition_id is not None:
            clauses.append("m.competition_id = ?")
            args.append(competition_id)
        if since is not None:
            clauses.append("m.date_utc >= ?")
            args.append(since)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        with self._lock:
            cur = self._conn.execute(sql, args)
            return int(cur.fetchone()["n"])

    def iter_matches(
        self,
        *,
        gender: Optional[str] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
    ) -> Iterator[sqlite3.Row]:
        """Stream matches for training. Joins competition metadata for gender filter."""
        sql = """
            SELECT m.*, c.gender AS competition_gender, c.name AS competition_name,
                   c.country AS competition_country, c.tier AS competition_tier
            FROM matches m
            JOIN competitions c ON c.competition_id = m.competition_id
        """
        clauses: List[str] = []
        args: List[Any] = []
        if gender is not None:
            clauses.append("c.gender = ?")
            args.append(gender)
        if since is not None:
            clauses.append("m.date_utc >= ?")
            args.append(since)
        if until is not None:
            clauses.append("m.date_utc < ?")
            args.append(until)
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY m.date_utc ASC, m.match_id ASC"
        with self._lock:
            cur = self._conn.execute(sql, args)
            for row in cur:
                yield row

    # ---- match events (schema v3, Rarity Engine substrate) ----

    def upsert_match_events(
        self,
        match_id: str,
        events: Sequence[MatchEvent],
        source: str,
    ) -> int:
        """Replace ALL events for a match with `events` (idempotent re-runs).

        Events are validated and written in chronological order — sorted by
        (minute, added_time) with a stable sort so callers that already supply
        wall-clock order keep it for same-minute events. An empty `events`
        clears the match's timeline. Returns the number of events written.
        """
        if not source:
            raise ValueError("source is required")
        for ev in events:
            ev.validate()
        ordered = sorted(events, key=lambda e: (e.minute, e.added_time or 0))
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM match_events WHERE match_id = ?", (match_id,))
            self._conn.executemany(
                """
                INSERT INTO match_events(
                    match_id, seq, event_type, minute, added_time, team_side, player, source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (match_id, seq, e.event_type, e.minute, e.added_time, e.team_side, e.player, source)
                    for seq, e in enumerate(ordered)
                ],
            )
            return len(ordered)

    def get_match_events(self, match_id: str) -> List[sqlite3.Row]:
        """Chronological events for one match (empty list if none stored)."""
        with self._lock:
            cur = self._conn.execute(
                "SELECT * FROM match_events WHERE match_id = ? ORDER BY seq ASC",
                (match_id,),
            )
            return cur.fetchall()

    def record_event_coverage(self, match_id: str, source: str, events_count: int) -> None:
        """Mark a match's timeline as verified against its final score.

        `events_count = 0` is meaningful: a VERIFIED EMPTY timeline (0-0, no
        cards). Integrity-mismatched matches must never get a coverage row —
        they stay honestly uncovered.
        """
        if not source:
            raise ValueError("source is required")
        if events_count < 0:
            raise ValueError(f"invalid events_count: {events_count!r}")
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO match_event_coverage(match_id, source, events, verified_at)
                VALUES (?, ?, ?, ?)
                """,
                (match_id, source, events_count, datetime.now(timezone.utc).isoformat()),
            )

    # Coverage source per match: the coverage marker is authoritative; event
    # rows without a marker (direct upsert_match_events callers) fall back to
    # their own source. MIN() collapses the (should-never-diverge) duplicates.
    _COVERAGE_SOURCE_SQL = """
        SELECT match_id, MIN(source) AS source FROM (
            SELECT match_id, source FROM match_event_coverage
            UNION ALL
            SELECT DISTINCT match_id, source FROM match_events
        ) GROUP BY match_id
    """

    def event_sources(self) -> Dict[str, str]:
        """match_id → source that covered the match (verified-empty included).

        Used by the backfill script to apply source precedence
        (espn > understat > openfootball) without a query per candidate.
        """
        with self._lock:
            cur = self._conn.execute(self._COVERAGE_SOURCE_SQL)
            return {row["match_id"]: row["source"] for row in cur.fetchall()}

    def iter_matches_missing_events(
        self,
        *,
        source: Optional[str] = None,
        competition: Optional[str] = None,
        since: Optional[str] = None,
        season: Optional[int] = None,
        replaceable_sources: Sequence[str] = (),
    ) -> Iterator[sqlite3.Row]:
        """Completed matches whose timeline is not yet COVERED (newest first).

        Coverage-aware: a verified-empty match (coverage row with events = 0)
        counts as covered and is NOT yielded — it must not be re-attempted.
        `source`/`competition`/`since`/`season` filter on the matches table.
        `replaceable_sources` additionally yields matches whose existing
        coverage came from one of those (worse-precedence) sources, so a
        later ESPN pass can upgrade an Understat-verified match. Each row
        carries an extra `events_source` column (NULL when uncovered).
        """
        sql = f"""
            SELECT m.*, e.source AS events_source
            FROM matches m
            LEFT JOIN ({self._COVERAGE_SOURCE_SQL}) e ON e.match_id = m.match_id
            WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        """
        args: List[Any] = []
        if replaceable_sources:
            placeholders = ", ".join(["?"] * len(replaceable_sources))
            sql += f" AND (e.source IS NULL OR e.source IN ({placeholders}))"
            args.extend(replaceable_sources)
        else:
            sql += " AND e.source IS NULL"
        if source is not None:
            sql += " AND m.source = ?"
            args.append(source)
        if competition is not None:
            sql += " AND m.competition_id = ?"
            args.append(competition)
        if since is not None:
            sql += " AND m.date_utc >= ?"
            args.append(since)
        if season is not None:
            sql += " AND m.season = ?"
            args.append(season)
        sql += " ORDER BY m.date_utc DESC, m.match_id ASC"
        with self._lock:
            cur = self._conn.execute(sql, args)
            for row in cur:
                yield row

    def events_coverage(self) -> List[Dict[str, Any]]:
        """Per-competition coverage of completed matches.

        A match is COVERED when it has a coverage marker (or, for direct
        upsert_match_events callers, stored event rows). `verified_empty`
        counts covered matches with zero events (0-0, no cards) — they are
        full timelines of level states and must be inside the rarity
        engine's denominators.
        """
        with self._lock:
            cur = self._conn.execute(
                """
                SELECT m.competition_id, c.name, c.gender,
                       COUNT(*) AS matches,
                       SUM(CASE WHEN cov.match_id IS NOT NULL THEN 1 ELSE 0 END) AS covered,
                       SUM(CASE WHEN cov.n_events > 0 THEN 1 ELSE 0 END) AS with_events,
                       SUM(CASE WHEN cov.match_id IS NOT NULL AND cov.n_events = 0
                                THEN 1 ELSE 0 END) AS verified_empty,
                       SUM(CASE WHEN cov.match_id IS NULL THEN 1 ELSE 0 END) AS without_events,
                       COALESCE(SUM(cov.n_events), 0) AS events
                FROM matches m
                LEFT JOIN competitions c ON c.competition_id = m.competition_id
                LEFT JOIN (
                    SELECT
                        COALESCE(mc.match_id, e.match_id) AS match_id,
                        COALESCE(e.n_events, 0) AS n_events
                    FROM match_event_coverage mc
                    LEFT JOIN (
                        SELECT match_id, COUNT(*) AS n_events FROM match_events GROUP BY match_id
                    ) e ON e.match_id = mc.match_id
                    UNION
                    SELECT e2.match_id, e2.n_events
                    FROM (
                        SELECT match_id, COUNT(*) AS n_events FROM match_events GROUP BY match_id
                    ) e2
                    WHERE e2.match_id NOT IN (SELECT match_id FROM match_event_coverage)
                ) cov ON cov.match_id = m.match_id
                WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
                GROUP BY m.competition_id, c.name, c.gender
                ORDER BY matches DESC
                """
            )
            out: List[Dict[str, Any]] = []
            for r in cur.fetchall():
                d = dict(r)
                d["coverage"] = round(d["covered"] / d["matches"], 4) if d["matches"] else 0.0
                out.append(d)
            return out

    # ---- clubelo, weather, player_form ----

    def upsert_clubelo(self, rows: Iterable[Tuple[int, str, float]]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT OR REPLACE INTO clubelo_ratings(team_id, date, elo) VALUES (?, ?, ?)",
                rows,
            )
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
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO weather(
                    match_id, temp_c, precip_mm, wind_kmh, humidity, wind_dir_deg, is_outdoor
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (match_id, temp_c, precip_mm, wind_kmh, humidity, wind_dir_deg, 1 if is_outdoor else 0),
            )

    def upsert_player_form(
        self,
        team_id: int,
        date_utc: str,
        *,
        squad_form: Optional[float],
        missing_top3: Optional[int],
        total_xg_available: Optional[float] = None,
    ) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO player_form(
                    team_id, date, squad_form, missing_top3, total_xg_available
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (team_id, date_utc, squad_form, missing_top3, total_xg_available),
            )

    # ---- venues ----

    def set_team_venue(
        self,
        team_id: int,
        *,
        venue_lat: Optional[float],
        venue_lon: Optional[float],
        venue_indoor: bool = False,
    ) -> None:
        """Set (not COALESCE) a team's home-venue coordinates.

        `upsert_team` only ever fills NULLs, which makes it impossible to
        correct a wrong coordinate. The venue loader needs an authoritative
        write, so it uses this. Passing None genuinely clears the value —
        an unresolved venue must stay missing, never be back-filled with a
        city centre or a neighbouring ground.
        """
        with self._lock, self._conn:
            self._conn.execute(
                """
                UPDATE teams
                SET venue_lat = ?, venue_lon = ?, venue_indoor = ?
                WHERE team_id = ?
                """,
                (venue_lat, venue_lon, 1 if venue_indoor else 0, team_id),
            )

    # ---- integrity repair ----
    #
    # These exist because a warehouse built before the 2026-08-08 ingest
    # fixes carries damage that a re-run of the loaders cannot undo on its
    # own (rows are keyed by match_id, so a duplicate inserted under a
    # split team identity survives any number of idempotent re-runs).

    # Columns worth counting when deciding which of two duplicate rows is
    # the "richer" one, and which get coalesced into the survivor.
    _MERGEABLE_COLUMNS: Tuple[str, ...] = (
        "home_score", "away_score", "phase", "referee_id",
        "home_shots", "away_shots", "home_sot", "away_sot",
        "home_corners", "away_corners", "home_yellows", "away_yellows",
        "home_reds", "away_reds", "home_xg", "away_xg", "attendance",
        "odds_home", "odds_draw", "odds_away", "odds_over_2_5", "venue",
    )

    def merge_teams(self, src_team_id: int, dst_team_id: int) -> Dict[str, int]:
        """Repoint everything owned by `src_team_id` onto `dst_team_id`, then
        delete the source team.

        Used to heal split identities, where football-data's spelling of a
        club created a second `teams` row and half its history landed there.
        Does NOT deduplicate the fixtures the split produced — call
        `merge_duplicate_fixtures()` afterwards, since repointing is exactly
        what makes those duplicates visible.
        """
        if src_team_id == dst_team_id:
            return {"matches": 0, "aliases": 0, "clubelo": 0, "player_form": 0}
        counts: Dict[str, int] = {}
        with self._lock, self._conn:
            row = self._conn.execute(
                "SELECT canonical_name, gender FROM teams WHERE team_id = ?", (src_team_id,)
            ).fetchone()
            if row is None:
                raise ValueError(f"source team {src_team_id} does not exist")
            dst = self._conn.execute(
                "SELECT gender FROM teams WHERE team_id = ?", (dst_team_id,)
            ).fetchone()
            if dst is None:
                raise ValueError(f"destination team {dst_team_id} does not exist")
            if dst["gender"] != row["gender"]:
                raise ValueError(
                    f"refusing to merge across genders: {src_team_id} is "
                    f"{row['gender']}, {dst_team_id} is {dst['gender']}"
                )

            cur = self._conn.execute(
                "UPDATE matches SET home_team_id = ? WHERE home_team_id = ?",
                (dst_team_id, src_team_id),
            )
            moved = cur.rowcount
            cur = self._conn.execute(
                "UPDATE matches SET away_team_id = ? WHERE away_team_id = ?",
                (dst_team_id, src_team_id),
            )
            counts["matches"] = moved + cur.rowcount

            # The old spelling becomes an alias of the surviving team so a
            # later ingest resolves it correctly even without the YAML pin.
            self._conn.execute(
                "INSERT OR IGNORE INTO team_aliases(alias, gender, team_id) VALUES (?, ?, ?)",
                (row["canonical_name"], row["gender"], dst_team_id),
            )
            cur = self._conn.execute(
                "UPDATE OR IGNORE team_aliases SET team_id = ? WHERE team_id = ?",
                (dst_team_id, src_team_id),
            )
            counts["aliases"] = cur.rowcount
            self._conn.execute("DELETE FROM team_aliases WHERE team_id = ?", (src_team_id,))

            cur = self._conn.execute(
                "UPDATE OR IGNORE clubelo_ratings SET team_id = ? WHERE team_id = ?",
                (dst_team_id, src_team_id),
            )
            counts["clubelo"] = cur.rowcount
            self._conn.execute("DELETE FROM clubelo_ratings WHERE team_id = ?", (src_team_id,))

            cur = self._conn.execute(
                "UPDATE OR IGNORE player_form SET team_id = ? WHERE team_id = ?",
                (dst_team_id, src_team_id),
            )
            counts["player_form"] = cur.rowcount
            self._conn.execute("DELETE FROM player_form WHERE team_id = ?", (src_team_id,))

            # The remaining three tables that point at teams(team_id). None of
            # them carries ON DELETE CASCADE, so a single surviving row makes
            # the final DELETE raise "FOREIGN KEY constraint failed" and aborts
            # the whole merge. That is exactly what happened re-running the
            # 2026-08-08 repair against a warehouse whose player tables were
            # populated — the repair machine's were empty, so it never fired.
            counts.update(self._repoint_player_tables(src_team_id, dst_team_id))

            self._conn.execute("DELETE FROM teams WHERE team_id = ?", (src_team_id,))
        return counts

    def _repoint_player_tables(self, src_team_id: int, dst_team_id: int) -> Dict[str, int]:
        """Move players, appearances and lineups off a club about to be deleted.

        Each table needs different care because each has a different key:

        - `player_match_stats` is keyed (match_id, player_id), so `team_id` is
          never part of a uniqueness constraint and a plain UPDATE is safe.
        - `lineups` is keyed (match_id, team_id, player_id), so the same player
          in the same match under both club spellings collides. That only
          happens on a duplicated fixture, where the leftover row is a genuine
          duplicate and dropping it loses nothing.
        - `players` is UNIQUE(name, gender, current_team_id), so the same
          person exists twice — once under each spelling. The loser must be
          *folded* into the survivor rather than deleted, because deleting it
          would cascade its appearances and lineups away with it.
        """
        counts: Dict[str, int] = {}

        cur = self._conn.execute(
            "UPDATE player_match_stats SET team_id = ? WHERE team_id = ?",
            (dst_team_id, src_team_id),
        )
        counts["player_match_stats"] = cur.rowcount

        cur = self._conn.execute(
            "UPDATE OR IGNORE lineups SET team_id = ? WHERE team_id = ?",
            (dst_team_id, src_team_id),
        )
        counts["lineups"] = cur.rowcount
        self._conn.execute("DELETE FROM lineups WHERE team_id = ?", (src_team_id,))

        cur = self._conn.execute(
            "UPDATE OR IGNORE players SET current_team_id = ? WHERE current_team_id = ?",
            (dst_team_id, src_team_id),
        )
        counts["players"] = cur.rowcount

        # Whatever still points at the source club is a name collision with a
        # twin already sitting on the destination. Fold each loser into its
        # twin, then remove the now-empty duplicate row.
        folded = 0
        stragglers = self._conn.execute(
            "SELECT player_id, name, gender FROM players WHERE current_team_id = ?",
            (src_team_id,),
        ).fetchall()
        for dup in stragglers:
            survivor = self._conn.execute(
                "SELECT player_id FROM players "
                "WHERE name = ? AND gender = ? AND current_team_id = ?",
                (dup["name"], dup["gender"], dst_team_id),
            ).fetchone()
            if survivor is None:
                # No twin after all — the UPDATE was ignored for some other
                # reason. Detach rather than delete: a player with no current
                # club is a known state, a deleted player is lost history.
                self._conn.execute(
                    "UPDATE players SET current_team_id = NULL WHERE player_id = ?",
                    (dup["player_id"],),
                )
                continue
            for table in ("player_match_stats", "lineups"):
                self._conn.execute(
                    f"UPDATE OR IGNORE {table} SET player_id = ? WHERE player_id = ?",
                    (survivor["player_id"], dup["player_id"]),
                )
                self._conn.execute(
                    f"DELETE FROM {table} WHERE player_id = ?", (dup["player_id"],)
                )
            self._conn.execute(
                "DELETE FROM players WHERE player_id = ?", (dup["player_id"],)
            )
            folded += 1
        counts["players_folded"] = folded
        return counts

    def find_duplicate_fixtures(self) -> List[Dict[str, Any]]:
        """Groups of >1 row sharing (competition, season, home, away)."""
        with self._lock:
            cur = self._conn.execute(
                """
                SELECT competition_id, season, home_team_id, away_team_id,
                       COUNT(*) AS n, GROUP_CONCAT(match_id, '|') AS match_ids
                FROM matches
                GROUP BY competition_id, season, home_team_id, away_team_id
                HAVING n > 1
                ORDER BY n DESC, competition_id, season
                """
            )
            out = []
            for r in cur.fetchall():
                d = dict(r)
                d["match_ids"] = (d.pop("match_ids") or "").split("|")
                out.append(d)
            return out

    def merge_duplicate_fixtures(self, *, dry_run: bool = False) -> Dict[str, Any]:
        """Collapse duplicate (competition, season, home, away) rows.

        The survivor is the row with the most populated columns, tie-broken
        toward `source='espn'` because ESPN rows carry a true UTC kickoff
        while football-data rows only know the calendar date. Every column
        the survivor is missing is then coalesced in from the rows being
        dropped, so nothing (odds, referee, shots, xG) is lost — "keep the
        richest row" is implemented as "keep one row and make it the union".
        """
        groups = self.find_duplicate_fixtures()
        removed: List[str] = []
        fields_filled = 0

        for group in groups:
            with self._lock:
                rows = self._conn.execute(
                    f"""
                    SELECT match_id, source, date_utc, {", ".join(self._MERGEABLE_COLUMNS)}
                    FROM matches
                    WHERE competition_id = ? AND season = ?
                      AND home_team_id = ? AND away_team_id = ?
                    """,
                    (
                        group["competition_id"], group["season"],
                        group["home_team_id"], group["away_team_id"],
                    ),
                ).fetchall()
            if len(rows) < 2:
                continue

            def richness(r: sqlite3.Row) -> Tuple[int, int, str]:
                filled = sum(1 for c in self._MERGEABLE_COLUMNS if r[c] is not None)
                # espn wins ties: it is the only source with a real kickoff.
                return (filled, 1 if r["source"] == "espn" else 0, r["match_id"])

            ordered = sorted(rows, key=richness, reverse=True)
            keeper, losers = ordered[0], ordered[1:]

            patch: Dict[str, Any] = {}
            for column in self._MERGEABLE_COLUMNS:
                if keeper[column] is not None:
                    continue
                for loser in losers:
                    if loser[column] is not None:
                        patch[column] = loser[column]
                        break
            loser_ids = [r["match_id"] for r in losers]

            if dry_run:
                removed.extend(loser_ids)
                fields_filled += len(patch)
                continue

            with self._lock, self._conn:
                if patch:
                    assignments = ", ".join(f"{c} = ?" for c in patch)
                    self._conn.execute(
                        f"UPDATE matches SET {assignments} WHERE match_id = ?",
                        (*patch.values(), keeper["match_id"]),
                    )
                    fields_filled += len(patch)
                placeholders = ", ".join(["?"] * len(loser_ids))
                # Dependent rows first; match_events has no FK to cascade.
                self._conn.execute(
                    f"DELETE FROM match_events WHERE match_id IN ({placeholders})", loser_ids
                )
                self._conn.execute(
                    f"DELETE FROM match_event_coverage WHERE match_id IN ({placeholders})",
                    loser_ids,
                )
                self._conn.execute(
                    f"DELETE FROM weather WHERE match_id IN ({placeholders})", loser_ids
                )
                self._conn.execute(
                    f"DELETE FROM matches WHERE match_id IN ({placeholders})", loser_ids
                )
            removed.extend(loser_ids)

        return {
            "groups": len(groups),
            "rows_removed": len(removed),
            "fields_coalesced": fields_filled,
            "removed_ids": removed,
        }

    def find_orphan_teams(self) -> List[Dict[str, Any]]:
        """Teams with no match on either side."""
        with self._lock:
            cur = self._conn.execute(
                """
                SELECT t.team_id, t.canonical_name, t.gender
                FROM teams t
                WHERE NOT EXISTS (
                    SELECT 1 FROM matches m
                    WHERE m.home_team_id = t.team_id OR m.away_team_id = t.team_id
                )
                ORDER BY t.team_id
                """
            )
            return [dict(r) for r in cur.fetchall()]

    def delete_orphan_teams(self) -> int:
        """Remove zero-match teams (and their aliases/ratings).

        These are created by eagerly materialising every `team_aliases.yml`
        entry. The resolver no longer does that, so this is a one-off clean
        of warehouses built before the fix.
        """
        orphans = [t["team_id"] for t in self.find_orphan_teams()]
        if not orphans:
            return 0
        placeholders = ", ".join(["?"] * len(orphans))
        with self._lock, self._conn:
            self._conn.execute(
                f"DELETE FROM team_aliases WHERE team_id IN ({placeholders})", orphans
            )
            self._conn.execute(
                f"DELETE FROM clubelo_ratings WHERE team_id IN ({placeholders})", orphans
            )
            self._conn.execute(
                f"DELETE FROM player_form WHERE team_id IN ({placeholders})", orphans
            )
            # A team with no matches can still be some player's current club —
            # `players.current_team_id` has no ON DELETE CASCADE, so leaving it
            # set makes the DELETE below raise FOREIGN KEY constraint failed.
            # Detach rather than delete: the club is going away, the player is
            # not.
            self._conn.execute(
                f"UPDATE players SET current_team_id = NULL "
                f"WHERE current_team_id IN ({placeholders})",
                orphans,
            )
            # Appearances and lineups can also still point at an orphan, and
            # such a row is incoherent by definition: it credits a player to a
            # club that is not one of the two sides in that match. Measured on
            # the 2026-08-10 warehouse there were 504, every one of them
            # attached to a LIVE match whose participants were the surviving
            # merged identities — the club merge repointed `matches` but these
            # rows kept the dead id. They carry no recoverable information, so
            # they go with the club.
            for table in ("player_match_stats", "lineups"):
                self._conn.execute(
                    f"DELETE FROM {table} WHERE team_id IN ({placeholders})", orphans
                )
            self._conn.execute(f"DELETE FROM teams WHERE team_id IN ({placeholders})", orphans)
        return len(orphans)

    # ---- introspection ----

    def stats_by_competition(self) -> List[Dict[str, Any]]:
        """Quick sanity-check counts used by build_warehouse.py and CI."""
        with self._lock:
            cur = self._conn.execute(
                """
                SELECT m.competition_id, c.name, c.gender,
                       COUNT(*) AS matches,
                       MIN(m.date_utc) AS first_match,
                       MAX(m.date_utc) AS last_match
                FROM matches m
                LEFT JOIN competitions c ON c.competition_id = m.competition_id
                GROUP BY m.competition_id, c.name, c.gender
                ORDER BY matches DESC
                """
            )
            return [dict(r) for r in cur.fetchall()]


@contextmanager
def open_warehouse(path: Path = WAREHOUSE_PATH) -> Iterator[Warehouse]:
    """Open the warehouse, run migrations, yield it, then close."""
    wh = Warehouse(path)
    try:
        wh.migrate()
        yield wh
    finally:
        wh.close()
