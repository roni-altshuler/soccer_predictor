"""
Probabilistic prediction model using Poisson distribution for goals.

Supports per-league model instances with league-specific calibrated parameters
for draw rates, average goals, home advantage, and Dixon-Coles correlation.
"""

import json
import numpy as np
from pathlib import Path
from scipy import stats
from scipy.special import factorial
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# Per-league calibrated parameters — loaded from league_params.json
# Falls back to hardcoded defaults if the JSON file is missing.
# ══════════════════════════════════════════════════════════════════════

DEFAULT_PARAMS = {"avg_goals": 1.35, "home_adv": 0.25, "rho": -0.13, "draw_rate": 0.24}


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _sanitize_params(raw: Dict[str, float]) -> Dict[str, float]:
    """Keep learned feedback parameters inside physically realistic bounds."""
    return {
        "avg_goals": _clamp(float(raw.get("avg_goals", DEFAULT_PARAMS["avg_goals"])), 0.75, 2.25),
        "home_adv": _clamp(float(raw.get("home_adv", DEFAULT_PARAMS["home_adv"])), 0.05, 0.45),
        "rho": _clamp(float(raw.get("rho", DEFAULT_PARAMS["rho"])), -0.35, 0.15),
        "draw_rate": _clamp(float(raw.get("draw_rate", DEFAULT_PARAMS["draw_rate"])), 0.08, 0.38),
    }


def _load_league_params() -> Dict[str, Dict[str, float]]:
    """Load per-league params from single source of truth."""
    params_file = Path(__file__).parent.parent.parent / "data" / "league_params.json"
    try:
        if params_file.exists():
            with open(params_file) as f:
                data = json.load(f)
            leagues = data.get("leagues", {})
            # Build lookup with both key-based and display-name-based entries
            result = {}
            display_map = {
                "eng.1": "Premier League", "esp.1": "La Liga", "ger.1": "Bundesliga",
                "ita.1": "Serie A", "fra.1": "Ligue 1", "ned.1": "Eredivisie",
                "por.1": "Primeira Liga", "usa.1": "MLS",
                "uefa.champions": "Champions League", "uefa.europa": "Europa League",
                "uefa.europa.conf": "Conference League", "fifa.world": "FIFA World Cup",
                "uefa.euro": "UEFA European Championship", "conmebol.america": "Copa America",
            }
            for key, lp in leagues.items():
                params = _sanitize_params(lp)
                result[key] = params
                # Also register friendly name alias
                if key in display_map:
                    result[display_map[key]] = params
            logger.info(f"Loaded league params from {params_file} ({len(leagues)} leagues)")
            return result
    except Exception as e:
        logger.warning(f"Could not load league_params.json: {e}")
    
    # Fallback to hardcoded defaults
    return {
        "eng.1":            {"avg_goals": 1.42, "home_adv": 0.28, "rho": -0.13, "draw_rate": 0.23},
        "esp.1":            {"avg_goals": 1.30, "home_adv": 0.30, "rho": -0.12, "draw_rate": 0.24},
        "ger.1":            {"avg_goals": 1.55, "home_adv": 0.25, "rho": -0.11, "draw_rate": 0.22},
        "ita.1":            {"avg_goals": 1.32, "home_adv": 0.26, "rho": -0.14, "draw_rate": 0.27},
        "fra.1":            {"avg_goals": 1.30, "home_adv": 0.27, "rho": -0.12, "draw_rate": 0.24},
        "ned.1":            {"avg_goals": 1.45, "home_adv": 0.24, "rho": -0.11, "draw_rate": 0.21},
        "por.1":            {"avg_goals": 1.28, "home_adv": 0.27, "rho": -0.13, "draw_rate": 0.25},
        "usa.1":            {"avg_goals": 1.45, "home_adv": 0.20, "rho": -0.10, "draw_rate": 0.22},
        "uefa.champions":   {"avg_goals": 1.50, "home_adv": 0.22, "rho": -0.12, "draw_rate": 0.20},
        "uefa.europa":      {"avg_goals": 1.42, "home_adv": 0.20, "rho": -0.11, "draw_rate": 0.22},
        "uefa.europa.conf": {"avg_goals": 1.38, "home_adv": 0.20, "rho": -0.10, "draw_rate": 0.23},
        "fifa.world":       {"avg_goals": 1.30, "home_adv": 0.15, "rho": -0.09, "draw_rate": 0.18},
        "uefa.euro":        {"avg_goals": 1.28, "home_adv": 0.12, "rho": -0.09, "draw_rate": 0.22},
        "conmebol.america": {"avg_goals": 1.26, "home_adv": 0.12, "rho": -0.09, "draw_rate": 0.20},
    }


