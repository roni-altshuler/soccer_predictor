"""Build the Justice Ledger — luck-adjusted season tables (VISION_2030 §4.4).

The ledger compares, for every well-covered competition-season, the points a
team *actually* took against the points its chance quality *deserved*. The
deserved figure is standard **expected points (xPts)** computed from the two
teams' expected goals (xG) already stored in the warehouse.

xPts method (documented for the Skeptic)
----------------------------------------
For one match we hold each side's xG as the mean of an independent Poisson
count of goals. Over a grid of scorelines ``(i, j)`` with ``0 <= i, j <= CAP``
(``CAP = 10``; the truncated tail beyond ten goals is negligible for xG in the
0-4 range this data carries)::

    P(i home, j away) = Poisson(i; home_xg) * Poisson(j; away_xg)

summing the grid into the three match results gives::

    P(home win) = sum P(i, j) for i > j
    P(draw)     = sum P(i, j) for i == j
    P(away win) = sum P(i, j) for i < j

and the deserved points are the league's own reward function applied to those
probabilities::

    home_xpts = 3 * P(home win) + 1 * P(draw)
    away_xpts = 3 * P(away win) + 1 * P(draw)

This is the ordinary "xPTS table" seen on public xG sites — no bespoke model,
no calibration layer, just the Poisson-independence baseline over the warehouse
xG. A team's season xPts is the sum of its per-match xPts.

What is aggregated
------------------
Both the actual points and the xPts are summed over the SAME set of matches:
those where **both** ``home_xg`` and ``away_xg`` are present. Keeping the two
figures on an identical match basis is what makes the delta an honest luck
signal rather than an artefact of differing denominators. ``matches`` in the
output is therefore the xG-backed match count; ``matches_total`` (used only by
the coverage gate) is the team's full deduplicated fixture count.

Deduplication
-------------
The warehouse carries the same real fixture from several loaders (ESPN,
football-data.co.uk, OpenFootball, ...), so a naive per-row sum would
double-count points. Rows are collapsed to one per fixture keyed by
``(home_team_id, away_team_id)`` within a competition-season (a league
round-robin plays each ordered pair once; a single tournament edition likewise
meets any ordered pair at most once). Among the rows for a fixture we keep the
one with xG, breaking ties by a fixed source precedence then ``match_id`` so
re-runs are deterministic. Rows whose team names failed cross-source identity
resolution surface as separate team_ids; because their duplicate rows carry no
xG they never enter the xG basis and are filtered out by the coverage gate.

Honesty gates (VISION_2030 §4.4 — never show a luck table built on thin data)
-----------------------------------------------------------------------------
* a team-season is emitted only when its xG coverage
  (``matches_with_xg / matches_total``) is at least 90%;
* a competition-season is emitted only when at least 90% of its teams clear
  that per-team gate.

Output (committed, deterministic)
---------------------------------
``backend/data/justice/ledger.json``::

    {
      "schema": 1,
      "generated_at": "...",
      "seasons": {
        "<competition_id>:<season>": {
          "coverage": 0.972,
          "teams": [                       # sorted by xpts desc
            {"team": "Manchester City", "pts": 89, "xpts": 80.3,
             "delta": 8.7, "matches": 38},
            ...
          ]
        },
        ...
      }
    }

CLI:
    python -m backend.scripts.build_justice [--db PATH] [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Contract constants
# ---------------------------------------------------------------------------

#: Goals grid cap for the scoreline Poisson (0..CAP inclusive on each side).
XPTS_GOAL_CAP = 10

#: A team-season needs at least this share of its fixtures backed by xG.
TEAM_COVERAGE_MIN = 0.90

#: A competition-season needs at least this share of its teams to pass.
COMPETITION_TEAMS_PASS_MIN = 0.90

#: Deterministic tie-break when several sources carry xG for one fixture —
#: lower rank wins. Unknown sources sort last. Only affects the rare fixture
#: that two providers both give xG for; it never changes which fixtures exist.
SOURCE_RANK: Dict[str, int] = {
    "understat": 0,
    "fbref": 1,
    "fdcouk": 2,
    "espn": 3,
    "openfootball": 4,
}
_UNKNOWN_SOURCE_RANK = 99

SCHEMA_VERSION = 1

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "warehouse.sqlite"
DEFAULT_OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "justice" / "ledger.json"


# ---------------------------------------------------------------------------
# xPts math (pure, hand-checkable)
# ---------------------------------------------------------------------------


def poisson_pmf(k: int, lam: float) -> float:
    """P(count == k) for a Poisson with mean ``lam`` (lam >= 0)."""

    if lam < 0:
        raise ValueError(f"negative rate: {lam!r}")
    return math.exp(-lam) * (lam ** k) / math.factorial(k)


def expected_points(
    home_xg: float, away_xg: float, cap: int = XPTS_GOAL_CAP
) -> Tuple[float, float]:
    """Deserved (home_xpts, away_xpts) from the two xG values.

    Independent-Poisson scoreline grid capped at ``cap`` goals per side; see
    the module docstring for the derivation. Symmetric by construction:
    ``expected_points(a, b)`` mirrors ``expected_points(b, a)``.
    """

    if home_xg < 0 or away_xg < 0:
        raise ValueError("xG values must be non-negative")

    home_pmf = [poisson_pmf(i, home_xg) for i in range(cap + 1)]
    away_pmf = [poisson_pmf(j, away_xg) for j in range(cap + 1)]

    p_home = p_draw = p_away = 0.0
    for i in range(cap + 1):
        for j in range(cap + 1):
            p = home_pmf[i] * away_pmf[j]
            if i > j:
                p_home += p
            elif i == j:
                p_draw += p
            else:
                p_away += p

    return 3.0 * p_home + p_draw, 3.0 * p_away + p_draw


def actual_points(home_score: int, away_score: int) -> Tuple[int, int]:
    """(home_pts, away_pts) for a settled scoreline under 3-1-0 scoring."""

    if home_score > away_score:
        return 3, 0
    if home_score < away_score:
        return 0, 3
    return 1, 1


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


@dataclass
class TeamAgg:
    team_id: int
    name: str
    matches_total: int = 0  # deduplicated fixtures the team appears in
    matches_with_xg: int = 0  # of those, how many carry xG
    pts: int = 0  # actual points over the xG-backed matches
    xpts: float = 0.0  # deserved points over the same matches

    @property
    def coverage(self) -> float:
        return self.matches_with_xg / self.matches_total if self.matches_total else 0.0


@dataclass
class BuildResult:
    seasons: Dict[str, dict]
    competitions_scanned: int = 0
    competitions_emitted: int = 0
    teams_emitted: int = 0


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def _source_rank(source: Optional[str]) -> int:
    return SOURCE_RANK.get(source or "", _UNKNOWN_SOURCE_RANK)


def _dedupe_fixtures(rows: Sequence[sqlite3.Row]) -> List[sqlite3.Row]:
    """One row per (home_team_id, away_team_id): prefer xG, then source, id.

    ``rows`` are all completed matches of a single competition-season. The
    chosen row per fixture minimises the key ``(no_xg, source_rank, match_id)``
    so an xG-bearing row always beats an xG-less duplicate and the result is
    deterministic.
    """

    best: Dict[Tuple[int, int], Tuple[Tuple[int, int, str], sqlite3.Row]] = {}
    for r in rows:
        key = (r["home_team_id"], r["away_team_id"])
        has_xg = r["home_xg"] is not None and r["away_xg"] is not None
        rank = (0 if has_xg else 1, _source_rank(r["source"]), str(r["match_id"]))
        current = best.get(key)
        if current is None or rank < current[0]:
            best[key] = (rank, r)
    return [row for _, row in best.values()]


def _aggregate_competition_season(
    fixtures: Sequence[sqlite3.Row],
) -> Dict[int, TeamAgg]:
    """Fold deduplicated fixtures into per-team actual/expected point sums."""

    teams: Dict[int, TeamAgg] = {}

    def team(tid: int, name: Optional[str]) -> TeamAgg:
        agg = teams.get(tid)
        if agg is None:
            agg = TeamAgg(team_id=tid, name=name or str(tid))
            teams[tid] = agg
        return agg

    for r in fixtures:
        home = team(r["home_team_id"], r["home_name"])
        away = team(r["away_team_id"], r["away_name"])
        home.matches_total += 1
        away.matches_total += 1

        has_xg = r["home_xg"] is not None and r["away_xg"] is not None
        if not has_xg:
            continue
        if r["home_score"] is None or r["away_score"] is None:
            continue

        home.matches_with_xg += 1
        away.matches_with_xg += 1

        home_xpts, away_xpts = expected_points(float(r["home_xg"]), float(r["away_xg"]))
        home.xpts += home_xpts
        away.xpts += away_xpts

        home_pts, away_pts = actual_points(int(r["home_score"]), int(r["away_score"]))
        home.pts += home_pts
        away.pts += away_pts

    return teams


def _season_block(teams: Dict[int, TeamAgg]) -> Optional[dict]:
    """Apply the honesty gates and shape one season block, or None if gated.

    Only teams with at least one xG-backed match are considered a real member
    of the season (a team split into an xG-less duplicate id contributes no
    such match and is not treated as a competitor).
    """

    members = [t for t in teams.values() if t.matches_total > 0]
    if not members:
        return None

    passers = [t for t in members if t.coverage >= TEAM_COVERAGE_MIN]
    if not passers:
        return None
    if len(passers) / len(members) < COMPETITION_TEAMS_PASS_MIN:
        return None

    total_mt = sum(t.matches_total for t in passers)
    total_mx = sum(t.matches_with_xg for t in passers)
    coverage = round(total_mx / total_mt, 4) if total_mt else 0.0

    # Deterministic order: deserved points desc, then actual pts desc, then name.
    ordered = sorted(passers, key=lambda t: (-t.xpts, -t.pts, t.name))
    team_rows = []
    for t in ordered:
        xpts = round(t.xpts, 2)
        team_rows.append(
            {
                "team": t.name,
                "pts": t.pts,
                "xpts": xpts,
                "delta": round(t.pts - t.xpts, 2),
                "matches": t.matches_with_xg,
            }
        )

    return {"coverage": coverage, "teams": team_rows}


def build_justice(db_path: Path) -> BuildResult:
    """Build luck-adjusted tables for every qualifying competition-season.

    Reads the warehouse STRICTLY read-only. A missing database, or one without
    the ``matches`` table, yields an empty (but well-formed) result rather than
    an error — the same graceful-degradation contract as build_rarity.
    """

    empty = BuildResult(seasons={})
    if not db_path.exists():
        return empty

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        if not _table_exists(con, "matches") or not _table_exists(con, "teams"):
            return empty

        comp_seasons = con.execute(
            """
            SELECT DISTINCT competition_id, season
            FROM matches
            WHERE home_score IS NOT NULL AND away_score IS NOT NULL
              AND home_xg IS NOT NULL AND away_xg IS NOT NULL
            ORDER BY competition_id, season
            """
        ).fetchall()

        seasons: Dict[str, dict] = {}
        emitted_teams = 0
        for cs in comp_seasons:
            competition_id = cs["competition_id"]
            season = cs["season"]
            rows = con.execute(
                """
                SELECT m.match_id, m.home_team_id, m.away_team_id,
                       m.home_score, m.away_score, m.home_xg, m.away_xg, m.source,
                       th.canonical_name AS home_name,
                       ta.canonical_name AS away_name
                FROM matches m
                LEFT JOIN teams th ON th.team_id = m.home_team_id
                LEFT JOIN teams ta ON ta.team_id = m.away_team_id
                WHERE m.competition_id = ? AND m.season = ?
                  AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
                """,
                (competition_id, season),
            ).fetchall()

            fixtures = _dedupe_fixtures(rows)
            teams = _aggregate_competition_season(fixtures)
            block = _season_block(teams)
            if block is None:
                continue
            seasons[f"{competition_id}:{season}"] = block
            emitted_teams += len(block["teams"])
    finally:
        con.close()

    return BuildResult(
        seasons={key: seasons[key] for key in sorted(seasons)},
        competitions_scanned=len(comp_seasons),
        competitions_emitted=len(seasons),
        teams_emitted=emitted_teams,
    )


# ---------------------------------------------------------------------------
# Artifact writing
# ---------------------------------------------------------------------------


def write_artifact(
    result: BuildResult,
    out_path: Path,
    generated_at: Optional[str] = None,
) -> Path:
    """Write ``ledger.json`` with sorted keys so re-runs diff cleanly."""

    stamp = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "schema": SCHEMA_VERSION,
        "generated_at": stamp,
        "seasons": result.seasons,
    }
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

    result = build_justice(args.db)
    out_path = write_artifact(result, args.out)

    print(f"competitions_scanned={result.competitions_scanned}")
    print(f"competitions_emitted={result.competitions_emitted}")
    print(f"teams_emitted={result.teams_emitted}")
    for key in sorted(result.seasons):
        block = result.seasons[key]
        print(f"  {key}  teams={len(block['teams'])}  coverage={block['coverage']:.1%}")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
