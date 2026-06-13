"""
League Simulation Service for predicting final standings.

Uses Monte Carlo simulation to predict:
- League winner probabilities
- Final standings distributions
- Relegation/promotion probabilities
- Top 4/Europe race outcomes
"""

import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import Counter
import logging

from backend.services.ratings import get_elo_system
from backend.services.ratings.elo_goals import expected_goals as elo_expected_goals
from backend.services.prediction.probabilistic import PoissonModel

logger = logging.getLogger(__name__)


@dataclass
class SimulatedStanding:
    """Simulated final standing for a team."""
    team_name: str
    team_id: Optional[int] = None
    
    # Current stats
    current_position: int = 0
    current_points: int = 0
    current_played: int = 0
    current_gd: int = 0
    
    # Simulation results
    avg_final_position: float = 0.0
    avg_final_points: float = 0.0
    position_std: float = 0.0
    
    # Position probabilities
    title_probability: float = 0.0  # P(1st place)
    top_4_probability: float = 0.0  # P(Top 4)
    europa_probability: float = 0.0  # P(5-6 or 7 with cup)
    relegation_probability: float = 0.0  # P(Bottom 3)
    
    # Position distribution
    position_distribution: Dict[int, float] = field(default_factory=dict)


@dataclass
class LeagueSimulationResult:
    """Complete simulation result for a league."""
    league_key: str
    league_name: str
    
    # Simulation parameters
    n_simulations: int
    remaining_matches: int
    
    # Team standings
    standings: List[SimulatedStanding]
    
    # Most likely champion
    most_likely_champion: str
    champion_probability: float
    
    # Top 4 teams
    likely_top_4: List[str]
    
    # Relegation candidates
    relegation_candidates: List[str]


