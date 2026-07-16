"""Build the Match Engine v0 training dataset from the warehouse event timelines.

Turns every event-covered match (``match_event_coverage`` membership — includes
verified-empty 0-0 grids, which are legitimate full timelines of level states)
into a per-minute grid:

* 90 regulation minute bins per match. Added time folds into the minute-45 /
  minute-90 bin; extra-time minutes (91'-120', knockout ties only, ~155 covered
  matches) also fold into the minute-90 bin so the grid's implied final score
  stays equal to the warehouse final score (which includes extra-time goals).
* four uint8 count grids per match: home goals, away goals, home red cards,
  away red cards per minute bin. Penalty and own goals fold into the credited
  scoring side (the warehouse already credits own goals to the scoring side).

Reconciliation guard (mirrors backfill_events' integrity ethos): every rebuilt
grid's implied final score MUST equal the warehouse final score, otherwise the
match is excluded LOUDLY and counted in the manifest. Expected exclusions: ~0
(backfill_events refuses to store non-reconciling event sets in the first
place).

Source hygiene: the same physical fixture can be covered under two match_ids
(e.g. an fdcouk row with Understat events AND an espn row with ESPN events).
Within each (competition, season) the dataset keeps only the covered source
with the most covered matches — single-source-per-season eliminates
cross-source duplicates without fragile name matching, exactly in the spirit
of ``train_dixon_coles.dominant_source``.

Dixon-Coles anchors: the engine is DC-NESTED — per-minute intensity is
λ_DC · f_θ(state)/90 — so every training match needs walk-forward λ_DC/μ_DC.
For each (competition, source, season) a DC model is fitted on that source's
completed matches strictly before the season's first kickoff (last 5 season
labels, time-decayed to the season start; the exact machinery of
``backend/services/prediction/dixon_coles.py``). Matches whose season has
fewer than MIN_ANCHOR_MATCHES prior matches get NaN anchors and are excluded
from TRAINING (they stay in the grids file, flagged, for future use). This is
deliberately walk-forward — anchors at train time carry the same information
set the engine will have at backtest time.

Outputs (backend/data/cache/engine/ — gitignored, verified):
    grids.npz     -- goal_home/goal_away/red_home/red_away [N, 90] uint8,
                     lam_dc/mu_dc [N] float32 (NaN = no anchor),
                     gender [N] uint8 (0=M, 1=F)
    matches.json  -- per-row metadata (match_id, comp, season, source, date,
                     home, away, final score) aligned with grid rows
    teams.json    -- canonical team name -> integer index vocab
    manifest.json -- counts, exclusions, anchor coverage, generated_at

The warehouse is ALWAYS opened strictly read-only (a CI job may be writing).

Run
---
    python -m backend.scripts.build_event_dataset
    python -m backend.scripts.build_event_dataset --out backend/data/cache/engine
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.train_dixon_coles import (  # noqa: E402
    WAREHOUSE_PATH,
    connect_readonly,
)
from backend.services.prediction.dixon_coles import (  # noqa: E402
    DEFAULT_HALF_LIFE_DAYS,
    fit_dixon_coles,
)

DEFAULT_OUT = ROOT / "backend" / "data" / "cache" / "engine"
N_MINUTES = 90
GOAL_TYPES = ("goal", "own_goal", "penalty_goal")
MIN_ANCHOR_MATCHES = 100  # same bar as the backtest's MIN_FIT_MATCHES
ANCHOR_SEASON_LABELS = 5  # same window the backtest/DC training uses
SCHEMA_VERSION = 1


def minute_bin(minute: int) -> int:
    """0-based minute bin. Added time folds into 45/90; extra time into 90."""
    return min(max(int(minute), 1), N_MINUTES) - 1


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------
def load_covered_matches(con: sqlite3.Connection) -> List[sqlite3.Row]:
    return con.execute(
        """
        SELECT m.match_id, m.competition_id, m.season, m.source, m.date_utc,
               m.home_score, m.away_score, c.gender,
               h.canonical_name AS home, a.canonical_name AS away
        FROM match_event_coverage cov
        JOIN matches m ON m.match_id = cov.match_id
        JOIN competitions c ON c.competition_id = m.competition_id
        JOIN teams h ON h.team_id = m.home_team_id
        JOIN teams a ON a.team_id = m.away_team_id
        WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        ORDER BY m.date_utc ASC, m.match_id ASC
        """
    ).fetchall()


def dedupe_by_dominant_covered_source(
    rows: List[sqlite3.Row],
) -> Tuple[List[sqlite3.Row], int]:
    """Keep, per (competition, season), only the source with most covered rows."""
    counts: Dict[Tuple[str, int, str], int] = {}
    for r in rows:
        key = (r["competition_id"], int(r["season"]), r["source"])
        counts[key] = counts.get(key, 0) + 1
    chosen: Dict[Tuple[str, int], str] = {}
    for (comp, season, source), n in sorted(counts.items()):
        key = (comp, season)
        if key not in chosen or n > counts[(comp, season, chosen[key])]:
            chosen[key] = source
    kept = [
        r
        for r in rows
        if chosen[(r["competition_id"], int(r["season"]))] == r["source"]
    ]
    return kept, len(rows) - len(kept)


def load_events(
    con: sqlite3.Connection,
) -> Dict[str, List[Tuple[str, int, str]]]:
    """match_id -> [(event_type, minute, team_side), ...]."""
    out: Dict[str, List[Tuple[str, int, str]]] = {}
    for r in con.execute(
        "SELECT match_id, event_type, minute, team_side FROM match_events"
    ):
        out.setdefault(r["match_id"], []).append(
            (r["event_type"], int(r["minute"]), r["team_side"])
        )
    return out


# ---------------------------------------------------------------------------
# Dixon-Coles walk-forward anchors, per (competition, source, season)
# ---------------------------------------------------------------------------
def _anchor_training_rows(
    con: sqlite3.Connection, comp: str, source: str, until: str
) -> List[Dict[str, object]]:
    """Completed matches of comp+source strictly before `until` (last N labels)."""
    season_rows = con.execute(
        """
        SELECT DISTINCT season FROM matches
        WHERE competition_id = ? AND source = ?
          AND home_score IS NOT NULL AND away_score IS NOT NULL
          AND date_utc < ?
        ORDER BY season DESC LIMIT ?
        """,
        (comp, source, until, ANCHOR_SEASON_LABELS),
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
          AND m.season IN ({placeholders}) AND m.date_utc < ?
        ORDER BY m.date_utc ASC, m.match_id ASC
        """,
        (comp, source, *seasons, until),
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


