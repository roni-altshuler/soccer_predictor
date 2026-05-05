"""
Knockout tournament simulation API endpoints.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel

from backend.services.simulation import (
    get_knockout_simulator,
    KnockoutTeam,
    TournamentSimulationResult,
)
from backend.services.ratings import get_elo_system

router = APIRouter(prefix="/knockout", tags=["knockout"])


class KnockoutTeamInput(BaseModel):
    """Input for a knockout team."""
    name: str
    team_id: Optional[int] = None
    elo: Optional[float] = None
    group_position: int = 1
    group: str = ""
    country: str = ""


class KnockoutSimulationRequest(BaseModel):
    """Request for knockout simulation."""
    tournament: str  # "champions_league", "europa_league", "world_cup"
    teams: List[KnockoutTeamInput]
    n_simulations: int = 10000


class KnockoutSimulationResponse(BaseModel):
    """Response from knockout simulation."""
    tournament: str
    n_simulations: int
    most_likely_winner: str
    winner_probability: float
    winner_probabilities: dict
    semi_final_probabilities: dict
    final_probabilities: dict


# Current 2025-26 Champions League state as of May 4, 2026:
# Semi-finals only: PSG vs Bayern Munich, Arsenal vs Atlético Madrid.
CL_TEAMS_2025_26 = [
    {"name": "Paris Saint-Germain", "elo": 1995, "group": "SF1", "group_position": 1, "country": "France"},
    {"name": "Bayern Munich", "elo": 2020, "group": "SF1", "group_position": 2, "country": "Germany"},
    {"name": "Arsenal", "elo": 2010, "group": "SF2", "group_position": 1, "country": "England"},
    {"name": "Atlético Madrid", "elo": 1945, "group": "SF2", "group_position": 2, "country": "Spain"},
]

# Default World Cup teams
WORLD_CUP_TEAMS = [
    {"name": "France", "elo": 2050, "group": "A", "group_position": 1, "country": "France"},
    {"name": "Brazil", "elo": 2000, "group": "B", "group_position": 1, "country": "Brazil"},
    {"name": "Argentina", "elo": 2080, "group": "C", "group_position": 1, "country": "Argentina"},
    {"name": "England", "elo": 1980, "group": "D", "group_position": 1, "country": "England"},
    {"name": "Germany", "elo": 1950, "group": "E", "group_position": 1, "country": "Germany"},
    {"name": "Spain", "elo": 2020, "group": "F", "group_position": 1, "country": "Spain"},
    {"name": "Netherlands", "elo": 1920, "group": "G", "group_position": 1, "country": "Netherlands"},
    {"name": "Portugal", "elo": 1960, "group": "H", "group_position": 1, "country": "Portugal"},
    {"name": "Denmark", "elo": 1850, "group": "A", "group_position": 2, "country": "Denmark"},
    {"name": "Belgium", "elo": 1900, "group": "B", "group_position": 2, "country": "Belgium"},
    {"name": "Croatia", "elo": 1880, "group": "C", "group_position": 2, "country": "Croatia"},
    {"name": "Italy", "elo": 1910, "group": "D", "group_position": 2, "country": "Italy"},
    {"name": "Uruguay", "elo": 1870, "group": "E", "group_position": 2, "country": "Uruguay"},
    {"name": "Japan", "elo": 1800, "group": "F", "group_position": 2, "country": "Japan"},
    {"name": "USA", "elo": 1820, "group": "G", "group_position": 2, "country": "USA"},
    {"name": "Switzerland", "elo": 1840, "group": "H", "group_position": 2, "country": "Switzerland"},
]


def _team_input_to_knockout_team(team: KnockoutTeamInput) -> KnockoutTeam:
    """Convert input to KnockoutTeam."""
    elo_system = get_elo_system()
    
    return KnockoutTeam(
        name=team.name,
        team_id=team.team_id,
        elo=team.elo or elo_system.get_elo(team.name),
        group_position=team.group_position,
        group=team.group,
        country=team.country,
    )


@router.post("/simulate", response_model=KnockoutSimulationResponse)
async def simulate_knockout(request: KnockoutSimulationRequest):
    """
    Run knockout tournament simulation.
    
    Simulates the tournament many times using Monte Carlo methods
    to calculate win probabilities for each team.
    """
    simulator = get_knockout_simulator()
    
    # Convert input teams to KnockoutTeam objects
    teams = [_team_input_to_knockout_team(t) for t in request.teams]
    
    tournament = request.tournament.lower().replace(" ", "_")
    
    try:
        if tournament in ["champions_league", "ucl"]:
            result = simulator.simulate_champions_league(teams)
        elif tournament in ["europa_league", "uel"]:
            result = simulator.simulate_europa_league(teams)
        elif tournament in ["world_cup", "fifa_world_cup"]:
            result = simulator.simulate_world_cup(teams)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown tournament: {request.tournament}. "
                       f"Supported: champions_league, europa_league, world_cup"
            )
        
        return KnockoutSimulationResponse(
            tournament=result.tournament_name,
            n_simulations=result.n_simulations,
            most_likely_winner=result.most_likely_winner,
            winner_probability=round(result.winner_probability, 4),
            winner_probabilities={k: round(v, 4) for k, v in result.winner_probabilities.items()},
            semi_final_probabilities={k: round(v, 4) for k, v in result.semi_final_probabilities.items()},
            final_probabilities={k: round(v, 4) for k, v in result.final_probabilities.items()},
        )
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


class TeamsListRequest(BaseModel):
    """Request body for custom teams list."""
    teams: List[str] = []


def _format_simulation_response(result) -> dict:
    """Format simulation result into API response."""
    return {
        "tournament": result.tournament_name,
        "n_simulations": result.n_simulations,
        "winner": {
            "team": result.most_likely_winner,
            "probability": round(result.winner_probability, 4)
        },
        "runner_up": {
            "team": list(result.winner_probabilities.keys())[1] if len(result.winner_probabilities) > 1 else "",
            "probability": round(list(result.winner_probabilities.values())[1], 4) if len(result.winner_probabilities) > 1 else 0
        },
        "round_probabilities": {
            "champion": [
                {"team": team, "probability": round(prob, 4)}
                for team, prob in sorted(result.winner_probabilities.items(), key=lambda x: -x[1])
            ],
            "final": [
                {"team": team, "probability": round(prob, 4)}
                for team, prob in sorted(result.final_probabilities.items(), key=lambda x: -x[1])
            ],
            "semi_finals": [
                {"team": team, "probability": round(prob, 4)}
                for team, prob in sorted(result.semi_final_probabilities.items(), key=lambda x: -x[1])
            ],
            "quarter_finals": [
                {"team": team, "probability": round(prob, 4)}
                for team, prob in sorted(getattr(result, 'quarter_final_probabilities', result.semi_final_probabilities).items(), key=lambda x: -x[1])
            ],
        }
    }


@router.post("/champions-league")
async def simulate_champions_league_post(
    body: Optional[TeamsListRequest] = None,
    n_simulations: int = Query(5000, ge=100, le=50000)
):
    """
    Simulate Champions League knockout stage with custom teams.
    """
    simulator = get_knockout_simulator()
    simulator.n_simulations = n_simulations
    
    # Use provided teams or defaults
    if body and body.teams:
        teams = [
            KnockoutTeam(name=name, elo=1800 + (100 * (16 - idx)) if idx < 16 else 1800)
            for idx, name in enumerate(body.teams)
        ]
    else:
        teams = [
            KnockoutTeam(
                name=t["name"],
                elo=t["elo"],
                group=t["group"],
                group_position=t["group_position"],
                country=t["country"],
            )
            for t in CL_TEAMS_2025_26
        ]
    
    result = simulator.simulate_champions_league(teams)
    return _format_simulation_response(result)


@router.get("/champions-league/simulate")
async def simulate_champions_league(
    n_simulations: int = Query(5000, ge=100, le=50000)
):
    """
    Simulate current Champions League knockout stage.
    
    Uses default teams for the current season.
    """
    simulator = get_knockout_simulator()
    simulator.n_simulations = n_simulations
    
    teams = [
        KnockoutTeam(
            name=t["name"],
            elo=t["elo"],
            group=t["group"],
            group_position=t["group_position"],
            country=t["country"],
        )
        for t in CL_TEAMS_2025_26
    ]
    
    result = simulator.simulate_champions_league(teams)
    
    return {
        "tournament": result.tournament_name,
        "n_simulations": result.n_simulations,
        "currentRound": "Semi-finals",
        "source": "UEFA/ESPN public schedule, verified 2026-05-04",
        "mostLikelyWinner": result.most_likely_winner,
        "winnerProbability": round(result.winner_probability, 4),
        "winnerProbabilities": [
            {"team": team, "probability": round(prob, 4)}
            for team, prob in sorted(result.winner_probabilities.items(), key=lambda x: -x[1])
        ],
        "semiFinalProbabilities": [
            {"team": team, "probability": round(prob, 4)}
            for team, prob in sorted(result.semi_final_probabilities.items(), key=lambda x: -x[1])
        ],
        "finalProbabilities": [
            {"team": team, "probability": round(prob, 4)}
            for team, prob in sorted(result.final_probabilities.items(), key=lambda x: -x[1])[:6]
        ],
    }


UEL_TEAMS = [
    {"name": "Roma", "elo": 1850, "group": "A", "group_position": 1, "country": "Italy"},
    {"name": "Leverkusen", "elo": 1920, "group": "B", "group_position": 1, "country": "Germany"},
    {"name": "Manchester United", "elo": 1880, "group": "C", "group_position": 1, "country": "England"},
    {"name": "Real Sociedad", "elo": 1820, "group": "D", "group_position": 1, "country": "Spain"},
    {"name": "West Ham", "elo": 1780, "group": "E", "group_position": 1, "country": "England"},
    {"name": "Sporting CP", "elo": 1810, "group": "F", "group_position": 1, "country": "Portugal"},
    {"name": "Marseille", "elo": 1790, "group": "G", "group_position": 1, "country": "France"},
    {"name": "Brighton", "elo": 1770, "group": "H", "group_position": 1, "country": "England"},
]


@router.post("/europa-league")
async def simulate_europa_league_post(
    body: Optional[TeamsListRequest] = None,
    n_simulations: int = Query(5000, ge=100, le=50000)
):
    """
    Simulate Europa League knockout stage with custom teams.
    """
    simulator = get_knockout_simulator()
    simulator.n_simulations = n_simulations
    
    if body and body.teams:
        teams = [
            KnockoutTeam(name=name, elo=1700 + (50 * (16 - idx)) if idx < 16 else 1700)
            for idx, name in enumerate(body.teams)
        ]
    else:
        teams = [
            KnockoutTeam(
                name=t["name"],
                elo=t["elo"],
                group=t.get("group", ""),
                group_position=t.get("group_position", 1),
                country=t.get("country", ""),
            )
            for t in UEL_TEAMS
        ]
    
    result = simulator.simulate_europa_league(teams)
    return _format_simulation_response(result)


@router.get("/europa-league/simulate")
async def simulate_europa_league(
    n_simulations: int = Query(5000, ge=100, le=50000)
):
    """
    Simulate current Europa League knockout stage.
    """
    simulator = get_knockout_simulator()
    simulator.n_simulations = n_simulations
    
    # Europa League teams (example - would be fetched from API in production)
    uel_teams = [
        KnockoutTeam(name="Roma", elo=1850, group="A", group_position=1),
        KnockoutTeam(name="Leverkusen", elo=1920, group="B", group_position=1),
        KnockoutTeam(name="Manchester United", elo=1880, group="C", group_position=1),
        KnockoutTeam(name="Real Sociedad", elo=1820, group="D", group_position=1),
        KnockoutTeam(name="West Ham", elo=1780, group="E", group_position=1),
        KnockoutTeam(name="Sporting CP", elo=1810, group="F", group_position=1),
        KnockoutTeam(name="Marseille", elo=1790, group="G", group_position=1),
        KnockoutTeam(name="Brighton", elo=1770, group="H", group_position=1),
    ]
    
    result = simulator.simulate_europa_league(uel_teams)
    
    return {
        "tournament": result.tournament_name,
        "n_simulations": result.n_simulations,
        "mostLikelyWinner": result.most_likely_winner,
        "winnerProbability": round(result.winner_probability, 4),
        "winnerProbabilities": [
            {"team": team, "probability": round(prob, 4)}
            for team, prob in sorted(result.winner_probabilities.items(), key=lambda x: -x[1])
        ],
    }


@router.post("/world-cup")
async def simulate_world_cup_post(
    body: Optional[TeamsListRequest] = None,
    n_simulations: int = Query(5000, ge=100, le=50000)
):
    """
    Simulate World Cup knockout stage with custom teams.
    """
    simulator = get_knockout_simulator()
    simulator.n_simulations = n_simulations
    
    if body and body.teams:
        teams = [
            KnockoutTeam(name=name, elo=1800 + (80 * (16 - idx)) if idx < 16 else 1800, country=name)
            for idx, name in enumerate(body.teams)
        ]
    else:
        teams = [
            KnockoutTeam(
                name=t["name"],
                elo=t["elo"],
                group=t["group"],
                group_position=t["group_position"],
                country=t["country"],
            )
            for t in WORLD_CUP_TEAMS
        ]
    
    result = simulator.simulate_world_cup(teams)
    return _format_simulation_response(result)


@router.get("/world-cup/simulate")
async def simulate_world_cup(
    n_simulations: int = Query(5000, ge=100, le=50000)
):
    """
    Simulate World Cup knockout stage.
    
    Uses FIFA rankings to set team strengths.
    """
    simulator = get_knockout_simulator()
    simulator.n_simulations = n_simulations
    
    teams = [
        KnockoutTeam(
            name=t["name"],
            elo=t["elo"],
            group=t["group"],
            group_position=t["group_position"],
            country=t["country"],
        )
        for t in WORLD_CUP_TEAMS
    ]
    
    result = simulator.simulate_world_cup(teams)
    
    return {
        "tournament": result.tournament_name,
        "n_simulations": result.n_simulations,
        "mostLikelyWinner": result.most_likely_winner,
        "winnerProbability": round(result.winner_probability, 4),
        "winnerProbabilities": [
            {"team": team, "probability": round(prob, 4)}
            for team, prob in sorted(result.winner_probabilities.items(), key=lambda x: -x[1])
        ],
        "semiFinalProbabilities": [
            {"team": team, "probability": round(prob, 4)}
            for team, prob in sorted(result.semi_final_probabilities.items(), key=lambda x: -x[1])[:8]
        ],
        "finalProbabilities": [
            {"team": team, "probability": round(prob, 4)}
            for team, prob in sorted(result.final_probabilities.items(), key=lambda x: -x[1])[:6]
        ],
    }
