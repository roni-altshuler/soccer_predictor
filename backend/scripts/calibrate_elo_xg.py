"""Empirically calibrate the Elo->expected-goals coupling from committed data.

The Monte Carlo simulators convert an Elo rating difference into expected
goals via a multiplicative coupling:

    z          = (home_elo - away_elo) / 400
    home_xg    = avg_goals * (1 + c * z) + home_adv
    away_xg    = avg_goals * (1 - c * z)

so the model's expected goal *supremacy* is

    home_xg - away_xg = 2 * avg_goals * c * z + home_adv
                      = (2 * avg_goals * c / 400) * (home_elo - away_elo) + home_adv

i.e. the supremacy is linear in the raw Elo difference with slope
`beta = 2 * avg_goals * c / 400` (goals per Elo point) and intercept
`home_adv` (goals of home advantage). We can therefore recover the coupling
empirically: build a chronological Elo from real match results, regress the
observed goal supremacy on the pre-match Elo difference (OLS), read off the
slope `beta`, and invert:

    c = beta * 400 / (2 * avg_goals)

This script runs entirely on the committed historical corpus under
`backend/data/historical/` (no warehouse / network needed), so the result is
reproducible in CI. It calibrates two pools independently:

  * CLUB     - domestic-league results (football-data.co.uk `fd_*` files),
               Elo built with K=20.
  * NATIONAL - World Cup / Euro / Copa America results, Elo built with K=40,
               matching `national_elo.py` (the exact Elo source the World Cup
               simulator consumes).

Run:  python -m backend.scripts.calibrate_elo_xg
"""

from __future__ import annotations

import glob
import json
import os
from collections import defaultdict
from typing import List, Tuple

HISTORICAL_DIR = os.path.join("backend", "data", "historical")

CLUB_PREFIXES = (
    "fd_premier_league",
    "fd_serie_a",
    "fd_la_liga",
    "fd_ligue_1",
    "fd_bundesliga",
    "fd_eredivisie",
    "fd_primeira_liga",
)
NATIONAL_PREFIXES = ("world_cup", "euro", "copa_america")

Row = Tuple[str, str, str, int, int]


def _load(prefixes: Tuple[str, ...]) -> List[Row]:
    rows: List[Row] = []
    for path in glob.glob(os.path.join(HISTORICAL_DIR, "*.json")):
        base = os.path.basename(path)
        if not any(base.startswith(p) for p in prefixes):
            continue
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        for m in data.get("matches", []) if isinstance(data, dict) else []:
            hs, as_ = m.get("home_score"), m.get("away_score")
            h, a = m.get("home_team"), m.get("away_team")
            if hs is None or as_ is None or not h or not a:
                continue
            rows.append((m.get("date") or "", h, a, int(hs), int(as_)))
    rows.sort(key=lambda r: r[0])
    return rows


def _goal_diff_multiplier(diff: int) -> float:
    diff = abs(diff)
    if diff <= 1:
        return 1.0
    if diff == 2:
        return 1.5
    return (11.0 + diff) / 8.0


def calibrate(rows: List[Row], k_factor: float, burn_in: int = 5) -> dict:
    """Build chronological Elo (no home advantage baked in) and OLS-regress
    goal supremacy on the pre-match Elo difference."""
    elo: dict = defaultdict(lambda: 1500.0)
    seen: dict = defaultdict(int)
    xs: List[float] = []
    ys: List[float] = []
    for _dt, h, a, hs, as_ in rows:
        eh, ea = elo[h], elo[a]
        if seen[h] >= burn_in and seen[a] >= burn_in:
            xs.append(eh - ea)
            ys.append(hs - as_)
        exp_h = 1.0 / (1.0 + 10.0 ** ((ea - eh) / 400.0))
        actual = 1.0 if hs > as_ else 0.0 if hs < as_ else 0.5
        delta = k_factor * _goal_diff_multiplier(hs - as_) * (actual - exp_h)
        elo[h] = eh + delta
        elo[a] = ea - delta
        seen[h] += 1
        seen[a] += 1

    n = len(xs)
    if n < 100:
        raise SystemExit(f"too few calibration rows ({n})")
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = sum((y - my) ** 2 for y in ys)
    beta = sxy / sxx
    alpha = my - beta * mx
    r2 = (sxy * sxy) / (sxx * syy) if syy else 0.0
    return {"n": n, "beta": beta, "home_adv_goals": alpha, "r2": r2}


def main() -> None:
    club = calibrate(_load(CLUB_PREFIXES), k_factor=20.0, burn_in=5)
    nat = calibrate(_load(NATIONAL_PREFIXES), k_factor=40.0, burn_in=2)

    print("Elo->xG coupling calibration (committed historical corpus)\n")
    for label, res in (("CLUB (domestic leagues)", club), ("NATIONAL (tournaments)", nat)):
        beta = res["beta"]
        print(
            f"{label:26s} n={res['n']:6d}  beta={beta:.5f} goals/Elo-pt"
            f"  ({beta * 100:.3f} goals/100 Elo)  home_adv={res['home_adv_goals']:.3f}g  R^2={res['r2']:.3f}"
        )
        for avg in (1.30, 1.35):
            print(f"      -> coupling c at avg_goals={avg}: {beta * 400 / (2 * avg):.3f}")

    blended = (club["beta"] + nat["beta"]) / 2.0
    print(f"\nblended beta = {blended:.5f} goals/Elo-pt  (recommended GOALS_SUPREMACY_PER_ELO)")


if __name__ == "__main__":
    main()
