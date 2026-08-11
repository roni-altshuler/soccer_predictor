"""The layered experiment: how much does each successive data layer add?

The question this answers
-------------------------
Not "how good can one model get" but "which DATA earns its place". The corpus
grew from 69,943 warehouse matches to 219,770 canonical ones, and referee
coverage went from 0% to 67-100% in four leagues that never had it. Those are
hypotheses, not improvements, until something measures them.

Architecture: two passes, and the split between them is the leakage guard
-------------------------------------------------------------------------
**Pass 1 — featurise chronologically.** One walk through every match in played
order. For each match the feature vector is read from running state, and only
then is the result folded into that state. Same-day fixtures are featurised as
a block before any of that day is observed, so a 12:30 kickoff cannot see a
17:30 result. Nothing in the emitted matrix was computed from the match it
describes, or from any match after it.

**Pass 2 — expanding-window refits.** Train on every row from seasons strictly
before T, predict season T, advance. This is legitimate *because* pass 1 already
made every row point-in-time correct: the only remaining requirement is that
training rows precede test rows, which a season boundary guarantees.

Doing it in one pass instead — refitting inside the walk — would cost 46,789
model fits to answer the same question. Doing it in the other order (featurise
from the whole corpus, then split) is the classic leak and is what the two-pass
structure exists to make impossible.

The layers
----------
    ratings      Elo, and the difference that carries most of the signal
    form         rolling goals/points over 3, 5, 10 matches, home/away split
    rest         days since last match, fixture congestion
    h2h          this pairing's history
    referee      the official's observed home-win rate  <- NEW, from FBref
    context      venue familiarity, attendance, real kickoff time  <- NEW

Each is added to the one above and scored against the same rows with a paired
bootstrap. A layer that does not clear its interval does not graduate.

    python3 -m backend.scripts.train_layered
    python3 -m backend.scripts.train_layered --competitions eng.1 --max-season 2025

Writes reports/baselines/layered.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.baseline_walkforward import (  # noqa: E402
    IDX,
    Elo,
    brier,
    load_matches,
    log_loss,
    paired_bootstrap,
    reliability,
)

logger = logging.getLogger("train_layered")
OUT = ROOT / "reports" / "baselines" / "layered.json"

# Layers, in the order they are added. The keys are prefixes on feature names.
LAYERS: List[Tuple[str, Tuple[str, ...]]] = [
    ("ratings", ("elo_",)),
    ("form", ("form_",)),
    ("rest", ("rest_",)),
    ("h2h", ("h2h_",)),
    ("referee", ("ref_",)),
    ("context", ("ctx_",)),
]


class FeatureState:
    """Everything the builder knows, mutated only by `observe`.

    Deliberately a single object with one mutator: `emit()` is a pure read and
    `observe()` is the only writer, so "did this feature see the future" is a
    question about call order rather than about forty lines of indexing.
    """

    def __init__(self) -> None:
        self.elo = Elo()
        self.results: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))
        self.home_results: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))
        self.away_results: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))
        self.last_date: Dict[str, object] = {}
        self.recent_dates: Dict[str, deque] = defaultdict(lambda: deque(maxlen=6))
        self.h2h: Dict[Tuple[str, str], deque] = defaultdict(lambda: deque(maxlen=10))
        # Referees: counts, not rates, so an unseen official is visibly unseen
        # rather than silently average.
        self.ref_counts: Dict[str, np.ndarray] = defaultdict(
            lambda: np.zeros(3, dtype=np.float64))
        self.venue_seen: Dict[Tuple[str, str], int] = defaultdict(int)
        self.att: Dict[str, deque] = defaultdict(lambda: deque(maxlen=10))

    # -- read ------------------------------------------------------------
    def emit(self, m: dict) -> Dict[str, float]:
        h, a = m["home_key"], m["away_key"]
        f: Dict[str, float] = {}

        eh, ea = self.elo.rating[h], self.elo.rating[a]
        f["elo_home"] = eh
        f["elo_away"] = ea
        f["elo_diff"] = eh - ea
        f["elo_expected"] = self.elo._expected(m)  # noqa: SLF001

        for tag, key, store in (("h", h, self.results), ("a", a, self.results)):
            hist = list(store[key])
            for w in (3, 5, 10):
                sl = hist[-w:]
                n = len(sl)
                f[f"form_{tag}_pts_{w}"] = (
                    sum(x["pts"] for x in sl) / n if n else np.nan)
                f[f"form_{tag}_gf_{w}"] = (
                    sum(x["gf"] for x in sl) / n if n else np.nan)
                f[f"form_{tag}_ga_{w}"] = (
                    sum(x["ga"] for x in sl) / n if n else np.nan)
            f[f"form_{tag}_played"] = len(hist)
        # Venue-specific form: a side's home record is not its overall record.
        hh, aa = list(self.home_results[h]), list(self.away_results[a])
        f["form_h_home_pts"] = (sum(x["pts"] for x in hh) / len(hh)) if hh else np.nan
        f["form_a_away_pts"] = (sum(x["pts"] for x in aa) / len(aa)) if aa else np.nan
        f["form_pts_diff"] = _sub(f["form_h_pts_5"], f["form_a_pts_5"])
        f["form_gd_diff"] = _sub(
            _sub(f["form_h_gf_5"], f["form_h_ga_5"]),
            _sub(f["form_a_gf_5"], f["form_a_ga_5"]))

        d = m["local_date"]
        for tag, key in (("h", h), ("a", a)):
            last = self.last_date.get(key)
            f[f"rest_{tag}_days"] = (d - last).days if last else np.nan
            recent = self.recent_dates[key]
            f[f"rest_{tag}_in_14d"] = sum(1 for x in recent if (d - x).days <= 14)
        f["rest_diff"] = _sub(f["rest_h_days"], f["rest_a_days"])

        pair = (h, a) if h < a else (a, h)
        meets = list(self.h2h[pair])
        f["h2h_n"] = len(meets)
        f["h2h_home_pts"] = (
            sum(x["pts_h"] if x["home"] == h else 3 - x["pts_h"] for x in meets)
            / len(meets)) if meets else np.nan

        ref = m.get("referee")
        c = self.ref_counts[ref] if ref else None
        if c is not None and c.sum() >= 10:
            tot = c.sum()
            f["ref_home_rate"] = c[0] / tot
            f["ref_draw_rate"] = c[1] / tot
            f["ref_n"] = tot
        else:
            f["ref_home_rate"] = np.nan
            f["ref_draw_rate"] = np.nan
            f["ref_n"] = 0.0 if ref else np.nan
        f["ref_known"] = 1.0 if ref else 0.0

        f["ctx_venue_seen"] = self.venue_seen[(h, m.get("venue") or "")]
        past_att = list(self.att[h])
        f["ctx_att_mean"] = float(np.mean(past_att)) if past_att else np.nan
        f["ctx_has_kickoff"] = 1.0 if m.get("has_kickoff_time") else 0.0
        f["ctx_dow"] = float(d.weekday())
        return f

    # -- write -----------------------------------------------------------
    def observe(self, m: dict) -> None:
        h, a, d = m["home_key"], m["away_key"], m["local_date"]
        hs, as_ = m["home_score"], m["away_score"]
        pts_h = 3 if hs > as_ else (1 if hs == as_ else 0)
        pts_a = 3 - pts_h if pts_h != 1 else 1

        self.results[h].append({"pts": pts_h, "gf": hs, "ga": as_})
        self.results[a].append({"pts": pts_a, "gf": as_, "ga": hs})
        self.home_results[h].append({"pts": pts_h})
        self.away_results[a].append({"pts": pts_a})
        for key in (h, a):
            self.last_date[key] = d
            self.recent_dates[key].append(d)
        pair = (h, a) if h < a else (a, h)
        self.h2h[pair].append({"home": h, "pts_h": pts_h})
        if m.get("referee"):
            self.ref_counts[m["referee"]][IDX[m["result"]]] += 1
        self.venue_seen[(h, m.get("venue") or "")] += 1
        if m.get("attendance"):
            self.att[h].append(float(m["attendance"]))
        self.elo.observe(m)


def _sub(x, y):
    return np.nan if (x is None or y is None or
                      (isinstance(x, float) and math.isnan(x)) or
                      (isinstance(y, float) and math.isnan(y))) else x - y


def featurise(matches: Sequence[dict]) -> Tuple[np.ndarray, List[str],
                                                np.ndarray, np.ndarray]:
    """Pass 1. Day-blocked: featurise the whole date, then observe the whole date."""
    state = FeatureState()
    rows: List[Dict[str, float]] = []
    # The Elo formula's own three-way call, recorded here rather than in a
    # separate run so the reference arm is scored on exactly the rows the
    # layers are scored on. Comparing against a number measured over a
    # different test window is how a model gets credited with a window.
    elo_p: List[np.ndarray] = []
    i, n = 0, len(matches)
    while i < n:
        j = i
        day = matches[i]["local_date"]
        while j < n and matches[j]["local_date"] == day:
            j += 1
        block = matches[i:j]
        for m in block:
            rows.append(state.emit(m))
            elo_p.append(state.elo.predict(m))
        for m in block:
            state.observe(m)
        i = j
        if len(rows) % 40000 < len(block):
            logger.info("  featurised %d/%d", len(rows), n)

    names = list(rows[0].keys())
    X = np.array([[r[k] for k in names] for r in rows], dtype=np.float64)
    y = np.array([IDX[m["result"]] for m in matches])
    return X, names, y, np.vstack(elo_p)


def expanding_fit(X: np.ndarray, y: np.ndarray, seasons: np.ndarray,
                  cols: Sequence[int], *, estimator: str = "logistic",
                  min_train: int = 3000) -> Tuple[np.ndarray, np.ndarray]:
    """Pass 2. Train on seasons strictly earlier, predict season T.

    Two estimators, because the first attempt answered the wrong question.
    LightGBM at 400 trees on ~5k rows scored Brier .6236 against plain Elo's
    .6023 with three times the calibration error — that is a model too large
    for its training set, and reading "the FBref layers do not help" off it
    would have blamed the data for the estimator.

    `logistic`   multinomial, standardised, L2. Few parameters, calibrated by
                 construction, and the literature's own linear-on-ratings
                 results sit within .0002 RPS of the best goal models.
    `lgbm`       small trees with EARLY STOPPING on the last season of the
                 training window. That season is strictly earlier than the test
                 season, so the stop is chosen without touching what is scored.
    """
    P = np.full((len(y), 3), np.nan)
    scored = np.zeros(len(y), dtype=bool)
    order = sorted(set(seasons.tolist()))

    for s in order:
        tr = np.flatnonzero(seasons < s)
        te = np.flatnonzero(seasons == s)
        if len(tr) < min_train or not len(te):
            continue
        Xtr, ytr = X[np.ix_(tr, cols)], y[tr]
        Xte = X[np.ix_(te, cols)]

        if estimator == "logistic":
            from sklearn.impute import SimpleImputer
            from sklearn.linear_model import LogisticRegression
            from sklearn.pipeline import make_pipeline
            from sklearn.preprocessing import StandardScaler

            model = make_pipeline(
                SimpleImputer(strategy="median"),
                StandardScaler(),
                LogisticRegression(max_iter=2000, C=0.5))
            model.fit(Xtr, ytr)
            P[te] = model.predict_proba(Xte)
        else:
            import lightgbm as lgb

            # Last training season as the early-stopping watcher. Strictly
            # earlier than the test season, so nothing scored is consulted.
            val_season = max(x for x in order if x < s)
            vmask = seasons[tr] == val_season
            if vmask.sum() < 200:
                vmask = np.zeros(len(tr), dtype=bool)
                vmask[-max(200, len(tr) // 10):] = True
            fit_idx, val_idx = ~vmask, vmask
            model = lgb.LGBMClassifier(
                objective="multiclass", num_class=3, n_estimators=2000,
                learning_rate=0.03, num_leaves=7, max_depth=3,
                min_child_samples=150, subsample=0.8, subsample_freq=1,
                colsample_bytree=0.7, reg_lambda=10.0, reg_alpha=1.0,
                n_jobs=-1, random_state=17, verbose=-1)
            model.fit(Xtr[fit_idx], ytr[fit_idx],
                      eval_set=[(Xtr[val_idx], ytr[val_idx])],
                      eval_metric="multi_logloss",
                      callbacks=[lgb.early_stopping(60, verbose=False)])
            P[te] = model.predict_proba(Xte)
        scored[te] = True
    return P, scored


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions",
                    default="eng.1,esp.1,ger.1,ita.1,fra.1")
    ap.add_argument("--min-season", type=int, default=2000)
    ap.add_argument("--max-season", type=int, default=2025,
                    help="the final holdout starts after this; 2026-27 is not "
                         "touched during development")
    ap.add_argument("--estimator", default="logistic",
                    choices=("logistic", "lgbm"))
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    comps = [c.strip() for c in args.competitions.split(",") if c.strip()]
    matches = load_matches(comps, args.min_season, args.max_season)

    # Fields the canonical layer carries that the baseline walk did not need.
    import duckdb
    con = duckdb.connect(str(ROOT / "backend" / "data" / "canonical.duckdb"),
                         read_only=True)
    extra = {r[0]: r for r in con.execute("""
        SELECT match_uid, referee, venue, attendance,
               CASE WHEN kickoff_utc LIKE '%T00:00%' THEN 0 ELSE 1 END
          FROM matches""").fetchall()}
    con.close()
    for m in matches:
        e = extra.get(m["match_uid"])
        if e:
            m["referee"], m["venue"], m["attendance"] = e[1], e[2], e[3]
            m["has_kickoff_time"] = bool(e[4])

    logger.info("matches: %d  (%s .. %s)", len(matches),
                matches[0]["local_date"], matches[-1]["local_date"])
    with_ref = sum(1 for m in matches if m.get("referee"))
    logger.info("referee present on %d (%.1f%%)", with_ref,
                100 * with_ref / len(matches))

    logger.info("pass 1: featurising chronologically...")
    X, names, y, elo_p = featurise(matches)
    seasons = np.array([m["season"] for m in matches])
    logger.info("feature matrix: %d x %d", *X.shape)

    logger.info("pass 2: expanding-window refits per layer...")
    results, kept_prefixes, prev = [], [], None
    reference: List[dict] = []
    for layer, prefixes in LAYERS:
        kept_prefixes.extend(prefixes)
        cols = [i for i, n in enumerate(names)
                if any(n.startswith(p) for p in kept_prefixes)]
        P, scored = expanding_fit(X, y, seasons, cols,
                                  estimator=args.estimator)
        rel, ece = reliability(P[scored], y[scored])
        row = {"layer": layer, "cumulative_features": len(cols),
               "n": int(scored.sum()),
               "log_loss": round(log_loss(P[scored], y[scored]), 5),
               "brier": round(brier(P[scored], y[scored]), 5),
               "accuracy": round(float(np.mean(
                   np.argmax(P[scored], axis=1) == y[scored])), 5),
               "ece": round(ece, 5)}
        if prev is not None:
            both = scored & prev[1]
            cmp = paired_bootstrap(P[both], prev[0][both], y[both])
            row["delta_vs_previous"] = {k: round(v, 5) for k, v in cmp.items()}
        results.append(row)
        if prev is None:
            # First layer fixes the scored mask; every reference arm is
            # measured on it so the whole table is one paired comparison.
            rel_e, ece_e = reliability(elo_p[scored], y[scored])
            reference.append({
                "model": "elo_formula", "n": int(scored.sum()),
                "log_loss": round(log_loss(elo_p[scored], y[scored]), 5),
                "brier": round(brier(elo_p[scored], y[scored]), 5),
                "accuracy": round(float(np.mean(
                    np.argmax(elo_p[scored], axis=1) == y[scored])), 5),
                "ece": round(ece_e, 5)})
            base = np.tile(np.bincount(y[~scored] if (~scored).sum() > 100
                                       else y[scored], minlength=3) /
                           max(1, len(y[~scored] if (~scored).sum() > 100
                                      else y[scored])), (int(scored.sum()), 1))
            reference.append({
                "model": "base_rate_prior", "n": int(scored.sum()),
                "log_loss": round(log_loss(base, y[scored]), 5),
                "brier": round(brier(base, y[scored]), 5),
                "accuracy": round(float(np.mean(
                    np.argmax(base, axis=1) == y[scored])), 5),
                "ece": round(reliability(base, y[scored])[1], 5)})
            for r in reference:
                logger.info("  [ref] %-16s logloss %.5f  brier %.5f  acc %.2f%%  ece %.4f",
                            r["model"], r["log_loss"], r["brier"],
                            100 * r["accuracy"], r["ece"])
            cmp0 = paired_bootstrap(P[scored], elo_p[scored], y[scored])
            row["delta_vs_elo_formula"] = {k: round(v, 5) for k, v in cmp0.items()}
            logger.info("  ratings vs elo_formula: dBrier %+.5f 95%% [%+.5f, %+.5f] -> %s",
                        cmp0["delta_brier"], cmp0["ci_low"], cmp0["ci_high"],
                        "BETTER" if cmp0["ci_high"] < 0 else
                        ("worse" if cmp0["ci_low"] > 0 else "ns"))
        prev = (P, scored)
        logger.info("  %-9s feats=%3d  logloss %.5f  brier %.5f  acc %.2f%%  ece %.4f%s",
                    layer, len(cols), row["log_loss"], row["brier"],
                    100 * row["accuracy"], row["ece"],
                    ("  d=%+.5f %s" % (
                        row["delta_vs_previous"]["delta_brier"],
                        "SIGNIFICANT" if row["delta_vs_previous"]["ci_high"] < 0
                        else ("worse" if row["delta_vs_previous"]["ci_low"] > 0
                              else "ns"))) if "delta_vs_previous" in row else "")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "protocol": "pass 1 chronological day-blocked featurisation; pass 2 "
                    "expanding-window refit, train on seasons < T predict T",
        "competitions": comps, "min_season": args.min_season,
        "max_season": args.max_season, "matches": len(matches),
        "estimator": args.estimator, "reference": reference,
        "feature_names": names,
        "layers": results,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
