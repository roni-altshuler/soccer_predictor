"""Does knowing the starting eleven help? Measured, not assumed.

The question
-----------
Every null result this project has produced points the same way. Six goal
models within .003 of each other, two Bayesian models within .001, pi-ratings
plus a gradient booster at parity, sixteen swept tree configurations no better,
and a permutation importance where ONE feature scores +.079 and everything else
is an order of magnitude below. The model family is not the bottleneck. The
feature set collapses to roughly one number — how good is each side — and no
classifier extracts more from one number than the number contains.

So the useful work is new information, and there was exactly one input the
closing line had that this model did not: team news. `lineups` was an empty
table for the life of the project. It now holds 759,920 rows across 18,939
Wave A matches, 2015-2025, backfilled from ESPN.

This measures whether that helps. It may not. The honest possibilities are
that the market's edge comes from somewhere else entirely, or that by kickoff
the lineup is already priced in and a model that sees it at the same time
gains nothing.

Servability
-----------
This repo's worst bug was a train/serve skew: market features were 96% present
in training and always zero at serve time, and the model shipped at below the
base rate for months. So every feature here is computed from the starting XI
alone, which `lineup_scraper.py` already fetches about an hour before kickoff
for upcoming fixtures. Nothing here needs post-match data. A feature that
cannot be populated at serve time is not measured, because measuring it would
only produce a number that cannot be used.

Leakage
-------
A player's quality is computed from appearances STRICTLY BEFORE the match in
question, accumulated in one chronological pass. The "usual eleven" a lineup is
compared against is the modal starting XI of that team's previous six matches,
which is likewise built from the past only.

    python3 -m backend.scripts.benchmark_lineup_features --min-season 2015

Writes backend/data/diagnostics/lineup_features.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import sqlite3
import sys
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.benchmark_pi_ratings import (  # noqa: E402
    WAVE_A,
    build_pi_features,
    load_matches,
)

logger = logging.getLogger("benchmark_lineup_features")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "lineup_features.json"

LINEUP_FEATURES = [
    "xi_continuity_h", "xi_continuity_a", "xi_continuity_diff",
    "xi_experience_h", "xi_experience_a", "xi_experience_diff",
    "xi_output_h", "xi_output_a", "xi_output_diff",
    "xi_newcomers_h", "xi_newcomers_a",
    "xi_top3_present_h", "xi_top3_present_a", "xi_top3_present_diff",
]


def brier(p: Sequence[float], idx: int) -> float:
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def load_lineups(conn: sqlite3.Connection) -> Dict[str, Dict[int, List[int]]]:
    """match_id -> team_id -> [player_id] for starters only."""
    out: Dict[str, Dict[int, List[int]]] = defaultdict(lambda: defaultdict(list))
    for r in conn.execute(
            "SELECT match_id, team_id, player_id FROM lineups WHERE is_starter = 1"):
        out[r[0]][int(r[1])].append(int(r[2]))
    return out


def load_player_minutes(conn: sqlite3.Connection) -> Dict[str, Dict[int, Tuple[int, int, int]]]:
    """match_id -> player_id -> (minutes, goals, assists)."""
    out: Dict[str, Dict[int, Tuple[int, int, int]]] = defaultdict(dict)
    for r in conn.execute("SELECT match_id, player_id, minutes, goals, assists "
                          "FROM player_match_stats"):
        out[r[0]][int(r[1])] = (int(r[2] or 0), int(r[3] or 0), int(r[4] or 0))
    return out


def build_lineup_features(rows: Sequence[sqlite3.Row],
                          lineups: Dict[str, Dict[int, List[int]]],
                          stats: Dict[str, Dict[int, Tuple[int, int, int]]]
                          ) -> Tuple[np.ndarray, np.ndarray]:
    """One chronological pass. Returns (features, has_lineup_mask).

    Career totals and each team's recent XIs are updated only AFTER the row
    for a match has been emitted, which is what makes every value strictly
    pre-match.
    """
    apps: Counter = Counter()          # player -> appearances so far
    contrib: Counter = Counter()       # player -> goals + assists so far
    recent_xis: Dict[int, deque] = defaultdict(lambda: deque(maxlen=6))
    starts_for: Dict[int, Counter] = defaultdict(Counter)  # team -> player -> starts

    feats: List[List[float]] = []
    present: List[bool] = []

    for row in rows:
        mid = row["match_id"]
        per_team = lineups.get(mid) or {}
        h_xi = per_team.get(int(row["home_team_id"]), [])
        a_xi = per_team.get(int(row["away_team_id"]), [])

        if len(h_xi) >= 11 and len(a_xi) >= 11:
            vals = []
            for team_id, xi in ((int(row["home_team_id"]), h_xi),
                                (int(row["away_team_id"]), a_xi)):
                vals.append(_team_block(team_id, xi, apps, contrib,
                                        recent_xis, starts_for))
            (ch, eh, oh, nh, th), (ca, ea, oa, na, ta) = vals
            feats.append([ch, ca, ch - ca, eh, ea, eh - ea, oh, oa, oh - oa,
                          nh, na, th, ta, th - ta])
            present.append(True)
        else:
            feats.append([np.nan] * len(LINEUP_FEATURES))
            present.append(False)

        # --- update state with this match, after emitting its features ---
        ms = stats.get(mid) or {}
        for team_id, xi in ((int(row["home_team_id"]), h_xi),
                            (int(row["away_team_id"]), a_xi)):
            if not xi:
                continue
            recent_xis[team_id].append(set(xi))
            for p in xi:
                apps[p] += 1
                starts_for[team_id][p] += 1
                _, g, a = ms.get(p, (0, 0, 0))
                contrib[p] += g + a

    return np.asarray(feats, dtype=np.float64), np.asarray(present, dtype=bool)


def _team_block(team_id: int, xi: Sequence[int], apps: Counter, contrib: Counter,
                recent_xis: Dict[int, deque], starts_for: Dict[int, Counter]
                ) -> Tuple[float, float, float, float, float]:
    xi_set = set(xi)

    # Continuity: how much of the recent regular eleven is out there today.
    prev = recent_xis.get(team_id)
    if prev:
        counts: Counter = Counter()
        for s in prev:
            counts.update(s)
        usual = {p for p, _ in counts.most_common(11)}
        continuity = len(xi_set & usual) / 11.0
    else:
        continuity = np.nan

    experience = float(np.mean([apps[p] for p in xi]))
    # Output per appearance, so a debutant scores 0 rather than dividing by 0.
    output = float(np.mean([contrib[p] / apps[p] if apps[p] else 0.0 for p in xi]))
    newcomers = float(sum(1 for p in xi if apps[p] < 3))

    # Are this club's three most-used players starting? The closest thing the
    # warehouse has to "is the star injured".
    top3 = [p for p, _ in starts_for[team_id].most_common(3)]
    top3_present = float(sum(1 for p in top3 if p in xi_set)) if top3 else np.nan

    return continuity, experience, output, newcomers, top3_present


def evaluate(X: np.ndarray, y: np.ndarray, seasons: np.ndarray,
             test_seasons: Sequence[int]) -> Tuple[np.ndarray, np.ndarray]:
    """Rolling origin. Returns (per-row Brier, scored mask)."""
    from sklearn.base import clone
    from sklearn.ensemble import HistGradientBoostingClassifier

    model = HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.05, max_depth=3, l2_regularization=1.0,
        early_stopping=True, validation_fraction=0.15, random_state=17)

    scores = np.full(len(y), np.nan)
    for s in test_seasons:
        tr = np.flatnonzero(seasons < s)
        te = np.flatnonzero(seasons == s)
        if len(tr) < 2000 or not len(te):
            continue
        m = clone(model)
        m.fit(X[tr], y[tr])
        proba = m.predict_proba(X[te])
        for j, i in enumerate(te):
            scores[i] = brier(proba[j], int(y[i]))
    return scores, ~np.isnan(scores)


def paired_bootstrap(a: np.ndarray, b: np.ndarray, n: int = 4000,
                     seed: int = 17) -> Dict[str, float]:
    """P(with-lineups is better), on the SAME fixtures both models scored."""
    rng = np.random.default_rng(seed)
    diff = a - b
    idx = rng.integers(0, len(diff), size=(n, len(diff)))
    means = diff[idx].mean(axis=1)
    return {
        "mean_delta": float(diff.mean()),
        "ci_low": float(np.percentile(means, 2.5)),
        "ci_high": float(np.percentile(means, 97.5)),
        "p_better": float((means < 0).mean()),
    }


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--min-season", type=int, default=2015)
    ap.add_argument("--test-from", type=int, default=2019)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")

    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]
    rows = load_matches(conn, comps)
    logger.info("%d matches loaded", len(rows))

    Xpi, y, _ = build_pi_features(rows)
    logger.info("building lineup features over %d matches...", len(rows))
    Xlu, has_lineup = build_lineup_features(rows, load_lineups(conn),
                                            load_player_minutes(conn))
    logger.info("lineups present for %d of %d matches (%.1f%%)",
                has_lineup.sum(), len(rows), 100.0 * has_lineup.mean())

    seasons = np.array([int(r["season"] or 0) for r in rows])
    # Only matches that HAVE a lineup can answer the question. Comparing a
    # with-lineups model on 18,939 matches against a without-lineups model on
    # 38,000 would be comparing two different corpora and calling it an
    # ablation.
    keep = has_lineup & (seasons >= args.min_season)
    Xpi, Xlu, y, seasons = Xpi[keep], Xlu[keep], y[keep], seasons[keep]
    logger.info("scoring corpus: %d matches, seasons %d-%d",
                len(y), seasons.min(), seasons.max())

    test_seasons = sorted({int(s) for s in seasons if s >= args.test_from})
    base_s, base_m = evaluate(np.nan_to_num(Xpi, nan=0.0), y, seasons, test_seasons)
    full = np.hstack([Xpi, Xlu])
    lu_s, lu_m = evaluate(np.nan_to_num(full, nan=0.0), y, seasons, test_seasons)

    both = base_m & lu_m
    logger.info("\nscored on %d fixtures (%s-%s)", int(both.sum()),
                test_seasons[0], test_seasons[-1])
    logger.info("  ratings only        brier %.5f", base_s[both].mean())
    logger.info("  ratings + lineups   brier %.5f", lu_s[both].mean())

    boot = paired_bootstrap(lu_s[both], base_s[both])
    logger.info("  delta %+.5f  95%% CI [%+.5f, %+.5f]  p(lineups better) = %.3f",
                boot["mean_delta"], boot["ci_low"], boot["ci_high"], boot["p_better"])
    verdict = ("lineups help" if boot["ci_high"] < 0 else
               "lineups hurt" if boot["ci_low"] > 0 else
               "no measurable effect")
    logger.info("  verdict: %s", verdict)

    # --- which lineup feature, if any, carried anything ---------------------
    from sklearn.base import clone
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.inspection import permutation_importance

    split = test_seasons[len(test_seasons) // 2]
    tr, te = np.flatnonzero(seasons < split), np.flatnonzero(seasons >= split)
    m = clone(HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.05, max_depth=3, l2_regularization=1.0,
        early_stopping=True, validation_fraction=0.15, random_state=17))
    Xn = np.nan_to_num(full, nan=0.0)
    m.fit(Xn[tr], y[tr])
    perm = permutation_importance(m, Xn[te], y[te], n_repeats=8, random_state=17,
                                  scoring="neg_log_loss", n_jobs=-1)
    offset = Xpi.shape[1]
    imp = sorted(({"feature": LINEUP_FEATURES[i],
                   "importance": round(float(perm.importances_mean[offset + i]), 5),
                   "std": round(float(perm.importances_std[offset + i]), 5)}
                  for i in range(len(LINEUP_FEATURES))),
                 key=lambda d: -d["importance"])
    logger.info("\npermutation importance, lineup block only:")
    for e in imp:
        logger.info("  %-22s %+.5f ± %.5f", e["feature"], e["importance"], e["std"])

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "corpus": "matches WITH a recorded starting XI only, so both arms "
                      "score the same fixtures",
            "split": "rolling origin by season",
            "servable": "every feature is computed from the starting XI, which "
                        "the scraper already fetches ~1h before kickoff",
            "leakage": "player totals and the reference XI accumulate strictly "
                       "before each match",
        },
        "n_scored": int(both.sum()),
        "test_seasons": test_seasons,
        "brier": {"ratings_only": round(float(base_s[both].mean()), 5),
                  "ratings_plus_lineups": round(float(lu_s[both].mean()), 5)},
        "paired_bootstrap": {k: round(v, 5) for k, v in boot.items()},
        "verdict": verdict,
        "permutation_importance": imp,
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", op)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
