"""
Bake-off across penaltyblog's goal models, plus blends, against the closing line.

Every model is scored on the *identical* fixture set — a fixture is kept only if
every model produced a probability for it — so the comparison is exactly paired
and blends can be computed after the fact from the stored vectors.

Walk-forward: for each league and each test season, fit on every season strictly
before it. Nothing about the test season reaches the fit.

    python3 -m backend.scripts.bakeoff_goal_models --leagues eng.1,esp.1

Writes backend/data/diagnostics/goal_model_bakeoff.json.

**`--bayesian` is not runnable over the full corpus.** Measured 2026-08-10 on
the repaired warehouse: the very first and *cheapest* fold (eng.1 2007, three
training seasons) took `BayesianGoalModel` **2,345 seconds** at penaltyblog's
default sampler — 4 chains x 2,000 draws plus 1,000 burn. Full Wave A is 97
folds and the training set grows to 20 seasons, so the full run is on the order
of a hundred hours, not the ninety minutes it was first given. Use
`--min-season` and `--mcmc-*` to buy a scoped answer, and state the scope
alongside the numbers.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import penaltyblog as pb

DB = Path("backend/data/warehouse.sqlite")
OUT = Path("backend/data/diagnostics/goal_model_bakeoff.json")
LEAGUES = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
}
XI = 0.0018

# Cheap-to-fit models run by default. The Bayesian/copula families are far
# slower, so they are opt-in via --slow rather than silently costing 40 minutes.
FAST_MODELS = {
    "poisson": pb.models.PoissonGoalsModel,
    "dixon_coles": pb.models.DixonColesGoalModel,
    "bivariate_poisson": pb.models.BivariatePoissonGoalModel,
    "negative_binomial": pb.models.NegativeBinomialGoalModel,
    "zero_inflated": pb.models.ZeroInflatedPoissonGoalsModel,
}
# Named in docs/PIVOT_2026-08.md §3.1 as the next challengers to run, and
# never run: "the hierarchical Bayesian model in particular pools strength
# across teams, which is exactly what thin-data leagues need." Separated from
# --slow because these fit by sampling and cost minutes per league-season, not
# seconds.
BAYESIAN_MODELS = {
    "bayesian": pb.models.BayesianGoalModel,
    "hierarchical_bayesian": pb.models.HierarchicalBayesianGoalModel,
}

SLOW_MODELS = {
    "weibull_copula": pb.models.WeibullCopulaGoalsModel,
}


def load(conn: sqlite3.Connection, comp: str) -> list[tuple]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT m.season, m.date_utc, th.canonical_name, ta.canonical_name,
               m.home_score, m.away_score, m.odds_home, m.odds_draw, m.odds_away
        FROM matches m
        JOIN teams th ON m.home_team_id = th.team_id
        JOIN teams ta ON m.away_team_id = ta.team_id
        WHERE m.competition_id = ? AND m.home_score IS NOT NULL
        ORDER BY m.date_utc
        """,
        (comp,),
    )
    return cur.fetchall()


def devig(oh: float, od: float, oa: float) -> list[float]:
    pi = [1.0 / oh, 1.0 / od, 1.0 / oa]
    b = sum(pi)
    return [x / b for x in pi]


def normalise(p) -> list[float]:
    p = [max(1e-12, float(x)) for x in p]
    s = sum(p)
    return [x / s for x in p]


def metrics(vectors: list[list[float]], outcomes: list[int]) -> dict:
    n = len(outcomes)
    if not n:
        return {}
    brier = ll = hits = rps_sum = 0.0
    for p, idx in zip(vectors, outcomes):
        brier += sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))
        ll += -math.log(max(1e-12, p[idx]))
        hits += int(max(range(3), key=lambda i: p[i]) == idx)
        # RPS over the ordered H/D/A ladder.
        cum_p = cum_o = 0.0
        acc = 0.0
        for i in range(2):
            cum_p += p[i]
            cum_o += 1.0 if i == idx else 0.0
            acc += (cum_p - cum_o) ** 2
        rps_sum += acc / 2.0
    return {
        "n": n,
        "brier": round(brier / n, 4),
        "log_loss": round(ll / n, 4),
        "rps": round(rps_sum / n, 4),
        "accuracy": round(hits / n, 4),
    }


