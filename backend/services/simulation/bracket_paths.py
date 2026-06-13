"""
World Cup knockout-bracket Monte Carlo simulator (2026 48-team aware).

For the FIFA World Cup knockout stage this module:
  1. Loads the live bracket from ESPN (same scoreboard endpoint the
     Next.js `/api/tournament/world_cup` route uses). ESPN publishes the
     full official bracket before the group stage resolves, with
     placeholder competitors that encode the real slot structure:
       - "Group A Winner" / "Group A 2nd Place"
       - "Third Place Group A/B/C/D/F"  (the allowed-groups constraint)
       - "Round of 32 3 Winner", "Quarterfinal 1 Winner", ... (chained)
     These placeholders are parsed into slots — they are never treated
     as real teams.
  2. Group-stage slots are resolved per simulation by sampling group
     outcomes from `simulate_group` marginals (1st/2nd place), with the
     third-placed team drawn from the remaining sides. The eight best
     thirds are approximated by ELO ranking (the real rule uses points
     then goal difference, which aren't available pre-resolution), then
     assigned to third-place slots honouring their allowed-group lists.
  3. Chained slots resolve to the winner of the referenced tie in the
     previous round (ties are indexed in kickoff order — ESPN labels
     them the same way). Matches that already have a real winner are
     used as-is; everything else is sampled via the existing
     `PoissonModel.score_matrix` + ELO -> xG formula shared with
     `group_permutations.py`. Drawn KO matches resolve by a 50/50
     penalty coin flip.

Per simulation we walk each round in order; per team we record the
furthest round reached.  Aggregates yield:
  - p_champion, p_final, p_semi, p_quarter, p_r16, p_r32 (cumulative)
  - most_likely_round_reached

The bracket structure (matchups in each round) is included in the
output so the frontend can draw probability badges next to each
bracket slot.

Determinism: passing the same `seed` produces the same result.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.services.prediction.probabilistic import (
    LEAGUE_PARAMS,
    PoissonModel,
)
from backend.services.ratings.national_elo import national_elo_for

logger = logging.getLogger(__name__)


WORLD_CUP_LEAGUE_KEY = "fifa.world"
ESPN_LEAGUE_ID = "fifa.world"
MAX_GOALS = 8

# Knockout rounds in play order. R32 only exists in the 48-team format;
# older tournaments simply have no R32 matches and start at R16.
ROUND_SEQUENCE = ["R32", "R16", "QF", "SF", "F"]

# Round labels we attempt to recognise in ESPN scoreboard series titles.
# Checked in this order — "round of 32" must be tested before "round of 16"
# style aliases never collide, but keep R32 first for clarity.
ROUND_ALIASES: Dict[str, Sequence[str]] = {
    "R32": ("round of 32", "round-of-32", "r32", "last 32"),
    "R16": ("round of 16", "round-of-16", "r16", "last 16"),
    "QF": ("quarter", "quarterfinal", "qf"),
    "SF": ("semi", "semifinal", "sf"),
    "F":  ("final",),
}

# Cumulative-reach keys, ordered from earliest stage to final.
ROUND_KEYS = ["p_r32", "p_r16", "p_quarter", "p_semi", "p_final", "p_champion"]
ROUND_LABEL_FOR_KEY = {
    "p_r32": "Round of 32",
    "p_r16": "Round of 16",
    "p_quarter": "Quarter-Finals",
    "p_semi": "Semi-Finals",
    "p_final": "Final",
    "p_champion": "Champion",
}
ROUND_LABELS = {
    "R32": "Round of 32",
    "R16": "Round of 16",
    "QF": "Quarter-Finals",
    "SF": "Semi-Finals",
    "F": "Final",
}
# Reach key credited for *winning* a tie in each round.
WIN_REACH_KEY = {
    "R32": "p_r16",
    "R16": "p_quarter",
    "QF": "p_semi",
    "SF": "p_final",
    "F": "p_champion",
}


# ---------------------------------------------------------------------------
# Placeholder parsing
# ---------------------------------------------------------------------------

_RE_GROUP_WINNER = re.compile(r"^group\s+([a-l])\s+(?:winner|1st\s+place)$", re.I)
_RE_GROUP_SECOND = re.compile(r"^group\s+([a-l])\s+(?:2nd\s+place|runners?[\s-]?up)$", re.I)
_RE_THIRD_PLACE = re.compile(r"^third\s+place\s+group\s+([a-l](?:/[a-l])*)$", re.I)
_RE_CHAIN = re.compile(
    r"^(round\s+of\s+32|round\s+of\s+16|quarter-?final|semi-?final)\s+(\d+)\s+winner$", re.I
)
_CHAIN_ROUND = {
    "round of 32": "R32",
    "round of 16": "R16",
    "quarterfinal": "QF",
    "quarter-final": "QF",
    "semifinal": "SF",
    "semi-final": "SF",
}
# Anything matching this is a placeholder we couldn't classify — still
# never a real team.
_RE_PLACEHOLDER = re.compile(r"winner|runner|loser|2nd place|3rd place|third place|^tbd$|play-?off", re.I)


def _parse_competitor(raw_name: Optional[str]) -> Tuple[Optional[str], Optional[Dict]]:
    """Return (real_team_name | None, slot | None) for an ESPN competitor name.

    Slots describe how an unresolved competitor gets filled:
      {"type": "group_winner",    "group": "A"}
      {"type": "group_runner_up", "group": "A"}
      {"type": "third_place",     "groups": ["A","B","C","D","F"]}
      {"type": "chain",           "round": "R32", "index": 3}   # 1-based, kickoff order
    """
    if not raw_name:
        return None, None
    name = raw_name.strip()
    if not name or name.upper() == "TBD":
        return None, None

    m = _RE_GROUP_WINNER.match(name)
    if m:
        return None, {"type": "group_winner", "group": m.group(1).upper()}
    m = _RE_GROUP_SECOND.match(name)
    if m:
        return None, {"type": "group_runner_up", "group": m.group(1).upper()}
    m = _RE_THIRD_PLACE.match(name)
    if m:
        groups = [g.upper() for g in m.group(1).split("/")]
        return None, {"type": "third_place", "groups": groups}
    m = _RE_CHAIN.match(name)
    if m:
        round_key = _CHAIN_ROUND.get(re.sub(r"\s+", " ", m.group(1).lower()))
        if round_key:
            return None, {"type": "chain", "round": round_key, "index": int(m.group(2))}
    if _RE_PLACEHOLDER.search(name):
        # Unclassified placeholder — unknown slot, but definitely not a team.
        return None, None
    return name, None


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------


@dataclass
class _KOMatch:
    match_id: str
    round_key: str           # "R32" | "R16" | "QF" | "SF" | "F"
    home: Optional[str]      # real team name, or None when unresolved
    away: Optional[str]
    home_slot: Optional[Dict] = None
    away_slot: Optional[Dict] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    winner: Optional[str] = None  # team name of winner if finished
    date: Optional[str] = None


@dataclass
class _Bracket:
    rounds: Dict[str, List[_KOMatch]] = field(default_factory=dict)
    all_teams: List[str] = field(default_factory=list)

    @property
    def first_round_key(self) -> Optional[str]:
        for key in ROUND_SEQUENCE:
            if self.rounds.get(key):
                return key
        return None

    @property
    def is_set(self) -> bool:
        """All first-round matches must have both real teams known."""
        first = self.first_round_key
        if not first:
            return False
        return all(m.home and m.away for m in self.rounds[first])

    @property
    def needs_group_resolution(self) -> bool:
        for matches in self.rounds.values():
            for m in matches:
                for slot in (m.home_slot, m.away_slot):
                    if slot and slot["type"] in ("group_winner", "group_runner_up", "third_place"):
                        return True
        return False


# ---------------------------------------------------------------------------
# Bracket loader — pull the KO scoreboard via the existing ESPN client.
# ---------------------------------------------------------------------------


def _classify_round(series_title: str, season_slug: str) -> Optional[str]:
    blob = f"{series_title} {season_slug}".lower()
    if "group" in blob:
        return None
    for key in ROUND_SEQUENCE:
        for alias in ROUND_ALIASES[key]:
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

    return _parse_scoreboard(scoreboard)


def _parse_scoreboard(scoreboard: Optional[Dict]) -> _Bracket:
    bracket = _Bracket(rounds={k: [] for k in ROUND_SEQUENCE})
    seen_ids = set()
    teams_seen: List[str] = []

    for event in (scoreboard or {}).get("events", []) or []:
        comp = (event.get("competitions") or [{}])[0]
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

        home_name, home_slot = _parse_competitor((home.get("team") or {}).get("displayName"))
        away_name, away_slot = _parse_competitor((away.get("team") or {}).get("displayName"))
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
                home_slot=home_slot,
                away_slot=away_slot,
                home_score=hg,
                away_score=ag,
                winner=winner,
                date=event.get("date"),
            )
        )
        for n in (home_name, away_name):
            if n and n not in teams_seen:
                teams_seen.append(n)

    # Order each round by date to keep the bracket sequence stable — chain
    # slots ("Round of 32 N Winner") index ties in kickoff order.
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


# ---------------------------------------------------------------------------
# Group-stage sampling: per-sim (1st, 2nd, 3rd) per group from
# `simulate_group` marginals.
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


def _draw_group_positions(
    seeds: Dict[str, List[Tuple[str, float, float]]],
    n_simulations: int,
    rng: np.random.Generator,
) -> Tuple[Dict[str, np.ndarray], List[str]]:
    """
    Draw, per outer simulation, the (1st, 2nd, 3rd) placed teams per group.

    1st and 2nd are sampled from the group-simulation marginals; 3rd is
    sampled from the remaining sides weighted by their overall advancement
    strength (p_first + p_second), which is the best proxy available from
    the marginal distributions.

    Returns dict: group_letter -> array shape (n_simulations, 3) of
    team-index references, plus the team-index name table.
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
        strength = p_first + p_second + 0.05  # third-place sampling weight
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

        team_ids = np.zeros((n_simulations, 3), dtype=np.int32)
        n_local = len(names)
        for s in range(n_simulations):
            fi, si = int(first_idx[s]), int(second_idx[s])
            team_ids[s, 0] = _intern(names[fi])
            team_ids[s, 1] = _intern(names[si])
            remaining = [i for i in range(n_local) if i not in (fi, si)]
            if remaining:
                w = strength[remaining]
                w = w / w.sum()
                ti = int(rng.choice(remaining, p=w))
                team_ids[s, 2] = _intern(names[ti])
            else:
                team_ids[s, 2] = team_ids[s, 1]
        draws[letter] = team_ids

    team_table = [""] * len(name_to_idx)
    for n, i in name_to_idx.items():
        team_table[i] = n
    return draws, team_table


