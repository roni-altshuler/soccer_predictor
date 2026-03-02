"""
Enhanced ELO rating system for football teams.
"""

from typing import Dict, Optional, Tuple
from datetime import datetime, timedelta
import math
import json
import os
import logging

logger = logging.getLogger(__name__)


class EloRatingSystem:
    """
    Enhanced ELO rating system for football teams.
    
    Features:
    - League-adjusted ratings for cross-league comparisons
    - Goal difference multiplier
    - Home advantage adjustment
    - Rating decay for inactive teams
    - Separate home/away ratings
    """
    
    # Base configuration
    DEFAULT_ELO = 1500.0
    K_FACTOR = 32.0
    HOME_ADVANTAGE = 65.0  # ELO points
    
    # League strength coefficients (relative to average)
    LEAGUE_COEFFICIENTS = {
        "Premier League": 1.15,
        "La Liga": 1.10,
        "Bundesliga": 1.05,
        "Serie A": 1.05,
        "Ligue 1": 1.00,
        "Eredivisie": 0.90,
        "Primeira Liga": 0.90,
        "MLS": 0.80,
        "Championship": 0.85,
        "Bundesliga 2": 0.75,
        # Default for unknown leagues
        "default": 0.85,
    }

    # League-specific draw rates (empirical averages from 5 seasons)
    LEAGUE_DRAW_RATES = {
        "Premier League": 0.23,
        "La Liga": 0.24,
        "Bundesliga": 0.22,
        "Serie A": 0.27,
        "Ligue 1": 0.24,
        "Eredivisie": 0.21,
        "Primeira Liga": 0.25,
        "MLS": 0.22,
        "Championship": 0.26,
        "Champions League": 0.20,
        "default": 0.24,
    }

    # League average goals per team per game
    LEAGUE_AVG_GOALS = {
        "Premier League": 1.42,
        "La Liga": 1.30,
        "Bundesliga": 1.55,
        "Serie A": 1.32,
        "Ligue 1": 1.30,
        "MLS": 1.45,
        "Champions League": 1.50,
        "default": 1.35,
    }
    
    def __init__(
        self,
        k_factor: float = 32.0,
        home_advantage: float = 65.0,
        ratings_file: Optional[str] = None
    ):
        self.k_factor = k_factor
        self.home_advantage = home_advantage
        self.ratings: Dict[str, Dict] = {}
        self.ratings_file = ratings_file
        
        if ratings_file and os.path.exists(ratings_file):
            self.load_ratings()
    
    def get_rating(self, team: str, league: Optional[str] = None) -> Dict:
        """
        Get team rating data.
        
        Returns dict with:
        - elo: Current ELO rating
        - home_elo: Home-specific rating
        - away_elo: Away-specific rating
        - matches: Total matches played
        - last_updated: Last rating update
        """
        if team not in self.ratings:
            self.ratings[team] = {
                "elo": self.DEFAULT_ELO,
                "home_elo": self.DEFAULT_ELO,
                "away_elo": self.DEFAULT_ELO,
                "matches": 0,
                "league": league,
                "last_updated": datetime.now().isoformat(),
            }
        return self.ratings[team]
    
    def get_elo(self, team: str) -> float:
        """Get team's current ELO rating."""
        return self.get_rating(team)["elo"]
    
    def set_elo(self, team: str, elo: float, league: Optional[str] = None):
        """Set team's ELO rating."""
        data = self.get_rating(team, league)
        data["elo"] = elo
        data["last_updated"] = datetime.now().isoformat()
        self.ratings[team] = data
    
    def expected_score(
        self,
        home_elo: float,
        away_elo: float,
        include_home_advantage: bool = True
    ) -> Tuple[float, float]:
        """
        Calculate expected match outcome probabilities.
        
        Uses logistic function similar to chess ELO.
        
        Returns:
            (home_expected, away_expected) - values between 0 and 1
        """
        if include_home_advantage:
            home_elo += self.home_advantage
        
        elo_diff = home_elo - away_elo
        
        home_expected = 1.0 / (1.0 + math.pow(10, -elo_diff / 400))
        away_expected = 1.0 - home_expected
        
        return home_expected, away_expected
    
    def goal_difference_multiplier(
        self,
        goal_diff: int,
        winner_elo: float,
        loser_elo: float
    ) -> float:
        """
        Calculate K-factor multiplier based on goal difference.
        
        Larger victories result in larger rating changes.
        Upset victories (lower-rated team wins big) get extra boost.
        """
        abs_diff = abs(goal_diff)
        
        if abs_diff <= 1:
            multiplier = 1.0
        elif abs_diff == 2:
            multiplier = 1.5
        elif abs_diff == 3:
            multiplier = 1.75
        else:
            multiplier = 1.75 + (abs_diff - 3) * 0.125
        
        # Upset factor: bigger multiplier for upsets
        if loser_elo > winner_elo:
            elo_diff = loser_elo - winner_elo
            upset_boost = 1.0 + min(0.3, elo_diff / 500)
            multiplier *= upset_boost
        
        return multiplier
    
    def calculate_new_ratings(
        self,
        home_team: str,
        away_team: str,
        home_goals: int,
        away_goals: int,
        league: Optional[str] = None,
        match_importance: float = 1.0
    ) -> Tuple[float, float]:
        """
        Calculate new ELO ratings after a match.
        
        Args:
            home_team: Home team name
            away_team: Away team name
            home_goals: Goals scored by home team
            away_goals: Goals scored by away team
            league: League name (for coefficient adjustment)
            match_importance: Match importance factor (1.0 = normal)
        
        Returns:
            (new_home_elo, new_away_elo)
        """
        home_data = self.get_rating(home_team, league)
        away_data = self.get_rating(away_team, league)
        
        home_elo = home_data["elo"]
        away_elo = away_data["elo"]
        
        # Calculate expected scores
        home_expected, away_expected = self.expected_score(home_elo, away_elo)
        
        # Calculate actual scores (1 = win, 0.5 = draw, 0 = loss)
        if home_goals > away_goals:
            home_actual = 1.0
            away_actual = 0.0
            goal_diff = home_goals - away_goals
            gd_mult = self.goal_difference_multiplier(goal_diff, home_elo, away_elo)
        elif home_goals < away_goals:
            home_actual = 0.0
            away_actual = 1.0
            goal_diff = away_goals - home_goals
            gd_mult = self.goal_difference_multiplier(goal_diff, away_elo, home_elo)
        else:
            home_actual = 0.5
            away_actual = 0.5
            gd_mult = 1.0
        
        # Apply league coefficient
        league_coef = self.LEAGUE_COEFFICIENTS.get(
            league, 
            self.LEAGUE_COEFFICIENTS["default"]
        )
        
        # Calculate rating changes
        k = self.k_factor * gd_mult * match_importance * league_coef
        
        home_change = k * (home_actual - home_expected)
        away_change = k * (away_actual - away_expected)
        
        new_home_elo = home_elo + home_change
        new_away_elo = away_elo + away_change
        
        # Update ratings
        home_data["elo"] = new_home_elo
        home_data["matches"] += 1
        home_data["last_updated"] = datetime.now().isoformat()
        
        away_data["elo"] = new_away_elo
        away_data["matches"] += 1
        away_data["last_updated"] = datetime.now().isoformat()
        
        # Update home/away specific ratings
        home_data["home_elo"] = 0.7 * home_data.get("home_elo", self.DEFAULT_ELO) + 0.3 * new_home_elo
        away_data["away_elo"] = 0.7 * away_data.get("away_elo", self.DEFAULT_ELO) + 0.3 * new_away_elo
        
        self.ratings[home_team] = home_data
        self.ratings[away_team] = away_data
        
        return new_home_elo, new_away_elo
    
    def predict_outcome(
        self,
        home_team: str,
        away_team: str,
        league: Optional[str] = None,
        use_venue_elo: bool = True,
    ) -> Dict[str, float]:
        """
        Predict match outcome probabilities based on ELO.
        
        Uses league-specific draw rates and optionally home/away ELO.

        Returns:
            {
                "home_win": probability,
                "draw": probability,
                "away_win": probability
            }
        """
        home_data = self.get_rating(home_team, league)
        away_data = self.get_rating(away_team, league)
        
        # Use blended venue-specific ELO when available
        if use_venue_elo and home_data.get("matches", 0) >= 5:
            base_home = 0.7 * home_data["elo"] + 0.3 * home_data.get("home_elo", home_data["elo"])
        else:
            base_home = home_data["elo"]
        
        if use_venue_elo and away_data.get("matches", 0) >= 5:
            base_away = 0.7 * away_data["elo"] + 0.3 * away_data.get("away_elo", away_data["elo"])
        else:
            base_away = away_data["elo"]
        
        home_elo = base_home + self.home_advantage
        away_elo = base_away
        elo_diff = home_elo - away_elo
        
        # League-specific base draw rate
        draw_rate = self.LEAGUE_DRAW_RATES.get(
            league, self.LEAGUE_DRAW_RATES["default"]
        )
        
        # Draw probability: base rate adjusted by ELO closeness
        # Closer ELO -> higher draw prob; big gap -> lower draw prob
        elo_closeness = math.exp(-(elo_diff ** 2) / (2 * 250 ** 2))
        draw = draw_rate * (0.6 + 0.8 * elo_closeness)
        draw = max(0.08, min(0.38, draw))
        
        # Win probabilities from logistic model
        win_pool = 1.0 - draw
        home_win_raw = 1.0 / (1.0 + math.pow(10, -elo_diff / 400))
        
        home_win = win_pool * home_win_raw
        away_win = win_pool * (1.0 - home_win_raw)
        
        # Normalize to ensure exact sum = 1.0
        total = home_win + draw + away_win
        
        return {
            "home_win": round(home_win / total, 4),
            "draw": round(draw / total, 4),
            "away_win": round(away_win / total, 4),
        }
    
    def apply_rating_decay(self, days_inactive: int = 180):
        """
        Apply rating decay to teams that haven't played recently.
        
        Moves inactive teams' ratings toward the default.
        """
        now = datetime.now()
        decay_rate = 0.05  # 5% decay toward default
        
        for team, data in self.ratings.items():
            last_updated = datetime.fromisoformat(data["last_updated"])
            days_since = (now - last_updated).days
            
            if days_since > days_inactive:
                current_elo = data["elo"]
                decay_amount = (current_elo - self.DEFAULT_ELO) * decay_rate
                data["elo"] = current_elo - decay_amount
                logger.debug(f"Applied decay to {team}: {current_elo:.0f} -> {data['elo']:.0f}")
    
    def get_rankings(self, top_n: Optional[int] = None) -> list:
        """Get teams ranked by ELO rating."""
        ranked = sorted(
            [
                {"team": team, **data}
                for team, data in self.ratings.items()
            ],
            key=lambda x: x["elo"],
            reverse=True
        )
        
        if top_n:
            return ranked[:top_n]
        return ranked
    
    def save_ratings(self):
        """Save ratings to file."""
        if self.ratings_file:
            with open(self.ratings_file, 'w') as f:
                json.dump(self.ratings, f, indent=2)
            logger.info(f"Saved {len(self.ratings)} team ratings")
    
    def load_ratings(self):
        """Load ratings from file."""
        if self.ratings_file and os.path.exists(self.ratings_file):
            with open(self.ratings_file, 'r') as f:
                self.ratings = json.load(f)
            logger.info(f"Loaded {len(self.ratings)} team ratings")
    
    def get_league_adjusted_elo(self, team: str, from_league: str, to_league: str) -> float:
        """
        Adjust a team's ELO for cross-league comparison.
        
        Example: Adjust a Ligue 1 team's rating when playing in Champions League.
        """
        raw_elo = self.get_elo(team)
        
        from_coef = self.LEAGUE_COEFFICIENTS.get(from_league, self.LEAGUE_COEFFICIENTS["default"])
        to_coef = self.LEAGUE_COEFFICIENTS.get(to_league, self.LEAGUE_COEFFICIENTS["default"])
        
        # Adjust the ELO based on league strength difference
        adjustment = (from_coef / to_coef - 1) * 100
        
        return raw_elo + adjustment


