"""Every forecast we ever published, kept exactly as it was published.

The property this exists to guarantee
-------------------------------------
`season_fixtures.json` is a *current* view. It is overwritten three times a
day, and after kickoff it stops mentioning the match entirely. That makes it
useless for the only question that can ever falsify this product:

    "What were users actually shown before that match, and was it right?"

Answering it after the fact requires the forecast to have been written down at
the time, never rewritten, and tied to a known model. So this table is
**append-only**: a re-run inserts a new row rather than updating an old one,
and `(fixture_uid, generated_at, model_version)` is the primary key so an
idempotent re-run within the same second is a no-op rather than a duplicate.

Nothing in this module ever issues UPDATE or DELETE against
`prediction_snapshots`. That is enforced by a test, not by convention.

Choosing the canonical record
-----------------------------
Forecasts move as kickoff approaches: results land, ratings shift, and the
three-times-daily job publishes again. All of those rows are kept, but exactly
one of them is what a user could have acted on — the LAST one generated before
kickoff. `final_before_kickoff()` is that selection, and it is the row the live
evaluation scores. Scoring anything else either flatters the model (a snapshot
taken after kickoff) or misrepresents it (the first snapshot, a week stale).

Why here and not in a new database
----------------------------------
`warehouse.sqlite` already holds `matches`, `teams` and `knockout_results`, and
the evaluation join is against `matches`. A separate store would mean a
cross-database join for the one query this table exists to serve.
"""
from __future__ import annotations

import hashlib
import logging
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger("forecast.snapshots")

ROOT = Path(__file__).resolve().parent.parent.parent.parent
WAREHOUSE = ROOT / "backend" / "data" / "warehouse.sqlite"

DDL = """
CREATE TABLE IF NOT EXISTS prediction_snapshots (
    fixture_uid    TEXT NOT NULL,
    generated_at   TEXT NOT NULL,
    model_version  TEXT NOT NULL,

    competition_id TEXT NOT NULL,
    season         INTEGER NOT NULL,
    kickoff_at     TEXT NOT NULL,
    home_team      TEXT NOT NULL,
    away_team      TEXT NOT NULL,

    p_home         REAL NOT NULL,
    p_draw         REAL NOT NULL,
    p_away         REAL NOT NULL,
    lambda_home    REAL NOT NULL,
    lambda_away    REAL NOT NULL,

    -- Enough to audit or reproduce the row without storing a blob: the two
    -- ratings are the model's entire view of the two clubs, and
    -- `trained_through` says how much of the world it had seen.
    elo_home       REAL,
    elo_away       REAL,
    trained_through TEXT,
    top_scoreline  TEXT,
    top_scoreline_p REAL,

    PRIMARY KEY (fixture_uid, generated_at, model_version)
);
CREATE INDEX IF NOT EXISTS idx_snap_kickoff
    ON prediction_snapshots(kickoff_at);
CREATE INDEX IF NOT EXISTS idx_snap_fixture
    ON prediction_snapshots(fixture_uid, generated_at);
CREATE INDEX IF NOT EXISTS idx_snap_version
    ON prediction_snapshots(model_version);
"""


def fixture_uid(competition_id: str, season: int, date: str,
                home: str, away: str) -> str:
    """Stable across re-runs and across sources.

    Deliberately keyed on the DATE rather than the kickoff instant: kickoff
    times get corrected upstream, and a fixture whose time moved by an hour is
    the same fixture. A uid that changed with it would fork the history of the
    match it exists to track.
    """
    raw = f"{competition_id}|{season}|{date[:10]}|{home.strip().lower()}|{away.strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


@dataclass(frozen=True)
class Snapshot:
    fixture_uid: str
    generated_at: str
    model_version: str
    competition_id: str
    season: int
    kickoff_at: str
    home_team: str
    away_team: str
    p_home: float
    p_draw: float
    p_away: float
    lambda_home: float
    lambda_away: float
    elo_home: Optional[float] = None
    elo_away: Optional[float] = None
    trained_through: Optional[str] = None
    top_scoreline: Optional[str] = None
    top_scoreline_p: Optional[float] = None

    def validate(self) -> None:
        total = self.p_home + self.p_draw + self.p_away
        if not (0.999 <= total <= 1.001):
            raise ValueError(
                f"{self.home_team} v {self.away_team}: probabilities sum to "
                f"{total:.6f}, not 1. A snapshot is a permanent record; an "
                f"invalid one is worse than a missing one.")
        for name, p in (("p_home", self.p_home), ("p_draw", self.p_draw),
                        ("p_away", self.p_away)):
            if not (0.0 < p < 1.0):
                raise ValueError(f"{name}={p} is not a probability")
        for name, lam in (("lambda_home", self.lambda_home),
                          ("lambda_away", self.lambda_away)):
            if not (0.0 < lam < 12.0):
                raise ValueError(f"{name}={lam} is not a plausible goal rate")


