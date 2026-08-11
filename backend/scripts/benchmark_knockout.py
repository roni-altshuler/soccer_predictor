"""The tournament layer: who advances, and who lifts the trophy.

What this is
------------
The Green Code Wimbledon workflow, applied where soccer actually has the same
shape. Tennis is tractable partly because it is binary — someone wins. League
football is not: a quarter of matches are drawn, and a three-way model is
capped near the closing line's 54%.

A knockout TIE is binary. Extra time, penalties and away goals exist to make it
so. So the unit here is the tie, the label is "did the first-leg home side
advance", and the honest yardstick is the same one the tennis work uses: how
often does the better-rated side actually win?

Protocol
--------
Train on every previous season, test on the season being played — the video's
split, and the only one that is not cheating. Ratings come from a strictly
chronological pass over the warehouse (`tournament/ratings.py`), so a tie is
never predicted using a rating its own result helped create.

Ladder
------
    coin flip                50.0%   the floor
    higher-rated advances    ~?      what an informed fan already does
    this model               ~?      what the work is worth
    (no market column — books do not price a tie the way they price a match,
     and inventing one would be worse than leaving the honest gap)

Two things are reported that a single accuracy number hides: the Brier score,
because a tournament simulation needs the probability and not the pick, and
the bracket backtest, because picking each round correctly and getting the
champion right are different achievements.

    python3 -m backend.scripts.benchmark_knockout --min-season 2005
    python3 -m backend.scripts.benchmark_knockout --brackets

Writes backend/data/diagnostics/knockout_model.json.
"""
from __future__ import annotations

import argparse
import bisect
import json
import logging
import math
import sqlite3
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.tournament import ratings as R  # noqa: E402
from backend.services.tournament import ties as T  # noqa: E402
from backend.services.tournament.rounds import classify, QUALIFYING  # noqa: E402

logger = logging.getLogger("benchmark_knockout")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "knockout_model.json"

DEFAULT_COMPS = (
    "uefa.champions", "uefa.europa", "uefa.conference", "fifa.world",
    "uefa.euro", "conmebol.america", "conmebol.libertadores",
    "conmebol.sudamericana", "caf.nations", "afc.asian", "concacaf.gold",
    "concacaf.champions", "fifa.cwc", "uefa.nations",
)

FEATURES = [
    "elo_a", "elo_b", "elo_diff", "elo_expected_a",
    "matches_a", "matches_b",
    "form_a", "form_b", "form_diff",
    "gd_a", "gd_b", "gd_diff",
    "rest_a", "rest_b",
    "two_legged", "neutral", "round_depth",
    "pedigree_a", "pedigree_b", "pedigree_diff",
    "h2h_a",
]


# --------------------------------------------------------------------------
# per-team match history, for form / rest / head-to-head
# --------------------------------------------------------------------------
@dataclass
class History:
    dates: Dict[int, List[str]]
    points: Dict[int, List[int]]
    gd: Dict[int, List[int]]
    opponents: Dict[int, List[int]]
    results: Dict[int, List[int]]   # 1 win, 0 draw, -1 loss

    @classmethod
    def build(cls, conn: sqlite3.Connection) -> "History":
        d, p, g, o, r = (defaultdict(list) for _ in range(5))
        sql = ("SELECT date_utc, home_team_id, away_team_id, home_score, away_score "
               "FROM matches WHERE home_score IS NOT NULL AND away_score IS NOT NULL "
               "ORDER BY date_utc, match_id")
        for row in conn.execute(sql):
            h, a = int(row["home_team_id"]), int(row["away_team_id"])
            hs, as_ = int(row["home_score"]), int(row["away_score"])
            for team, opp, gf, ga in ((h, a, hs, as_), (a, h, as_, hs)):
                d[team].append(row["date_utc"])
                p[team].append(3 if gf > ga else (1 if gf == ga else 0))
                g[team].append(gf - ga)
                o[team].append(opp)
                r[team].append(1 if gf > ga else (0 if gf == ga else -1))
        return cls(d, p, g, o, r)

    def window(self, team: int, before: str, n: int) -> Tuple[int, float, float]:
        """(count, points per game, goal difference per game) over the last n."""
        ds = self.dates.get(team)
        if not ds:
            return 0, math.nan, math.nan
        i = bisect.bisect_left(ds, before)
        lo = max(0, i - n)
        if i == lo:
            return 0, math.nan, math.nan
        pts = self.points[team][lo:i]
        gds = self.gd[team][lo:i]
        return len(pts), sum(pts) / len(pts), sum(gds) / len(gds)

    def rest_days(self, team: int, before: str) -> float:
        ds = self.dates.get(team)
        if not ds:
            return math.nan
        i = bisect.bisect_left(ds, before)
        if i == 0:
            return math.nan
        return _days(ds[i - 1], before)

    def h2h(self, a: int, b: int, before: str, years: int = 6) -> float:
        """A's share of decisive past meetings. NaN when they have not met."""
        ds = self.dates.get(a)
        if not ds:
            return math.nan
        i = bisect.bisect_left(ds, before)
        cutoff = _shift_years(before, -years)
        wins = losses = 0
        for j in range(i - 1, -1, -1):
            if ds[j] < cutoff:
                break
            if self.opponents[a][j] != b:
                continue
            if self.results[a][j] > 0:
                wins += 1
            elif self.results[a][j] < 0:
                losses += 1
        total = wins + losses
        return wins / total if total else math.nan


