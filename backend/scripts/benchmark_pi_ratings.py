"""Pi-ratings + gradient boosting against Dixon-Coles, on identical fixtures.

Why this challenger and not another goal model
----------------------------------------------
The goal-model bake-off settled its own question: Poisson, Dixon-Coles,
bivariate Poisson, negative binomial, zero-inflated, Bayesian and hierarchical
Bayesian all land within .003 Brier of each other, and every blend is worse
than Dixon-Coles alone. The *family* is not the bottleneck.

The published benchmark points somewhere else. Sadhukhan et al.'s survey of
machine learning for soccer result prediction (arXiv:2403.07669) concludes that
"gradient-boosted tree models such as CatBoost, applied to soccer-specific
ratings such as pi-ratings, are currently the best-performing models on
datasets containing only goals as the match features" — which is exactly the
data this project has. Pi-ratings (Constantinou & Fenton 2013) differ from Elo
in two ways that matter here: they learn from the *margin* rather than the
result, and they carry separate home and away ability with a cross-update, so
a side that travels badly is represented as such rather than averaged away.

Method
------
* Ratings are built strictly forward. A match updates the ratings only AFTER
  its features have been recorded, so no fixture ever sees its own result.
* Rolling origin by season: for each test season, the booster trains on every
  completed match before it. Dixon-Coles refits monthly on the same history.
* Scored on the intersection where the booster, Dixon-Coles and a priced
  closing line can all speak, so every comparison is exactly paired.
* Brier is multiclass **summed**, matching the rest of the project: uniform
  1/3 scores .6667, lower is better.

    python3 -m backend.scripts.benchmark_pi_ratings --min-season 2015

Writes backend/data/diagnostics/pi_ratings_benchmark.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import penaltyblog as pb
from sklearn.ensemble import HistGradientBoostingClassifier

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("benchmark_pi_ratings")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "pi_ratings_benchmark.json"
WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")
DC_XI = 0.0018

# Constantinou & Fenton report lambda=0.06, gamma=0.6 as optimal over five
# Premier League seasons. The two do NOT map onto penaltyblog's parameters
# one-for-one: there, `alpha` and `beta` are both absolute learning rates
# applied to the same adjusted error, whereas the paper's gamma is the
# *fraction* of the lambda update carried across to the other ground. So the
# cross rate is lambda*gamma, not gamma.
#
# Passing beta=0.6 makes the cross-update ten times the direct one and the two
# ratings diverge without bound in opposite directions — measured here before
# the fix, Arsenal ended on home=-285.5 / away=+288.1 and the expected goal
# difference averaged -197 goals.
PI_LAMBDA = 0.06
PI_GAMMA = 0.6
PI_ALPHA = PI_LAMBDA
PI_BETA = PI_LAMBDA * PI_GAMMA


def brier(p: Sequence[float], idx: int) -> float:
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def log_loss(p: Sequence[float], idx: int) -> float:
    return -math.log(max(1e-15, p[idx]))


def devig(oh: float, od: float, oa: float) -> List[float]:
    inv = [1.0 / oh, 1.0 / od, 1.0 / oa]
    s = sum(inv)
    return [x / s for x in inv]


def normalise(p: Sequence[float]) -> Optional[List[float]]:
    if any(v is None or not math.isfinite(v) for v in p):
        return None
    s = sum(p)
    if s <= 0:
        return None
    return [v / s for v in p]


def load_matches(conn: sqlite3.Connection, comps: Sequence[str]) -> List[sqlite3.Row]:
    ph = ", ".join("?" * len(comps))
    return conn.execute(
        f"""SELECT m.match_id, m.date_utc, m.season, m.competition_id,
                   th.canonical_name AS home, ta.canonical_name AS away,
                   m.home_score AS hs, m.away_score AS a_s,
                   m.odds_home AS oh, m.odds_draw AS od, m.odds_away AS oa
            FROM matches m
            JOIN teams th ON th.team_id = m.home_team_id
            JOIN teams ta ON ta.team_id = m.away_team_id
            WHERE m.competition_id IN ({ph})
              AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
            ORDER BY m.date_utc, m.match_id""",
        tuple(comps),
    ).fetchall()


def build_pi_features(rows: Sequence[sqlite3.Row]) -> Tuple[np.ndarray, np.ndarray, List[int]]:
    """Walk the whole history once, recording PRE-match ratings for every fixture.

    A rating system is only honest if the update happens after the observation
    is recorded. That ordering is the entire point of this function, so it is
    done in one pass rather than reconstructed per fold.
    """
    # One rating system per competition: a Bundesliga 2-0 and a Serie A 2-0 are
    # not the same evidence, and pooling them lets league scoring rates leak
    # into a team's ability estimate.
    systems: Dict[str, pb.ratings.PiRatingSystem] = {}
    feats: List[List[float]] = []
    labels: List[int] = []

    for r in rows:
        comp = r["competition_id"]
        sys_ = systems.get(comp)
        if sys_ is None:
            sys_ = systems[comp] = pb.ratings.PiRatingSystem(alpha=PI_ALPHA, beta=PI_BETA)
        for team in (r["home"], r["away"]):
            try:
                sys_.initialize_team(team)
            except Exception:  # noqa: BLE001 — already present
                pass

        h_home, h_away = _rating_pair(sys_, r["home"])
        a_home, a_away = _rating_pair(sys_, r["away"])
        try:
            egd = float(sys_.expected_goal_difference(r["home"], r["away"]))
        except Exception:  # noqa: BLE001
            egd = h_home - a_away

        feats.append([
            h_home, h_away, a_home, a_away,
            h_home - a_away,          # the matchup that actually happens
            (h_home + h_away) / 2.0,  # overall ability, home and away pooled
            (a_home + a_away) / 2.0,
            egd,
        ])
        hs, a_s = int(r["hs"]), int(r["a_s"])
        labels.append(0 if hs > a_s else (1 if hs == a_s else 2))

        sys_.update_ratings(r["home"], r["away"], hs - a_s)

    return np.asarray(feats, dtype=np.float64), np.asarray(labels, dtype=np.int64), labels


def _rating_pair(system, team: str) -> Tuple[float, float]:
    """(home rating, away rating) for `team`.

    Read the pair off `team_ratings` directly. `get_team_rating()` returns the
    MEAN of the two, so using it collapses the separate home/away ability that
    is the whole reason to prefer pi-ratings over Elo — and silently, since
    duplicating one number still produces a valid-looking feature matrix.
    """
    r = system.team_ratings.get(team)
    if not r:
        return 0.0, 0.0
    return float(r.get("home", 0.0)), float(r.get("away", 0.0))


def fit_dixon_coles(conn: sqlite3.Connection, comp: str, before: str):
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
    d = np.array([np.datetime64(x[0][:10]) for x in rows])
    age = (d.max() - d).astype("timedelta64[D]").astype(float)
    try:
        m = pb.models.DixonColesGoalModel(
            goals_home=[x[3] for x in rows], goals_away=[x[4] for x in rows],
            teams_home=[x[1] for x in rows], teams_away=[x[2] for x in rows],
            weights=np.exp(-DC_XI * age),
        )
        m.fit()
        return m
    except Exception as exc:  # noqa: BLE001
        logger.warning("Dixon-Coles fit failed %s %s: %s", comp, before, exc)
        return None


def paired_bootstrap(a: Sequence[float], b: Sequence[float], *, iters: int = 10000,
                     seed: int = 12345) -> Dict[str, float]:
    """95% CI on mean(a) - mean(b), resampling fixtures rather than forecasters."""
    assert len(a) == len(b)
    rng = np.random.default_rng(seed)
    a_, b_ = np.asarray(a), np.asarray(b)
    n = len(a_)
    if n == 0:
        return {"diff": float("nan"), "ci_low": float("nan"), "ci_high": float("nan"),
                "p_a_better": float("nan"), "n": 0}
    idx = rng.integers(0, n, size=(iters, n))
    diffs = a_[idx].mean(axis=1) - b_[idx].mean(axis=1)
    return {
        "diff": round(float(a_.mean() - b_.mean()), 5),
        "ci_low": round(float(np.percentile(diffs, 2.5)), 5),
        "ci_high": round(float(np.percentile(diffs, 97.5)), 5),
        "p_a_better": round(float((diffs < 0).mean()), 4),
        "n": n,
    }


class Tally:
    def __init__(self) -> None:
        self.b: List[float] = []
        self.ll = 0.0
        self.hit = 0

    def add(self, p: Sequence[float], idx: int) -> None:
        self.b.append(brier(p, idx))
        self.ll += log_loss(p, idx)
        self.hit += int(max(range(3), key=lambda i: p[i]) == idx)

    def as_dict(self) -> Optional[Dict[str, float]]:
        if not self.b:
            return None
        n = len(self.b)
        return {"n": n, "brier": round(float(np.mean(self.b)), 4),
                "log_loss": round(self.ll / n, 4), "accuracy": round(self.hit / n, 4)}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--min-season", type=int, default=2015,
                    help="first TEST season; earlier seasons are training history only")
    ap.add_argument("--bootstrap", type=int, default=10000)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not DB.exists():
        logger.error("warehouse missing")
        return 2
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]

    rows = load_matches(conn, comps)
    logger.info("loaded %d completed matches across %d competitions", len(rows), len(comps))
    X, y, _ = build_pi_features(rows)
    seasons = np.array([int(r["season"] or 0) for r in rows])
    comp_of = [r["competition_id"] for r in rows]

    test_seasons = sorted({int(s) for s in seasons if s >= args.min_season})
    logger.info("test seasons: %s", test_seasons)

    pooled: Dict[str, Tally] = defaultdict(Tally)
    per_league: Dict[str, Dict[str, Tally]] = defaultdict(lambda: defaultdict(Tally))
    dc_cache: Dict[Tuple[str, str], object] = {}
    n_scored = n_skipped = 0

    for ts in test_seasons:
        train_mask = seasons < ts
        test_idx = np.flatnonzero(seasons == ts)
        if train_mask.sum() < 2000 or not len(test_idx):
            continue

        clf = HistGradientBoostingClassifier(
            max_iter=300, learning_rate=0.06, max_depth=4,
            l2_regularization=1.0, early_stopping=True,
            validation_fraction=0.15, random_state=17,
        )
        clf.fit(X[train_mask], y[train_mask])
        proba = clf.predict_proba(X[test_idx])

        for j, i in enumerate(test_idx):
            r = rows[i]
            comp = comp_of[i]
            oh, od, oa = r["oh"], r["od"], r["oa"]
            if None in (oh, od, oa) or min(oh, od, oa) <= 1.0:
                n_skipped += 1
                continue
            month = f"{r['date_utc'][:7]}-01"
            key = (comp, month)
            if key not in dc_cache:
                dc_cache[key] = fit_dixon_coles(conn, comp, month)
            dc = dc_cache[key]
            dc_p = None
            if dc is not None:
                try:
                    pr = dc.predict(r["home"], r["away"])
                    dc_p = normalise([pr.home_win, pr.draw, pr.away_win])
                except Exception:  # noqa: BLE001
                    dc_p = None
            if dc_p is None:
                n_skipped += 1
                continue

            pi_p = normalise(list(proba[j]))
            if pi_p is None:
                n_skipped += 1
                continue
            idx = int(y[i])
            mkt = devig(oh, od, oa)

            n_scored += 1
            for name, p in (("pi_gbm", pi_p), ("dixon_coles", dc_p), ("market", mkt)):
                pooled[name].add(p, idx)
                per_league[comp][name].add(p, idx)

        logger.info("  season %s: %d scored so far", ts, n_scored)

    if not n_scored:
        logger.error("nothing scored")
        return 1

    overall = {k: v.as_dict() for k, v in pooled.items()}
    mkt_b = overall["market"]["brier"]
    print(f"\n{'model':<16}{'n':>7}{'Brier':>9}{'log loss':>10}{'acc':>8}{'vs mkt':>9}")
    print("-" * 59)
    for name, m in sorted(overall.items(), key=lambda kv: kv[1]["brier"]):
        print(f"{name:<16}{m['n']:>7}{m['brier']:>9.4f}{m['log_loss']:>10.4f}"
              f"{m['accuracy']:>8.4f}{m['brier'] - mkt_b:>+9.4f}")

    boot = paired_bootstrap(pooled["pi_gbm"].b, pooled["dixon_coles"].b, iters=args.bootstrap)
    verdict = ("pi_gbm" if boot["diff"] < 0 else "dixon_coles")
    sig = "SIGNIFICANT" if (boot["ci_low"] > 0 or boot["ci_high"] < 0) else "not significant"
    print(f"\npi_gbm - dixon_coles = {boot['diff']:+.4f} Brier  ->  {verdict} wins")
    print(f"pooled 95% CI [{boot['ci_low']:+.5f}, {boot['ci_high']:+.5f}]  "
          f"p(pi better)={boot['p_a_better']:.3f}  {sig}")

    by_league = {}
    wins, sig_wins = [], []
    for comp in sorted(per_league):
        t = per_league[comp]
        if not t["pi_gbm"].b:
            continue
        lb = paired_bootstrap(t["pi_gbm"].b, t["dixon_coles"].b, iters=args.bootstrap)
        tag = "significant" if (lb["ci_low"] > 0 or lb["ci_high"] < 0) else "noise"
        print(f"  {comp:<8}diff {lb['diff']:+.5f}  CI [{lb['ci_low']:+.5f}, {lb['ci_high']:+.5f}]  {tag}")
        by_league[comp] = {"metrics": {k: v.as_dict() for k, v in t.items()}, "paired": lb}
        if lb["diff"] < 0:
            wins.append(comp)
            if lb["ci_high"] < 0:
                sig_wins.append(comp)
    print(f"\nbeats DC (point estimate) in {len(wins)} of {len(by_league)}; "
          f"survives bootstrap in {len(sig_wins)}: {sig_wins or 'none'}")

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "method": {
            "challenger": "pi-ratings (Constantinou & Fenton 2013) -> HistGradientBoosting",
            "pi_lambda": PI_LAMBDA, "pi_gamma": PI_GAMMA,
            "pi_alpha": PI_ALPHA, "pi_beta": PI_BETA,
            "reference": "arXiv:2403.07669 — gradient boosting on soccer-specific "
                         "ratings is the reported state of the art on goals-only data",
            "ratings_are_strictly_pre_match": True,
            "dixon_coles": "refit monthly on all prior matches",
            "brier": "multiclass summed; uniform 1/3 = .6667",
        },
        "scope": {"leagues": comps, "min_test_season": args.min_season,
                  "test_seasons": test_seasons, "n_scored": n_scored, "n_skipped": n_skipped},
        "overall": overall,
        "paired_pi_vs_dc": boot,
        "by_league": by_league,
    }, indent=2))
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
