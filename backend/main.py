"""
Soccer Predictor API v3.0 - FastAPI Backend

A comprehensive backend that uses FotMob and ESPN APIs for football data.
Provides endpoints for live scores, match predictions, team data, league information,
user authentication, and league standings simulation.

Features:
- Multi-source data (FotMob + ESPN)
- User authentication (Email + Google OAuth)
- Enhanced ML predictions with news sentiment analysis
- League standings simulation with Monte Carlo
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

# Import v1 API router
from backend.api.v1 import router as v1_router

# Import services
from backend.services.fotmob import get_fotmob_client, cleanup_fotmob_client
from backend.services.espn import get_espn_client, cleanup_espn_client
from backend.services.ratings import get_elo_system
from backend.config import LEAGUE_IDS, LEAGUE_NAMES

# Import legacy services that still work with FotMob
from backend import fotmob_service as fm
from backend import live_score_service as lss

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup and shutdown."""
    import asyncio
    logger.info("Starting Soccer Predictor API v4.0")

    # Start background outcome update loop (checks for finished matches every 30 min)
    try:
        from backend.services.prediction.outcome_fetcher import outcome_update_loop
        asyncio.create_task(outcome_update_loop(interval_minutes=30))
        logger.info("Background outcome fetcher started")
    except Exception as e:
        logger.warning(f"Could not start outcome fetcher: {e}")

    yield
    logger.info("Shutting down Soccer Predictor API")
    await cleanup_fotmob_client()
    await cleanup_espn_client()


