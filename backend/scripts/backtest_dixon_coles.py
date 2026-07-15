"""Walk-forward backtest of the Dixon-Coles baseline — THE YARDSTICK REPORT.

For the most recent *complete* season of each requested competition, walk
forward matchday-by-matchday: fit Dixon-Coles on everything strictly before the
matchday (last N seasons, time-decayed to the matchday date), predict every
match in it, then score the predictions with multiclass Brier and log-loss
against two baselines:

  (a) uniform 1/3-1/3-1/3, and
  (b) the bookmaker market, de-vigged by normalising implied probabilities
      (1/odds), on the subset of matches carrying odds_home/draw/away.

Honesty note: the market is a strong predictor — Dixon-Coles *losing to the
market everywhere is the expected result and fine*. What the baseline must do
is crush uniform; that is the bar the Match Engine later has to clear against
Dixon-Coles itself (VISION_2030 §8).

Matchdays: the warehouse has no reliable round label for every source, so a
"matchday" is a block of consecutive fixture dates separated by >= 2 blank
days — which reconstructs weekend/midweek rounds well for league play.

The warehouse is ALWAYS opened strictly read-only.

Run
---
    python -m backend.scripts.backtest_dixon_coles --competitions eng.1
    python -m backend.scripts.backtest_dixon_coles \
        --competitions eng.1 esp.1 --season 2024 --seasons 5
"""

from __future__ import annotations

import argparse
import math
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.train_dixon_coles import (  # noqa: E402
    WAREHOUSE_PATH,
    connect_readonly,
    dominant_source,
    load_competition_matches,
)
from backend.services.prediction.dixon_coles import (  # noqa: E402
    DEFAULT_HALF_LIFE_DAYS,
    fit_dixon_coles,
)

_EPS = 1e-12
MIN_FIT_MATCHES = 100
# A season counts as "complete" only if its last match is at least this many
# days in the past (guards against scoring a season still in progress).
SEASON_COMPLETE_GRACE_DAYS = 21


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def outcome_index(home_goals: int, away_goals: int) -> int:
    """0 = home win, 1 = draw, 2 = away win."""
    if home_goals > away_goals:
        return 0
    if home_goals == away_goals:
        return 1
    return 2


def brier(probs: Sequence[float], outcome: int) -> float:
    """Multiclass Brier score: sum over the 3 outcomes of (p - y)^2."""
    return sum(
        (p - (1.0 if k == outcome else 0.0)) ** 2 for k, p in enumerate(probs)
    )


def log_loss(probs: Sequence[float], outcome: int) -> float:
    return -math.log(max(probs[outcome], _EPS))


def devig(odds_h: float, odds_d: float, odds_a: float) -> Optional[Tuple[float, float, float]]:
    """Bookmaker implied probabilities with the overround normalised away."""
    if min(odds_h, odds_d, odds_a) <= 1.0:
        return None
    inv = (1.0 / odds_h, 1.0 / odds_d, 1.0 / odds_a)
    s = sum(inv)
    return (inv[0] / s, inv[1] / s, inv[2] / s)


@dataclass
class ScoreAccumulator:
    name: str
    brier_sum: float = 0.0
    logloss_sum: float = 0.0
    n: int = 0
    hits: int = 0

    def add(self, probs: Sequence[float], outcome: int) -> None:
        self.brier_sum += brier(probs, outcome)
        self.logloss_sum += log_loss(probs, outcome)
        self.n += 1
        if max(range(3), key=lambda k: probs[k]) == outcome:
            self.hits += 1

    @property
    def brier(self) -> float:
        return self.brier_sum / self.n if self.n else float("nan")

    @property
    def logloss(self) -> float:
        return self.logloss_sum / self.n if self.n else float("nan")

    @property
    def accuracy(self) -> float:
        return self.hits / self.n if self.n else float("nan")


# ---------------------------------------------------------------------------
# Season / matchday plumbing
# ---------------------------------------------------------------------------
def latest_complete_season(
    con: sqlite3.Connection, competition_id: str, source: str
) -> Optional[int]:
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=SEASON_COMPLETE_GRACE_DAYS)
    ).isoformat()
    row = con.execute(
        """
        SELECT season, MAX(date_utc) AS last_date, COUNT(*) AS n
        FROM matches
        WHERE competition_id = ? AND source = ?
          AND home_score IS NOT NULL AND away_score IS NOT NULL
        GROUP BY season HAVING last_date < ?
        ORDER BY season DESC LIMIT 1
        """,
        (competition_id, source, cutoff),
    ).fetchone()
    return int(row["season"]) if row else None


