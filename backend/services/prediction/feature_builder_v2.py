"""Shared feature builder for the unified match model.

This module replaces the ad-hoc feature plumbing where the *training*
script computed 66 features in one shape and the *inference* path
computed a different 41-feature struct. There is now ONE function —
`FeatureBuilderV2.build(...)` — and both training and inference call it.

Inputs come from the warehouse (`backend/data/warehouse.sqlite`)
plus a small set of live overrides (kickoff timestamp, weather forecast,
etc.) injected at inference time. The output is a fixed-order vector
matching `FEATURE_NAMES` plus a small `MatchContext` of categorical
fields the model embeds (league_id, team_ids, referee_id, phase_id).

Feature inventory
-----------------
75 dense features. Categorical embeddings live separately on the model.
Features are grouped so that callers (and the test suite) can reason about
gaps:

* ELO + ratings (4)
* Recent form / rolling stats (16)
* Home/away venue splits (4)
* Head-to-head (5)
* Season position & momentum (8)
* Tactical rolling stats (8)
* Calendar / burnout (7)
* Weather (5)
* Referee tendencies (3)
* Travel / venue (2)
* Motivation / cup context (4)
* Interactions (2)
* Expected goals (7)

Market-implied probabilities are NOT here — see MARKET_FEATURE_NAMES below
and the comment above it, which is the most expensive lesson in this file.

Six features were removed on 2026-08-09 after measuring that they were
*constant* across a 600-fixture Wave A sample, so they contributed nothing
but parameters: `is_post_intl_break` (never derived), `home_squad_form` /
`away_squad_form` / `home_missing_top3` / `away_missing_top3` (the
`player_form` table has 0 rows and no loader fills it), and
`venue_altitude_m` (no altitude source; inventing one would be fabricated
data). Re-audit with a zero-variance check before adding anything here.

The feature names live in `FEATURE_NAMES` (the canonical training order).
"""

from __future__ import annotations

import logging
import math
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import Warehouse
from backend.services.prediction.unified_model import PHASE_TO_IDX

logger = logging.getLogger(__name__)

# Canonical training-time feature order. Inference rebuilds the vector by
# name so the contract is explicit, not positional.
FEATURE_NAMES: Tuple[str, ...] = (
    # --- ELO + ratings (4) ---
    "elo_home", "elo_away", "elo_diff", "elo_diff_signed",
    # --- recent form / rolling stats (16) ---
    "home_form_5_pts", "away_form_5_pts",
    "home_form_10_pts", "away_form_10_pts",
    "home_weighted_form", "away_weighted_form",
    "home_goals_for_avg5", "away_goals_for_avg5",
    "home_goals_against_avg5", "away_goals_against_avg5",
    "home_goals_for_avg10", "away_goals_for_avg10",
    "home_clean_sheet_pct", "away_clean_sheet_pct",
    "home_goal_diff_per_game", "away_goal_diff_per_game",
    # --- venue splits (4) ---
    "home_home_win_pct", "away_away_win_pct",
    "home_home_goals_avg", "away_away_goals_avg",
    # --- H2H (5) ---
    "h2h_matches", "h2h_home_advantage", "h2h_avg_total_goals",
    "h2h_home_xg_advantage", "away_road_vs_opp_ppg",
    # --- season position & momentum (8) ---
    "season_progress", "home_matchday_norm", "away_matchday_norm",
    "home_streak", "away_streak",
    "home_unbeaten_run", "away_unbeaten_run",
    "home_minus_away_points",
    # --- tactical rolling (8) ---
    "home_shots_ratio", "away_shots_ratio",
    "home_sot_ratio", "away_sot_ratio",
    "home_discipline_score", "away_discipline_score",
    "home_corner_dominance", "away_corner_dominance",
    # --- calendar / burnout (8) ---
    "home_days_rest", "away_days_rest", "rest_diff",
    "home_matches_last_14d", "away_matches_last_14d",
    "is_midweek",
    "season_stage",
    # --- weather (5) ---
    "weather_temp_c", "weather_precip_mm", "weather_wind_kmh",
    "weather_humidity", "is_outdoor_venue",
    # --- referee tendencies (3) ---
    "referee_avg_cards", "referee_home_win_rate", "referee_draw_rate",
    # --- travel / venue (2) ---
    # away_travel_km is real from 2026-08-09: great-circle km between the two
    # clubs' grounds, resolving for 100% of Wave A fixtures (median 311 km,
    # max 2,260 km). It was hardcoded 0.0 for every row before that.
    "away_travel_km", "is_neutral_venue",
    # --- motivation / cup context (4) ---
    # is_neutral_venue, is_knockout and is_2leg_aggregate are constant 0 across
    # Wave A and are kept anyway: they are constant *by construction* in
    # domestic league play and go live the moment Wave C tournaments land. That
    # is a different thing from a feature that is constant because nothing
    # feeds it, which is what the six removed above were.
    "is_knockout", "is_2leg_aggregate", "home_motivation", "away_motivation",
    # --- interactions (3) ---
    "elo_x_form_diff", "elo_x_h2h",
    # --- expected goals (7) — Understat/FBref via warehouse matches.home_xg ---
    # Coverage is partial (top European leagues + enriched women's data), so
    # every xG feature defaults to 0 and `has_xg_data` tells the model when
    # the block is trustworthy. Appended last to keep earlier indices stable.
    "home_xg_for_avg5", "away_xg_for_avg5",
    "home_xg_against_avg5", "away_xg_against_avg5",
    "home_xg_overperformance", "away_xg_overperformance",
    "has_xg_data",
)

