"""Build the match2vec retrieval index — VISION_2030's retrieval verb.

Reads the match warehouse and, for every match in ``match_event_coverage``
whose goal events reproduce the final score exactly (the same integrity
gate as ``build_rarity``), emits one L2-normalised feature vector that
describes HOW THE MATCH UNFOLDED plus the countable facts behind it.

Representation choice (v1): a hand-crafted state-trajectory vector, not a
trained model. Rationale:

* the retrieval contract is "matches that unfolded like this one" — the
  score-difference curve sampled on the rarity engine's 5-minute grid IS
  the unfolding, so encoding it directly is faithful by construction;
* it is deterministic and auditable: every dimension is a documented,
  bounded function of counted events, so a neighbour list can always be
  explained from the stored facts (and the UI's descriptors are template
  renderings of those same facts, never generated text);
* it re-runs byte-identically on unchanged data (no RNG, no training, and
  ``generated_at`` derives from the warehouse's own coverage timestamps),
  matching ``build_rarity``'s determinism conventions;
* at ~35k matches a learned encoder would add a gitignored model artifact
  and nondeterminism for marginal retrieval gain.

No team-identity leakage: the vector is computed ONLY from the event
timeline, the final score and the competition's gender. Team names,
competition and season ride along as display metadata, never as features.
Men's and women's matches share one vector space (parity mission); a
small-weight gender dimension makes the query's own universe rank
naturally first without filtering the other out.

VISION rule: public NUMBERS must come from exact counts — this artifact
is used for RETRIEVAL only. Cosine distances are never surfaced to users;
the per-match ``facts`` block (exact counts) is what the UI may verbalise.

Output: ``backend/data/match2vec/index.json`` — committed, read by the
Node route ``/api/v1/similar/[matchId]`` through ``src/lib/match2vec.ts``.
Rows are arrays (schema documented in the ``columns`` meta field) with the
vector int8-quantised and base64-encoded to keep the artifact small.

CLI:
    python -m backend.scripts.build_match2vec [--db PATH] [--out PATH]
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import sqlite3
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

from backend.scripts.build_rarity import (
    BOUNDARIES,
    GOAL_EVENT_TYPES,
    effective_minute,
    score_at_boundaries,
)

# ---------------------------------------------------------------------------
# Feature contract
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1
FEATURE_VERSION = 1

#: Trajectory clamps (same grid semantics as the rarity engine).
DIFF_CLAMP = 3
GOALS_CLAMP = 8
FINAL_DIFF_CLAMP = 4
LEAD_CHANGES_CLAMP = 3
EQUALIZERS_CLAMP = 3
COMEBACK_CLAMP = 3
REDS_CLAMP = 2

#: Per-block weights applied BEFORE global L2 normalisation. The score-diff
#: trajectory dominates (it is the unfolding); the goal-count trajectory and
#: shape scalars refine; gender is a mild same-universe tiebreaker.
W_DIFF_CURVE = 1.0
W_GOALS_CURVE = 0.5
W_FINAL_DIFF = 1.0
W_TOTAL_GOALS = 0.8
W_FIRST_GOAL = 0.5
W_LAST_GOAL = 0.5
W_GOALLESS = 0.5
W_LEAD_CHANGES = 0.7
W_EQUALIZERS = 0.7
W_COMEBACK = 0.8
W_DECIDER = 0.6
W_REDS_TOTAL = 0.5
W_REDS_DIFF = 0.3
W_GENDER = 0.25

#: 19 diff-curve dims + 19 goal-curve dims + 12 scalar dims.
DIM = len(BOUNDARIES) * 2 + 12

#: Row layout of the ``rows`` array — mirrored in src/lib/match2vec.ts.
COLUMNS: Tuple[str, ...] = (
    "match_id",
    "competition_id",
    "season",
    "date",
    "home",
    "away",
    "final_score",
    "gender",
    "vector_b64_int8",
    "facts",
)

#: Facts layout — exact counts, mirrored in src/lib/match2vec.ts. Minutes
#: are effective minutes (base + added time); -1 means "did not happen".
FACTS_COLUMNS: Tuple[str, ...] = (
    "lead_changes",
    "equalizers",
    "comeback_depth",
    "decider_minute",
    "first_goal_minute",
    "last_goal_minute",
    "reds_home",
    "reds_away",
)

DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "warehouse.sqlite"
DEFAULT_OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "match2vec" / "index.json"


# ---------------------------------------------------------------------------
# Timeline facts
# ---------------------------------------------------------------------------


@dataclass
class TimelineFacts:
    """Exact counts describing how a match unfolded. All template-safe."""

    lead_changes: int
    equalizers: int
    comeback_depth: int
    decider_minute: int  # -1 when the match was drawn
    first_goal_minute: int  # -1 when goalless
    last_goal_minute: int  # -1 when goalless
    reds_home: int
    reds_away: int

    def as_list(self) -> List[int]:
        return [
            self.lead_changes,
            self.equalizers,
            self.comeback_depth,
            self.decider_minute,
            self.first_goal_minute,
            self.last_goal_minute,
            self.reds_home,
            self.reds_away,
        ]


def compute_facts(
    goal_events: Sequence[Tuple[int, str]],
    red_cards: Sequence[Tuple[int, str]],
    home_score: int,
    away_score: int,
) -> TimelineFacts:
    """Count the narrative facts from an already-verified timeline.

    ``goal_events`` / ``red_cards`` are ``(effective_minute, team_side)``,
    goals credited to the scoring side (own goals included).
    """

    ordered = sorted(goal_events, key=lambda ev: ev[0])

    # Home-perspective diff after each goal, prefixed with kickoff state.
    diffs: List[int] = [0]
    for _, side in ordered:
        diffs.append(diffs[-1] + (1 if side == "home" else -1))

    # Lead changes: the leading TEAM switches (level spells in between don't
    # reset the previous leader — 1-0, 1-1, 1-2 is one lead change).
    lead_changes = 0
    last_leader = 0
    for d in diffs[1:]:
        if d > 0:
            if last_leader == -1:
                lead_changes += 1
            last_leader = 1
        elif d < 0:
            if last_leader == 1:
                lead_changes += 1
            last_leader = -1

    equalizers = sum(1 for d in diffs[1:] if d == 0)

    # Comeback depth: the largest deficit either side faced that was later
    # fully erased (diff back to level or better from that side's view).
    comeback_depth = 0
    for i, d in enumerate(diffs):
        if d == 0:
            continue
        trailing_side_deficit = abs(d)
        rest = diffs[i + 1 :]
        recovered = any((r >= 0 if d < 0 else r <= 0) for r in rest)
        if recovered and trailing_side_deficit > comeback_depth:
            comeback_depth = trailing_side_deficit

    # Decisive goal: the goal that gave the eventual winner a lead they
    # never relinquished (nor saw levelled). -1 for draws.
    decider_minute = -1
    final_diff = home_score - away_score
    if final_diff != 0:
        winner_sign = 1 if final_diff > 0 else -1
        decider_idx: Optional[int] = None
        for i in range(len(diffs) - 1, 0, -1):
            if diffs[i] * winner_sign <= 0:
                break
            decider_idx = i
        if decider_idx is not None:
            decider_minute = ordered[decider_idx - 1][0]

    first_goal_minute = ordered[0][0] if ordered else -1
    last_goal_minute = ordered[-1][0] if ordered else -1

    reds_home = sum(1 for _, side in red_cards if side == "home")
    reds_away = sum(1 for _, side in red_cards if side == "away")

    return TimelineFacts(
        lead_changes=lead_changes,
        equalizers=equalizers,
        comeback_depth=comeback_depth,
        decider_minute=decider_minute,
        first_goal_minute=first_goal_minute,
        last_goal_minute=last_goal_minute,
        reds_home=reds_home,
        reds_away=reds_away,
    )


# ---------------------------------------------------------------------------
# Vector construction
# ---------------------------------------------------------------------------


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def build_feature_vector(
    goal_events: Sequence[Tuple[int, str]],
    facts: TimelineFacts,
    home_score: int,
    away_score: int,
    gender: str,
) -> List[float]:
    """The weighted, L2-normalised feature vector (length ``DIM``).

    Inputs are timeline + final score + gender ONLY — never team identity.
    """

    features: List[float] = []

    boundary_scores = score_at_boundaries(goal_events)

    # Block A — score-diff trajectory (home perspective; home advantage is
    # part of a match's shape, so mirroring is deliberately not applied).
    for home_goals, away_goals in boundary_scores:
        diff = _clamp(home_goals - away_goals, -DIFF_CLAMP, DIFF_CLAMP)
        features.append(W_DIFF_CURVE * diff / DIFF_CLAMP)

    # Block B — cumulative goal-count trajectory (tempo: a 2-2 thriller and
    # a 0-0 share a flat diff curve but nothing else).
    for home_goals, away_goals in boundary_scores:
        total = min(home_goals + away_goals, GOALS_CLAMP)
        features.append(W_GOALS_CURVE * total / GOALS_CLAMP)

    # Block C — shape scalars.
    total_goals = home_score + away_score
    final_diff = _clamp(home_score - away_score, -FINAL_DIFF_CLAMP, FINAL_DIFF_CLAMP)
    features.append(W_FINAL_DIFF * final_diff / FINAL_DIFF_CLAMP)
    features.append(W_TOTAL_GOALS * min(total_goals, GOALS_CLAMP) / GOALS_CLAMP)
    # First-goal wait: goalless matches "waited" the full match.
    fg = facts.first_goal_minute if facts.first_goal_minute >= 0 else 90
    features.append(W_FIRST_GOAL * min(fg, 90) / 90.0)
    lg = facts.last_goal_minute if facts.last_goal_minute >= 0 else 0
    features.append(W_LAST_GOAL * min(lg, 90) / 90.0)
    features.append(W_GOALLESS * (1.0 if total_goals == 0 else 0.0))
    features.append(W_LEAD_CHANGES * min(facts.lead_changes, LEAD_CHANGES_CLAMP) / LEAD_CHANGES_CLAMP)
    features.append(W_EQUALIZERS * min(facts.equalizers, EQUALIZERS_CLAMP) / EQUALIZERS_CLAMP)
    features.append(W_COMEBACK * min(facts.comeback_depth, COMEBACK_CLAMP) / COMEBACK_CLAMP)
    dm = facts.decider_minute if facts.decider_minute >= 0 else 0
    features.append(W_DECIDER * min(dm, 90) / 90.0)
    reds_total = facts.reds_home + facts.reds_away
    features.append(W_REDS_TOTAL * min(reds_total, REDS_CLAMP) / REDS_CLAMP)
    reds_diff = _clamp(facts.reds_home - facts.reds_away, -REDS_CLAMP, REDS_CLAMP)
    features.append(W_REDS_DIFF * reds_diff / REDS_CLAMP)

    # Block D — gender tiebreaker (shared space, own universe ranks first).
    features.append(W_GENDER * (1.0 if gender == "M" else -1.0))

    assert len(features) == DIM, f"feature vector is {len(features)}, expected {DIM}"

    norm = math.sqrt(sum(f * f for f in features))
    # The gender dimension is always non-zero, so norm > 0 by construction.
    return [f / norm for f in features]


def quantize_int8(vector: Sequence[float]) -> List[int]:
    """Deterministic int8 quantisation (round half away from zero)."""

    out: List[int] = []
    for value in vector:
        scaled = value * 127.0
        q = math.floor(scaled + 0.5) if scaled >= 0 else math.ceil(scaled - 0.5)
        out.append(int(_clamp(q, -127, 127)))
    return out


def encode_vector(vector: Sequence[float]) -> str:
    """Base64 of the int8-quantised vector — 4*ceil(DIM/3) chars per match."""

    q = quantize_int8(vector)
    return base64.b64encode(struct.pack(f"{len(q)}b", *q)).decode("ascii")


# ---------------------------------------------------------------------------
# Warehouse aggregation
# ---------------------------------------------------------------------------


@dataclass
class BuildResult:
    rows: List[list]
    matches_indexed: int
    matches_skipped_integrity: int
    generated_at: str


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
    ).fetchone()
    return row is not None


def build_index(db_path: Path) -> BuildResult:
    """Deterministic index over every coverage-verified match.

    Honesty gates (identical to ``build_rarity``): coverage membership is
    the only inclusion signal; matches whose goal events do not reproduce
    the final score are skipped outright; covered zero-event matches are
    verified 0-0s and are indexed (a 0-0 unfolds like other 0-0s).
    """

    empty = BuildResult(rows=[], matches_indexed=0, matches_skipped_integrity=0, generated_at="")
    if not db_path.exists():
        return empty

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        for table in ("match_event_coverage", "match_events", "matches", "competitions"):
            if not _table_exists(con, table):
                return empty

        # generated_at derives from the DATA so unchanged warehouses re-run
        # byte-identically (build_rarity determinism convention, hardened).
        stamp_row = con.execute("SELECT MAX(verified_at) FROM match_event_coverage").fetchone()
        generated_at = stamp_row[0] or ""

        match_rows = con.execute(
            """
            SELECT m.match_id, c.gender, m.competition_id, m.season, m.date_utc,
                   th.canonical_name, ta.canonical_name, m.home_score, m.away_score
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
        red_cards: Dict[str, List[Tuple[int, str]]] = {}
        event_rows = con.execute(
            """
            SELECT e.match_id, e.event_type, e.minute, e.added_time, e.team_side
            FROM match_events e
            ORDER BY e.match_id, e.minute, e.added_time, e.seq
            """
        )
        for match_id, event_type, minute, added_time, team_side in event_rows:
            if team_side not in ("home", "away"):
                continue
            eff = effective_minute(minute, added_time)
            if event_type in GOAL_EVENT_TYPES:
                goal_events.setdefault(match_id, []).append((eff, team_side))
            elif event_type == "red_card":
                red_cards.setdefault(match_id, []).append((eff, team_side))
    finally:
        con.close()

    rows: List[list] = []
    skipped = 0
    for match_id, gender, comp_id, season, date_utc, home_name, away_name, hs, aw in match_rows:
        hs, aw = int(hs), int(aw)
        goals = goal_events.get(match_id, [])
        home_total = sum(1 for _, side in goals if side == "home")
        if home_total != hs or len(goals) - home_total != aw:
            skipped += 1
            continue

        facts = compute_facts(goals, red_cards.get(match_id, []), hs, aw)
        vector = build_feature_vector(goals, facts, hs, aw, gender)
        rows.append(
            [
                match_id,
                comp_id,
                season,
                (date_utc or "")[:10],
                home_name or "",
                away_name or "",
                f"{hs}-{aw}",
                gender,
                encode_vector(vector),
                facts.as_list(),
            ]
        )

    return BuildResult(
        rows=rows,
        matches_indexed=len(rows),
        matches_skipped_integrity=skipped,
        generated_at=generated_at,
    )