# Load once at module import
LEAGUE_PARAMS = _load_league_params()


@dataclass
class GoalDistribution:
    """Goal probability distribution for a team."""
    expected_goals: float
    probabilities: np.ndarray  # P(0 goals), P(1 goal), ..., P(max_goals)
    
    def prob(self, goals: int) -> float:
        """Get probability of scoring exactly n goals."""
        if goals < 0 or goals >= len(self.probabilities):
            return 0.0
        return self.probabilities[goals]


@dataclass 
class ScoreMatrix:
    """Probability matrix for all possible scorelines."""
    matrix: np.ndarray  # shape: (max_goals+1, max_goals+1)
    home_expected: float
    away_expected: float
    max_goals: int
    
    def get_prob(self, home: int, away: int) -> float:
        """Get probability of a specific scoreline."""
        if home < 0 or away < 0 or home > self.max_goals or away > self.max_goals:
            return 0.0
        return self.matrix[home, away]
    
    def home_win_prob(self) -> float:
        """Probability of home team winning."""
        total = 0.0
        for h in range(self.max_goals + 1):
            for a in range(h):
                total += self.matrix[h, a]
        return total
    
    def draw_prob(self) -> float:
        """Probability of a draw."""
        return sum(self.matrix[i, i] for i in range(self.max_goals + 1))
    
    def away_win_prob(self) -> float:
        """Probability of away team winning."""
        total = 0.0
        for a in range(self.max_goals + 1):
            for h in range(a):
                total += self.matrix[h, a]
        return total
    
    def over_goals_prob(self, total: float) -> float:
        """Probability of more than N total goals."""
        prob = 0.0
        threshold = int(total)
        for h in range(self.max_goals + 1):
            for a in range(self.max_goals + 1):
                if h + a > threshold:
                    prob += self.matrix[h, a]
        return prob
    
    def btts_prob(self) -> float:
        """Probability of both teams scoring."""
        prob = 0.0
        for h in range(1, self.max_goals + 1):
            for a in range(1, self.max_goals + 1):
                prob += self.matrix[h, a]
        return prob
    
    def most_likely_scores(self, n: int = 5) -> List[Tuple[int, int, float]]:
        """Get N most likely scorelines."""
        scores = []
        for h in range(self.max_goals + 1):
            for a in range(self.max_goals + 1):
                scores.append((h, a, self.matrix[h, a]))
        
        scores.sort(key=lambda x: x[2], reverse=True)
        return scores[:n]


