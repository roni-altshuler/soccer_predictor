"""Does the serving model actually beat the baselines in this league?

Adding a competition to `/season` is a claim: that the forecast on the page is
worth more than the two things a reader could do without us — assume every
outcome is equally likely, or pick the home side every time. That claim is
false often enough to be worth checking. Leagues differ in home advantage,
scoring rate, competitive balance and how much history we hold, and a model
tuned on Europe's top five is not entitled to any of them.

So this runs the SAME walk-forward the production head is trained under —
day-blocked, one competition at a time — and reports, per league:

    brier            the serving head (elo_* + form_*, logistic)
    uniform          1/3 each. Analytic floor 2/3.
    base_rate        the competition's own H/D/A frequencies, from history only
    always_home      a point mass on the home win, the naive punter's rule

A league ships only if it beats every one of those. `always_home` is the
hard one and the one that matters: it is what a reader would do instead.

    python3 -m backend.scripts.league_gate --competitions eng.2,esp.2
    python3 -m backend.scripts.league_gate            # every candidate

Writes reports/baselines/league_gate.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from pathlib import Path
from typing import List, Optional, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.baseline_walkforward import IDX, load_matches  # noqa: E402
from backend.scripts.forecast_season import KEPT_PREFIXES, fit_head  # noqa: E402
from backend.scripts.train_layered import FeatureState  # noqa: E402

logger = logging.getLogger("league_gate")
OUT = ROOT / "reports" / "baselines" / "league_gate.json"

# Every competition with a 2026-27 schedule and enough history to fit on.
CANDIDATES = [
    "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "ned.1", "por.1",
    "eng.2", "esp.2", "ger.2", "ita.2", "fra.2",
    "tur.1", "ksa.1", "bra.1", "usa.1", "mex.1", "arg.1",
]

# Refit this often rather than after every match. The head is a logistic
# regression on two feature families; refitting it 9,000 times to measure a
# league costs hours and moves the fourth decimal.
REFIT_EVERY = 380
MIN_TRAIN = 1500


def _brier(p: Sequence[Sequence[float]], y: Sequence[int]) -> float:
    return float(np.mean([
        sum((row[k] - (1.0 if k == yi else 0.0)) ** 2 for k in range(3))
        for row, yi in zip(p, y)]))


def _logloss(p: Sequence[Sequence[float]], y: Sequence[int]) -> float:
    return float(np.mean([-math.log(max(row[yi], 1e-15)) for row, yi in zip(p, y)]))


def walk(comp: str, min_season: int, max_season: Optional[int]) -> Optional[dict]:
    """Day-blocked walk-forward over one competition."""
    played = load_matches([comp], min_season, max_season)
    if len(played) < MIN_TRAIN * 2:
        logger.info("%-8s only %d matches — not enough to measure, skipped",
                    comp, len(played))
        return None

    state = FeatureState()
    names: Optional[List[str]] = None
    cols: Optional[List[int]] = None
    head = None
    X_hist: List[List[float]] = []
    y_hist: List[int] = []

    P: List[List[float]] = []
    Y: List[int] = []
    # Running H/D/A counts from matches ALREADY OBSERVED — never the full
    # sample, which would be the competition's future leaking into its past.
    seen = np.zeros(3, dtype=np.float64)
    P_base: List[List[float]] = []

    i, n = 0, len(played)
    since_fit = 10 ** 9
    while i < n:
        j = i
        day = played[i]["local_date"]
        while j < n and played[j]["local_date"] == day:
            j += 1
        block = played[i:j]

        feats = [state.emit(m) for m in block]
        if names is None:
            names = list(feats[0].keys())
            cols = [k for k, nm in enumerate(names)
                    if any(nm.startswith(p) for p in KEPT_PREFIXES)]

        if head is not None and len(X_hist) >= MIN_TRAIN:
            Xb = np.array([[f[k] for k in names] for f in feats], dtype=np.float64)
            probs = head.predict_proba(Xb[:, cols])
            base = (seen + 1.0) / (seen.sum() + 3.0)
            for m, row in zip(block, probs):
                P.append([float(x) for x in row])
                P_base.append([float(x) for x in base])
                Y.append(IDX[m["result"]])

        for f, m in zip(feats, block):
            X_hist.append([f[k] for k in names])
            y_hist.append(IDX[m["result"]])
            seen[IDX[m["result"]]] += 1
        for m in block:
            state.observe(m)

        since_fit += len(block)
        if len(X_hist) >= MIN_TRAIN and since_fit >= REFIT_EVERY:
            head = fit_head(np.array(X_hist), np.array(y_hist), cols)
            since_fit = 0
        i = j

    if len(Y) < 500:
        logger.info("%-8s only %d scored matches — skipped", comp, len(Y))
        return None

    uniform = [[1 / 3, 1 / 3, 1 / 3]] * len(Y)
    # A point mass would be an infinite log loss on any miss, so the naive
    # punter gets the most generous reading of their own rule.
    home = [[0.999, 0.0005, 0.0005]] * len(Y)

    out = {
        "competition_id": comp,
        "n_scored": len(Y),
        "n_played": len(played),
        "seasons": [played[0]["season"], played[-1]["season"]],
        "brier": round(_brier(P, Y), 5),
        "log_loss": round(_logloss(P, Y), 5),
        "accuracy": round(float(np.mean([int(np.argmax(p) == y)
                                         for p, y in zip(P, Y)])), 5),
        "uniform": round(_brier(uniform, Y), 5),
        "base_rate": round(_brier(P_base, Y), 5),
        "always_home": round(_brier(home, Y), 5),
    }
    out["beats_uniform"] = out["brier"] < out["uniform"]
    out["beats_base_rate"] = out["brier"] < out["base_rate"]
    out["beats_always_home"] = out["brier"] < out["always_home"]
    out["ships"] = all((out["beats_uniform"], out["beats_base_rate"],
                        out["beats_always_home"]))
    logger.info(
        "%-8s n=%6d  brier %.5f | uniform %.5f  base %.5f  home %.5f  -> %s",
        comp, out["n_scored"], out["brier"], out["uniform"], out["base_rate"],
        out["always_home"], "SHIP" if out["ships"] else "HOLD")
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", default=",".join(CANDIDATES))
    ap.add_argument("--min-season", type=int, default=2000)
    ap.add_argument("--max-season", type=int, default=None)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    comps = [c.strip() for c in args.competitions.split(",") if c.strip()]
    results = []
    for comp in comps:
        try:
            r = walk(comp, args.min_season, args.max_season)
        except Exception as exc:  # noqa: BLE001
            logger.warning("%-8s failed: %s", comp, exc)
            continue
        if r:
            results.append(r)

    ships = [r["competition_id"] for r in results if r["ships"]]
    holds = [r["competition_id"] for r in results if not r["ships"]]
    logger.info("\nships (%d): %s", len(ships), ", ".join(ships))
    if holds:
        logger.info("holds (%d): %s", len(holds), ", ".join(holds))

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "protocol": "day-blocked walk-forward per competition; the head is "
                    "refit every %d matches on matches strictly before the "
                    "block it predicts. base_rate uses only already-observed "
                    "outcomes." % REFIT_EVERY,
        "min_season": args.min_season,
        "leagues": results,
        "ships": ships,
        "holds": holds,
    }, indent=2, default=str))
    logger.info("wrote %s", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