def fit_predict(model_cls, train, test, fit_kwargs: dict | None = None):
    """Fit one model on `train`, return {fixture_index: prob_vector} for `test`."""
    dates = np.array([np.datetime64(r[1][:10]) for r in train])
    age = (dates.max() - dates).astype("timedelta64[D]").astype(float)
    weights = np.exp(-XI * age)

    model = model_cls(
        goals_home=[r[4] for r in train],
        goals_away=[r[5] for r in train],
        teams_home=[r[2] for r in train],
        teams_away=[r[3] for r in train],
        weights=weights,
    )
    model.fit(**(fit_kwargs or {}))

    out = {}
    for i, row in enumerate(test):
        _s, _d, home, away, _hs, _as, oh, od, oa = row
        if None in (oh, od, oa) or min(oh, od, oa) <= 1.0:
            continue
        try:
            pr = model.predict(home, away)
            vec = [pr.home_win, pr.draw, pr.away_win]
        except Exception:
            continue
        if any(v is None or math.isnan(v) for v in vec):
            continue
        out[i] = normalise(vec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", default=",".join(LEAGUES))
    ap.add_argument("--slow", action="store_true", help="include Weibull copula")
    ap.add_argument("--bayesian", action="store_true",
                    help="include the Bayesian and hierarchical Bayesian goal models "
                         "(minutes per league-season — they fit by sampling)")
    ap.add_argument("--min-train", type=int, default=500)
    ap.add_argument("--min-season", type=int, default=None,
                    help="skip test seasons before this one. The samplers cost minutes "
                         "to hours per fold, so a scoped window is often the only "
                         "affordable way to run them at all.")
    ap.add_argument("--mcmc-samples", type=int, default=None,
                    help="MCMC draws per chain for the Bayesian models "
                         "(penaltyblog defaults: 2000 / 3000)")
    ap.add_argument("--mcmc-burn", type=int, default=None,
                    help="MCMC burn-in draws to discard (defaults: 1000 / 1500)")
    ap.add_argument("--mcmc-chains", type=int, default=None,
                    help="parallel MCMC chains (default: 4)")
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args()

    models = dict(FAST_MODELS)
    if args.slow:
        models.update(SLOW_MODELS)
    if args.bayesian:
        models.update(BAYESIAN_MODELS)

    # Sampler settings apply only to the models that sample. Passing n_samples to
    # a closed-form fit is a TypeError, so key the kwargs by model name.
    mcmc: dict = {}
    if args.mcmc_samples is not None:
        mcmc["n_samples"] = args.mcmc_samples
    if args.mcmc_burn is not None:
        mcmc["burn"] = args.mcmc_burn
    if args.mcmc_chains is not None:
        mcmc["n_chains"] = args.mcmc_chains
    fit_kwargs = {name: (mcmc if name in BAYESIAN_MODELS else {}) for name in models}
    if mcmc:
        print(f"sampler override for {sorted(BAYESIAN_MODELS)}: {mcmc}", file=sys.stderr)

    if not DB.exists() or DB.stat().st_size == 0:
        print("warehouse missing or empty — nothing to score", file=sys.stderr)
        return 2

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]

    # name -> list of prob vectors, aligned with `outcomes`
    pooled: dict[str, list[list[float]]] = defaultdict(list)
    outcomes: list[int] = []
    per_league: dict[str, dict] = {}
    folds_scored = 0

    for comp in comps:
        rows = load(conn, comp)
        seasons = sorted({r[0] for r in rows})
        lg_pred: dict[str, list[list[float]]] = defaultdict(list)
        lg_out: list[int] = []

        for test_season in seasons[3:]:
            if args.min_season is not None and int(test_season) < args.min_season:
                continue
            train = [r for r in rows if r[0] < test_season]
            test = [r for r in rows if r[0] == test_season]
            if len(train) < args.min_train or not test:
                continue

            got: dict[str, dict[int, list[float]]] = {}
            for name, cls in models.items():
                t0 = time.time()
                try:
                    got[name] = fit_predict(cls, train, test, fit_kwargs.get(name))
                except Exception as exc:  # noqa: BLE001
                    print(f"  ! {comp} {test_season} {name}: {exc}", file=sys.stderr)
                    got[name] = {}
                print(
                    f"  {comp} {test_season} {name:<18} "
                    f"{len(got[name]):>4} preds  {time.time()-t0:>5.1f}s",
                    file=sys.stderr,
                )

            # Keep only fixtures every model priced — exact pairing.
            common = set.intersection(*(set(v) for v in got.values())) if got else set()
            if common:
                folds_scored += 1
            for i in sorted(common):
                _s, _d, _h, _a, hs, a_s, oh, od, oa = test[i]
                lg_out.append(0 if hs > a_s else (2 if a_s > hs else 1))
                for name in models:
                    lg_pred[name].append(got[name][i])
                lg_pred["market"].append(devig(oh, od, oa))

        if not lg_out:
            continue
        per_league[LEAGUES.get(comp, comp)] = {
            name: metrics(vecs, lg_out) for name, vecs in lg_pred.items()
        }
        outcomes.extend(lg_out)
        for name, vecs in lg_pred.items():
            pooled[name].extend(vecs)

    if not outcomes:
        print("no scoreable fixtures", file=sys.stderr)
        return 1

    # Blends, computed after the fact from the stored vectors.
    model_names = [n for n in models if pooled.get(n)]
    if len(model_names) > 1:
        pooled["blend_all_equal"] = [
            normalise([sum(pooled[n][i][k] for n in model_names) / len(model_names) for k in range(3)])
            for i in range(len(outcomes))
        ]
    if "dixon_coles" in pooled and "bivariate_poisson" in pooled:
        pooled["blend_dc_bivpois"] = [
            normalise([(pooled["dixon_coles"][i][k] + pooled["bivariate_poisson"][i][k]) / 2 for k in range(3)])
            for i in range(len(outcomes))
        ]

    overall = {name: metrics(vecs, outcomes) for name, vecs in pooled.items()}

    mkt = overall.get("market", {})
    print()
    print(f"{'model':<22}{'n':>7}{'Brier':>9}{'log loss':>10}{'RPS':>8}{'acc':>8}{'vs mkt':>9}")
    print("-" * 73)
    for name, m in sorted(overall.items(), key=lambda kv: kv[1].get("brier", 9)):
        gap = m["brier"] - mkt["brier"] if mkt else float("nan")
        print(f"{name:<22}{m['n']:>7}{m['brier']:>9.4f}{m['log_loss']:>10.4f}"
              f"{m['rps']:>8.4f}{m['accuracy']:>8.4f}{gap:>+9.4f}")

    # The scope travels with the numbers. A Bayesian run is affordable only on a
    # window, and a windowed Brier read as a full-corpus one is a false claim.
    scope = {
        "leagues": comps,
        "min_season": args.min_season,
        "min_train": args.min_train,
        "models": sorted(models),
        "folds_scored": folds_scored,
        "sampler_overrides": mcmc or None,
    }
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps({"scope": scope, "overall": overall, "per_league": per_league}, indent=2)
    )
    print(f"\nwrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