def compute_anchors(
    con: sqlite3.Connection,
    kept: List[sqlite3.Row],
    half_life_days: float,
) -> Tuple[np.ndarray, np.ndarray, Dict[str, int]]:
    """Walk-forward λ_DC/μ_DC per kept match (NaN when history is too thin)."""
    lam = np.full(len(kept), np.nan, dtype=np.float32)
    mu = np.full(len(kept), np.nan, dtype=np.float32)

    groups: Dict[Tuple[str, str, int], List[int]] = {}
    for i, r in enumerate(kept):
        groups.setdefault(
            (r["competition_id"], r["source"], int(r["season"])), []
        ).append(i)

    stats = {"groups": len(groups), "fitted": 0, "thin_history": 0}
    for (comp, source, season), idxs in sorted(groups.items()):
        season_start = min(str(kept[i]["date_utc"]) for i in idxs)
        train = _anchor_training_rows(con, comp, source, season_start)
        if len(train) < MIN_ANCHOR_MATCHES:
            stats["thin_history"] += 1
            continue
        model = fit_dixon_coles(
            train, half_life_days=half_life_days, ref_date=season_start
        )
        stats["fitted"] += 1
        for i in idxs:
            lh, la = model.expected_goals(kept[i]["home"], kept[i]["away"])
            lam[i] = lh
            mu[i] = la
    return lam, mu, stats


