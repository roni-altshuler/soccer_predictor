"""
Weather API endpoints for match conditions.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from datetime import datetime

from backend.services.weather import get_weather_service

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("/match/{home_team}")
async def get_match_weather(
    home_team: str,
    match_time: Optional[str] = Query(None, description="Match time in ISO format")
):
    """
    Get weather conditions for a match venue.
    
    Args:
        home_team: Name of the home team (used to determine venue)
        match_time: Optional match time for forecast
    
    Returns:
        Weather data including temperature, conditions, and impact assessment
    """
    weather_service = get_weather_service()
    
    # Parse match time if provided
    match_datetime = None
    if match_time:
        try:
            match_datetime = datetime.fromisoformat(match_time.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid match_time format. Use ISO format (e.g., 2024-01-15T15:00:00)"
            )
    
    try:
        weather = await weather_service.get_weather_for_venue(home_team, match_datetime)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    
    return weather.to_dict()


@router.get("/impact/{home_team}")
async def get_weather_impact(home_team: str):
    """
    Get weather impact analysis for a match.
    
    Returns prediction adjustments based on weather conditions.
    """
    weather_service = get_weather_service()
    try:
        weather = await weather_service.get_weather_for_venue(home_team)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    adjustments = weather_service.calculate_weather_adjustment(weather)
    
    return {
        "weather": weather.to_dict(),
        "adjustments": adjustments,
        "summary": weather.impact_description,
    }
