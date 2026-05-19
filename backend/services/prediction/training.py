"""
Scalable ML Training Pipeline for Match Prediction.

Enhanced feature engineering with 55+ features including:
- ELO ratings and difference (3)
- Rolling form: 5/10 match windows with recency weighting (12)
- Home/away venue-specific splits (4)
- Head-to-head records (3)
- Contextual: matchday, derby, league strength, rest days (6)
- Season stats: PPG, clean sheet%, GD per game (6)
- Momentum: streaks, unbeaten runs (4)
- Market-implied probabilities from betting odds (5)
- Tactical: shots ratio, discipline, corner dominance (8)
- League-specific characteristics (4)
Total: 55 features

Ensemble: XGBoost + LightGBM + GBT + Random Forest
with class-balanced sample weighting for draw under-prediction.
"""

import json
import pickle
import os
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from pathlib import Path
import logging

import numpy as np
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    accuracy_score,
    log_loss,
    brier_score_loss,
    classification_report,
)
from sklearn.ensemble import (
    GradientBoostingClassifier,
    VotingClassifier,
    RandomForestClassifier,
    StackingClassifier,
)
from sklearn.linear_model import LogisticRegression

logger = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).parent.parent.parent / "data" / "models"

try:
    from xgboost import XGBClassifier
    HAS_XGBOOST = True
except ImportError:
    HAS_XGBOOST = False

try:
    from lightgbm import LGBMClassifier
    HAS_LIGHTGBM = True
except ImportError:
    HAS_LIGHTGBM = False

try:
    from catboost import CatBoostClassifier
    HAS_CATBOOST = True
except ImportError:
    HAS_CATBOOST = False


# Total feature count for the enhanced model
N_FEATURES = 72

# Leagues played at neutral venues throughout (national-team tournaments).
NEUTRAL_VENUE_LEAGUES = {"world_cup", "euro", "copa_america"}

# Leagues whose knockout stages are two-legged ties (excluding the final).
TWO_LEG_KNOCKOUT_LEAGUES = {"champions_league", "europa_league"}

# Phase / round string → ordinal tournament_phase mapping.
# 0=league, 1=group_stage, 2=R16, 3=QF, 4=SF, 5=F.
TOURNAMENT_PHASE_MAP = {
    "group-stage": 1, "group_stage": 1, "group": 1, "groups": 1,
    "round-of-16": 2, "round_of_16": 2, "r16": 2, "last-16": 2, "last_16": 2,
    "quarterfinals": 3, "quarter-finals": 3, "quarterfinal": 3, "qf": 3,
    "semifinals": 4, "semi-finals": 4, "semifinal": 4, "sf": 4,
    "final": 5, "f": 5,
}

# Module-level league characteristics (also available as FeatureBuilder class attrs)
LEAGUE_DRAW_RATES = {
    "premier_league": 0.25, "la_liga": 0.24, "bundesliga": 0.23,
    "serie_a": 0.27, "ligue_1": 0.24, "eredivisie": 0.22,
    "primeira_liga": 0.25, "mls": 0.20,
    "champions_league": 0.22, "europa_league": 0.23,
    "world_cup": 0.18, "euro": 0.22, "copa_america": 0.20,
}
LEAGUE_AVG_TOTAL_GOALS = {
    "premier_league": 2.77, "la_liga": 2.56, "bundesliga": 3.02,
    "serie_a": 2.58, "ligue_1": 2.55, "eredivisie": 2.95,
    "primeira_liga": 2.50, "mls": 2.85,
    "champions_league": 2.95, "europa_league": 2.78,
    "world_cup": 2.60, "euro": 2.56, "copa_america": 2.52,
}
LEAGUE_HOME_WIN_RATE = {
    "premier_league": 0.44, "la_liga": 0.47, "bundesliga": 0.44,
    "serie_a": 0.44, "ligue_1": 0.44, "eredivisie": 0.46,
    "primeira_liga": 0.48, "mls": 0.47,
    "champions_league": 0.45, "europa_league": 0.44,
    "world_cup": 0.42, "euro": 0.42, "copa_america": 0.43,
}
LEAGUE_COMPETITIVENESS = {
    "premier_league": 0.72, "la_liga": 0.65, "bundesliga": 0.60,
    "serie_a": 0.68, "ligue_1": 0.55, "eredivisie": 0.62,
    "primeira_liga": 0.60, "mls": 0.82,
    "champions_league": 0.70, "europa_league": 0.70,
    "world_cup": 0.76, "euro": 0.74, "copa_america": 0.73,
}