# ---------------------------------------------------------------------------
# Artifact writing
# ---------------------------------------------------------------------------


def write_artifact(result: BuildResult, out_path: Path) -> Path:
    """One row per line: compact, deterministic, diff-friendly."""

    out_path.parent.mkdir(parents=True, exist_ok=True)

    meta = {
        "schema": SCHEMA_VERSION,
        "feature_version": FEATURE_VERSION,
        "dim": DIM,
        "count": result.matches_indexed,
        "matches_skipped_integrity": result.matches_skipped_integrity,
        "generated_at": result.generated_at,
        "columns": list(COLUMNS),
        "facts_columns": list(FACTS_COLUMNS),
    }

    lines = [
        "{",
        f'"meta": {json.dumps(meta, sort_keys=True, separators=(", ", ": "))},',
        '"rows": [',
    ]
    body = ",\n".join(
        json.dumps(row, separators=(",", ":"), ensure_ascii=True) for row in result.rows
    )
    if body:
        lines.append(body)
    lines.append("]")
    lines.append("}")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="warehouse SQLite path")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_PATH, help="artifact output path")
    args = parser.parse_args(argv)

    result = build_index(args.db)
    path = write_artifact(result, args.out)

    print(f"matches_indexed={result.matches_indexed}")
    print(f"matches_skipped_integrity={result.matches_skipped_integrity}")
    print(f"dim={DIM}")
    print(f"bytes={path.stat().st_size}")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
