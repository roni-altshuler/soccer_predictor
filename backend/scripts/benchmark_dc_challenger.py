"""
Decisive experiment: can an off-the-shelf penaltyblog Dixon-Coles beat the
in-house neural ensemble, and how close does it get to the closing line?

Strict walk-forward: for each league, train on every season strictly before the
test season, predict that season, then move on. Scored only on fixtures that
also carry closing odds, so the model and market rows are paired exactly.
"""
import sqlite3, math, sys
import numpy as np
import penaltyblog as pb

DB = "backend/data/warehouse.sqlite"
LEAGUES = {"eng.1": "Premier League", "esp.1": "La Liga", "ger.1": "Bundesliga",
           "ita.1": "Serie A", "fra.1": "Ligue 1"}
XI = 0.0018  # penaltyblog's default time-decay


def load(conn, comp):
    cur = conn.cursor()
    cur.execute("""
        SELECT m.season, m.date_utc, th.canonical_name, ta.canonical_name,
               m.home_score, m.away_score, m.odds_home, m.odds_draw, m.odds_away
        FROM matches m
        JOIN teams th ON m.home_team_id = th.team_id
        JOIN teams ta ON m.away_team_id = ta.team_id
        WHERE m.competition_id = ? AND m.home_score IS NOT NULL
        ORDER BY m.date_utc
    """, (comp,))
    return cur.fetchall()


def devig(oh, od, oa):
    pi = [1.0 / oh, 1.0 / od, 1.0 / oa]
    b = sum(pi)
    return [x / b for x in pi]


def score(p, idx):
    p = list(p)
    s = sum(p)
    p = [x / s for x in p]
    brier = sum((p[i] - (1.0 if i == idx else 0.0)) ** 2 for i in range(3))
    ll = -math.log(max(1e-12, p[idx]))
    hit = int(max(range(3), key=lambda i: p[i]) == idx)
    return brier, ll, hit


def main():
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    grand = {"dc": [0.0, 0.0, 0], "mkt": [0.0, 0.0, 0], "n": 0}
    print(f"{'league':<16}{'n':>6}{'DC Brier':>10}{'mkt Brier':>11}{'DC ll':>9}"
          f"{'mkt ll':>9}{'DC acc':>9}{'mkt acc':>9}")
    print("-" * 79)

    for comp, label in LEAGUES.items():
        rows = load(conn, comp)
        seasons = sorted({r[0] for r in rows})
        tot = {"dc": [0.0, 0.0, 0], "mkt": [0.0, 0.0, 0], "n": 0}

        for test_season in seasons[3:]:          # need history to train on
            train = [r for r in rows if r[0] < test_season]
            test = [r for r in rows if r[0] == test_season]
            if len(train) < 500 or not test:
                continue

            # Time-decay weights on training rows, most recent weighted highest.
            dates = np.array([np.datetime64(r[1][:10]) for r in train])
            age_days = (dates.max() - dates).astype("timedelta64[D]").astype(float)
            weights = np.exp(-XI * age_days)

            try:
                model = pb.models.DixonColesGoalModel(
                    goals_home=[r[4] for r in train],
                    goals_away=[r[5] for r in train],
                    teams_home=[r[2] for r in train],
                    teams_away=[r[3] for r in train],
                    weights=weights,
                )
                model.fit()
            except Exception as exc:                      # noqa: BLE001
                print(f"  ! {label} {test_season} fit failed: {exc}", file=sys.stderr)
                continue

            known = set(model.params.get("team", {}) or [])
            for season, _date, home, away, hs, a_s, oh, od, oa in test:
                if None in (oh, od, oa) or min(oh, od, oa) <= 1.0:
                    continue
                try:
                    probs = model.predict(home, away)
                    dc = [probs.home_win, probs.draw, probs.away_win]
                except Exception:                          # unseen team, etc.
                    continue
                if any(x is None or math.isnan(x) for x in dc):
                    continue

                idx = 0 if hs > a_s else (2 if a_s > hs else 1)
                mkt = devig(oh, od, oa)

                for key, p in (("dc", dc), ("mkt", mkt)):
                    b, l, h = score(p, idx)
                    tot[key][0] += b
                    tot[key][1] += l
                    tot[key][2] += h
                tot["n"] += 1

        n = tot["n"]
        if not n:
            continue
        print(f"{label:<16}{n:>6}{tot['dc'][0]/n:>10.4f}{tot['mkt'][0]/n:>11.4f}"
              f"{tot['dc'][1]/n:>9.4f}{tot['mkt'][1]/n:>9.4f}"
              f"{tot['dc'][2]/n:>9.4f}{tot['mkt'][2]/n:>9.4f}")
        for key in ("dc", "mkt"):
            for i in range(3):
                grand[key][i] += tot[key][i]
        grand["n"] += n

    n = grand["n"]
    print("-" * 79)
    print(f"{'ALL':<16}{n:>6}{grand['dc'][0]/n:>10.4f}{grand['mkt'][0]/n:>11.4f}"
          f"{grand['dc'][1]/n:>9.4f}{grand['mkt'][1]/n:>9.4f}"
          f"{grand['dc'][2]/n:>9.4f}{grand['mkt'][2]/n:>9.4f}")
    print()
    print(f"Dixon-Coles gap to market: Brier {grand['dc'][0]/n - grand['mkt'][0]/n:+.4f}  "
          f"log loss {grand['dc'][1]/n - grand['mkt'][1]/n:+.4f}")


if __name__ == "__main__":
    main()