class PoissonModel:
    """
    Dixon-Coles enhanced Poisson goal prediction model.
    
    Uses Poisson distribution to model the number of goals
    scored by each team, with a Dixon-Coles correction for
    low-scoring outcomes (0-0, 1-0, 0-1, 1-1) to account
    for the observed correlation in football scores.
    """
    
    def __init__(self, max_goals: int = 10):
        self.max_goals = max_goals
    
    def calculate_expected_goals(
        self,
        attack_strength: float,
        defense_weakness: float,
        league_avg_goals: float = 1.35,
        home_advantage: float = 0.25
    ) -> float:
        """
        Calculate expected goals for a team.
        
        Args:
            attack_strength: Team's attacking strength relative to league avg (>1 = better)
            defense_weakness: Opponent's defensive weakness relative to league avg (>1 = weaker)
            league_avg_goals: Average goals per team per game in league
            home_advantage: Goals boost for home team
        
        Returns:
            Expected goals (lambda for Poisson)
        """
        xG = attack_strength * defense_weakness * league_avg_goals + home_advantage
        return max(0.3, min(5.0, xG))  # Clamp to reasonable range
    
    def goal_distribution(self, expected_goals: float) -> GoalDistribution:
        """Get probability distribution for goals."""
        probs = np.zeros(self.max_goals + 1)
        
        for k in range(self.max_goals + 1):
            probs[k] = stats.poisson.pmf(k, expected_goals)
        
        # Normalize to ensure probabilities sum to 1
        probs = probs / probs.sum()
        
        return GoalDistribution(
            expected_goals=expected_goals,
            probabilities=probs
        )
    
    def score_matrix(
        self,
        home_xG: float,
        away_xG: float,
        rho: float = -0.13,
    ) -> ScoreMatrix:
        """
        Calculate probability matrix for all scorelines.
        
        Applies Dixon-Coles correction to low-scoring outcomes
        to account for goal correlation in football.
        
        Args:
            home_xG: Expected goals for home team
            away_xG: Expected goals for away team
            rho: Dixon-Coles correlation parameter (typically -0.13 to -0.08)
                 Negative rho increases P(0-0) and P(1-1), decreases P(1-0) and P(0-1)
        """
        matrix = np.zeros((self.max_goals + 1, self.max_goals + 1))
        
        home_dist = self.goal_distribution(home_xG)
        away_dist = self.goal_distribution(away_xG)
        
        for h in range(self.max_goals + 1):
            for a in range(self.max_goals + 1):
                base_prob = home_dist.probabilities[h] * away_dist.probabilities[a]
                
                # Dixon-Coles correction for low scores
                if h == 0 and a == 0:
                    tau = 1.0 - home_xG * away_xG * rho
                elif h == 0 and a == 1:
                    tau = 1.0 + home_xG * rho
                elif h == 1 and a == 0:
                    tau = 1.0 + away_xG * rho
                elif h == 1 and a == 1:
                    tau = 1.0 - rho
                else:
                    tau = 1.0
                
                matrix[h, a] = base_prob * max(0.0, tau)
        
        # Re-normalize to ensure probabilities sum to 1
        total = matrix.sum()
        if total > 0:
            matrix = matrix / total
        
        return ScoreMatrix(
            matrix=matrix,
            home_expected=home_xG,
            away_expected=away_xG,
            max_goals=self.max_goals
        )
    
    def predict_match(
        self,
        home_attack: float,
        home_defense: float,
        away_attack: float,
        away_defense: float,
        league_avg_goals: float = 1.35,
        home_advantage: float = 0.25
    ) -> Dict:
        """
        Make a complete match prediction.
        
        Args:
            home_attack: Home team attack strength (relative to league avg)
            home_defense: Home team defense strength (relative to league avg, higher = better)
            away_attack: Away team attack strength
            away_defense: Away team defense strength
            league_avg_goals: League average goals per team per game
            home_advantage: Home goals advantage
        
        Returns:
            Dict with outcome probabilities, expected goals, and scoreline predictions
        """
        # Calculate expected goals
        # Home xG = home_attack * away_defense_weakness * avg + home_bonus
        # away_defense_weakness = 1 / away_defense (lower defense = higher weakness)
        home_xG = self.calculate_expected_goals(
            home_attack,
            1 / away_defense if away_defense > 0 else 1.0,
            league_avg_goals,
            home_advantage
        )
        
        # Away has no home advantage
        away_xG = self.calculate_expected_goals(
            away_attack,
            1 / home_defense if home_defense > 0 else 1.0,
            league_avg_goals,
            0.0
        )
        
        # Generate score matrix
        matrix = self.score_matrix(home_xG, away_xG)
        
        # Get probabilities
        home_win = matrix.home_win_prob()
        draw = matrix.draw_prob()
        away_win = matrix.away_win_prob()
        
        # Normalize
        total = home_win + draw + away_win
        home_win /= total
        draw /= total
        away_win /= total
        
        # Most likely scores
        likely_scores = matrix.most_likely_scores(5)
        
        return {
            "outcome": {
                "home_win": round(home_win, 4),
                "draw": round(draw, 4),
                "away_win": round(away_win, 4),
            },
            "goals": {
                "home_xG": round(home_xG, 2),
                "away_xG": round(away_xG, 2),
                "total_xG": round(home_xG + away_xG, 2),
                "over_1_5": round(matrix.over_goals_prob(1.5), 4),
                "over_2_5": round(matrix.over_goals_prob(2.5), 4),
                "over_3_5": round(matrix.over_goals_prob(3.5), 4),
                "btts": round(matrix.btts_prob(), 4),
            },
            "scorelines": [
                {"score": f"{s[0]}-{s[1]}", "probability": round(s[2], 4)}
                for s in likely_scores
            ],
            "matrix": matrix,
        }