def _assign_thirds(
    third_slots: List[Tuple[int, List[str]]],
    qualified: Dict[str, str],
) -> Dict[int, str]:
    """
    Assign qualified third-placed teams (group -> team name) to bracket
    slots, honouring each slot's allowed-group list.  Greedy: most
    constrained slot first; falls back to any unassigned third when no
    allowed group remains (keeps the simulation total-conserving).
    """
    assignment: Dict[int, str] = {}
    remaining = dict(qualified)  # group -> name
    for slot_id, allowed in sorted(third_slots, key=lambda s: len(s[1])):
        pick_group = next((g for g in allowed if g in remaining), None)
        if pick_group is None and remaining:
            pick_group = next(iter(remaining))
        if pick_group is not None:
            assignment[slot_id] = remaining.pop(pick_group)
    return assignment


# ---------------------------------------------------------------------------
# Core simulator — walks the parsed bracket from the current real state.
# ---------------------------------------------------------------------------


def _empty_payload(bracket: _Bracket, error: str) -> Dict:
    return {
        "tournament": "world_cup",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_simulations": 0,
        "bracket_set": bracket.is_set,
        "teams": [],
        "round_matchups": _round_matchups_payload(bracket),
        "error": error,
    }


def _simulate_current_state(
    bracket: _Bracket,
    n_simulations: int,
    seed: Optional[int],
) -> Dict:
    first_round = bracket.first_round_key
    if not first_round:
        return _empty_payload(bracket, "No knockout fixtures available yet.")

    rng = np.random.default_rng(seed)
    poisson = PoissonModel(max_goals=MAX_GOALS)

    # --- Group-outcome sampling (only when slots reference group results) ---
    draws: Dict[str, np.ndarray] = {}
    team_table: List[str] = []
    team_group: Dict[str, str] = {}
    if bracket.needs_group_resolution:
        seeds = _group_fallback_seeds(seed)
        if not seeds:
            if not bracket.is_set:
                return _empty_payload(bracket, "Group-stage data not yet available for bracket simulation.")
        else:
            draws, team_table = _draw_group_positions(seeds, n_simulations, rng)
            for letter, rows in seeds.items():
                for name, _, _ in rows:
                    team_group[name] = letter

    # --- Universe of teams: bracket real names + all group teams ---
    all_teams: List[str] = list(bracket.all_teams)
    for t in team_table:
        if t and t not in all_teams:
            all_teams.append(t)
    if not all_teams:
        return _empty_payload(bracket, "No teams resolved for bracket simulation.")

    # National-team ELO from the committed tournament corpus — the club ELO
    # system has no national sides and would flatten every team to 1500.
    elo_lookup = {t: float(national_elo_for(t)) for t in all_teams}
    pair_cum = _build_pair_table(all_teams, elo_lookup, poisson)
    width = MAX_GOALS + 1
    name_to_idx = {t: i for i, t in enumerate(all_teams)}
    n_teams = len(all_teams)

    reach_counts = {k: np.zeros(n_teams, dtype=np.int64) for k in ROUND_KEYS}
    entrant_reach_key = "p_r32" if first_round == "R32" else "p_r16"

    # Pre-index third-place slots in the first round for constraint matching.
    rounds_in_play = [k for k in ROUND_SEQUENCE if bracket.rounds.get(k)]

    for sim in range(n_simulations):
        # Group outcomes for this simulation.
        group_pos: Dict[str, Tuple[str, str, str]] = {}
        for letter, arr in draws.items():
            group_pos[letter] = (
                team_table[int(arr[sim, 0])],
                team_table[int(arr[sim, 1])],
                team_table[int(arr[sim, 2])],
            )

        # Best-8 thirds: ELO-ranked with a small random jitter (proxy for
        # the real points/GD ranking, unavailable before group resolution).
        third_assignment: Dict[int, str] = {}
        if group_pos:
            thirds = {letter: pos[2] for letter, pos in group_pos.items()}
            ranked = sorted(
                thirds.items(),
                key=lambda kv: -(elo_lookup.get(kv[1], 1500.0) + rng.normal(0.0, 25.0)),
            )
            qualified = dict(ranked[:8])
            third_slots: List[Tuple[int, List[str]]] = []
            for mi, m in enumerate(bracket.rounds.get(first_round, [])):
                for side, slot in ((0, m.home_slot), (1, m.away_slot)):
                    if slot and slot["type"] == "third_place":
                        third_slots.append((mi * 2 + side, slot["groups"]))
            third_assignment = _assign_thirds(third_slots, qualified)

        def _resolve(m: _KOMatch, mi: int, side: int, winners: Dict[str, List[Optional[str]]]) -> Optional[str]:
            name = m.home if side == 0 else m.away
            if name:
                return name
            slot = m.home_slot if side == 0 else m.away_slot
            if not slot:
                return None
            stype = slot["type"]
            if stype == "group_winner":
                pos = group_pos.get(slot["group"])
                return pos[0] if pos else None
            if stype == "group_runner_up":
                pos = group_pos.get(slot["group"])
                return pos[1] if pos else None
            if stype == "third_place":
                return third_assignment.get(mi * 2 + side)
            if stype == "chain":
                prev = winners.get(slot["round"]) or []
                idx = slot["index"] - 1
                if 0 <= idx < len(prev):
                    return prev[idx]
                return None
            return None

        winners_by_round: Dict[str, List[Optional[str]]] = {}
        for ri, round_key in enumerate(rounds_in_play):
            matches = bracket.rounds[round_key]
            round_winners: List[Optional[str]] = []
            prev_key = rounds_in_play[ri - 1] if ri > 0 else None
            prev_winners = [w for w in (winners_by_round.get(prev_key) or []) if w] if prev_key else []
            sequential_cursor = 0
            for mi, m in enumerate(matches):
                if m.winner:
                    round_winners.append(m.winner)
                    continue
                a = _resolve(m, mi, 0, winners_by_round)
                b = _resolve(m, mi, 1, winners_by_round)
                # Chain reference failed (label mismatch) — fall back to
                # pairing the previous round's winners sequentially.
                if (a is None or b is None) and prev_winners:
                    if a is None and sequential_cursor < len(prev_winners):
                        a = prev_winners[sequential_cursor]
                        sequential_cursor += 1
                    if b is None and sequential_cursor < len(prev_winners):
                        b = prev_winners[sequential_cursor]
                        sequential_cursor += 1
                if a and b:
                    round_winners.append(_simulate_match(a, b, pair_cum, width, rng))
                else:
                    round_winners.append(a or b)
            winners_by_round[round_key] = round_winners

            # Reach accounting.
            if round_key == first_round:
                entrants: List[Optional[str]] = []
                for mi, m in enumerate(matches):
                    entrants.append(m.home or _resolve(m, mi, 0, winners_by_round))
                    entrants.append(m.away or _resolve(m, mi, 1, winners_by_round))
                for t in entrants:
                    if t in name_to_idx:
                        reach_counts[entrant_reach_key][name_to_idx[t]] += 1
            win_key = WIN_REACH_KEY.get(round_key)
            if win_key:
                for w in round_winners:
                    if w in name_to_idx:
                        reach_counts[win_key][name_to_idx[w]] += 1
            # p_final normally accrues from SF winners (WIN_REACH_KEY["SF"]).
            # Only when ESPN has no SF fixtures do we count the final's own
            # entrants instead — counting both would double-count finalists.
            if round_key == "F" and not bracket.rounds.get("SF"):
                for mi, m in enumerate(matches[:1]):
                    for side in (0, 1):
                        t = (m.home if side == 0 else m.away) or _resolve(m, mi, side, winners_by_round)
                        if t in name_to_idx:
                            reach_counts["p_final"][name_to_idx[t]] += 1

    return _finalise(
        all_teams,
        reach_counts,
        n_simulations,
        bracket,
        bracket_set=bracket.is_set,
        team_group=team_group,
        first_round=first_round,
    )


