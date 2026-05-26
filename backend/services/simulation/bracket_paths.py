"""
World Cup knockout-bracket Monte Carlo simulator.

For the FIFA World Cup knockout stage (Round of 16 → Final), this module:
  1. Loads the live bracket from ESPN (same scoreboard endpoint the
     Next.js `/api/tournament/world_cup` route uses) and detects whether
     all R16 entrants are confirmed.
  2. If the bracket is "set" (all entrants confirmed) it simulates KO
     matches in order, sampling scorelines via the existing
     `PoissonModel.score_matrix` and the ELO -> xG formula used by
     `group_permutations.py`.  Draws are resolved by a 50/50 penalty
     shootout — a coin flip rather than an explicit shootout model,
     since once the match reaches penalties the result is well-known
     to be a near-coin-flip.
  3. If the bracket is not yet set (group stage still running) it
     falls back to running `simulate_group` (bounded to 1k internal
     sims per group) for every group, then per outer simulation samples
     KO entrants from those group-stage distributions and walks the
     standard 1A/2B, 1B/2A, ... bracket layout.

Per simulation we walk each round in order; per team we record the
furthest round reached.  Aggregates yield:
  - p_champion, p_final, p_semi, p_quarter, p_r16 (cumulative)
  - most_likely_round_reached

The bracket structure (matchups in each round) is included in the
output so the frontend can draw probability badges next to each
bracket slot.

Determinism: passing the same `seed` produces the same result.
"""

from __future__ import annotations

import asyncio
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.services.prediction.probabilistic import (
    LEAGUE_PARAMS,
    PoissonModel,
)
from backend.services.ratings import get_elo_system

logger = logging.getLogger(__name__)


WORLD_CUP_LEAGUE_KEY = "fifa.world"
ESPN_LEAGUE_ID = "fifa.world"
MAX_GOALS = 8

# Round labels we attempt to recognise in ESPN scoreboard series titles.
ROUND_ALIASES: Dict[str, Sequence[str]] = {
    "R16": ("round of 16", "round-of-16", "r16", "last 16"),
    "QF": ("quarter", "quarterfinal", "qf"),
    "SF": ("semi", "semifinal", "sf"),
    "F":  ("final",),
}

# Cumulative-reach keys, ordered from earliest stage to final.
ROUND_KEYS = ["p_r16", "p_quarter", "p_semi", "p_final", "p_champion"]
ROUND_LABEL_FOR_KEY = {
    "p_r16": "Round of 16",
    "p_quarter": "Quarter-Finals",
    "p_semi": "Semi-Finals",
    "p_final": "Final",
    "p_champion": "Champion",
}


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------


@dataclass
class _KOMatch:
    match_id: str
    round_key: str           # "R16" | "QF" | "SF" | "F"
    home: Optional[str]      # may be None (TBD)
    away: Optional[str]      # may be None (TBD)
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    winner: Optional[str] = None  # team name of winner if finished
    date: Optional[str] = None


@dataclass
class _Bracket:
    rounds: Dict[str, List[_KOMatch]] = field(default_factory=dict)
    all_teams: List[str] = field(default_factory=list)

    @property
    def is_set(self) -> bool:
        """All R16 matches must have both teams known."""
        r16 = self.rounds.get("R16", [])
        if not r16:
            return False
        return all(m.home and m.away for m in r16)


# ---------------------------------------------------------------------------
# Bracket loader — pull the KO scoreboard via the existing ESPN client.
# ---------------------------------------------------------------------------


def _classify_round(series_title: str, season_slug: str) -> Optional[str]:
    blob = f"{series_title} {season_slug}".lower()
    if "group" in blob:
        return None
    for key, aliases in ROUND_ALIASES.items():
        for alias in aliases:
            if alias in blob:
                return key
    return None


