"""Nested chronological challenger for the served Elo + form logistic head.

Run against an isolated canonical database; this script NEVER publishes models.
Half-life selection uses the preceding calendar year, then refits before each
outer year. Calendar cutoffs prevent overlapping league seasons leaking results.
Features retain the production builder's predict-before-observe day blocks.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from backend.scripts.baseline_walkforward import brier, load_matches, log_loss
from backend.scripts.train_layered import featurise

COMPETITIONS = ["eng.1", "esp.1", "ger.1", "ita.1", "fra.1"]
HALF_LIVES = (None, 365, 1095, 2190)


def input_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def warehouse_matches(path: Path, last_year: int):
    """Explicit exploratory fallback; never represented as the canonical corpus."""
    from backend.scripts.build_canonical import norm_team
    with sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT m.match_id AS match_uid, m.competition_id, m.season,
                   substr(m.date_utc,1,10) AS local_date,
                   h.canonical_name AS home_name, a.canonical_name AS away_name,
                   m.home_score, m.away_score, m.phase,
                   CASE WHEN m.home_score > m.away_score THEN 'H'
                        WHEN m.home_score < m.away_score THEN 'A' ELSE 'D' END AS result
            FROM matches m JOIN teams h ON h.team_id=m.home_team_id
            JOIN teams a ON a.team_id=m.away_team_id
            WHERE m.competition_id IN (?,?,?,?,?) AND m.season <= ?
              AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
            ORDER BY local_date, match_uid
        """, (*COMPETITIONS, last_year)).fetchall()
    unique = {}
    for row in rows:
        m = dict(row)
        m['local_date'] = date.fromisoformat(m['local_date'])
        m['home_key'] = m['competition_id'] + '::' + norm_team(m['home_name'])
        m['away_key'] = m['competition_id'] + '::' + norm_team(m['away_name'])
        unique.setdefault((m['local_date'], m['home_key'], m['away_key']), m)
    return list(unique.values())


def recency_weights(days: np.ndarray, cutoff: np.datetime64, half_life: int | None):
    if np.any(days >= cutoff):
        raise ValueError("Training observations must precede the forecast cutoff")
    if half_life is None:
        return np.ones(len(days))
    if half_life <= 0:
        raise ValueError("Half-life must be positive")
    ages = (cutoff - days).astype("timedelta64[D]").astype(float)
    weights = np.exp2(-ages / half_life)
    # Keep effective regularization comparable across arms.
    return weights / weights.mean()


def fit_predict(X, y, days, train, test, cutoff, half_life):
    if not train.any() or not test.any():
        raise ValueError("Empty temporal fold")
    model = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                          LogisticRegression(max_iter=2000, C=0.5))
    model.fit(X[train], y[train], logisticregression__sample_weight=
              recency_weights(days[train], cutoff, half_life))
    if list(model.classes_) != [0, 1, 2]:
        raise ValueError("All three outcome classes are required")
    return model.predict_proba(X[test])


def week_bootstrap(a, b, y, days, *, draws=2000, seed=17):
    """Paired calendar-week cluster bootstrap, bounded to 64 draws per batch."""
    if len(y) == 0 or len(a) != len(y) or len(b) != len(y) or len(days) != len(y):
        raise ValueError("Nonempty, aligned predictions are required")
    target = np.eye(3)[y]
    delta = ((a - target) ** 2).sum(1) - ((b - target) ** 2).sum(1)
    # 1970-01-05 is a Monday; retain all fixtures in a week as one cluster.
    weeks = (days.astype("datetime64[D]").astype(int) - 4) // 7
    _, index = np.unique(weeks, return_inverse=True)
    sums = np.bincount(index, weights=delta)
    counts = np.bincount(index)
    rng = np.random.default_rng(seed)
    estimates = []
    for start in range(0, draws, 64):
        sample = rng.integers(0, len(sums), (min(64, draws - start), len(sums)))
        estimates.extend(sums[sample].sum(1) / counts[sample].sum(1))
    return {"delta_brier": float(delta.mean()),
            "ci_low": float(np.percentile(estimates, 2.5)),
            "ci_high": float(np.percentile(estimates, 97.5)),
            "weeks": len(sums), "draws": draws, "seed": seed}


