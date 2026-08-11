"""Turn knockout matches into TIES — the unit a tournament actually decides.

The reason this layer exists
----------------------------
A league match has three outcomes and a quarter of them are draws, which is
why a three-way model on domestic football tops out near the closing line's
54%. A knockout tie has TWO outcomes. Extra time, penalties and away goals
exist precisely so that exactly one team advances. That is the same shape as
the tennis problem — one match, one winner, no third option — and it is the
honest place to look for the kind of accuracy a binary sport allows.

It is not a trick to inflate a number. It is a different question, asked where
the sport actually asks it.

Resolution
----------
Single leg: whoever ESPN records as the winner, which already accounts for
extra time and penalties.

Two legs: aggregate. Level on aggregate resolves by shootout if one was played,
otherwise by away goals for seasons up to 2020 (UEFA abolished the rule from
2021-22), otherwise by ESPN's own winner flag on the second leg as a last
resort. Every tie records WHICH rule decided it, so a claim about penalty
records can be checked rather than assumed.

The check that matters
----------------------
`validate_progression` asks the only question that can catch a systematically
wrong resolution: does the team this module says advanced actually appear in
the next round? A bug in the away-goals branch or a mis-paired second leg
fails that test loudly instead of quietly training the model on the losing
side.
"""
from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from backend.services.tournament.rounds import (
    GROUP,
    QUALIFYING,
    away_goals_applies,
    classify,
    depth_label,
    slug,
)


@dataclass
class Leg:
    match_id: str
    date_utc: str
    home_team_id: int
    away_team_id: int
    home_score: int
    away_score: int
    home_shootout: Optional[int]
    away_shootout: Optional[int]
    winner_side: Optional[str]
    status_detail: Optional[str]


@dataclass
class Tie:
    competition_id: str
    season: int
    round_slug: str
    team_a: int              # home side of the first leg
    team_b: int
    legs: List[Leg]
    winner: Optional[int]
    resolution: str          # single | aggregate | shootout | away_goals | espn
    teams_remaining: int = 0  # filled in by `build`, derived from the bracket

    @property
    def date_utc(self) -> str:
        """First leg kickoff — the instant every feature must predate."""
        return self.legs[0].date_utc

    @property
    def two_legged(self) -> bool:
        return len(self.legs) > 1

    @property
    def a_advanced(self) -> Optional[int]:
        if self.winner is None:
            return None
        return 1 if self.winner == self.team_a else 0

    @property
    def round_label(self) -> str:
        return depth_label(self.teams_remaining)


def load_legs(conn: sqlite3.Connection, competitions: Sequence[str],
              *, include_qualifying: bool = True,
              min_season: int = 0) -> List[Tuple[sqlite3.Row, str]]:
    ph = ",".join("?" * len(competitions))
    sql = f"""
        SELECT m.match_id, m.competition_id, m.season, m.date_utc, m.phase,
               m.home_team_id, m.away_team_id, m.home_score, m.away_score,
               k.home_shootout, k.away_shootout, k.winner_side, k.status_detail
          FROM matches m
          LEFT JOIN knockout_results k ON k.match_id = m.match_id
         WHERE m.competition_id IN ({ph})
           AND m.season >= ?
           AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
         ORDER BY m.date_utc, m.match_id
    """
    out = []
    for r in conn.execute(sql, [*competitions, min_season]):
        kind = classify(r["phase"])
        if kind == GROUP:
            continue
        if kind == QUALIFYING and not include_qualifying:
            continue
        out.append((r, kind))
    return out


def build(conn: sqlite3.Connection, competitions: Sequence[str], *,
          include_qualifying: bool = True, include_third_place: bool = False,
          min_season: int = 0) -> List[Tie]:
    """Group knockout legs into ties and resolve each one."""
    buckets: Dict[Tuple, List[Leg]] = defaultdict(list)
    meta: Dict[Tuple, Tuple[str, int, str]] = {}

    for r, kind in load_legs(conn, competitions,
                             include_qualifying=include_qualifying,
                             min_season=min_season):
        if kind == "third_place" and not include_third_place:
            continue
        h, a = int(r["home_team_id"]), int(r["away_team_id"])
        key = (r["competition_id"], int(r["season"]), slug(r["phase"]),
               min(h, a), max(h, a))
        buckets[key].append(Leg(
            match_id=r["match_id"], date_utc=r["date_utc"],
            home_team_id=h, away_team_id=a,
            home_score=int(r["home_score"]), away_score=int(r["away_score"]),
            home_shootout=r["home_shootout"], away_shootout=r["away_shootout"],
            winner_side=r["winner_side"], status_detail=r["status_detail"],
        ))
        meta[key] = (r["competition_id"], int(r["season"]), slug(r["phase"]))

    ties: List[Tie] = []
    for key, legs in buckets.items():
        legs.sort(key=lambda l: l.date_utc)
        comp, season, rnd = meta[key]
        # A "tie" of three or more legs is a group played as a mini-league, or
        # two separate meetings ESPN gave the same phase slug. Neither is a
        # knockout tie; excluding them is safer than guessing which legs pair.
        if len(legs) > 2:
            continue
        winner, resolution = resolve(legs, season)
        ties.append(Tie(competition_id=comp, season=season, round_slug=rnd,
                        team_a=legs[0].home_team_id, team_b=legs[0].away_team_id,
                        legs=legs, winner=winner, resolution=resolution))

    _assign_depth(ties)
    _flag_missing_legs(ties)
    ties.sort(key=lambda t: (t.date_utc, t.competition_id))
    return ties