# Pre-seeded ELO ratings for major teams (based on historical performance)
PREMIER_LEAGUE_RATINGS = {
    "Manchester City": 1950,
    "Arsenal": 1920,
    "Liverpool": 1910,
    "Chelsea": 1850,
    "Manchester United": 1830,
    "Tottenham Hotspur": 1800,
    "Tottenham": 1800,
    "Newcastle United": 1780,
    "Brighton & Hove Albion": 1750,
    "Brighton": 1750,
    "Aston Villa": 1740,
    "West Ham United": 1720,
    "West Ham": 1720,
    "Brentford": 1700,
    "Crystal Palace": 1690,
    "Fulham": 1680,
    "Wolverhampton Wanderers": 1670,
    "Wolves": 1670,
    "Bournemouth": 1660,
    "Nottingham Forest": 1650,
    "Everton": 1640,
    "Luton Town": 1580,
    "Burnley": 1570,
    "Sheffield United": 1560,
    "Leeds United": 1620,
    "Leicester City": 1680,
    "Southampton": 1600,
    "Ipswich Town": 1580,
    "Sunderland": 1590,
}

LA_LIGA_RATINGS = {
    "Real Madrid": 1970,
    "Barcelona": 1940,
    "Atletico Madrid": 1850,
    "Real Sociedad": 1780,
    "Athletic Bilbao": 1760,
    "Real Betis": 1740,
    "Villarreal": 1730,
    "Sevilla": 1720,
    "Valencia": 1700,
    "Girona": 1690,
}