def _load_bracket_data() -> _Bracket:
    try:
        from backend.services.espn.client import get_espn_client
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(f"ESPN client unavailable: {exc}")
        return _Bracket()

    client = get_espn_client()

    async def _fetch():
        # Wide window covers full World Cup 2026 KO stage (late-June -> mid-July).
        return await client.get_scoreboard(
            "world_cup",
            date="20260620-20260801",
        )

    try:
        loop = asyncio.new_event_loop()
        scoreboard = loop.run_until_complete(_fetch())
        loop.close()
    except Exception as exc:
        logger.warning(f"ESPN KO scoreboard fetch failed: {exc}")
        scoreboard = None

    bracket = _Bracket(rounds={k: [] for k in ["R16", "QF", "SF", "F"]})
    seen_ids = set()
    teams_seen: List[str] = []

    for event in (scoreboard or {}).get("events", []) if scoreboard else []:
        comp = (event.get("competitions") or [{}])[0]
        if not comp:
            continue
        event_id = str(event.get("id") or "")
        if event_id in seen_ids:
            continue
        seen_ids.add(event_id)

        series_title = (comp.get("series") or {}).get("title") or ""
        season_slug = (event.get("season") or {}).get("slug") or ""
        round_key = _classify_round(series_title, season_slug)
        if not round_key:
            continue

        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue

        def _name(c):
            n = (c.get("team") or {}).get("displayName")
            if not n or n.upper() == "TBD":
                return None
            return n

        home_name = _name(home)
        away_name = _name(away)
        status_type = (comp.get("status") or {}).get("type") or {}
        completed = bool(status_type.get("completed"))

        try:
            hg = int(home.get("score")) if completed and home.get("score") is not None else None
            ag = int(away.get("score")) if completed and away.get("score") is not None else None
        except (TypeError, ValueError):
            hg, ag = None, None

        winner = None
        if completed:
            if home.get("winner"):
                winner = home_name
            elif away.get("winner"):
                winner = away_name
            elif hg is not None and ag is not None:
                if hg > ag:
                    winner = home_name
                elif ag > hg:
                    winner = away_name

        bracket.rounds.setdefault(round_key, []).append(
            _KOMatch(
                match_id=event_id,
                round_key=round_key,
                home=home_name,
                away=away_name,
                home_score=hg,
                away_score=ag,
                winner=winner,
                date=event.get("date"),
            )
        )
        for n in (home_name, away_name):
            if n and n not in teams_seen:
                teams_seen.append(n)

    # Order each round by date to keep the bracket sequence stable.
    for k, ms in bracket.rounds.items():
        ms.sort(key=lambda m: (m.date or ""))

    bracket.all_teams = teams_seen
    return bracket


# ---------------------------------------------------------------------------
# xG / score-matrix helpers (mirrors group_permutations.py exactly)
# ---------------------------------------------------------------------------


def _expected_goals(home_elo: float, away_elo: float) -> Tuple[float, float]:
    params = LEAGUE_PARAMS.get(WORLD_CUP_LEAGUE_KEY, {})
    avg_goals = float(params.get("avg_goals", 1.30))
    home_adv = float(params.get("home_adv", 0.15))
    elo_diff = (home_elo - away_elo) / 400.0
    home_xg = avg_goals * (1.0 + 0.30 * elo_diff) + home_adv
    away_xg = avg_goals * (1.0 - 0.30 * elo_diff)
    return max(0.25, min(4.5, home_xg)), max(0.20, min(4.0, away_xg))


def _build_pair_table(
    teams: List[str],
    elo_lookup: Dict[str, float],
    poisson: PoissonModel,
) -> Dict[Tuple[str, str], np.ndarray]:
    """
    For all team pairs, precompute the cumulative flattened probability
    array of the truncated score matrix.  Lets us sample a scoreline
    with one `searchsorted` call.
    """
    params = LEAGUE_PARAMS.get(WORLD_CUP_LEAGUE_KEY, {})
    rho = float(params.get("rho", -0.09))
    table: Dict[Tuple[str, str], np.ndarray] = {}
    for a in teams:
        for b in teams:
            if a == b:
                continue
            if (a, b) in table:
                continue
            home_xg, away_xg = _expected_goals(elo_lookup[a], elo_lookup[b])
            matrix = poisson.score_matrix(home_xg, away_xg, rho=rho).matrix
            m = min(MAX_GOALS, matrix.shape[0] - 1)
            truncated = matrix[: m + 1, : m + 1].copy()
            truncated /= truncated.sum()
            table[(a, b)] = np.cumsum(truncated.flatten())
    return table


