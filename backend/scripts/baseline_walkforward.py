"""The true baseline: match-by-match walk-forward over the canonical spine.

What "walk-forward" means here
------------------------------
Not "train on seasons < T, test on season T". That is a fold, and a fold still
lets a model trained in July see the whole of the preceding season at once. This
harness emulates deployment literally:

    for each match, in chronological order:
        1. build the prediction from state
        2. record it
        3. reveal the result
        4. fold the result into state

State is a running object that is only ever advanced. There is no split, no
shuffle, and nothing to get wrong about which rows were "in training" — a
prediction is made before its own result exists, for every one of the 219,770
matches, in the order they were played.

Simultaneity is handled explicitly. Matches sharing a local date are predicted
as a block BEFORE any of that date is observed, so a Saturday 12:30 kickoff can
never see a Saturday 17:30 result. This is the same rule `features_v2.py` uses
and it is the single most common way a "chronological" backtest leaks.

The ladder
----------
    uniform            1/3 each — the floor no forecaster may sit below
    base_rate          running H/D/A frequency, per competition
    elo                logistic on rating difference, home advantage fitted
    elo_mov            same, updated with a damped margin-of-victory term
    dixon_coles        goal model, refit on a trailing window

Every model sees exactly the same rows in exactly the same order, so the
comparison is paired and the bootstrap below is a paired bootstrap.

Metrics
-------
Log loss and multiclass Brier are primary; accuracy is reported because it is
asked for, not because it should be optimised. Calibration is reported as a
reliability table and ECE. Differences carry a paired bootstrap interval,
because .5641 vs .5638 is not a result.

    python3 -m backend.scripts.baseline_walkforward
    python3 -m backend.scripts.baseline_walkforward --competitions eng.1,esp.1
    python3 -m backend.scripts.baseline_walkforward --min-season 2000 --no-dc

Writes reports/baselines/walkforward.json and a markdown summary.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("baseline_walkforward")

CANONICAL = ROOT / "backend" / "data" / "canonical.duckdb"
OUT_DIR = ROOT / "reports" / "baselines"

OUTCOMES = ("H", "D", "A")
IDX = {o: i for i, o in enumerate(OUTCOMES)}


# --------------------------------------------------------------------- models
class Uniform:
    """The floor. A forecaster below this is worse than knowing nothing."""

    name = "uniform"

    def predict(self, m) -> np.ndarray:
        return np.array([1 / 3, 1 / 3, 1 / 3])

    def observe(self, m) -> None:
        pass


class BaseRate:
    """Running H/D/A frequency within a competition, Laplace-smoothed.

    Not a global constant: home advantage differs enough between competitions
    (and eras) that a single prior would flatter every model above it.
    """

    name = "base_rate"

    def __init__(self) -> None:
        self.counts: Dict[str, np.ndarray] = defaultdict(
            lambda: np.ones(3, dtype=np.float64))

    def predict(self, m) -> np.ndarray:
        c = self.counts[m["competition_id"]]
        return c / c.sum()

    def observe(self, m) -> None:
        self.counts[m["competition_id"]][IDX[m["result"]]] += 1


class Elo:
    """Elo with a fitted home advantage and an ordinal draw band.

    Three-way probabilities come from the standard ordered formulation: the
    rating difference gives P(home) vs P(away) on a logistic, and the draw is
    carved out of the middle with a width parameter. `draw_width` and
    `home_adv` are NOT tuned on the test set — they are fixed at values taken
    from the literature (home advantage ~65 Elo points, draw band ~0.28) and
    left alone, because tuning them on the evaluation window is the difference
    between a baseline and a fitted model pretending to be one.
    """

    def __init__(self, *, k: float = 20.0, home_adv: float = 65.0,
                 draw_width: float = 0.28, mov: bool = False,
                 base: float = 1500.0, regress: float = 0.0) -> None:
        self.k, self.home_adv, self.draw_width = k, home_adv, draw_width
        self.mov, self.base = mov, base
        # Pull each rating `regress` of the way back to base when a club's
        # season turns over. Without it a rating drifts freely across decades
        # and a club with little history sits wherever its first good run left
        # it — which is how Bournemouth came out rated above Chelsea on a key
        # that spans 1888 to 2026.
        self.regress = regress
        self.name = ("elo_regress" if regress else
                     ("elo_mov" if mov else "elo"))
        self.rating: Dict[str, float] = defaultdict(lambda: base)
        self._season: Dict[str, int] = {}

    def _regressed(self, key: str, season: int) -> float:
        """The rating as it stands for THIS season, applying the turnover pull
        lazily so a read never depends on whether observe() ran first."""
        r = self.rating[key]
        prev = self._season.get(key)
        if self.regress and prev is not None and season != prev:
            r += self.regress * (self.base - r)
        return r

    def _expected(self, m) -> float:
        adv = 0.0 if m.get("neutral") else self.home_adv
        se = m.get("season", 0)
        d = (self._regressed(m["home_key"], se) + adv
             - self._regressed(m["away_key"], se))
        return 1.0 / (1.0 + 10 ** (-d / 400.0))

    def predict(self, m) -> np.ndarray:
        e = self._expected(m)
        # Carve the draw out of the middle: it is likeliest when the sides are
        # level and vanishes as the gap grows.
        p_draw = self.draw_width * (1.0 - 2.0 * abs(e - 0.5))
        p_draw = max(p_draw, 0.05)
        p_home = e * (1 - p_draw)
        p_away = (1 - e) * (1 - p_draw)
        p = np.array([p_home, p_draw, p_away])
        return p / p.sum()

    def observe(self, m) -> None:
        if self.regress:
            for key in (m["home_key"], m["away_key"]):
                prev = self._season.get(key)
                if prev is not None and m["season"] != prev:
                    self.rating[key] += self.regress * (self.base - self.rating[key])
                self._season[key] = m["season"]
        e = self._expected(m)
        s = {"H": 1.0, "D": 0.5, "A": 0.0}[m["result"]]
        k = self.k
        if self.mov:
            gd = abs(m["home_score"] - m["away_score"])
            d = self.rating[m["home_key"]] - self.rating[m["away_key"]]
            # Damped so a 6-0 does not move a rating three times as far as a
            # 2-0, and so a favourite's big win counts for less than an
            # underdog's — the standard FiveThirtyEight correction.
            k *= math.log(gd + 1.0) * (2.2 / (0.001 * abs(d) + 2.2))
        delta = k * (s - e)
        self.rating[m["home_key"]] += delta
        self.rating[m["away_key"]] -= delta


class DixonColes:
    """Goal model with a low-score correlation correction.

    Refit every `refit_days` on a trailing window rather than per match: a
    full fit is seconds, and 219,770 of them is not a backtest anybody runs.
    The window is trailing and strictly historical, so the refit cadence
    costs freshness, never leakage.
    """

    name = "dixon_coles"

    def __init__(self, *, window_days: int = 730, refit_days: int = 30,
                 min_matches: int = 300, xi: float = 0.0018) -> None:
        self.window_days, self.refit_days = window_days, refit_days
        self.min_matches, self.xi = min_matches, xi
        self.history: Dict[str, List[dict]] = defaultdict(list)
        self._fits: Dict[str, object] = {}
        self._fitted_on: Dict[str, object] = {}

    def _fit(self, comp: str, today) -> None:
        import penaltyblog as pb

        rows = [r for r in self.history[comp]
                if (today - r["local_date"]).days <= self.window_days]
        if len(rows) < self.min_matches:
            self._fits[comp] = None
            self._fitted_on[comp] = today
            return
        home = [r["home_key"] for r in rows]
        away = [r["away_key"] for r in rows]
        hg = np.array([r["home_score"] for r in rows], dtype=float)
        ag = np.array([r["away_score"] for r in rows], dtype=float)
        # Exponential time decay: a match two years old counts for ~27% of
        # one played yesterday at xi=.0018, the value Dixon and Coles fit.
        age = np.array([(today - r["local_date"]).days for r in rows], dtype=float)
        weights = np.exp(-self.xi * age)
        try:
            model = pb.models.DixonColesGoalModel(hg, ag, home, away, weights)
            model.fit()
            self._fits[comp] = model
        except Exception as exc:  # noqa: BLE001 — a failed fit must not stop the walk
            logger.debug("DC fit failed for %s on %s: %s", comp, today, exc)
            self._fits[comp] = None
        self._fitted_on[comp] = today

    def predict(self, m) -> Optional[np.ndarray]:
        comp, today = m["competition_id"], m["local_date"]
        last = self._fitted_on.get(comp)
        if last is None or (today - last).days >= self.refit_days:
            self._fit(comp, today)
        model = self._fits.get(comp)
        if model is None:
            return None
        try:
            probs = model.predict(m["home_key"], m["away_key"])
            return np.array([probs.home_win, probs.draw, probs.away_win])
        except Exception:  # noqa: BLE001 — an unseen club has no parameters
            return None

    def observe(self, m) -> None:
        self.history[m["competition_id"]].append(m)


# -------------------------------------------------------------------- metrics
def log_loss(p: np.ndarray, y: np.ndarray) -> float:
    return float(-np.mean(np.log(np.clip(p[np.arange(len(y)), y], 1e-15, 1.0))))


def brier(p: np.ndarray, y: np.ndarray) -> float:
    onehot = np.zeros_like(p)
    onehot[np.arange(len(y)), y] = 1.0
    return float(np.mean(np.sum((p - onehot) ** 2, axis=1)))


def accuracy(p: np.ndarray, y: np.ndarray) -> float:
    return float(np.mean(np.argmax(p, axis=1) == y))


def reliability(p: np.ndarray, y: np.ndarray, bins: int = 10) -> Tuple[List[dict], float]:
    """Flattened over all three outcomes: every (match, outcome) is one
    forecast of a binary event, which is what calibration actually means."""
    flat_p = p.ravel()
    onehot = np.zeros_like(p)
    onehot[np.arange(len(y)), y] = 1.0
    flat_y = onehot.ravel()
    edges = np.linspace(0, 1, bins + 1)
    rows, ece, n = [], 0.0, len(flat_p)
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (flat_p >= lo) & (flat_p < hi if i < bins - 1 else flat_p <= hi)
        k = int(mask.sum())
        if not k:
            continue
        stated, observed = float(flat_p[mask].mean()), float(flat_y[mask].mean())
        rows.append({"bin_low": round(lo, 2), "bin_high": round(hi, 2), "n": k,
                     "stated": round(stated, 4), "observed": round(observed, 4)})
        ece += (k / n) * abs(stated - observed)
    return rows, float(ece)


def paired_bootstrap(pa: np.ndarray, pb_: np.ndarray, y: np.ndarray, *,
                     n: int = 2000, seed: int = 17) -> dict:
    """Is A better than B, or did the sample happen to fall that way?

    Resamples MATCHES, not predictions, so both models are always scored on
    exactly the same fixtures. Anything whose interval straddles zero is not a
    result no matter how the point estimate reads.
    """
    rng = np.random.default_rng(seed)
    onehot = np.zeros_like(pa)
    onehot[np.arange(len(y)), y] = 1.0
    ba = np.sum((pa - onehot) ** 2, axis=1)
    bb = np.sum((pb_ - onehot) ** 2, axis=1)
    diff = ba - bb
    idx = rng.integers(0, len(diff), size=(n, len(diff)))
    draws = diff[idx].mean(axis=1)
    return {"delta_brier": float(diff.mean()),
            "ci_low": float(np.percentile(draws, 2.5)),
            "ci_high": float(np.percentile(draws, 97.5)),
            "p_a_better": float((draws < 0).mean())}


# ----------------------------------------------------------------------- walk
def load_matches(competitions: Optional[Sequence[str]], min_season: int,
                 max_season: Optional[int]) -> List[dict]:
    import duckdb

    con = duckdb.connect(str(CANONICAL), read_only=True)
    where = ["result IS NOT NULL", f"season >= {int(min_season)}"]
    if max_season:
        where.append(f"season <= {int(max_season)}")
    if competitions:
        lst = ",".join(f"'{c}'" for c in competitions)
        where.append(f"competition_id IN ({lst})")
    rows = con.execute(f"""
        SELECT match_uid, competition_id, season, local_date, home_key, away_key,
               home_score, away_score, result, phase
          FROM matches
         WHERE {' AND '.join(where)}
         ORDER BY local_date, match_uid
    """).fetchall()
    cols = ["match_uid", "competition_id", "season", "local_date", "home_key",
            "away_key", "home_score", "away_score", "result", "phase"]
    con.close()
    return [dict(zip(cols, r)) for r in rows]


def walk(matches: Sequence[dict], models: Sequence[object]) -> Dict[str, dict]:
    """One chronological pass. Every model sees the same rows in the same order.

    The day-block structure is the leakage guard: everything on a date is
    predicted before anything on that date is observed.
    """
    preds: Dict[str, List[Optional[np.ndarray]]] = {m.name: [] for m in models}
    order: List[dict] = []

    i, n = 0, len(matches)
    while i < n:
        j = i
        day = matches[i]["local_date"]
        while j < n and matches[j]["local_date"] == day:
            j += 1
        block = matches[i:j]
        for m in block:                       # predict the whole day first
            for model in models:
                preds[model.name].append(model.predict(m))
            order.append(m)
        for m in block:                       # only then reveal it
            for model in models:
                model.observe(m)
        i = j
        if len(order) % 50000 < len(block):
            logger.info("  ... %d/%d matches", len(order), n)

    y = np.array([IDX[m["result"]] for m in order])
    out: Dict[str, dict] = {}
    for model in models:
        raw = preds[model.name]
        covered = np.array([p is not None for p in raw])
        P = np.vstack([p if p is not None else np.full(3, np.nan) for p in raw])
        out[model.name] = {"P": P, "covered": covered}
    out["_y"] = y
    out["_matches"] = order
    return out


def score(name: str, P: np.ndarray, covered: np.ndarray, y: np.ndarray) -> dict:
    p, yy = P[covered], y[covered]
    rows, ece = reliability(p, yy)
    return {"model": name, "n": int(covered.sum()),
            "coverage": round(float(covered.mean()), 4),
            "log_loss": round(log_loss(p, yy), 5),
            "brier": round(brier(p, yy), 5),
            "accuracy": round(accuracy(p, yy), 5),
            "ece": round(ece, 5), "reliability": rows}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", help="comma-separated; default every one")
    ap.add_argument("--min-season", type=int, default=1990)
    ap.add_argument("--max-season", type=int,
                    help="hold out everything after this — use it to keep the "
                         "final period untouched")
    ap.add_argument("--no-dc", action="store_true",
                    help="skip Dixon-Coles (it is the slow one)")
    ap.add_argument("--output", default=str(OUT_DIR / "walkforward.json"))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    comps = ([c.strip() for c in args.competitions.split(",")]
             if args.competitions else None)
    matches = load_matches(comps, args.min_season, args.max_season)
    logger.info("matches: %d  (%s .. %s)  competitions: %d", len(matches),
                matches[0]["local_date"], matches[-1]["local_date"],
                len({m["competition_id"] for m in matches}))

    models: List[object] = [Uniform(), BaseRate(), Elo(), Elo(mov=True)]
    if not args.no_dc:
        models.append(DixonColes())

    logger.info("walking forward...")
    res = walk(matches, models)
    y = res["_y"]

    table = [score(m.name, res[m.name]["P"], res[m.name]["covered"], y)
             for m in models]

    logger.info("\n%-14s %8s %10s %9s %9s %8s %9s", "model", "n", "log loss",
                "brier", "accuracy", "ece", "coverage")
    for r in table:
        logger.info("%-14s %8d %10.5f %9.5f %9.2f%% %8.4f %8.1f%%",
                    r["model"], r["n"], r["log_loss"], r["brier"],
                    100 * r["accuracy"], r["ece"], 100 * r["coverage"])

    # Paired comparisons against the strongest cheap baseline, on the rows
    # both arms actually cover.
    ref = "elo"
    comparisons = []
    for m in models:
        if m.name == ref:
            continue
        both = res[ref]["covered"] & res[m.name]["covered"]
        if both.sum() < 500:
            continue
        cmp = paired_bootstrap(res[m.name]["P"][both], res[ref]["P"][both], y[both])
        cmp.update({"model": m.name, "vs": ref, "n": int(both.sum())})
        comparisons.append(cmp)

    logger.info("\npaired bootstrap vs %s (negative = better than %s)", ref, ref)
    for c in comparisons:
        verdict = ("better" if c["ci_high"] < 0 else
                   "worse" if c["ci_low"] > 0 else "not distinguishable")
        logger.info("  %-14s dBrier %+.5f  95%% [%+.5f, %+.5f]  n=%d  -> %s",
                    c["model"], c["delta_brier"], c["ci_low"], c["ci_high"],
                    c["n"], verdict)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "protocol": "match-by-match walk-forward; same-day fixtures predicted "
                    "as a block before any of that day is observed",
        "matches": len(matches),
        "span": [str(matches[0]["local_date"]), str(matches[-1]["local_date"])],
        "competitions": sorted({m["competition_id"] for m in matches}),
        "min_season": args.min_season, "max_season": args.max_season,
        "results": table, "comparisons": comparisons,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