assert len(FEATURE_NAMES) == len(set(FEATURE_NAMES)), "duplicate feature names"

# ---------- market features: deliberately NOT in the default vector ----------
#
# These were in FEATURE_NAMES until 2026-08-08 and caused the worst bug in the
# project's history. They are built from `matches.odds_*`, populated for 96.1%
# of Wave A training rows — but `unified_inference` synthesises the live match
# row with `NULL AS odds_home, ...`, so every served prediction saw 0.0 where
# training saw a real market probability. Measured on 8,664 out-of-sample Wave A
# fixtures: .5801 Brier served WITH odds, .6561 served with zeros — a 9.5-point
# accuracy collapse to below the constant base rate. That is the entire
# 60.56%-holdout / 46%-live gap.
#
# The schema guard in unified_inference could never catch it: the feature NAMES
# matched perfectly, only the VALUES differed. See _assert_live_blocks_populated
# there for the guard that actually detects this class of bug.
#
# Two models, per docs/PIVOT_2026-08.md §3.1:
#   Model B (default, market-blind) — serves today, and is the ONLY thing that
#     may feed EV/Kelly. A model that reads the closing line agrees with it by
#     construction and can never find a +EV bet.
#   Model A (market-informed) — for the accuracy-optimised dashboard, and only
#     once a LIVE odds feed exists for upcoming fixtures. football-data.co.uk
#     publishes odds for played matches only, so Model A is not buildable today.
MARKET_FEATURE_NAMES: Tuple[str, ...] = (
    "implied_home_prob", "implied_draw_prob", "implied_away_prob",
    "implied_over_2_5", "market_overround",
    "implied_home_x_form",
)

FEATURE_NAMES_WITH_MARKET: Tuple[str, ...] = FEATURE_NAMES + MARKET_FEATURE_NAMES


# ---------- output containers ----------


@dataclass
class MatchContext:
    """Categorical IDs the model embeds (separately from the dense vector)."""
    league_id: int
    home_team_id: int
    away_team_id: int
    referee_id: int            # 0 = unknown
    phase_id: int              # PHASE_TO_IDX
    competition_id: str        # echo for logging
    gender: str                # 'M' / 'F'
    date_utc: str


@dataclass
class BuiltFeatures:
    """Result of `FeatureBuilderV2.build`."""
    dense: List[float]                # same length and order as FEATURE_NAMES
    context: MatchContext
    debug: Dict[str, float] = field(default_factory=dict)


# ---------- helpers ----------


def _coalesce(*xs) -> float:
    """Return the first non-None, non-NaN argument as float; else 0.0."""
    for x in xs:
        if x is None:
            continue
        try:
            f = float(x)
        except (TypeError, ValueError):
            continue
        if math.isnan(f):
            continue
        return f
    return 0.0