def load_season_matches(
    con: sqlite3.Connection, competition_id: str, source: str, season: int
) -> List[sqlite3.Row]:
    return con.execute(
        """
        SELECT m.match_id, m.date_utc, m.home_score, m.away_score,
               m.odds_home, m.odds_draw, m.odds_away,
               h.canonical_name AS home, a.canonical_name AS away
        FROM matches m
        JOIN teams h ON h.team_id = m.home_team_id
        JOIN teams a ON a.team_id = m.away_team_id
        WHERE m.competition_id = ? AND m.source = ? AND m.season = ?
          AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        ORDER BY m.date_utc ASC, m.match_id ASC
        """,
        (competition_id, source, season),
    ).fetchall()


def matchday_blocks(rows: List[sqlite3.Row]) -> List[List[sqlite3.Row]]:
    """Group season fixtures into matchday-like blocks.

    Consecutive fixture *dates* (gap of <= 1 blank day) belong to one block; a
    gap of 2+ days starts the next. Reconstructs Fri-Mon weekend rounds and
    midweek rounds without needing a round column.
    """
    blocks: List[List[sqlite3.Row]] = []
    current: List[sqlite3.Row] = []
    prev_day: Optional[datetime] = None
    for row in rows:
        day = datetime.fromisoformat(str(row["date_utc"])[:10])
        if prev_day is not None and (day - prev_day).days >= 2:
            blocks.append(current)
            current = []
        current.append(row)
        prev_day = day
    if current:
        blocks.append(current)
    return blocks


# ---------------------------------------------------------------------------
# Backtest
# ---------------------------------------------------------------------------
@dataclass
class CompetitionReport:
    competition_id: str
    season: int
    source: str
    n_blocks: int = 0
    skipped: int = 0
    dc_all: ScoreAccumulator = field(
        default_factory=lambda: ScoreAccumulator("dixon_coles")
    )
    uni_all: ScoreAccumulator = field(
        default_factory=lambda: ScoreAccumulator("uniform")
    )
    # Head-to-head on the odds subset only (fair comparison).
    dc_mkt: ScoreAccumulator = field(
        default_factory=lambda: ScoreAccumulator("dc_on_odds")
    )
    mkt: ScoreAccumulator = field(default_factory=lambda: ScoreAccumulator("market"))
    uni_mkt: ScoreAccumulator = field(
        default_factory=lambda: ScoreAccumulator("uniform_on_odds")
    )


def backtest_competition(
    con: sqlite3.Connection,
    competition_id: str,
    season: Optional[int],
    n_seasons: int,
    half_life_days: float,
) -> Optional[CompetitionReport]:
    source = dominant_source(con, competition_id)
    if source is None:
        print(f"!! {competition_id}: no data")
        return None
    if season is None:
        season = latest_complete_season(con, competition_id, source)
        if season is None:
            print(f"!! {competition_id}: no complete season found")
            return None

    rows = load_season_matches(con, competition_id, source, season)
    if not rows:
        print(f"!! {competition_id} season {season}: no completed matches")
        return None

    report = CompetitionReport(competition_id, season, source)
    blocks = matchday_blocks(rows)
    report.n_blocks = len(blocks)

    for block in blocks:
        block_start = str(block[0]["date_utc"])
        train = load_competition_matches(
            con, competition_id, n_seasons, source=source, until=block_start
        )
        if len(train) < MIN_FIT_MATCHES:
            report.skipped += len(block)
            continue
        model = fit_dixon_coles(
            train, half_life_days=half_life_days, ref_date=block_start
        )
        for row in block:
            pred = model.predict(row["home"], row["away"])
            probs = (pred["p_home"], pred["p_draw"], pred["p_away"])
            out = outcome_index(int(row["home_score"]), int(row["away_score"]))
            report.dc_all.add(probs, out)
            report.uni_all.add((1 / 3, 1 / 3, 1 / 3), out)
            if (
                row["odds_home"] is not None
                and row["odds_draw"] is not None
                and row["odds_away"] is not None
            ):
                market = devig(
                    float(row["odds_home"]),
                    float(row["odds_draw"]),
                    float(row["odds_away"]),
                )
                if market is not None:
                    report.dc_mkt.add(probs, out)
                    report.mkt.add(market, out)
                    report.uni_mkt.add((1 / 3, 1 / 3, 1 / 3), out)
    return report