class FeatureBuilder:
    """
    Builds 66-dimensional feature vectors from historical match data.

    Research-enhanced features (Szita 2024, Riad 2024):
    [0-2]   ELO features (3): home_elo, away_elo, elo_diff
    [3-14]  Form features (12): 5/10 match rolling + weighted + goals
    [15-18] Home/away splits (4): venue win%, venue goals avg
    [19-21] H2H features (3): advantage, avg total goals, match count
    [22-27] Context features (6): matchday%, derby, league coef, rest days
    [28-33] Season stats (6): PPG, clean sheet%, GD per game
    [34-37] Momentum (4): streak, unbeaten run
    [38-42] Market-implied probabilities (5): from betting odds
    [43-50] Tactical stats (8): shots ratio, discipline, corners
    [51-54] League characteristics (4): league draw rate, goals/game, etc.
    [55-56] Poisson xG (2): expected goals from scoring/conceding rates
    [57-61] Key interactions (5): elo*form, elo*h2h, implied*form, etc.
    [62-63] Goal consistency (2): scoring variance (lower = more predictable)
    [64-65] Strength of schedule (2): avg opponent ELO in recent matches
    [66-71] Tournament-state (6): knockout-leg flags, aggregate diff, neutral
            venue, phase ordinal, group-stage pressure. Fallback policy: when
            the `phase`/`round`/`stage` metadata is absent (older historical
            records), all six default to league-play values (0). See
            `_get_tournament_state` for details.
    """

    LEAGUE_COEFFICIENTS = {
        "premier_league": 1.15, "la_liga": 1.10, "bundesliga": 1.05,
        "serie_a": 1.05, "ligue_1": 1.00, "eredivisie": 0.90,
        "primeira_liga": 0.90, "mls": 0.80,
        "champions_league": 1.20, "europa_league": 1.05,
        "world_cup": 1.15, "euro": 1.12, "copa_america": 1.08,
    }

    # League-specific characteristics (empirical averages)
    LEAGUE_DRAW_RATES = {
        "premier_league": 0.25, "la_liga": 0.24, "bundesliga": 0.23,
        "serie_a": 0.27, "ligue_1": 0.24, "eredivisie": 0.22,
        "primeira_liga": 0.25, "mls": 0.20,
        "champions_league": 0.22, "europa_league": 0.23,
        "world_cup": 0.18, "euro": 0.22, "copa_america": 0.20,
    }

    LEAGUE_AVG_TOTAL_GOALS = {
        "premier_league": 2.77, "la_liga": 2.56, "bundesliga": 3.02,
        "serie_a": 2.58, "ligue_1": 2.55, "eredivisie": 2.95,
        "primeira_liga": 2.50, "mls": 2.85,
        "champions_league": 2.95, "europa_league": 2.78,
        "world_cup": 2.60, "euro": 2.56, "copa_america": 2.52,
    }

    LEAGUE_HOME_WIN_RATE = {
        "premier_league": 0.44, "la_liga": 0.47, "bundesliga": 0.44,
        "serie_a": 0.44, "ligue_1": 0.44, "eredivisie": 0.46,
        "primeira_liga": 0.48, "mls": 0.47,
        "champions_league": 0.45, "europa_league": 0.44,
        "world_cup": 0.42, "euro": 0.42, "copa_america": 0.43,
    }

    LEAGUE_COMPETITIVENESS = {
        # Gini coefficient of points — higher = less competitive (dominated)
        "premier_league": 0.72, "la_liga": 0.65, "bundesliga": 0.60,
        "serie_a": 0.68, "ligue_1": 0.55, "eredivisie": 0.62,
        "primeira_liga": 0.60, "mls": 0.82,
        "champions_league": 0.70, "europa_league": 0.70,
        "world_cup": 0.76, "euro": 0.74, "copa_america": 0.73,
    }

    DERBY_PAIRS = {
        "Manchester United": ["Manchester City", "Liverpool"],
        "Manchester City": ["Manchester United"],
        "Liverpool": ["Manchester United", "Everton"],
        "Everton": ["Liverpool"],
        "Arsenal": ["Tottenham Hotspur", "Tottenham", "Chelsea"],
        "Tottenham Hotspur": ["Arsenal", "Chelsea", "West Ham United"],
        "Tottenham": ["Arsenal", "Chelsea", "West Ham"],
        "Chelsea": ["Arsenal", "Tottenham Hotspur", "Tottenham"],
        "Real Madrid": ["Barcelona", "Atletico Madrid", "Atlético Madrid", "Atl. Madrid"],
        "Barcelona": ["Real Madrid", "Espanyol"],
        "Atletico Madrid": ["Real Madrid"], "Atlético Madrid": ["Real Madrid"],
        "AC Milan": ["Inter Milan", "Inter", "Juventus"],
        "Inter Milan": ["AC Milan", "Juventus"], "Inter": ["AC Milan", "Juventus"],
        "Juventus": ["Inter Milan", "Inter", "AC Milan", "Torino"],
        "Bayern Munich": ["Borussia Dortmund"],
        "Borussia Dortmund": ["Bayern Munich", "Schalke 04", "Schalke"],
        "Paris Saint-Germain": ["Marseille"], "PSG": ["Marseille"],
        "Marseille": ["Paris Saint-Germain", "PSG"],
        "Roma": ["Lazio"], "Lazio": ["Roma"],
        "Feyenoord": ["Ajax"], "Ajax": ["Feyenoord", "PSV"],
        "PSV": ["Ajax"], "Benfica": ["Sporting CP", "Porto"],
        "Porto": ["Benfica", "Sporting CP"], "Sporting CP": ["Benfica", "Porto"],
        "LA Galaxy": ["LAFC"], "LAFC": ["LA Galaxy"],
    }

    FEATURE_NAMES = [
        # ELO (3)
        "home_elo", "away_elo", "elo_diff",
        # Form (12)
        "home_form_5", "away_form_5",
        "home_form_10", "away_form_10",
        "home_weighted_form", "away_weighted_form",
        "home_goals_scored_avg5", "away_goals_scored_avg5",
        "home_goals_conceded_avg5", "away_goals_conceded_avg5",
        "home_goals_scored_avg10", "away_goals_scored_avg10",
        # Home/away splits (4)
        "home_home_win_pct", "away_away_win_pct",
        "home_home_goals_avg", "away_away_goals_avg",
        # H2H (3)
        "h2h_home_advantage", "h2h_avg_total_goals", "h2h_matches",
        # Context (6)
        "matchday_pct", "is_derby", "league_coefficient",
        "home_days_rest", "away_days_rest", "rest_diff",
        # Season stats (6)
        "home_ppg", "away_ppg",
        "home_clean_sheet_pct", "away_clean_sheet_pct",
        "home_gd_per_game", "away_gd_per_game",
        # Momentum (4)
        "home_streak", "away_streak",
        "home_unbeaten_run", "away_unbeaten_run",
        # Market-implied probabilities (5)
        "implied_home_prob", "implied_draw_prob", "implied_away_prob",
        "implied_over_2_5", "market_overround",
        # Tactical stats rolling (8)
        "home_shots_ratio", "away_shots_ratio",
        "home_sot_ratio", "away_sot_ratio",
        "home_discipline_score", "away_discipline_score",
        "home_corner_dominance", "away_corner_dominance",
        # League characteristics (4)
        "league_draw_rate", "league_avg_goals",
        "league_home_win_rate", "league_competitiveness",
        # Poisson xG (2) — Szita 2024: Poisson regression xG as input feature
        "poisson_xg_home", "poisson_xg_away",
        # Key interactions (5) — captures nonlinear feature relationships
        "elo_x_form_diff", "elo_x_h2h", "implied_home_x_form",
        "rest_x_form_home", "rest_x_form_away",
        # Goal consistency (2) — lower variance = more predictable
        "home_goals_consistency", "away_goals_consistency",
        # Strength of schedule (2) — avg opponent ELO in recent matches
        "home_sos", "away_sos",
        # Tournament-state (6) — knockout/group context, neutral venue
        "is_knockout_leg", "leg_index", "aggregate_diff_pre_match",
        "is_neutral_venue", "tournament_phase", "group_stage_pressure",
    ]

    def __init__(self):
        self.elo_ratings: Dict[str, float] = {}
        self.team_history: Dict[str, List[Dict]] = {}
        self.h2h_cache: Dict[str, List[Dict]] = {}
        # Track rolling tactical stats per team
        self.team_tactical: Dict[str, List[Dict]] = {}
        # Two-leg knockout-tie state: pair_key → first-leg meta (score, date,
        # which side was home in leg 1). Used to compute leg_index and
        # aggregate_diff_pre_match for the return leg.
        self.leg_cache: Dict[str, Dict[str, Any]] = {}

    def _get_elo(self, team: str) -> float:
        return self.elo_ratings.get(team, 1500.0)

    def _update_elo(self, home: str, away: str, home_goals: int, away_goals: int, league: str):
        K = 32.0
        home_elo = self._get_elo(home)
        away_elo = self._get_elo(away)
        home_elo_adj = home_elo + 40.0  # Reduced home advantage for ELO

        exp_home = 1.0 / (1.0 + 10 ** ((away_elo - home_elo_adj) / 400))
        exp_away = 1.0 - exp_home

        if home_goals > away_goals:
            actual_home, actual_away = 1.0, 0.0
        elif away_goals > home_goals:
            actual_home, actual_away = 0.0, 1.0
        else:
            actual_home, actual_away = 0.5, 0.5

        gd = abs(home_goals - away_goals)
        gd_mult = 1.0 if gd <= 1 else (1.5 if gd == 2 else 1.75 + (gd - 3) * 0.125)
        league_coef = self.LEAGUE_COEFFICIENTS.get(league, 0.85)

        k = K * gd_mult * league_coef
        self.elo_ratings[home] = home_elo + k * (actual_home - exp_home)
        self.elo_ratings[away] = away_elo + k * (actual_away - exp_away)

    def _get_form(self, team: str, n: int = 5) -> float:
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.5
        points = sum(
            3 if m["result_for_team"] == "W" else (1 if m["result_for_team"] == "D" else 0)
            for m in history
        )
        return points / (n * 3) if n > 0 else 0.5

    def _get_weighted_form(self, team: str, n: int = 5) -> float:
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.5
        weights = [0.4, 0.55, 0.7, 0.85, 1.0][-len(history):]
        total_w = sum(weights)
        weighted = 0.0
        for m, w in zip(history, weights):
            pts = 3 if m["result_for_team"] == "W" else (1 if m["result_for_team"] == "D" else 0)
            weighted += pts * w
        return weighted / (total_w * 3) if total_w > 0 else 0.5

    def _get_goals_avg(self, team: str, n: int = 5, scored: bool = True) -> float:
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 1.3
        key = "goals_scored" if scored else "goals_conceded"
        return sum(m[key] for m in history) / len(history)

    def _get_home_away_stats(self, team: str, is_home: bool, n: int = 10) -> Tuple[float, float]:
        history = self.team_history.get(team, [])
        venue_matches = [m for m in history[-30:] if m.get("is_home") == is_home][-n:]
        if not venue_matches:
            return 0.4 if is_home else 0.3, 1.3
        wins = sum(1 for m in venue_matches if m["result_for_team"] == "W")
        goals = sum(m["goals_scored"] for m in venue_matches)
        return wins / len(venue_matches), goals / len(venue_matches)

    def _get_h2h(self, team1: str, team2: str) -> Tuple[float, float, int]:
        key = f"{min(team1, team2)}_vs_{max(team1, team2)}"
        matches = self.h2h_cache.get(key, [])[-10:]
        if not matches:
            return 0.0, 2.5, 0
        t1_wins = sum(1 for m in matches if m.get("winner") == team1)
        t2_wins = sum(1 for m in matches if m.get("winner") == team2)
        total_goals = sum(m.get("total_goals", 0) for m in matches)
        advantage = (t1_wins - t2_wins) / len(matches)
        avg_goals = total_goals / len(matches) if matches else 2.5
        return advantage, avg_goals, len(matches)

    def _get_streak(self, team: str) -> Tuple[int, int]:
        history = self.team_history.get(team, [])
        if not history:
            return 0, 0
        streak = 0
        first_result = history[-1]["result_for_team"]
        for m in reversed(history):
            if m["result_for_team"] == first_result:
                streak += 1
            else:
                break
        if first_result == "L":
            streak = -streak

        unbeaten = 0
        for m in reversed(history):
            if m["result_for_team"] != "L":
                unbeaten += 1
            else:
                break
        return streak, unbeaten

    def _get_ppg(self, team: str, n: int = 10) -> float:
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 1.3
        pts = sum(
            3 if m["result_for_team"] == "W" else (1 if m["result_for_team"] == "D" else 0)
            for m in history
        )
        return pts / len(history)

    def _get_clean_sheet_pct(self, team: str, n: int = 10) -> float:
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.3
        cs = sum(1 for m in history if m["goals_conceded"] == 0)
        return cs / len(history)

    def _get_gd_per_game(self, team: str, n: int = 10) -> float:
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 0.0
        gd = sum(m["goals_scored"] - m["goals_conceded"] for m in history)
        return gd / len(history)

    def _get_rest_days(self, team: str, match_date: str) -> int:
        history = self.team_history.get(team, [])
        if not history:
            return 7
        try:
            current = datetime.fromisoformat(match_date.replace("Z", "+00:00"))
            last = datetime.fromisoformat(history[-1]["date"].replace("Z", "+00:00"))
            return max(1, (current - last).days)
        except Exception:
            return 7

    # ── NEW: Tactical stats ──

    def _get_shots_ratio(self, team: str, n: int = 10) -> float:
        """Shots on target ratio over last n matches (team / total)."""
        tactical = self.team_tactical.get(team, [])[-n:]
        if not tactical:
            return 0.5
        total_for = sum(t.get("shots", 0) for t in tactical)
        total_against = sum(t.get("shots_against", 0) for t in tactical)
        total = total_for + total_against
        return total_for / total if total > 0 else 0.5

    def _get_sot_ratio(self, team: str, n: int = 10) -> float:
        """Shots on target ratio."""
        tactical = self.team_tactical.get(team, [])[-n:]
        if not tactical:
            return 0.5
        total_for = sum(t.get("sot", 0) for t in tactical)
        total_against = sum(t.get("sot_against", 0) for t in tactical)
        total = total_for + total_against
        return total_for / total if total > 0 else 0.5

    def _get_discipline_score(self, team: str, n: int = 10) -> float:
        """Discipline score: lower = more disciplined. Yellows + 3*Reds per game."""
        tactical = self.team_tactical.get(team, [])[-n:]
        if not tactical:
            return 1.5
        total = sum(t.get("yellows", 0) + 3 * t.get("reds", 0) for t in tactical)
        return total / len(tactical)

    def _get_corner_dominance(self, team: str, n: int = 10) -> float:
        """Corner dominance ratio."""
        tactical = self.team_tactical.get(team, [])[-n:]
        if not tactical:
            return 0.5
        total_for = sum(t.get("corners", 0) for t in tactical)
        total_against = sum(t.get("corners_against", 0) for t in tactical)
        total = total_for + total_against
        return total_for / total if total > 0 else 0.5

    def _get_poisson_xg(self, team: str, is_home: bool, league: str, n: int = 10) -> float:
        """Compute Poisson-based expected goals (Szita 2024).

        Uses team's scoring rate and opponent-adjusted league average
        to generate an expected goals figure.
        """
        history = self.team_history.get(team, [])[-n:]
        if len(history) < 3:
            return 1.3 if is_home else 1.0
        # Team's scoring rate
        scored = sum(m["goals_scored"] for m in history) / len(history)
        # League average goals per game (per team)
        league_avg = self.LEAGUE_AVG_TOTAL_GOALS.get(league, 2.7) / 2.0
        # Home advantage factor
        home_factor = 1.15 if is_home else 0.87
        # Poisson lambda = team_rate * home_factor, bounded to [0.3, 4.0]
        xg = scored * home_factor * (league_avg / max(league_avg, 0.5))
        return max(0.3, min(4.0, xg))

    def _get_goals_consistency(self, team: str, n: int = 10) -> float:
        """Goal scoring consistency: 1/(1+std). Higher = more consistent."""
        history = self.team_history.get(team, [])[-n:]
        if len(history) < 3:
            return 0.5
        goals = [m["goals_scored"] for m in history]
        std = float(np.std(goals))
        return 1.0 / (1.0 + std)

    def _get_strength_of_schedule(self, team: str, n: int = 10) -> float:
        """Average ELO of recent opponents (strength of schedule)."""
        history = self.team_history.get(team, [])[-n:]
        if not history:
            return 1500.0
        opp_elos = [self._get_elo(m["opponent"]) for m in history]
        return sum(opp_elos) / len(opp_elos)

    # ── Tournament-state helpers ──

    @staticmethod
    def _parse_phase(match: Dict) -> int:
        """Map free-form `phase`/`round`/`stage` strings to ordinal 0..5.

        Defaults to 0 (league play) when the field is missing — this is the
        documented fallback for older historical records that lack phase info.
        """
        raw = match.get("phase") or match.get("round") or match.get("stage")
        if not raw:
            return 0
        key = str(raw).strip().lower().replace(" ", "-")
        return TOURNAMENT_PHASE_MAP.get(key, 0)

    @staticmethod
    def _pair_key(team_a: str, team_b: str, season: Any) -> str:
        a, b = sorted([team_a or "", team_b or ""])
        return f"{a}__vs__{b}__{season}"

    def _get_tournament_state(self, match: Dict) -> Tuple[float, float, float, float, float, float]:
        """Compute the 6 tournament-state features for a match.

        Returns (is_knockout_leg, leg_index, aggregate_diff_pre_match,
                 is_neutral_venue, tournament_phase, group_stage_pressure).
        All default safely to league-play values (0) when metadata is missing.
        """
        league = match.get("league", "") or ""
        phase_ord = self._parse_phase(match)

        is_neutral = 1.0 if league in NEUTRAL_VENUE_LEAGUES else 0.0

        # Two-leg knockout detection: UCL/UEL knockout rounds before the
        # one-off final (phase ord 2..4). Final (5) is single-leg.
        is_two_leg = (
            league in TWO_LEG_KNOCKOUT_LEAGUES and phase_ord in (2, 3, 4)
        )
        is_knockout_leg = 1.0 if is_two_leg else 0.0

        leg_index = 1.0
        agg_diff = 0.0
        if is_two_leg:
            home = match.get("home_team", "")
            away = match.get("away_team", "")
            key = self._pair_key(home, away, match.get("season"))
            prior = self.leg_cache.get(key)
            if prior is not None:
                leg_index = 2.0
                # Aggregate from home (current match) perspective: prior leg
                # the current home team was the away side.
                prior_home = prior.get("home_team")
                prior_hs = prior.get("home_score", 0) or 0
                prior_as = prior.get("away_score", 0) or 0
                if prior_home == home:
                    # Same orientation (rare in 2-leg ties, treat as best-effort)
                    agg_diff = float(prior_hs - prior_as)
                else:
                    # Current home team was away in leg 1 → invert.
                    agg_diff = float(prior_as - prior_hs)

        # Group-stage pressure: best-effort heuristic. Without standings, we
        # fall back to 0 and only apply a mild matchday-based proxy when
        # matchday is known. Keep simple — fail safely to 0.
        gs_pressure = 0.0
        if phase_ord == 1:
            md = match.get("matchday")
            if isinstance(md, (int, float)) and md > 0:
                # Group stages are typically 3–6 matchdays. Pressure rises as
                # matchday increases (later matches = more decisive). Mapped
                # to [-1, 1] with a centred origin at MD3.
                gs_pressure = max(-1.0, min(1.0, (float(md) - 3.0) / 3.0))

        return (
            is_knockout_leg,
            leg_index,
            agg_diff,
            is_neutral,
            float(phase_ord),
            gs_pressure,
        )

    @staticmethod
    def _odds_to_implied_probs(odds_h: Optional[float], odds_d: Optional[float],
                                odds_a: Optional[float]) -> Tuple[float, float, float, float]:
        """
        Convert betting odds to implied probabilities with overround removed.
        Returns (home_prob, draw_prob, away_prob, overround).
        """
        if not odds_h or not odds_d or not odds_a:
            return 0.0, 0.0, 0.0, 0.0  # No odds available
        if odds_h <= 1.0 or odds_d <= 1.0 or odds_a <= 1.0:
            return 0.0, 0.0, 0.0, 0.0

        raw_h = 1.0 / odds_h
        raw_d = 1.0 / odds_d
        raw_a = 1.0 / odds_a
        overround = raw_h + raw_d + raw_a  # Typically 1.03-1.10

        # Remove overround (normalize)
        if overround > 0:
            return raw_h / overround, raw_d / overround, raw_a / overround, overround
        return 0.0, 0.0, 0.0, 0.0

    def build_features_for_match(self, match: Dict) -> Optional[np.ndarray]:
        """Build N_FEATURES-dimensional feature vector for a single match."""
        home = match["home_team"]
        away = match["away_team"]
        league = match.get("league", "")
        date = match.get("date", "")
        matchday = match.get("matchday") or 0
        total_matchdays = 38 if league not in ("champions_league", "europa_league", "mls") else 34

        home_hist = self.team_history.get(home, [])
        away_hist = self.team_history.get(away, [])
        if len(home_hist) < 3 or len(away_hist) < 3:
            return None

        home_elo = self._get_elo(home)
        away_elo = self._get_elo(away)

        home_hw_pct, home_h_goals = self._get_home_away_stats(home, True)
        away_aw_pct, away_a_goals = self._get_home_away_stats(away, False)

        h2h_adv, h2h_goals, h2h_count = self._get_h2h(home, away)

        home_rest = self._get_rest_days(home, date)
        away_rest = self._get_rest_days(away, date)

        home_streak, home_unbeaten = self._get_streak(home)
        away_streak, away_unbeaten = self._get_streak(away)

        is_derby = 1.0 if away in self.DERBY_PAIRS.get(home, []) else 0.0
        league_coef = self.LEAGUE_COEFFICIENTS.get(league, 0.85)
        matchday_pct = matchday / total_matchdays if total_matchdays > 0 else 0.5

        # ── Market-implied probabilities (from betting odds) ──
        impl_h, impl_d, impl_a, overround = self._odds_to_implied_probs(
            match.get("odds_home"), match.get("odds_draw"), match.get("odds_away")
        )
        # Over/under 2.5 implied probability
        odds_o25 = match.get("odds_over_2_5")
        impl_o25 = (1.0 / odds_o25) if odds_o25 and odds_o25 > 1.0 else 0.5

        # ── League characteristics ──
        league_draw_rate = self.LEAGUE_DRAW_RATES.get(league, 0.24)
        league_avg_goals = self.LEAGUE_AVG_TOTAL_GOALS.get(league, 2.7)
        league_home_rate = self.LEAGUE_HOME_WIN_RATE.get(league, 0.45)
        league_comp = self.LEAGUE_COMPETITIVENESS.get(league, 0.70)

        features = np.array([
            # ELO (3) [0-2]
            home_elo, away_elo, home_elo - away_elo,
            # Form (12) [3-14]
            self._get_form(home, 5), self._get_form(away, 5),
            self._get_form(home, 10), self._get_form(away, 10),
            self._get_weighted_form(home), self._get_weighted_form(away),
            self._get_goals_avg(home, 5, True), self._get_goals_avg(away, 5, True),
            self._get_goals_avg(home, 5, False), self._get_goals_avg(away, 5, False),
            self._get_goals_avg(home, 10, True), self._get_goals_avg(away, 10, True),
            # Home/away splits (4) [15-18]
            home_hw_pct, away_aw_pct, home_h_goals, away_a_goals,
            # H2H (3) [19-21]
            h2h_adv, h2h_goals, min(h2h_count, 10),
            # Context (6) [22-27]
            matchday_pct, is_derby, league_coef,
            home_rest, away_rest, home_rest - away_rest,
            # Season stats (6) [28-33]
            self._get_ppg(home), self._get_ppg(away),
            self._get_clean_sheet_pct(home), self._get_clean_sheet_pct(away),
            self._get_gd_per_game(home), self._get_gd_per_game(away),
            # Momentum (4) [34-37]
            home_streak, away_streak, home_unbeaten, away_unbeaten,
            # Market-implied probabilities (5) [38-42]
            impl_h, impl_d, impl_a, impl_o25, overround,
            # Tactical stats (8) [43-50]
            self._get_shots_ratio(home), self._get_shots_ratio(away),
            self._get_sot_ratio(home), self._get_sot_ratio(away),
            self._get_discipline_score(home), self._get_discipline_score(away),
            self._get_corner_dominance(home), self._get_corner_dominance(away),
            # League characteristics (4) [51-54]
            league_draw_rate, league_avg_goals, league_home_rate, league_comp,
            # Poisson xG (2) [55-56]
            self._get_poisson_xg(home, True, league),
            self._get_poisson_xg(away, False, league),
            # Key interactions (5) [57-61]
            (home_elo - away_elo) * (self._get_weighted_form(home) - self._get_weighted_form(away)),  # elo × form_diff
            (home_elo - away_elo) * h2h_adv,  # elo × h2h advantage
            impl_h * self._get_weighted_form(home) if impl_h > 0 else 0.0,  # market × form
            (home_rest / 7.0) * self._get_weighted_form(home),  # rest × form home
            (away_rest / 7.0) * self._get_weighted_form(away),  # rest × form away
            # Goal consistency (2) [62-63]
            self._get_goals_consistency(home),
            self._get_goals_consistency(away),
            # Strength of schedule (2) [64-65]
            self._get_strength_of_schedule(home),
            self._get_strength_of_schedule(away),
            # Tournament-state (6) [66-71]
            *self._get_tournament_state(match),
        ], dtype=np.float64)

        return features

    def update_state(self, match: Dict):
        """Update internal state after processing a match (chronological order)."""
        home = match["home_team"]
        away = match["away_team"]
        home_score = match.get("home_score")
        away_score = match.get("away_score")
        if home_score is None or away_score is None:
            return
        home_score = int(home_score)
        away_score = int(away_score)
        league = match.get("league", "")
        date = match.get("date", "")

        if home_score > away_score:
            home_res, away_res, winner = "W", "L", home
        elif away_score > home_score:
            home_res, away_res, winner = "L", "W", away
        else:
            home_res, away_res, winner = "D", "D", None

        for team, is_home, res, gs, gc in [
            (home, True, home_res, home_score, away_score),
            (away, False, away_res, away_score, home_score),
        ]:
            if team not in self.team_history:
                self.team_history[team] = []
            self.team_history[team].append({
                "date": date, "is_home": is_home,
                "result_for_team": res, "goals_scored": gs, "goals_conceded": gc,
                "opponent": away if team == home else home,
            })

        # Update H2H
        key = f"{min(home, away)}_vs_{max(home, away)}"
        if key not in self.h2h_cache:
            self.h2h_cache[key] = []
        self.h2h_cache[key].append({
            "date": date, "winner": winner,
            "total_goals": home_score + away_score,
        })

        # Update tactical stats (from football-data.co.uk data)
        hs = match.get("home_shots")
        as_ = match.get("away_shots")
        hst = match.get("home_shots_on_target")
        ast = match.get("away_shots_on_target")
        hc = match.get("home_corners")
        ac = match.get("away_corners")
        hy = match.get("home_yellows")
        ay = match.get("away_yellows")
        hr = match.get("home_reds")
        ar = match.get("away_reds")

        for team, is_h in [(home, True), (away, False)]:
            if team not in self.team_tactical:
                self.team_tactical[team] = []
            self.team_tactical[team].append({
                "shots": (hs if is_h else as_) or 0,
                "shots_against": (as_ if is_h else hs) or 0,
                "sot": (hst if is_h else ast) or 0,
                "sot_against": (ast if is_h else hst) or 0,
                "corners": (hc if is_h else ac) or 0,
                "corners_against": (ac if is_h else hc) or 0,
                "yellows": (hy if is_h else ay) or 0,
                "reds": (hr if is_h else ar) or 0,
            })

        # Update ELO
        self._update_elo(home, away, home_score, away_score, league)

        # Cache first-leg result so the return leg can compute aggregate_diff.
        phase_ord = self._parse_phase(match)
        if league in TWO_LEG_KNOCKOUT_LEAGUES and phase_ord in (2, 3, 4):
            key = self._pair_key(home, away, match.get("season"))
            if key not in self.leg_cache:
                self.leg_cache[key] = {
                    "home_team": home,
                    "away_team": away,
                    "home_score": home_score,
                    "away_score": away_score,
                    "date": date,
                }


