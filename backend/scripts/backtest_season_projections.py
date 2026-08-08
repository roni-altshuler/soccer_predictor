#!/usr/bin/env python3
"""Matchday-by-matchday backtest of the Monte Carlo season projections.

PIVOT_2026-08 §4: ``backend/services/simulation/league_simulator.py`` has been
emitting ``title_probability`` / ``relegation_probability`` /
``top_4_probability`` / ``avg_final_position`` to users for months with **no
backtest, no calibration and no diagnostics artifact**. This script is the
missing measurement.

What it does
------------
For every *completed* season of the Wave A leagues (PIVOT §5: eng.1, esp.1,
ger.1, fra.1, ita.1) found in the warehouse:

1. Replay the season matchday by matchday.
2. At each cut, rebuild the table exactly as it stood, hand the simulator the
   standings plus the *remaining* fixture list, and record the projected
   distributions (title, relegation, top-4, expected final position).
3. Score those projections against what actually happened at season end.

Scored per league-season and aggregated by matchday number across seasons:

* **Brier** on the title projection (per-team binary: did this team win it),
* **Brier** on the relegation projection (bottom 3, matching the simulator's
  own hardcoded definition) and on top-4,
* **MAE** of projected final position vs actual final position,
* **Log loss** on the title race as one multiclass event over the teams,
* a 10-bucket **reliability table** pooled over every projection probability —
  when the simulator says 30%, does it happen 30% of the time?

The headline output is the **convergence curve**: every metric as a function of
matchday, pooled across seasons and leagues, which answers the actual product
question — *after how many matchdays is the projection trustworthy?*

The naive baseline
------------------
At every single cut the same season state is also scored under "the table
never changes again": whoever is top today wins the league, whoever is in the
bottom three today goes down, every team finishes where it stands. A
projection that cannot beat that is worthless, so the artifact reports the
simulator's margin over it at every matchday. The baseline is a hard 0/1
forecast, so its log loss is dominated by the probability clip (see
``--log-loss-eps``) whenever the current leader is not the eventual champion —
that is a real property of a degenerate forecast, not an artefact.

Leakage
-------
The shipped ``get_elo_system()`` singleton is pre-seeded with *today's* team
strengths (Manchester City 1950, …). Feeding that to a replay of the 2018
season is leakage. The default ``--elo point-in-time`` therefore rebuilds Elo
from warehouse results *strictly before each cut date*, starting every team at
1500. ``--elo preseeded`` reproduces the as-shipped behaviour for comparison
and is flagged in the artifact as leaky.

Honesty
-------
The warehouse is gitignored and may be empty, partial or mid-rebuild. This
script NEVER writes to it (strictly read-only handle), never invents a
fixture, and never scores a season it cannot verify is complete. Seasons that
fail the completeness gate are skipped and listed with their reason in
``coverage.seasons_skipped``. An empty warehouse produces a valid artifact
reporting zero coverage rather than a crash or a fabricated number.

Run
---
    python -m backend.scripts.backtest_season_projections
    python -m backend.scripts.backtest_season_projections --league eng.1 --season 2023
    python -m backend.scripts.backtest_season_projections --iterations 2000 --seasons 5

Output: ``backend/data/diagnostics/season_projection_backtest.json``
"""

from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from backend.services.ratings.elo import (  # noqa: E402
    ALL_TEAM_RATINGS,
    EloRatingSystem,
)
from backend.services.simulation.league_simulator import (  # noqa: E402
    LeagueSimulator,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WAREHOUSE_PATH = ROOT / "backend" / "data" / "warehouse.sqlite"
DEFAULT_OUTPUT = (
    ROOT / "backend" / "data" / "diagnostics" / "season_projection_backtest.json"
)

# PIVOT_2026-08 §5, Wave A. Nothing outside this list is in the product.
WAVE_A: Dict[str, str] = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "fra.1": "Ligue 1",
    "ita.1": "Serie A",
}

# The simulator hardcodes relegation as the bottom 3 and Europe as the top 4
# (league_simulator.py:246-251). Scoring MUST use the simulator's own
# definitions or the Brier scores measure the wrong event. Real Bundesliga /
# Ligue 1 seasons with a relegation play-off differ; that is recorded as a
# caveat in the artifact rather than silently patched.
RELEGATION_SLOTS = 3
TOP_N_EUROPE = 4

N_BINS = 10
DEFAULT_LOG_LOSS_EPS = 1e-6
DEFAULT_ITERATIONS = 1000
DEFAULT_SEASONS = 3
DEFAULT_MIN_COMPLETENESS = 0.95
DEFAULT_SEED = 20260808

# A season only counts as finished once its last match is this far in the past.
SEASON_COMPLETE_GRACE_DAYS = 21

# Cross-league convergence axis: 20 buckets of 5% of the season each, so an
# 18-team Bundesliga (34 rounds) and a 20-team Premier League (38 rounds) land
# on a shared x-axis.
FRACTION_BUCKETS = 20

METRIC_KEYS: Tuple[str, ...] = (
    "title_brier",
    "relegation_brier",
    "top_4_brier",
    "position_mae",
    "title_log_loss",
    "champion_hit",
    "relegation_recall",
)

# Lower is better for these; the margin is baseline - simulator.
LOWER_IS_BETTER: Tuple[str, ...] = (
    "title_brier",
    "relegation_brier",
    "top_4_brier",
    "position_mae",
    "title_log_loss",
)


# ---------------------------------------------------------------------------
# Small numeric helpers
# ---------------------------------------------------------------------------
def _finite(x: Any) -> Optional[float]:
    """JSON-safe float: NaN / inf / None all collapse to null."""
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, 6)


def mean_or_none(values: Iterable[Optional[float]]) -> Optional[float]:
    vals = [float(v) for v in values if v is not None and not math.isnan(float(v))]
    if not vals:
        return None
    return sum(vals) / len(vals)


