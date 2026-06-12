"""
National-team ELO ratings computed from the committed historical
tournament corpus (World Cups 1998-2022, Euros 2000-2024, Copa América
2001-2024 under backend/data/historical/).

Why this exists: the club ELO system (`elo.py`) is pre-seeded with club
sides only, so every national team silently defaulted to 1500 — making
tournament simulations strength-blind. This module derives real ratings
from real results that already live in the repo (ESPN-sourced, same team
name namespace as live data), keeping provenance clean.

Limitations (documented, not hidden):
  - Tournament matches only — no qualifiers or friendlies — so ratings
    are sparser than dedicated international ELO tables.
  - Teams with no tournament history since 1998 (e.g. 2026 debutants)
    stay at the 1500 baseline.
  - Ratings regress toward the mean across the gap between a team's
    appearances, so decades-old form decays.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

HISTORICAL_DIR = Path(__file__).parent.parent.parent / "data" / "historical"
TOURNAMENT_FILE_PREFIXES = ("world_cup_", "euro_", "copa_america_")

BASE_ELO = 1500.0
K_FACTOR = 40.0          # high K — tournament corpus is sparse
MEAN_REVERSION_PER_YEAR = 0.85  # elo gap to baseline retained per idle year

# ESPN renamed a few national sides over the corpus window; normalise to
# the current display name so history accrues to one entity.
NAME_ALIASES = {
    "Turkey": "Türkiye",
    "Czech Republic": "Czechia",
    "Macedonia": "North Macedonia",
    "Ivory Coast": "Côte d'Ivoire",
}


def _canonical(name: str) -> str:
    return NAME_ALIASES.get(name, name)


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", value)
        if m:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
    return None


def _load_matches() -> List[Tuple[datetime, str, str, int, int]]:
    matches: List[Tuple[datetime, str, str, int, int]] = []
    if not HISTORICAL_DIR.exists():
        logger.warning(f"Historical data dir missing: {HISTORICAL_DIR}")
        return matches
    for path in sorted(HISTORICAL_DIR.glob("*.json")):
        if not path.name.startswith(TOURNAMENT_FILE_PREFIXES):
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning(f"Skipping {path.name}: {exc}")
            continue
        for row in payload.get("matches") or []:
            date = _parse_date(row.get("date"))
            home, away = row.get("home_team"), row.get("away_team")
            hg, ag = row.get("home_score"), row.get("away_score")
            if date is None or not home or not away or hg is None or ag is None:
                continue
            matches.append((date, _canonical(home), _canonical(away), int(hg), int(ag)))
    matches.sort(key=lambda m: m[0])
    return matches


def _expected(elo_a: float, elo_b: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((elo_b - elo_a) / 400.0))


def _goal_diff_multiplier(diff: int) -> float:
    # Standard ELO goal-difference scaling (à la eloratings.net).
    diff = abs(diff)
    if diff <= 1:
        return 1.0
    if diff == 2:
        return 1.5
    return (11.0 + diff) / 8.0


def compute_national_elo() -> Dict[str, float]:
    """Run ELO over the chronological tournament corpus."""
    ratings: Dict[str, float] = {}
    last_seen: Dict[str, datetime] = {}

    def _get(team: str, now: datetime) -> float:
        elo = ratings.get(team, BASE_ELO)
        seen = last_seen.get(team)
        if seen is not None:
            idle_years = max(0.0, (now - seen).days / 365.25)
            elo = BASE_ELO + (elo - BASE_ELO) * (MEAN_REVERSION_PER_YEAR ** idle_years)
        return elo

    for date, home, away, hg, ag in _load_matches():
        home_elo = _get(home, date)
        away_elo = _get(away, date)
        # Tournament venues are predominantly neutral — no home advantage term.
        exp_home = _expected(home_elo, away_elo)
        actual = 1.0 if hg > ag else 0.0 if hg < ag else 0.5
        delta = K_FACTOR * _goal_diff_multiplier(hg - ag) * (actual - exp_home)
        ratings[home] = home_elo + delta
        ratings[away] = away_elo - delta
        last_seen[home] = date
        last_seen[away] = date

    return ratings


_cache: Optional[Dict[str, float]] = None


def get_national_elo() -> Dict[str, float]:
    """Cached national-team ELO table (name -> rating)."""
    global _cache
    if _cache is None:
        _cache = compute_national_elo()
        logger.info(f"Computed national ELO for {len(_cache)} teams from tournament corpus")
    return _cache


def national_elo_for(team: str, default: float = BASE_ELO) -> float:
    return get_national_elo().get(_canonical(team), default)


__all__ = ["get_national_elo", "national_elo_for", "compute_national_elo"]