def _to_utc(value: str) -> datetime:
    s = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        # Fallback for legacy "YYYY-MM-DDTHH:MMZ" without :SS.
        dt = datetime.strptime(s.split("+")[0], "%Y-%m-%dT%H:%M")
        dt = dt.replace(tzinfo=timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _points_for_result(scored: int, conceded: int) -> int:
    if scored > conceded:
        return 3
    if scored == conceded:
        return 1
    return 0


def _safe_ratio(num: float, denom: float) -> float:
    if denom is None or denom == 0:
        return 0.5
    return num / denom


def _safe_div(num: float, denom: float, fallback: float = 0.0) -> float:
    if denom is None or denom == 0:
        return fallback
    return num / denom


# ---------- per-team rolling helpers ----------


@dataclass
class TeamRecentStats:
    """The slice of a team's history we need for one feature row.

    All numbers are computed *strictly before* `as_of_date` so there's no
    target leakage. Empty histories return all zeros — the model learns
    that's a "data missing" signal via the categorical embeddings.
    """
    games: int = 0
    points_5: float = 0.0
    points_10: float = 0.0
    weighted_form: float = 0.0
    goals_for_5: float = 0.0
    goals_against_5: float = 0.0
    goals_for_10: float = 0.0
    goals_against_10: float = 0.0
    clean_sheet_pct: float = 0.0
    goal_diff_per_game: float = 0.0
    home_win_pct: float = 0.0
    home_goals_avg: float = 0.0
    away_win_pct: float = 0.0
    away_goals_avg: float = 0.0
    streak: int = 0
    unbeaten_run: int = 0
    points_per_game: float = 0.0
    days_rest: float = 14.0
    matches_last_14d: int = 0
    shots_ratio: float = 0.5
    sot_ratio: float = 0.5
    discipline: float = 0.0
    corner_dom: float = 0.5
    # Expected-goals rolling stats. `xg_games` counts how many recent
    # matches actually had xG data — 0 means the block is all defaults.
    xg_games: int = 0
    xg_for_5: float = 0.0
    xg_against_5: float = 0.0
    xg_overperformance: float = 0.0  # (goals − xG) per game, recent window


def _fetch_team_history(
    conn: sqlite3.Connection,
    team_id: int,
    *,
    as_of_date: datetime,
    competition_id: Optional[str] = None,
    limit: int = 30,
) -> List[sqlite3.Row]:
    """Most-recent matches for `team_id` strictly before `as_of_date`.

    `competition_id` restricts the recent-form window to the same league —
    useful for home/away splits — but the function is called separately
    for "all competitions" and "this competition" so the model can see
    both views.
    """
    clauses = ["(m.home_team_id = ? OR m.away_team_id = ?)", "m.date_utc < ?"]
    args: List = [team_id, team_id, as_of_date.isoformat()]
    if competition_id:
        clauses.append("m.competition_id = ?")
        args.append(competition_id)
    sql = (
        "SELECT m.*, w.temp_c, w.precip_mm, w.wind_kmh "
        "FROM matches m LEFT JOIN weather w ON w.match_id = m.match_id "
        "WHERE " + " AND ".join(clauses) +
        " ORDER BY m.date_utc DESC LIMIT ?"
    )
    args.append(limit)
    return conn.execute(sql, args).fetchall()


def _compute_team_stats(
    rows: Sequence[sqlite3.Row],
    *,
    team_id: int,
    as_of_date: datetime,
) -> TeamRecentStats:
    s = TeamRecentStats()
    if not rows:
        return s

    s.games = len(rows)

    points_last_n: List[int] = []
    goals_for_n: List[int] = []
    goals_against_n: List[int] = []
    xg_for_n: List[float] = []
    xg_against_n: List[float] = []
    xg_goal_delta: List[float] = []
    clean_sheets = 0
    home_games = away_games = 0
    home_wins = away_wins = 0
    home_goals_sum = away_goals_sum = 0
    shots_for = shots_against = 0.0
    sot_for = sot_against = 0.0
    corners_for = corners_against = 0.0
    cards = 0.0
    games_with_stats = 0

    most_recent_date: Optional[datetime] = None
    matches_in_14d = 0

    # Streak & unbeaten: walk most-recent-first.
    streak = 0
    streak_sign = 0
    unbeaten = 0

    for row in rows:
        played_at = _to_utc(row["date_utc"])
        if most_recent_date is None:
            most_recent_date = played_at
        if (as_of_date - played_at).days <= 14:
            matches_in_14d += 1

        is_home = row["home_team_id"] == team_id
        team_goals = row["home_score"] if is_home else row["away_score"]
        opp_goals = row["away_score"] if is_home else row["home_score"]
        if team_goals is None or opp_goals is None:
            continue

        points_last_n.append(_points_for_result(team_goals, opp_goals))
        goals_for_n.append(team_goals)
        goals_against_n.append(opp_goals)
        team_xg = row["home_xg"] if is_home else row["away_xg"]
        opp_xg = row["away_xg"] if is_home else row["home_xg"]
        if team_xg is not None and opp_xg is not None:
            xg_for_n.append(float(team_xg))
            xg_against_n.append(float(opp_xg))
            xg_goal_delta.append(float(team_goals) - float(team_xg))
        if opp_goals == 0:
            clean_sheets += 1
        if is_home:
            home_games += 1
            home_goals_sum += team_goals
            if team_goals > opp_goals:
                home_wins += 1
        else:
            away_games += 1
            away_goals_sum += team_goals
            if team_goals > opp_goals:
                away_wins += 1

        # Tactical rolling — needs both sides of the row available.
        hs = row["home_shots"]; as_ = row["away_shots"]
        hsot = row["home_sot"]; asot = row["away_sot"]
        hcorners = row["home_corners"]; acorners = row["away_corners"]
        team_yellows = row["home_yellows"] if is_home else row["away_yellows"]
        team_reds = row["home_reds"] if is_home else row["away_reds"]

        if hs is not None and as_ is not None and (hs + as_) > 0:
            ratio = (hs if is_home else as_) / (hs + as_)
            shots_for += ratio
            shots_against += 1 - ratio
        if hsot is not None and asot is not None and (hsot + asot) > 0:
            ratio = (hsot if is_home else asot) / (hsot + asot)
            sot_for += ratio
        if hcorners is not None and acorners is not None and (hcorners + acorners) > 0:
            ratio = (hcorners if is_home else acorners) / (hcorners + acorners)
            corners_for += ratio
        if team_yellows is not None or team_reds is not None:
            cards += (team_yellows or 0) + 3.0 * (team_reds or 0)

        if hs is not None or hsot is not None or hcorners is not None:
            games_with_stats += 1

    # Roll-up windows
    s.points_5 = float(sum(points_last_n[:5]))
    s.points_10 = float(sum(points_last_n[:10]))
    s.weighted_form = sum(p * (0.5 ** i) for i, p in enumerate(points_last_n[:10]))
    s.goals_for_5 = sum(goals_for_n[:5]) / max(1, len(goals_for_n[:5]))
    s.goals_against_5 = sum(goals_against_n[:5]) / max(1, len(goals_against_n[:5]))
    s.goals_for_10 = sum(goals_for_n[:10]) / max(1, len(goals_for_n[:10]))
    s.goals_against_10 = sum(goals_against_n[:10]) / max(1, len(goals_against_n[:10]))
    s.clean_sheet_pct = clean_sheets / max(1, len(rows))
    s.goal_diff_per_game = (
        sum(goals_for_n) - sum(goals_against_n)
    ) / max(1, len(goals_for_n))
    s.points_per_game = sum(points_last_n) / max(1, len(points_last_n))

    s.home_win_pct = home_wins / home_games if home_games else 0.0
    s.away_win_pct = away_wins / away_games if away_games else 0.0
    s.home_goals_avg = home_goals_sum / home_games if home_games else 0.0
    s.away_goals_avg = away_goals_sum / away_games if away_games else 0.0

    s.matches_last_14d = matches_in_14d
    if most_recent_date is not None:
        s.days_rest = float(max(0.0, (as_of_date - most_recent_date).total_seconds() / 86400.0))

    # Streak: encode as +N for current winning run, -N for losing run, 0 for current draw.
    streak = 0
    streak_sign = 0
    for p in points_last_n:
        sign = 1 if p == 3 else (-1 if p == 0 else 0)
        if sign == 0 or (streak_sign != 0 and sign != streak_sign):
            break
        if sign == 0:  # draw breaks both winning and losing streaks
            break
        if streak_sign == 0:
            streak_sign = sign
        streak += 1
    s.streak = streak * (streak_sign if streak_sign != 0 else 0)

    unbeaten = 0
    for p in points_last_n:
        if p == 0:
            break
        unbeaten += 1
    s.unbeaten_run = unbeaten

    if games_with_stats > 0:
        s.shots_ratio = shots_for / games_with_stats
        s.sot_ratio = sot_for / games_with_stats
        s.corner_dom = corners_for / games_with_stats
        s.discipline = cards / games_with_stats

    # xG rolling stats over matches that carry xG (most-recent-first lists).
    s.xg_games = len(xg_for_n)
    if xg_for_n:
        s.xg_for_5 = sum(xg_for_n[:5]) / len(xg_for_n[:5])
        s.xg_against_5 = sum(xg_against_n[:5]) / len(xg_against_n[:5])
        s.xg_overperformance = sum(xg_goal_delta[:10]) / len(xg_goal_delta[:10])

    return s


def _fetch_h2h_history(
    conn: sqlite3.Connection,
    home_team_id: int,
    away_team_id: int,
    *,
    as_of_date: datetime,
    limit: int = 10,
) -> List[sqlite3.Row]:
    return conn.execute(
        """
        SELECT * FROM matches
        WHERE ((home_team_id = ? AND away_team_id = ?)
               OR (home_team_id = ? AND away_team_id = ?))
          AND date_utc < ?
        ORDER BY date_utc DESC
        LIMIT ?
        """,
        (home_team_id, away_team_id, away_team_id, home_team_id, as_of_date.isoformat(), limit),
    ).fetchall()


def _h2h_features(rows: Sequence[sqlite3.Row], home_id: int, away_id: int) -> Dict[str, float]:
    if not rows:
        return {
            "h2h_matches": 0.0,
            "h2h_home_advantage": 0.0,
            "h2h_avg_total_goals": 0.0,
            "h2h_home_xg_advantage": 0.0,
            "away_road_vs_opp_ppg": 1.0,
        }
    home_wins = 0
    away_wins = 0
    draws = 0
    total_goals = 0
    xg_balance = 0.0
    away_team_visits = 0
    away_team_points_on_road = 0

    for r in rows:
        hs = r["home_score"]; as_ = r["away_score"]
        if hs is None or as_ is None:
            continue
        total_goals += hs + as_
        # Normalise so "home" / "away" are from the perspective of the *current* fixture.
        if r["home_team_id"] == home_id:
            if hs > as_:
                home_wins += 1
            elif hs < as_:
                away_wins += 1
            else:
                draws += 1
            if r["home_xg"] is not None and r["away_xg"] is not None:
                xg_balance += r["home_xg"] - r["away_xg"]
        else:
            # Roles flipped in the historical row.
            if as_ > hs:
                home_wins += 1
            elif as_ < hs:
                away_wins += 1
            else:
                draws += 1
            if r["home_xg"] is not None and r["away_xg"] is not None:
                xg_balance += r["away_xg"] - r["home_xg"]

        # Away team's road performance specifically against this opponent
        if r["away_team_id"] == away_id:
            away_team_visits += 1
            away_team_points_on_road += _points_for_result(as_, hs)

    n = len(rows)
    return {
        "h2h_matches": float(min(n, 10)),
        "h2h_home_advantage": (home_wins - away_wins) / n,
        "h2h_avg_total_goals": total_goals / n,
        "h2h_home_xg_advantage": xg_balance / n,
        "away_road_vs_opp_ppg": away_team_points_on_road / max(1, away_team_visits),
    }


def _latest_clubelo(conn: sqlite3.Connection, team_id: int, as_of: datetime) -> Optional[float]:
    row = conn.execute(
        """SELECT elo FROM clubelo_ratings WHERE team_id = ? AND date <= ?
           ORDER BY date DESC LIMIT 1""",
        (team_id, as_of.date().isoformat()),
    ).fetchone()
    return float(row["elo"]) if row else None


_EARTH_RADIUS_KM = 6371.0088


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two venue coordinates."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _venue_coords(
    conn: sqlite3.Connection, team_id: int
) -> Optional[Tuple[float, float]]:
    row = conn.execute(
        "SELECT venue_lat, venue_lon FROM teams WHERE team_id = ?", (team_id,)
    ).fetchone()
    if row is None or row["venue_lat"] is None or row["venue_lon"] is None:
        return None
    return float(row["venue_lat"]), float(row["venue_lon"])


