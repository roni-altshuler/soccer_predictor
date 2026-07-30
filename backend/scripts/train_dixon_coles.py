"""Fit per-competition Dixon-Coles baselines from the warehouse.

VISION_2030 §8: Dixon-Coles bivariate Poisson with time decay is the
*calibrated, explainable baseline* — the yardstick the Match Engine must beat.
This CLI fits one model per competition (men's and women's alike) on completed
matches from the last N seasons and writes a committed JSON artifact.

The warehouse is ALWAYS opened strictly read-only (``mode=ro``): a backfill
process may be writing to it concurrently and this script must never take a
write lock.

Source hygiene
--------------
The warehouse mixes providers (fdcouk / espn / openfootball) and the same
fixture can appear under *different team_ids* with a ±1-day date shift (e.g.
fdcouk "Ipswich" 2024-08-16 vs openfootball "Ipswich Town" 2024-08-17 — same
Liverpool 0-2). Cross-source dedup would require alias resolution, so instead
each competition is fitted on its single *dominant source* (the provider with
the most completed matches: fdcouk for the European men's leagues — which also
carries odds — espn for the women's competitions). This loses a handful of
fixtures per season but guarantees a duplicate-free, internally consistent
sample. Promoted/relegated teams need no special casing: every team present in
the window is fitted, and unseen teams cold-start at the league-average rating
at predict time.

Run
---
    python -m backend.scripts.train_dixon_coles \
        --competitions eng.1 esp.1 usa.1.w \
        --seasons 5 --half-life 390

Artifact (committed): ``backend/data/dixon_coles_params.json``
(NOT ``backend/data/models/`` — that directory is gitignored.)
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.prediction.dixon_coles import (  # noqa: E402
    DEFAULT_HALF_LIFE_DAYS,
    fit_dixon_coles,
)

WAREHOUSE_PATH = ROOT / "backend" / "data" / "warehouse.sqlite"
# Committed artifact. backend/data/models/ is gitignored (it holds .pt blobs),
# so the params live one level up where git can see them.
DEFAULT_OUTPUT = ROOT / "backend" / "data" / "dixon_coles_params.json"

SCHEMA_VERSION = 1


def connect_readonly(path: Path = WAREHOUSE_PATH) -> sqlite3.Connection:
    """Open the warehouse STRICTLY read-only. Never write to this handle."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def dominant_source(con: sqlite3.Connection, competition_id: str) -> Optional[str]:
    """The provider with the most completed matches for this competition."""
    row = con.execute(
        """
        SELECT source, COUNT(*) AS n FROM matches
        WHERE competition_id = ?
          AND home_score IS NOT NULL AND away_score IS NOT NULL
        GROUP BY source ORDER BY n DESC, source ASC LIMIT 1
        """,
        (competition_id,),
    ).fetchone()
    return row["source"] if row else None


def load_competition_matches(
    con: sqlite3.Connection,
    competition_id: str,
    n_seasons: int,
    source: Optional[str] = None,
    until: Optional[str] = None,
) -> List[Dict[str, object]]:
    """Completed matches (dicts ready for ``fit_dixon_coles``) for one competition.

    Restricted to the dominant (or explicitly given) source and to the last
    ``n_seasons`` season labels present for that source. ``until`` (ISO date)
    optionally excludes matches on/after that instant — used by the
    walk-forward backtest.
    """
    src = source or dominant_source(con, competition_id)
    if src is None:
        return []
    season_rows = con.execute(
        """
        SELECT DISTINCT season FROM matches
        WHERE competition_id = ? AND source = ?
          AND home_score IS NOT NULL AND away_score IS NOT NULL
          AND (? IS NULL OR date_utc < ?)
        ORDER BY season DESC LIMIT ?
        """,
        (competition_id, src, until, until, n_seasons),
    ).fetchall()
    seasons = [r["season"] for r in season_rows]
    if not seasons:
        return []
    placeholders = ",".join("?" for _ in seasons)
    rows = con.execute(
        f"""
        SELECT m.date_utc, m.home_score, m.away_score,
               h.canonical_name AS home, a.canonical_name AS away
        FROM matches m
        JOIN teams h ON h.team_id = m.home_team_id
        JOIN teams a ON a.team_id = m.away_team_id
        WHERE m.competition_id = ? AND m.source = ?
          AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
          AND m.season IN ({placeholders})
          AND (? IS NULL OR m.date_utc < ?)
        ORDER BY m.date_utc ASC, m.match_id ASC
        """,
        (competition_id, src, *seasons, until, until),
    ).fetchall()
    return [
        {
            "home": r["home"],
            "away": r["away"],
            "home_goals": int(r["home_score"]),
            "away_goals": int(r["away_score"]),
            "date": r["date_utc"],
        }
        for r in rows
    ]