class HybridPredictionModel:
    """
    Enhanced prediction model combining ML, Poisson, and ELO.
    
    Uses:
    1. XGBoost/GradientBoosting for outcome classification
    2. Dixon-Coles corrected Poisson model for goal/scoreline predictions
    3. ELO ratings with league-calibrated draw rates
    4. Opponent-adjusted attack/defense strengths
    5. Weather, injury, venue, and referee adjustments
    """
    
    def __init__(
        self,
        outcome_model=None,
        poisson_model: Optional[PoissonModel] = None,
        league_avg_goals: float = 1.35,
        home_advantage: float = 0.25,
        rho: float = -0.13,
        league: Optional[str] = None,
    ):
        # If league provided, use calibrated params
        if league and league in LEAGUE_PARAMS:
            params = LEAGUE_PARAMS[league]
            league_avg_goals = params["avg_goals"]
            home_advantage = params["home_adv"]
            rho = params["rho"]
        
        self.outcome_model = outcome_model
        self.poisson = poisson_model or PoissonModel()
        self.league_avg_goals = league_avg_goals
        self.home_advantage = home_advantage
        self.rho = rho
        self.league = league
    
    def elo_to_attack_defense(
        self,
        elo: float,
        goals_per_game: float,
        conceded_per_game: float,
        opponent_avg_elo: float = 1500.0,
    ) -> Tuple[float, float]:
        """
        Convert ELO and stats to opponent-adjusted attack/defense strength.
        
        Attack strength: relative to league average (1.0 = average)
        Defense strength: relative to league average (>1 = better defense)
        
        Includes opponent quality adjustment to normalize for strength of schedule.
        """
        elo_factor = (elo - 1500) / 400  # -1 to 1 for typical ELO range
        
        # Opponent quality factor: if a team scored a lot against weak opponents,
        # adjust downward; if against strong opponents, adjust upward
        opp_quality = (opponent_avg_elo - 1500) / 400
        schedule_factor = 1.0 + opp_quality * 0.15  # ±15% based on schedule
        
        # Attack strength based on goals and ELO, adjusted for opponent quality
        attack = (goals_per_game / self.league_avg_goals) * schedule_factor
        attack = attack * (1 + elo_factor * 0.2)
        attack = max(0.4, min(2.5, attack))
        
        # Defense strength (higher = better, concedes less)
        if conceded_per_game > 0:
            defense = self.league_avg_goals / conceded_per_game
        else:
            defense = 1.5
        defense = defense * (1 + elo_factor * 0.1) / schedule_factor
        defense = max(0.4, min(2.5, defense))
        
        return attack, defense
    
    def predict(
        self,
        home_elo: float,
        away_elo: float,
        home_goals_pg: float,
        home_conceded_pg: float,
        away_goals_pg: float,
        away_conceded_pg: float,
        features: Optional[np.ndarray] = None,
        home_form: Optional[float] = None,
        away_form: Optional[float] = None,
        league: Optional[str] = None,
        weather_factor: Optional[float] = None,
        injury_home: Optional[float] = None,
        injury_away: Optional[float] = None,
        referee_factor: Optional[float] = None,
        venue_factor: Optional[float] = None,
    ) -> Dict:
        """
        Make a complete match prediction with enhanced feature integration.
        
        Args:
            home_form: Form score 0-1 (from last 5 games). Momentum adjustment.
            away_form: Form score 0-1 (from last 5 games). Momentum adjustment.
            league: League key for league-specific parameters.
            weather_factor: 0.8-1.2 — impacts total xG (rain/wind reduce, clear boosts).
            injury_home: 0-1 — fraction of key squad available (1.0 = full squad).
            injury_away: 0-1 — fraction of key squad available.
            referee_factor: 0.9-1.1 — referee tendency (>1 = more cards/fouls = defensive).
            venue_factor: 0.9-1.1 — venue-specific home advantage modifier.
        """
        # Use league-specific parameters if available
        avg_goals = self.league_avg_goals
        home_adv = self.home_advantage
        rho = self.rho
        if league and league in LEAGUE_PARAMS:
            params = LEAGUE_PARAMS[league]
            avg_goals = params["avg_goals"]
            home_adv = params["home_adv"]
            rho = params["rho"]
        
        # Get attack/defense strengths
        home_attack, home_defense = self.elo_to_attack_defense(
            home_elo, home_goals_pg, home_conceded_pg
        )
        away_attack, away_defense = self.elo_to_attack_defense(
            away_elo, away_goals_pg, away_conceded_pg
        )
        
        # ── Form-based momentum adjustment ──
        # Hot teams get slight xG boost (captures short-term streaks ELO hasn't absorbed)
        if home_form is not None:
            momentum_home = 1.0 + (home_form - 0.5) * 0.15  # ±7.5%
            home_attack *= momentum_home
        if away_form is not None:
            momentum_away = 1.0 + (away_form - 0.5) * 0.15
            away_attack *= momentum_away
        
        # ── Injury impact ──
        # Missing key players reduces effective attack/defense strength
        if injury_home is not None:
            # injury_home = fraction of squad available (0.7 means 30% key players out)
            inj_factor = 0.85 + 0.15 * injury_home  # Range: 0.85 to 1.0
            home_attack *= inj_factor
            home_defense *= inj_factor
        if injury_away is not None:
            inj_factor = 0.85 + 0.15 * injury_away
            away_attack *= inj_factor
            away_defense *= inj_factor
        
        # ── Venue factor ──
        # Some stadiums provide more/less home advantage
        if venue_factor is not None:
            home_adv *= venue_factor
        
        # ── Poisson predictions for goals (with Dixon-Coles correction) ──
        poisson_pred = self.poisson.predict_match(
            home_attack, home_defense,
            away_attack, away_defense,
            avg_goals,
            home_adv,
        )
        
        # Re-compute score matrix with Dixon-Coles correction
        home_xG = poisson_pred["goals"]["home_xG"]
        away_xG = poisson_pred["goals"]["away_xG"]
        
        # ── Weather impact on total goals ──
        # Rain/wind/extreme cold suppress goals; clear conditions are neutral
        if weather_factor is not None:
            home_xG *= weather_factor
            away_xG *= weather_factor
        
        # ── Referee tendency ──
        # Strict referees (more cards) lead to more cautious play = fewer goals
        if referee_factor is not None:
            # referee_factor > 1.0 means strict → reduce total xG slightly
            ref_adj = 1.0 - (referee_factor - 1.0) * 0.5  # >1.0 referees reduce goals
            home_xG *= ref_adj
            away_xG *= ref_adj
        
        corrected_matrix = self.poisson.score_matrix(home_xG, away_xG, rho=rho)
        
        # Use corrected probabilities
        poisson_pred["outcome"]["home_win"] = round(corrected_matrix.home_win_prob(), 4)
        poisson_pred["outcome"]["draw"] = round(corrected_matrix.draw_prob(), 4)
        poisson_pred["outcome"]["away_win"] = round(corrected_matrix.away_win_prob(), 4)
        poisson_pred["matrix"] = corrected_matrix
        
        # If we have an ML model and features, use it for outcome
        if self.outcome_model is not None and features is not None:
            try:
                ml_probs = self.outcome_model.predict_proba(features.reshape(1, -1))[0]
                
                # Adaptive blending: use more ML weight when ML is confident
                ml_entropy = -sum(p * np.log(p + 1e-10) for p in ml_probs)
                max_ent = -3 * (1/3) * np.log(1/3)
                ml_confidence = 1 - (ml_entropy / max_ent)
                
                # ML weight: 50-70% based on ML confidence
                ml_weight = 0.50 + ml_confidence * 0.20
                poisson_weight = 1.0 - ml_weight
                
                poisson_probs = [
                    poisson_pred["outcome"]["home_win"],
                    poisson_pred["outcome"]["draw"],
                    poisson_pred["outcome"]["away_win"]
                ]
                
                blended = [
                    ml_weight * ml_probs[i] + poisson_weight * poisson_probs[i]
                    for i in range(3)
                ]
                
                # Normalize
                total = sum(blended)
                poisson_pred["outcome"]["home_win"] = round(blended[0] / total, 4)
                poisson_pred["outcome"]["draw"] = round(blended[1] / total, 4)
                poisson_pred["outcome"]["away_win"] = round(blended[2] / total, 4)
                
            except Exception:
                pass  # Fall back to Poisson-only
        
        # Calculate confidence
        probs = [
            poisson_pred["outcome"]["home_win"],
            poisson_pred["outcome"]["draw"],
            poisson_pred["outcome"]["away_win"]
        ]
        max_prob = max(probs)
        entropy = -sum(p * np.log(p + 1e-10) for p in probs)
        max_entropy = -3 * (1/3) * np.log(1/3)  # Entropy of uniform distribution
        confidence = 1 - (entropy / max_entropy)
        
        poisson_pred["outcome"]["confidence"] = round(confidence, 4)
        
        # Remove the matrix from output (too large for JSON)
        del poisson_pred["matrix"]
        
        return poisson_pred


