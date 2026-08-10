"""Where the serving model actually sits, against yardsticks a reader would use.

The site's headline compared its hit rate to 1/3 — a home/draw/away pick made
at random. Nobody picks at random. Measured against that floor the model looks
19 points ahead; measured against "pick whoever is rated higher", which is
roughly what an informed fan does, it is ahead by 0.4. Both numbers are true
and only one of them is honest.

This produces the whole ladder from one walk of the warehouse, so the page can
state the model's position instead of a number chosen to flatter it:

    always pick the home team      the floor for a 1X2 pick
    pick the higher ClubElo side   informed gut feel
    the serving model              Dixon-Coles, refit monthly
    the closing line               the practical ceiling

Plus the calibration table, which is the model's real product: when it says
70%, how often does that happen? And the same ladder on decisive matches only,
because the model almost never predicts a draw and a reader deserves to know
that rather than discover it.

Everything is walk-forward: Dixon-Coles refits at the start of each calendar
month on matches strictly before it, and the Elo used is the last rating
published before kickoff.

    python3 -m backend.scripts.benchmark_baselines --since 2023-08-01

Writes backend/data/diagnostics/baseline_ladder.json.
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import penaltyblog as pb

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logger = logging.getLogger("benchmark_baselines")

DB = ROOT / "backend" / "data" / "warehouse.sqlite"
OUT = ROOT / "backend" / "data" / "diagnostics" / "baseline_ladder.json"
WAVE_A = ("eng.1", "esp.1", "ger.1", "ita.1", "fra.1")
DC_XI = 0.0018


def brier(p: Sequence[float], idx: int) -> float:
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def devig(oh: float, od: float, oa: float) -> List[float]:
    inv = [1.0 / oh, 1.0 / od, 1.0 / oa]
    s = sum(inv)
    return [x / s for x in inv]


def fit_dc(conn: sqlite3.Connection, comp: str, before: str):
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
        logger.warning("DC fit failed %s %s: %s", comp, before, exc)
        return None


def elo_index(conn: sqlite3.Connection) -> Dict[int, Tuple[List[str], List[float]]]:
    by_team: Dict[int, Tuple[List[str], List[float]]] = {}
    for r in conn.execute("SELECT team_id, date, elo FROM clubelo_ratings ORDER BY team_id, date"):
        d, e = by_team.setdefault(int(r[0]), ([], []))
        d.append(r[1])
        e.append(float(r[2]))
    return by_team


def elo_before(idx: Dict[int, Tuple[List[str], List[float]]], team_id: int,
               date: str) -> Optional[float]:
    entry = idx.get(team_id)
    if not entry:
        return None
    dates, elos = entry
    i = bisect.bisect_left(dates, date)
    return elos[i - 1] if i > 0 else None


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", default="2023-08-01", help="first kickoff to score")
    ap.add_argument("--leagues", default=",".join(WAVE_A))
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    if not DB.exists():
        logger.error("warehouse missing")
        return 2
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    comps = [c.strip() for c in args.leagues.split(",") if c.strip()]
    ph = ", ".join("?" * len(comps))

    rows = conn.execute(
        f"""SELECT m.date_utc, m.competition_id, m.home_team_id, m.away_team_id,
                   th.canonical_name AS home, ta.canonical_name AS away,
                   m.home_score AS hs, m.away_score AS a_s,
                   m.odds_home AS oh, m.odds_draw AS od, m.odds_away AS oa
            FROM matches m
            JOIN teams th ON th.team_id = m.home_team_id
            JOIN teams ta ON ta.team_id = m.away_team_id
            WHERE m.competition_id IN ({ph}) AND m.home_score IS NOT NULL
              AND m.date_utc >= ?
            ORDER BY m.date_utc""",
        tuple(comps) + (args.since,),
    ).fetchall()
    logger.info("candidate fixtures since %s: %d", args.since, len(rows))

    elo = elo_index(conn)
    dc_cache: Dict[Tuple[str, str], object] = {}

    hits: Dict[str, int] = defaultdict(int)
    n = 0
    elo_n = elo_hits = 0
    # Model confidence -> (count, wins), in ten-point bands.
    bands: Dict[int, List[int]] = defaultdict(lambda: [0, 0])
    pick_counts: Dict[int, List[int]] = {0: [0, 0], 1: [0, 0], 2: [0, 0]}
    truth = [0, 0, 0]
    briers: Dict[str, List[float]] = defaultdict(list)
    decisive = {"n": 0, "model": 0, "market": 0}

    for r in rows:
        oh, od, oa = r["oh"], r["od"], r["oa"]
        if None in (oh, od, oa) or min(oh, od, oa) <= 1.0:
            continue
        comp, day = r["competition_id"], r["date_utc"]
        key = (comp, f"{day[:7]}-01")
        if key not in dc_cache:
            dc_cache[key] = fit_dc(conn, comp, key[1])
        dc = dc_cache[key]
        if dc is None:
            continue
        try:
            pr = dc.predict(r["home"], r["away"])
            p = [pr.home_win, pr.draw, pr.away_win]
        except Exception:  # noqa: BLE001
            continue
        if any(v is None or math.isnan(v) for v in p):
            continue
        s = sum(p)
        if s <= 0:
            continue
        p = [v / s for v in p]

        hs, a_s = int(r["hs"]), int(r["a_s"])
        idx = 0 if hs > a_s else (1 if hs == a_s else 2)
        mkt = devig(oh, od, oa)

        n += 1
        truth[idx] += 1
        hits["always_home"] += int(idx == 0)
        k = max(range(3), key=lambda i: p[i])
        hits["model"] += int(k == idx)
        hits["market"] += int(max(range(3), key=lambda i: mkt[i]) == idx)
        briers["model"].append(brier(p, idx))
        briers["market"].append(brier(mkt, idx))
        briers["always_home"].append(brier([1.0, 0.0, 0.0], idx))

        pick_counts[k][0] += 1
        pick_counts[k][1] += int(k == idx)
        band = min(int(p[k] * 10) * 10, 90)
        bands[band][0] += 1
        bands[band][1] += int(k == idx)

        eh = elo_before(elo, int(r["home_team_id"]), day)
        ea = elo_before(elo, int(r["away_team_id"]), day)
        if eh is not None and ea is not None:
            elo_n += 1
            elo_hits += int((0 if eh >= ea else 2) == idx)

        if idx != 1:
            decisive["n"] += 1
            decisive["model"] += int((0 if p[0] >= p[2] else 2) == idx)
            decisive["market"] += int((0 if mkt[0] >= mkt[2] else 2) == idx)

    if not n:
        logger.error("nothing scored")
        return 1

    ladder = [
        {"key": "always_home", "label": "Always pick the home team",
         "note": "the floor for a home/draw/away pick",
         "accuracy": round(hits["always_home"] / n, 4),
         "brier": round(float(np.mean(briers["always_home"])), 4), "n": n},
        {"key": "higher_elo", "label": "Pick the higher-rated team",
         "note": "roughly what an informed fan does",
         "accuracy": round(elo_hits / elo_n, 4) if elo_n else None,
         "brier": None, "n": elo_n},
        {"key": "model", "label": "This model",
         "note": "Dixon-Coles, refit monthly on prior matches only",
         "accuracy": round(hits["model"] / n, 4),
         "brier": round(float(np.mean(briers["model"])), 4), "n": n},
        {"key": "market", "label": "The closing line",
         "note": "the practical ceiling",
         "accuracy": round(hits["market"] / n, 4),
         "brier": round(float(np.mean(briers["market"])), 4), "n": n},
    ]

    calibration = [
        {"stated_low": b, "stated_high": b + 10, "n": c[0],
         "observed": round(c[1] / c[0], 4)}
        for b, c in sorted(bands.items()) if c[0] >= 25
    ]

    lab = ["home", "draw", "away"]
    picks = [{"outcome": lab[k], "picked": pick_counts[k][0],
              "share": round(pick_counts[k][0] / n, 4),
              "correct": round(pick_counts[k][1] / pick_counts[k][0], 4) if pick_counts[k][0] else None}
             for k in range(3)]

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": {
            "scope": comps, "since": args.since,
            "dixon_coles": "refit at the start of each calendar month on matches strictly before it",
            "elo": "last ClubElo rating published before kickoff",
            "priced_only": True,
            "brier": "multiclass summed; uniform 1/3 = .6667",
        },
        "n": n,
        "ladder": ladder,
        "calibration": calibration,
        "picks": picks,
        "actual_outcomes": {lab[i]: round(truth[i] / n, 4) for i in range(3)},
        "decisive_only": {
            "n": decisive["n"],
            "model": round(decisive["model"] / decisive["n"], 4) if decisive["n"] else None,
            "market": round(decisive["market"] / decisive["n"], 4) if decisive["n"] else None,
        },
    }

    print(f"\n{'forecaster':<34}{'accuracy':>10}{'Brier':>10}{'n':>8}")
    print("-" * 62)
    for e in ladder:
        acc = f"{e['accuracy']:.1%}" if e["accuracy"] is not None else "—"
        br = f"{e['brier']:.4f}" if e["brier"] is not None else "—"
        print(f"{e['label']:<34}{acc:>10}{br:>10}{e['n']:>8}")
    print(f"\ndecisive matches only (n={decisive['n']}): "
          f"model {out['decisive_only']['model']:.1%}, market {out['decisive_only']['market']:.1%}")
    print(f"\n{'model says':<14}{'n':>8}{'actually won':>15}")
    for c in calibration:
        print(f"{c['stated_low']}-{c['stated_high']}%{'':<6}{c['n']:>8}{c['observed']:>15.1%}")

    op = Path(args.output)
    op.parent.mkdir(parents=True, exist_ok=True)
    op.write_text(json.dumps(out, indent=2))
    print(f"\nwrote {op}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
