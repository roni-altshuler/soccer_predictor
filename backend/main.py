"""
FastAPI backend server for the Soccer Predictor application.

This module defines the FastAPI application, including API endpoints for match
predictions, team data retrieval, and analytics. It uses a prediction service
to perform the actual calculations and data lookups.

The API includes the following main functionalities:
- Head-to-head match prediction within a single league.
- Cross-league match prediction between two teams from different leagues.
- Retrieval of teams for a given league.
- A suite of analytics endpoints to provide statistics and trends for each league.

The application is configured with CORS middleware to allow requests from the
frontend development server. Error handling is implemented to return appropriate
HTTP status codes and details for various issues, such as file not found or
invalid input.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, validator
from typing import Dict, List, Any
import os
import traceback

import prediction_service as ps

# Constants
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "fbref_data")

app = FastAPI(title="Soccer Predictor API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Models for request validation
class HeadToHeadRequest(BaseModel):
    """
    Request model for head-to-head predictions.

    Attributes:
        league: The league in which the match is played.
        home_team: The name of the home team.
        away_team: The name of the away team.
    """

    league: str
    home_team: str
    away_team: str

    @validator("league")
    def validate_league(cls, v: str) -> str:
        """
        Validate that the league is one of the allowed leagues.
        """
        allowed_leagues = [
            "premier_league",
            "la_liga",
            "bundesliga",
            "serie_a",
            "ligue_1",
            "mls",
            "ucl",
            "uel",
            "world_cup",
        ]
        if v not in allowed_leagues:
            raise ValueError(f'League must be one of: {", ".join(allowed_leagues)}')
        return v


class CrossLeagueRequest(BaseModel):
    """
    Request model for cross-league predictions.

    Attributes:
        league_a: The league of the first team.
        team_a: The name of the first team.
        league_b: The league of the second team.
        team_b: The name of the second team.
    """

    league_a: str
    team_a: str
    league_b: str
    team_b: str

    @validator("league_a", "league_b")
    def validate_leagues(cls, v: str) -> str:
        """
        Validate that the leagues are one of the allowed leagues.
        """
        allowed_leagues = [
            "premier_league",
            "la_liga",
            "bundesliga",
            "serie_a",
            "ligue_1",
            "mls",
            "ucl",
            "uel",
            "world_cup",
        ]
        if v not in allowed_leagues:
            raise ValueError(f'League must be one of: {", ".join(allowed_leagues)}')
        return v


# Routes with error handling
@app.post("/api/predict/head-to-head")
async def predict_head_to_head(request: HeadToHeadRequest) -> Dict[str, Any]:
    print(f"Received head-to-head prediction request for league: {request.league}, home: {request.home_team}, away: {request.away_team}")
    """
    Predict the outcome of a head-to-head match within a league.

    Args:
        request: A HeadToHeadRequest object containing the league, home team,
                 and away team.

    Returns:
        A dictionary with the prediction results, including win/draw/loss
        probabilities and team names.
    """
    try:
        result = ps.predict_head_to_head(
            request.league, request.home_team, request.away_team
        )
        return {
            "success": True,
            "predictions": result,
            "home_team": request.home_team,
            "away_team": request.away_team,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Unhandled exception in predict_head_to_head: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.post("/api/predict/cross-league")
async def predict_cross_league(request: CrossLeagueRequest) -> Dict[str, Any]:
    """
    Predict the outcome of a match between two teams from different leagues.

    Args:
        request: A CrossLeagueRequest object containing the leagues and names
                 of the two teams.

    Returns:
        A dictionary with the prediction results, including win probabilities
        for each team and draw probability.
    """
    try:
        result = ps.predict_cross_league(
            request.team_a, request.league_a, request.team_b, request.league_b
        )
        return {
            "success": True,
            "predictions": result,
            "team_a": request.team_a,
            "team_b": request.team_b,
            "league_a": request.league_a,
            "league_b": request.league_b,
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Unhandled exception in predict_cross_league: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/teams/{league}")
async def get_teams(league: str) -> Dict[str, Any]:
    """
    Get a list of all teams in a specific league.

    Args:
        league: The name of the league.

    Returns:
        A dictionary containing a list of team names.
    """
    try:
        teams = ps.get_league_teams(league)
        return {"success": True, "teams": teams}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"Unhandled exception in get_teams: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/analytics/image")
async def get_analytics_image(league: str, image_name: str):
    print(f"Attempting to get image: league={league}, image_name={image_name}")
    image_path = os.path.join(DATA_DIR, league, "visualizations", image_name)
    print(f"Constructed image path: {image_path}")
    if not os.path.exists(image_path):
        print(f"Image file not found at: {image_path}")
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(image_path)


@app.get("/api/analytics/model_metrics/{league}")
async def get_analytics_model_metrics(league: str) -> Dict[str, Any]:
    """
    Get model performance metrics for a league.

    Args:
        league: The name of the league.

    Returns:
        A dictionary with model performance metrics.
    """
    try:
        return ps.get_model_metrics(league)
    except Exception as e:
        print(f"Unhandled exception in get_model_metrics: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/overview/{league}")
async def get_analytics_overview(league: str) -> Dict[str, Any]:
    """
    Get an overview of league statistics.

    Args:
        league: The name of the league.

    Returns:
        A dictionary with overall league statistics.
    """
    try:
        return ps.get_league_stats_overview(league)
    except Exception as e:
        print(f"Unhandled exception in get_league_stats_overview: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/analytics/season_trends/{league}")
async def get_analytics_season_trends(league: str) -> List[Dict[str, Any]]:
    """
    Get season trends for average goals in a league.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries with season-by-season trend data.
    """
    try:
        return ps.get_season_trends(league)
    except Exception as e:
        print(f"Unhandled exception in get_season_trends: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/analytics/result_distribution/{league}")
async def get_analytics_result_distribution(league: str) -> List[Dict[str, Any]]:
    """
    Get the distribution of match results (win/draw/loss) for a league.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries representing the result distribution.
    """
    try:
        return ps.get_result_distribution(league)
    except Exception as e:
        print(f"Unhandled exception in get_result_distribution: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/analytics/home_away_performance/{league}")
async def get_analytics_home_away_performance(league: str) -> List[Dict[str, Any]]:
    """
    Get home vs. away performance statistics for a league.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries with home/away performance data.
    """
    try:
        return ps.get_home_away_performance(league)
    except Exception as e:
        print(f"Unhandled exception in get_home_away_performance: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/analytics/goals_distribution/{league}")
async def get_analytics_goals_distribution(league: str) -> List[Dict[str, Any]]:
    """
    Get the distribution of total goals per match for a league.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries representing the goals distribution.
    """
    try:
        return ps.get_goals_distribution(league)
    except Exception as e:
        print(f"Unhandled exception in get_goals_distribution: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/upcoming_matches/{league}")
async def get_upcoming_matches(league: str) -> List[Dict[str, Any]]:
    """
    Get upcoming matches for a league.

    Args:
        league: The name of the league.

    Returns:
        A list of dictionaries with upcoming match data.
    """
    try:
        return ps.get_upcoming_matches(league)
    except Exception as e:
        print(f"Unhandled exception in get_upcoming_matches: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)