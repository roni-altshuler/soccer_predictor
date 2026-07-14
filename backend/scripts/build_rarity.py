"""Build the Rarity Engine v1 exact-count artifacts.

Reads the match warehouse (``matches`` x ``match_events``) and, for every
match listed in ``match_event_coverage`` (schema v4 — the authoritative
"this match's timeline is fully known" signal; matches without a coverage
row are excluded entirely), reconstructs the running score at each 5-minute
boundary. A covered match with ZERO event rows is a verified 0-0 without
cards and contributes a full level-state timeline. For each side of each
match it emits a state tuple

    key = (gender, score_diff clamped to [-3..+3], minute_bucket)

where minute buckets are 0, 5, ..., 90 and everything from the 90th minute
onwards (stoppage time ``90+X`` and extra time) is clamped into the final
``90`` ("90+") bucket. The outcome recorded for the state is that side's
final result (w/d/l).

Honesty rules (docs/VISION_2030.md §3.2):
* every emitted number is an EXACT COUNT over warehouse rows — no models,
  no embeddings, no smoothing;
* matches whose per-side goal-event counts do not reproduce the final score
  are skipped outright rather than counted approximately.

Outputs two committed artifacts (deterministic: sorted keys):
* ``backend/data/rarity/state_outcomes.json`` — the aggregate counts;
* ``backend/data/rarity/examples.json``      — capped precedent lists for
  dramatic keys (trailing by 2+ from the 60th minute on, and the side did
  not lose).

CLI:
    python -m backend.scripts.build_rarity [--db PATH] [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Contract constants
# ---------------------------------------------------------------------------

#: Event types that increment the score of ``team_side`` (goals are credited
#: to the SCORING side in ``match_events``, own goals included).
GOAL_EVENT_TYPES = frozenset({"goal", "own_goal", "penalty_goal"})

#: 5-minute boundaries at which states are sampled. The last boundary (90)
#: doubles as the "90+" bucket: stoppage/extra-time goals happen *after* it,
#: so they influence only the recorded outcome, never a bucket state.
BOUNDARIES: Tuple[int, ...] = tuple(range(0, 91, 5))

DIFF_MIN = -3
DIFF_MAX = 3

#: A key is "dramatic" (and collects precedent examples) when the side was
#: trailing by two or more at the 60th minute or later and did not lose.
DRAMATIC_MAX_DIFF = -2
DRAMATIC_MIN_BUCKET = 60
EXAMPLES_CAP = 12

SCHEMA_VERSION = 1

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "warehouse.sqlite"
DEFAULT_OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "rarity"


# ---------------------------------------------------------------------------
# Timeline reconstruction
# ---------------------------------------------------------------------------


def effective_minute(minute: int, added_time: Optional[int]) -> int:
    """Chronological minute of an event: base minute plus added time.

    A goal recorded as 45+3 happens *after* the 45:00 boundary, so its
    effective minute (48) places it in the second half's buckets; 90+4 (94)
    falls beyond every boundary and affects only the final outcome.
    """

    return int(minute) + int(added_time or 0)


def score_at_boundaries(
    goal_events: Iterable[Tuple[int, str]],
) -> List[Tuple[int, int]]:
    """Running (home_goals, away_goals) at each boundary in ``BOUNDARIES``.

    ``goal_events`` is an iterable of ``(effective_minute, team_side)``. The
    state at boundary ``m`` includes every goal with effective minute <= m
    (a goal "in the 55th minute" has happened by the 55:00 clock mark).
    """

    ordered = sorted(goal_events, key=lambda ev: ev[0])
    states: List[Tuple[int, int]] = []
    home = away = 0
    idx = 0
    for boundary in BOUNDARIES:
        while idx < len(ordered) and ordered[idx][0] <= boundary:
            if ordered[idx][1] == "home":
                home += 1
            else:
                away += 1
            idx += 1
        states.append((home, away))
    return states


def clamp_diff(diff: int) -> int:
    return max(DIFF_MIN, min(DIFF_MAX, diff))


def state_key(gender: str, diff: int, bucket: int) -> str:
    return f"{gender}:{diff}:{bucket}"


def outcome_for(own_score: int, opp_score: int) -> str:
    if own_score > opp_score:
        return "w"
    if own_score < opp_score:
        return "l"
    return "d"


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


@dataclass
class MatchMeta:
    match_id: str
    gender: str
    competition_id: str
    date: str
    home_name: str
    away_name: str
    home_score: int
    away_score: int


@dataclass
class BuildResult:
    states: Dict[str, Dict[str, int]]
    examples: Dict[str, Dict[str, List[dict]]]
    matches_covered: int
    matches_verified_empty: int
    matches_skipped_integrity: int


def _accumulate_match(
    states: Dict[str, Dict[str, int]],
    examples: Dict[str, Dict[str, List[dict]]],
    meta: MatchMeta,
    goal_events: Sequence[Tuple[int, str]],
) -> bool:
    """Fold one match into the aggregates. Returns False on integrity failure."""

    home_total = sum(1 for _, side in goal_events if side == "home")
    away_total = len(goal_events) - home_total
    if home_total != meta.home_score or away_total != meta.away_score:
        return False

    boundary_scores = score_at_boundaries(goal_events)

    for side, own_final, opp_final in (
        ("home", meta.home_score, meta.away_score),
        ("away", meta.away_score, meta.home_score),
    ):
        outcome = outcome_for(own_final, opp_final)
        for bucket, (home_goals, away_goals) in zip(BOUNDARIES, boundary_scores):
            own, opp = (
                (home_goals, away_goals) if side == "home" else (away_goals, home_goals)
            )
            diff = clamp_diff(own - opp)
            key = state_key(meta.gender, diff, bucket)
            counts = states.setdefault(key, {"n": 0, "w": 0, "d": 0, "l": 0})
            counts["n"] += 1
            counts[outcome] += 1

            if (
                diff <= DRAMATIC_MAX_DIFF
                and bucket >= DRAMATIC_MIN_BUCKET
                and outcome in ("w", "d")
            ):
                bucket_examples = examples.setdefault(key, {"w": [], "d": []})
                bucket_examples[outcome].append(
                    {
                        "match_id": meta.match_id,
                        "home": meta.home_name,
                        "away": meta.away_name,
                        "final_score": f"{meta.home_score}-{meta.away_score}",
                        "date": meta.date,
                        "competition_id": meta.competition_id,
                        "side": side,
                    }
                )
    return True


def _finalize_examples(
    examples: Dict[str, Dict[str, List[dict]]],
) -> Dict[str, Dict[str, List[dict]]]:
    """Sort precedent lists most-recent-first and cap them. Deterministic."""

    finalized: Dict[str, Dict[str, List[dict]]] = {}
    for key in sorted(examples):
        per_outcome: Dict[str, List[dict]] = {}
        for outcome in ("w", "d"):
            rows = examples[key][outcome]
            if not rows:
                continue
            rows.sort(key=lambda r: (r["date"], r["match_id"], r["side"]), reverse=True)
            per_outcome[outcome] = rows[:EXAMPLES_CAP]
        if per_outcome:
            finalized[key] = per_outcome
    return finalized


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def build_rarity(db_path: Path) -> BuildResult:
    """Exact-count aggregation over the warehouse. Never fabricates:

    * missing DB or a pre-v4 warehouse (no ``match_event_coverage``) → empty
      result;
    * matches without a coverage row → excluded, even if stray event rows
      exist (coverage membership is the only gate);
    * covered matches with zero event rows are verified 0-0s and contribute
      a full level-state timeline;
    * matches whose events do not reproduce the final score → skipped.
    """

    empty = BuildResult(
        states={},
        examples={},
        matches_covered=0,
        matches_verified_empty=0,
        matches_skipped_integrity=0,
    )
    if not db_path.exists():
        return empty

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        if (
            not _table_exists(con, "match_event_coverage")
            or not _table_exists(con, "match_events")
            or not _table_exists(con, "matches")
        ):
            return empty

        # Only coverage-verified matches with a settled final score.
        match_rows = con.execute(
            """
            SELECT m.match_id, c.gender, m.competition_id, m.date_utc,
                   th.canonical_name, ta.canonical_name,
                   m.home_score, m.away_score, cov.events
            FROM matches m
            JOIN match_event_coverage cov ON cov.match_id = m.match_id
            JOIN competitions c ON c.competition_id = m.competition_id
            LEFT JOIN teams th ON th.team_id = m.home_team_id
            LEFT JOIN teams ta ON ta.team_id = m.away_team_id
            WHERE m.home_score IS NOT NULL
              AND m.away_score IS NOT NULL
            ORDER BY m.match_id
            """
        ).fetchall()

        if not match_rows:
            return empty

        goal_events: Dict[str, List[Tuple[int, str]]] = {}
        event_rows = con.execute(
            """
            SELECT e.match_id, e.event_type, e.minute, e.added_time, e.team_side
            FROM match_events e
            ORDER BY e.match_id, e.minute, e.added_time, e.seq
            """
        )
        for match_id, event_type, minute, added_time, team_side in event_rows:
            if event_type not in GOAL_EVENT_TYPES:
                continue
            if team_side not in ("home", "away"):
                continue
            goal_events.setdefault(match_id, []).append(
                (effective_minute(minute, added_time), team_side)
            )
    finally:
        con.close()

    states: Dict[str, Dict[str, int]] = {}
    examples: Dict[str, Dict[str, List[dict]]] = {}
    covered = 0
    verified_empty = 0
    skipped = 0

    for match_id, gender, comp_id, date_utc, home_name, away_name, hs, aw, cov_events in match_rows:
        meta = MatchMeta(
            match_id=match_id,
            gender=gender,
            competition_id=comp_id,
            date=date_utc or "",
            home_name=home_name or "",
            away_name=away_name or "",
            home_score=int(hs),
            away_score=int(aw),
        )
        # A covered match with zero event rows is a VERIFIED 0-0 without
        # cards: the integrity check below (0 goal events == 0-0 final)
        # still applies, and the level-state timeline is counted in full.
        if _accumulate_match(states, examples, meta, goal_events.get(match_id, [])):
            covered += 1
            if int(cov_events or 0) == 0:
                verified_empty += 1
        else:
            skipped += 1

    return BuildResult(
        states={key: states[key] for key in sorted(states)},
        examples=_finalize_examples(examples),
        matches_covered=covered,
        matches_verified_empty=verified_empty,
        matches_skipped_integrity=skipped,
    )


# ---------------------------------------------------------------------------
# Artifact writing
# ---------------------------------------------------------------------------


def write_artifacts(
    result: BuildResult,
    out_dir: Path,
    generated_at: Optional[str] = None,
) -> Tuple[Path, Path]:
    """Write both artifacts with sorted keys so re-runs diff cleanly."""

    stamp = generated_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    out_dir.mkdir(parents=True, exist_ok=True)

    states_path = out_dir / "state_outcomes.json"
    states_payload = {
        "schema": SCHEMA_VERSION,
        "generated_at": stamp,
        "matches_covered": result.matches_covered,
        "matches_verified_empty": result.matches_verified_empty,
        "matches_skipped_integrity": result.matches_skipped_integrity,
        "states": result.states,
    }
    states_path.write_text(
        json.dumps(states_payload, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )

    examples_path = out_dir / "examples.json"
    examples_payload = {
        "schema": SCHEMA_VERSION,
        "generated_at": stamp,
        "examples": result.examples,
    }
    examples_path.write_text(
        json.dumps(examples_payload, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )

    return states_path, examples_path


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--db", type=Path, default=DEFAULT_DB_PATH, help="warehouse SQLite path"
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT_DIR, help="artifact output directory"
    )
    args = parser.parse_args(argv)

    result = build_rarity(args.db)
    states_path, examples_path = write_artifacts(result, args.out)

    print(f"matches_covered={result.matches_covered}")
    print(f"matches_verified_empty={result.matches_verified_empty}")
    print(f"matches_skipped_integrity={result.matches_skipped_integrity}")
    print(f"state_keys={len(result.states)}")
    print(f"example_keys={len(result.examples)}")
    print(f"wrote {states_path}")
    print(f"wrote {examples_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