BUNDESLIGA_RATINGS = {
    "Bayern Munich": 1960,
    "Borussia Dortmund": 1880,
    "RB Leipzig": 1840,
    "Bayer Leverkusen": 1850,
    "Eintracht Frankfurt": 1760,
}

SERIE_A_RATINGS = {
    "Inter Milan": 1900,
    "Napoli": 1870,
    "AC Milan": 1850,
    "Juventus": 1840,
    "Atalanta": 1800,
    "Roma": 1780,
    "Lazio": 1760,
}

LIGUE_1_RATINGS = {
    "Paris Saint-Germain": 1920,
    "PSG": 1920,
    "Monaco": 1780,
    "Marseille": 1760,
    "Lyon": 1740,
    "Lille": 1720,
}

# Combine all ratings
ALL_TEAM_RATINGS = {
    **PREMIER_LEAGUE_RATINGS,
    **LA_LIGA_RATINGS,
    **BUNDESLIGA_RATINGS,
    **SERIE_A_RATINGS,
    **LIGUE_1_RATINGS,
}

# Singleton instance
_elo_system: Optional[EloRatingSystem] = None


def get_elo_system() -> EloRatingSystem:
    """Get or create ELO system singleton with pre-seeded ratings."""
    global _elo_system
    if _elo_system is None:
        _elo_system = EloRatingSystem()
        # Pre-seed ratings for known teams
        for team, rating in ALL_TEAM_RATINGS.items():
            _elo_system.set_elo(team, rating)
        logger.info(f"Initialized ELO system with {len(ALL_TEAM_RATINGS)} pre-seeded teams")
    return _elo_system
