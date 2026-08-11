"""Score the forecasts we actually published, against what actually happened.

The distinction this module exists to protect
---------------------------------------------
There are two evaluations in this repository and conflating them would be the
single most misleading thing the product could do:

  HISTORICAL WALK-FORWARD   Brier .59303 over 43,433 matches. Honest, large,
                            and retrospective: the model was refit as the
                            corpus advanced, but no user ever saw those
                            numbers before those kickoffs.

  LIVE PUBLISHED            The final pre-kickoff snapshot for each fixture,
                            scored after the result lands. Small — it starts
                            at zero and grows a few hundred a month — and it
                            is the only evaluation of forecasts anyone could
                            have acted on.

They are computed here by different functions, carry a `basis` field, and are
never summed. A live sample of 40 matches is not evidence of anything, and the
right response to that is to say `n=40`, not to pad it with history.

Only `final_before_kickoff` snapshots are scored: strictly the last forecast
generated before the match started. Scoring every snapshot would weight a
fixture by how many times the job happened to run, and scoring the first one
would grade a week-old forecast that nobody was still being shown.
"""
from __future__ import annotations

import logging
import math
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger("forecast.evaluate")

ROOT = Path(__file__).resolve().parent.parent.parent.parent
WAREHOUSE = ROOT / "backend" / "data" / "warehouse.sqlite"

OUTCOMES = ("H", "D", "A")


def _result(hs: int, as_: int) -> str:
    return "H" if hs > as_ else ("A" if hs < as_ else "D")


