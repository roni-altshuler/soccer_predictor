"""
Prediction-related API endpoints.
"""

from typing import List, Optional
from datetime import datetime
import logging
from fastapi import APIRouter, HTTPException, Query, Body

from backend.services.prediction import get_prediction_service
from backend.services.fotmob import get_fotmob_client
from backend.services.ratings import get_elo_system
from backend.models.prediction import MatchPrediction

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/predictions", tags=["predictions"])


@router.get("/match/{match_id}")
async def predict_match(match_id: int):
    """
    Get prediction for a specific match.
    
    Fetches match data from FotMob and generates a comprehensive prediction.
    """
    client = get_fotmob_client()
    elo = get_elo_system()
    
    # Get match details
    match_data = await client.get_match_details(match_id)
    
    if not match_data:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")
    
    # Extract team info
    general = match_data.get("general", {})
    home_team_data = general.get("homeTeam", {})
    away_team_data = general.get("awayTeam", {})
    
    home_id = home_team_data.get("id")
    away_id = away_team_data.get("id")
    home_name = home_team_data.get("name", "Home")
    away_name = away_team_data.get("name", "Away")
    
    # Get team data
    home_team_full = await client.get_team(home_id) if home_id else {}
    away_team_full = await client.get_team(away_id) if away_id else {}
    
    # Get form
    home_form = await client.get_team_form(home_id) if home_id else []
    away_form = await client.get_team_form(away_id) if away_id else []
    
    # Get injuries
    home_injuries = await client.get_team_injuries(home_id) if home_id else []
    away_injuries = await client.get_team_injuries(away_id) if away_id else []
    
    # Build team data dicts
    home_data = {
        "id": home_id,
        "name": home_name,
        "elo_rating": elo.get_elo(home_name),
        "form": home_form,
        "injuries": home_injuries or [],
        "season_stats": {
            "goals_per_game": 1.5,
            "conceded_per_game": 1.0,
            "clean_sheet_pct": 0.3,
            "points_per_game": 1.5,
            "home_win_pct": 0.5,
            "home_goals_avg": 1.8,
        }
    }
    
    away_data = {
        "id": away_id,
        "name": away_name,
        "elo_rating": elo.get_elo(away_name),
        "form": away_form,
        "injuries": away_injuries or [],
        "season_stats": {
            "goals_per_game": 1.3,
            "conceded_per_game": 1.2,
            "clean_sheet_pct": 0.25,
            "points_per_game": 1.4,
            "away_win_pct": 0.35,
            "away_goals_avg": 1.2,
        }
    }
    
    # Get H2H data
    h2h_data = await client.get_h2h(match_id)
    h2h = None
    if h2h_data:
        # Parse H2H
        h2h = {
            "home_wins": 0,
            "draws": 0,
            "away_wins": 0,
            "total_matches": 0,
            "home_goals_avg": 1.5,
            "away_goals_avg": 1.0,
        }
    
    # Get match context
    league = general.get("leagueName", "Unknown")
    kickoff = general.get("matchTimeUTC") or general.get("matchTime")
    
    # Parse kickoff time - handle various formats
    kickoff_time = datetime.utcnow()
    if kickoff:
        try:
            # Try ISO format first
            kickoff_time = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
        except ValueError:
            # Try parsing human-readable format like "Fri, Aug 15, 2025, 19:00 UTC"
            try:
                from dateutil import parser
                kickoff_time = parser.parse(kickoff.replace(" UTC", ""))
            except Exception:
                pass  # Use default
    
    context = {
        "league": league,
        "home_position": 10,
        "away_position": 10,
        "importance": 0.5,
        "home_rest_days": 7,
        "away_rest_days": 7,
    }
    
    # Generate prediction
    service = get_prediction_service()
    prediction = await service.predict_match(
        match_id=match_id,
        home_team_data=home_data,
        away_team_data=away_data,
        h2h_data=h2h,
        match_context=context,
        kickoff_time=kickoff_time
    )

    # Auto-store prediction for accuracy tracking
    try:
        from backend.services.prediction.tracker import get_prediction_tracker
        tracker = get_prediction_tracker()
        tracker.store_prediction(
            match_id=str(match_id),
            home_team=home_name,
            away_team=away_name,
            league=league,
            match_date=kickoff_time.isoformat()[:10] if kickoff_time else datetime.utcnow().isoformat()[:10],
            home_win_prob=prediction.outcome.home_win,
            draw_prob=prediction.outcome.draw,
            away_win_prob=prediction.outcome.away_win,
            home_xG=prediction.goals.home_expected_goals,
            away_xG=prediction.goals.away_expected_goals,
            confidence=prediction.confidence.overall,
            home_elo=elo.get_elo(home_name),
            away_elo=elo.get_elo(away_name),
        )
    except Exception as e:
        logger.warning(f"Auto-store prediction failed: {e}")

    return prediction


@router.post("/batch")
async def predict_batch(
    match_ids: List[int] = Body(..., embed=True)
):
    """
    Get predictions for multiple matches.
    
    Args:
        match_ids: List of match IDs to predict
    """
    if len(match_ids) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 matches per batch")
    
    predictions = []
    errors = []
    
    for match_id in match_ids:
        try:
            pred = await predict_match(match_id)
            predictions.append(pred)
        except Exception as e:
            errors.append({"match_id": match_id, "error": str(e)})
    
    return {
        "predictions": predictions,
        "errors": errors,
        "success_count": len(predictions),
        "error_count": len(errors)
    }


@router.get("/today")
async def get_today_predictions():
    """Get predictions for all of today's matches."""
    client = get_fotmob_client()
    today = datetime.now().strftime("%Y%m%d")
    
    data = await client.get_matches_by_date(today)
    
    if not data or "leagues" not in data:
        return {"predictions": [], "message": "No matches found for today"}
    
    # Collect match IDs
    match_ids = []
    for league in data["leagues"]:
        for match in league.get("matches", []):
            status = match.get("status", {})
            # Only predict upcoming/live matches
            if not status.get("finished"):
                match_ids.append(match.get("id"))
    
    if not match_ids:
        return {"predictions": [], "message": "No upcoming matches found for today"}
    
    # Limit to avoid overload
    match_ids = match_ids[:10]
    
    predictions = []
    for match_id in match_ids:
        try:
            pred = await predict_match(match_id)
            predictions.append(pred)
        except Exception:
            continue
    
    return {
        "date": today,
        "predictions": predictions,
        "total_requested": len(match_ids),
        "total_generated": len(predictions)
    }


@router.get("/quick/{home_team}/{away_team}")
async def quick_prediction(home_team: str, away_team: str):
    """
    Quick prediction based only on team names and ELO.
    
    Useful for quick lookups without full match data.
    """
    elo = get_elo_system()
    
    outcome = elo.predict_outcome(home_team, away_team)
    
    home_elo = elo.get_elo(home_team)
    away_elo = elo.get_elo(away_team)
    
    return {
        "home_team": home_team,
        "away_team": away_team,
        "home_elo": round(home_elo, 0),
        "away_elo": round(away_elo, 0),
        "elo_difference": round(home_elo - away_elo + 65, 0),  # Include home advantage
        "outcome": outcome,
        "predicted_winner": (
            home_team if outcome["home_win"] > outcome["away_win"] and outcome["home_win"] > outcome["draw"]
            else (away_team if outcome["away_win"] > outcome["home_win"] and outcome["away_win"] > outcome["draw"]
            else "Draw")
        ),
        "note": "Quick prediction based on ELO ratings only. Use /predictions/match/{id} for full analysis."
    }
