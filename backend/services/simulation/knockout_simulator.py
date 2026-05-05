"""
Knockout Tournament Simulation Service.

Implements dynamic Monte Carlo simulation for knockout tournaments:
- UEFA Champions League
- UEFA Europa League
- FIFA World Cup

Uses research-based approaches for modeling tournament outcomes,
including bracket position considerations and path dependencies.

References:
- Csató, L. (2020). "Tournament design: How operations research can improve sports rules"
- Berrar, D. et al. (2019). "Incorporating domain knowledge in machine learning for soccer outcome prediction"
- Hubáček, O. et al. (2019). "Exploiting sports-betting market using machine learning"
"""

import numpy as np
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from collections import Counter, defaultdict
import logging
import random

from backend.services.ratings import get_elo_system
from backend.services.prediction.probabilistic import PoissonModel

logger = logging.getLogger(__name__)


@dataclass
class KnockoutTeam:
    """Team in a knockout tournament."""
    name: str
    team_id: Optional[int] = None
    elo: float = 1500.0
    group_position: int = 1  # 1 = group winner, 2 = runner-up
    group: str = ""
    country: str = ""
    coefficient: float = 0.0  # UEFA coefficient or FIFA ranking


@dataclass
class KnockoutMatch:
    """A knockout stage match."""
    round_name: str  # "Round of 16", "Quarter-Final", etc.
    home_team: str
    away_team: str
    leg: int = 1  # 1 or 2 for two-legged ties
    is_neutral: bool = False  # Finals are often neutral


@dataclass
class TournamentSimulationResult:
    """Result of tournament simulation."""
    tournament_name: str
    n_simulations: int
    
    # Winner probabilities
    winner_probabilities: Dict[str, float] = field(default_factory=dict)
    
    # Round-by-round probabilities
    semi_final_probabilities: Dict[str, float] = field(default_factory=dict)
    final_probabilities: Dict[str, float] = field(default_factory=dict)
    
    # Most likely winner
    most_likely_winner: str = ""
    winner_probability: float = 0.0
    
    # Bracket predictions (if bracket is set)
    bracket_predictions: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    
    # Path analysis
    easiest_path_team: str = ""
    hardest_path_team: str = ""