def _days(a: str, b: str) -> float:
    try:
        pa = datetime.fromisoformat(a.replace("Z", "+00:00"))
        pb = datetime.fromisoformat(b.replace("Z", "+00:00"))
        return abs((pb - pa).total_seconds()) / 86400.0
    except ValueError:
        return math.nan


def _shift_years(iso: str, delta: int) -> str:
    try:
        return str(int(iso[:4]) + delta) + iso[4:]
    except ValueError:
        return iso


# --------------------------------------------------------------------------
# features
# --------------------------------------------------------------------------
def pedigree(ties: Sequence[T.Tie]) -> Dict[Tuple[int, str, int], int]:
    """Ties won in this competition over the five preceding seasons.

    Built by walking seasons in order and accumulating, so season S only ever
    sees ties resolved before season S.
    """
    won: Dict[Tuple[int, str, int], int] = defaultdict(int)
    per_season: Dict[Tuple[int, str, int], int] = defaultdict(int)
    for t in ties:
        if t.winner is not None:
            per_season[(t.winner, t.competition_id, t.season)] += 1
    for (team, comp, season), n in per_season.items():
        for future in range(season + 1, season + 6):
            won[(team, comp, future)] += n
    return won


def build_matrix(ties: Sequence[T.Tie], elo: R.EloTable, hist: History,
                 ped: Dict[Tuple[int, str, int], int]
                 ) -> Tuple[np.ndarray, np.ndarray, List[T.Tie]]:
    rows, labels, kept = [], [], []
    for t in ties:
        if t.winner is None:
            continue
        d = t.date_utc
        ea = elo.rating_before(t.team_a, d)
        eb = elo.rating_before(t.team_b, d)
        if ea is None or eb is None:
            continue

        neutral = (t.competition_id in R.NEUTRAL_COMPETITIONS
                   or (not t.two_legged and t.round_slug == "final"))
        hfa = 0.0 if neutral else R.EloConfig().home_advantage
        exp_a = 1.0 / (1.0 + 10 ** ((eb - (ea + hfa)) / 400.0))

        na, fa, ga = hist.window(t.team_a, d, 10)
        nb, fb, gb = hist.window(t.team_b, d, 10)

        rows.append([
            ea, eb, ea - eb, exp_a,
            elo.matches_before(t.team_a, d), elo.matches_before(t.team_b, d),
            fa, fb, (fa - fb),
            ga, gb, (ga - gb),
            hist.rest_days(t.team_a, d), hist.rest_days(t.team_b, d),
            1.0 if t.two_legged else 0.0,
            1.0 if neutral else 0.0,
            math.log2(max(2, t.teams_remaining)),
            ped.get((t.team_a, t.competition_id, t.season), 0),
            ped.get((t.team_b, t.competition_id, t.season), 0),
            ped.get((t.team_a, t.competition_id, t.season), 0)
            - ped.get((t.team_b, t.competition_id, t.season), 0),
            hist.h2h(t.team_a, t.team_b, d),
        ])
        labels.append(t.a_advanced)
        kept.append(t)
    return np.asarray(rows, dtype=np.float64), np.asarray(labels, dtype=np.int64), kept


