"""Paired scoring of the retrained neural stack against every live yardstick.

`train_unified` reports a test Brier, but on its own that number decides
nothing. The standing rule is that an accuracy claim is a **paired** score
against the closing line on named fixtures, and the promotion rule is that the
neural stack does not serve in a league until it beats Dixon-Coles out of
sample *there*. This script produces exactly that comparison.

Method
------
* Rebuild the trainer's rows and take its chronological test slice — the same
  `_chronological_split` with the same fractions, so the fixtures scored here
  are precisely the ones the model never saw.
* Score four forecasters on the identical fixture set:
    - the saved `unified_<gender>` artifact (with its fitted calibration),
    - walk-forward Dixon-Coles, fit on every match strictly before the test
      slice begins,
    - the de-vigged closing line,
    - the constant base rate, computed on the training slice only.
* Report pooled and per-league, and restrict the market comparison to rows
  that actually carry a price, because ~4% do not and an unpaired average
  would flatter whichever model saw the easier subset.

Brier is multiclass **summed** over the three outcomes, matching the rest of
the project: uniform 1/3 scores .6667, lower is better.

    .venv/bin/python -m backend.scripts.benchmark_unified_vs_dc

Writes backend/data/diagnostics/unified_vs_dc.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import pickle
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import penaltyblog as pb
import torch

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.train_unified import (  # noqa: E402
    MODEL_DIR,
    TrainingRow,
    _build_training_rows,
    _chronological_split,
    _collect_outputs,
    _to_tensors,
)
from backend.services.data.warehouse import Warehouse  # noqa: E402
from backend.services.prediction.calibration import apply_calibration  # noqa: E402
from backend.services.prediction.unified_model import UnifiedMatchModel  # noqa: E402

logger = logging.getLogger("benchmark_unified_vs_dc")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "unified_vs_dc.json"
WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")
DC_XI = 0.0018  # same time-decay the challenger benchmark uses


def brier(p: Sequence[float], idx: int) -> float:
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def log_loss(p: Sequence[float], idx: int) -> float:
    return -math.log(max(1e-15, p[idx]))


def devig(oh: float, od: float, oa: float) -> List[float]:
    inv = [1.0 / oh, 1.0 / od, 1.0 / oa]
    s = sum(inv)
    return [x / s for x in inv]


def _normalise(p: Sequence[float]) -> Optional[List[float]]:
    if any(v is None or not math.isfinite(v) for v in p):
        return None
    s = sum(p)
    if s <= 0:
        return None
    return [v / s for v in p]


def _load_artifact(gender: str) -> Tuple[UnifiedMatchModel, object, Dict]:
    suffix = "men" if gender == "M" else "women"
    blob = torch.load(MODEL_DIR / f"unified_{suffix}.pt", map_location="cpu", weights_only=False)
    model = UnifiedMatchModel.from_state_blob(blob)
    model.eval()
    with open(MODEL_DIR / f"unified_{suffix}_scaler.pkl", "rb") as f:
        scaler = pickle.load(f)
    with open(MODEL_DIR / f"unified_{suffix}_calibrator.pkl", "rb") as f:
        calibration = pickle.load(f)
    return model, scaler, calibration


def _warehouse_rows(warehouse, gender: str, min_season: Optional[int]) -> List[sqlite3.Row]:
    """The warehouse rows `_build_training_rows` keeps, in the same order.

    TrainingRow carries the model's *remapped* team ids, not warehouse ones, so
    it cannot be joined back to `matches` on its own. Replaying the trainer's
    filter — same iterator, same order, drop rows with no score — yields a list
    that is positionally identical to its output, which is what lets the
    closing price and the Dixon-Coles team names line up with the right fixture.
    """
    rows = list(warehouse.iter_matches(gender=gender))
    if min_season is not None:
        rows = [r for r in rows if int(r["season"] or 0) >= min_season]
    return [r for r in rows if r["home_score"] is not None and r["away_score"] is not None]


def _fit_dixon_coles(conn: sqlite3.Connection, comp: str, before: str):
    rows = conn.execute(
        """SELECT m.date_utc, th.canonical_name, ta.canonical_name, m.home_score, m.away_score
           FROM matches m
           JOIN teams th ON th.team_id = m.home_team_id
           JOIN teams ta ON ta.team_id = m.away_team_id
           WHERE m.competition_id = ? AND m.home_score IS NOT NULL AND m.date_utc < ?
           ORDER BY m.date_utc""",
        (comp, before),
    ).fetchall()
    if len(rows) < 500:
        return None
    dates = np.array([np.datetime64(r[0][:10]) for r in rows])
    age = (dates.max() - dates).astype("timedelta64[D]").astype(float)
    try:
        model = pb.models.DixonColesGoalModel(
            goals_home=[r[3] for r in rows],
            goals_away=[r[4] for r in rows],
            teams_home=[r[1] for r in rows],
            teams_away=[r[2] for r in rows],
            weights=np.exp(-DC_XI * age),
        )
        model.fit()
        return model
    except Exception as exc:  # noqa: BLE001
        logger.warning("Dixon-Coles fit failed for %s: %s", comp, exc)
        return None


class Tally:
    __slots__ = ("n", "b", "ll", "hit", "per_fixture")

    def __init__(self) -> None:
        self.n = 0
        self.b = 0.0
        self.ll = 0.0
        self.hit = 0
        # Kept so the NN-vs-DC difference can be bootstrapped *paired*: the two
        # forecasters see the same fixtures, so resampling them independently
        # would throw away the pairing and widen the interval for no reason.
        self.per_fixture: List[float] = []

    def add(self, p: Sequence[float], idx: int) -> None:
        self.n += 1
        sq = brier(p, idx)
        self.b += sq
        self.per_fixture.append(sq)
        self.ll += log_loss(p, idx)
        self.hit += int(max(range(3), key=lambda i: p[i]) == idx)

    def as_dict(self) -> Optional[Dict[str, float]]:
        if self.n == 0:
            return None
        return {
            "n": self.n,
            "brier": round(self.b / self.n, 4),
            "log_loss": round(self.ll / self.n, 4),
            "accuracy": round(self.hit / self.n, 4),
        }


def paired_bootstrap(
    a: Sequence[float], b: Sequence[float], *, iters: int = 10000, seed: int = 12345
) -> Dict[str, float]:
    """95% CI on mean(a) - mean(b), resampling fixtures (not forecasters).

    A ~.003 Brier difference over ~500 fixtures is well inside the range where
    noise looks like a result, so the sign of the point estimate is not enough
    to promote a model. This returns the interval and the share of resamples
    where `a` wins, which is what the promotion decision should read.
    """
    assert len(a) == len(b)
    rng = np.random.default_rng(seed)
    diff = np.asarray(a, dtype=np.float64) - np.asarray(b, dtype=np.float64)
    n = len(diff)
    if n == 0:
        return {}
    idx = rng.integers(0, n, size=(iters, n))
    means = diff[idx].mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return {
        "mean_diff": round(float(diff.mean()), 5),
        "ci95_low": round(float(lo), 5),
        "ci95_high": round(float(hi), 5),
        "p_a_better": round(float((means < 0).mean()), 4),
        "significant": bool(hi < 0 or lo > 0),
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gender", default="M", choices=["M", "F"])
    ap.add_argument("--min-season", type=int, default=None)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    warehouse = Warehouse(DB)
    rows, _builder = _build_training_rows(
        warehouse, gender=args.gender, min_season=args.min_season
    )
    train_rows, _val_rows, test_rows = _chronological_split(rows)
    if not test_rows:
        logger.error("no test rows")
        return 2
    split_date = min(r.date_utc for r in test_rows)
    logger.info(
        "test slice: %d fixtures from %s to %s",
        len(test_rows), split_date[:10], max(r.date_utc for r in test_rows)[:10],
    )

    # Base rate from the TRAINING slice only — using the test slice's own
    # outcome distribution would leak the answer into the yardstick.
    counts = [0, 0, 0]
    for r in train_rows:
        counts[r.outcome_target] += 1
    base_p = [c / max(1, sum(counts)) for c in counts]
    logger.info("train base rate: %.3f / %.3f / %.3f", *base_p)

    model, scaler, calibration = _load_artifact(args.gender)
    tensors = _to_tensors(test_rows, torch.device("cpu"), scaler)
    outputs = _collect_outputs(model, tensors)
    probs = apply_calibration(outputs["logits"], outputs["pmf_probs"], calibration)

    conn = warehouse._conn  # noqa: SLF001
    conn.row_factory = sqlite3.Row

    # Positional companion to `rows`, carrying the warehouse ids the model row
    # has lost. Assert the alignment rather than trusting it — a silent
    # off-by-one here would score every fixture against the wrong price.
    wh_rows = _warehouse_rows(warehouse, args.gender, args.min_season)
    if len(wh_rows) != len(rows):
        logger.error(
            "warehouse/model row mismatch (%d vs %d) — cannot pair safely",
            len(wh_rows), len(rows),
        )
        return 2
    for a, b in zip(wh_rows, rows):
        assert a["date_utc"] == b.date_utc and a["competition_id"] == b.competition_id
    n_train_val = len(rows) - len(test_rows)
    wh_test = wh_rows[n_train_val:]

    dc_models = {
        comp: _fit_dixon_coles(conn, comp, split_date)
        for comp in sorted({r.competition_id for r in test_rows} & set(WAVE_A))
    }

    # Team names for the Dixon-Coles lookup, by warehouse team_id.
    names = {
        r["team_id"]: r["canonical_name"]
        for r in conn.execute("SELECT team_id, canonical_name FROM teams")
    }

    pooled: Dict[str, Tally] = defaultdict(Tally)
    per_league: Dict[str, Dict[str, Tally]] = defaultdict(lambda: defaultdict(Tally))
    skipped = 0

    for i, row in enumerate(test_rows):
        comp = row.competition_id
        idx = row.outcome_target
        wh = wh_test[i]

        oh, od, oa = wh["odds_home"], wh["odds_draw"], wh["odds_away"]
        price = (oh, od, oa) if None not in (oh, od, oa) and min(oh, od, oa) > 1.0 else None
        dc = dc_models.get(comp)
        dc_p = None
        if dc is not None:
            try:
                pred = dc.predict(
                    names.get(wh["home_team_id"]), names.get(wh["away_team_id"])
                )
                dc_p = _normalise([pred.home_win, pred.draw, pred.away_win])
            except Exception:
                dc_p = None

        # Only fixtures where BOTH challengers and the market can speak are
        # scored, so every row of the table describes the same fixtures.
        if price is None or dc_p is None:
            skipped += 1
            continue
        mkt_p = devig(*price)
        nn_p = _normalise(list(map(float, probs[i])))
        if nn_p is None:
            skipped += 1
            continue

        for label, p in (
            ("unified_nn", nn_p),
            ("dixon_coles", dc_p),
            ("market", mkt_p),
            ("base_rate", base_p),
        ):
            pooled[label].add(p, idx)
            per_league[comp][label].add(p, idx)

    logger.info("scored %d fixtures (%d skipped: no price or no DC)", pooled["market"].n, skipped)

    def table(t: Dict[str, Tally]) -> Dict[str, Optional[Dict[str, float]]]:
        return {k: v.as_dict() for k, v in t.items()}

    pooled_out = table(pooled)
    nn = pooled_out.get("unified_nn")
    dcp = pooled_out.get("dixon_coles")
    mk = pooled_out.get("market")

    leagues_out = {}
    beats_dc = []           # point estimate only
    beats_dc_significant = []   # survives the paired bootstrap
    for comp, tallies in sorted(per_league.items()):
        t = table(tallies)
        a, b = t.get("unified_nn"), t.get("dixon_coles")
        wins = bool(a and b and a["brier"] < b["brier"])
        boot = paired_bootstrap(
            tallies["unified_nn"].per_fixture, tallies["dixon_coles"].per_fixture
        )
        if wins:
            beats_dc.append(comp)
        if wins and boot.get("significant"):
            beats_dc_significant.append(comp)
        leagues_out[comp] = {
            **t,
            "unified_beats_dc": wins,
            "unified_vs_dc_bootstrap": boot,
        }

    pooled_boot = paired_bootstrap(
        pooled["unified_nn"].per_fixture, pooled["dixon_coles"].per_fixture
    )

    result = {
        "artifact": "unified_vs_dc",
        "version": 1,
        "gender": args.gender,
        "convention": "Multiclass Brier summed over outcomes; uniform 1/3 = 0.6667. Lower is better.",
        "method": (
            "Chronological holdout from train_unified (same split), scored paired against "
            "walk-forward Dixon-Coles, the de-vigged closing line and the training-slice "
            "base rate on identical fixtures."
        ),
        "test_from": split_date[:10],
        "n_scored": pooled["market"].n,
        "n_skipped": skipped,
        "pooled": pooled_out,
        "by_league": leagues_out,
        "unified_vs_dc_pooled_bootstrap": pooled_boot,
        "unified_beats_dc_in": beats_dc,
        "unified_beats_dc_significant_in": beats_dc_significant,
        "serving_recommendation": (
            f"Unified clears the gate in: {', '.join(beats_dc_significant)}"
            if beats_dc_significant
            else "Dixon-Coles remains the serving default — no league's margin "
                 "survives a paired bootstrap"
        ),
    }

    for label in ("unified_nn", "dixon_coles", "market", "base_rate"):
        row = pooled_out.get(label)
        if row:
            gap = row["brier"] - mk["brier"] if mk else float("nan")
            logger.info(
                "%-14s brier=%.4f  ll=%.4f  acc=%.4f  gap_to_market=%+.4f",
                label, row["brier"], row["log_loss"], row["accuracy"], gap,
            )
    if nn and dcp:
        logger.info(
            "unified - dixon_coles = %+.4f Brier  ->  %s",
            nn["brier"] - dcp["brier"],
            "unified wins" if nn["brier"] < dcp["brier"] else "Dixon-Coles wins",
        )
    if pooled_boot:
        logger.info(
            "pooled NN-DC diff %+.5f  95%% CI [%+.5f, %+.5f]  p(NN better)=%.3f  %s",
            pooled_boot["mean_diff"], pooled_boot["ci95_low"], pooled_boot["ci95_high"],
            pooled_boot["p_a_better"],
            "SIGNIFICANT" if pooled_boot["significant"] else "not significant",
        )
    for comp, v in leagues_out.items():
        bt = v.get("unified_vs_dc_bootstrap") or {}
        if bt:
            logger.info(
                "  %-7s diff %+.5f  CI [%+.5f, %+.5f]  %s",
                comp, bt["mean_diff"], bt["ci95_low"], bt["ci95_high"],
                "significant" if bt["significant"] else "noise",
            )
    logger.info(
        "beats DC (point estimate) in %d of %d; survives bootstrap in %d: %s",
        len(beats_dc), len(leagues_out), len(beats_dc_significant),
        beats_dc_significant or "none",
    )

    p = Path(args.output)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(result, indent=2))
    logger.info("wrote %s", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