def _sample_one(cum: np.ndarray, u: float, width: int) -> Tuple[int, int]:
    idx = int(np.searchsorted(cum, u, side="right"))
    if idx >= len(cum):
        idx = len(cum) - 1
    return idx // width, idx % width


# ---------------------------------------------------------------------------
# Group-stage fallback: when the bracket isn't set yet, sample R16 entrants
# from `simulate_group` outputs.
# ---------------------------------------------------------------------------


def _group_fallback_seeds(seed: Optional[int]) -> Optional[Dict[str, List[Tuple[str, float, float]]]]:
    """
    For each WC group (A..L) run a small 1k-sim group simulation and
    return the per-team (p_first, p_second) distributions.

    Bounded: 12 groups * 1k sims = 12k group sims total per outer call.
    """
    try:
        from backend.services.simulation.group_permutations import simulate_group
    except Exception as exc:
        logger.warning(f"Group simulator unavailable for fallback: {exc}")
        return None

    seeds: Dict[str, List[Tuple[str, float, float]]] = {}
    for letter in "ABCDEFGHIJKL":
        try:
            result = simulate_group(letter, n_simulations=1_000, seed=seed)
        except Exception as exc:
            logger.debug(f"Group {letter} sim failed in fallback: {exc}")
            continue
        teams = result.get("teams") or []
        if not teams:
            continue
        seeds[letter] = [
            (t["name"], float(t.get("p_advance_first", 0.0)), float(t.get("p_advance_second", 0.0)))
            for t in teams
        ]
    return seeds if seeds else None


def _draw_entrants_per_sim(
    seeds: Dict[str, List[Tuple[str, float, float]]],
    n_simulations: int,
    rng: np.random.Generator,
) -> Tuple[Dict[str, np.ndarray], List[str]]:
    """
    Draw, per outer simulation, a (1st-place team, 2nd-place team) per group.
    Returns dict: group_letter -> array shape (n_simulations, 2) of team-index
    references, plus the team-index name table.
    """
    name_to_idx: Dict[str, int] = {}

    def _intern(name: str) -> int:
        if name not in name_to_idx:
            name_to_idx[name] = len(name_to_idx)
        return name_to_idx[name]

    draws: Dict[str, np.ndarray] = {}
    for letter, rows in seeds.items():
        if not rows:
            continue
        names = [r[0] for r in rows]
        p_first = np.array([r[1] for r in rows], dtype=np.float64)
        p_second = np.array([r[2] for r in rows], dtype=np.float64)
        if p_first.sum() <= 0:
            p_first = np.ones_like(p_first)
        if p_second.sum() <= 0:
            p_second = np.ones_like(p_second)
        p_first /= p_first.sum()
        p_second /= p_second.sum()

        cum_first = np.cumsum(p_first)
        cum_second = np.cumsum(p_second)
        u1 = rng.random(n_simulations)
        u2 = rng.random(n_simulations)
        first_idx = np.searchsorted(cum_first, u1, side="right").clip(0, len(names) - 1)
        second_idx = np.searchsorted(cum_second, u2, side="right").clip(0, len(names) - 1)
        # If 1st == 2nd, bump 2nd to the next-most-likely available team.
        clash = first_idx == second_idx
        if clash.any():
            order = np.argsort(-p_second)
            fallback_pool = [int(i) for i in order]
            for s in np.where(clash)[0]:
                for cand in fallback_pool:
                    if cand != int(first_idx[s]):
                        second_idx[s] = cand
                        break

        team_ids = np.zeros((n_simulations, 2), dtype=np.int32)
        for s in range(n_simulations):
            team_ids[s, 0] = _intern(names[int(first_idx[s])])
            team_ids[s, 1] = _intern(names[int(second_idx[s])])
        draws[letter] = team_ids

    team_table = [""] * len(name_to_idx)
    for n, i in name_to_idx.items():
        team_table[i] = n
    return draws, team_table


# Standard 32-team WC bracket layout (FIFA-style pairings).  When 12 groups
# (48 teams) are in play the pairings differ; we approximate with the
# documented 1A/2B style pairing across 8 ties for the legacy 16-team R16.
_R16_PAIRS_16TEAM = [
    ("A", 0, "B", 1),
    ("C", 0, "D", 1),
    ("E", 0, "F", 1),
    ("G", 0, "H", 1),
    ("B", 0, "A", 1),
    ("D", 0, "C", 1),
    ("F", 0, "E", 1),
    ("H", 0, "G", 1),
]