# ---------------------------------------------------------------------------
# Standings construction
# ---------------------------------------------------------------------------
def build_table(
    matches: Sequence[Dict[str, Any]],
    teams: Optional[Iterable[str]] = None,
) -> List[Dict[str, Any]]:
    """League table after ``matches``, ordered by (points, GD, GF, name).

    ``teams`` seeds the table so that clubs which have not played yet still
    appear on zero points — required at matchday 0 and whenever a fixture is
    postponed. 3 points a win, 1 a draw.

    The name tiebreak is deterministic but arbitrary; real leagues break ties
    on head-to-head (Spain, Italy) or goals scored (England). Ties for the
    title or the final relegation place are rare enough that this does not
    move the Brier scores, and using one rule for the projected and the actual
    table keeps the comparison self-consistent.
    """
    stats: Dict[str, Dict[str, int]] = {}

    def _row(name: str) -> Dict[str, int]:
        return stats.setdefault(
            name,
            {"played": 0, "won": 0, "drawn": 0, "lost": 0, "gf": 0, "ga": 0, "points": 0},
        )

    for name in teams or ():
        _row(name)

    for m in matches:
        hs, as_ = m.get("home_score"), m.get("away_score")
        if hs is None or as_ is None:
            continue
        home, away = _row(m["home"]), _row(m["away"])
        hs, as_ = int(hs), int(as_)
        home["played"] += 1
        away["played"] += 1
        home["gf"] += hs
        home["ga"] += as_
        away["gf"] += as_
        away["ga"] += hs
        if hs > as_:
            home["won"] += 1
            away["lost"] += 1
            home["points"] += 3
        elif hs < as_:
            away["won"] += 1
            home["lost"] += 1
            away["points"] += 3
        else:
            home["drawn"] += 1
            away["drawn"] += 1
            home["points"] += 1
            away["points"] += 1

    rows = [
        {
            "team": name,
            "played": s["played"],
            "won": s["won"],
            "drawn": s["drawn"],
            "lost": s["lost"],
            "goals_for": s["gf"],
            "goals_against": s["ga"],
            "goal_diff": s["gf"] - s["ga"],
            "points": s["points"],
        }
        for name, s in stats.items()
    ]
    rows.sort(key=lambda r: (-r["points"], -r["goal_diff"], -r["goals_for"], r["team"]))
    for i, r in enumerate(rows, 1):
        r["position"] = i
    return rows