def _away_travel_km(
    conn: sqlite3.Connection, home_id: int, away_id: int
) -> Optional[float]:
    """How far the away side travelled, home venue to home venue.

    Approximates the trip by the distance between the two clubs' own grounds,
    which is exact for a normal league fixture and wrong only for a neutral
    venue — of which Wave A has none. Returns None when either club has no
    coordinates rather than a plausible zero: a real 0 km means a derby, and
    conflating "derby" with "unknown" is the kind of quiet imputation the
    standing rules forbid.
    """
    a = _venue_coords(conn, home_id)
    b = _venue_coords(conn, away_id)
    if a is None or b is None:
        return None
    return _haversine_km(a[0], a[1], b[0], b[1])


def _league_id_map(warehouse: Warehouse) -> Dict[str, int]:
    """Return a {competition_id: dense_id} mapping using insertion order.

    The model treats this as a vocabulary — IDs are assigned the first
    time a competition shows up and must stay stable across retrains. We
    store the mapping with the model checkpoint.
    """
    rows = warehouse._conn.execute(  # noqa: SLF001
        "SELECT competition_id FROM competitions ORDER BY competition_id"
    ).fetchall()
    return {row["competition_id"]: i + 1 for i, row in enumerate(rows)}  # 0 reserved for unknown