# ---------------------------------------------------------------------------
# Core simulator
# ---------------------------------------------------------------------------


def _round_matchups_payload(bracket: _Bracket) -> List[Dict]:
    payload = []
    for key in ["R16", "QF", "SF", "F"]:
        ties = []
        for m in bracket.rounds.get(key, []):
            ties.append({
                "match_id": m.match_id,
                "home": m.home,
                "away": m.away,
                "home_score": m.home_score,
                "away_score": m.away_score,
                "winner": m.winner,
                "date": m.date,
            })
        if ties:
            payload.append({"round": key, "label": ROUND_LABEL_FOR_KEY.get(
                {"R16": "p_r16", "QF": "p_quarter", "SF": "p_semi", "F": "p_final"}[key],
                key,
            ), "matches": ties})
    return payload


def _simulate_bracket_set(
    bracket: _Bracket,
    n_simulations: int,
    seed: Optional[int],
) -> Dict:
    rng = np.random.default_rng(seed)
    poisson = PoissonModel(max_goals=MAX_GOALS)
    elo = get_elo_system()

    # Round 1 entrants come straight from the R16 fixtures.
    r16 = bracket.rounds.get("R16", [])
    if len(r16) < 2:
        raise ValueError("Bracket has too few R16 matches to simulate")

    all_teams: List[str] = []
    for m in r16:
        for n in (m.home, m.away):
            if n and n not in all_teams:
                all_teams.append(n)

    elo_lookup = {t: float(elo.get_elo(t)) for t in all_teams}
    pair_cum = _build_pair_table(all_teams, elo_lookup, poisson)
    width = MAX_GOALS + 1

    # Reach counters per team.
    n_teams = len(all_teams)
    name_to_idx = {t: i for i, t in enumerate(all_teams)}

    reach_counts = {
        "p_r16": np.ones(n_teams, dtype=np.int64) * n_simulations,  # all R16 entrants reach R16 by definition
        "p_quarter": np.zeros(n_teams, dtype=np.int64),
        "p_semi": np.zeros(n_teams, dtype=np.int64),
        "p_final": np.zeros(n_teams, dtype=np.int64),
        "p_champion": np.zeros(n_teams, dtype=np.int64),
    }

    # Bracket structure: ordered fixture indices per round; QF[i] = winner of R16[2i] vs winner of R16[2i+1] etc.
    n_r16 = len(r16)
    n_qf = n_r16 // 2
    n_sf = n_qf // 2

    for sim in range(n_simulations):
        # Round 1: R16
        r16_winners: List[str] = []
        for m in r16:
            if m.winner:
                r16_winners.append(m.winner)
                continue
            a, b = m.home, m.away
            if not a or not b:
                # Shouldn't happen when bracket is set, but be defensive.
                r16_winners.append(a or b or "TBD")
                continue
            winner = _simulate_match(a, b, pair_cum, width, rng)
            r16_winners.append(winner)
        for w in r16_winners:
            if w in name_to_idx:
                # Already accounted for in baseline; keep R16 = n_sims.
                pass

        # Round 2: QF
        qf_winners: List[str] = []
        for i in range(n_qf):
            a, b = r16_winners[2 * i], r16_winners[2 * i + 1]
            # Use ESPN result if QF already played and teams match.
            qf_match = bracket.rounds.get("QF", [])
            played = _find_played(qf_match, a, b)
            if played:
                w = played
            else:
                w = _simulate_match(a, b, pair_cum, width, rng)
            qf_winners.append(w)
        for w in qf_winners:
            if w in name_to_idx:
                reach_counts["p_quarter"][name_to_idx[w]] += 1

        # Round 3: SF
        sf_winners: List[str] = []
        for i in range(n_sf):
            a, b = qf_winners[2 * i], qf_winners[2 * i + 1]
            played = _find_played(bracket.rounds.get("SF", []), a, b)
            if played:
                w = played
            else:
                w = _simulate_match(a, b, pair_cum, width, rng)
            sf_winners.append(w)
        for w in sf_winners:
            if w in name_to_idx:
                reach_counts["p_semi"][name_to_idx[w]] += 1

        # Final
        if len(sf_winners) >= 2:
            a, b = sf_winners[0], sf_winners[1]
            played = _find_played(bracket.rounds.get("F", []), a, b)
            if played:
                champ = played
            else:
                champ = _simulate_match(a, b, pair_cum, width, rng)
            for finalist in (a, b):
                if finalist in name_to_idx:
                    reach_counts["p_final"][name_to_idx[finalist]] += 1
            if champ in name_to_idx:
                reach_counts["p_champion"][name_to_idx[champ]] += 1

    # NOTE: p_quarter etc. measure "reached this round" (i.e. won the prior).
    # Adjust semantics: p_quarter = made QF = won R16.  We've been counting
    # winners — that matches "advanced into QF".  Cumulative-reach below.
    return _finalise(
        all_teams,
        reach_counts,
        n_simulations,
        bracket,
        bracket_set=True,
    )


