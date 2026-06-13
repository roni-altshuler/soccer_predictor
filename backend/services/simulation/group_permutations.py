"""
World Cup group-stage Monte Carlo permutation simulator.

For a given group (A, B, C, ...) at the FIFA World Cup, this module:
  1. Loads the four teams and any already-played match results from the
     existing ESPN tournament data layer (the same source the Next.js
     `/api/tournament/world_cup` route uses).
  2. For each remaining match generates an expected goal distribution using
     the existing ELO-Poisson + Dixon-Coles `PoissonModel` from
     `backend.services.prediction.probabilistic`.
  3. Runs Monte Carlo simulations (default 50,000) — for each simulation
     it samples a final scoreline for each remaining match, applies FIFA
     group-stage tiebreakers, and records the final ordering.
  4. Aggregates per-team `p_advance_first`, `p_advance_second`,
     `p_advance_either`, `p_eliminated`, expected points/GD, and the
     three most-likely final orderings.

The simulator uses NumPy for vectorised goal sampling (one matrix per
remaining match for all simulations) to keep 50k sims well under 3
seconds on a single CPU.

It is deterministic for a given `seed`.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np

from backend.services.prediction.probabilistic import (
    LEAGUE_PARAMS,
    PoissonModel,
)
from backend.services.ratings.elo_goals import expected_goals as elo_expected_goals
from backend.services.ratings.national_elo import national_elo_for

logger = logging.getLogger(__name__)


WORLD_CUP_LEAGUE_KEY = "fifa.world"
ESPN_LEAGUE_ID = "fifa.world"
MAX_GOALS = 8  # truncate Poisson tail


@dataclass
class _GroupTeam:
    team_id: Optional[int]
    name: str
    elo: float
    # Tally from already-played matches
    points: int = 0
    gf: int = 0
    ga: int = 0
    played: int = 0
    # Head-to-head goals scored against each other team in the group
    h2h_gf: Dict[str, int] = field(default_factory=dict)
    h2h_ga: Dict[str, int] = field(default_factory=dict)
    h2h_points: Dict[str, int] = field(default_factory=dict)


@dataclass
class _Match:
    match_id: str
    home: str
    away: str
    home_goals: Optional[int] = None
    away_goals: Optional[int] = None
    date: Optional[str] = None

    @property
    def is_played(self) -> bool:
        return self.home_goals is not None and self.away_goals is not None


# ---------------------------------------------------------------------------
# Data loader — uses ESPN scoreboard/standings the same way the Next.js
# tournament route does, but called from Python via the existing
# `ESPNClient`.
# ---------------------------------------------------------------------------


def _load_group_data(group_id: str) -> Tuple[List[_GroupTeam], List[_Match]]:
    """
    Fetch the four teams in the group and all group-stage matches
    (played + scheduled) from the ESPN data layer.

    The ESPN World Cup standings response splits teams into `children`
    objects keyed by group name ("Group A", "Group B", ...).  ESPN
    scoreboard events carry a `groupId` / `notes` containing the group
    name, which lets us partition matches per group.
    """
    try:
        from backend.services.espn.client import get_espn_client
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(f"ESPN client unavailable: {exc}")
        return [], []

    client = get_espn_client()

    async def _fetch():
        standings = await client.get_standings("world_cup")
        # 60 day window covering group stage (the tournament opens
        # June 11, 2026 and group stage ends ~June 27).
        scoreboard_data = await client.get_scoreboard(
            "world_cup",
            date="20260601-20260701",
        )
        return standings, scoreboard_data

    try:
        loop = asyncio.new_event_loop()
        standings, scoreboard = loop.run_until_complete(_fetch())
        loop.close()
    except Exception as exc:
        logger.warning(f"ESPN fetch failed for group {group_id}: {exc}")
        standings, scoreboard = None, None

    # Build team list — filter ESPN standings to the requested group.
    teams: List[_GroupTeam] = []
    group_label = group_id.strip().upper()
    desired_group_name = f"Group {group_label}".lower()

    # Standings from `get_standings` are flattened (no group name).  We
    # also need the raw children to know group membership, so we read
    # via the raw scoreboard groupings if possible.
    # `client.get_standings` already flattens, so for group resolution we
    # call the raw endpoint via `_request` if available.
    raw_children = []
    try:
        loop = asyncio.new_event_loop()
        raw = loop.run_until_complete(client.get_standings_raw("world_cup"))
        loop.close()
        if raw:
            raw_children = raw.get("children", [])
    except Exception:
        raw_children = []

    team_id_to_name: Dict[str, str] = {}
    for child in raw_children:
        name = (child.get("name") or child.get("abbreviation") or "").lower()
        if name != desired_group_name and child.get("abbreviation", "").lower() != group_label.lower():
            continue
        for entry in child.get("standings", {}).get("entries", []):
            team_meta = entry.get("team", {})
            stats = {s.get("name"): s.get("value") for s in entry.get("stats", [])}
            display = team_meta.get("displayName") or team_meta.get("name") or "Unknown"
            team_id = team_meta.get("id")
            if team_id is not None:
                team_id_to_name[str(team_id)] = display
            teams.append(
                _GroupTeam(
                    team_id=int(team_id) if team_id and str(team_id).isdigit() else None,
                    name=display,
                    # National-team ELO from the committed tournament corpus —
                    # the club ELO system defaults every national side to 1500.
                    elo=float(national_elo_for(display)),
                    points=int(stats.get("points", 0) or 0),
                    gf=int(stats.get("pointsFor", 0) or 0),
                    ga=int(stats.get("pointsAgainst", 0) or 0),
                    played=int(stats.get("gamesPlayed", 0) or 0),
                )
            )

    # Build match list from scoreboard events filtered to teams in this group.
    matches: List[_Match] = []
    team_names = {t.name for t in teams}
    seen_ids = set()
    for event in (scoreboard or {}).get("events", []) if scoreboard else []:
        comp = (event.get("competitions") or [{}])[0]
        if not comp:
            continue
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        home_name = home.get("team", {}).get("displayName") or ""
        away_name = away.get("team", {}).get("displayName") or ""
        if home_name not in team_names or away_name not in team_names:
            continue
        event_id = str(event.get("id") or f"{home_name}-{away_name}")
        if event_id in seen_ids:
            continue
        seen_ids.add(event_id)
        status_type = (comp.get("status") or {}).get("type") or {}
        completed = bool(status_type.get("completed"))
        try:
            hg = int(home.get("score")) if home.get("score") is not None else None
            ag = int(away.get("score")) if away.get("score") is not None else None
        except (TypeError, ValueError):
            hg, ag = None, None
        matches.append(
            _Match(
                match_id=event_id,
                home=home_name,
                away=away_name,
                home_goals=hg if completed else None,
                away_goals=ag if completed else None,
                date=event.get("date"),
            )
        )

    # Apply played match results to per-team h2h tallies.  (Group/season
    # totals already came from standings.)
    for m in matches:
        if not m.is_played:
            continue
        _apply_h2h(teams, m.home, m.away, m.home_goals or 0, m.away_goals or 0)

    return teams, matches


def _apply_h2h(teams: List[_GroupTeam], home: str, away: str, hg: int, ag: int) -> None:
    home_t = next((t for t in teams if t.name == home), None)
    away_t = next((t for t in teams if t.name == away), None)
    if not home_t or not away_t:
        return
    home_t.h2h_gf[away] = home_t.h2h_gf.get(away, 0) + hg
    home_t.h2h_ga[away] = home_t.h2h_ga.get(away, 0) + ag
    away_t.h2h_gf[home] = away_t.h2h_gf.get(home, 0) + ag
    away_t.h2h_ga[home] = away_t.h2h_ga.get(home, 0) + hg
    if hg > ag:
        home_t.h2h_points[away] = home_t.h2h_points.get(away, 0) + 3
    elif ag > hg:
        away_t.h2h_points[home] = away_t.h2h_points.get(home, 0) + 3
    else:
        home_t.h2h_points[away] = home_t.h2h_points.get(away, 0) + 1
        away_t.h2h_points[home] = away_t.h2h_points.get(home, 0) + 1


# ---------------------------------------------------------------------------
# Score sampling — build per-remaining-match score-probability matrix and
# vectorise the sampling across all simulations.
# ---------------------------------------------------------------------------


def _expected_goals(home: _GroupTeam, away: _GroupTeam) -> Tuple[float, float]:
    """Convert ELO + league averages to expected goals for both teams."""
    params = LEAGUE_PARAMS.get(WORLD_CUP_LEAGUE_KEY, LEAGUE_PARAMS.get("fifa.world", {}))
    avg_goals = float(params.get("avg_goals", 1.30))
    home_adv = float(params.get("home_adv", 0.15))
    # World Cup is on neutral venues — keep a small `home_adv` because the
    # "home" team in the fixture is the nominal listed home side.
    # Calibrated Elo->xG coupling shared across all simulators.
    return elo_expected_goals(
        home.elo, away.elo, avg_goals=avg_goals, home_adv=home_adv,
        home_clamp=(0.25, 4.5), away_clamp=(0.20, 4.0),
    )


def _build_score_matrix(home: _GroupTeam, away: _GroupTeam, poisson: PoissonModel) -> np.ndarray:
    home_xg, away_xg = _expected_goals(home, away)
    params = LEAGUE_PARAMS.get(WORLD_CUP_LEAGUE_KEY, {})
    rho = float(params.get("rho", -0.09))
    matrix = poisson.score_matrix(home_xg, away_xg, rho=rho).matrix  # (M+1, M+1)
    # Truncate to MAX_GOALS for compactness
    m = min(MAX_GOALS, matrix.shape[0] - 1)
    truncated = matrix[: m + 1, : m + 1].copy()
    truncated = truncated / truncated.sum()
    return truncated


def _sample_scores(matrix: np.ndarray, n: int, rng: np.random.Generator) -> Tuple[np.ndarray, np.ndarray]:
    """Vectorised sampling of (home_goals, away_goals) pairs from a score matrix."""
    flat = matrix.flatten()
    cum = np.cumsum(flat)
    u = rng.random(n)
    idx = np.searchsorted(cum, u, side="right").clip(0, len(flat) - 1)
    width = matrix.shape[1]
    return idx // width, idx % width


# ---------------------------------------------------------------------------
# Tiebreakers — implements FIFA group-stage rules in the order:
#   1. Points
#   2. Goal difference
#   3. Goals scored
#   4. Head-to-head points (between tied teams only)
#   5. Head-to-head goal difference (between tied teams only)
#   6. Head-to-head goals scored
#   7. Drawing of lots (simplified to a deterministic seeded coin flip)
# Fair-play points are omitted because the simulator has no card data —
# we go straight from H2H to the lots draw.
# ---------------------------------------------------------------------------


def _rank_standings(
    team_names: List[str],
    points: np.ndarray,
    gf: np.ndarray,
    ga: np.ndarray,
    h2h_results: Dict[Tuple[int, int], Tuple[int, int]],
    tiebreak_rng: np.random.Generator,
) -> List[int]:
    """Return team indices sorted from 1st to 4th."""
    n = len(team_names)
    indices = list(range(n))

    def _sort_key(i: int) -> Tuple[float, float, float]:
        return (-points[i], -(gf[i] - ga[i]), -gf[i])

    indices.sort(key=_sort_key)

    # Resolve sub-ties via H2H, then random.
    final: List[int] = []
    i = 0
    while i < len(indices):
        j = i
        # find a run of ties on (points, GD, GF)
        while j + 1 < len(indices) and (
            points[indices[j + 1]] == points[indices[i]]
            and (gf[indices[j + 1]] - ga[indices[j + 1]]) == (gf[indices[i]] - ga[indices[i]])
            and gf[indices[j + 1]] == gf[indices[i]]
        ):
            j += 1
        run = indices[i : j + 1]
        if len(run) == 1:
            final.append(run[0])
        else:
            final.extend(_resolve_h2h(run, h2h_results, tiebreak_rng))
        i = j + 1
    return final


def _resolve_h2h(
    run: List[int],
    h2h: Dict[Tuple[int, int], Tuple[int, int]],
    rng: np.random.Generator,
) -> List[int]:
    """Resolve tied teams using head-to-head, then lots."""
    # Compute h2h sub-table for the tied teams only
    h2h_pts: Dict[int, int] = {i: 0 for i in run}
    h2h_gf: Dict[int, int] = {i: 0 for i in run}
    h2h_ga: Dict[int, int] = {i: 0 for i in run}
    for a in run:
        for b in run:
            if a == b:
                continue
            score = h2h.get((a, b))
            if not score:
                continue
            ag, bg = score
            h2h_gf[a] += ag
            h2h_ga[a] += bg
            if ag > bg:
                h2h_pts[a] += 3
            elif ag == bg:
                h2h_pts[a] += 1

    def _key(i: int) -> Tuple[float, float, float, float]:
        return (-h2h_pts[i], -(h2h_gf[i] - h2h_ga[i]), -h2h_gf[i], rng.random())

    return sorted(run, key=_key)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _serialise_matches(matches: List[_Match]) -> Tuple[List[Dict], List[Dict]]:
    played, remaining = [], []
    for m in matches:
        payload = {
            "match_id": m.match_id,
            "home": m.home,
            "away": m.away,
            "date": m.date,
        }
        if m.is_played:
            played.append({**payload, "home_goals": m.home_goals, "away_goals": m.away_goals})
        else:
            remaining.append(payload)
    return played, remaining


def _build_team_index(teams: List[_GroupTeam]) -> Dict[str, int]:
    return {t.name: i for i, t in enumerate(teams)}


def _simulate_core(
    teams: List[_GroupTeam],
    matches: List[_Match],
    n_simulations: int,
    seed: Optional[int],
) -> Dict:
    if len(teams) != 4:
        # World Cup 2026 expanded format may have larger groups, but the
        # tiebreaker logic is symmetric — keep going so long as we have
        # at least two teams.
        if len(teams) < 2:
            raise ValueError(f"Group has only {len(teams)} teams; cannot simulate")
        logger.warning(f"Group has {len(teams)} teams (expected 4)")

    rng = np.random.default_rng(seed)
    poisson = PoissonModel(max_goals=MAX_GOALS)
    name_to_idx = _build_team_index(teams)
    n_teams = len(teams)

    # Per-simulation starting points/gf/ga from played matches.
    base_points = np.array([t.points for t in teams], dtype=np.int32)
    base_gf = np.array([t.gf for t in teams], dtype=np.int32)
    base_ga = np.array([t.ga for t in teams], dtype=np.int32)

    # Pre-build score matrices and sample scores for each remaining match.
    remaining = [m for m in matches if not m.is_played]
    sampled_home: List[np.ndarray] = []
    sampled_away: List[np.ndarray] = []
    for m in remaining:
        home_team = teams[name_to_idx[m.home]]
        away_team = teams[name_to_idx[m.away]]
        matrix = _build_score_matrix(home_team, away_team, poisson)
        hg, ag = _sample_scores(matrix, n_simulations, rng)
        sampled_home.append(hg.astype(np.int32))
        sampled_away.append(ag.astype(np.int32))

    # Tiebreaker RNG separate so seed determinism holds even when the
    # remaining-match RNG state shifts.
    tiebreak_rng = np.random.default_rng(None if seed is None else seed + 1)

    # Accumulators
    first_counts = np.zeros(n_teams, dtype=np.int64)
    second_counts = np.zeros(n_teams, dtype=np.int64)
    eliminated_counts = np.zeros(n_teams, dtype=np.int64)
    expected_points = np.zeros(n_teams, dtype=np.float64)
    expected_gd = np.zeros(n_teams, dtype=np.float64)
    ordering_counter: Counter = Counter()

    # Stable H2H from played results
    base_h2h: Dict[Tuple[int, int], Tuple[int, int]] = {}
    for m in matches:
        if m.is_played:
            i, j = name_to_idx[m.home], name_to_idx[m.away]
            base_h2h[(i, j)] = (m.home_goals or 0, m.away_goals or 0)
            base_h2h[(j, i)] = (m.away_goals or 0, m.home_goals or 0)

    team_names = [t.name for t in teams]

    for sim in range(n_simulations):
        pts = base_points.copy()
        gf = base_gf.copy()
        ga = base_ga.copy()
        h2h = dict(base_h2h)

        for k, m in enumerate(remaining):
            i, j = name_to_idx[m.home], name_to_idx[m.away]
            hg = int(sampled_home[k][sim])
            ag = int(sampled_away[k][sim])
            gf[i] += hg
            ga[i] += ag
            gf[j] += ag
            ga[j] += hg
            if hg > ag:
                pts[i] += 3
            elif ag > hg:
                pts[j] += 3
            else:
                pts[i] += 1
                pts[j] += 1
            h2h[(i, j)] = (hg, ag)
            h2h[(j, i)] = (ag, hg)

        ordering = _rank_standings(team_names, pts, gf, ga, h2h, tiebreak_rng)
        first_counts[ordering[0]] += 1
        if n_teams > 1:
            second_counts[ordering[1]] += 1
        # Eliminated = positions 3..n
        for pos in range(2, n_teams):
            eliminated_counts[ordering[pos]] += 1
        expected_points += pts
        expected_gd += (gf - ga)

        ordering_counter[tuple(team_names[idx] for idx in ordering)] += 1

    p_first = first_counts / n_simulations
    p_second = second_counts / n_simulations
    p_either = p_first + p_second
    p_eliminated = eliminated_counts / n_simulations
    avg_points = expected_points / n_simulations
    avg_gd = expected_gd / n_simulations

    team_payload = []
    for i, t in enumerate(teams):
        team_payload.append({
            "team_id": t.team_id,
            "name": t.name,
            "p_advance_first": round(float(p_first[i]), 4),
            "p_advance_second": round(float(p_second[i]), 4),
            "p_advance_either": round(float(p_either[i]), 4),
            "p_eliminated": round(float(p_eliminated[i]), 4),
            "expected_points": round(float(avg_points[i]), 2),
            "expected_gd": round(float(avg_gd[i]), 2),
            "current_points": int(t.points),
            "current_gf": int(t.gf),
            "current_ga": int(t.ga),
            "current_played": int(t.played),
        })
    # Sort teams payload by descending p_advance_either then expected points.
    team_payload.sort(key=lambda r: (-r["p_advance_either"], -r["expected_points"]))

    most_likely = [
        {"order": list(order), "probability": round(count / n_simulations, 4)}
        for order, count in ordering_counter.most_common(3)
    ]

    played_payload, remaining_payload = _serialise_matches(matches)

    return {
        "teams": team_payload,
        "played_matches": played_payload,
        "remaining_matches": remaining_payload,
        "most_likely_standings": most_likely,
    }


def simulate_group(
    group_id: str,
    n_simulations: int = 50_000,
    seed: Optional[int] = None,
) -> Dict:
    """
    Run a Monte Carlo group simulation and return advancement probabilities.

    See module docstring for output schema.
    """
    teams, matches = _load_group_data(group_id)
    if not teams:
        return {
            "group_id": group_id.upper(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "n_simulations": 0,
            "teams": [],
            "played_matches": [],
            "remaining_matches": [],
            "most_likely_standings": [],
            "error": "No teams available for this group yet.",
        }

    core = _simulate_core(teams, matches, n_simulations, seed)
    return {
        "group_id": group_id.upper(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_simulations": n_simulations,
        **core,
    }


def simulate_group_what_if(
    group_id: str,
    forced_results: Dict[str, Tuple[int, int]],
    n_simulations: int = 20_000,
    seed: Optional[int] = None,
) -> Dict:
    """
    Same as `simulate_group` but with the given `forced_results` applied
    before simulation.  `forced_results` maps `match_id` to a
    `(home_goals, away_goals)` tuple — those matches are treated as played.

    Useful for "what if Team X beats Team Y 2-1?" scenarios in the
    scenario explorer (Phase 3.2).
    """
    teams, matches = _load_group_data(group_id)
    if not teams:
        return {
            "group_id": group_id.upper(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "n_simulations": 0,
            "teams": [],
            "played_matches": [],
            "remaining_matches": [],
            "most_likely_standings": [],
            "forced_results": forced_results,
            "error": "No teams available for this group yet.",
        }

    # Apply forced results — both to the match record and to team
    # standings (so played stats reflect the forced scoreline).
    name_to_idx = _build_team_index(teams)
    for m in matches:
        if m.is_played:
            continue
        forced = forced_results.get(m.match_id) or forced_results.get(str(m.match_id))
        if not forced:
            continue
        hg, ag = int(forced[0]), int(forced[1])
        m.home_goals = hg
        m.away_goals = ag
        h_idx = name_to_idx[m.home]
        a_idx = name_to_idx[m.away]
        teams[h_idx].gf += hg
        teams[h_idx].ga += ag
        teams[a_idx].gf += ag
        teams[a_idx].ga += hg
        teams[h_idx].played += 1
        teams[a_idx].played += 1
        if hg > ag:
            teams[h_idx].points += 3
        elif ag > hg:
            teams[a_idx].points += 3
        else:
            teams[h_idx].points += 1
            teams[a_idx].points += 1
        _apply_h2h(teams, m.home, m.away, hg, ag)

    core = _simulate_core(teams, matches, n_simulations, seed)
    return {
        "group_id": group_id.upper(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_simulations": n_simulations,
        "forced_results": {k: [int(v[0]), int(v[1])] for k, v in forced_results.items()},
        **core,
    }


__all__ = ["simulate_group", "simulate_group_what_if"]
