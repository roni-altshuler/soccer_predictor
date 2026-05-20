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

SCHEMA_VERSION = 1

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
)


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
        with self._lock, self._conn:
            for stmt in _DDL_STATEMENTS:
                self._conn.execute(stmt)
            cur = self._conn.execute("SELECT MAX(version) FROM schema_version")
            row = cur.fetchone()
            current = (row[0] if row and row[0] is not None else 0)
            if current < SCHEMA_VERSION:
                self._conn.execute(
                    "INSERT INTO schema_version(version, applied_at) VALUES (?, ?)",
                    (SCHEMA_VERSION, datetime.now(timezone.utc).isoformat()),
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