# ---------- the builder itself ----------


class FeatureBuilderV2:
    """Build a single feature row for a known fixture from the warehouse.

    Typical usage at training time::

        builder = FeatureBuilderV2(warehouse, vocabularies)
        for row in warehouse.iter_matches(gender='M'):
            built = builder.build_from_row(row)
            ...

    At inference, callers supply a synthetic match row with `home_score`/
    `away_score` set to None — the builder ignores those (they're never
    features) and computes everything else from history that ends strictly
    before `date_utc`.
    """

    def __init__(
        self,
        warehouse: Warehouse,
        *,
        league_id_map: Optional[Dict[str, int]] = None,
        team_id_map: Optional[Dict[int, int]] = None,
        referee_id_map: Optional[Dict[int, int]] = None,
    ):
        self.warehouse = warehouse
        self.conn = warehouse._conn  # noqa: SLF001 — same-package use
        self.league_id_map = league_id_map or _league_id_map(warehouse)
        self.team_id_map = team_id_map or {}
        self.referee_id_map = referee_id_map or {}

    def vocab_dims(self) -> Tuple[int, int, int]:
        """Return (n_leagues, n_teams, n_referees) including the unknown bucket."""
        n_leagues = max(self.league_id_map.values(), default=0) + 1
        n_teams = max(self.team_id_map.values(), default=0) + 1
        n_referees = max(self.referee_id_map.values(), default=0) + 1
        return n_leagues, n_teams, n_referees

    def encode_team(self, raw_team_id: int) -> int:
        if raw_team_id not in self.team_id_map:
            self.team_id_map[raw_team_id] = len(self.team_id_map) + 1  # 0 reserved
        return self.team_id_map[raw_team_id]

    def encode_referee(self, raw_referee_id: Optional[int]) -> int:
        if raw_referee_id is None:
            return 0
        if raw_referee_id not in self.referee_id_map:
            self.referee_id_map[raw_referee_id] = len(self.referee_id_map) + 1
        return self.referee_id_map[raw_referee_id]

    def encode_league(self, competition_id: str) -> int:
        return self.league_id_map.get(competition_id, 0)

    def encode_phase(self, phase: Optional[str]) -> int:
        if not phase:
            return PHASE_TO_IDX["league"]
        key = phase.lower().replace("-", "_")
        if "round-of-16" in (phase or "").lower() or "round_of_16" in key:
            return PHASE_TO_IDX["round_of_16"]
        for name in PHASE_TO_IDX:
            if name in key:
                return PHASE_TO_IDX[name]
        return PHASE_TO_IDX["league"]

    def build_from_row(self, match_row: sqlite3.Row) -> BuiltFeatures:
        as_of = _to_utc(match_row["date_utc"])
        home_id = int(match_row["home_team_id"])
        away_id = int(match_row["away_team_id"])
        comp_id = match_row["competition_id"]

        # --- recent stats (last 30 across all comps) ---
        home_rows = _fetch_team_history(self.conn, home_id, as_of_date=as_of, limit=30)
        away_rows = _fetch_team_history(self.conn, away_id, as_of_date=as_of, limit=30)
        home_stats = _compute_team_stats(home_rows, team_id=home_id, as_of_date=as_of)
        away_stats = _compute_team_stats(away_rows, team_id=away_id, as_of_date=as_of)

        # --- venue splits restricted to this competition ---
        home_comp_rows = _fetch_team_history(
            self.conn, home_id, as_of_date=as_of, competition_id=comp_id, limit=20
        )
        away_comp_rows = _fetch_team_history(
            self.conn, away_id, as_of_date=as_of, competition_id=comp_id, limit=20
        )
        home_comp_stats = _compute_team_stats(home_comp_rows, team_id=home_id, as_of_date=as_of)
        away_comp_stats = _compute_team_stats(away_comp_rows, team_id=away_id, as_of_date=as_of)

        # --- H2H ---
        h2h_rows = _fetch_h2h_history(self.conn, home_id, away_id, as_of_date=as_of, limit=10)
        h2h = _h2h_features(h2h_rows, home_id, away_id)

        # --- ELO from ClubElo (men only) with fallback to a flat 1500 ---
        elo_home = _coalesce(_latest_clubelo(self.conn, home_id, as_of), 1500.0)
        elo_away = _coalesce(_latest_clubelo(self.conn, away_id, as_of), 1500.0)
        elo_diff = elo_home - elo_away

        # --- season progress: how deep in the season are we? ---
        season = int(match_row["season"] or 0)
        if season:
            # Crude but fine: northern-hemisphere seasons run Aug → May.
            season_start = datetime(season, 8, 1, tzinfo=timezone.utc)
            season_end = datetime(season + 1, 5, 31, tzinfo=timezone.utc)
            season_progress = max(
                0.0, min(1.0, (as_of - season_start).days / max(1, (season_end - season_start).days))
            )
        else:
            season_progress = 0.5

        # --- weather (rows are pre-joined into team-history queries; pull again for THIS match) ---
        weather_row = self.conn.execute(
            "SELECT * FROM weather WHERE match_id = ?", (match_row["match_id"],)
        ).fetchone()
        weather_features = {
            "weather_temp_c": _coalesce(weather_row and weather_row["temp_c"], 15.0),
            "weather_precip_mm": _coalesce(weather_row and weather_row["precip_mm"], 0.0),
            "weather_wind_kmh": _coalesce(weather_row and weather_row["wind_kmh"], 10.0),
            "weather_humidity": _coalesce(weather_row and weather_row["humidity"], 65.0),
            "is_outdoor_venue": 1.0 if (weather_row is None or weather_row["is_outdoor"]) else 0.0,
        }

        # --- referee tendencies (rolling) ---
        ref_id = match_row["referee_id"]
        referee_features = self._referee_stats(ref_id, as_of)

        # --- market-implied probs from odds (may be NULL for many matches) ---
        market = self._market_implied(match_row)

        # --- player_form table is sparse; pull what's there ---

        # --- motivation: heuristic from season_progress and tier ---
        comp_tier = self.conn.execute(
            "SELECT tier FROM competitions WHERE competition_id = ?", (comp_id,)
        ).fetchone()
        tier = (comp_tier and comp_tier["tier"]) or 1
        motivation_home = motivation_away = (
            (1.0 if season_progress > 0.7 else 0.5) * (1.0 if tier == 0 else 0.6)
        )

        # --- phase / cup context ---
        phase_raw = match_row["phase"]
        is_knockout = 1.0 if (phase_raw and any(k in str(phase_raw).lower() for k in (
            "knock", "final", "semifinal", "quarterfinal", "round_of_16", "round-of-16", "playoff"
        ))) else 0.0
        # 2-leg flag: turn on for UEFA competition knockout rounds.
        is_2leg = 1.0 if ("uefa" in comp_id and is_knockout > 0) else 0.0

        # --- assemble dense vector in canonical order ---
        feat = {
            "elo_home": elo_home,
            "elo_away": elo_away,
            "elo_diff": abs(elo_diff),
            "elo_diff_signed": elo_diff,

            "home_form_5_pts": home_stats.points_5,
            "away_form_5_pts": away_stats.points_5,
            "home_form_10_pts": home_stats.points_10,
            "away_form_10_pts": away_stats.points_10,
            "home_weighted_form": home_stats.weighted_form,
            "away_weighted_form": away_stats.weighted_form,
            "home_goals_for_avg5": home_stats.goals_for_5,
            "away_goals_for_avg5": away_stats.goals_for_5,
            "home_goals_against_avg5": home_stats.goals_against_5,
            "away_goals_against_avg5": away_stats.goals_against_5,
            "home_goals_for_avg10": home_stats.goals_for_10,
            "away_goals_for_avg10": away_stats.goals_for_10,
            "home_clean_sheet_pct": home_stats.clean_sheet_pct,
            "away_clean_sheet_pct": away_stats.clean_sheet_pct,
            "home_goal_diff_per_game": home_stats.goal_diff_per_game,
            "away_goal_diff_per_game": away_stats.goal_diff_per_game,

            "home_home_win_pct": home_comp_stats.home_win_pct,
            "away_away_win_pct": away_comp_stats.away_win_pct,
            "home_home_goals_avg": home_comp_stats.home_goals_avg,
            "away_away_goals_avg": away_comp_stats.away_goals_avg,

            **h2h,

            "season_progress": season_progress,
            "home_matchday_norm": season_progress,  # proxy until we wire MD#
            "away_matchday_norm": season_progress,
            "home_streak": float(home_stats.streak),
            "away_streak": float(away_stats.streak),
            "home_unbeaten_run": float(home_stats.unbeaten_run),
            "away_unbeaten_run": float(away_stats.unbeaten_run),
            "home_minus_away_points": home_stats.points_per_game - away_stats.points_per_game,

            "home_shots_ratio": home_stats.shots_ratio,
            "away_shots_ratio": away_stats.shots_ratio,
            "home_sot_ratio": home_stats.sot_ratio,
            "away_sot_ratio": away_stats.sot_ratio,
            "home_discipline_score": home_stats.discipline,
            "away_discipline_score": away_stats.discipline,
            "home_corner_dominance": home_stats.corner_dom,
            "away_corner_dominance": away_stats.corner_dom,

            **market,

            "home_days_rest": home_stats.days_rest,
            "away_days_rest": away_stats.days_rest,
            "rest_diff": home_stats.days_rest - away_stats.days_rest,
            "home_matches_last_14d": float(home_stats.matches_last_14d),
            "away_matches_last_14d": float(away_stats.matches_last_14d),
            "is_midweek": 1.0 if as_of.weekday() in (1, 2, 3) else 0.0,
            "season_stage": season_progress,

            **weather_features,
            **referee_features,

            # Real now that `teams` carries venue coordinates: 100% of Wave A
            # fixtures resolve. It was hardcoded 0.0 for every row, so the
            # dimension was dead weight in training and in serving alike.
            # Scaled to thousands of km so it sits in the same rough range as
            # the other continuous features instead of dominating them.
            "away_travel_km": _coalesce(
                _away_travel_km(self.conn, home_id, away_id), 0.0
            ) / 1000.0,
            "is_neutral_venue": 1.0 if is_knockout and tier == 0 else 0.0,

            "is_knockout": is_knockout,
            "is_2leg_aggregate": is_2leg,
            "home_motivation": motivation_home,
            "away_motivation": motivation_away,

            "elo_x_form_diff": elo_diff * (home_stats.points_5 - away_stats.points_5),
            "elo_x_h2h": elo_diff * h2h["h2h_home_advantage"],
            "implied_home_x_form": market["implied_home_prob"] * home_stats.points_5,

            "home_xg_for_avg5": home_stats.xg_for_5,
            "away_xg_for_avg5": away_stats.xg_for_5,
            "home_xg_against_avg5": home_stats.xg_against_5,
            "away_xg_against_avg5": away_stats.xg_against_5,
            "home_xg_overperformance": home_stats.xg_overperformance,
            "away_xg_overperformance": away_stats.xg_overperformance,
            # Trustworthy only when both sides have a real xG sample.
            "has_xg_data": 1.0 if min(home_stats.xg_games, away_stats.xg_games) >= 3 else 0.0,
        }

        # Final fixed-order vector.
        dense = [float(feat.get(name, 0.0)) for name in FEATURE_NAMES]

        gender_row = self.conn.execute(
            "SELECT gender FROM competitions WHERE competition_id = ?", (comp_id,)
        ).fetchone()
        gender = (gender_row and gender_row["gender"]) or "M"

        context = MatchContext(
            league_id=self.encode_league(comp_id),
            home_team_id=self.encode_team(home_id),
            away_team_id=self.encode_team(away_id),
            referee_id=self.encode_referee(ref_id),
            phase_id=self.encode_phase(phase_raw),
            competition_id=comp_id,
            gender=gender,
            date_utc=match_row["date_utc"],
        )
        return BuiltFeatures(dense=dense, context=context)

    # ---- per-section helpers ----

    def _referee_stats(self, referee_id: Optional[int], as_of: datetime) -> Dict[str, float]:
        """Rolling cards/home-win/draw rate over a referee's last 30 matches."""
        if referee_id is None:
            return {
                "referee_avg_cards": 3.5,
                "referee_home_win_rate": 0.45,
                "referee_draw_rate": 0.25,
            }
        rows = self.conn.execute(
            """SELECT home_yellows, away_yellows, home_reds, away_reds,
                      home_score, away_score
               FROM matches WHERE referee_id = ? AND date_utc < ?
               ORDER BY date_utc DESC LIMIT 30""",
            (referee_id, as_of.isoformat()),
        ).fetchall()
        if not rows:
            return {
                "referee_avg_cards": 3.5,
                "referee_home_win_rate": 0.45,
                "referee_draw_rate": 0.25,
            }
        cards = 0.0
        valid = 0
        home_wins = 0
        draws = 0
        for r in rows:
            if r["home_yellows"] is not None and r["away_yellows"] is not None:
                cards += (r["home_yellows"] or 0) + (r["away_yellows"] or 0)
                cards += 3.0 * ((r["home_reds"] or 0) + (r["away_reds"] or 0))
                valid += 1
            if r["home_score"] is not None and r["away_score"] is not None:
                if r["home_score"] > r["away_score"]:
                    home_wins += 1
                elif r["home_score"] == r["away_score"]:
                    draws += 1
        return {
            "referee_avg_cards": cards / max(1, valid),
            "referee_home_win_rate": home_wins / len(rows),
            "referee_draw_rate": draws / len(rows),
        }

    def _market_implied(self, match_row: sqlite3.Row) -> Dict[str, float]:
        oh = match_row["odds_home"]; od = match_row["odds_draw"]; oa = match_row["odds_away"]
        ou = match_row["odds_over_2_5"]
        if oh is None or od is None or oa is None or oh <= 0 or od <= 0 or oa <= 0:
            return {
                "implied_home_prob": 0.0,
                "implied_draw_prob": 0.0,
                "implied_away_prob": 0.0,
                "implied_over_2_5": 0.0,
                "market_overround": 0.0,
            }
        inv_h, inv_d, inv_a = 1.0 / oh, 1.0 / od, 1.0 / oa
        total = inv_h + inv_d + inv_a
        return {
            "implied_home_prob": inv_h / total,
            "implied_draw_prob": inv_d / total,
            "implied_away_prob": inv_a / total,
            "implied_over_2_5": (1.0 / ou) if (ou and ou > 0) else 0.0,
            "market_overround": total - 1.0,
        }

__all__ = ["FEATURE_NAMES", "FeatureBuilderV2", "BuiltFeatures", "MatchContext"]
