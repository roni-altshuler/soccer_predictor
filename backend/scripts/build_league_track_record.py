"""
Per-league, per-season track record — the "is this actually working?" artifact.

For each Wave A league and each season, walk-forward fit Dixon-Coles on every
season strictly before it, predict that season, and score it against the
closing line on the identical fixtures.

WHY THE HEADLINE SERIES IS THE *GAP*, NOT RAW ACCURACY
------------------------------------------------------
Plotting raw accuracy per season looks like the obvious thing and is
misleading. How predictable a season was is a property of the season, not of
the model: a campaign with a runaway leader is easy for everyone, a chaotic one
is hard for everyone. A model whose raw accuracy drops 4 points in a season
where the market also dropped 4 points has not got worse.

So the primary series is **model Brier minus market Brier**. That is the sports
equivalent of measuring a fund against its index instead of in absolute
dollars: it divides out the difficulty of the season and leaves only the part
attributable to the model. A flat gap through a chaotic season is a good
result, and this framing is the only one that shows it.

Raw model / market / baseline numbers are emitted alongside so the page can
show the absolute picture too — but the gap is what answers "is it working".

    .venv/bin/python -m backend.scripts.build_league_track_record

Writes backend/data/diagnostics/league_track_record.json.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path

import numpy as np
import penaltyblog as pb

DB = Path("backend/data/warehouse.sqlite")
OUT = Path("backend/data/diagnostics/league_track_record.json")
LEAGUES = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
}
XI = 0.0018
MIN_SEASON_N = 60  # below this a season's Brier is noise, not a datapoint


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


def brier(p: list[float], idx: int) -> float:
    return sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))


def season_label(season: int) -> str:
    return f"{season}/{str(season + 1)[-2:]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--leagues", default=",".join(LEAGUES))
    ap.add_argument("--output", default=str(OUT))
    args = ap.parse_args()

    if not DB.exists() or DB.stat().st_size == 0:
        print("warehouse missing or empty", file=sys.stderr)
        return 2

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    out: dict[str, object] = {
        "artifact": "league_track_record",
        "version": 1,
        "method": (
            "Walk-forward Dixon-Coles: for each season, fit on every prior season only, "
            "then score against the de-vigged closing line on identical fixtures. The "
            "headline series is model Brier minus market Brier, which divides out how "
            "predictable each season happened to be."
        ),
        "convention": "Multiclass Brier summed over outcomes; uniform 1/3 = 0.6667. Lower is better.",
        "leagues": [],
    }

    for comp in [c.strip() for c in args.leagues.split(",") if c.strip()]:
        rows = load(conn, comp)
        seasons = sorted({r[0] for r in rows})
        series = []

        for test_season in seasons[3:]:
            train = [r for r in rows if r[0] < test_season]
            test = [r for r in rows if r[0] == test_season]
            if len(train) < 500 or not test:
                continue

            dates = np.array([np.datetime64(r[1][:10]) for r in train])
            age = (dates.max() - dates).astype("timedelta64[D]").astype(float)
            try:
                model = pb.models.DixonColesGoalModel(
                    goals_home=[r[4] for r in train],
                    goals_away=[r[5] for r in train],
                    teams_home=[r[2] for r in train],
                    teams_away=[r[3] for r in train],
                    weights=np.exp(-XI * age),
                )
                model.fit()
            except Exception as exc:  # noqa: BLE001
                print(f"  ! {comp} {test_season}: {exc}", file=sys.stderr)
                continue

            n = 0
            b_model = b_mkt = b_base = 0.0
            hit_model = hit_mkt = 0
            # Base rate is taken from the TRAINING seasons only — using the test
            # season's own outcome distribution would leak the answer.
            tr_out = [0, 0, 0]
            for r in train:
                tr_out[0 if r[4] > r[5] else (2 if r[5] > r[4] else 1)] += 1
            base_p = [c / sum(tr_out) for c in tr_out]

            for _s, _d, home, away, hs, a_s, oh, od, oa in test:
                if None in (oh, od, oa) or min(oh, od, oa) <= 1.0:
                    continue
                try:
                    pr = model.predict(home, away)
                    dc = [pr.home_win, pr.draw, pr.away_win]
                except Exception:
                    continue
                if any(v is None or math.isnan(v) for v in dc):
                    continue
                s = sum(dc)
                dc = [v / s for v in dc]
                mkt = devig(oh, od, oa)
                idx = 0 if hs > a_s else (2 if a_s > hs else 1)

                b_model += brier(dc, idx)
                b_mkt += brier(mkt, idx)
                b_base += brier(base_p, idx)
                hit_model += int(max(range(3), key=lambda i: dc[i]) == idx)
                hit_mkt += int(max(range(3), key=lambda i: mkt[i]) == idx)
                n += 1

            if n < MIN_SEASON_N:
                continue

            series.append({
                "season": test_season,
                "label": season_label(test_season),
                "n": n,
                "train_matches": len(train),
                "model_brier": round(b_model / n, 4),
                "market_brier": round(b_mkt / n, 4),
                "base_rate_brier": round(b_base / n, 4),
                "gap_to_market": round((b_model - b_mkt) / n, 4),
                "model_accuracy": round(hit_model / n, 4),
                "market_accuracy": round(hit_mkt / n, 4),
                # Share of the base-rate→market distance the model captured.
                "signal_captured": (
                    round((b_base - b_model) / (b_base - b_mkt), 4)
                    if b_base > b_mkt else None
                ),
            })

        if not series:
            continue

        gaps = [s["gap_to_market"] for s in series]
        # Least-squares slope of the gap over season index. Negative = closing
        # on the market over time, which is the trend that would justify the
        # "it gets better as it sees more data" claim.
        k = len(gaps)
        trend = None
        if k >= 3:
            xs = list(range(k))
            mx, my = sum(xs) / k, sum(gaps) / k
            denom = sum((x - mx) ** 2 for x in xs)
            if denom:
                trend = round(sum((xs[i] - mx) * (gaps[i] - my) for i in range(k)) / denom, 5)

        out["leagues"].append({
            "competition_id": comp,
            "name": LEAGUES.get(comp, comp),
            "seasons": series,
            "summary": {
                "n_seasons": k,
                "total_fixtures": sum(s["n"] for s in series),
                "mean_gap_to_market": round(sum(gaps) / k, 4),
                "best_season": min(series, key=lambda s: s["gap_to_market"])["label"],
                "worst_season": max(series, key=lambda s: s["gap_to_market"])["label"],
                "gap_trend_per_season": trend,
                "trend_reading": (
                    None if trend is None
                    else "closing on the market" if trend < -0.001
                    else "falling behind" if trend > 0.001
                    else "flat"
                ),
            },
        })
        print(f"{LEAGUES.get(comp, comp):<16} {k} seasons  mean gap {sum(gaps)/k:+.4f}  "
              f"trend {trend if trend is not None else 'n/a'}", file=sys.stderr)

    p = Path(args.output)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, indent=2))
    print(f"wrote {p}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
