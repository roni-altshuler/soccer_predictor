"""IN-MATCH gate for Match Engine v0 — state-conditional 1X2 vs exact counts.

The pre-match gate (``backend/scripts/backtest.py`` →
``backend/data/diagnostics/engine_v0_vs_dc.json``) failed honestly: at
kickoff the engine's state dynamics integrate out and it collapses onto its
Dixon-Coles anchors. IN-MATCH is where the engine must earn its keep: at a
mid-match state (minute, score, red cards) it knows WHO is playing (via the
walk-forward DC anchors) while the count-based empirical baseline
(``backend/data/rarity/state_outcomes.json`` semantics) only knows the state.

Protocol (same walk-forward discipline as the shipped pre-match gate):

* Fixtures: the held-out season per competition, scored through the exact
  ``_backtest_core`` machinery — same matchday blocks, same
  ``load_competition_matches(..., until=block_start)`` training cuts, same
  ``MIN_FIT_MATCHES`` skip rule. Only event-covered fixtures (grid rows in
  ``backend/data/cache/engine/``) are scored; uncovered fixtures are skipped
  for EVERY predictor identically.
* Checkpoints: minute ∈ {15, 30, 45, 60, 75}, using each match's ACTUAL
  score/reds at that minute, read from the reconciled per-minute grids
  (cumulative counts over bins strictly before the checkpoint — the same
  state the engine was trained on; added time folds into the 45'/90' bins).
* Predictors, per (fixture, checkpoint):
  1. engine    — exact forward DP from the checkpoint state
                 (``rollout_from_state``), per-block DC anchors shared with
                 the DC baseline, per-block warm-start fine-tuning and the
                 trained-until leakage guard via ``MatchEnginePredictor``.
  2. counts    — the rarity empirical function at
                 (gender, clamped score diff, minute bucket). REBUILT here
                 from covered-match grids dated STRICTLY BEFORE the earliest
                 scored fixture, so the baseline is leakage-clean AND sees
                 byte-identical states (grid semantics) to the engine. The
                 committed artifact (built on ALL covered matches, test
                 season included — leaky in the baseline's favour) is also
                 scored, as ``counts_committed``, for reference.
  3. dc_frozen — the block's kickoff Dixon-Coles 1X2, ignoring state (floor).
* Metric: multiclass Brier (Σ(p−y)², as in ``_backtest_core``), per
  checkpoint, pooled and per gender, with paired matchday-block bootstrap
  CIs on Δ(engine − counts).

GATE: the engine beats the rebuilt count baseline (pooled Brier) at a
majority of the five checkpoints, INCLUDING 60' and 75'.

Artifact (committed): ``backend/data/diagnostics/engine_v0_inmatch_gate.json``.

Run
---
    python -m backend.scripts.evaluate_inmatch_gate
    python -m backend.scripts.evaluate_inmatch_gate --competitions eng.1 \
        --bootstrap 1000
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts._backtest_core import (  # noqa: E402
    MIN_FIT_MATCHES,
    BlockContext,
    MatchRecord,
    brier,
    competition_gender,
    latest_complete_season,
    load_season_matches,
    matchday_blocks,
    outcome_index,
    paired_block_bootstrap,
)
from backend.scripts.train_dixon_coles import (  # noqa: E402
    WAREHOUSE_PATH,
    connect_readonly,
    dominant_source,
    load_competition_matches,
)

CHECKPOINTS: Tuple[int, ...] = (15, 30, 45, 60, 75)
GATE_REQUIRED_CHECKPOINTS: Tuple[int, ...] = (60, 75)

DEFAULT_COMPETITIONS = ["eng.1", "esp.1", "ita.1", "fra.1", "ger.1", "usa.1.w"]
DEFAULT_DATASET = ROOT / "backend" / "data" / "cache" / "engine"
DEFAULT_WEIGHTS = ROOT / "backend" / "data" / "models" / "match_engine_v0.pt"
RARITY_ARTIFACT = ROOT / "backend" / "data" / "rarity" / "state_outcomes.json"
DIAGNOSTICS_OUT = (
    ROOT / "backend" / "data" / "diagnostics" / "engine_v0_inmatch_gate.json"
)

DIFF_CLAMP = 3  # rarity key space: score diff clamped to [-3, +3]

Probs = Tuple[float, float, float]
UNIFORM: Probs = (1 / 3, 1 / 3, 1 / 3)

ENGINE = "engine"
COUNTS = "counts"
COUNTS_COMMITTED = "counts_committed"
DC_FROZEN = "dc_frozen"
MODEL_NAMES = (ENGINE, COUNTS, COUNTS_COMMITTED, DC_FROZEN)


# ---------------------------------------------------------------------------
# Checkpoint states from the per-minute grids
# ---------------------------------------------------------------------------
class GridStateStore:
    """Checkpoint states (score, reds) for covered matches, by match_id.

    The state at checkpoint minute ``cp`` is the cumulative count over grid
    bins strictly before ``cp`` — bins 0..cp-1 cover minutes 1..cp, which is
    exactly the information set of ``rollout_from_state(start_minute=cp)``
    and of the engine's teacher-forced training cells.
    """

    def __init__(self, dataset_dir: Path) -> None:
        data = np.load(dataset_dir / "grids.npz")
        self.goal_home = data["goal_home"]
        self.goal_away = data["goal_away"]
        self.red_home = data["red_home"]
        self.red_away = data["red_away"]
        self.gender = data["gender"]  # 0 = M, 1 = F
        meta: List[Dict[str, object]] = json.loads(
            (dataset_dir / "matches.json").read_text(encoding="utf-8")
        )
        self.meta = meta
        self.by_id: Dict[str, int] = {
            str(m["match_id"]): i for i, m in enumerate(meta)
        }
        self.dates = np.array([str(m["date_utc"]) for m in meta])
        # Precompute cumulative states at every checkpoint (vectorised).
        self._cum: Dict[int, Tuple[np.ndarray, ...]] = {}
        for cp in CHECKPOINTS:
            self._cum[cp] = (
                self.goal_home[:, :cp].sum(axis=1).astype(np.int64),
                self.goal_away[:, :cp].sum(axis=1).astype(np.int64),
                self.red_home[:, :cp].sum(axis=1).astype(np.int64),
                self.red_away[:, :cp].sum(axis=1).astype(np.int64),
            )

    def index_of(self, match_id: str) -> Optional[int]:
        return self.by_id.get(match_id)

    def state_at(self, idx: int, cp: int) -> Tuple[int, int, int, int]:
        gh, ga, rh, ra = self._cum[cp]
        return int(gh[idx]), int(ga[idx]), int(rh[idx]), int(ra[idx])


# ---------------------------------------------------------------------------
# Count baselines (rarity empirical function)
# ---------------------------------------------------------------------------
def clamp_diff(diff: int) -> int:
    return max(-DIFF_CLAMP, min(DIFF_CLAMP, int(diff)))


def state_key(gender: str, diff: int, bucket: int) -> str:
    """Canonical rarity key — must match build_rarity.py / src/lib/rarity.ts."""
    return f"{gender}:{clamp_diff(diff)}:{bucket}"


def build_count_table(
    store: GridStateStore, cut_date: str
) -> Tuple[Dict[str, Dict[str, int]], int]:
    """Exact W/D/L counts keyed (gender, clamped diff, checkpoint) from grids.

    Both sides of every match dated STRICTLY BEFORE ``cut_date`` contribute
    (the committed rarity artifact pools sides the same way — home/away
    enter only through the score difference). States use the same grid
    semantics as the engine, so baseline and engine condition on identical
    information at every checkpoint.
    """
    mask = store.dates < cut_date
    idxs = np.where(mask)[0]
    final_h = store.goal_home.sum(axis=1).astype(np.int64)
    final_a = store.goal_away.sum(axis=1).astype(np.int64)
    table: Dict[str, Dict[str, int]] = {}
    for cp in CHECKPOINTS:
        gh, ga, _, _ = store._cum[cp]
        for i in idxs:
            gender = "F" if store.gender[i] else "M"
            diff = int(gh[i]) - int(ga[i])
            home_out = outcome_index(int(final_h[i]), int(final_a[i]))
            for side_diff, out in (
                (diff, home_out),
                (-diff, 2 - home_out),  # away perspective mirrors the outcome
            ):
                key = state_key(gender, side_diff, cp)
                counts = table.setdefault(key, {"n": 0, "w": 0, "d": 0, "l": 0})
                counts["n"] += 1
                if out == 0:
                    counts["w"] += 1
                elif out == 1:
                    counts["d"] += 1
                else:
                    counts["l"] += 1
    return table, int(len(idxs))


class CountModel:
    """1X2 from exact counts: query with the HOME side's score difference."""

    def __init__(self, states: Dict[str, Dict[str, int]]) -> None:
        self.states = states
        self.fallbacks = 0

    def probs(self, gender: str, home_diff: int, cp: int) -> Probs:
        counts = self.states.get(state_key(gender, home_diff, cp))
        n = int(counts["n"]) if counts else 0
        if n <= 0:
            self.fallbacks += 1
            return UNIFORM
        return (counts["w"] / n, counts["d"] / n, counts["l"] / n)