class SnapshotStore:
    """Append-only reader/writer over `prediction_snapshots`."""

    def __init__(self, db: Optional[Path] = None) -> None:
        self.path = Path(db or WAREHOUSE)
        self._conn: Optional[sqlite3.Connection] = None

    def __enter__(self) -> "SnapshotStore":
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def connect(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self.path))
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA busy_timeout=30000")
            self._conn.executescript(DDL)
            self._conn.commit()
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    # -- write ------------------------------------------------------------
    def record(self, snapshots: Sequence[Snapshot]) -> int:
        """Append. Never updates, never deletes.

        `INSERT OR IGNORE` rather than `OR REPLACE`: re-running the job in the
        same second with the same model must be a no-op, not a rewrite of what
        was already published.
        """
        if not snapshots:
            return 0
        for s in snapshots:
            s.validate()
        conn = self.connect()
        cols = list(asdict(snapshots[0]).keys())
        sql = (f"INSERT OR IGNORE INTO prediction_snapshots "
               f"({','.join(cols)}) VALUES ({','.join('?' * len(cols))})")
        before = conn.execute(
            "SELECT COUNT(*) FROM prediction_snapshots").fetchone()[0]
        with conn:
            conn.executemany(sql, [tuple(asdict(s)[c] for c in cols)
                                   for s in snapshots])
        after = conn.execute(
            "SELECT COUNT(*) FROM prediction_snapshots").fetchone()[0]
        written = after - before
        if written < len(snapshots):
            logger.info("%d of %d snapshots already recorded — left untouched",
                        len(snapshots) - written, len(snapshots))
        return written

    # -- read -------------------------------------------------------------
    def final_before_kickoff(self, *, competition_id: Optional[str] = None,
                             model_version: Optional[str] = None,
                             played_only: bool = False) -> List[Dict[str, Any]]:
        """The one forecast per fixture a user could actually have acted on.

        Strictly `generated_at < kickoff_at`. A snapshot generated after
        kickoff is not a forecast and must never reach an evaluation, however
        convenient its timestamp looks.
        """
        conn = self.connect()
        where = ["s.generated_at < s.kickoff_at"]
        params: List[Any] = []
        if competition_id:
            where.append("s.competition_id = ?")
            params.append(competition_id)
        if model_version:
            where.append("s.model_version = ?")
            params.append(model_version)
        sql = f"""
            SELECT s.* FROM prediction_snapshots s
             WHERE {' AND '.join(where)}
             GROUP BY s.fixture_uid
            HAVING s.generated_at = MAX(s.generated_at)
             ORDER BY s.kickoff_at
        """
        rows = [dict(r) for r in conn.execute(sql, params)]
        if played_only:
            now = datetime.now(timezone.utc).isoformat()
            rows = [r for r in rows if r["kickoff_at"] < now]
        return rows

    def history(self, fixture_uid: str) -> List[Dict[str, Any]]:
        """Every forecast ever published for one fixture, oldest first."""
        conn = self.connect()
        return [dict(r) for r in conn.execute(
            "SELECT * FROM prediction_snapshots WHERE fixture_uid = ? "
            "ORDER BY generated_at", (fixture_uid,))]

    def stats(self) -> Dict[str, Any]:
        conn = self.connect()
        row = conn.execute("""
            SELECT COUNT(*) AS rows,
                   COUNT(DISTINCT fixture_uid) AS fixtures,
                   COUNT(DISTINCT model_version) AS versions,
                   MIN(generated_at) AS first_generated,
                   MAX(generated_at) AS last_generated
              FROM prediction_snapshots""").fetchone()
        out = dict(row)
        out["by_version"] = {
            r["model_version"]: r["n"] for r in conn.execute(
                "SELECT model_version, COUNT(*) AS n FROM prediction_snapshots "
                "GROUP BY 1 ORDER BY 2 DESC")}
        return out


def snapshots_from_fixtures(fixtures: Iterable[Dict[str, Any]], *,
                            generated_at: str, model_version: str,
                            trained_through: Optional[str] = None
                            ) -> List[Snapshot]:
    """Adapt the published fixture artifact into snapshot rows.

    Built from the SAME dicts the API serves, so the recorded probability is
    the probability shown. Deriving them separately is how a provenance table
    ends up documenting a forecast nobody saw.
    """
    out: List[Snapshot] = []
    for f in fixtures:
        kickoff = f["date"] + ("T" + f["kickoff"] if f.get("kickoff") else "T12:00")
        if not kickoff.endswith("+00:00"):
            kickoff = kickoff + ":00+00:00" if len(kickoff) == 16 else kickoff
        top = (f.get("scorelines") or [{}])[0]
        out.append(Snapshot(
            fixture_uid=fixture_uid(f["competition_id"], f["season"],
                                    f["date"], f["home"], f["away"]),
            generated_at=generated_at,
            model_version=model_version,
            competition_id=f["competition_id"],
            season=int(f["season"]),
            kickoff_at=kickoff,
            home_team=f["home"], away_team=f["away"],
            p_home=float(f["p_home"]), p_draw=float(f["p_draw"]),
            p_away=float(f["p_away"]),
            lambda_home=float(f["xg_home"]), lambda_away=float(f["xg_away"]),
            elo_home=f.get("elo_home"), elo_away=f.get("elo_away"),
            trained_through=trained_through,
            top_scoreline=top.get("score"), top_scoreline_p=top.get("p"),
        ))
    return out