def simulator_standings(table: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Translate a table row into the dict shape ``simulate_league`` reads.

    ``LeagueSimulator`` looks for ``name``/``team_name``, ``idx``/``position``,
    ``pts``/``points``, ``played`` and ``goalConDiff``/``goal_diff`` (it uses
    ``or`` chains, so the FotMob-style keys must be absent, not zero).
    """
    return [
        {
            "name": r["team"],
            "position": r["position"],
            "points": r["points"],
            "played": r["played"],
            "goal_diff": r["goal_diff"],
        }
        for r in table
    ]


def actual_outcome(final_table: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Ground truth for one finished season, using the simulator's definitions."""
    if not final_table:
        raise ValueError("final_table is empty")
    n = len(final_table)
    return {
        "champion": final_table[0]["team"],
        "relegated": {r["team"] for r in final_table[n - RELEGATION_SLOTS :]},
        "top_4": {r["team"] for r in final_table[:TOP_N_EUROPE]},
        "position": {r["team"]: r["position"] for r in final_table},
    }


def matchday_blocks(
    matches: Sequence[Dict[str, Any]], max_gap_days: int = 1
) -> List[List[Dict[str, Any]]]:
    """Group season fixtures into matchday-like blocks by calendar gap.

    Consecutive fixture *dates* separated by at most ``max_gap_days`` blank
    days belong to the same block; a longer gap opens the next one. This
    mirrors ``backend/scripts/_backtest_core.matchday_blocks`` so that this
    artifact and the match-prediction walk-forward count matchdays the same
    way, and it reconstructs Fri-Mon weekend rounds and midweek rounds without
    the warehouse needing a round column.
    """
    blocks: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    prev_day: Optional[datetime] = None
    for m in matches:
        day = datetime.fromisoformat(str(m["date_utc"])[:10])
        if prev_day is not None and (day - prev_day).days > max_gap_days:
            blocks.append(current)
            current = []
        current.append(m)
        prev_day = day
    if current:
        blocks.append(current)
    return blocks


# ---------------------------------------------------------------------------
# Scoring primitives
# ---------------------------------------------------------------------------
def brier_score(probs: Dict[str, float], positives: Set[str]) -> float:
    """Mean over teams of (p_team - y_team)^2, y = 1 if the event happened.

    This is the per-team binary Brier averaged across the league, so a
    20-team and an 18-team league are on the same scale. 0 is perfect.
    """
    if not probs:
        raise ValueError("probs is empty")
    unknown = positives - set(probs)
    if unknown:
        raise ValueError(f"positives not present in probs: {sorted(unknown)}")
    total = 0.0
    for team, p in probs.items():
        y = 1.0 if team in positives else 0.0
        total += (float(p) - y) ** 2
    return total / len(probs)


def multiclass_log_loss(
    probs: Dict[str, float], winner: str, eps: float = DEFAULT_LOG_LOSS_EPS
) -> float:
    """-log P(actual champion), treating the title race as one multiclass event.

    Probabilities are clipped to ``eps`` and renormalised first: the Monte
    Carlo output is rounded to 4dp and need not sum to exactly 1, and a
    deterministic baseline assigns a literal zero to the eventual champion
    whenever it calls the wrong leader.
    """
    if not probs:
        raise ValueError("probs is empty")
    if winner not in probs:
        raise ValueError(f"winner {winner!r} not present in probs")
    clipped = {t: max(float(p), eps) for t, p in probs.items()}
    total = sum(clipped.values())
    if total <= 0:
        raise ValueError("probabilities sum to zero")
    return -math.log(clipped[winner] / total)


def position_mae(
    projected: Dict[str, float], actual: Dict[str, int]
) -> float:
    """Mean absolute error of expected final position vs actual final position."""
    if not projected:
        raise ValueError("projected is empty")
    missing = set(projected) - set(actual)
    if missing:
        raise ValueError(f"no actual position for: {sorted(missing)}")
    return sum(abs(float(p) - actual[t]) for t, p in projected.items()) / len(projected)


def top_k_recall(probs: Dict[str, float], positives: Set[str], k: int) -> float:
    """Share of the teams that really did it which rank in the top ``k`` by p."""
    if not positives:
        return float("nan")
    ranked = sorted(probs, key=lambda t: (-float(probs[t]), t))[:k]
    return len(positives & set(ranked)) / len(positives)


class CalibrationAccumulator:
    """10-bucket reliability table over an arbitrary stream of (p, y) pairs."""

    def __init__(self, n_bins: int = N_BINS):
        self.n_bins = n_bins
        self.counts = [0] * n_bins
        self.pred_sum = [0.0] * n_bins
        self.obs_sum = [0.0] * n_bins

    def add(self, p: float, y: bool) -> None:
        p = min(max(float(p), 0.0), 1.0)
        b = min(self.n_bins - 1, int(p * self.n_bins))
        self.counts[b] += 1
        self.pred_sum[b] += p
        self.obs_sum[b] += 1.0 if y else 0.0

    def add_many(self, probs: Dict[str, float], positives: Set[str]) -> None:
        for team, p in probs.items():
            self.add(p, team in positives)

    @property
    def n(self) -> int:
        return sum(self.counts)

    def bins(self) -> List[Dict[str, Any]]:
        out = []
        for b in range(self.n_bins):
            c = self.counts[b]
            out.append(
                {
                    "bin": b,
                    "range": [
                        round(b / self.n_bins, 4),
                        round((b + 1) / self.n_bins, 4),
                    ],
                    "n": c,
                    "mean_predicted": _finite(self.pred_sum[b] / c) if c else None,
                    "observed_frequency": _finite(self.obs_sum[b] / c) if c else None,
                    "gap": _finite((self.obs_sum[b] - self.pred_sum[b]) / c)
                    if c
                    else None,
                }
            )
        return out

    def ece(self) -> Optional[float]:
        """Expected calibration error: count-weighted |observed - predicted|."""
        n = self.n
        if n == 0:
            return None
        return sum(
            abs(self.obs_sum[b] - self.pred_sum[b]) for b in range(self.n_bins)
        ) / n

    def as_dict(self) -> Dict[str, Any]:
        return {"n": self.n, "ece": _finite(self.ece()), "bins": self.bins()}


# ---------------------------------------------------------------------------
# Projections
# ---------------------------------------------------------------------------
def naive_baseline_projection(table: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """"The table never changes again" — the bar any projection must clear.

    Whoever is top today wins the league (p=1), whoever is in the bottom three
    today goes down (p=1), every team finishes exactly where it stands. At
    matchday 0 every team is level on zero points and the ordering is the
    deterministic name tiebreak, which is the correct representation of a
    baseline that knows nothing yet.
    """
    if not table:
        raise ValueError("table is empty")
    n = len(table)
    return {
        "title": {
            r["team"]: (1.0 if r["position"] == 1 else 0.0) for r in table
        },
        "relegation": {
            r["team"]: (1.0 if r["position"] > n - RELEGATION_SLOTS else 0.0)
            for r in table
        },
        "top_4": {
            r["team"]: (1.0 if r["position"] <= TOP_N_EUROPE else 0.0) for r in table
        },
        "position": {r["team"]: float(r["position"]) for r in table},
    }


def simulator_projection(result: Any) -> Dict[str, Any]:
    """Pull the four projected distributions out of a LeagueSimulationResult."""
    standings = list(getattr(result, "standings", []) or [])
    if not standings:
        raise ValueError("simulation returned no standings")
    return {
        "title": {s.team_name: float(s.title_probability) for s in standings},
        "relegation": {s.team_name: float(s.relegation_probability) for s in standings},
        "top_4": {s.team_name: float(s.top_4_probability) for s in standings},
        "position": {s.team_name: float(s.avg_final_position) for s in standings},
    }


def score_projection(
    projection: Dict[str, Any],
    actual: Dict[str, Any],
    eps: float = DEFAULT_LOG_LOSS_EPS,
) -> Dict[str, Optional[float]]:
    """Every metric for one projection against one finished season."""
    title = projection["title"]
    champion = actual["champion"]
    return {
        "title_brier": brier_score(title, {champion}),
        "relegation_brier": brier_score(projection["relegation"], actual["relegated"]),
        "top_4_brier": brier_score(projection["top_4"], actual["top_4"]),
        "position_mae": position_mae(projection["position"], actual["position"]),
        "title_log_loss": multiclass_log_loss(title, champion, eps=eps),
        "champion_hit": 1.0
        if max(title, key=lambda t: (float(title[t]), t)) == champion
        else 0.0,
        "relegation_recall": top_k_recall(
            projection["relegation"], actual["relegated"], RELEGATION_SLOTS
        ),
    }


def margin(
    simulator: Dict[str, Optional[float]], baseline: Dict[str, Optional[float]]
) -> Dict[str, Optional[float]]:
    """Simulator's advantage. Positive always means the simulator is better."""
    out: Dict[str, Optional[float]] = {}
    for key in METRIC_KEYS:
        s, b = simulator.get(key), baseline.get(key)
        if s is None or b is None or math.isnan(s) or math.isnan(b):
            out[key] = None
        elif key in LOWER_IS_BETTER:
            out[key] = b - s
        else:
            out[key] = s - b
    return out


# ---------------------------------------------------------------------------
# Point-in-time Elo (no leakage)
# ---------------------------------------------------------------------------
class PointInTimeElo:
    """Replays warehouse results forward so a cut only ever sees its own past.

    Every team starts at ``EloRatingSystem.DEFAULT_ELO`` (1500) — no pre-seeded
    present-day strengths. ``advance_to(date)`` folds in every historical
    result strictly before ``date`` and returns the live rating system, which
    can be handed straight to ``LeagueSimulator.elo``. Queries must move
    forward in time; a backwards query rebuilds from scratch, which is correct
    but slow, so callers should iterate a season in order.
    """

    def __init__(self, history: Sequence[Dict[str, Any]]):
        self._history = list(history)
        self.reset()

    def reset(self) -> None:
        self._elo = EloRatingSystem()
        self._i = 0
        self._last = ""
        self.rebuilds = getattr(self, "rebuilds", 0) + 1

    def advance_to(self, date_utc: str) -> EloRatingSystem:
        if date_utc < self._last:
            self.reset()
        while self._i < len(self._history) and self._history[self._i]["date_utc"] < date_utc:
            m = self._history[self._i]
            self._i += 1
            self._elo.calculate_new_ratings(
                m["home"],
                m["away"],
                int(m["home_score"]),
                int(m["away_score"]),
                league=m.get("competition_name"),
            )
        self._last = date_utc
        return self._elo

    @property
    def matches_applied(self) -> int:
        return self._i


def preseeded_elo() -> EloRatingSystem:
    """A private copy of the shipped pre-seeded singleton (LEAKY — see module docstring).

    Built fresh rather than via ``get_elo_system()`` so this backtest never
    mutates process-global rating state.
    """
    elo = EloRatingSystem()
    for team, rating in ALL_TEAM_RATINGS.items():
        elo.set_elo(team, rating)
    return elo


# ---------------------------------------------------------------------------
# Warehouse access (STRICTLY read-only)
# ---------------------------------------------------------------------------
def connect_readonly(path: Path) -> sqlite3.Connection:
    """Open the warehouse read-only. This script must never write to it."""
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def dominant_source_by_season(
    con: sqlite3.Connection, competition_id: str
) -> Dict[int, Tuple[str, int, str]]:
    """season -> (source with the most completed matches, count, last date)."""
    rows = con.execute(
        """
        SELECT season, source, COUNT(*) AS n, MAX(date_utc) AS last_date
        FROM matches
        WHERE competition_id = ?
          AND home_score IS NOT NULL AND away_score IS NOT NULL
        GROUP BY season, source
        ORDER BY season ASC, n DESC, source ASC
        """,
        (competition_id,),
    ).fetchall()
    best: Dict[int, Tuple[str, int, str]] = {}
    for r in rows:
        season = int(r["season"])
        if season not in best or int(r["n"]) > best[season][1]:
            best[season] = (str(r["source"]), int(r["n"]), str(r["last_date"]))
    return best


def load_season_matches(
    con: sqlite3.Connection, competition_id: str, season: int, source: str
) -> List[Dict[str, Any]]:
    rows = con.execute(
        """
        SELECT m.match_id, m.date_utc, m.home_score, m.away_score,
               h.canonical_name AS home, a.canonical_name AS away
        FROM matches m
        JOIN teams h ON h.team_id = m.home_team_id
        JOIN teams a ON a.team_id = m.away_team_id
        WHERE m.competition_id = ? AND m.season = ? AND m.source = ?
          AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        ORDER BY m.date_utc ASC, m.match_id ASC
        """,
        (competition_id, season, source),
    ).fetchall()
    return [dict(r) for r in rows]


def load_elo_history(con: sqlite3.Connection) -> List[Dict[str, Any]]:
    """Every completed result in the warehouse, one row per match, in order.

    Only each competition's dominant source is kept: the same fixture arriving
    from two providers would otherwise be applied to Elo twice.
    """
    counts: Dict[str, Tuple[str, int]] = {}
    for r in con.execute(
        """
        SELECT competition_id, source, COUNT(*) AS n FROM matches
        WHERE home_score IS NOT NULL AND away_score IS NOT NULL
        GROUP BY competition_id, source
        """
    ).fetchall():
        comp, src, n = str(r["competition_id"]), str(r["source"]), int(r["n"])
        if comp not in counts or n > counts[comp][1]:
            counts[comp] = (src, n)
    dominant = {comp: src for comp, (src, _) in counts.items()}

    rows = con.execute(
        """
        SELECT m.date_utc, m.competition_id, m.source, m.home_score, m.away_score,
               c.name AS competition_name,
               h.canonical_name AS home, a.canonical_name AS away
        FROM matches m
        JOIN competitions c ON c.competition_id = m.competition_id
        JOIN teams h ON h.team_id = m.home_team_id
        JOIN teams a ON a.team_id = m.away_team_id
        WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL
        ORDER BY m.date_utc ASC, m.match_id ASC
        """
    ).fetchall()
    return [
        dict(r) for r in rows if dominant.get(str(r["competition_id"])) == str(r["source"])
    ]


# ---------------------------------------------------------------------------
# Season eligibility
# ---------------------------------------------------------------------------
def season_integrity(matches: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Shape checks for a would-be complete double round-robin season."""
    teams = sorted({m["home"] for m in matches} | {m["away"] for m in matches})
    n_teams = len(teams)
    expected = n_teams * (n_teams - 1) if n_teams > 1 else 0
    played: Dict[str, int] = {t: 0 for t in teams}
    for m in matches:
        played[m["home"]] += 1
        played[m["away"]] += 1
    return {
        "n_teams": n_teams,
        "n_matches": len(matches),
        "expected_matches": expected,
        "completeness": (len(matches) / expected) if expected else 0.0,
        "min_team_matches": min(played.values()) if played else 0,
        "max_team_matches": max(played.values()) if played else 0,
        "teams": teams,
    }


def eligibility(
    integrity: Dict[str, Any],
    last_date: str,
    min_completeness: float,
    now: Optional[datetime] = None,
) -> Optional[str]:
    """None if the season is scoreable, else a plain-language skip reason."""
    if integrity["n_teams"] < 6:
        return f"only {integrity['n_teams']} teams in warehouse (need >= 6)"
    if integrity["expected_matches"] == 0:
        return "no fixtures"
    if integrity["completeness"] < min_completeness:
        return (
            f"season {integrity['completeness']:.1%} complete "
            f"({integrity['n_matches']}/{integrity['expected_matches']} matches), "
            f"below --min-completeness {min_completeness:.0%}"
        )
    now = now or datetime.now(timezone.utc)
    try:
        last = datetime.fromisoformat(str(last_date)[:10]).replace(tzinfo=timezone.utc)
    except ValueError:
        return f"unparseable last match date {last_date!r}"
    if last > now - timedelta(days=SEASON_COMPLETE_GRACE_DAYS):
        return (
            f"last match {str(last_date)[:10]} is inside the "
            f"{SEASON_COMPLETE_GRACE_DAYS}-day season-complete grace window"
        )
    return None


# ---------------------------------------------------------------------------
# The replay
# ---------------------------------------------------------------------------
def backtest_season(
    *,
    competition_id: str,
    league_name: str,
    season: int,
    matches: Sequence[Dict[str, Any]],
    simulator: LeagueSimulator,
    elo_provider: Callable[[str], EloRatingSystem],
    matchday_step: int = 1,
    log_loss_eps: float = DEFAULT_LOG_LOSS_EPS,
    seed: Optional[int] = None,
    calibrators: Optional[Dict[str, CalibrationAccumulator]] = None,
    progress: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Replay one finished season matchday by matchday and score every cut."""
    integrity = season_integrity(matches)
    teams = integrity["teams"]
    final_table = build_table(matches, teams=teams)
    actual = actual_outcome(final_table)

    blocks = matchday_blocks(matches)
    n_blocks = len(blocks)
    total_matches = len(matches)

    points: List[Dict[str, Any]] = []
    # Cut m means "m matchdays have been played". m = 0 is the pre-season
    # projection: a genuine information floor for the convergence curve.
    for m in range(0, n_blocks):
        if m % matchday_step != 0 and m != 0:
            continue
        played = [x for blk in blocks[:m] for x in blk]
        remaining_blocks = blocks[m:]
        remaining = [x for blk in remaining_blocks for x in blk]
        if not remaining:
            continue

        table = build_table(played, teams=teams)
        cut_date = str(remaining_blocks[0][0]["date_utc"])

        if seed is not None:
            np.random.seed((seed + m * 7919) % (2**32 - 1))
        simulator.elo = elo_provider(cut_date)

        result = simulator.simulate_league(
            current_standings=simulator_standings(table),
            remaining_fixtures=[
                {"home_team": f["home"], "away_team": f["away"]} for f in remaining
            ],
            league_key=competition_id,
            league_name=league_name,
        )
        try:
            projected = simulator_projection(result)
        except ValueError:
            continue

        base = naive_baseline_projection(table)
        sim_scores = score_projection(projected, actual, eps=log_loss_eps)
        base_scores = score_projection(base, actual, eps=log_loss_eps)

        if calibrators is not None:
            for key, positives in (
                ("title", {actual["champion"]}),
                ("relegation", actual["relegated"]),
                ("top_4", actual["top_4"]),
            ):
                calibrators.setdefault(key, CalibrationAccumulator()).add_many(
                    projected[key], positives
                )

        fraction = (total_matches - len(remaining)) / total_matches if total_matches else 0.0
        points.append(
            {
                "matchday": m,
                "cut_date": cut_date[:10],
                "matches_played": total_matches - len(remaining),
                "mean_matches_played": _finite(
                    (total_matches - len(remaining)) * 2 / integrity["n_teams"]
                )
                if integrity["n_teams"]
                else None,
                "fraction_complete": _finite(fraction),
                "remaining_fixtures": len(remaining),
                "projected_champion": max(
                    projected["title"], key=lambda t: (projected["title"][t], t)
                ),
                "projected_champion_probability": _finite(
                    max(projected["title"].values())
                ),
                "simulator": {k: _finite(v) for k, v in sim_scores.items()},
                "baseline": {k: _finite(v) for k, v in base_scores.items()},
                "margin": {
                    k: _finite(v) for k, v in margin(sim_scores, base_scores).items()
                },
            }
        )
        if progress:
            progress(
                f"    md {m:>2}/{n_blocks - 1}  "
                f"title_brier sim={sim_scores['title_brier']:.4f} "
                f"base={base_scores['title_brier']:.4f}"
            )

    return {
        "competition_id": competition_id,
        "league_name": league_name,
        "season": season,
        "n_teams": integrity["n_teams"],
        "n_matches": integrity["n_matches"],
        "expected_matches": integrity["expected_matches"],
        "completeness": _finite(integrity["completeness"]),
        "min_team_matches": integrity["min_team_matches"],
        "max_team_matches": integrity["max_team_matches"],
        "n_matchdays": n_blocks,
        "champion": actual["champion"],
        "relegated": sorted(actual["relegated"]),
        "top_4": sorted(actual["top_4"]),
        "final_table": [
            {
                "position": r["position"],
                "team": r["team"],
                "played": r["played"],
                "points": r["points"],
                "goal_diff": r["goal_diff"],
            }
            for r in final_table
        ],
        "n_projection_points": len(points),
        "matchdays": points,
        "season_summary": {
            "simulator": {
                k: _finite(mean_or_none(p["simulator"][k] for p in points))
                for k in METRIC_KEYS
            },
            "baseline": {
                k: _finite(mean_or_none(p["baseline"][k] for p in points))
                for k in METRIC_KEYS
            },
            "margin": {
                k: _finite(mean_or_none(p["margin"][k] for p in points))
                for k in METRIC_KEYS
            },
        },
    }


# ---------------------------------------------------------------------------
# Aggregation — the convergence curve
# ---------------------------------------------------------------------------
def _aggregate_points(points: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        side: {
            k: _finite(mean_or_none(p[side][k] for p in points)) for k in METRIC_KEYS
        }
        for side in ("simulator", "baseline", "margin")
    }


def aggregate_by_matchday(seasons: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pool every league-season by absolute matchday number.

    This IS the convergence curve: metric vs matchday, averaged over every
    league-season that reached that matchday. Late matchdays are averaged over
    fewer league-seasons (a 34-round Bundesliga contributes nothing past
    matchday 33), so ``n_league_seasons`` must be read alongside the numbers.
    """
    groups: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    leagues: Dict[int, Set[str]] = defaultdict(set)
    for s in seasons:
        for p in s["matchdays"]:
            groups[int(p["matchday"])].append(p)
            leagues[int(p["matchday"])].add(s["competition_id"])
    out = []
    for md in sorted(groups):
        pts = groups[md]
        row: Dict[str, Any] = {
            "matchday": md,
            "n_league_seasons": len(pts),
            "n_leagues": len(leagues[md]),
            "mean_fraction_complete": _finite(
                mean_or_none(p["fraction_complete"] for p in pts)
            ),
        }
        row.update(_aggregate_points(pts))
        out.append(row)
    return out


def aggregate_by_season_fraction(
    seasons: Sequence[Dict[str, Any]], n_buckets: int = FRACTION_BUCKETS
) -> List[Dict[str, Any]]:
    """Same curve on a league-length-independent x-axis (% of season played)."""
    groups: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for s in seasons:
        for p in s["matchdays"]:
            f = p["fraction_complete"] or 0.0
            groups[min(n_buckets - 1, int(f * n_buckets))].append(p)
    out = []
    for b in sorted(groups):
        pts = groups[b]
        row: Dict[str, Any] = {
            "bucket": b,
            "range": [round(b / n_buckets, 4), round((b + 1) / n_buckets, 4)],
            "n_projection_points": len(pts),
        }
        row.update(_aggregate_points(pts))
        out.append(row)
    return out


def overall_summary(seasons: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Every scored projection point pooled into one honest headline block.

    ``share_simulator_better`` is the fraction of individual matchday
    projections on which the simulator beat the naive carry-forward baseline.
    Read it next to the mean margin: the baseline is a hard 0/1 forecast, so it
    scores a *perfect* Brier whenever it happens to be right, which it
    increasingly is late in a season. A mean margin that is positive while the
    share sits near or below 0.5 means the simulator wins big when the naive
    call is wrong and loses small when it is right.
    """
    points = [p for s in seasons for p in s["matchdays"]]
    if not points:
        return {"n_projection_points": 0}
    out: Dict[str, Any] = {"n_projection_points": len(points)}
    out.update(_aggregate_points(points))
    share: Dict[str, Optional[float]] = {}
    ties: Dict[str, Optional[float]] = {}
    for k in METRIC_KEYS:
        vals = [p["margin"][k] for p in points if p["margin"][k] is not None]
        share[k] = (sum(1 for v in vals if v > 0) / len(vals)) if vals else None
        ties[k] = (sum(1 for v in vals if v == 0) / len(vals)) if vals else None
    out["share_simulator_better"] = {k: _finite(v) for k, v in share.items()}
    out["share_tied"] = {k: _finite(v) for k, v in ties.items()}
    return out


def aggregate_by_league(seasons: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    names: Dict[str, str] = {}
    for s in seasons:
        groups[s["competition_id"]].extend(s["matchdays"])
        names[s["competition_id"]] = s["league_name"]
    out = []
    for comp in sorted(groups):
        row: Dict[str, Any] = {
            "competition_id": comp,
            "league_name": names[comp],
            "n_seasons": sum(1 for s in seasons if s["competition_id"] == comp),
            "n_projection_points": len(groups[comp]),
        }
        row.update(_aggregate_points(groups[comp]))
        out.append(row)
    return out


def first_sustained(
    curve: Sequence[Dict[str, Any]],
    predicate: Callable[[Dict[str, Any]], Optional[bool]],
) -> Optional[int]:
    """Earliest matchday from which ``predicate`` holds for every later matchday.

    "Trustworthy from matchday N" has to mean *and it stays that way* — a
    metric that dips under a threshold at matchday 6 and pops back out at 9
    has not converged. Points where the predicate is undefined (None) are
    ignored rather than treated as failures.
    """
    ordered = sorted(curve, key=lambda r: r["matchday"])
    answer: Optional[int] = None
    for row in reversed(ordered):
        v = predicate(row)
        if v is False:
            break
        if v is True:
            answer = int(row["matchday"])
    return answer


def convergence_thresholds(curve: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Product answer: from which matchday is the projection trustworthy?"""

    def _brier_below(t: float) -> Callable[[Dict[str, Any]], Optional[bool]]:
        def f(row: Dict[str, Any]) -> Optional[bool]:
            v = row["simulator"]["title_brier"]
            return None if v is None else v <= t
        return f

    def _beats_baseline(row: Dict[str, Any]) -> Optional[bool]:
        v = row["margin"]["title_brier"]
        return None if v is None else v > 0.0

    def _champion_called(row: Dict[str, Any]) -> Optional[bool]:
        v = row["simulator"]["champion_hit"]
        return None if v is None else v >= 1.0

    def _relegation_below(t: float) -> Callable[[Dict[str, Any]], Optional[bool]]:
        def f(row: Dict[str, Any]) -> Optional[bool]:
            v = row["simulator"]["relegation_brier"]
            return None if v is None else v <= t
        return f

    return {
        "definition": (
            "earliest matchday from which the condition holds at EVERY later "
            "matchday in the pooled convergence curve; null = never"
        ),
        "title_brier_le_0.05": first_sustained(curve, _brier_below(0.05)),
        "title_brier_le_0.02": first_sustained(curve, _brier_below(0.02)),
        "title_brier_le_0.01": first_sustained(curve, _brier_below(0.01)),
        "relegation_brier_le_0.05": first_sustained(curve, _relegation_below(0.05)),
        "beats_naive_baseline_on_title_brier": first_sustained(curve, _beats_baseline),
        "champion_always_argmax": first_sustained(curve, _champion_called),
    }


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def run_backtest(
    *,
    db_path: Path = WAREHOUSE_PATH,
    leagues: Optional[Sequence[str]] = None,
    season: Optional[int] = None,
    n_seasons: int = DEFAULT_SEASONS,
    iterations: int = DEFAULT_ITERATIONS,
    matchday_step: int = 1,
    min_completeness: float = DEFAULT_MIN_COMPLETENESS,
    log_loss_eps: float = DEFAULT_LOG_LOSS_EPS,
    elo_mode: str = "point-in-time",
    seed: Optional[int] = DEFAULT_SEED,
    verbose: bool = True,
) -> Dict[str, Any]:
    """Run the whole backtest and return the diagnostics artifact as a dict.

    Never raises on a missing / empty / partial warehouse: the artifact then
    honestly reports zero coverage.
    """
    started = time.time()
    league_ids = list(leagues) if leagues else list(WAVE_A)
    say = (lambda msg: print(msg, flush=True)) if verbose else (lambda msg: None)

    artifact: Dict[str, Any] = {
        "artifact": "season_projection_backtest",
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generator": "backend/scripts/backtest_season_projections.py",
        "subject": "backend/services/simulation/league_simulator.py",
        "config": {
            "leagues": league_ids,
            "season": season,
            "n_seasons": n_seasons,
            "iterations": iterations,
            "matchday_step": matchday_step,
            "min_completeness": min_completeness,
            "log_loss_eps": log_loss_eps,
            "elo_mode": elo_mode,
            "seed": seed,
            "warehouse": str(db_path),
        },
        "definitions": {
            "matchday": (
                "cut index over date-gap matchday blocks (>1 blank day starts a "
                "new block), mirroring _backtest_core.matchday_blocks. matchday 0 "
                "is the pre-season projection with zero information."
            ),
            "relegation": (
                f"bottom {RELEGATION_SLOTS} of the final table — the simulator's "
                "own hardcoded definition. Bundesliga / Ligue 1 relegation "
                "play-off seasons genuinely differ; scoring the simulator "
                "against a rule it does not implement would measure the wrong "
                "event."
            ),
            "top_4": f"top {TOP_N_EUROPE} of the final table",
            "brier": (
                "mean over teams of (p_team - y_team)^2, so leagues of different "
                "size are on one scale; 0 is perfect"
            ),
            "title_log_loss": (
                "-log P(actual champion) with the title race as one multiclass "
                "event over the league's teams; probabilities clipped to "
                "log_loss_eps and renormalised"
            ),
            "position_mae": "mean |avg_final_position - actual final position|",
            "relegation_recall": (
                f"share of the actually-relegated teams inside the "
                f"{RELEGATION_SLOTS} highest relegation probabilities"
            ),
            "baseline": (
                "naive carry-forward: today's leader wins the league (p=1), "
                "today's bottom three go down (p=1), every team finishes where "
                "it currently stands"
            ),
            "margin": (
                "baseline - simulator for Brier / MAE / log loss, simulator - "
                "baseline for hit rates. POSITIVE ALWAYS MEANS THE SIMULATOR IS "
                "BETTER."
            ),
            "tiebreak": (
                "tables order on (points, goal difference, goals for, name); "
                "real head-to-head tiebreaks are not modelled"
            ),
        },
        "coverage": {
            "leagues_requested": league_ids,
            "warehouse_readable": False,
            "warehouse_matches": 0,
            "n_league_seasons_scored": 0,
            "n_projection_points": 0,
            "seasons_scored": [],
            "seasons_skipped": [],
        },
        "per_season": [],
        "overall": {"n_projection_points": 0},
        "convergence": {"by_matchday": [], "by_season_fraction": [], "thresholds": {}},
        "by_league": [],
        "calibration": {},
        "notes": [],
        "warnings": [],
    }

    if elo_mode == "preseeded":
        artifact["warnings"].append(
            "elo_mode=preseeded uses today's hardcoded team strengths "
            "(ALL_TEAM_RATINGS) for every historical matchday. That is LOOK-AHEAD "
            "LEAKAGE and flatters the projection. It measures as-shipped "
            "behaviour, not out-of-sample skill."
        )

    try:
        con = connect_readonly(db_path)
    except sqlite3.Error as exc:
        artifact["coverage"]["error"] = f"cannot open warehouse read-only: {exc}"
        artifact["notes"].append(
            "Warehouse unavailable — nothing was scored. The harness ran and "
            "produced this artifact honestly reporting zero coverage."
        )
        say(f"!! cannot open {db_path}: {exc}")
        artifact["runtime_seconds"] = round(time.time() - started, 2)
        return artifact

    try:
        try:
            total = int(
                con.execute(
                    "SELECT COUNT(*) FROM matches WHERE home_score IS NOT NULL"
                ).fetchone()[0]
            )
        except sqlite3.Error as exc:
            artifact["coverage"]["error"] = f"warehouse has no usable schema: {exc}"
            artifact["notes"].append(
                "Warehouse present but empty or mid-rebuild — nothing was scored."
            )
            say(f"!! warehouse unusable: {exc}")
            artifact["runtime_seconds"] = round(time.time() - started, 2)
            return artifact

        artifact["coverage"]["warehouse_readable"] = True
        artifact["coverage"]["warehouse_matches"] = total
        say(f"Warehouse: {total} completed matches at {db_path}")

        if total == 0:
            artifact["notes"].append(
                "Warehouse contains zero completed matches — nothing was scored."
            )
            artifact["runtime_seconds"] = round(time.time() - started, 2)
            return artifact

        # ---- pick the league-seasons that can honestly be scored ----
        work: List[Tuple[str, int, str, List[Dict[str, Any]], Dict[str, Any]]] = []
        for comp in league_ids:
            per_season = dominant_source_by_season(con, comp)
            if not per_season:
                artifact["coverage"]["seasons_skipped"].append(
                    {"competition_id": comp, "season": None, "reason": "no matches in warehouse"}
                )
                continue
            candidates = sorted(per_season, reverse=True)
            if season is not None:
                candidates = [s for s in candidates if s == season]
                if not candidates:
                    artifact["coverage"]["seasons_skipped"].append(
                        {
                            "competition_id": comp,
                            "season": season,
                            "reason": "season not present in warehouse",
                        }
                    )
                    continue
            accepted = 0
            for s in candidates:
                if season is None and accepted >= n_seasons:
                    break
                src, _n, last_date = per_season[s]
                matches = load_season_matches(con, comp, s, src)
                integ = season_integrity(matches)
                reason = eligibility(integ, last_date, min_completeness)
                if reason:
                    artifact["coverage"]["seasons_skipped"].append(
                        {
                            "competition_id": comp,
                            "season": s,
                            "source": src,
                            "n_matches": integ["n_matches"],
                            "expected_matches": integ["expected_matches"],
                            "completeness": _finite(integ["completeness"]),
                            "reason": reason,
                        }
                    )
                    continue
                work.append((comp, s, src, matches, integ))
                accepted += 1

        if not work:
            artifact["notes"].append(
                "No league-season in the warehouse passed the completeness gate, "
                "so no projection was scored. The harness is built and unit "
                "tested; see coverage.seasons_skipped for why each candidate was "
                "rejected."
            )
            say("!! no scoreable league-seasons — see coverage.seasons_skipped")
            artifact["runtime_seconds"] = round(time.time() - started, 2)
            return artifact

        # ---- Elo ----
        pit: Optional[PointInTimeElo] = None
        if elo_mode == "point-in-time":
            say("Loading Elo history (dominant source per competition)...")
            history = load_elo_history(con)
            say(f"  {len(history)} historical results available for Elo replay")
            pit = PointInTimeElo(history)
            artifact["coverage"]["elo_history_matches"] = len(history)
        else:
            frozen = preseeded_elo()

        simulator = LeagueSimulator(n_simulations=iterations)
        calibrators: Dict[str, CalibrationAccumulator] = {}

        for comp, s, src, matches, integ in sorted(work, key=lambda w: (w[1], w[0])):
            say(
                f"  {comp} {s} ({src}) — {integ['n_teams']} teams, "
                f"{integ['n_matches']}/{integ['expected_matches']} matches"
            )
            if pit is not None:
                pit.reset()

                def _provider(date_utc: str, _p: PointInTimeElo = pit) -> EloRatingSystem:
                    return _p.advance_to(date_utc)
            else:

                def _provider(date_utc: str, _e: EloRatingSystem = frozen) -> EloRatingSystem:
                    return _e

            try:
                report = backtest_season(
                    competition_id=comp,
                    league_name=WAVE_A.get(comp, comp),
                    season=s,
                    matches=matches,
                    simulator=simulator,
                    elo_provider=_provider,
                    matchday_step=matchday_step,
                    log_loss_eps=log_loss_eps,
                    seed=seed,
                    calibrators=calibrators,
                    progress=None,
                )
            except Exception as exc:  # never let one bad season kill the run
                artifact["coverage"]["seasons_skipped"].append(
                    {
                        "competition_id": comp,
                        "season": s,
                        "source": src,
                        "reason": f"replay failed: {type(exc).__name__}: {exc}",
                    }
                )
                say(f"    !! replay failed: {exc}")
                continue

            report["source"] = src
            artifact["per_season"].append(report)
            artifact["coverage"]["seasons_scored"].append(
                {
                    "competition_id": comp,
                    "season": s,
                    "source": src,
                    "n_teams": report["n_teams"],
                    "n_matches": report["n_matches"],
                    "expected_matches": report["expected_matches"],
                    "completeness": report["completeness"],
                    "min_team_matches": report["min_team_matches"],
                    "max_team_matches": report["max_team_matches"],
                    "reconstructed_champion": report["champion"],
                    "n_matchdays": report["n_matchdays"],
                    "n_projection_points": report["n_projection_points"],
                }
            )
            summary = report["season_summary"]
            say(
                f"    champion={report['champion']}  "
                f"mean title Brier sim={summary['simulator']['title_brier']} "
                f"base={summary['baseline']['title_brier']}"
            )
    finally:
        con.close()

    seasons = artifact["per_season"]
    artifact["coverage"]["n_league_seasons_scored"] = len(seasons)
    artifact["coverage"]["n_projection_points"] = sum(
        s["n_projection_points"] for s in seasons
    )

    artifact["overall"] = overall_summary(seasons)
    curve = aggregate_by_matchday(seasons)
    artifact["convergence"]["by_matchday"] = curve
    artifact["convergence"]["by_season_fraction"] = aggregate_by_season_fraction(seasons)
    artifact["convergence"]["thresholds"] = convergence_thresholds(curve)
    artifact["by_league"] = aggregate_by_league(seasons)

    overall = CalibrationAccumulator()
    for acc in calibrators.values():
        for b in range(N_BINS):
            overall.counts[b] += acc.counts[b]
            overall.pred_sum[b] += acc.pred_sum[b]
            overall.obs_sum[b] += acc.obs_sum[b]
    artifact["calibration"] = {
        "note": (
            "pooled over every projected title / relegation / top-4 probability "
            "at every scored matchday; observed_frequency is what actually "
            "happened for the teams in that bucket"
        ),
        "overall": overall.as_dict(),
        "by_metric": {k: v.as_dict() for k, v in sorted(calibrators.items())},
    }

    partial = [s for s in seasons if (s["completeness"] or 0) < 0.999]
    if partial:
        artifact["warnings"].append(
            f"{len(partial)} of {len(seasons)} scored league-seasons are missing "
            "fixtures in the warehouse (see per_season.completeness). The final "
            "table — and therefore the ground truth every metric is scored "
            "against — is reconstructed from the fixtures that ARE present, so a "
            "season with a tight title or relegation race can be reconstructed "
            "wrongly. Raise --min-completeness once the loaders are complete."
        )
    if len(seasons) < 3:
        artifact["warnings"].append(
            f"only {len(seasons)} league-season(s) scored — the convergence "
            "curve is anecdote, not evidence, until the warehouse carries "
            "several complete seasons per league."
        )
    artifact["runtime_seconds"] = round(time.time() - started, 2)
    return artifact


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def print_report(artifact: Dict[str, Any]) -> None:
    cov = artifact["coverage"]
    line = "-" * 84
    print()
    print("=" * 84)
    print("SEASON PROJECTION BACKTEST — league_simulator.py, measured for the first time")
    print("=" * 84)
    print(
        f"warehouse: {cov.get('warehouse_matches', 0)} completed matches  |  "
        f"league-seasons scored: {cov['n_league_seasons_scored']}  |  "
        f"projection points: {cov['n_projection_points']}"
    )
    if cov.get("error"):
        print(f"ERROR: {cov['error']}")
    for w in artifact.get("warnings", []):
        print(f"WARNING: {w}")
    for n in artifact.get("notes", []):
        print(f"NOTE: {n}")

    if cov["seasons_skipped"]:
        print(line)
        print("SKIPPED (not scoreable):")
        for s in cov["seasons_skipped"][:40]:
            print(f"  {s['competition_id']} {s.get('season')}: {s['reason']}")
        if len(cov["seasons_skipped"]) > 40:
            print(f"  ... and {len(cov['seasons_skipped']) - 40} more")

    ov = artifact.get("overall") or {}
    if ov.get("n_projection_points"):
        print(line)
        print(f"POOLED OVER ALL {ov['n_projection_points']} PROJECTION POINTS")
        print(
            f"{'metric':<20} {'simulator':>10} {'baseline':>10} {'margin':>9} "
            f"{'sim better':>11} {'tied':>7}"
        )
        for k in METRIC_KEYS:
            print(
                f"  {k:<18} {str(ov['simulator'][k]):>10} "
                f"{str(ov['baseline'][k]):>10} {str(ov['margin'][k]):>9} "
                f"{str(ov['share_simulator_better'][k]):>11} "
                f"{str(ov['share_tied'][k]):>7}"
            )

    curve = artifact["convergence"]["by_matchday"]
    if not curve:
        print(line)
        print("No convergence curve — nothing was scored.")
        print("=" * 84)
        return

    print(line)
    print("CONVERGENCE CURVE (pooled across leagues and seasons)")
    print(
        f"{'md':>3} {'n':>3} {'titleBrier':>11} {'base':>8} {'margin':>8} "
        f"{'relBrier':>9} {'posMAE':>7} {'logloss':>8} {'champHit':>9}"
    )

    def _f(v: Optional[float], w: int, p: int = 4) -> str:
        return f"{v:>{w}.{p}f}" if v is not None else " " * (w - 1) + "-"

    for row in curve:
        sim, base, mar = row["simulator"], row["baseline"], row["margin"]
        print(
            f"{row['matchday']:>3} {row['n_league_seasons']:>3} "
            f"{_f(sim['title_brier'], 11)} {_f(base['title_brier'], 8)} "
            f"{_f(mar['title_brier'], 8)} {_f(sim['relegation_brier'], 9)} "
            f"{_f(sim['position_mae'], 7, 3)} {_f(sim['title_log_loss'], 8, 3)} "
            f"{_f(sim['champion_hit'], 9, 3)}"
        )

    th = artifact["convergence"]["thresholds"]
    print(line)
    print("TRUSTWORTHY FROM MATCHDAY (sustained through the end of the season):")
    for key in (
        "title_brier_le_0.05",
        "title_brier_le_0.02",
        "title_brier_le_0.01",
        "relegation_brier_le_0.05",
        "beats_naive_baseline_on_title_brier",
        "champion_always_argmax",
    ):
        v = th.get(key)
        print(f"  {key:<40} {v if v is not None else 'never'}")

    cal = artifact.get("calibration", {}).get("overall", {})
    if cal.get("n"):
        print(line)
        print(f"CALIBRATION (all projection probabilities, ECE = {cal.get('ece')})")
        print(f"{'bucket':>12} {'n':>7} {'predicted':>10} {'observed':>9} {'gap':>8}")
        for b in cal["bins"]:
            if not b["n"]:
                continue
            print(
                f"  [{b['range'][0]:.1f},{b['range'][1]:.1f}) {b['n']:>7} "
                f"{_f(b['mean_predicted'], 10)} {_f(b['observed_frequency'], 9)} "
                f"{_f(b['gap'], 8)}"
            )
    print("=" * 84)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Matchday-by-matchday backtest of the Monte Carlo season "
            "projections (PIVOT_2026-08 §4)."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument(
        "--league",
        action="append",
        default=None,
        metavar="COMP_ID",
        help=(
            "competition_id to score; repeatable, or comma-separated. "
            f"Default: Wave A ({', '.join(WAVE_A)})"
        ),
    )
    p.add_argument("--season", type=int, default=None, help="score only this season")
    p.add_argument(
        "--seasons",
        type=int,
        default=DEFAULT_SEASONS,
        help="most-recent complete seasons per league (ignored with --season)",
    )
    p.add_argument(
        "--iterations",
        type=int,
        default=DEFAULT_ITERATIONS,
        help="Monte Carlo iterations per matchday (runtime is ~linear in this)",
    )
    p.add_argument(
        "--matchday-step",
        type=int,
        default=1,
        help="score every Nth matchday (raise it to trade curve resolution for speed)",
    )
    p.add_argument(
        "--min-completeness",
        type=float,
        default=DEFAULT_MIN_COMPLETENESS,
        help="skip a season whose fixture list is less complete than this",
    )
    p.add_argument(
        "--log-loss-eps",
        type=float,
        default=DEFAULT_LOG_LOSS_EPS,
        help="probability clip for log loss (bounds the naive baseline's penalty)",
    )
    p.add_argument(
        "--elo",
        choices=("point-in-time", "preseeded"),
        default="point-in-time",
        help="point-in-time replays Elo from results before each cut (no leakage)",
    )
    p.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Monte Carlo seed")
    p.add_argument(
        "--db", type=Path, default=WAREHOUSE_PATH, help="warehouse path (read-only)"
    )
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="artifact path")
    p.add_argument("--quiet", action="store_true", help="suppress progress output")
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    leagues: Optional[List[str]] = None
    if args.league:
        leagues = [
            part.strip()
            for item in args.league
            for part in str(item).split(",")
            if part.strip()
        ]

    artifact = run_backtest(
        db_path=args.db,
        leagues=leagues,
        season=args.season,
        n_seasons=args.seasons,
        iterations=args.iterations,
        matchday_step=max(1, args.matchday_step),
        min_completeness=args.min_completeness,
        log_loss_eps=args.log_loss_eps,
        elo_mode=args.elo,
        seed=args.seed,
        verbose=not args.quiet,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")

    if not args.quiet:
        print_report(artifact)
        print(f"\nWrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