def load_committed_counts(path: Path) -> Tuple[CountModel, int]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return CountModel(payload["states"]), int(payload.get("matches_covered", 0))


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------
def mean_brier(records: Sequence[MatchRecord], name: str) -> float:
    if not records:
        return float("nan")
    return float(
        np.mean([brier(rec.probs[name], rec.outcome) for rec in records])
    )


def summarize_group(
    records: Sequence[MatchRecord], n_boot: int
) -> Dict[str, object]:
    out: Dict[str, object] = {"n": len(records)}
    for name in MODEL_NAMES:
        out[f"{name}_brier"] = round(mean_brier(records, name), 6)
    out["uniform_brier"] = round(
        float(np.mean([brier(UNIFORM, rec.outcome) for rec in records]))
        if records
        else float("nan"),
        6,
    )
    out["delta_engine_minus_counts"] = round(
        mean_brier(records, ENGINE) - mean_brier(records, COUNTS), 6
    )
    out["bootstrap_vs_counts"] = paired_block_bootstrap(
        records, COUNTS, ENGINE, n_boot=n_boot
    )
    return out


def evaluate_gate(
    checkpoint_summaries: Dict[int, Dict[str, object]],
) -> Dict[str, object]:
    """Gate rule: engine < counts (pooled Brier) at a majority of the five
    checkpoints, including every checkpoint in GATE_REQUIRED_CHECKPOINTS."""
    wins: Dict[str, bool] = {}
    for cp in CHECKPOINTS:
        s = checkpoint_summaries[cp]
        wins[str(cp)] = bool(s[f"{ENGINE}_brier"] < s[f"{COUNTS}_brier"])
    n_wins = sum(wins.values())
    required_ok = all(wins[str(cp)] for cp in GATE_REQUIRED_CHECKPOINTS)
    passed = n_wins > len(CHECKPOINTS) / 2 and required_ok
    return {
        "criterion": (
            "engine pooled Brier < rebuilt-count-baseline pooled Brier at a "
            "majority of checkpoints {15,30,45,60,75}, including 60 and 75"
        ),
        "checkpoint_wins": wins,
        "n_wins": n_wins,
        "required_checkpoints_won": required_ok,
        "passed": bool(passed),
    }