# Monte Carlo simulation for more detailed scoreline predictions
def monte_carlo_simulation(
    home_xG: float,
    away_xG: float,
    n_simulations: int = 10000
) -> Dict:
    """
    Run Monte Carlo simulation for match outcome.
    
    Returns detailed statistics from simulated matches.
    """
    home_goals = np.random.poisson(home_xG, n_simulations)
    away_goals = np.random.poisson(away_xG, n_simulations)
    
    home_wins = np.sum(home_goals > away_goals)
    draws = np.sum(home_goals == away_goals)
    away_wins = np.sum(home_goals < away_goals)
    
    # Most common scorelines
    from collections import Counter
    scores = Counter(zip(home_goals, away_goals))
    most_common = scores.most_common(10)
    
    return {
        "n_simulations": n_simulations,
        "home_win_prob": home_wins / n_simulations,
        "draw_prob": draws / n_simulations,
        "away_win_prob": away_wins / n_simulations,
        "avg_home_goals": home_goals.mean(),
        "avg_away_goals": away_goals.mean(),
        "avg_total_goals": (home_goals + away_goals).mean(),
        "most_common_scores": [
            {"score": f"{s[0]}-{s[1]}", "count": c, "probability": c / n_simulations}
            for (s, c) in most_common
        ],
        "over_2_5_prob": np.sum(home_goals + away_goals > 2.5) / n_simulations,
        "btts_prob": np.sum((home_goals > 0) & (away_goals > 0)) / n_simulations,
    }


