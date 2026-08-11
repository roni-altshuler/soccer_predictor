"""Forward tournament forecasts: who wins the one that has not finished yet.

The tennis-video shape, applied honestly
----------------------------------------
Green Code's Wimbledon workflow trains on every previous tournament and then
names a winner for the one about to be played. That transfers here, with one
condition that must not be quietly dropped: **you can only forecast a field you
know.** A tournament whose draw has not been made has no field, and inventing a
plausible one — last year's entrants, say — would produce a confident-looking
table with nothing behind it.

So every competition lands in exactly one of three states, and the state is
reported rather than hidden:

  live            knockout matches remain. The resolved ties are fixed, the
                  rest are simulated, and the champion distribution is a real
                  forecast of an undecided event.
  awaiting_draw   the last edition is finished and the next has no bracket
                  yet. No title odds. What IS shown is the strength table of
                  the teams most likely to be involved, from the same ratings,
                  clearly labelled as a power ranking and not a forecast.
  completed       there is nothing left to predict, so the page shows what the
                  model said BEFORE the knockout stage began — refit on prior
                  seasons only — next to who actually won. That is the honest
                  way to show a finished tournament: the call, then the result.

Every probability comes from the same model `benchmark_knockout` measures, refit
on seasons strictly earlier than the one being forecast. Nothing here is fitted
on a match it then predicts.

    python3 -m backend.scripts.predict_tournaments
    python3 -m backend.scripts.predict_tournaments --sims 40000

Writes backend/data/predictions/tournaments.json.
"""
from __future__ import annotations

import argparse
import json
import logging
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

from backend.scripts.backtest_brackets import (  # noqa: E402
    bracket_tree,
    rounds_in_order,
    simulate,
    tie_features,
)
from backend.scripts.benchmark_knockout import (  # noqa: E402
    History,
    build_matrix,
    pedigree,
)
from backend.services.tournament import ratings as R  # noqa: E402
from backend.services.tournament import ties as T  # noqa: E402
from backend.services.tournament.rounds import QUALIFYING, classify  # noqa: E402

logger = logging.getLogger("predict_tournaments")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "predictions" / "tournaments.json"

COMPETITIONS: Dict[str, Dict[str, str]] = {
    "uefa.champions": {"name": "UEFA Champions League", "region": "Europe"},
    "uefa.europa": {"name": "UEFA Europa League", "region": "Europe"},
    "uefa.conference": {"name": "UEFA Conference League", "region": "Europe"},
    "uefa.euro": {"name": "UEFA European Championship", "region": "Europe"},
    "uefa.nations": {"name": "UEFA Nations League", "region": "Europe"},
    "fifa.world": {"name": "FIFA World Cup", "region": "World"},
    "fifa.cwc": {"name": "FIFA Club World Cup", "region": "World"},
    "conmebol.america": {"name": "Copa América", "region": "South America"},
    "conmebol.libertadores": {"name": "Copa Libertadores", "region": "South America"},
    "conmebol.sudamericana": {"name": "Copa Sudamericana", "region": "South America"},
    "caf.nations": {"name": "Africa Cup of Nations", "region": "Africa"},
    "afc.asian": {"name": "AFC Asian Cup", "region": "Asia"},
    "concacaf.gold": {"name": "CONCACAF Gold Cup", "region": "North America"},
    "concacaf.champions": {"name": "CONCACAF Champions Cup", "region": "North America"},
}