def join_results(snapshots: Sequence[Dict[str, Any]],
                 db: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Attach the actual result to each snapshot, where one exists yet.

    Matched on competition, date and both club names normalised the same way
    the canonical layer normalises them. A fixture with no result is DROPPED,
    not defaulted — a forecast for a match that has not happened contributes
    nothing to a score, and inventing a row for it is fabrication.
    """
    from backend.scripts.build_canonical import norm_team

    conn = sqlite3.connect(f"file:{db or WAREHOUSE}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    index: Dict[tuple, sqlite3.Row] = {}
    for r in conn.execute("""
        SELECT m.competition_id, m.date_utc, m.home_score, m.away_score,
               ht.canonical_name AS home, awy.canonical_name AS away
          FROM matches m
          JOIN teams ht ON ht.team_id = m.home_team_id
          JOIN teams awy ON awy.team_id = m.away_team_id
         WHERE m.home_score IS NOT NULL"""):
        key = (r["competition_id"], r["date_utc"][:10],
               norm_team(r["home"]), norm_team(r["away"]))
        index[key] = r
    conn.close()

    out: List[Dict[str, Any]] = []
    for s in snapshots:
        day = s["kickoff_at"][:10]
        hn, an = norm_team(s["home_team"]), norm_team(s["away_team"])
        row = None
        # +/- one day: kickoff instants and stored match dates disagree by a
        # timezone for some sources, and a fixture is not two fixtures.
        for d in (day, _shift(day, -1), _shift(day, 1)):
            row = index.get((s["competition_id"], d, hn, an))
            if row is not None:
                break
        if row is None:
            continue
        enriched = dict(s)
        enriched["home_score"] = int(row["home_score"])
        enriched["away_score"] = int(row["away_score"])
        enriched["result"] = _result(enriched["home_score"], enriched["away_score"])
        out.append(enriched)
    return out


def _shift(day: str, days: int) -> str:
    from datetime import date, timedelta

    y, m, d = (int(x) for x in day.split("-"))
    return (date(y, m, d) + timedelta(days=days)).isoformat()


def _core(rows: Sequence[Dict[str, Any]]) -> Dict[str, float]:
    """Brier, log loss and accuracy on one sample.

    Split out from `score` because `score` computes per-league and per-version
    breakdowns, and calling itself to do that recursed forever the moment a
    sample contained exactly one league — which is the normal case.
    """
    n = len(rows)
    P = [[r["p_home"], r["p_draw"], r["p_away"]] for r in rows]
    Y = [OUTCOMES.index(r["result"]) for r in rows]
    brier = sum(sum((p[k] - (1.0 if k == y else 0.0)) ** 2 for k in range(3))
                for p, y in zip(P, Y)) / n
    logloss = sum(-math.log(max(p[y], 1e-15)) for p, y in zip(P, Y)) / n
    acc = sum(1 for p, y in zip(P, Y) if max(range(3), key=lambda k: p[k]) == y) / n
    return {"brier": round(brier, 5), "log_loss": round(logloss, 5),
            "accuracy": round(acc, 5)}


def score(rows: Sequence[Dict[str, Any]], *, basis: str,
          bins: int = 10) -> Dict[str, Any]:
    """Brier, log loss, calibration and the breakdowns, on one sample.

    `basis` is required and is carried into the output because every consumer
    of this number has to know whether it describes a retrospective backtest
    or forecasts that were actually published.
    """
    if not rows:
        return {"basis": basis, "n": 0,
                "note": "no scored fixtures yet — nothing has both a published "
                        "forecast and a result"}

    P, Y = [], []
    for r in rows:
        P.append([r["p_home"], r["p_draw"], r["p_away"]])
        Y.append(OUTCOMES.index(r["result"]))

    n = len(rows)
    core = _core(rows)

    # Reliability over every (fixture, outcome) pair: each is one forecast of a
    # binary event, which is what calibration actually measures.
    flat = [(p[k], 1.0 if k == y else 0.0) for p, y in zip(P, Y) for k in range(3)]
    buckets: List[Dict[str, Any]] = []
    ece = 0.0
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        sel = [(s, o) for s, o in flat
               if (lo <= s < hi) or (i == bins - 1 and s == 1.0)]
        if not sel:
            continue
        stated = sum(s for s, _ in sel) / len(sel)
        observed = sum(o for _, o in sel) / len(sel)
        buckets.append({"bin_low": round(lo, 2), "bin_high": round(hi, 2),
                        "n": len(sel), "stated": round(stated, 4),
                        "observed": round(observed, 4)})
        ece += (len(sel) / len(flat)) * abs(stated - observed)

    # Goal-rate error, only where a lambda was recorded.
    xg_rows = [r for r in rows if r.get("lambda_home") is not None]
    xg_mae = (sum(abs(r["lambda_home"] - r["home_score"])
                  + abs(r["lambda_away"] - r["away_score"])
                  for r in xg_rows) / (2 * len(xg_rows))) if xg_rows else None

    # How likely did we say the score that actually happened was? Only
    # available where the top scoreline was stored, so it is reported as a
    # hit-rate on that single cell rather than as a full likelihood.
    top_hits = [r for r in rows if r.get("top_scoreline")]
    top_hit_rate = (sum(1 for r in top_hits
                        if r["top_scoreline"] == f"{r['home_score']}-{r['away_score']}")
                    / len(top_hits)) if top_hits else None

    by_league: Dict[str, Dict[str, Any]] = {}
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        grouped[r["competition_id"]].append(r)
    for comp, rs in grouped.items():
        if len(rs) < 10:
            by_league[comp] = {"n": len(rs), "brier": None,
                               "note": "fewer than 10 scored fixtures"}
            continue
        by_league[comp] = {"n": len(rs), **_core(rs)}

    by_version: Dict[str, Dict[str, Any]] = {}
    vgrouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        vgrouped[r.get("model_version", "unknown")].append(r)
    for ver, rs in vgrouped.items():
        by_version[ver] = ({"n": len(rs), "brier": None,
                            "note": "fewer than 10 scored fixtures"}
                           if len(rs) < 10 else
                           {"n": len(rs), **_core(rs)})

    return {
        "basis": basis,
        "n": n,
        **core,
        "ece": round(ece, 5),
        "reliability": buckets,
        "xg_mae": round(xg_mae, 4) if xg_mae is not None else None,
        "top_scoreline_hit_rate": (round(top_hit_rate, 4)
                                   if top_hit_rate is not None else None),
        "by_league": by_league,
        "by_model_version": by_version,
        "first_kickoff": min(r["kickoff_at"] for r in rows),
        "last_kickoff": max(r["kickoff_at"] for r in rows),
    }


def baselines(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """What the same fixtures score under forecasts that know nothing.

    A Brier of .59 means nothing on its own; it means something against .667
    for a uniform guess on the same matches. Computed on the identical sample
    so the comparison is paired.
    """
    if not rows:
        return {}
    Y = [OUTCOMES.index(r["result"]) for r in rows]
    n = len(Y)
    uni = sum(sum((1 / 3 - (1.0 if k == y else 0.0)) ** 2 for k in range(3))
              for y in Y) / n
    counts = [sum(1 for y in Y if y == k) / n for k in range(3)]
    base = sum(sum((counts[k] - (1.0 if k == y else 0.0)) ** 2 for k in range(3))
               for y in Y) / n
    return {"uniform": round(uni, 5),
            "sample_base_rate": round(base, 5),
            "note": "sample_base_rate is computed ON this sample and is "
                    "therefore optimistic; it is a floor, not a competitor"}