class KnockoutSimulator:
    """
    Monte Carlo simulation for knockout tournaments.
    
    Implements dynamic simulation considering:
    - Team ELO ratings
    - Home/away advantages in two-legged ties
    - Path dependencies (easier/harder bracket sides)
    - Tournament-specific rules (away goals, extra time, etc.)
    
    Research basis:
    - Uses Bradley-Terry model variant for match probabilities
    - Poisson distribution for goal simulation
    - Path-dependent probability calculations
    """
    
    def __init__(
        self,
        n_simulations: int = 10000,
        home_advantage: float = 0.3,
    ):
        self.n_simulations = n_simulations
        self.home_advantage = home_advantage
        self.poisson = PoissonModel()
        self.elo = get_elo_system()
    
    def _calculate_win_probability(
        self,
        team_elo: float,
        opponent_elo: float,
        is_home: bool = True,
        is_neutral: bool = False,
    ) -> float:
        """
        Calculate single match win probability using Bradley-Terry model.
        
        Based on Elo rating difference with home advantage adjustment.
        """
        if is_neutral:
            home_bonus = 0
        elif is_home:
            home_bonus = self.home_advantage * 100  # Convert to Elo points
        else:
            home_bonus = -self.home_advantage * 100
        
        adjusted_diff = (team_elo - opponent_elo + home_bonus) / 400
        expected = 1 / (1 + 10 ** (-adjusted_diff))
        
        return expected
    
    def _simulate_match(
        self,
        home_team: KnockoutTeam,
        away_team: KnockoutTeam,
        is_neutral: bool = False,
    ) -> Tuple[int, int]:
        """Simulate a single match and return goal scores."""
        # Calculate expected goals
        elo_diff = (home_team.elo - away_team.elo) / 400
        
        if is_neutral:
            home_xG = 1.35 * (1 + elo_diff * 0.25)
            away_xG = 1.35 * (1 - elo_diff * 0.25)
        else:
            home_xG = 1.35 * (1 + elo_diff * 0.25) + self.home_advantage
            away_xG = 1.35 * (1 - elo_diff * 0.25)
        
        # Clamp to reasonable range
        home_xG = max(0.5, min(3.5, home_xG))
        away_xG = max(0.3, min(3.0, away_xG))
        
        # Simulate goals
        home_goals = np.random.poisson(home_xG)
        away_goals = np.random.poisson(away_xG)
        
        return home_goals, away_goals
    
    def _simulate_two_legged_tie(
        self,
        team_a: KnockoutTeam,
        team_b: KnockoutTeam,
        use_away_goals: bool = False,  # Deprecated in UEFA
    ) -> KnockoutTeam:
        """
        Simulate a two-legged knockout tie.
        
        Returns the winner.
        """
        # First leg: team_a is home
        leg1_home, leg1_away = self._simulate_match(team_a, team_b)
        
        # Second leg: team_b is home
        leg2_home, leg2_away = self._simulate_match(team_b, team_a)
        
        # Aggregate score
        team_a_total = leg1_home + leg2_away
        team_b_total = leg1_away + leg2_home
        
        if team_a_total > team_b_total:
            return team_a
        elif team_b_total > team_a_total:
            return team_b
        else:
            # Tie on aggregate - go to extra time/penalties
            # Simplified: 50-50 with slight advantage to higher Elo
            tie_breaker = self._calculate_win_probability(
                team_a.elo, team_b.elo, is_home=False, is_neutral=True
            )
            return team_a if random.random() < tie_breaker else team_b
    
    def _simulate_single_match(
        self,
        team_a: KnockoutTeam,
        team_b: KnockoutTeam,
        is_neutral: bool = True,
    ) -> KnockoutTeam:
        """Simulate a single knockout match (like a final)."""
        goals_a, goals_b = self._simulate_match(team_a, team_b, is_neutral=is_neutral)
        
        if goals_a > goals_b:
            return team_a
        elif goals_b > goals_a:
            return team_b
        else:
            # Draw - extra time/penalties
            tie_breaker = self._calculate_win_probability(
                team_a.elo, team_b.elo, is_home=False, is_neutral=True
            )
            return team_a if random.random() < tie_breaker else team_b
    
    def simulate_champions_league(
        self,
        teams: List[KnockoutTeam],
        bracket: Optional[Dict[str, List[Tuple[str, str]]]] = None,
    ) -> TournamentSimulationResult:
        """
        Simulate Champions League knockout stages.
        
        Args:
            teams: List of 16 teams in knockout stage
            bracket: Optional pre-defined bracket
        
        Returns:
            TournamentSimulationResult with probabilities
        """
        if len(teams) == 4:
            return self._simulate_champions_league_semifinals(teams)

        if len(teams) != 16:
            raise ValueError("Champions League knockout requires exactly 16 teams, or 4 teams for the current semi-final stage")
        
        # Create team lookup
        team_lookup = {t.name: t for t in teams}
        
        # Track results
        winner_counts: Counter = Counter()
        semi_counts: Counter = Counter()
        final_counts: Counter = Counter()
        
        for _ in range(self.n_simulations):
            # Round of 16
            if bracket and "round_of_16" in bracket:
                r16_matches = bracket["round_of_16"]
            else:
                # Generate random bracket
                r16_matches = self._generate_cl_bracket(teams)
            
            qf_teams = []
            for team_a_name, team_b_name in r16_matches:
                team_a = team_lookup[team_a_name]
                team_b = team_lookup[team_b_name]
                winner = self._simulate_two_legged_tie(team_a, team_b)
                qf_teams.append(winner)
            
            # Quarter-finals
            sf_teams = []
            for i in range(0, 8, 2):
                if i + 1 < len(qf_teams):
                    winner = self._simulate_two_legged_tie(qf_teams[i], qf_teams[i + 1])
                    sf_teams.append(winner)
                    semi_counts[winner.name] += 1
            
            # Semi-finals
            final_teams = []
            for i in range(0, 4, 2):
                if i + 1 < len(sf_teams):
                    winner = self._simulate_two_legged_tie(sf_teams[i], sf_teams[i + 1])
                    final_teams.append(winner)
                    final_counts[winner.name] += 1
            
            # Final (neutral venue, single match)
            if len(final_teams) == 2:
                champion = self._simulate_single_match(
                    final_teams[0], final_teams[1], is_neutral=True
                )
                winner_counts[champion.name] += 1
        
        # Calculate probabilities
        total = self.n_simulations
        winner_probs = {team: count / total for team, count in winner_counts.most_common()}
        semi_probs = {team: count / total for team, count in semi_counts.most_common()}
        final_probs = {team: count / total for team, count in final_counts.most_common()}
        
        most_likely = winner_counts.most_common(1)[0] if winner_counts else ("Unknown", 0)
        
        return TournamentSimulationResult(
            tournament_name="UEFA Champions League",
            n_simulations=self.n_simulations,
            winner_probabilities=winner_probs,
            semi_final_probabilities=semi_probs,
            final_probabilities=final_probs,
            most_likely_winner=most_likely[0],
            winner_probability=most_likely[1] / total if total > 0 else 0,
        )

    def _simulate_champions_league_semifinals(
        self,
        teams: List[KnockoutTeam],
    ) -> TournamentSimulationResult:
        """Simulate the current Champions League semi-final bracket."""
        winner_counts: Counter = Counter()
        final_counts: Counter = Counter()
        semi_counts: Counter = Counter({team.name: self.n_simulations for team in teams})

        for _ in range(self.n_simulations):
            finalist_a = self._simulate_two_legged_tie(teams[0], teams[1])
            finalist_b = self._simulate_two_legged_tie(teams[2], teams[3])
            final_counts[finalist_a.name] += 1
            final_counts[finalist_b.name] += 1

            champion = self._simulate_single_match(finalist_a, finalist_b, is_neutral=True)
            winner_counts[champion.name] += 1

        total = self.n_simulations
        winner_probs = {team: count / total for team, count in winner_counts.most_common()}
        final_probs = {team: count / total for team, count in final_counts.most_common()}
        semi_probs = {team: count / total for team, count in semi_counts.most_common()}
        most_likely = winner_counts.most_common(1)[0] if winner_counts else ("Unknown", 0)

        return TournamentSimulationResult(
            tournament_name="UEFA Champions League",
            n_simulations=self.n_simulations,
            winner_probabilities=winner_probs,
            semi_final_probabilities=semi_probs,
            final_probabilities=final_probs,
            most_likely_winner=most_likely[0],
            winner_probability=most_likely[1] / total if total > 0 else 0,
            bracket_predictions={
                "current_round": "Semi-finals",
                "ties": [
                    {"home_team": teams[0].name, "away_team": teams[1].name},
                    {"home_team": teams[2].name, "away_team": teams[3].name},
                ],
            },
        )
    
    def simulate_europa_league(
        self,
        teams: List[KnockoutTeam],
        bracket: Optional[Dict[str, List[Tuple[str, str]]]] = None,
    ) -> TournamentSimulationResult:
        """Simulate Europa League knockout stages."""
        # Similar structure to Champions League
        if len(teams) < 8:
            raise ValueError("Europa League knockout requires at least 8 teams")
        
        team_lookup = {t.name: t for t in teams}
        
        winner_counts: Counter = Counter()
        semi_counts: Counter = Counter()
        final_counts: Counter = Counter()
        
        for _ in range(self.n_simulations):
            remaining_teams = list(teams)
            
            # Simulate rounds until we have a winner
            while len(remaining_teams) > 1:
                next_round = []
                random.shuffle(remaining_teams)
                
                for i in range(0, len(remaining_teams), 2):
                    if i + 1 < len(remaining_teams):
                        # Two-legged tie until final
                        if len(remaining_teams) > 2:
                            winner = self._simulate_two_legged_tie(
                                remaining_teams[i], remaining_teams[i + 1]
                            )
                        else:
                            # Final is single match
                            winner = self._simulate_single_match(
                                remaining_teams[i], remaining_teams[i + 1], is_neutral=True
                            )
                        next_round.append(winner)
                        
                        # Track semi/final counts
                        if len(remaining_teams) == 4:
                            semi_counts[remaining_teams[i].name] += 1
                            semi_counts[remaining_teams[i + 1].name] += 1
                        elif len(remaining_teams) == 2:
                            final_counts[remaining_teams[i].name] += 1
                            final_counts[remaining_teams[i + 1].name] += 1
                
                remaining_teams = next_round
            
            if remaining_teams:
                winner_counts[remaining_teams[0].name] += 1
        
        total = self.n_simulations
        winner_probs = {team: count / total for team, count in winner_counts.most_common()}
        
        most_likely = winner_counts.most_common(1)[0] if winner_counts else ("Unknown", 0)
        
        return TournamentSimulationResult(
            tournament_name="UEFA Europa League",
            n_simulations=self.n_simulations,
            winner_probabilities=winner_probs,
            semi_final_probabilities={t: c / total for t, c in semi_counts.most_common()},
            final_probabilities={t: c / total for t, c in final_counts.most_common()},
            most_likely_winner=most_likely[0],
            winner_probability=most_likely[1] / total if total > 0 else 0,
        )
    
    def simulate_world_cup(
        self,
        teams: List[KnockoutTeam],
        bracket: Optional[Dict[str, List[Tuple[str, str]]]] = None,
    ) -> TournamentSimulationResult:
        """
        Simulate FIFA World Cup knockout stages.
        
        World Cup uses single matches with extra time and penalties,
        all played at neutral venues.
        """
        if len(teams) != 16:
            raise ValueError("World Cup knockout requires exactly 16 teams")
        
        team_lookup = {t.name: t for t in teams}
        
        winner_counts: Counter = Counter()
        semi_counts: Counter = Counter()
        final_counts: Counter = Counter()
        third_place_counts: Counter = Counter()
        
        for _ in range(self.n_simulations):
            remaining_teams = list(teams)
            
            # Round of 16
            r16_winners = []
            for i in range(0, 16, 2):
                winner = self._simulate_single_match(
                    remaining_teams[i], remaining_teams[i + 1], is_neutral=True
                )
                r16_winners.append(winner)
            
            # Quarter-finals
            qf_winners = []
            for i in range(0, 8, 2):
                winner = self._simulate_single_match(
                    r16_winners[i], r16_winners[i + 1], is_neutral=True
                )
                qf_winners.append(winner)
            
            # Semi-finals
            sf_teams = qf_winners
            for team in sf_teams:
                semi_counts[team.name] += 1
            
            sf_winners = []
            sf_losers = []
            for i in range(0, 4, 2):
                winner = self._simulate_single_match(
                    sf_teams[i], sf_teams[i + 1], is_neutral=True
                )
                loser = sf_teams[i] if winner == sf_teams[i + 1] else sf_teams[i + 1]
                sf_winners.append(winner)
                sf_losers.append(loser)
            
            # Third place match
            third_place_winner = self._simulate_single_match(
                sf_losers[0], sf_losers[1], is_neutral=True
            )
            third_place_counts[third_place_winner.name] += 1
            
            # Final
            for team in sf_winners:
                final_counts[team.name] += 1
            
            champion = self._simulate_single_match(
                sf_winners[0], sf_winners[1], is_neutral=True
            )
            winner_counts[champion.name] += 1
        
        total = self.n_simulations
        winner_probs = {team: count / total for team, count in winner_counts.most_common()}
        
        most_likely = winner_counts.most_common(1)[0] if winner_counts else ("Unknown", 0)
        
        return TournamentSimulationResult(
            tournament_name="FIFA World Cup",
            n_simulations=self.n_simulations,
            winner_probabilities=winner_probs,
            semi_final_probabilities={t: c / total for t, c in semi_counts.most_common()},
            final_probabilities={t: c / total for t, c in final_counts.most_common()},
            most_likely_winner=most_likely[0],
            winner_probability=most_likely[1] / total if total > 0 else 0,
        )
    
    def _generate_cl_bracket(
        self,
        teams: List[KnockoutTeam]
    ) -> List[Tuple[str, str]]:
        """
        Generate a valid Champions League R16 bracket.
        
        Rules:
        - Group winners play group runners-up
        - Teams from same group cannot meet
        - Teams from same country cannot meet (in R16)
        """
        group_winners = [t for t in teams if t.group_position == 1]
        runners_up = [t for t in teams if t.group_position == 2]
        
        # Shuffle to randomize
        random.shuffle(group_winners)
        random.shuffle(runners_up)
        
        matches = []
        used_runners = set()
        
        for winner in group_winners:
            for runner in runners_up:
                if runner.name in used_runners:
                    continue
                if runner.group == winner.group:
                    continue
                if runner.country == winner.country and runner.country:
                    continue
                matches.append((winner.name, runner.name))
                used_runners.add(runner.name)
                break
        
        return matches
    
    def calculate_path_difficulty(
        self,
        team: KnockoutTeam,
        bracket: Dict[str, List[Tuple[str, str]]],
        team_lookup: Dict[str, KnockoutTeam],
    ) -> float:
        """
        Calculate the difficulty of a team's bracket path.
        
        Higher value = harder path (facing stronger opponents).
        """
        # Find team's side of the bracket
        # Sum expected Elo of potential opponents
        potential_opponents = []
        
        for match in bracket.get("round_of_16", []):
            if team.name in match:
                opponent_name = match[0] if match[1] == team.name else match[1]
                if opponent_name in team_lookup:
                    potential_opponents.append(team_lookup[opponent_name])
        
        if not potential_opponents:
            return 0.0
        
        avg_opponent_elo = np.mean([t.elo for t in potential_opponents])
        return avg_opponent_elo


# Singleton instance
_knockout_simulator: Optional[KnockoutSimulator] = None


def get_knockout_simulator() -> KnockoutSimulator:
    """Get or create knockout simulator singleton."""
    global _knockout_simulator
    if _knockout_simulator is None:
        _knockout_simulator = KnockoutSimulator()
    return _knockout_simulator
