"""Train on everything played, forecast everything not yet played.

This is the production path. It is deliberately the same code that was
measured: `FeatureState` from `train_layered`, the ratings+form feature set
that won the layered ablation (Brier .59303, ECE .0099), and Dixon-Coles for
the scoreline distribution. Nothing here is a second implementation of a
measured thing — a serving path that re-implements its own features is how
this repo previously shipped a model that saw zeros where training saw prices.

One model, three outputs, no disagreement
-----------------------------------------
The 1X2 head and the goal model are different families and they will not agree
by accident. Showing "home 52%" next to a scoreline grid that implies 48% is
the kind of incoherence that makes a page untrustworthy, so they are
reconciled rather than displayed side by side:

  1. Dixon-Coles gives (lambda_home, lambda_away) and the low-score tau.
  2. The logistic gives the 1X2 that was actually measured best.
  3. Solve for scalars (a, b) such that the scoreline matrix built from
     (a*lambda_home, b*lambda_away) reproduces the logistic's home and away
     probabilities.

The result is ONE object — expected goals, a scoreline matrix, and a 1X2 —
all internally consistent, with the 1X2 equal to the measured-best forecast.

Leakage
-------
The upcoming fixtures have no results, so there is nothing for them to leak.
The guard that matters is the other direction: the feature state is advanced
over played matches only, in chronological order, and is then FROZEN before
any future fixture is featurised. A future fixture cannot alter the state that
another future fixture is scored from, which is what would happen if the loop
observed its own predictions.

    python3 -m backend.scripts.forecast_season
    python3 -m backend.scripts.forecast_season --competitions eng.1 --sims 20000

Writes backend/data/predictions/season_fixtures.json and season_projections.json.
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

from backend.scripts.baseline_walkforward import IDX, load_matches  # noqa: E402
from backend.scripts.train_layered import FeatureState  # noqa: E402

logger = logging.getLogger("forecast_season")

CANONICAL = ROOT / "backend" / "data" / "canonical.duckdb"
OUT_DIR = ROOT / "backend" / "data" / "predictions"

# The feature set that won the layered ablation. Referee, rest, h2h and context
# were measured and did not earn a place; they are absent rather than carried
# "just in case", because an unused column is a column that can silently break.
KEPT_PREFIXES = ("elo_", "form_")

# Leagues served, with the relegation rule the simulation actually applies.
LEAGUES: Dict[str, Dict] = {
    "eng.1": {"name": "Premier League", "country": "England", "relegate": 3},
    "esp.1": {"name": "La Liga", "country": "Spain", "relegate": 3},
    "ger.1": {"name": "Bundesliga", "country": "Germany", "relegate": 2,
              "playoff": 1},
    "ita.1": {"name": "Serie A", "country": "Italy", "relegate": 3},
    "fra.1": {"name": "Ligue 1", "country": "France", "relegate": 2,
              "playoff": 1},
    "ned.1": {"name": "Eredivisie", "country": "Netherlands", "relegate": 2},
    "por.1": {"name": "Primeira Liga", "country": "Portugal", "relegate": 2},
}

MAX_GOALS = 10


def load_upcoming(competitions: Sequence[str]) -> List[dict]:
    """Fixtures with no result yet, from the FBref schedule tier.

    Read here rather than from `matches` because the canonical layer is played
    matches only — that invariant is what lets every consumer treat a row as a
    fact — so the fixture list is a separate read by construction.
    """
    import duckdb

    from backend.scripts.build_canonical import COMPETITION_MAP, norm_team

    con = duckdb.connect(str(CANONICAL), read_only=True)
    con.execute("INSTALL sqlite; LOAD sqlite;")
    con.execute(f"ATTACH '{ROOT / 'backend' / 'data' / 'fbref.sqlite'}' "
                f"AS fb (TYPE sqlite, READ_ONLY)")
    con.create_function("norm_team", norm_team, ["VARCHAR"], "VARCHAR")
    rows = con.execute("""
        SELECT f.league, f.season, f.date, f.time, f.home, f.away, f.round
          FROM fb.fbref_fixtures f
         WHERE f.home_goals IS NULL AND f.date >= ?
         ORDER BY f.date, f.home
    """, [datetime.now(timezone.utc).date().isoformat()]).fetchall()
    aliases = {(r[0], r[1]): r[2] for r in con.execute(
        "SELECT competition_id, fb_norm, wh_norm FROM team_aliases").fetchall()}
    con.close()

    out = []
    for league, season, date, time, home, away, rnd in rows:
        comp = COMPETITION_MAP.get(league)
        if comp not in competitions:
            continue
        hn = aliases.get((comp, norm_team(home)), norm_team(home))
        an = aliases.get((comp, norm_team(away)), norm_team(away))
        out.append({
            "competition_id": comp, "season": int(str(season)[:4]),
            "local_date": datetime.fromisoformat(date).date(),
            "kickoff": time or None, "round": rnd,
            "home_name": home, "away_name": away,
            "home_key": f"{comp}::{hn}", "away_key": f"{comp}::{an}",
            "home_score": None, "away_score": None,
        })
    return out


def fit_head(X: np.ndarray, y: np.ndarray, cols: Sequence[int]):
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    model = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                          LogisticRegression(max_iter=2000, C=0.5))
    model.fit(X[:, cols], y)
    return model


def score_matrix(lh: float, la: float, rho: float = -0.05) -> np.ndarray:
    """Dixon-Coles scoreline matrix: independent Poisson with the low-score
    cells reweighted, which is the whole point of the correction."""
    i = np.arange(MAX_GOALS + 1)
    fact = np.array([math.factorial(int(k)) for k in i], dtype=np.float64)
    ph = np.exp(-lh) * lh ** i / fact
    pa = np.exp(-la) * la ** i / fact
    M = np.outer(ph, pa)
    M[0, 0] *= 1 - lh * la * rho
    M[0, 1] *= 1 + lh * rho
    M[1, 0] *= 1 + la * rho
    M[1, 1] *= 1 - rho
    return M / M.sum()


def outcome_probs(M: np.ndarray) -> Tuple[float, float, float]:
    return (float(np.tril(M, -1).sum()), float(np.trace(M)),
            float(np.triu(M, 1).sum()))


def reconcile(target: np.ndarray, lh0: float, la0: float) -> Tuple[float, float]:
    """Find (lambda_home, lambda_away) whose scoreline matrix reproduces the
    measured-best 1X2. Two unknowns, two equations (home and away; the draw
    follows). Falls back to the goal model's own lambdas if the solve fails —
    a slightly incoherent forecast beats a missing one."""
    from scipy.optimize import least_squares

    def resid(z):
        lh, la = float(np.exp(z[0])), float(np.exp(z[1]))
        ph, _, pa = outcome_probs(score_matrix(lh, la))
        return [ph - target[0], pa - target[2]]

    try:
        sol = least_squares(resid, x0=[np.log(max(lh0, .2)), np.log(max(la0, .2))],
                            bounds=([np.log(.1)] * 2, [np.log(6.0)] * 2))
        return float(np.exp(sol.x[0])), float(np.exp(sol.x[1]))
    except Exception:  # noqa: BLE001
        return lh0, la0


# Within-season Elo drift, measured over 3,583 team-seasons in this corpus:
# sd 45.3 points (p10 -58, p90 +57). That is how wrong a start-of-season rating
# turns out to be about the season it is about to predict, and it is NOT
# match-level noise — it is correlated across all 38 of a club's fixtures.
#
# Simulating without it is why the first run of this script made Bayern 93.3%
# and PSG 88.1% for their titles, against bookmaker prices nearer 70%. A point
# estimate compounded 34 times is not a forecast, it is an assumption repeated.
#
# Converted to a log-goal-rate shock: 400 Elo is a factor of 10 in odds, and a
# strength difference splits roughly evenly across the two lambdas.
SEASON_ELO_DRIFT_SD = 45.3
STRENGTH_SHOCK_SD = SEASON_ELO_DRIFT_SD / 400 * np.log(10) / 2
SHOCK_BUCKETS = 15


def simulate_season(fixtures: List[dict], table: Dict[str, dict], *,
                    sims: int, rng: np.random.Generator,
                    shock_sd: float = STRENGTH_SHOCK_SD) -> Dict[str, dict]:
    """Monte Carlo the rest of the league, with strength uncertainty.

    Each simulation draws one strength offset PER TEAM and holds it for the
    whole season, so a run where Inter are better than rated is a run where
    they are better in all 38 matches. That correlation is the entire
    difference between a 93% title probability and a defensible one.

    The Dixon-Coles low-score correction survives the perturbation: the two
    lambdas depend only on the strength DIFFERENCE, so bucketing that
    difference into `SHOCK_BUCKETS` quantiles and precomputing one matrix per
    bucket keeps the tau term exact while staying vectorised.
    """
    teams = sorted(table)
    ti = {t: i for i, t in enumerate(teams)}
    n = len(teams)
    base_pts = np.array([table[t]["points"] for t in teams], dtype=np.int32)
    base_gd = np.array([table[t]["gd"] for t in teams], dtype=np.int32)
    base_gf = np.array([table[t]["gf"] for t in teams], dtype=np.int32)

    # One offset per team per simulation, fixed for the season.
    U = rng.normal(0.0, shock_sd, size=(sims, n))

    # Representative delta for each bucket, and each sim's bucket per fixture.
    edges = np.quantile(rng.normal(0.0, shock_sd * np.sqrt(2), size=200000),
                        np.linspace(0, 1, SHOCK_BUCKETS + 1))
    centres = (edges[:-1] + edges[1:]) / 2

    pts = np.tile(base_pts, (sims, 1)).astype(np.int32)
    gd = np.tile(base_gd, (sims, 1)).astype(np.int32)
    gf = np.tile(base_gf, (sims, 1)).astype(np.int32)

    for f in fixtures:
        if f["home_key"] not in ti or f["away_key"] not in ti:
            continue
        h, a = ti[f["home_key"]], ti[f["away_key"]]
        delta = U[:, h] - U[:, a]
        bucket = np.clip(np.searchsorted(edges[1:-1], delta), 0,
                         SHOCK_BUCKETS - 1)
        lh0, la0 = f["_lh"], f["_la"]

        hg = np.empty(sims, dtype=np.int32)
        ag = np.empty(sims, dtype=np.int32)
        for b in range(SHOCK_BUCKETS):
            mask = bucket == b
            k = int(mask.sum())
            if not k:
                continue
            d = float(centres[b])
            M = score_matrix(lh0 * np.exp(d), la0 * np.exp(-d))
            flat = M.ravel()
            idx = rng.choice(len(flat), size=k, p=flat / flat.sum())
            hg[mask] = (idx // (MAX_GOALS + 1)).astype(np.int32)
            ag[mask] = (idx % (MAX_GOALS + 1)).astype(np.int32)

        home_win, draw = hg > ag, hg == ag
        pts[:, h] += np.where(home_win, 3, np.where(draw, 1, 0))
        pts[:, a] += np.where(hg < ag, 3, np.where(draw, 1, 0))
        gd[:, h] += hg - ag
        gd[:, a] += ag - hg
        gf[:, h] += hg
        gf[:, a] += ag

    # Rank on points, then goal difference, then goals scored — the ordering
    # every one of these leagues actually uses.
    key = pts.astype(np.int64) * 10_000_000 + (gd + 200) * 10_000 + gf
    order = np.argsort(-key, axis=1, kind="stable")
    position = np.empty_like(order)
    rows = np.arange(sims)[:, None]
    position[rows, order] = np.arange(n)[None, :]

    return {t: {"pos": position[:, ti[t]], "pts": pts[:, ti[t]]} for t in teams}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions", default=",".join(LEAGUES))
    ap.add_argument("--min-season", type=int, default=2000)
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=17)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    comps = [c.strip() for c in args.competitions.split(",") if c.strip()]
    played = load_matches(comps, args.min_season, None)
    logger.info("training on %d played matches (%s .. %s)", len(played),
                played[0]["local_date"], played[-1]["local_date"])

    # -- pass 1: advance state over history, then FREEZE ------------------
    state = FeatureState()
    rows, i, n = [], 0, len(played)
    while i < n:
        j = i
        day = played[i]["local_date"]
        while j < n and played[j]["local_date"] == day:
            j += 1
        for m in played[i:j]:
            rows.append(state.emit(m))
        for m in played[i:j]:
            state.observe(m)
        i = j

    names = list(rows[0].keys())
    cols = [k for k, nm in enumerate(names)
            if any(nm.startswith(p) for p in KEPT_PREFIXES)]
    X = np.array([[r[k] for k in names] for r in rows], dtype=np.float64)
    y = np.array([IDX[m["result"]] for m in played])
    logger.info("feature matrix %d x %d (serving %d columns)", *X.shape, len(cols))

    head = fit_head(X, y, cols)

    # -- goal scale, per competition --------------------------------------
    # Expected goals have to come from somewhere before reconciliation can
    # adjust them; the competition's own recent scoring rate is the least
    # assuming starting point.
    recent = defaultdict(list)
    for m in played[-40000:]:
        recent[m["competition_id"]].append((m["home_score"], m["away_score"]))
    scale = {c: (float(np.mean([x[0] for x in v])), float(np.mean([x[1] for x in v])))
             for c, v in recent.items()}

    # -- upcoming ---------------------------------------------------------
    upcoming = load_upcoming(comps)
    logger.info("upcoming fixtures: %d", len(upcoming))
    unknown = {f["home_key"] for f in upcoming if f["home_key"] not in state.elo.rating}
    if unknown:
        logger.info("  %d clubs with no rating yet (promoted sides) — they start "
                    "at the base rating, which is the honest prior", len(unknown))

    feats = np.array([[state.emit(f)[k] for k in names] for f in upcoming],
                     dtype=np.float64)
    P = head.predict_proba(feats[:, cols])

    fixtures_out = []
    for f, p in zip(upcoming, P):
        lh0, la0 = scale.get(f["competition_id"], (1.5, 1.2))
        lh, la = reconcile(p, lh0, la0)
        M = score_matrix(lh, la)
        f["_lh"], f["_la"] = lh, la
        ph, pd_, pa = outcome_probs(M)
        top = np.dstack(np.unravel_index(np.argsort(-M.ravel())[:5], M.shape))[0]
        fixtures_out.append({
            "competition_id": f["competition_id"], "season": f["season"],
            "date": f["local_date"].isoformat(), "kickoff": f["kickoff"],
            "round": f["round"],
            "home": f["home_name"], "away": f["away_name"],
            "p_home": round(float(p[0]), 4), "p_draw": round(float(p[1]), 4),
            "p_away": round(float(p[2]), 4),
            "xg_home": round(lh, 3), "xg_away": round(la, 3),
            "scorelines": [{"score": f"{int(h)}-{int(a)}",
                            "p": round(float(M[h, a]), 4)} for h, a in top],
            "coherence_gap": round(float(max(abs(ph - p[0]), abs(pa - p[2]))), 5),
        })

    gap = max(f["coherence_gap"] for f in fixtures_out) if fixtures_out else 0
    logger.info("worst 1X2/scoreline disagreement after reconciliation: %.5f", gap)

    # -- season projections ------------------------------------------------
    rng = np.random.default_rng(args.seed)
    projections = []
    by_comp: Dict[str, List[dict]] = defaultdict(list)
    for f in upcoming:
        by_comp[f["competition_id"]].append(f)

    for comp, fs in by_comp.items():
        season = max(x["season"] for x in fs)
        fs = [f for f in fs if f["season"] == season]
        entrants = sorted({k for f in fs for k in (f["home_key"], f["away_key"])})
        # Points already banked this season, if any of it has been played.
        table = {t: {"points": 0, "gd": 0, "gf": 0, "played": 0} for t in entrants}
        for m in played:
            if m["competition_id"] != comp or m["season"] != season:
                continue
            for key, gf_, ga in ((m["home_key"], m["home_score"], m["away_score"]),
                                 (m["away_key"], m["away_score"], m["home_score"])):
                if key not in table:
                    continue
                table[key]["points"] += 3 if gf_ > ga else (1 if gf_ == ga else 0)
                table[key]["gd"] += gf_ - ga
                table[key]["gf"] += gf_
                table[key]["played"] += 1

        sim = simulate_season(fs, table, sims=args.sims, rng=rng)
        cfg = LEAGUES.get(comp, {})
        rel_from = len(entrants) - cfg.get("relegate", 3)
        po_from = rel_from - cfg.get("playoff", 0)
        names_by_key = {}
        for f in fs:
            names_by_key[f["home_key"]] = f["home_name"]
            names_by_key[f["away_key"]] = f["away_name"]

        rows_out = []
        for t, s in sim.items():
            pos = s["pos"]
            rows_out.append({
                "team": names_by_key.get(t, t.split("::")[-1]),
                "p_title": round(float((pos == 0).mean()), 4),
                "p_top4": round(float((pos < 4).mean()), 4),
                "p_relegated": round(float((pos >= rel_from).mean()), 4),
                "p_playoff": round(float(((pos >= po_from) & (pos < rel_from)).mean()), 4)
                if cfg.get("playoff") else None,
                "exp_points": round(float(s["pts"].mean()), 1),
                "exp_position": round(float(pos.mean()) + 1, 2),
                "played": table[t]["played"], "points": table[t]["points"],
            })
        rows_out.sort(key=lambda r: -r["p_title"])
        projections.append({
            "competition_id": comp, "name": cfg.get("name", comp),
            "country": cfg.get("country"), "season": season,
            "fixtures_remaining": len(fs), "teams": len(entrants),
            "relegation_places": cfg.get("relegate", 3),
            "table": rows_out,
        })
        top = rows_out[0]
        logger.info("  %-8s %d  %2d teams, %3d to play  favourite %s %.1f%%",
                    comp, season, len(entrants), len(fs), top["team"],
                    100 * top["p_title"])

    method = {
        "head": "multinomial logistic on Elo + rolling form, the feature set "
                "that won the layered ablation",
        "measured": {"brier": 0.59303, "ece": 0.0099, "n": 43433,
                     "protocol": "expanding-window walk-forward, Wave A 2000-2025",
                     "beats": {"elo_formula": 0.60108, "base_rate": 0.64760,
                               "dixon_coles_walkforward": 0.59580}},
        "goals": "Dixon-Coles scoreline matrix, lambdas solved so the implied "
                 "1X2 equals the logistic's",
        "sims": args.sims,
        "strength_uncertainty": {
            "within_season_elo_drift_sd": SEASON_ELO_DRIFT_SD,
            "measured_over_team_seasons": 3583,
            "note": "drawn once per team per simulation and held for the "
                    "season, so a club's error is correlated across all its "
                    "fixtures. Per-MATCH probabilities are unperturbed: the "
                    "head was measured at ECE .0099 on exactly those inputs.",
        },
        "excluded_after_measurement": ["referee", "rest", "head-to-head",
                                       "venue", "attendance", "kickoff time"],
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat()
    (OUT_DIR / "season_fixtures.json").write_text(json.dumps({
        "generated_at": stamp, "method": method,
        "fixtures": fixtures_out}, indent=2))
    (OUT_DIR / "season_projections.json").write_text(json.dumps({
        "generated_at": stamp, "method": method,
        "leagues": projections}, indent=2))
    logger.info("\nwrote %s", OUT_DIR / "season_fixtures.json")
    logger.info("wrote %s", OUT_DIR / "season_projections.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