app = FastAPI(
    title="Soccer Predictor API",
    description="""
    Soccer Predictor API provides comprehensive match predictions,
    live scores, and football data powered by FotMob and ESPN.
    
    ## Features
    
    - **Live Scores**: Real-time match updates from FotMob and ESPN
    - **Match Predictions**: AI-powered probabilistic predictions with news sentiment
    - **Team Data**: Comprehensive team statistics, form, and injuries
    - **League Data**: Standings, top scorers, fixtures, and news
    - **User Authentication**: Email/password and Google OAuth
    - **User Predictions**: Save and track prediction accuracy
    - **League Simulation**: Monte Carlo simulation for final standings
    
    ## API Endpoints
    
    - `/api/v1/matches/` - Match data (live, today, upcoming)
    - `/api/v1/predictions/` - ML predictions for matches
    - `/api/v1/teams/` - Team data and ratings
    - `/api/v1/leagues/` - League standings, news, and simulation
    - `/api/v1/auth/` - User authentication and predictions
    """,
    version="3.0.0",
    lifespan=lifespan,
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API v1 router with enhanced endpoints
app.include_router(v1_router)


# ==================== ROOT ENDPOINTS ====================

@app.get("/")
async def root():
    """API root with available endpoints."""
    return {
        "name": "Soccer Predictor API",
        "version": "2.0.0",
        "docs": "/docs",
        "data_source": "FotMob",
        "endpoints": {
            "health": "/api/health",
            "matches": "/api/v1/matches",
            "predictions": "/api/v1/predictions",
            "teams": "/api/v1/teams",
            "leagues": "/api/v1/leagues",
        },
        "available_leagues": list(LEAGUE_IDS.keys())
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }


# ==================== LEGACY ENDPOINTS (for backwards compatibility) ====================

@app.get("/api/live_scores")
async def get_live_scores():
    """Get all currently live matches (legacy endpoint)."""
    try:
        # Use the legacy live score service
        return lss.get_live_matches()
    except Exception as e:
        logger.error(f"Error fetching live scores: {e}")
        return []


@app.get("/api/todays_matches")
async def get_todays_matches():
    """Get all matches for today (legacy endpoint)."""
    client = get_fotmob_client()
    today = datetime.now().strftime("%Y%m%d")
    
    try:
        data = await client.get_matches_by_date(today)
        
        if not data:
            # Return structured empty response
            return {"live": [], "upcoming": [], "completed": []}
        
        # Categorize matches by status
        live_matches = []
        upcoming_matches = []
        completed_matches = []
        
        for league in data.get("leagues", []):
            for match in league.get("matches", []):
                status_data = match.get("status", {})
                is_finished = status_data.get("finished", False)
                is_started = status_data.get("started", False)
                
                match_data = {
                    "home_team": match.get("home", {}).get("name", ""),
                    "away_team": match.get("away", {}).get("name", ""),
                    "home_score": match.get("home", {}).get("score") if is_started else None,
                    "away_score": match.get("away", {}).get("score") if is_started else None,
                    "time": status_data.get("utcTime", ""),
                    "status": "finished" if is_finished else ("live" if is_started else "upcoming"),
                    "league": league.get("name", ""),
                    "match_id": match.get("id"),
                }
                
                if is_finished:
                    completed_matches.append(match_data)
                elif is_started:
                    live_matches.append(match_data)
                else:
                    upcoming_matches.append(match_data)
        
        return {
            "live": live_matches,
            "upcoming": upcoming_matches,
            "completed": completed_matches
        }
    except Exception as e:
        logger.error(f"Error fetching today's matches: {e}")
        # Return structured empty response on error
        return {"live": [], "upcoming": [], "completed": []}


@app.get("/api/upcoming_matches/{league}")
async def get_upcoming_matches(league: str):
    """Get upcoming matches for a league (legacy endpoint)."""
    league_key = league.lower().replace(" ", "_").replace("-", "_")
    
    if league_key not in LEAGUE_IDS:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    
    try:
        # Use the fotmob_service for upcoming fixtures
        matches = fm.get_upcoming_fixtures(league_key)
        return {"matches": matches[:20]}
    except Exception as e:
        logger.error(f"Error fetching upcoming matches: {e}")
        return {"matches": []}


@app.get("/api/matches_by_date/{league}/{date}")
async def get_matches_by_date(league: str, date: str):
    """Get matches for a specific league on a specific date (legacy endpoint)."""
    league_key = league.lower().replace(" ", "_").replace("-", "_")
    
    if league_key not in LEAGUE_IDS:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    
    league_id = LEAGUE_IDS[league_key]
    client = get_fotmob_client()
    
    try:
        # Get all league matches and filter by date
        matches = await client.get_league_matches(league_id)
        
        if not matches:
            return []
        
        # Filter matches by date (date format: YYYY-MM-DD)
        date_matches = []
        for match in matches:
            status_info = match.get("status", {})
            match_time = status_info.get("utcTime", "")
            
            # Check if match date matches requested date
            if match_time and match_time.startswith(date):
                home = match.get("home", {})
                away = match.get("away", {})
                
                status = "upcoming"
                if status_info.get("finished"):
                    status = "finished"
                elif status_info.get("started"):
                    status = "live"
                
                # Parse score
                home_score = None
                away_score = None
                score_str = status_info.get("scoreStr", "")
                if " - " in score_str:
                    parts = score_str.split(" - ")
                    try:
                        home_score = int(parts[0])
                        away_score = int(parts[1])
                    except ValueError:
                        pass
                
                date_matches.append({
                    "match_id": match.get("id"),
                    "home_team": home.get("name", ""),
                    "away_team": away.get("name", ""),
                    "date": match_time,
                    "time": match_time,
                    "home_score": home_score,
                    "away_score": away_score,
                    "status": status,
                })
        
        return date_matches
    except Exception as e:
        logger.error(f"Error fetching matches by date: {e}")
        return []


@app.get("/api/team_form/{league}/{team}")
async def get_team_form(league: str, team: str):
    """Get recent form and stats for a team (legacy endpoint)."""
    league_key = league.lower().replace(" ", "_").replace("-", "_")
    
    try:
        form = fm.get_team_form(team, league_key, num_matches=10)
        
        # Calculate stats from form
        wins = form.count("W")
        draws = form.count("D")
        losses = form.count("L")
        matches_played = len(form)
        
        # Calculate rates (avoid division by zero)
        win_rate = wins / matches_played if matches_played > 0 else 0
        
        return {
            "team": team,
            "form": form,
            "recent_form": form,
            "points": sum(3 if r == "W" else (1 if r == "D" else 0) for r in form),
            "matches_played": matches_played,
            "wins": wins,
            "draws": draws,
            "losses": losses,
            "goals_scored": 0,  # Not available from form data
            "goals_conceded": 0,  # Not available from form data
            "win_rate": win_rate,
            "avg_goals_scored": 0,  # Not available from form data
            "avg_goals_conceded": 0,  # Not available from form data
            "home_win_rate": 0,  # Not available from form data
            "away_win_rate": 0,  # Not available from form data
        }
    except Exception as e:
        logger.error(f"Error fetching team form: {e}")
        return {
            "team": team, 
            "form": [], 
            "recent_form": [],
            "matches_played": 0,
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "goals_scored": 0,
            "goals_conceded": 0,
            "win_rate": 0,
            "avg_goals_scored": 0,
            "avg_goals_conceded": 0,
            "home_win_rate": 0,
            "away_win_rate": 0,
            "message": f"Error: {str(e)}"
        }


class PredictionRequest(BaseModel):
    """Request model for predictions."""
    home_team: str
    away_team: str
    league: Optional[str] = None


@app.post("/api/predict/unified")
async def predict_match(request: PredictionRequest):
    """Generate prediction for a match (legacy endpoint)."""
    elo = get_elo_system()
    
    home_elo = elo.get_elo(request.home_team)
    away_elo = elo.get_elo(request.away_team)
    
    outcome = elo.predict_outcome(request.home_team, request.away_team)
    
    # Determine prediction
    if outcome["home_win"] > outcome["draw"] and outcome["home_win"] > outcome["away_win"]:
        prediction = f"{request.home_team} Win"
        confidence = outcome["home_win"]
    elif outcome["away_win"] > outcome["draw"] and outcome["away_win"] > outcome["home_win"]:
        prediction = f"{request.away_team} Win"
        confidence = outcome["away_win"]
    else:
        prediction = "Draw"
        confidence = outcome["draw"]
    
    return {
        "home_team": request.home_team,
        "away_team": request.away_team,
        "home_elo": round(home_elo, 0),
        "away_elo": round(away_elo, 0),
        "prediction": prediction,
        "confidence": min(99.9, max(0.1, round(confidence * 100, 1))),  # Clamp between 0.1-99.9%
        "probabilities": {
            "home_win": round(outcome["home_win"] * 100, 1),
            "draw": round(outcome["draw"] * 100, 1),
            "away_win": round(outcome["away_win"] * 100, 1),
        }
    }


@app.get("/api/team_rating/{league}/{team}")
async def get_team_rating(league: str, team: str):
    """Get ELO rating for a team (legacy endpoint)."""
    elo = get_elo_system()
    rating_data = elo.get_rating(team)
    
    return {
        "team": team,
        "elo": round(rating_data["elo"], 0),
        "matches": rating_data["matches"],
    }


@app.get("/api/calendar/{league}")
async def get_league_calendar(league: str, year: Optional[int] = None, month: Optional[int] = None):
    """Get calendar of matches for a league (legacy endpoint)."""
    league_key = league.lower().replace(" ", "_").replace("-", "_")
    
    if league_key not in LEAGUE_IDS:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    
    try:
        # Use v1 FotMob client for league fixtures
        league_id = LEAGUE_IDS[league_key]
        client = get_fotmob_client()
        matches = await client.get_league_matches(league_id)
        
        # Get ELO system for predictions
        elo = get_elo_system()
        
        calendar = []
        if matches:
            for match in matches:  # Get all matches
                status_info = match.get("status", {})
                home = match.get("home", {})
                away = match.get("away", {})
                
                home_team = home.get("name", "")
                away_team = away.get("name", "")
                
                status = "upcoming"
                if status_info.get("finished"):
                    status = "finished"
                elif status_info.get("started"):
                    status = "live"
                
                # Parse score from scoreStr if available
                home_score = None
                away_score = None
                score_str = status_info.get("scoreStr", "")
                if " - " in score_str:
                    parts = score_str.split(" - ")
                    try:
                        home_score = int(parts[0])
                        away_score = int(parts[1])
                    except ValueError:
                        pass
                
                # Generate predictions for each match
                prediction = elo.predict_outcome(home_team, away_team) if home_team and away_team else None
                
                calendar.append({
                    "match_id": match.get("id"),
                    "home_team": home_team,
                    "away_team": away_team,
                    "date": status_info.get("utcTime", ""),
                    "time": status_info.get("utcTime", ""),
                    "actual_home_goals": home_score,
                    "actual_away_goals": away_score,
                    "status": status,
                    "round": match.get("round", ""),
                    "predicted_home_win": prediction["home_win"] if prediction else 0.33,
                    "predicted_draw": prediction["draw"] if prediction else 0.33,
                    "predicted_away_win": prediction["away_win"] if prediction else 0.33,
                })
        
        # Build calendar weeks for the requested month
        now = datetime.now()
        target_year = year or now.year
        target_month = month or now.month
        
        from calendar import Calendar
        cal = Calendar(firstweekday=6)  # Sunday first
        weeks = []
        
        month_matches = [m for m in calendar if m.get("date")]
        
        for week in cal.monthdayscalendar(target_year, target_month):
            week_data = []
            for day in week:
                if day == 0:
                    week_data.append(None)
                else:
                    date_str = f"{target_year}-{target_month:02d}-{day:02d}"
                    day_matches = [
                        m for m in month_matches 
                        if m.get("date", "").startswith(date_str)
                    ]
                    week_data.append({
                        "day": day,
                        "date": date_str,
                        "matches": day_matches,
                        "match_count": len(day_matches),
                        "is_today": (day == now.day and target_month == now.month and target_year == now.year),
                    })
            weeks.append(week_data)
        
        month_names = ["", "January", "February", "March", "April", "May", "June",
                       "July", "August", "September", "October", "November", "December"]
        
        return {
            "calendar": calendar,
            "year": target_year,
            "month": target_month,
            "month_name": month_names[target_month],
            "weeks": weeks,
            "total_matches": len(calendar),
        }
    except Exception as e:
        logger.error(f"Error fetching calendar: {e}")
        return {"calendar": [], "weeks": [], "total_matches": 0}


@app.get("/api/teams/{league}")
async def get_teams_for_league(league: str):
    """Get all teams in a league (legacy endpoint)."""
    league_key = league.lower().replace(" ", "_").replace("-", "_")
    
    if league_key not in LEAGUE_IDS:
        raise HTTPException(status_code=404, detail=f"League '{league}' not found")
    
    league_id = LEAGUE_IDS[league_key]
    client = get_fotmob_client()
    
    try:
        standings = await client.get_league_standings(league_id)
        
        if not standings:
            return {"teams": []}
        
        teams = [row.get("name", "") for row in standings]
        return {"teams": sorted(teams)}
    except Exception as e:
        logger.error(f"Error fetching teams: {e}")
        return {"teams": []}


# Run with: uvicorn backend.main:app --reload --port 8000