# ══════════════════════════════════════════════════════════════════════
# Per-League Model Manager
# ══════════════════════════════════════════════════════════════════════

class LeagueModelManager:
    """
    Manages per-league HybridPredictionModel instances.
    
    Each league gets its own model with calibrated parameters:
    - League-specific average goals, home advantage, draw rate, Dixon-Coles rho
    - League-specific ML model once trained
    - Maintains a performance profile per league for continuous improvement
    """
    
    def __init__(self):
        self._models: Dict[str, HybridPredictionModel] = {}
        self._performance: Dict[str, Dict] = {}  # league -> {predictions, correct, brier_sum}
    
    def get_model(self, league: str) -> HybridPredictionModel:
        """Get or create the model for a specific league."""
        if league not in self._models:
            params = LEAGUE_PARAMS.get(league, DEFAULT_PARAMS)
            self._models[league] = HybridPredictionModel(
                league_avg_goals=params["avg_goals"],
                home_advantage=params["home_adv"],
                rho=params["rho"],
                league=league,
            )
            self._performance[league] = {
                "predictions": 0, "correct": 0, "brier_sum": 0.0,
            }
            logger.info(f"Created model for {league}: avg_goals={params['avg_goals']}, "
                       f"home_adv={params['home_adv']}, rho={params['rho']}")
        return self._models[league]
    
    def predict(
        self,
        league: str,
        home_elo: float,
        away_elo: float,
        home_goals_pg: float,
        home_conceded_pg: float,
        away_goals_pg: float,
        away_conceded_pg: float,
        **kwargs,
    ) -> Dict:
        """Predict using the league-specific model."""
        model = self.get_model(league)
        return model.predict(
            home_elo, away_elo,
            home_goals_pg, home_conceded_pg,
            away_goals_pg, away_conceded_pg,
            league=league,
            **kwargs,
        )
    
    def record_outcome(
        self,
        league: str,
        predicted_probs: Tuple[float, float, float],
        actual_outcome: str,
    ):
        """
        Record a match outcome for model performance tracking.
        
        Args:
            league: League key
            predicted_probs: (home_win, draw, away_win) probabilities
            actual_outcome: "home", "draw", or "away"
        """
        if league not in self._performance:
            self._performance[league] = {"predictions": 0, "correct": 0, "brier_sum": 0.0}
        
        perf = self._performance[league]
        perf["predictions"] += 1
        
        # Check if prediction was correct
        hw, dr, aw = predicted_probs
        predicted = "home" if hw >= dr and hw >= aw else ("draw" if dr >= aw else "away")
        if predicted == actual_outcome:
            perf["correct"] += 1
        
        # Brier score component
        actual_vec = [1.0 if actual_outcome == o else 0.0 for o in ("home", "draw", "away")]
        brier = sum((p - a) ** 2 for p, a in zip(predicted_probs, actual_vec))
        perf["brier_sum"] += brier
    
    def get_league_accuracy(self, league: str) -> Optional[Dict]:
        """Get accuracy metrics for a specific league."""
        perf = self._performance.get(league)
        if not perf or perf["predictions"] == 0:
            return None
        return {
            "league": league,
            "predictions": perf["predictions"],
            "accuracy": perf["correct"] / perf["predictions"],
            "brier_score": perf["brier_sum"] / perf["predictions"],
        }
    
    def get_all_accuracies(self) -> List[Dict]:
        """Get accuracy for all leagues."""
        return [
            self.get_league_accuracy(l)
            for l in self._performance
            if self._performance[l]["predictions"] > 0
        ]
    
    @property
    def leagues(self) -> List[str]:
        """Get all leagues with active models."""
        return list(self._models.keys())


# Module-level singleton
_league_manager: Optional[LeagueModelManager] = None

def get_league_model_manager() -> LeagueModelManager:
    """Get the singleton LeagueModelManager."""
    global _league_manager
    if _league_manager is None:
        _league_manager = LeagueModelManager()
    return _league_manager