def _round_matchups_payload(bracket: _Bracket) -> List[Dict]:
    payload = []
    for key in ROUND_SEQUENCE:
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
            payload.append({"round": key, "label": ROUND_LABELS.get(key, key), "matches": ties})
    return payload


def _finalise(
    all_teams: List[str],
    reach_counts: Dict[str, np.ndarray],
    n_simulations: int,
    bracket: _Bracket,
    bracket_set: bool,
    team_group: Optional[Dict[str, str]] = None,
    first_round: Optional[str] = None,
) -> Dict:
    # Rounds before the bracket's first round don't apply (e.g. p_r32 for a
    # legacy 32-team bracket) — report them as equal to the next stage so the
    # cumulative-reach invariant (earlier >= later) holds.
    applicable = ROUND_KEYS[ROUND_KEYS.index("p_r32" if first_round == "R32" else "p_r16"):]

    team_payload = []
    for i, t in enumerate(all_teams):
        probs = {k: float(reach_counts[k][i]) / float(n_simulations) for k in ROUND_KEYS}
        for k in ROUND_KEYS:
            if k not in applicable:
                probs[k] = probs[applicable[0]]
        # "Most likely round reached" from exclusive-round probabilities.
        exclusive: Dict[str, float] = {}
        for idx, key in enumerate(applicable):
            here = probs[key]
            nxt = probs[applicable[idx + 1]] if idx + 1 < len(applicable) else 0.0
            exclusive[key] = max(0.0, here - nxt)
        best_key = max(exclusive, key=lambda k: exclusive[k]) if exclusive else applicable[0]
        row = {
            "team_id": None,
            "name": t,
            "elo": round(national_elo_for(t)),
            "p_champion": round(probs["p_champion"], 4),
            "p_final": round(probs["p_final"], 4),
            "p_semi": round(probs["p_semi"], 4),
            "p_quarter": round(probs["p_quarter"], 4),
            "p_r16": round(probs["p_r16"], 4),
            "p_r32": round(probs["p_r32"], 4),
            "most_likely_round_reached": ROUND_LABEL_FOR_KEY[best_key],
        }
        if team_group and t in team_group:
            row["group"] = team_group[t]
        team_payload.append(row)

    team_payload.sort(key=lambda r: (-r["p_champion"], -r["p_final"], -r["p_semi"]))

    return {
        "tournament": "world_cup",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "n_simulations": n_simulations,
        "bracket_set": bracket_set,
        "teams": team_payload,
        "round_matchups": _round_matchups_payload(bracket),
    }


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
    return _simulate_current_state(bracket, n_simulations=n_simulations, seed=seed)


__all__ = ["simulate_bracket"]
