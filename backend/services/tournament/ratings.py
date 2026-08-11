"""One Elo rating per team, over every match the warehouse holds.

Why not ClubElo
---------------
ClubElo is already in this warehouse and it is good, but it covers 244 clubs
and zero national teams — Argentina, France, Brazil and Morocco all return no
rows. Half the tournaments this layer models are national-team tournaments, so
ClubElo cannot rate one side of a World Cup tie.

This builds the rating from the 60,953 completed matches already in the
warehouse instead. Clubs and national teams live in the same table but never
play each other, so they form two disconnected graphs and their scales drift
apart independently; that is harmless, because a tie is always within one
graph.

The construction is the standard one, with two well-established corrections:

  * Margin of victory, damped. A 5-0 should move a rating more than a 1-0, but
    naively scaling by goal difference lets a strong favourite inflate itself
    by thrashing weak opposition. The `ln(gd+1)` shape plus the autocorrelation
    term (FiveThirtyEight's, and standard in the Elo literature) is the usual
    fix: a bigger existing rating gap shrinks the multiplier.
  * Regression on a long lay-off. A club that has not played for six weeks has
    had a transfer window; a national team that has not played for two years
    has a different squad. Ratings decay toward the mean by a factor that
    grows with the gap, rather than carrying a peak rating across a rebuild.

Leakage
-------
The pass is strictly chronological and `rating_before` answers only with
values written by matches that kicked off earlier. A rating is never read from
the match it is about to predict. That is not a stylistic preference: the two
most common ways to fake a good sports model are training on a rating built
from the test match's own result, and splitting a season at random. Both were
found in this repo's own code during this project.
"""
from __future__ import annotations

import bisect
import math
import sqlite3
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

BASE = 1500.0

# Neutral ground, or close enough: national-team tournaments are played at a
# single host, and continental finals at a designated venue. ESPN still labels
# one side "home"; giving that side a home advantage would be inventing one.
NEUTRAL_COMPETITIONS = frozenset({
    "fifa.world", "uefa.euro", "conmebol.america", "caf.nations", "afc.asian",
    "concacaf.gold", "fifa.cwc", "fifa.world.w", "uefa.euro.w",
})


@dataclass
class EloConfig:
    k_club: float = 20.0
    k_international: float = 40.0   # far fewer matches, so each must move more
    home_advantage: float = 65.0
    # Fraction of the distance to BASE a rating gives up after a full year idle,
    # applied in proportion to the gap beyond `grace_days`.
    grace_days: int = 45
    annual_regression: float = 0.35


@dataclass
class EloTable:
    """Per-team rating history, queryable at any past instant."""

    dates: Dict[int, List[str]] = field(default_factory=dict)
    values: Dict[int, List[float]] = field(default_factory=dict)

    def append(self, team_id: int, date_utc: str, rating: float) -> None:
        self.dates.setdefault(team_id, []).append(date_utc)
        self.values.setdefault(team_id, []).append(rating)

    def rating_before(self, team_id: int, date_utc: str) -> Optional[float]:
        """The rating as it stood strictly before `date_utc`.

        None when the team has no earlier match — an honest 'unknown' that the
        caller can drop or impute, rather than a silent 1500 that would make a
        debutant look average.
        """
        ds = self.dates.get(team_id)
        if not ds:
            return None
        i = bisect.bisect_left(ds, date_utc)
        return self.values[team_id][i - 1] if i > 0 else None

    def matches_before(self, team_id: int, date_utc: str) -> int:
        ds = self.dates.get(team_id)
        if not ds:
            return 0
        return bisect.bisect_left(ds, date_utc)


def _mov_multiplier(goal_diff: int, rating_diff_winner: float) -> float:
    """Damped margin-of-victory weight.

    `rating_diff_winner` is winner-minus-loser (after home advantage). The
    denominator is what stops a dominant side from running away with the
    scale by beating weak opposition heavily.
    """
    gd = max(1, abs(goal_diff))
    return math.log(gd + 1.0) * (2.2 / (0.001 * rating_diff_winner + 2.2))


def build(conn: sqlite3.Connection, *, cfg: Optional[EloConfig] = None,
          competitions: Optional[Sequence[str]] = None) -> EloTable:
    """Single chronological pass over completed matches."""
    cfg = cfg or EloConfig()
    table = EloTable()
    rating: Dict[int, float] = {}
    last_seen: Dict[int, str] = {}

    where = "home_score IS NOT NULL AND away_score IS NOT NULL"
    params: List = []
    if competitions:
        where += f" AND competition_id IN ({','.join('?' * len(competitions))})"
        params = list(competitions)

    sql = (f"SELECT competition_id, date_utc, home_team_id, away_team_id, "
           f"home_score, away_score, phase FROM matches WHERE {where} "
           f"ORDER BY date_utc, match_id")

    for row in conn.execute(sql, params):
        comp = row["competition_id"]
        date = row["date_utc"]
        h, a = int(row["home_team_id"]), int(row["away_team_id"])
        hs, as_ = int(row["home_score"]), int(row["away_score"])

        rh = _current(rating, last_seen, h, date, cfg)
        ra = _current(rating, last_seen, a, date, cfg)

        neutral = comp in NEUTRAL_COMPETITIONS
        hfa = 0.0 if neutral else cfg.home_advantage
        exp_h = 1.0 / (1.0 + 10 ** ((ra - (rh + hfa)) / 400.0))

        if hs > as_:
            score_h, diff_winner = 1.0, (rh + hfa) - ra
        elif as_ > hs:
            score_h, diff_winner = 0.0, ra - (rh + hfa)
        else:
            score_h, diff_winner = 0.5, abs((rh + hfa) - ra)

        k = cfg.k_international if neutral or comp.startswith(("uefa.nations",)) else cfg.k_club
        mult = _mov_multiplier(hs - as_, max(0.0, diff_winner))
        delta = k * mult * (score_h - exp_h)

        rating[h] = rh + delta
        rating[a] = ra - delta
        last_seen[h] = last_seen[a] = date

        # POST-match ratings, timestamped at kickoff. `rating_before` then
        # takes the last entry STRICTLY earlier, which is the value a team
        # carried into the match being asked about.
        #
        # Storing the pre-match value here instead looks equivalent and is
        # not: a query at a match's own kickoff would bisect to the entry
        # before it and hand back the rating from one match earlier, so every
        # feature would silently run a game stale. That was the first version
        # of this file, and the test that caught it is
        # `test_rating_is_read_strictly_before_the_match_that_produced_it`.
        table.append(h, date, rating[h])
        table.append(a, date, rating[a])

    return table


def _current(rating: Dict[int, float], last_seen: Dict[int, str],
             team: int, date: str, cfg: EloConfig) -> float:
    """Rating carried forward to `date`, regressed for time off."""
    r = rating.get(team)
    if r is None:
        return BASE
    prev = last_seen.get(team)
    if not prev:
        return r
    gap = _days_between(prev, date)
    if gap <= cfg.grace_days:
        return r
    frac = min(1.0, (gap - cfg.grace_days) / 365.0) * cfg.annual_regression
    return r + (BASE - r) * frac


def _days_between(a: str, b: str) -> float:
    from datetime import datetime

    def parse(s: str):
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    try:
        return abs((parse(b) - parse(a)).total_seconds()) / 86400.0
    except ValueError:
        return 0.0