# ---------------------------------------------------------------------------
# Report printing
# ---------------------------------------------------------------------------
def print_report(reports: List[CompetitionReport]) -> None:
    line = "-" * 78
    print()
    print("=" * 78)
    print("DIXON-COLES WALK-FORWARD BACKTEST — THE YARDSTICK REPORT")
    print("(lower Brier / log-loss is better; DC must crush uniform;")
    print(" losing to the de-vigged market is expected — the market is strong)")
    print("=" * 78)
    for r in reports:
        print()
        print(
            f"{r.competition_id}  season {r.season}  (source={r.source}, "
            f"{r.dc_all.n} matches scored across {r.n_blocks} matchday blocks"
            + (f", {r.skipped} skipped: insufficient history" if r.skipped else "")
            + ")"
        )
        print(line)
        print(f"{'model':<26}{'n':>6}{'Brier':>10}{'log-loss':>10}{'top-1 acc':>11}")
        print(line)
        rows: List[Tuple[str, ScoreAccumulator]] = [
            ("Dixon-Coles (all)", r.dc_all),
            ("Uniform 1/3 (all)", r.uni_all),
        ]
        if r.mkt.n:
            rows += [
                ("Dixon-Coles (odds subset)", r.dc_mkt),
                ("Market de-vig (odds subset)", r.mkt),
                ("Uniform 1/3 (odds subset)", r.uni_mkt),
            ]
        for label, acc in rows:
            print(
                f"{label:<26}{acc.n:>6}{acc.brier:>10.4f}"
                f"{acc.logloss:>10.4f}{acc.accuracy:>11.3f}"
            )
        print(line)
        if r.uni_all.n:
            d_brier = r.uni_all.brier - r.dc_all.brier
            print(f"  vs uniform: Brier {'-' if d_brier >= 0 else '+'}"
                  f"{abs(d_brier):.4f} "
                  f"({'DC better' if d_brier > 0 else 'DC WORSE — investigate'})")
        if r.mkt.n:
            d_brier_m = r.mkt.brier - r.dc_mkt.brier
            verdict = "DC beats the market" if d_brier_m > 0 else \
                "market better (expected)"
            print(f"  vs market:  Brier {'+' if d_brier_m < 0 else '-'}"
                  f"{abs(d_brier_m):.4f} ({verdict})")
        else:
            print("  vs market:  no odds columns for this competition/source")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Walk-forward backtest for the Dixon-Coles baseline."
    )
    parser.add_argument(
        "--competitions",
        nargs="+",
        default=["eng.1"],
        help="Competition ids to backtest (default: eng.1)",
    )
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="Season label to backtest (default: latest complete season)",
    )
    parser.add_argument(
        "--seasons",
        type=int,
        default=5,
        help="Training window: last N seasons before each matchday (default 5)",
    )
    parser.add_argument(
        "--half-life",
        type=float,
        default=DEFAULT_HALF_LIFE_DAYS,
        help=f"Time-decay half-life in days (default {DEFAULT_HALF_LIFE_DAYS:.0f})",
    )
    parser.add_argument(
        "--warehouse",
        type=Path,
        default=WAREHOUSE_PATH,
        help="Path to warehouse.sqlite (opened read-only)",
    )
    args = parser.parse_args(argv)

    con = connect_readonly(args.warehouse)
    reports: List[CompetitionReport] = []
    try:
        for comp in args.competitions:
            print(f"Backtesting {comp} ...")
            rep = backtest_competition(
                con, comp, args.season, args.seasons, args.half_life
            )
            if rep is not None:
                reports.append(rep)
    finally:
        con.close()

    if not reports:
        print("Nothing to report.")
        return 1
    print_report(reports)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