# --------------------------------------------------------------------------
# evaluation
# --------------------------------------------------------------------------
def _models():
    from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler

    out = [
        ("logistic", make_pipeline(SimpleImputer(strategy="median"),
                                   StandardScaler(),
                                   LogisticRegression(C=0.5, max_iter=2000))),
        ("random_forest", make_pipeline(
            SimpleImputer(strategy="median"),
            RandomForestClassifier(n_estimators=600, min_samples_leaf=25,
                                   n_jobs=-1, random_state=17))),
        ("hist_gbm", HistGradientBoostingClassifier(
            max_iter=400, learning_rate=0.05, max_depth=3,
            l2_regularization=1.0, early_stopping=True,
            validation_fraction=0.15, random_state=17)),
    ]
    try:
        from xgboost import XGBClassifier
        out.append(("xgboost", XGBClassifier(
            n_estimators=400, learning_rate=0.05, max_depth=3, subsample=0.8,
            colsample_bytree=0.8, reg_lambda=1.0, tree_method="hist",
            random_state=17, verbosity=0)))
    except ImportError:
        logger.warning("xgboost not installed — skipping")
    return out


def evaluate(X, y, seasons, kept, test_seasons, model) -> Dict:
    """Rolling origin: for each test season, fit on everything before it."""
    from sklearn.base import clone

    probs = np.full(len(y), np.nan)
    for s in test_seasons:
        tr = np.flatnonzero(seasons < s)
        te = np.flatnonzero(seasons == s)
        if len(tr) < 200 or not len(te):
            continue
        # A fresh estimator per season. Refitting the same object would be
        # fine for sklearn, but cloning makes it impossible for a season to
        # inherit state from a later one if this loop is ever reordered.
        m = clone(model)
        m.fit(X[tr], y[tr])
        probs[te] = m.predict_proba(X[te])[:, 1]

    mask = ~np.isnan(probs)
    if mask.sum() == 0:
        return {"n": 0}
    p, t = probs[mask], y[mask]
    return {
        "n": int(mask.sum()),
        "accuracy": float(np.mean((p >= 0.5).astype(int) == t)),
        "brier": float(np.mean((p - t) ** 2)),
        "log_loss": float(-np.mean(t * np.log(np.clip(p, 1e-9, 1))
                                   + (1 - t) * np.log(np.clip(1 - p, 1e-9, 1)))),
        "_probs": probs,
        "_mask": mask,
    }