# ---------------------------------------------------------------------------
# The walk-forward evaluation loop
# ---------------------------------------------------------------------------
def run_gate(args: argparse.Namespace) -> Dict[str, object]:
    from backend.scripts.backtest import MatchEnginePredictor
    from backend.services.prediction.match_engine import (
        MAX_GOALS,
        outcome_probs,
        rollout_from_state,
    )

    t0 = time.time()
    store = GridStateStore(args.dataset)
    engine = MatchEnginePredictor(
        weights_path=args.engine_weights,
        dataset_dir=args.dataset,
        finetune_epochs=args.finetune_epochs,
        finetune_lr=args.finetune_lr,
    )

    con = connect_readonly(args.warehouse)
    try:
        # Pass 1 — fixture plan (also determines the count-table cut date).
        plans: List[Tuple[str, int, str, str, list]] = []
        for comp in args.competitions:
            source = dominant_source(con, comp)
            if source is None:
                print(f"!! {comp}: no data")
                continue
            season = args.season or latest_complete_season(con, comp, source)
            if season is None:
                print(f"!! {comp}: no complete season")
                continue
            rows = load_season_matches(con, comp, source, season)
            if not rows:
                print(f"!! {comp} season {season}: no completed matches")
                continue
            gender = competition_gender(con, comp)
            plans.append((comp, season, source, gender, rows))
        if not plans:
            raise SystemExit("Nothing to evaluate.")

        cut_date = min(
            str(row["date_utc"]) for _, _, _, _, rows in plans for row in rows
        )
        print(f"Count-baseline cut date (earliest scored fixture): {cut_date}")
        count_states, counts_corpus = build_count_table(store, cut_date)
        counts_model = CountModel(count_states)
        committed_model, committed_corpus = load_committed_counts(
            args.rarity_artifact
        )
        print(
            f"Rebuilt count baseline: {counts_corpus} covered matches "
            f"strictly before the cut (committed artifact pools "
            f"{committed_corpus}, test season INCLUDED — leaky reference)"
        )

        # Pass 2 — walk-forward blocks, checkpoint scoring.
        records_by_cp: Dict[int, List[MatchRecord]] = {cp: [] for cp in CHECKPOINTS}
        comp_gender: Dict[str, str] = {}
        comp_meta: Dict[str, Dict[str, object]] = {}
        for comp, season, source, gender, rows in plans:
            comp_gender[comp] = gender
            gender_f = 1.0 if gender == "F" else 0.0
            blocks = matchday_blocks(rows)
            scored = skipped_history = skipped_uncovered = 0
            print(f"Evaluating {comp} season {season} ({len(blocks)} blocks)…")
            for block_index, block in enumerate(blocks):
                block_start = str(block[0]["date_utc"])
                train = load_competition_matches(
                    con, comp, args.seasons, source=source, until=block_start
                )
                if len(train) < MIN_FIT_MATCHES:
                    skipped_history += len(block)
                    continue
                ctx = BlockContext(
                    competition_id=comp,
                    season=season,
                    source=source,
                    gender=gender,
                    block_index=block_index,
                    block_start=block_start,
                    train=train,
                    n_seasons=args.seasons,
                    half_life_days=args.half_life,
                )
                engine.fit_block(ctx)  # leakage guard + warm-start fine-tune
                dc = ctx.dc_model
                rho = float(dc.rho)
                for row in block:
                    gidx = store.index_of(str(row["match_id"]))
                    if gidx is None:
                        skipped_uncovered += 1
                        continue
                    out = outcome_index(
                        int(row["home_score"]), int(row["away_score"])
                    )
                    lam, mu = dc.expected_goals(row["home"], row["away"])
                    pred = dc.predict(row["home"], row["away"])
                    dc_probs: Probs = (
                        pred["p_home"],
                        pred["p_draw"],
                        pred["p_away"],
                    )
                    for cp in CHECKPOINTS:
                        h, a, rh, ra = store.state_at(gidx, cp)
                        mat = rollout_from_state(
                            lam,
                            mu,
                            rho,
                            engine.net,
                            gender_f=gender_f,
                            start_minute=cp,
                            score=(min(h, MAX_GOALS), min(a, MAX_GOALS)),
                            reds=(rh, ra),
                        )
                        records_by_cp[cp].append(
                            MatchRecord(
                                competition_id=comp,
                                season=season,
                                block_index=block_index,
                                match_id=str(row["match_id"]),
                                date_utc=str(row["date_utc"]),
                                outcome=out,
                                probs={
                                    ENGINE: outcome_probs(mat),
                                    COUNTS: counts_model.probs(
                                        gender, h - a, cp
                                    ),
                                    COUNTS_COMMITTED: committed_model.probs(
                                        gender, h - a, cp
                                    ),
                                    DC_FROZEN: dc_probs,
                                },
                                market=None,
                            )
                        )
                    scored += 1
            comp_meta[comp] = {
                "season": season,
                "source": source,
                "gender": gender,
                "n_scored": scored,
                "skipped_insufficient_history": skipped_history,
                "skipped_uncovered": skipped_uncovered,
            }
            print(
                f"  {comp}: {scored} fixtures scored, "
                f"{skipped_uncovered} uncovered skipped"
            )
    finally:
        con.close()

    # ---- summaries ----
    checkpoints_out: Dict[str, object] = {}
    pooled_summaries: Dict[int, Dict[str, object]] = {}
    for cp in CHECKPOINTS:
        recs = records_by_cp[cp]
        summary = summarize_group(recs, args.bootstrap)
        summary["bootstrap_vs_dc_frozen"] = paired_block_bootstrap(
            recs, DC_FROZEN, ENGINE, n_boot=args.bootstrap
        )
        by_gender: Dict[str, object] = {}
        for g in ("M", "F"):
            g_recs = [r for r in recs if comp_gender[r.competition_id] == g]
            if g_recs:
                by_gender[g] = summarize_group(g_recs, args.bootstrap)
        summary["by_gender"] = by_gender
        pooled_summaries[cp] = summary
        checkpoints_out[str(cp)] = summary

    gate = evaluate_gate(pooled_summaries)

    all_records = [rec for cp in CHECKPOINTS for rec in records_by_cp[cp]]
    overall = {
        "n_states": len(all_records),
        "n_fixtures": len(records_by_cp[CHECKPOINTS[0]]),
        ENGINE + "_brier": round(mean_brier(all_records, ENGINE), 6),
        COUNTS + "_brier": round(mean_brier(all_records, COUNTS), 6),
        COUNTS_COMMITTED + "_brier": round(
            mean_brier(all_records, COUNTS_COMMITTED), 6
        ),
        DC_FROZEN + "_brier": round(mean_brier(all_records, DC_FROZEN), 6),
    }

    return {
        "schema": 1,
        "generated_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat(),
        "protocol": {
            "checkpoints": list(CHECKPOINTS),
            "state_source": (
                "reconciled per-minute event grids; state at checkpoint m = "
                "cumulative goals/reds over minute bins strictly before m "
                "(added time folded into the 45'/90' bins) — identical "
                "information for every predictor"
            ),
            "walk_forward": (
                "same harness discipline as engine_v0_vs_dc.json: per-block "
                "DC refits on matches strictly before each matchday block, "
                "per-block engine warm-start fine-tuning, trained_until "
                "leakage guard enforced"
            ),
            "engine_trained_until": engine.trained_until,
        },
        "baselines": {
            "counts": {
                "description": (
                    "exact W/D/L counts at (gender, clamped score diff, "
                    "minute bucket), both sides pooled — the rarity "
                    "empirical function, rebuilt leakage-clean"
                ),
                "corpus_matches": counts_corpus,
                "cut_date": cut_date,
                "uniform_fallbacks": counts_model.fallbacks,
            },
            "counts_committed": {
                "description": (
                    "the committed rarity artifact, which was built on ALL "
                    "covered matches INCLUDING the test season — leakage "
                    "favours this baseline, so it is reference-only"
                ),
                "corpus_matches": committed_corpus,
                "uniform_fallbacks": committed_model.fallbacks,
            },
            "dc_frozen": "kickoff Dixon-Coles probabilities, state ignored",
        },
        "run": {
            "competitions": comp_meta,
            "seasons_window": args.seasons,
            "half_life_days": args.half_life,
            "finetune_epochs": args.finetune_epochs,
            "finetune_lr": args.finetune_lr,
            "n_boot": args.bootstrap,
            "wall_clock_seconds": round(time.time() - t0, 1),
        },
        "checkpoints": checkpoints_out,
        "overall": overall,
        "gate": gate,
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def print_report(artifact: Dict[str, object]) -> None:
    line = "-" * 86
    print()
    print("=" * 86)
    print("IN-MATCH GATE — engine vs exact-count baseline vs frozen kickoff DC")
    print("(multiclass Brier at actual mid-match states; lower is better)")
    print("=" * 86)
    header = (
        f"{'minute':>7}{'n':>7}{'engine':>10}{'counts':>10}"
        f"{'counts*':>10}{'frozen DC':>11}{'Δ(eng−cnt)':>12}{'95% CI':>22}"
    )
    print(header)
    print(line)
    for cp_key, s in artifact["checkpoints"].items():  # type: ignore[union-attr]
        boot = s["bootstrap_vs_counts"]
        ci = (
            f"[{boot['ci_low']:+.5f}, {boot['ci_high']:+.5f}]"
            if boot
            else "n/a"
        )
        print(
            f"{cp_key:>6}'{s['n']:>7}{s['engine_brier']:>10.4f}"
            f"{s['counts_brier']:>10.4f}{s['counts_committed_brier']:>10.4f}"
            f"{s['dc_frozen_brier']:>11.4f}"
            f"{s['delta_engine_minus_counts']:>+12.5f}{ci:>22}"
        )
    print(line)
    print("counts* = committed rarity artifact (test season included; leaky")
    print("          in the baseline's favour — reference only)")
    gate = artifact["gate"]  # type: ignore[index]
    print(
        f"GATE: wins at {gate['n_wins']}/5 checkpoints "
        f"(60': {gate['checkpoint_wins']['60']}, "
        f"75': {gate['checkpoint_wins']['75']}) → "
        f"{'PASSED' if gate['passed'] else 'FAILED'}"
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="In-match gate: Match Engine v0 vs the exact-count baseline."
    )
    parser.add_argument(
        "--competitions", nargs="+", default=DEFAULT_COMPETITIONS
    )
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--seasons", type=int, default=5)
    parser.add_argument("--half-life", type=float, default=390.0)
    parser.add_argument("--warehouse", type=Path, default=WAREHOUSE_PATH)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--engine-weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument(
        "--rarity-artifact", type=Path, default=RARITY_ARTIFACT
    )
    parser.add_argument("--finetune-epochs", type=int, default=2)
    parser.add_argument("--finetune-lr", type=float, default=1e-4)
    parser.add_argument("--bootstrap", type=int, default=10_000)
    parser.add_argument("--out", type=Path, default=DIAGNOSTICS_OUT)
    args = parser.parse_args(argv)

    artifact = run_gate(args)
    print_report(artifact)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(artifact, indent=2, ensure_ascii=False, sort_keys=True)
        + "\n",
        encoding="utf-8",
    )
    print(f"\nArtifact: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