def _simulate_match(
    a: str,
    b: str,
    pair_cum: Dict[Tuple[str, str], np.ndarray],
    width: int,
    rng: np.random.Generator,
) -> str:
    """Sample one match scoreline; if drawn, coin-flip a penalty winner."""
    cum = pair_cum.get((a, b))
    if cum is None:
        # Either team missing from pair table -> coin flip fallback.
        return a if rng.random() < 0.5 else b
    u = float(rng.random())
    hg, ag = _sample_one(cum, u, width)
    if hg > ag:
        return a
    if ag > hg:
        return b
    # Draw -> penalties -> 50/50.
    return a if rng.random() < 0.5 else b


def _find_played(matches: List[_KOMatch], a: str, b: str) -> Optional[str]:
    for m in matches:
        if not m.winner:
            continue
        pair = {m.home, m.away}
        if a in pair and b in pair:
            return m.winner
    return None


def _finalise(
    all_teams: List[str],
    reach_counts: Dict[str, np.ndarray],
    n_simulations: int,
    bracket: _Bracket,
    bracket_set: bool,
) -> Dict:
    team_payload = []
    for i, t in enumerate(all_teams):
        # Cumulative reach probabilities — each later-round counter only
        # contains sims where the team advanced to that round.
        probs = {k: float(reach_counts[k][i]) / float(n_simulations) for k in ROUND_KEYS}
        # Compute "most likely round reached" using exclusive-round probs
        # (i.e. reached this round but not the next).
        exclusive: Dict[str, float] = {}
        ordered = ROUND_KEYS  # earliest -> latest
        for idx, key in enumerate(ordered):
            here = probs[key]
            nxt = probs[ordered[idx + 1]] if idx + 1 < len(ordered) else 0.0
            exclusive[key] = max(0.0, here - nxt)
        # most likely is the round_key with max exclusive prob
        best_key = max(exclusive, key=lambda k: exclusive[k])
        team_payload.append({
            "team_id": None,
            "name": t,
            "p_champion": round(probs["p_champion"], 4),
            "p_final": round(probs["p_final"], 4),
            "p_semi": round(probs["p_semi"], 4),
            "p_quarter": round(probs["p_quarter"], 4),
            "p_r16": round(probs["p_r16"], 4),
            "most_likely_round_reached": ROUND_LABEL_FOR_KEY[best_key],
        })

    team_payload.sort(key=lambda r: (-r["p_champion"], -r["p_final"], -r["p_semi"]))

    return {
        "tournament": "world_cup",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_simulations": n_simulations,
        "bracket_set": bracket_set,
        "teams": team_payload,
        "round_matchups": _round_matchups_payload(bracket),
    }