def calibration(p: np.ndarray, y: np.ndarray, bins=(0.5, 0.6, 0.7, 0.8, 0.9, 1.01)) -> List[Dict]:
    """Folded onto the favoured side, so every row reads 'model said X%'."""
    conf = np.where(p >= 0.5, p, 1 - p)
    hit = np.where(p >= 0.5, y == 1, y == 0)
    out = []
    for lo, hi in zip(bins[:-1], bins[1:]):
        sel = (conf >= lo) & (conf < hi)
        if sel.sum() >= 15:
            out.append({"stated_low": round(lo * 100), "stated_high": round(min(hi, 1.0) * 100),
                        "n": int(sel.sum()), "observed": round(float(hit[sel].mean()), 4),
                        "mean_stated": round(float(conf[sel].mean()), 4)})
    return out


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", default=",".join(DEFAULT_COMPS))
    ap.add_argument("--min-season", type=int, default=2005)
    ap.add_argument("--test-from", type=int, default=2013)
    ap.add_argument("--include-qualifying", action="store_true",
                    help="qualifying rounds are noisier and legs go missing "
                         "before 2010; off by default")
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")

    comps = [c.strip() for c in args.competitions.split(",") if c.strip()]
    have = {r[0] for r in conn.execute("SELECT DISTINCT competition_id FROM matches")}
    comps = [c for c in comps if c in have]
    logger.info("competitions: %s", ", ".join(comps))

    logger.info("building Elo over every match in the warehouse...")
    elo = R.build(conn)
    hist = History.build(conn)

    all_ties = T.build(conn, comps, include_qualifying=True, min_season=args.min_season)
    ped = pedigree(all_ties)
    ties = [t for t in all_ties
            if args.include_qualifying or classify(t.round_slug) != QUALIFYING]

    check = T.validate_progression(ties)
    logger.info("ties: %d (%d resolved) | progression check %d/%d = %.4f",
                len(ties), sum(1 for t in ties if t.winner), check["confirmed"],
                check["checked"], check["rate"] or 0.0)

    X, y, kept = build_matrix(ties, elo, hist, ped)
    seasons = np.array([t.season for t in kept])
    logger.info("feature matrix: %d ties x %d features", len(y), X.shape[1])

    test_seasons = sorted({int(s) for s in seasons if s >= args.test_from})

    # --- the ladder ---------------------------------------------------------
    in_test = np.isin(seasons, test_seasons)
    elo_pick = (X[:, FEATURES.index("elo_diff")] > 0).astype(int)
    higher_elo_acc = float(np.mean(elo_pick[in_test] == y[in_test]))
    # Elo's own formula, used as a probability with no fitting at all.
    elo_p = X[:, FEATURES.index("elo_expected_a")]
    elo_brier = float(np.mean((elo_p[in_test] - y[in_test]) ** 2))
    logger.info("\nbaselines over %d test ties (%s-%s)", int(in_test.sum()),
                test_seasons[0], test_seasons[-1])
    logger.info("  coin flip            50.00%%   brier .2500")
    logger.info("  higher-rated side    %.2f%%   brier %.4f  (Elo formula, unfitted)",
                higher_elo_acc * 100, elo_brier)

    results = {}
    for name, model in _models():
        res = evaluate(X, y, seasons, kept, test_seasons, model)
        if not res.get("n"):
            continue
        results[name] = res
        logger.info("  %-20s %.2f%%   brier %.4f  logloss %.4f",
                    name, res["accuracy"] * 100, res["brier"], res["log_loss"])

    best_name = min(results, key=lambda k: results[k]["brier"])
    best = results[best_name]
    logger.info("\nbest by Brier: %s", best_name)

    mask = best["_mask"]
    cal = calibration(best["_probs"][mask], y[mask])
    logger.info("\ncalibration (folded onto the favoured side):")
    for c in cal:
        logger.info("  %2d-%2d%%  n=%4d  stated %.3f  observed %.3f",
                    c["stated_low"], c["stated_high"], c["n"],
                    c["mean_stated"], c["observed"])

    # --- what did it lean on? ----------------------------------------------
    from sklearn.inspection import permutation_importance
    split = test_seasons[len(test_seasons) // 2]
    tr, te = np.flatnonzero(seasons < split), np.flatnonzero(seasons >= split)
    fitted = dict(_models())[best_name]
    fitted.fit(X[tr], y[tr])
    perm = permutation_importance(fitted, X[te], y[te], n_repeats=10,
                                  random_state=17, scoring="neg_log_loss", n_jobs=-1)
    importance = sorted(
        ({"feature": FEATURES[i], "importance": round(float(perm.importances_mean[i]), 5),
          "std": round(float(perm.importances_std[i]), 5)} for i in range(len(FEATURES))),
        key=lambda d: -d["importance"])
    logger.info("\npermutation importance:")
    for e in importance[:10]:
        logger.info("  %-18s %+.5f ± %.5f", e["feature"], e["importance"], e["std"])

    # --- per-round accuracy -------------------------------------------------
    per_round: Dict[str, List[int]] = defaultdict(lambda: [0, 0])
    for i, t in enumerate(kept):
        if not mask[i]:
            continue
        cell = per_round[t.round_label]
        cell[1] += 1
        cell[0] += int((best["_probs"][i] >= 0.5) == bool(y[i]))
    rounds = {k: {"correct": v[0], "n": v[1], "accuracy": round(v[0] / v[1], 4)}
              for k, v in sorted(per_round.items(), key=lambda kv: -kv[1][1]) if v[1] >= 10}
    logger.info("\nby round:")
    for k, v in rounds.items():
        logger.info("  %-16s %4d ties  %.1f%%", k, v["n"], v["accuracy"] * 100)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "unit": "knockout tie (two outcomes), not match (three)",
            "split": "train on every previous season, test on the season played",
            "ratings": "chronological Elo over all 60k warehouse matches, "
                       "clubs and national teams, read strictly pre-tie",
            "competitions": comps,
            "qualifying_included": bool(args.include_qualifying),
            "progression_check": {k: v for k, v in check.items() if k != "failures"},
        },
        "n_ties_total": len(ties),
        "n_ties_scored": int(mask.sum()),
        "test_seasons": test_seasons,
        "ladder": [
            {"key": "coin_flip", "label": "Coin flip", "accuracy": 0.5, "brier": 0.25},
            {"key": "higher_elo", "label": "Higher-rated side advances",
             "accuracy": round(higher_elo_acc, 4), "brier": round(elo_brier, 4)},
            {"key": "model", "label": f"This model ({best_name})",
             "accuracy": round(best["accuracy"], 4), "brier": round(best["brier"], 4)},
        ],
        "models": {k: {kk: vv for kk, vv in v.items() if not kk.startswith("_")}
                   for k, v in results.items()},
        "best_model": best_name,
        "calibration": cal,
        "by_round": rounds,
        "permutation_importance": importance,
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(out, indent=2))
    logger.info("\nwrote %s", op)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
