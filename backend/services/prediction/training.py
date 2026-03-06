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
)

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


# Total feature count for the enhanced model
N_FEATURES = 66

# Module-level league characteristics (also available as FeatureBuilder class attrs)
LEAGUE_DRAW_RATES = {
    "premier_league": 0.25, "la_liga": 0.24, "bundesliga": 0.23,
    "serie_a": 0.27, "ligue_1": 0.24, "eredivisie": 0.22,
    "primeira_liga": 0.25, "mls": 0.20,
    "champions_league": 0.22, "europa_league": 0.23,
}
LEAGUE_AVG_TOTAL_GOALS = {
    "premier_league": 2.77, "la_liga": 2.56, "bundesliga": 3.02,
    "serie_a": 2.58, "ligue_1": 2.55, "eredivisie": 2.95,
    "primeira_liga": 2.50, "mls": 2.85,
    "champions_league": 2.95, "europa_league": 2.78,
}
LEAGUE_HOME_WIN_RATE = {
    "premier_league": 0.44, "la_liga": 0.47, "bundesliga": 0.44,
    "serie_a": 0.44, "ligue_1": 0.44, "eredivisie": 0.46,
    "primeira_liga": 0.48, "mls": 0.47,
    "champions_league": 0.45, "europa_league": 0.44,
}
LEAGUE_COMPETITIVENESS = {
    "premier_league": 0.72, "la_liga": 0.65, "bundesliga": 0.60,
    "serie_a": 0.68, "ligue_1": 0.55, "eredivisie": 0.62,
    "primeira_liga": 0.60, "mls": 0.82,
    "champions_league": 0.70, "europa_league": 0.70,
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
    """

    LEAGUE_COEFFICIENTS = {
        "premier_league": 1.15, "la_liga": 1.10, "bundesliga": 1.05,
        "serie_a": 1.05, "ligue_1": 1.00, "eredivisie": 0.90,
        "primeira_liga": 0.90, "mls": 0.80,
        "champions_league": 1.20, "europa_league": 1.05,
    }

    # League-specific characteristics (empirical averages)
    LEAGUE_DRAW_RATES = {
        "premier_league": 0.25, "la_liga": 0.24, "bundesliga": 0.23,
        "serie_a": 0.27, "ligue_1": 0.24, "eredivisie": 0.22,
        "primeira_liga": 0.25, "mls": 0.20,
        "champions_league": 0.22, "europa_league": 0.23,
    }

    LEAGUE_AVG_TOTAL_GOALS = {
        "premier_league": 2.77, "la_liga": 2.56, "bundesliga": 3.02,
        "serie_a": 2.58, "ligue_1": 2.55, "eredivisie": 2.95,
        "primeira_liga": 2.50, "mls": 2.85,
        "champions_league": 2.95, "europa_league": 2.78,
    }

    LEAGUE_HOME_WIN_RATE = {
        "premier_league": 0.44, "la_liga": 0.47, "bundesliga": 0.44,
        "serie_a": 0.44, "ligue_1": 0.44, "eredivisie": 0.46,
        "primeira_liga": 0.48, "mls": 0.47,
        "champions_league": 0.45, "europa_league": 0.44,
    }

    LEAGUE_COMPETITIVENESS = {
        # Gini coefficient of points — higher = less competitive (dominated)
        "premier_league": 0.72, "la_liga": 0.65, "bundesliga": 0.60,
        "serie_a": 0.68, "ligue_1": 0.55, "eredivisie": 0.62,
        "primeira_liga": 0.60, "mls": 0.82,
        "champions_league": 0.70, "europa_league": 0.70,
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
    ]

    def __init__(self):
        self.elo_ratings: Dict[str, float] = {}
        self.team_history: Dict[str, List[Dict]] = {}
        self.h2h_cache: Dict[str, List[Dict]] = {}
        # Track rolling tactical stats per team
        self.team_tactical: Dict[str, List[Dict]] = {}

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
        """Build 55-dimensional feature vector for a single match."""
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


class ModelTrainer:
    """
    Trains ensemble classification + goal regression models.
    Uses class-balanced weighting to fix draw under-prediction.
    """

    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = model_dir or MODEL_DIR
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.scaler = StandardScaler()
        self.model = None
        self.feature_names = FeatureBuilder.FEATURE_NAMES
        self.training_metadata: Dict[str, Any] = {}

    def prepare_training_data(self, matches: List[Dict]) -> Tuple[np.ndarray, np.ndarray]:
        """Process raw matches into feature matrix and labels."""
        builder = FeatureBuilder()
        sorted_matches = sorted(matches, key=lambda m: m.get("date", ""))

        X_list = []
        y_list = []

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

        X = np.array(X_list, dtype=np.float64)
        y = np.array(y_list, dtype=np.int32)
        X = np.nan_to_num(X, nan=0.0, posinf=5.0, neginf=-5.0)

        logger.info(
            f"Prepared {len(X)} training samples. "
            f"Distribution: H={sum(y==0)}, D={sum(y==1)}, A={sum(y==2)}"
        )
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

        weights_list = [1.0, 0.8]
        if HAS_XGBOOST:
            weights_list.append(1.2)
        if HAS_LIGHTGBM:
            weights_list.append(1.1)

        ensemble = VotingClassifier(
            estimators=estimators, voting="soft", weights=weights_list,
        )
        return ensemble

    def train(self, X: np.ndarray, y: np.ndarray, test_size: float = 0.15) -> Dict[str, Any]:
        """Train with class-balanced weights."""
        n_samples = len(X)
        split_idx = int(n_samples * (1 - test_size))

        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)

        # Compute class weights
        class_weights = self.compute_class_weights(y_train)
        sample_weights = np.array([class_weights[yi] for yi in y_train])

        logger.info(f"Training on {len(X_train)} samples (test={len(X_test)}), class_weights={class_weights}")

        self.model = self._build_ensemble(class_weights)
        self.model.fit(X_train_scaled, y_train, sample_weight=sample_weights)

        y_pred = self.model.predict(X_test_scaled)
        y_proba = self.model.predict_proba(X_test_scaled)

        accuracy = accuracy_score(y_test, y_pred)
        logloss = log_loss(y_test, y_proba)

        brier_scores = {}
        for cls, name in enumerate(["home_win", "draw", "away_win"]):
            mask = y_test == cls
            if mask.any():
                brier_scores[name] = float(brier_score_loss(mask.astype(int), y_proba[:, cls]))

        tscv = TimeSeriesSplit(n_splits=5)
        cv_scores = cross_val_score(
            self._build_ensemble(class_weights),
            X_train_scaled, y_train, cv=tscv, scoring="accuracy",
        )

        metrics = {
            "accuracy": float(accuracy),
            "log_loss": float(logloss),
            "brier_scores": brier_scores,
            "cv_accuracy_mean": float(cv_scores.mean()),
            "cv_accuracy_std": float(cv_scores.std()),
            "train_samples": len(X_train),
            "test_samples": len(X_test),
            "class_distribution": {
                "home_win": int(sum(y == 0)),
                "draw": int(sum(y == 1)),
                "away_win": int(sum(y == 2)),
            },
            "class_weights": {str(k): round(v, 3) for k, v in class_weights.items()},
            "feature_count": X.shape[1],
        }

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
            "model_version": "4.0.0",
            "metrics": metrics,
        }

        logger.info(f"Training complete — Accuracy: {accuracy:.3f}, CV: {cv_scores.mean():.3f}±{cv_scores.std():.3f}")
        return metrics

    def save_model(self, name: str = "match_predictor"):
        if self.model is None:
            raise ValueError("No trained model to save")
        model_path = self.model_dir / f"{name}.pkl"
        scaler_path = self.model_dir / f"{name}_scaler.pkl"
        meta_path = self.model_dir / f"{name}_metadata.json"

        with open(model_path, "wb") as f:
            pickle.dump(self.model, f)
        with open(scaler_path, "wb") as f:
            pickle.dump(self.scaler, f)
        with open(meta_path, "w") as f:
            json.dump(self.training_metadata, f, indent=2)
        logger.info(f"Model saved to {model_path}")

    def load_model(self, name: str = "match_predictor") -> bool:
        model_path = self.model_dir / f"{name}.pkl"
        scaler_path = self.model_dir / f"{name}_scaler.pkl"
        meta_path = self.model_dir / f"{name}_metadata.json"
        if not model_path.exists():
            return False
        try:
            with open(model_path, "rb") as f:
                self.model = pickle.load(f)
            with open(scaler_path, "rb") as f:
                self.scaler = pickle.load(f)
            if meta_path.exists():
                with open(meta_path, "r") as f:
                    self.training_metadata = json.load(f)
            return True
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            return False

    def predict(self, features: np.ndarray) -> np.ndarray:
        if self.model is None:
            raise ValueError("No model loaded")
        scaled = self.scaler.transform(features.reshape(1, -1) if features.ndim == 1 else features)
        return self.model.predict_proba(scaled)


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
    X, y = trainer.prepare_training_data(all_matches)

    if len(X) < 50:
        return {"error": "Insufficient valid samples", "sample_count": len(X)}

    logger.info("Step 3/4: Training ensemble model (class-balanced)...")
    metrics = trainer.train(X, y)

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
