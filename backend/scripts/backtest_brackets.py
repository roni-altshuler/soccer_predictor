"""Simulate whole brackets, and check who the model said would lift the trophy.

Why a separate backtest
-----------------------
Getting 66% of ties right and getting the champion right are different claims.
A tournament is a product of four or five ties: a side the model likes at 70%
per round is only a 24% champion, and a favourite that survives the first round
by luck can still win the thing. The only way to turn per-tie probabilities
into a title probability is to run the bracket.

How the bracket is reconstructed
--------------------------------
Nobody stores a bracket tree, but it can be recovered from the results: for
each quarter-final, the two teams each arrived from a specific round-of-16
tie, so that quarter-final is the parent of those two. Doing this round by
round rebuilds the tree exactly as it was played.

One honest caveat, stated because it changes what the number means: UEFA drew
the Champions League quarter-finals and semi-finals OPEN until 2023-24 — the
bracket was not fixed when the round of 16 began. The reconstruction uses the
bracket that actually happened, so a simulated run sends the winner of tie i
to meet the winner of tie j because that is who really met. For fixed brackets
(World Cup, Euros, and UEFA from 2024) this is exact. For the open-draw years
it holds the draw constant instead of re-drawing it, which understates the
spread slightly and is noted rather than hidden.

Yardsticks
----------
    uniform            every surviving team equally likely — the floor
    highest-rated      the pre-tournament Elo leader, as a point pick
    Elo simulation     same bracket, probabilities straight from the Elo
                       formula with nothing fitted
    this model         the trained tie model

Scored by log loss on the champion (the metric that punishes confident misses),
plus how often the model's favourite actually won it.

    python3 -m backend.scripts.backtest_brackets --sims 20000

Writes backend/data/diagnostics/bracket_backtest.json.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.benchmark_knockout import (  # noqa: E402
    FEATURES,
    History,
    build_matrix,
    pedigree,
)
from backend.services.tournament import ratings as R  # noqa: E402
from backend.services.tournament import ties as T  # noqa: E402
from backend.services.tournament.rounds import QUALIFYING, classify  # noqa: E402

logger = logging.getLogger("backtest_brackets")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "bracket_backtest.json"


def rounds_in_order(ties: Sequence[T.Tie]) -> List[Tuple[str, List[T.Tie]]]:
    by_round: Dict[str, List[T.Tie]] = defaultdict(list)
    for t in ties:
        by_round[t.round_slug].append(t)
    order = sorted(by_round, key=lambda r: min(x.date_utc for x in by_round[r]))
    return [(r, by_round[r]) for r in order]


def bracket_tree(rounds: List[Tuple[str, List[T.Tie]]]) -> Optional[List[List[Dict]]]:
    """Rebuild the tree from the results.

    Returns a list of rounds; each round is a list of nodes, each node being
    either a real tie (with its two feeder indices from the previous round) or
    None when the pairing cannot be traced. Returns None when the shape does
    not halve cleanly — a malformed or partial bracket is refused rather than
    simulated as if it were whole.
    """
    if len(rounds) < 2:
        return None
    sizes = [len(r[1]) for r in rounds]

    # The bracket is the longest run of rounds that halves cleanly and ends in
    # one tie. Taking the whole list instead loses 24 of 37 tournaments: the
    # Europa League bolts a 16-tie knockout play-off round onto a 16-tie round
    # of 32, and the Champions League has done the same since 2024. Those are
    # entry rounds, not bracket rounds — the model still predicts them as ties,
    # they just are not part of the tree that decides the trophy.
    if sizes[-1] != 1:
        return None
    start = len(sizes) - 1
    while start > 0 and sizes[start - 1] == sizes[start] * 2:
        start -= 1
    rounds = rounds[start:]
    if len(rounds) < 2:
        return None

    tree: List[List[Dict]] = [[{"tie": t, "feeders": None} for t in rounds[0][1]]]
    for depth in range(1, len(rounds)):
        prev = rounds[depth - 1][1]
        # Which previous tie did each team come out of?
        source: Dict[int, int] = {}
        for i, t in enumerate(prev):
            source[t.team_a] = i
            source[t.team_b] = i
        nodes = []
        for t in rounds[depth][1]:
            fa, fb = source.get(t.team_a), source.get(t.team_b)
            if fa is None or fb is None or fa == fb:
                return None
            nodes.append({"tie": t, "feeders": (fa, fb)})
        tree.append(nodes)
    return tree


def tie_features(team_a: int, team_b: int, template: T.Tie, elo: R.EloTable,
                 hist: History, ped: Dict) -> np.ndarray:
    """Features for a hypothetical pairing, using the real round's date and
    format. Every value is read strictly before that round kicked off, so a
    simulated later round cannot see its own result."""
    d = template.date_utc
    ea = elo.rating_before(team_a, d)
    eb = elo.rating_before(team_b, d)
    if ea is None:
        ea = R.BASE
    if eb is None:
        eb = R.BASE
    neutral = (template.competition_id in R.NEUTRAL_COMPETITIONS
               or (not template.two_legged and template.round_slug == "final"))
    hfa = 0.0 if neutral else R.EloConfig().home_advantage
    exp_a = 1.0 / (1.0 + 10 ** ((eb - (ea + hfa)) / 400.0))
    _, fa, ga = hist.window(team_a, d, 10)
    _, fb, gb = hist.window(team_b, d, 10)
    comp, season = template.competition_id, template.season
    pa = ped.get((team_a, comp, season), 0)
    pb = ped.get((team_b, comp, season), 0)
    return np.array([
        ea, eb, ea - eb, exp_a,
        elo.matches_before(team_a, d), elo.matches_before(team_b, d),
        fa, fb, fa - fb, ga, gb, ga - gb,
        hist.rest_days(team_a, d), hist.rest_days(team_b, d),
        1.0 if template.two_legged else 0.0,
        1.0 if neutral else 0.0,
        math.log2(max(2, template.teams_remaining)),
        pa, pb, pa - pb,
        hist.h2h(team_a, team_b, d),
    ], dtype=np.float64)


def simulate(tree: List[List[Dict]], predict, elo: R.EloTable, hist: History,
             ped: Dict, sims: int, rng: np.random.Generator) -> Dict[int, float]:
    """Monte-Carlo the bracket. Returns team_id -> P(champion)."""
    n_first = len(tree[0])
    first_pairs = [(n["tie"].team_a, n["tie"].team_b) for n in tree[0]]

    # Every pairing the bracket can ever produce is enumerable in advance:
    # at each node the two sides can only be teams from its two feeder
    # subtrees. A 16-team bracket has 112 reachable pairings in total, so all
    # of them are scored in ONE batched predict instead of a model call per
    # simulation. Lazily caching inside the loop instead turned a two-second
    # job into a twenty-minute one.
    reach: List[List[List[int]]] = [[[a, b] for a, b in first_pairs]]
    for depth in range(1, len(tree)):
        row = []
        for node in tree[depth]:
            fa, fb = node["feeders"]
            row.append(sorted(set(reach[depth - 1][fa]) | set(reach[depth - 1][fb])))
        reach.append(row)

    index: List[List[Dict[Tuple[int, int], int]]] = []
    feats: List[np.ndarray] = []
    for depth, nodes in enumerate(tree):
        per_node = []
        for j, node in enumerate(nodes):
            m: Dict[Tuple[int, int], int] = {}
            if depth == 0:
                a, b = first_pairs[j]
                m[(a, b)] = len(feats)
                feats.append(tie_features(a, b, node["tie"], elo, hist, ped))
            else:
                fa, fb = node["feeders"]
                for a in reach[depth - 1][fa]:
                    for b in reach[depth - 1][fb]:
                        m[(a, b)] = len(feats)
                        feats.append(tie_features(a, b, node["tie"], elo, hist, ped))
            per_node.append(m)
        index.append(per_node)

    probs = np.asarray(predict(np.vstack(feats)), dtype=np.float64)

    titles: Dict[int, int] = defaultdict(int)
    for _ in range(sims):
        draws = rng.random(n_first)
        survivors = [a if draws[i] < probs[index[0][i][(a, b)]] else b
                     for i, (a, b) in enumerate(first_pairs)]
        for depth in range(1, len(tree)):
            nxt: List[int] = []
            for j, node in enumerate(tree[depth]):
                fa, fb = node["feeders"]
                a, b = survivors[fa], survivors[fb]
                p = probs[index[depth][j][(a, b)]]
                nxt.append(a if rng.random() < p else b)
            survivors = nxt
        titles[survivors[0]] += 1
    return {k: v / sims for k, v in titles.items()}


def _log_loss(p: float) -> float:
    return -math.log(max(p, 1e-6))


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competitions",
                    default="uefa.champions,uefa.europa,fifa.world,uefa.euro,"
                            "conmebol.america,conmebol.libertadores,"
                            "conmebol.sudamericana,caf.nations,afc.asian,"
                            "concacaf.gold,uefa.conference,fifa.cwc")
    ap.add_argument("--min-season", type=int, default=2005)
    ap.add_argument("--test-from", type=int, default=2013)
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")

    have = {r[0] for r in conn.execute("SELECT DISTINCT competition_id FROM matches")}
    comps = [c.strip() for c in args.competitions.split(",")
             if c.strip() and c.strip() in have]
    logger.info("competitions: %s", ", ".join(comps))

    elo = R.build(conn)
    hist = History.build(conn)
    all_ties = T.build(conn, comps, include_qualifying=True, min_season=args.min_season)
    ped = pedigree(all_ties)
    main_draw = [t for t in all_ties if classify(t.round_slug) != QUALIFYING]

    X, y, kept = build_matrix(main_draw, elo, hist, ped)
    seasons = np.array([t.season for t in kept])

    from sklearn.base import clone
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import make_pipeline

    template = make_pipeline(
        SimpleImputer(strategy="median"),
        RandomForestClassifier(n_estimators=600, min_samples_leaf=25,
                               n_jobs=-1, random_state=17))

    # group ties by tournament-season
    by_event: Dict[Tuple[str, int], List[T.Tie]] = defaultdict(list)
    for t in main_draw:
        by_event[(t.competition_id, t.season)].append(t)

    rng = np.random.default_rng(args.seed)
    events: List[Dict] = []
    skipped: Dict[str, int] = defaultdict(int)
    fitted_for_season: Dict[int, object] = {}

    for (comp, season), group in sorted(by_event.items(), key=lambda kv: kv[0][1]):
        if season < args.test_from:
            continue
        rounds = rounds_in_order(group)
        tree = bracket_tree(rounds)
        if tree is None:
            skipped[f"{comp}: bracket not reconstructable"] += 1
            continue
        champion = rounds[-1][1][0].winner
        if champion is None:
            skipped[f"{comp}: final unresolved"] += 1
            continue

        model = fitted_for_season.get(season)
        if model is None:
            tr = np.flatnonzero(seasons < season)
            if len(tr) < 200:
                skipped[f"{comp}: too little history"] += 1
                continue
            model = clone(template)
            model.fit(X[tr], y[tr])
            fitted_for_season[season] = model

        field = sorted({tid for n in tree[0] for tid in (n["tie"].team_a, n["tie"].team_b)})
        uniform = 1.0 / len(field)

        model_p = simulate(tree, lambda M: model.predict_proba(M)[:, 1],
                           elo, hist, ped, args.sims, rng)
        elo_only = simulate(tree,
                            lambda M: M[:, FEATURES.index("elo_expected_a")],
                            elo, hist, ped, args.sims, rng)

        entry_date = tree[0][0]["tie"].date_utc
        elo_leader = max(field, key=lambda t: elo.rating_before(t, entry_date) or 0.0)

        events.append({
            "competition": comp, "season": season,
            "field": len(field), "champion": champion,
            "model_p": round(model_p.get(champion, 0.0), 5),
            "elo_p": round(elo_only.get(champion, 0.0), 5),
            "uniform_p": round(uniform, 5),
            "model_favourite": max(model_p, key=model_p.get) if model_p else None,
            "model_favourite_p": round(max(model_p.values()), 4) if model_p else None,
            "elo_leader": elo_leader,
            "model_top1_hit": int(bool(model_p) and max(model_p, key=model_p.get) == champion),
            "elo_leader_hit": int(elo_leader == champion),
            "model_top3_hit": int(champion in sorted(model_p, key=model_p.get, reverse=True)[:3]),
        })
        logger.info("  %-24s %d  field %2d  champion p=%.3f (elo %.3f, uniform %.3f)%s",
                    comp, season, len(field), events[-1]["model_p"],
                    events[-1]["elo_p"], uniform,
                    "  <- called it" if events[-1]["model_top1_hit"] else "")

    if not events:
        logger.error("no brackets could be reconstructed")
        return 1

    def agg(key: str) -> float:
        return float(np.mean([_log_loss(e[key]) for e in events]))

    summary = {
        "n_tournaments": len(events),
        "log_loss": {"model": round(agg("model_p"), 4),
                     "elo_simulation": round(agg("elo_p"), 4),
                     "uniform": round(agg("uniform_p"), 4)},
        "top1_hit_rate": {
            "model": round(float(np.mean([e["model_top1_hit"] for e in events])), 4),
            "highest_rated": round(float(np.mean([e["elo_leader_hit"] for e in events])), 4),
        },
        "top3_hit_rate": {
            "model": round(float(np.mean([e["model_top3_hit"] for e in events])), 4)},
        "mean_probability_on_actual_champion": {
            "model": round(float(np.mean([e["model_p"] for e in events])), 4),
            "elo_simulation": round(float(np.mean([e["elo_p"] for e in events])), 4),
            "uniform": round(float(np.mean([e["uniform_p"] for e in events])), 4)},
    }

    logger.info("\n%d tournaments simulated (%d runs each)", len(events), args.sims)
    logger.info("log loss on the actual champion (lower is better)")
    for k, v in summary["log_loss"].items():
        logger.info("  %-16s %.4f", k, v)
    logger.info("picked the eventual champion outright:")
    logger.info("  model            %.1f%%", summary["top1_hit_rate"]["model"] * 100)
    logger.info("  highest-rated    %.1f%%", summary["top1_hit_rate"]["highest_rated"] * 100)
    logger.info("  model, top 3     %.1f%%", summary["top3_hit_rate"]["model"] * 100)
    if skipped:
        logger.info("skipped: %s", dict(skipped))

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "sims": args.sims,
            "bracket": "reconstructed from who actually met whom; UEFA drew the "
                       "quarter-finals and semi-finals openly before 2023-24, so "
                       "for those seasons the draw is held fixed rather than redrawn",
            "model": "random forest over tie features, refit on every season "
                     "strictly before the tournament being simulated",
        },
        "summary": summary,
        "events": events,
        "skipped": dict(skipped),
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", op)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