class LeagueSimulator:
    """
    Monte Carlo simulation for league standings prediction.
    
    Uses team ELO ratings and Poisson goal model to simulate
    remaining matches and predict final standings.
    """
    
    def __init__(
        self,
        n_simulations: int = 10000,
        home_advantage: float = 0.25,
    ):
        self.n_simulations = n_simulations
        self.home_advantage = home_advantage
        self.poisson = PoissonModel()
        self.elo = get_elo_system()
    
    def _simulate_match(
        self,
        home_team: str,
        away_team: str,
        home_elo: float,
        away_elo: float,
    ) -> Tuple[int, int]:
        """
        Simulate a single match and return goal scores.
        
        Uses Poisson distribution with ELO-adjusted expected goals.
        """
        # Calibrated Elo->xG coupling shared across all simulators.
        home_xG, away_xG = elo_expected_goals(
            home_elo, away_elo, avg_goals=1.35, home_adv=self.home_advantage,
            home_clamp=(0.5, 4.0), away_clamp=(0.3, 3.5),
        )
        
        # Simulate goals using Poisson distribution
        home_goals = np.random.poisson(home_xG)
        away_goals = np.random.poisson(away_xG)
        
        return home_goals, away_goals
    
    def _calculate_points(
        self,
        home_goals: int,
        away_goals: int
    ) -> Tuple[int, int]:
        """Calculate points for home and away teams."""
        if home_goals > away_goals:
            return 3, 0
        elif home_goals < away_goals:
            return 0, 3
        else:
            return 1, 1
    
    def simulate_league(
        self,
        current_standings: List[Dict],
        remaining_fixtures: List[Dict],
        league_key: str,
        league_name: str,
    ) -> LeagueSimulationResult:
        """
        Run Monte Carlo simulation for a league.
        
        Args:
            current_standings: Current standings with team stats
            remaining_fixtures: List of remaining matches
            league_key: League identifier
            league_name: Display name
        
        Returns:
            Complete simulation results
        """
        if not current_standings:
            logger.warning(f"No standings data for {league_key}")
            return self._empty_result(league_key, league_name)
        
        n_teams = len(current_standings)
        
        # Initialize tracking for each team
        team_data = {}
        for row in current_standings:
            team_name = row.get("name") or row.get("team_name", "Unknown")
            team_data[team_name] = {
                "id": row.get("id") or row.get("team_id"),
                "position": row.get("idx") or row.get("position", 0),
                "points": row.get("pts") or row.get("points", 0),
                "played": row.get("played", 0),
                "gd": row.get("goalConDiff") or row.get("goal_diff", 0),
                "final_positions": [],
                "final_points": [],
            }
        
        # Get ELO ratings
        for team_name in team_data:
            team_data[team_name]["elo"] = self.elo.get_elo(team_name)
        
        # Run simulations
        for sim in range(self.n_simulations):
            # Copy current points for this simulation
            sim_points = {
                team: data["points"]
                for team, data in team_data.items()
            }
            sim_gd = {
                team: data["gd"]
                for team, data in team_data.items()
            }
            
            # Simulate remaining matches
            for fixture in remaining_fixtures:
                home_team = fixture.get("home_team") or fixture.get("home", {}).get("name")
                away_team = fixture.get("away_team") or fixture.get("away", {}).get("name")
                
                if not home_team or not away_team:
                    continue
                
                if home_team not in team_data or away_team not in team_data:
                    continue
                
                home_elo = team_data[home_team]["elo"]
                away_elo = team_data[away_team]["elo"]
                
                # Simulate match
                home_goals, away_goals = self._simulate_match(
                    home_team, away_team, home_elo, away_elo
                )
                
                # Update points
                home_pts, away_pts = self._calculate_points(home_goals, away_goals)
                sim_points[home_team] += home_pts
                sim_points[away_team] += away_pts
                
                # Update goal difference
                sim_gd[home_team] += home_goals - away_goals
                sim_gd[away_team] += away_goals - home_goals
            
            # Calculate final positions for this simulation
            # Sort by points, then goal difference
            sorted_teams = sorted(
                sim_points.keys(),
                key=lambda t: (sim_points[t], sim_gd[t]),
                reverse=True
            )
            
            # Record final positions
            for pos, team in enumerate(sorted_teams, 1):
                team_data[team]["final_positions"].append(pos)
                team_data[team]["final_points"].append(sim_points[team])
        
        # Calculate statistics
        standings = []
        for team_name, data in team_data.items():
            positions = data["final_positions"]
            points = data["final_points"]
            
            if not positions:
                continue
            
            position_counts = Counter(positions)
            total = len(positions)
            
            # Position distribution
            position_dist = {
                pos: count / total
                for pos, count in position_counts.items()
            }
            
            # Key probabilities
            title_prob = position_dist.get(1, 0.0)
            top_4_prob = sum(position_dist.get(i, 0.0) for i in range(1, 5))
            europa_prob = sum(position_dist.get(i, 0.0) for i in range(5, 8))
            relegation_prob = sum(
                position_dist.get(i, 0.0)
                for i in range(n_teams - 2, n_teams + 1)
            )
            
            standing = SimulatedStanding(
                team_name=team_name,
                team_id=data["id"],
                current_position=data["position"],
                current_points=data["points"],
                current_played=data["played"],
                current_gd=data["gd"],
                avg_final_position=np.mean(positions),
                avg_final_points=np.mean(points),
                position_std=np.std(positions),
                title_probability=round(title_prob, 4),
                top_4_probability=round(top_4_prob, 4),
                europa_probability=round(europa_prob, 4),
                relegation_probability=round(relegation_prob, 4),
                position_distribution={
                    pos: round(prob, 4)
                    for pos, prob in sorted(position_dist.items())
                },
            )
            standings.append(standing)
        
        # Sort by expected final position
        standings.sort(key=lambda s: s.avg_final_position)
        
        # Find most likely champion
        champion = max(standings, key=lambda s: s.title_probability)
        
        # Top 4 candidates
        top_4 = sorted(standings, key=lambda s: s.top_4_probability, reverse=True)[:6]
        
        # Relegation candidates
        relegation = sorted(
            standings,
            key=lambda s: s.relegation_probability,
            reverse=True
        )[:5]
        
        return LeagueSimulationResult(
            league_key=league_key,
            league_name=league_name,
            n_simulations=self.n_simulations,
            remaining_matches=len(remaining_fixtures),
            standings=standings,
            most_likely_champion=champion.team_name,
            champion_probability=champion.title_probability,
            likely_top_4=[s.team_name for s in top_4[:4]],
            relegation_candidates=[s.team_name for s in relegation[:3]],
        )
    
    def _empty_result(self, league_key: str, league_name: str) -> LeagueSimulationResult:
        """Return empty result when simulation cannot run."""
        return LeagueSimulationResult(
            league_key=league_key,
            league_name=league_name,
            n_simulations=0,
            remaining_matches=0,
            standings=[],
            most_likely_champion="Unknown",
            champion_probability=0.0,
            likely_top_4=[],
            relegation_candidates=[],
        )
    
    def predict_title_race(
        self,
        current_standings: List[Dict],
        remaining_fixtures: List[Dict],
    ) -> Dict[str, float]:
        """
        Quick prediction for title race only.
        
        Returns dict of team -> title probability.
        """
        result = self.simulate_league(
            current_standings,
            remaining_fixtures,
            "unknown",
            "Unknown"
        )
        
        return {
            s.team_name: s.title_probability
            for s in result.standings
        }


# Singleton instance
_simulator: Optional[LeagueSimulator] = None


def get_league_simulator() -> LeagueSimulator:
    """Get or create league simulator singleton."""
    global _simulator
    if _simulator is None:
        _simulator = LeagueSimulator()
    return _simulator