def fit_competition(
    con: sqlite3.Connection,
    competition_id: str,
    n_seasons: int,
    half_life_days: float,
    source: Optional[str] = None,
) -> Optional[Dict[str, object]]:
    """Fit one competition; returns its artifact entry (or None if no data)."""
    matches = load_competition_matches(con, competition_id, n_seasons, source)
    if len(matches) < 50:
        print(f"  !! {competition_id}: only {len(matches)} completed matches — skipped")
        return None
    model = fit_dixon_coles(matches, half_life_days=half_life_days)
    entry = model.to_dict()
    entry["source"] = source or dominant_source(con, competition_id)
    entry["n_seasons"] = n_seasons
    return entry


def build_artifact(
    con: sqlite3.Connection,
    competition_ids: List[str],
    n_seasons: int,
    half_life_days: float,
) -> Dict[str, object]:
    competitions: Dict[str, object] = {}
    for comp in sorted(competition_ids):
        entry = fit_competition(con, comp, n_seasons, half_life_days)
        if entry is None:
            continue
        competitions[comp] = entry
        n_teams = len(entry["teams"])  # type: ignore[arg-type]
        print(
            f"  {comp}: fitted {entry['fitted_matches']} matches, "
            f"{n_teams} teams, home_adv={entry['home_adv']:+.3f}, "
            f"rho={entry['rho']:+.4f} (source={entry['source']})"
        )
    return {
        "schema": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "half_life_days": half_life_days,
        "competitions": competitions,
    }


def write_artifact(artifact: Dict[str, object], output: Path) -> None:
    """Deterministic serialisation: sorted keys, fixed indent, trailing newline."""
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fit per-competition Dixon-Coles baseline models."
    )
    parser.add_argument(
        "--competitions",
        nargs="+",
        # Club leagues with stable team pools and a real home advantage — the
        # setting where a per-competition Dixon-Coles fit is trustworthy. This
        # spans the leagues in season during the European summer break (MLS
        # usa.1, NWSL usa.1.w, eng.1.w) and the majors for when they restart.
        # Continental cups and one-off tournaments (uefa.*, fifa.world) are
        # deliberately excluded: their team pools rotate and DC would fit on
        # too few matches per team — those stay with the cross-league model.
        default=[
            "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "ned.1", "por.1",
            "usa.1", "usa.1.w", "eng.1.w",
        ],
        help="Competition ids to fit (default: the club leagues listed in code)",
    )
    parser.add_argument(
        "--seasons",
        type=int,
        default=5,
        help="Fit on the last N season labels per competition (default 5)",
    )
    parser.add_argument(
        "--half-life",
        type=float,
        default=DEFAULT_HALF_LIFE_DAYS,
        help=f"Time-decay half-life in days (default {DEFAULT_HALF_LIFE_DAYS:.0f})",
    )
    parser.add_argument(
        "--warehouse",
        type=Path,
        default=WAREHOUSE_PATH,
        help="Path to warehouse.sqlite (opened read-only)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Artifact path (default {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args(argv)

    print(f"Fitting Dixon-Coles: {', '.join(args.competitions)}")
    print(f"  window: last {args.seasons} seasons, half-life {args.half_life:.0f}d")
    con = connect_readonly(args.warehouse)
    try:
        artifact = build_artifact(
            con, args.competitions, args.seasons, args.half_life
        )
    finally:
        con.close()

    if not artifact["competitions"]:
        print("No competitions could be fitted — artifact not written.")
        return 1
    write_artifact(artifact, args.output)
    print(f"Wrote {args.output} ({len(artifact['competitions'])} competitions)")  # type: ignore[arg-type]
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
