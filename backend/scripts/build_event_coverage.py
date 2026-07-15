"""Build the committed event-coverage summary artifact.

The minute-level timeline foundation (VISION_2030 Phase 0) is only as
trustworthy as its coverage is *visible*. This script reads the warehouse and
writes ``backend/data/events/coverage.json`` — per competition and per season,
how many completed matches have a verified timeline, how many of those are
verified-empty (0-0, no cards: a real, fully-known timeline with zero events),
and how many remain uncovered.

Coverage semantics mirror ``Warehouse.events_coverage()`` exactly:

* a match is COVERED when it has a ``match_event_coverage`` row (the
  authoritative marker written only after the integrity guard verified the
  events against the final score), or — for legacy direct writers — stored
  ``match_events`` rows without a marker;
* only completed matches (both scores present) are counted;
* everything emitted is an EXACT COUNT over warehouse rows — no estimates,
  no smoothing (docs/VISION_2030.md §3.2).

The artifact is committed (the warehouse SQLite is gitignored and absent on
Vercel) and deterministic: competitions and seasons are sorted by id/label so
re-runs diff cleanly; only real count changes produce a substantive diff.

CLI:
    python -m backend.scripts.build_event_coverage [--db PATH] [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

SCHEMA_VERSION = 1

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "warehouse.sqlite"
DEFAULT_OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "events" / "coverage.json"

#: A match is covered when it appears here: the coverage marker is
#: authoritative; event rows without a marker (legacy direct writers) count
#: as covered with their own event count. Identical to the subquery inside
#: ``Warehouse.events_coverage()``.
_COVERED_SQL = """
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
"""


@dataclass
class CoverageRow:
    """Counts for one (competition, season) cell or any rollup of cells."""

    matches: int = 0
    covered: int = 0
    with_events: int = 0
    verified_empty: int = 0

    @property
    def uncovered(self) -> int:
        return self.matches - self.covered

    @property
    def coverage(self) -> float:
        return round(self.covered / self.matches, 4) if self.matches else 0.0

    def add(self, other: "CoverageRow") -> None:
        self.matches += other.matches
        self.covered += other.covered
        self.with_events += other.with_events
        self.verified_empty += other.verified_empty

    def as_dict(self) -> Dict[str, Any]:
        return {
            "matches": self.matches,
            "covered": self.covered,
            "with_events": self.with_events,
            "verified_empty": self.verified_empty,
            "uncovered": self.uncovered,
            "coverage": self.coverage,
        }


@dataclass
class CompetitionCoverage:
    competition_id: str
    name: Optional[str]
    gender: Optional[str]
    totals: CoverageRow = field(default_factory=CoverageRow)
    seasons: Dict[int, CoverageRow] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "competition_id": self.competition_id,
            "name": self.name,
            "gender": self.gender,
            **self.totals.as_dict(),
            "seasons": [
                {"season": season, **self.seasons[season].as_dict()}
                for season in sorted(self.seasons)
            ],
        }


@dataclass
class BuildResult:
    totals: CoverageRow
    competitions: List[CompetitionCoverage]


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def build_coverage(db_path: Path) -> BuildResult:
    """Exact-count coverage aggregation. Never fabricates:

    * missing DB or a pre-v4 warehouse (no ``match_event_coverage``) → empty
      result — the artifact then honestly says "nothing is covered yet";
    * only completed matches are counted; a NULL season groups under -1 so
      no row is silently dropped.
    """

    empty = BuildResult(totals=CoverageRow(), competitions=[])
    if not db_path.exists():
        return empty

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        if not _table_exists(con, "matches") or not _table_exists(con, "match_events"):
            return empty
        has_marker_table = _table_exists(con, "match_event_coverage")
        covered_sql = (
            _COVERED_SQL
            if has_marker_table
            else "SELECT match_id, COUNT(*) AS n_events FROM match_events GROUP BY match_id"
        )
        rows = con.execute(
            f"""
            SELECT m.competition_id, c.name, c.gender,
                   COALESCE(m.season, -1) AS season,
                   COUNT(*) AS matches,
                   SUM(CASE WHEN cov.match_id IS NOT NULL THEN 1 ELSE 0 END) AS covered,
                   SUM(CASE WHEN cov.n_events > 0 THEN 1 ELSE 0 END) AS with_events,
                   SUM(CASE WHEN cov.match_id IS NOT NULL AND cov.n_events = 0
                            THEN 1 ELSE 0 END) AS verified_empty
            FROM matches m
            LEFT JOIN competitions c ON c.competition_id = m.competition_id
            LEFT JOIN ({covered_sql}) cov ON cov.match_id = m.match_id
            WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
            GROUP BY m.competition_id, c.name, c.gender, COALESCE(m.season, -1)
            ORDER BY m.competition_id ASC, season ASC
            """
        ).fetchall()
    finally:
        con.close()

    totals = CoverageRow()
    competitions: Dict[str, CompetitionCoverage] = {}
    for comp_id, name, gender, season, matches, covered, with_events, verified_empty in rows:
        cell = CoverageRow(
            matches=int(matches),
            covered=int(covered or 0),
            with_events=int(with_events or 0),
            verified_empty=int(verified_empty or 0),
        )
        comp = competitions.setdefault(
            comp_id, CompetitionCoverage(competition_id=comp_id, name=name, gender=gender)
        )
        comp.seasons[int(season)] = cell
        comp.totals.add(cell)
        totals.add(cell)

    return BuildResult(
        totals=totals,
        competitions=[competitions[key] for key in sorted(competitions)],
    )


def write_artifact(
    result: BuildResult, out_path: Path, generated_at: Optional[str] = None
) -> Path:
    """Write the artifact with sorted keys so re-runs diff cleanly."""

    stamp = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {
        "schema": SCHEMA_VERSION,
        "generated_at": stamp,
        "totals": result.totals.as_dict(),
        "competitions": [comp.as_dict() for comp in result.competitions],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    return out_path


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--db", type=Path, default=DEFAULT_DB_PATH, help="warehouse SQLite path"
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT_PATH, help="artifact output path"
    )
    args = parser.parse_args(argv)

    result = build_coverage(args.db)
    out_path = write_artifact(result, args.out)

    t = result.totals
    print(
        f"totals: matches={t.matches} covered={t.covered} "
        f"verified_empty={t.verified_empty} uncovered={t.uncovered} "
        f"coverage={t.coverage:.1%}"
    )
    for comp in result.competitions:
        print(
            f"  {comp.competition_id:24} matches={comp.totals.matches:>7} "
            f"covered={comp.totals.covered:>7} coverage={comp.totals.coverage:>7.1%} "
            f"seasons={len(comp.seasons)}"
        )
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