class ModelTrainer:
    """
    Trains ensemble classification + goal regression models.
    Uses class-balanced weighting to fix draw under-prediction.
    """

    def __init__(self, model_dir: Optional[Path] = None, use_stacking: bool = True):
        self.model_dir = model_dir or MODEL_DIR
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.scaler = StandardScaler()
        self.model = None
        self.calibrator = None
        self.feature_names = FeatureBuilder.FEATURE_NAMES
        self.training_metadata: Dict[str, Any] = {}
        self.objective_weights = {"log_loss": 0.65, "brier": 0.35}
        # When True (default), the base learners feed a LogisticRegression
        # meta-learner trained with recency-weighted sample weights. When
        # False, fall back to the legacy soft-voting ensemble for backward
        # compatibility.
        self.use_stacking = use_stacking
        # Per-league post-hoc calibration buckets (populated on demand).
        self.calibration_buckets: Optional[Dict[str, Any]] = None

    def prepare_training_data(
        self, matches: List[Dict], return_meta: bool = False
    ):
        """Process raw matches into feature matrix and labels.

        When `return_meta=True`, also returns parallel lists of (date, league)
        for each retained row — used downstream for recency weighting and
        per-league bucketed calibration. Default behavior is unchanged.
        """
        builder = FeatureBuilder()
        sorted_matches = sorted(matches, key=lambda m: m.get("date", ""))

        X_list = []
        y_list = []
        dates: List[str] = []
        leagues: List[str] = []

        for match in sorted_matches:
            if match.get("home_score") is None or match.get("away_score") is None:
                builder.update_state(match)
                continue

            features = builder.build_features_for_match(match)
            builder.update_state(match)

            if features is None:
                continue

            hs, as_ = int(match["home_score"]), int(match["away_score"])
            if hs > as_:
                label = 0
            elif hs == as_:
                label = 1
            else:
                label = 2

            X_list.append(features)
            y_list.append(label)
            dates.append(match.get("date", ""))
            leagues.append(match.get("league", ""))

        X = np.array(X_list, dtype=np.float64)
        y = np.array(y_list, dtype=np.int32)
        X = np.nan_to_num(X, nan=0.0, posinf=5.0, neginf=-5.0)

        logger.info(
            f"Prepared {len(X)} training samples. "
            f"Distribution: H={sum(y==0)}, D={sum(y==1)}, A={sum(y==2)}"
        )
        if return_meta:
            return X, y, dates, leagues
        return X, y

    @staticmethod
    def compute_class_weights(y: np.ndarray) -> Dict[int, float]:
        """
        Compute inverse-frequency class weights to fix draw under-prediction.
        Draws are underrepresented in argmax predictions, so we upweight them.
        """
        from collections import Counter
        counts = Counter(y)
        n = len(y)
        n_classes = 3
        weights = {}
        for cls in range(n_classes):
            c = counts.get(cls, 1)
            weights[cls] = n / (n_classes * c)
        # Extra draw boost (class 1) — draws are hardest to predict
        weights[1] = weights[1] * 1.15
        return weights

    @staticmethod
    def _normalize_probabilities(probabilities: np.ndarray) -> np.ndarray:
        probs = np.asarray(probabilities, dtype=np.float64)
        probs = np.clip(probs, 1e-12, 1.0)
        row_sums = probs.sum(axis=1, keepdims=True)
        row_sums[row_sums <= 0] = 1.0
        return probs / row_sums

    @classmethod
    def _multiclass_brier(cls, y_true: np.ndarray, y_proba: np.ndarray) -> float:
        proba = cls._normalize_probabilities(y_proba)
        one_hot = np.zeros_like(proba)
        one_hot[np.arange(len(y_true)), y_true.astype(int)] = 1.0
        # Standard multiclass Brier score: mean squared error over classes.
        return float(np.mean(np.sum((proba - one_hot) ** 2, axis=1)))

    def _objective_from_metrics(self, logloss_value: float, brier_value: float) -> float:
        return float(
            (self.objective_weights["log_loss"] * logloss_value)
            + (self.objective_weights["brier"] * brier_value)
        )

    def _walk_forward_metrics(self, X: np.ndarray, y: np.ndarray, class_weights: Dict[int, float]) -> Dict[str, Any]:
        if len(X) < 180:
            return {
                "n_folds": 0,
                "accuracy_mean": None,
                "log_loss_mean": None,
                "brier_mean": None,
                "objective_mean": None,
                "folds": [],
            }

        n_splits = min(5, max(2, len(X) // 180))
        splitter = TimeSeriesSplit(n_splits=n_splits)
        folds: List[Dict[str, Any]] = []

        for fold_idx, (train_idx, val_idx) in enumerate(splitter.split(X), start=1):
            y_train_fold = y[train_idx]
            y_val_fold = y[val_idx]

            if len(np.unique(y_train_fold)) < 3 or len(np.unique(y_val_fold)) < 2:
                continue

            scaler_fold = StandardScaler()
            X_train_fold = scaler_fold.fit_transform(X[train_idx])
            X_val_fold = scaler_fold.transform(X[val_idx])

            fold_model = self._build_ensemble(class_weights)
            fold_weights = np.array([class_weights[int(label)] for label in y_train_fold], dtype=np.float64)

            try:
                fold_model.fit(X_train_fold, y_train_fold, sample_weight=fold_weights)
            except TypeError:
                fold_model.fit(X_train_fold, y_train_fold)

            fold_proba = self._normalize_probabilities(fold_model.predict_proba(X_val_fold))
            fold_pred = np.argmax(fold_proba, axis=1)

            fold_accuracy = float(accuracy_score(y_val_fold, fold_pred))
            fold_logloss = float(log_loss(y_val_fold, fold_proba, labels=[0, 1, 2]))
            fold_brier = self._multiclass_brier(y_val_fold, fold_proba)
            fold_objective = self._objective_from_metrics(fold_logloss, fold_brier)

            folds.append({
                "fold": fold_idx,
                "train_samples": int(len(train_idx)),
                "validation_samples": int(len(val_idx)),
                "accuracy": round(fold_accuracy, 4),
                "log_loss": round(fold_logloss, 4),
                "brier_score": round(fold_brier, 4),
                "objective": round(fold_objective, 4),
            })

        if not folds:
            return {
                "n_folds": 0,
                "accuracy_mean": None,
                "log_loss_mean": None,
                "brier_mean": None,
                "objective_mean": None,
                "folds": [],
            }

        accuracy_values = [f["accuracy"] for f in folds]
        logloss_values = [f["log_loss"] for f in folds]
        brier_values = [f["brier_score"] for f in folds]
        objective_values = [f["objective"] for f in folds]

        return {
            "n_folds": len(folds),
            "accuracy_mean": float(np.mean(accuracy_values)),
            "log_loss_mean": float(np.mean(logloss_values)),
            "brier_mean": float(np.mean(brier_values)),
            "objective_mean": float(np.mean(objective_values)),
            "folds": folds,
        }

    def _build_ensemble(self, class_weights: Optional[Dict] = None) -> Any:
        estimators = []

        cw = class_weights or {0: 1.0, 1: 1.2, 2: 1.0}

        # Convert class_weight dict to sklearn format
        sklearn_cw = cw

        gb = GradientBoostingClassifier(
            n_estimators=400, max_depth=5, learning_rate=0.04,
            subsample=0.8, min_samples_leaf=15, random_state=42,
        )
        estimators.append(("gb", gb))

        rf = RandomForestClassifier(
            n_estimators=300, max_depth=10, min_samples_leaf=10,
            class_weight=sklearn_cw, random_state=42, n_jobs=-1,
        )
        estimators.append(("rf", rf))

        if HAS_XGBOOST:
            # XGBoost doesn't take class_weight dict — use sample_weight in fit
            xgb = XGBClassifier(
                n_estimators=400, max_depth=5, learning_rate=0.04,
                subsample=0.8, colsample_bytree=0.8, min_child_weight=8,
                eval_metric="mlogloss", random_state=42,
                use_label_encoder=False, verbosity=0,
            )
            estimators.append(("xgb", xgb))

        if HAS_LIGHTGBM:
            lgb = LGBMClassifier(
                n_estimators=400, max_depth=5, learning_rate=0.04,
                subsample=0.8, colsample_bytree=0.8, min_child_samples=12,
                class_weight=sklearn_cw, random_state=42, verbose=-1,
            )
            estimators.append(("lgb", lgb))

        if HAS_CATBOOST:
            cb = CatBoostClassifier(
                iterations=400, depth=5, learning_rate=0.04,
                l2_leaf_reg=3, random_seed=42, verbose=False,
                allow_writing_files=False, loss_function="MultiClass",
            )
            estimators.append(("cb", cb))

        weights_list = [1.0, 0.8]
        if HAS_XGBOOST:
            weights_list.append(1.2)
        if HAS_LIGHTGBM:
            weights_list.append(1.1)
        if HAS_CATBOOST:
            weights_list.append(1.1)

        if getattr(self, "use_stacking", True):
            meta = LogisticRegression(max_iter=2000, C=1.0)
            return StackingClassifier(
                estimators=estimators,
                final_estimator=meta,
                stack_method="predict_proba",
                passthrough=False,
                n_jobs=1,
            )

        return VotingClassifier(
            estimators=estimators, voting="soft", weights=weights_list,
        )

    # ── Per-league bucketed calibration ──

    @staticmethod
    def _fit_bucket_calibration(
        proba: np.ndarray,
        y: np.ndarray,
        leagues: List[str],
        n_bins: int = 6,
    ) -> Dict[str, Any]:
        """Fit per-league reliability buckets on validation predictions.

        For each league, bin samples by max-class confidence; per bin learn
        an additive offset = (observed_accuracy - mean_predicted_confidence).
        """
        edges = np.linspace(0.34, 1.0, n_bins + 1).tolist()
        out: Dict[str, Any] = {"n_bins": n_bins, "edges": edges, "leagues": {}}
        proba = np.asarray(proba)
        y = np.asarray(y).astype(int)
        confidences = proba.max(axis=1)
        preds = proba.argmax(axis=1)
        leagues_arr = np.array(leagues)
        for lg in np.unique(leagues_arr):
            mask = leagues_arr == lg
            if mask.sum() < 20:
                continue
            lg_conf = confidences[mask]
            lg_correct = (preds[mask] == y[mask]).astype(float)
            offsets: List[float] = []
            for b in range(n_bins):
                lo, hi = edges[b], edges[b + 1]
                bin_mask = (lg_conf >= lo) & (lg_conf < hi if b < n_bins - 1 else lg_conf <= hi)
                if bin_mask.sum() < 5:
                    offsets.append(0.0)
                    continue
                mean_conf = float(lg_conf[bin_mask].mean())
                obs_acc = float(lg_correct[bin_mask].mean())
                offsets.append(obs_acc - mean_conf)
            out["leagues"][str(lg)] = {
                "offsets": offsets,
                "enabled": True,
                "sample_count": int(mask.sum()),
            }
        return out

    @staticmethod
    def _bucket_index(confidence: float, edges: List[float]) -> int:
        for i in range(len(edges) - 1):
            if confidence < edges[i + 1] or i == len(edges) - 2:
                return i
        return len(edges) - 2

    @classmethod
    def _apply_bucket_offset_row(
        cls, row: np.ndarray, league: str, buckets: Dict[str, Any]
    ) -> np.ndarray:
        lg_data = buckets.get("leagues", {}).get(str(league))
        if not lg_data or not lg_data.get("enabled", False):
            return row
        edges = buckets.get("edges", [])
        offsets = lg_data.get("offsets", [])
        if not edges or not offsets:
            return row
        conf = float(np.max(row))
        idx = cls._bucket_index(conf, edges)
        if idx >= len(offsets):
            return row
        # Apply offset to the argmax class only, preserving argmax order, then
        # renormalize. A small offset preserves ranking when |offset| < margin.
        out = row.copy().astype(np.float64)
        argmax = int(np.argmax(out))
        out[argmax] = max(1e-9, out[argmax] + float(offsets[idx]))
        s = out.sum()
        if s <= 0:
            return row
        return out / s

    def _apply_bucket_calibration_array(
        self, proba: np.ndarray, leagues: List[str]
    ) -> np.ndarray:
        if not self.calibration_buckets:
            return proba
        out = np.empty_like(proba)
        for i in range(proba.shape[0]):
            out[i] = self._apply_bucket_offset_row(
                proba[i], leagues[i], self.calibration_buckets
            )
        return out

    def apply_bucket_calibration(
        self, proba: np.ndarray, league: str
    ) -> np.ndarray:
        """Public inference-time hook: apply per-league bucketed offsets.

        Loads buckets lazily if not in memory. Preserves argmax ordering and
        renormalizes. Returns input unchanged if no buckets exist for league.
        """
        if self.calibration_buckets is None:
            self._load_calibration_buckets()
        if not self.calibration_buckets:
            return proba
        proba = np.atleast_2d(np.asarray(proba, dtype=np.float64))
        out = np.empty_like(proba)
        for i in range(proba.shape[0]):
            out[i] = self._apply_bucket_offset_row(
                proba[i], league, self.calibration_buckets
            )
        return out

    def _load_calibration_buckets(self) -> None:
        path = self.model_dir / "calibration_buckets.json"
        if not path.exists():
            return
        try:
            with open(path, "r") as f:
                self.calibration_buckets = json.load(f)
        except Exception as e:
            logger.warning("Could not load calibration_buckets.json: %s", e)
            self.calibration_buckets = None

    @staticmethod
    def _ece_by_league(
        proba: np.ndarray, y: np.ndarray, leagues: List[str], n_bins: int = 10
    ) -> Dict[str, float]:
        """Expected Calibration Error grouped by league."""
        proba = np.asarray(proba)
        y = np.asarray(y).astype(int)
        confidences = proba.max(axis=1)
        preds = proba.argmax(axis=1)
        leagues_arr = np.array(leagues)
        result: Dict[str, float] = {}
        edges = np.linspace(0.0, 1.0, n_bins + 1)
        for lg in np.unique(leagues_arr):
            mask = leagues_arr == lg
            if mask.sum() < 10:
                continue
            ece = 0.0
            n = int(mask.sum())
            for b in range(n_bins):
                bmask = mask & (confidences >= edges[b]) & (confidences < edges[b + 1])
                if bmask.sum() == 0:
                    continue
                acc = float((preds[bmask] == y[bmask]).mean())
                conf = float(confidences[bmask].mean())
                ece += (bmask.sum() / n) * abs(acc - conf)
            result[str(lg)] = round(float(ece), 4)
        return result

    @staticmethod
    def _compute_recency_weights(
        dates: Optional[List[str]], half_life_years: float = 3.0
    ) -> Optional[np.ndarray]:
        """Compute exp(-age_years / half_life) recency weights, anchored on
        the most recent match. Returns None if dates are missing/unparseable."""
        if not dates:
            return None
        parsed: List[Optional[datetime]] = []
        for d in dates:
            try:
                parsed.append(datetime.fromisoformat(str(d).replace("Z", "+00:00")))
            except Exception:
                parsed.append(None)
        valid = [p for p in parsed if p is not None]
        if not valid:
            return None
        latest = max(valid)
        weights = np.ones(len(dates), dtype=np.float64)
        for i, p in enumerate(parsed):
            if p is None:
                continue
            age_years = max(0.0, (latest - p).total_seconds() / (365.25 * 86400.0))
            weights[i] = float(np.exp(-age_years / max(half_life_years, 1e-6)))
        return weights

    def train(
        self,
        X: np.ndarray,
        y: np.ndarray,
        test_size: float = 0.15,
        train_dates: Optional[List[str]] = None,
        train_leagues: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Train with class-balanced weights, walk-forward audit, and probability calibration."""
        n_samples = len(X)
        split_idx = int(n_samples * (1 - test_size))

        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)

        class_weights = self.compute_class_weights(y_train)
        sample_weights = np.array([class_weights[int(label)] for label in y_train], dtype=np.float64)

        logger.info(f"Training on {len(X_train)} samples (test={len(X_test)}), class_weights={class_weights}")

        cal_size = 0
        if len(X_train_scaled) >= 160:
            proposed = max(40, int(len(X_train_scaled) * 0.2))
            cal_size = min(proposed, max(0, len(X_train_scaled) - 80))

        if cal_size > 0:
            X_fit = X_train_scaled[:-cal_size]
            y_fit = y_train[:-cal_size]
            fit_weights = sample_weights[:-cal_size]
            X_cal = X_train_scaled[-cal_size:]
            y_cal = y_train[-cal_size:]
        else:
            X_fit = X_train_scaled
            y_fit = y_train
            fit_weights = sample_weights
            X_cal = None
            y_cal = None

        self.model = self._build_ensemble(class_weights)
        self.model.fit(X_fit, y_fit, sample_weight=fit_weights)

        # Recency-weighted meta-learner refit (stacking only). Re-fits the
        # final LogisticRegression on the stacked out-of-fold predictions
        # with weight = class_weight × exp(-age_years / 3). Base learners are
        # left untouched.
        meta_refit_status = "skipped"
        if self.use_stacking and isinstance(self.model, StackingClassifier) and train_dates is not None:
            try:
                fit_dates = train_dates[:len(y_fit)] if len(train_dates) >= len(y_fit) else None
                recency = self._compute_recency_weights(fit_dates) if fit_dates else None
                if recency is not None and len(recency) == len(y_fit):
                    meta_w = fit_weights * recency
                    # Use the trained stacker's transform to get base preds.
                    stacked = self.model.transform(X_fit)
                    final_est = self.model.final_estimator_
                    final_est.fit(stacked, y_fit, sample_weight=meta_w)
                    meta_refit_status = "recency_weighted"
            except Exception as e:
                meta_refit_status = f"failed: {e.__class__.__name__}"

        self.calibrator = None
        calibration_status = "disabled"
        if X_cal is not None and y_cal is not None and len(np.unique(y_cal)) == 3:
            try:
                self.calibrator = CalibratedClassifierCV(
                    estimator=self.model,
                    method="isotonic",
                    cv="prefit",
                )
                self.calibrator.fit(X_cal, y_cal)
                calibration_status = "isotonic_prefit"
            except Exception as cal_error:
                self.calibrator = None
                calibration_status = f"failed: {cal_error.__class__.__name__}"

        y_proba_raw = self._normalize_probabilities(self.model.predict_proba(X_test_scaled))
        if self.calibrator is not None:
            y_proba = self._normalize_probabilities(self.calibrator.predict_proba(X_test_scaled))
        else:
            y_proba = y_proba_raw

        # Per-league bucketed calibration: learn confidence-bin offsets on the
        # held-out calibration slice (if present), keyed by league. Persisted
        # to disk and gated behind `bucket_calibration: true` per league.
        bucket_metrics: Dict[str, Any] = {}
        if (
            X_cal is not None and y_cal is not None
            and self.calibrator is not None
            and train_leagues is not None
        ):
            try:
                cal_leagues = train_leagues[-cal_size:] if cal_size > 0 else []
                if len(cal_leagues) == len(y_cal):
                    cal_proba = self._normalize_probabilities(
                        self.calibrator.predict_proba(X_cal)
                    )
                    self.calibration_buckets = self._fit_bucket_calibration(
                        cal_proba, y_cal, cal_leagues
                    )
                    # Surface bucket-calibrated metrics on the test slice when
                    # leagues are also available for test rows.
                    test_leagues = train_leagues[split_idx:] if len(train_leagues) >= n_samples else None
                    if test_leagues is not None and len(test_leagues) == len(y_test):
                        y_proba_bc = self._apply_bucket_calibration_array(
                            y_proba, test_leagues
                        )
                        y_pred_bc = np.argmax(y_proba_bc, axis=1)
                        bucket_metrics = {
                            "accuracy_bucket_calibrated": float(accuracy_score(y_test, y_pred_bc)),
                            "log_loss_bucket_calibrated": float(log_loss(y_test, y_proba_bc, labels=[0, 1, 2])),
                            "brier_score_bucket_calibrated": self._multiclass_brier(y_test, y_proba_bc),
                            "ece_bucket_calibrated_by_league": self._ece_by_league(
                                y_proba_bc, y_test, test_leagues
                            ),
                        }
            except Exception as bucket_err:
                logger.warning("Bucket calibration failed: %s", bucket_err)
                self.calibration_buckets = None

        y_pred = np.argmax(y_proba, axis=1)
        accuracy = accuracy_score(y_test, y_pred)
        logloss = log_loss(y_test, y_proba, labels=[0, 1, 2])
        brier_overall = self._multiclass_brier(y_test, y_proba)
        objective = self._objective_from_metrics(logloss, brier_overall)

        brier_scores = {}
        for cls, name in enumerate(["home_win", "draw", "away_win"]):
            mask = y_test == cls
            if mask.any():
                brier_scores[name] = float(brier_score_loss(mask.astype(int), y_proba[:, cls]))

        walk_forward = self._walk_forward_metrics(X_train, y_train, class_weights)

        tscv = TimeSeriesSplit(n_splits=5)
        cv_scores = cross_val_score(
            self._build_ensemble(class_weights),
            X_train_scaled,
            y_train,
            cv=tscv,
            scoring="accuracy",
        )

        metrics = {
            "accuracy": float(accuracy),
            "log_loss": float(logloss),
            "brier_score": float(brier_overall),
            "objective_score": float(objective),
            "brier_scores": brier_scores,
            "cv_accuracy_mean": float(cv_scores.mean()),
            "cv_accuracy_std": float(cv_scores.std()),
            "walk_forward": walk_forward,
            "calibration": {
                "status": calibration_status,
                "calibration_samples": int(cal_size),
            },
            "train_samples": len(X_train),
            "test_samples": len(X_test),
            "class_distribution": {
                "home_win": int(sum(y == 0)),
                "draw": int(sum(y == 1)),
                "away_win": int(sum(y == 2)),
            },
            "class_weights": {str(k): round(v, 3) for k, v in class_weights.items()},
            "feature_count": X.shape[1],
            "objective_weights": self.objective_weights,
            "use_stacking": bool(self.use_stacking),
            "meta_refit": meta_refit_status if self.use_stacking else "n/a",
            "bucket_calibration": bool(self.calibration_buckets),
        }
        if bucket_metrics:
            metrics.update(bucket_metrics)

        try:
            gb_model = self.model.named_estimators_.get("gb")
            if gb_model and hasattr(gb_model, "feature_importances_"):
                importances = gb_model.feature_importances_
                names = self.feature_names[:len(importances)]
                top_features = sorted(
                    zip(names, importances), key=lambda x: x[1], reverse=True
                )[:20]
                metrics["top_features"] = [
                    {"name": f, "importance": round(float(v), 4)} for f, v in top_features
                ]
        except Exception:
            pass

        self.training_metadata = {
            "trained_at": datetime.utcnow().isoformat(),
            "model_version": "4.1.0",
            "metrics": metrics,
        }

        logger.info(
            "Training complete — Accuracy: %.3f, LogLoss: %.4f, Brier: %.4f, Objective: %.4f",
            accuracy,
            logloss,
            brier_overall,
            objective,
        )
        return metrics

    def save_model(self, name: str = "match_predictor"):
        if self.model is None:
            raise ValueError("No trained model to save")
        model_path = self.model_dir / f"{name}.pkl"
        scaler_path = self.model_dir / f"{name}_scaler.pkl"
        calibrator_path = self.model_dir / f"{name}_calibrator.pkl"
        meta_path = self.model_dir / f"{name}_metadata.json"

        with open(model_path, "wb") as f:
            pickle.dump(self.model, f)
        with open(scaler_path, "wb") as f:
            pickle.dump(self.scaler, f)
        if self.calibrator is not None:
            with open(calibrator_path, "wb") as f:
                pickle.dump(self.calibrator, f)
        elif calibrator_path.exists():
            calibrator_path.unlink()
        with open(meta_path, "w") as f:
            json.dump(self.training_metadata, f, indent=2)
        # Persist per-league bucketed calibration alongside the model.
        buckets_path = self.model_dir / "calibration_buckets.json"
        if self.calibration_buckets:
            with open(buckets_path, "w") as f:
                json.dump(self.calibration_buckets, f, indent=2)
        elif buckets_path.exists():
            buckets_path.unlink()
        logger.info(f"Model saved to {model_path}")

    def load_model(self, name: str = "match_predictor") -> bool:
        model_path = self.model_dir / f"{name}.pkl"
        scaler_path = self.model_dir / f"{name}_scaler.pkl"
        calibrator_path = self.model_dir / f"{name}_calibrator.pkl"
        meta_path = self.model_dir / f"{name}_metadata.json"
        if not model_path.exists():
            return False
        try:
            with open(model_path, "rb") as f:
                self.model = pickle.load(f)
            with open(scaler_path, "rb") as f:
                self.scaler = pickle.load(f)
            self.calibrator = None
            if calibrator_path.exists():
                with open(calibrator_path, "rb") as f:
                    self.calibrator = pickle.load(f)
            if meta_path.exists():
                with open(meta_path, "r") as f:
                    self.training_metadata = json.load(f)
            self._load_calibration_buckets()
            return True
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            return False

    def predict_proba(
        self, features: np.ndarray, league: Optional[str] = None
    ) -> np.ndarray:
        if self.model is None:
            raise ValueError("No model loaded")
        scaled = self.scaler.transform(features.reshape(1, -1) if features.ndim == 1 else features)
        if self.calibrator is not None:
            try:
                proba = self._normalize_probabilities(self.calibrator.predict_proba(scaled))
            except Exception:
                proba = self._normalize_probabilities(self.model.predict_proba(scaled))
        else:
            proba = self._normalize_probabilities(self.model.predict_proba(scaled))
        # Optional per-league bucketed calibration (no-op if buckets absent).
        if league is not None:
            try:
                proba = self.apply_bucket_calibration(proba, league)
            except Exception:
                pass
        return proba

    def predict(self, features: np.ndarray) -> np.ndarray:
        return self.predict_proba(features)


async def train_model_pipeline(
    leagues: Optional[List[str]] = None,
    min_season: int = 2010,
    force_fetch: bool = False,
) -> Dict[str, Any]:
    """Complete training pipeline: fetch → features → train → save."""
    from backend.services.prediction.historical_data import get_historical_collector

    collector = get_historical_collector()

    logger.info("Step 1/4: Fetching historical match data (extended range)...")
    all_data = await collector.fetch_all_historical_data(
        leagues=leagues, min_season=min_season, force=force_fetch
    )

    all_matches = []
    for league_matches in all_data.values():
        all_matches.extend(league_matches)

    if len(all_matches) < 100:
        return {"error": "Insufficient data", "match_count": len(all_matches)}

    logger.info(f"Step 2/4: Building {N_FEATURES}-feature vectors from {len(all_matches)} matches...")

    trainer = ModelTrainer()
    X, y, dates, leagues = trainer.prepare_training_data(all_matches, return_meta=True)

    if len(X) < 50:
        return {"error": "Insufficient valid samples", "sample_count": len(X)}

    logger.info("Step 3/4: Training ensemble model (class-balanced)...")
    metrics = trainer.train(X, y, train_dates=dates, train_leagues=leagues)

    logger.info("Step 4/4: Saving model artifacts...")
    trainer.save_model()

    return {
        "status": "success",
        "total_matches": len(all_matches),
        "training_samples": len(X),
        "metrics": metrics,
    }


_trainer: Optional[ModelTrainer] = None


def get_model_trainer() -> ModelTrainer:
    global _trainer
    if _trainer is None:
        _trainer = ModelTrainer()
        _trainer.load_model()
    return _trainer