def team_names(conn: sqlite3.Connection) -> Dict[int, str]:
    return {int(r[0]): r[1] for r in conn.execute(
        "SELECT team_id, canonical_name FROM teams")}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sims", type=int, default=20000)
    ap.add_argument("--min-season", type=int, default=2005)
    ap.add_argument("--seed", type=int, default=17)
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")

    have = {r[0] for r in conn.execute("SELECT DISTINCT competition_id FROM matches")}
    comps = [c for c in COMPETITIONS if c in have]
    logger.info("competitions: %s", ", ".join(comps))

    names = team_names(conn)
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

    by_event: Dict[Tuple[str, int], List[T.Tie]] = defaultdict(list)
    for t in main_draw:
        by_event[(t.competition_id, t.season)].append(t)

    rng = np.random.default_rng(args.seed)
    fitted: Dict[int, object] = {}
    out: List[Dict] = []

    for comp in comps:
        seasons_present = sorted({s for (c, s) in by_event if c == comp})
        if not seasons_present:
            continue
        season = seasons_present[-1]
        group = by_event[(comp, season)]
        rounds = rounds_in_order(group)
        tree = bracket_tree(rounds)

        entry = {
            "competition_id": comp,
            "name": COMPETITIONS[comp]["name"],
            "region": COMPETITIONS[comp]["region"],
            "season": season,
            "last_match": max(t.legs[-1].date_utc for t in group)[:10],
        }

        unresolved = [t for t in group if t.winner is None]
        if tree is None:
            entry["status"] = "awaiting_draw"
            entry["reason"] = ("no bracket could be reconstructed for this edition, "
                               "so there is nothing to simulate")
            entry["power_ranking"] = _power_ranking(group, elo, names)
            out.append(entry)
            logger.info("  %-24s %d  awaiting_draw", comp, season)
            continue

        model = fitted.get(season)
        if model is None:
            tr = np.flatnonzero(seasons < season)
            if len(tr) < 200:
                entry["status"] = "insufficient_history"
                out.append(entry)
                continue
            model = clone(template)
            model.fit(X[tr], y[tr])
            fitted[season] = model

        champion_probs = simulate(tree, lambda M: model.predict_proba(M)[:, 1],
                                  elo, hist, ped, args.sims, rng)
        field = sorted({tid for n in tree[0]
                        for tid in (n["tie"].team_a, n["tie"].team_b)})
        final_tie = rounds[-1][1][0]
        actual = final_tie.winner

        entry["status"] = "live" if unresolved else "completed"
        entry["field"] = len(field)
        entry["forecast_made_at_round"] = tree[0][0]["tie"].round_label
        entry["forecast_from"] = tree[0][0]["tie"].date_utc[:10]
        entry["odds"] = [
            {"team_id": tid, "team": names.get(tid, str(tid)),
             "probability": round(p, 4),
             "elo": round(elo.rating_before(tid, tree[0][0]["tie"].date_utc) or R.BASE, 1)}
            for tid, p in sorted(champion_probs.items(), key=lambda kv: -kv[1])
        ]
        if entry["status"] == "completed" and actual is not None:
            entry["actual_champion"] = names.get(actual, str(actual))
            entry["actual_champion_id"] = actual
            entry["probability_on_actual"] = round(champion_probs.get(actual, 0.0), 4)
            entry["called_it"] = bool(entry["odds"] and entry["odds"][0]["team_id"] == actual)

        out.append(entry)
        top = entry["odds"][0] if entry["odds"] else None
        logger.info("  %-24s %d  %-13s field %2d  favourite %s %.1f%%%s",
                    comp, season, entry["status"], len(field),
                    (top["team"] if top else "-"),
                    100 * (top["probability"] if top else 0),
                    "  <- called it" if entry.get("called_it") else "")

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "model": "random forest over tie features, refit on seasons strictly "
                     "before the edition being forecast",
            "sims": args.sims,
            "states": {
                "live": "knockout matches remain; resolved ties fixed, the rest simulated",
                "completed": "nothing left to predict, so the forecast shown is the one "
                             "made before the knockout stage began, next to the result",
                "awaiting_draw": "no bracket yet — a power ranking, not a forecast",
            },
            "caveat": "UEFA drew the Champions League quarter-finals and semi-finals "
                      "openly before 2023-24; for those editions the bracket is held "
                      "fixed rather than redrawn",
        },
        "tournaments": out,
    }
    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(payload, indent=2))
    logger.info("\nwrote %s", op)
    return 0


def _power_ranking(group: Sequence[T.Tie], elo: R.EloTable,
                   names: Dict[int, str]) -> List[Dict]:
    """Ratings of the teams that reached the knockout stage.

    Explicitly NOT a forecast. Without a bracket there is no path to a
    trophy to simulate, and a rating is the most that can honestly be said.
    """
    when = max(t.legs[-1].date_utc for t in group)
    teams = {tid for t in group for tid in (t.team_a, t.team_b)}
    rated = [(tid, elo.rating_before(tid, when)) for tid in teams]
    rated = [(tid, r) for tid, r in rated if r is not None]
    rated.sort(key=lambda kv: -kv[1])
    return [{"team_id": tid, "team": names.get(tid, str(tid)), "elo": round(r, 1)}
            for tid, r in rated[:16]]


if __name__ == "__main__":
    raise SystemExit(main())