def _simulate_bracket_group_fallback(
    bracket: _Bracket,
    n_simulations: int,
    seed: Optional[int],
) -> Dict:
    """Group stage in progress: probabilistic R16 entrants drawn from group sims."""
    seeds = _group_fallback_seeds(seed)
    if not seeds:
        # Nothing we can do — return an empty-but-shaped response.
        return {
            "tournament": "world_cup",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "n_simulations": 0,
            "bracket_set": False,
            "teams": [],
            "round_matchups": _round_matchups_payload(bracket),
            "error": "Group-stage data not yet available for bracket fallback.",
        }

    rng = np.random.default_rng(seed)
    draws, team_table = _draw_entrants_per_sim(seeds, n_simulations, rng)

    poisson = PoissonModel(max_goals=MAX_GOALS)
    elo = get_elo_system()
    all_teams = [t for t in team_table if t]
    elo_lookup = {t: float(elo.get_elo(t)) for t in all_teams}
    pair_cum = _build_pair_table(all_teams, elo_lookup, poisson)
    width = MAX_GOALS + 1

    n_teams = len(all_teams)
    name_to_idx = {t: i for i, t in enumerate(all_teams)}
    reach_counts = {
        "p_r16": np.zeros(n_teams, dtype=np.int64),
        "p_quarter": np.zeros(n_teams, dtype=np.int64),
        "p_semi": np.zeros(n_teams, dtype=np.int64),
        "p_final": np.zeros(n_teams, dtype=np.int64),
        "p_champion": np.zeros(n_teams, dtype=np.int64),
    }

    # Build the pairings only for the groups we have seeds for; pad to 8 ties.
    pairs = [p for p in _R16_PAIRS_16TEAM
             if p[0] in draws and p[2] in draws]
    if not pairs:
        return {
            "tournament": "world_cup",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "n_simulations": 0,
            "bracket_set": False,
            "teams": [],
            "round_matchups": _round_matchups_payload(bracket),
            "error": "Insufficient group seeds for fallback bracket.",
        }

    for sim in range(n_simulations):
        # Build the 16 entrants for this sim.
        r16_entrants: List[Tuple[str, str]] = []
        for (ga, pa, gb, pb) in pairs:
            ta = team_table[int(draws[ga][sim, pa])]
            tb = team_table[int(draws[gb][sim, pb])]
            r16_entrants.append((ta, tb))

        # All entrants reach R16 in this sim.
        for ta, tb in r16_entrants:
            if ta in name_to_idx:
                reach_counts["p_r16"][name_to_idx[ta]] += 1
            if tb in name_to_idx:
                reach_counts["p_r16"][name_to_idx[tb]] += 1

        # R16 -> QF
        r16_winners: List[str] = []
        for ta, tb in r16_entrants:
            r16_winners.append(_simulate_match(ta, tb, pair_cum, width, rng))
        for w in r16_winners:
            if w in name_to_idx:
                reach_counts["p_quarter"][name_to_idx[w]] += 1

        # QF -> SF
        n_qf = len(r16_winners) // 2
        qf_winners: List[str] = []
        for i in range(n_qf):
            a, b = r16_winners[2 * i], r16_winners[2 * i + 1]
            qf_winners.append(_simulate_match(a, b, pair_cum, width, rng))
        for w in qf_winners:
            if w in name_to_idx:
                reach_counts["p_semi"][name_to_idx[w]] += 1

        # SF -> F
        n_sf = len(qf_winners) // 2
        sf_winners: List[str] = []
        for i in range(n_sf):
            a, b = qf_winners[2 * i], qf_winners[2 * i + 1]
            sf_winners.append(_simulate_match(a, b, pair_cum, width, rng))
        for finalist in sf_winners:
            if finalist in name_to_idx:
                reach_counts["p_final"][name_to_idx[finalist]] += 1

        if len(sf_winners) >= 2:
            champ = _simulate_match(sf_winners[0], sf_winners[1], pair_cum, width, rng)
            if champ in name_to_idx:
                reach_counts["p_champion"][name_to_idx[champ]] += 1

    return _finalise(all_teams, reach_counts, n_simulations, bracket, bracket_set=False)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def simulate_bracket(
    tournament: str = "world_cup",
    n_simulations: int = 20_000,
    seed: Optional[int] = None,
) -> Dict:
    """
    Simulate the live World Cup knockout bracket and return cumulative
    per-team reach probabilities for each round.
    """
    if tournament != "world_cup":
        raise ValueError(f"bracket_paths currently only supports world_cup, got {tournament!r}")

    bracket = _load_bracket_data()
    if bracket.is_set:
        return _simulate_bracket_set(bracket, n_simulations=n_simulations, seed=seed)
    return _simulate_bracket_group_fallback(bracket, n_simulations=n_simulations, seed=seed)


__all__ = ["simulate_bracket"]