# ---------------------------------------------------------------------------
# Grid building + reconciliation guard
# ---------------------------------------------------------------------------
def build_grids(
    kept: List[sqlite3.Row],
    events: Dict[str, List[Tuple[str, int, str]]],
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, List[int], List[str]]:
    n = len(kept)
    goal_home = np.zeros((n, N_MINUTES), dtype=np.uint8)
    goal_away = np.zeros((n, N_MINUTES), dtype=np.uint8)
    red_home = np.zeros((n, N_MINUTES), dtype=np.uint8)
    red_away = np.zeros((n, N_MINUTES), dtype=np.uint8)
    keep_idx: List[int] = []
    excluded: List[str] = []

    for i, row in enumerate(kept):
        for event_type, minute, side in events.get(row["match_id"], []):
            b = minute_bin(minute)
            if event_type in GOAL_TYPES:
                target = goal_home if side == "home" else goal_away
            elif event_type == "red_card":
                target = red_home if side == "home" else red_away
            else:  # pragma: no cover - schema CHECK prevents this
                continue
            target[i, b] += 1
        # Reconciliation guard: implied final score == warehouse final score.
        if int(goal_home[i].sum()) == int(row["home_score"]) and int(
            goal_away[i].sum()
        ) == int(row["away_score"]):
            keep_idx.append(i)
        else:
            excluded.append(str(row["match_id"]))
            print(
                f"!! RECONCILIATION FAILURE — excluding {row['match_id']} "
                f"({row['competition_id']} {row['season']}): grid implies "
                f"{int(goal_home[i].sum())}-{int(goal_away[i].sum())}, "
                f"warehouse says {row['home_score']}-{row['away_score']}"
            )
    return goal_home, goal_away, red_home, red_away, keep_idx, excluded


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the Match Engine v0 per-minute event dataset."
    )
    parser.add_argument("--warehouse", type=Path, default=WAREHOUSE_PATH)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--half-life",
        type=float,
        default=DEFAULT_HALF_LIFE_DAYS,
        help="Time-decay half-life for the DC anchor fits (default 390)",
    )
    args = parser.parse_args(argv)

    con = connect_readonly(args.warehouse)
    try:
        rows = load_covered_matches(con)
        print(f"Covered matches with final scores: {len(rows)}")
        kept, deduped = dedupe_by_dominant_covered_source(rows)
        print(
            f"After per-(competition, season) dominant-source dedupe: "
            f"{len(kept)} kept, {deduped} cross-source duplicates dropped"
        )
        events = load_events(con)
        goal_home, goal_away, red_home, red_away, keep_idx, excluded = build_grids(
            kept, events
        )
        print(
            f"Reconciliation: {len(keep_idx)} grids reconcile, "
            f"{len(excluded)} excluded"
        )
        print("Fitting walk-forward Dixon-Coles anchors per (comp, source, season)…")
        lam, mu, anchor_stats = compute_anchors(con, kept, args.half_life)
    finally:
        con.close()

    sel = np.array(keep_idx, dtype=np.int64)
    kept_rows = [kept[i] for i in keep_idx]
    gender = np.array(
        [1 if r["gender"] == "F" else 0 for r in kept_rows], dtype=np.uint8
    )
    lam_sel = lam[sel]
    mu_sel = mu[sel]
    with_anchor = int(np.isfinite(lam_sel).sum())

    teams = sorted({r["home"] for r in kept_rows} | {r["away"] for r in kept_rows})
    team_index = {name: i for i, name in enumerate(teams)}

    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out_dir / "grids.npz",
        goal_home=goal_home[sel],
        goal_away=goal_away[sel],
        red_home=red_home[sel],
        red_away=red_away[sel],
        lam_dc=lam_sel,
        mu_dc=mu_sel,
        gender=gender,
    )
    matches_meta = [
        {
            "match_id": r["match_id"],
            "competition_id": r["competition_id"],
            "season": int(r["season"]),
            "source": r["source"],
            "date_utc": r["date_utc"],
            "gender": r["gender"],
            "home": r["home"],
            "away": r["away"],
            "home_score": int(r["home_score"]),
            "away_score": int(r["away_score"]),
        }
        for r in kept_rows
    ]
    (out_dir / "matches.json").write_text(
        json.dumps(matches_meta, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "teams.json").write_text(
        json.dumps(team_index, ensure_ascii=False, indent=0, sort_keys=True),
        encoding="utf-8",
    )
    manifest = {
        "schema": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "covered_matches": len(rows),
        "cross_source_duplicates_dropped": deduped,
        "grids_written": len(kept_rows),
        "reconciliation_excluded": len(excluded),
        "reconciliation_excluded_ids": excluded,
        "matches_with_dc_anchor": with_anchor,
        "matches_without_dc_anchor": len(kept_rows) - with_anchor,
        "anchor_fit_groups": anchor_stats,
        "anchor_half_life_days": args.half_life,
        "anchor_season_labels": ANCHOR_SEASON_LABELS,
        "min_anchor_matches": MIN_ANCHOR_MATCHES,
        "n_teams": len(teams),
        "minutes_per_match": N_MINUTES,
        "cells_total": len(kept_rows) * N_MINUTES * 2,
        "trainable_cells": with_anchor * N_MINUTES * 2,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {out_dir}/grids.npz  ({len(kept_rows)} matches, "
        f"{with_anchor} with DC anchors, {len(teams)} teams)"
    )
    print(f"Manifest: {out_dir}/manifest.json")
    return 0 if not excluded else 1


if __name__ == "__main__":
    raise SystemExit(main())