def _flag_missing_legs(ties: Sequence[Tie]) -> None:
    """A one-legged tie inside a two-legged round is a hole, not a format.

    The progression check found these: 45 ties, almost all in early Champions
    League qualifying rounds before 2010, where ESPN carries one leg and not
    the other. Resolved on that single scoreline they name the wrong team
    about half the time. They are marked `incomplete` so training can exclude
    them, rather than being silently correct-looking rows.
    """
    two_legged_share: Dict[Tuple[str, int, str], List[int]] = defaultdict(lambda: [0, 0])
    for t in ties:
        cell = two_legged_share[(t.competition_id, t.season, t.round_slug)]
        cell[1] += 1
        if t.two_legged:
            cell[0] += 1
    for t in ties:
        if t.two_legged:
            continue
        got, total = two_legged_share[(t.competition_id, t.season, t.round_slug)]
        if total >= 3 and got / total > 0.6:
            t.resolution = "incomplete"
            t.winner = None


def resolve(legs: Sequence[Leg], season: int) -> Tuple[Optional[int], str]:
    """Who advanced, and by which rule."""
    if len(legs) == 1:
        leg = legs[0]
        if leg.winner_side == "home":
            return leg.home_team_id, "single"
        if leg.winner_side == "away":
            return leg.away_team_id, "single"
        # No recorded winner and no shootout: a one-off that genuinely ended
        # level (a third-place play-off ESPN never resolved, say).
        if leg.home_score > leg.away_score:
            return leg.home_team_id, "single"
        if leg.away_score > leg.home_score:
            return leg.away_team_id, "single"
        return None, "unresolved"

    first, second = legs[0], legs[1]
    a, b = first.home_team_id, first.away_team_id

    # Aggregate, viewed from team A. The second leg usually reverses the
    # venue, but a neutral or re-ordered fixture list must not be assumed.
    agg_a = first.home_score + (second.away_score if second.home_team_id == b
                                else second.home_score)
    agg_b = first.away_score + (second.home_score if second.home_team_id == b
                                else second.away_score)
    if agg_a != agg_b:
        return (a if agg_a > agg_b else b), "aggregate"

    if second.home_shootout is not None and second.away_shootout is not None:
        if second.home_shootout != second.away_shootout:
            sh_winner = (second.home_team_id if second.home_shootout > second.away_shootout
                         else second.away_team_id)
            return sh_winner, "shootout"

    if away_goals_applies(season):
        away_a = second.away_score if second.home_team_id == b else second.home_score
        away_b = first.away_score
        if away_a != away_b:
            return (a if away_a > away_b else b), "away_goals"

    if second.winner_side == "home":
        return second.home_team_id, "espn"
    if second.winner_side == "away":
        return second.away_team_id, "espn"
    return None, "unresolved"


def _assign_depth(ties: Sequence[Tie]) -> None:
    """Bracket depth = 2 x (ties in this round), counted, never parsed.

    This is what makes the Europa League's `second-round` (the round of 32)
    and the 1998 World Cup's `second-round` (the round of 16) come out
    correctly without a lookup table anybody has to maintain.
    """
    per_round: Dict[Tuple[str, int, str], int] = defaultdict(int)
    for t in ties:
        per_round[(t.competition_id, t.season, t.round_slug)] += 1
    for t in ties:
        t.teams_remaining = 2 * per_round[(t.competition_id, t.season, t.round_slug)]


def validate_progression(ties: Sequence[Tie]) -> Dict[str, object]:
    """Does the team we say advanced turn up in the next round?

    Only rounds that HAVE a successor can be checked, so finals and the last
    round of a competition-season are excluded from the denominator rather
    than counted as failures.
    """
    by_season: Dict[Tuple[str, int], List[Tie]] = defaultdict(list)
    for t in ties:
        by_season[(t.competition_id, t.season)].append(t)

    checked = confirmed = 0
    failures: List[Dict] = []
    by_resolution: Dict[str, List[int]] = defaultdict(lambda: [0, 0])

    for key, group in by_season.items():
        rounds: Dict[str, List[Tie]] = defaultdict(list)
        for t in group:
            rounds[t.round_slug].append(t)
        # Order rounds by when they were played.
        order = sorted(rounds, key=lambda r: min(t.date_utc for t in rounds[r]))
        for i, rnd in enumerate(order[:-1]):
            later = {tid for r2 in order[i + 1:] for t in rounds[r2]
                     for tid in (t.team_a, t.team_b)}
            if not later:
                continue
            for t in rounds[rnd]:
                if t.winner is None:
                    continue
                # Only meaningful if at least one of the two shows up later;
                # a whole tie can legitimately exit the competition (both
                # sides eliminated at a qualifying stage of another draw).
                if t.team_a not in later and t.team_b not in later:
                    continue
                checked += 1
                by_resolution[t.resolution][1] += 1
                if t.winner in later:
                    confirmed += 1
                    by_resolution[t.resolution][0] += 1
                elif len(failures) < 30:
                    failures.append({
                        "competition": t.competition_id, "season": t.season,
                        "round": t.round_slug, "resolution": t.resolution,
                        "match_ids": [l.match_id for l in t.legs],
                    })

    return {
        "checked": checked,
        "confirmed": confirmed,
        "rate": (confirmed / checked) if checked else None,
        "by_resolution": {k: {"confirmed": v[0], "checked": v[1],
                              "rate": (v[0] / v[1]) if v[1] else None}
                          for k, v in sorted(by_resolution.items())},
        "failures": failures,
    }