def metrics(p, y):
    return {"n": len(y), "brier": brier(p, y), "log_loss": log_loss(p, y),
            "accuracy": float((p.argmax(1) == y).mean())}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--warehouse-only", action="store_true",
                        help="Explicit exploratory run on SQLite warehouse; cannot pass production gate")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--first-year", type=int, default=2019)
    parser.add_argument("--last-year", type=int, default=2025)
    args = parser.parse_args(argv)
    if args.first_year > args.last_year:
        parser.error("first year must precede last year")
    matches = (warehouse_matches(args.database, args.last_year) if args.warehouse_only else
               load_matches(COMPETITIONS, 2000, args.last_year, database=args.database))
    X, names, y, _ = featurise(matches)
    X = X[:, [i for i, name in enumerate(names) if name.startswith(("elo_", "form_"))]]
    days = np.array([str(m["local_date"])[:10] for m in matches], dtype="datetime64[D]")
    competition = np.array([m["competition_id"] for m in matches])
    folds, predictions, incumbents, indices = [], [], [], []
    for year in range(args.first_year, args.last_year + 1):
        validation_start = np.datetime64(f"{year-1}-01-01")
        test_start, test_end = np.datetime64(f"{year}-01-01"), np.datetime64(f"{year+1}-01-01")
        inner_train, validation = days < validation_start, (days >= validation_start) & (days < test_start)
        train, test = days < test_start, (days >= test_start) & (days < test_end)
        if inner_train.sum() < 3000 or validation.sum() < 500 or test.sum() < 500:
            raise ValueError(f"Insufficient observations for {year}; refusing a partial report")
        scores = []
        for half_life in HALF_LIVES:
            p = fit_predict(X, y, days, inner_train, validation, validation_start, half_life)
            scores.append(brier(p, y[validation]))
        selected = HALF_LIVES[int(np.argmin(scores))]
        incumbent = fit_predict(X, y, days, train, test, test_start, None)
        challenger = incumbent.copy() if selected is None else fit_predict(X, y, days, train, test, test_start, selected)
        fold = {"year": year, "train_n": int(train.sum()), "validation_n": int(validation.sum()),
                "half_life_days": selected, "validation_brier": dict(zip(map(str, HALF_LIVES), scores)),
                "incumbent": metrics(incumbent, y[test]), "challenger": metrics(challenger, y[test])}
        folds.append(fold)
        predictions.append(challenger); incumbents.append(incumbent); indices.extend(np.flatnonzero(test))
        print(json.dumps(fold), flush=True)
    idx = np.array(indices)
    a, b, truth = np.vstack(predictions), np.vstack(incumbents), y[idx]
    interval = week_bootstrap(a, b, truth, days[idx])
    per_league = {}
    for league in COMPETITIONS:
        mask = competition[idx] == league
        per_league[league] = {"challenger": metrics(a[mask], truth[mask]), "incumbent": metrics(b[mask], truth[mask])}
    # Predeclared, conservative screen. A pass is research evidence, not automatic deployment.
    passed = (interval["ci_high"] < 0 and interval["delta_brier"] < -0.001
              and log_loss(a, truth) <= log_loss(b, truth)
              and all(v["challenger"]["brier"] - v["incumbent"]["brier"] <= 0.005 for v in per_league.values()))
    report = {"generated_at": datetime.now(timezone.utc).isoformat(),
              "protocol": "Nested calendar-year walk-forward; preceding-year Brier selects half-life; day-block features",
              "competitions": COMPETITIONS, "corpus_rows": len(matches),
              "features": "Elo + form; same C=0.5 logistic as served head",
              "candidate_half_lives_days": HALF_LIVES,
              "gate": "95% week-bootstrap upper bound < 0; delta Brier < -0.001; no log-loss regression; league delta <= 0.005",
              "passes_research_gate": bool(passed), "production_changed": False,
              "corpus": "warehouse_only" if args.warehouse_only else "canonical",
              "input_sha256": input_digest(args.database),
              "environment": {"numpy": np.__version__, "scikit_learn": sklearn.__version__},
              "production_eligible": bool(passed and not args.warehouse_only),
              "corpus_first_date": str(days.min()), "corpus_last_date": str(days.max()),
              "incumbent": metrics(b, truth), "challenger": metrics(a, truth),
              "paired_week_bootstrap": interval, "by_league": per_league, "folds": folds}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
