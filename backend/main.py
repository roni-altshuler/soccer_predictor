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
import os
import json
import math
from pathlib import Path

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
                home_team = home.get("name", "")
                away_team = away.get("name", "")

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
                
                card = {
                    "match_id": match.get("id"),
                    "home_team": home_team,
                    "away_team": away_team,
                    "date": match_time,
                    "time": match_time,
                    "actual_home_goals": home_score,
                    "actual_away_goals": away_score,
                    "home_score": home_score,
                    "away_score": away_score,
                    "status": status,
                    "round": match.get("round", ""),
                }
                card.update(await _prediction_card_fields(home_team, away_team, league_key))
                date_matches.append(card)
        
        return date_matches
    except Exception as e:
        logger.error(f"Error fetching matches by date: {e}")
        return []


@app.get("/api/team_form/{league}/{team}")
async def get_team_form(league: str, team: str):
    """Get recent form and detailed stats for a team."""
    league_key = league.lower().replace(" ", "_").replace("-", "_")
    
    try:
        all_matches = fm.get_live_matches(league_key)
        
        # Filter completed matches involving this team
        team_lower = team.lower()
        team_matches = []
        
        for match in all_matches:
            if match["status"] != "played":
                continue
            
            home_name = (match.get("home_team") or "").lower()
            away_name = (match.get("away_team") or "").lower()
            
            is_home = team_lower in home_name or home_name in team_lower
            is_away = team_lower in away_name or away_name in team_lower
            
            if not (is_home or is_away):
                continue
            
            home_goals = match.get("home_goals") or 0
            away_goals = match.get("away_goals") or 0
            
            if is_home:
                goals_for = home_goals
                goals_against = away_goals
                venue = "home"
                opponent = match.get("away_team", "Unknown")
            else:
                goals_for = away_goals
                goals_against = home_goals
                venue = "away"
                opponent = match.get("home_team", "Unknown")
            
            if goals_for > goals_against:
                result = "win"
            elif goals_for < goals_against:
                result = "loss"
            else:
                result = "draw"
            
            team_matches.append({
                "date": match.get("date", ""),
                "result": result,
                "goals_for": goals_for,
                "goals_against": goals_against,
                "venue": venue,
                "opponent": opponent,
                "score_str": match.get("score_str", ""),
            })
        
        # Sort by date descending (most recent first)
        team_matches.sort(key=lambda x: x.get("date", ""), reverse=True)
        team_matches = team_matches[:10]
        
        # Compute aggregate stats
        form = [("W" if m["result"] == "win" else "D" if m["result"] == "draw" else "L") for m in team_matches]
        n = len(team_matches)
        wins = form.count("W")
        draws = form.count("D")
        losses = form.count("L")
        win_rate = wins / n if n > 0 else 0
        
        goals_scored = sum(m["goals_for"] for m in team_matches)
        goals_conceded = sum(m["goals_against"] for m in team_matches)
        
        return {
            "team": team,
            "form": form,
            "recent_form": form,
            "matches": team_matches,
            "matches_played": n,
            "wins": wins,
            "draws": draws,
            "losses": losses,
            "points": sum(3 if r == "W" else (1 if r == "D" else 0) for r in form),
            "goals_scored": goals_scored,
            "goals_conceded": goals_conceded,
            "win_rate": win_rate,
            "avg_goals_scored": goals_scored / n if n > 0 else 0,
            "avg_goals_conceded": goals_conceded / n if n > 0 else 0,
        }
    except Exception as e:
        logger.error(f"Error fetching team form: {e}")
        return {
            "team": team,
            "form": [],
            "recent_form": [],
            "matches": [],
            "matches_played": 0,
            "wins": 0,
            "draws": 0,
            "losses": 0,
            "goals_scored": 0,
            "goals_conceded": 0,
            "win_rate": 0,
            "avg_goals_scored": 0,
            "avg_goals_conceded": 0,
            "message": f"Error: {str(e)}"
        }


class PredictionRequest(BaseModel):
    """Request model for predictions."""
    home_team: str
    away_team: str
    league: Optional[str] = None


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


PREDICTION_POLICY_MIN_CONFIDENCE_PCT = _env_float("PREDICTION_POLICY_MIN_CONFIDENCE_PCT", 55.0)
PREDICTION_POLICY_MIN_EDGE_PCT = _env_float("PREDICTION_POLICY_MIN_EDGE_PCT", 12.0)

LEAGUE_KEY_TO_DISPLAY = {
    "eng.1": "Premier League",
    "esp.1": "La Liga",
    "ger.1": "Bundesliga",
    "ita.1": "Serie A",
    "fra.1": "Ligue 1",
    "ned.1": "Eredivisie",
    "por.1": "Primeira Liga",
    "usa.1": "MLS",
    "uefa.champions": "Champions League",
    "uefa.europa": "Europa League",
    "uefa.europa.conf": "Conference League",
    "fifa.world": "FIFA World Cup",
    "uefa.euro": "UEFA European Championship",
    "conmebol.america": "Copa America",
}

LEAGUE_ALIASES = {
    "premier_league": "eng.1",
    "premier league": "eng.1",
    "la_liga": "esp.1",
    "la liga": "esp.1",
    "bundesliga": "ger.1",
    "serie_a": "ita.1",
    "serie a": "ita.1",
    "ligue_1": "fra.1",
    "ligue 1": "fra.1",
    "eredivisie": "ned.1",
    "primeira_liga": "por.1",
    "primeira liga": "por.1",
    "mls": "usa.1",
    "champions_league": "uefa.champions",
    "champions league": "uefa.champions",
    "uefa champions league": "uefa.champions",
    "europa_league": "uefa.europa",
    "europa league": "uefa.europa",
    "uefa europa league": "uefa.europa",
    "conference_league": "uefa.europa.conf",
    "conference league": "uefa.europa.conf",
    "uefa conference league": "uefa.europa.conf",
    "world_cup": "fifa.world",
    "world cup": "fifa.world",
    "fifa world cup": "fifa.world",
    "euro": "uefa.euro",
    "euros": "uefa.euro",
    "uefa euro": "uefa.euro",
    "uefa european championship": "uefa.euro",
    "copa_america": "conmebol.america",
    "copa america": "conmebol.america",
    "conmebol copa america": "conmebol.america",
}

_RUNTIME_ELO_PREDICTOR = None
_MODEL_TUNING_CACHE: Optional[Dict[str, Any]] = None


def _edge_from_probabilities(home_win: float, draw: float, away_win: float) -> float:
    probs = [max(0.0, home_win), max(0.0, draw), max(0.0, away_win)]
    total = sum(probs)
    if total <= 0:
        probs = [1 / 3, 1 / 3, 1 / 3]
    else:
        probs = [p / total for p in probs]
    return max(probs) - (1.0 / 3.0)


def _normalize_league_key(league: Optional[str]) -> tuple[str, str]:
    if not league:
        return "eng.1", LEAGUE_KEY_TO_DISPLAY["eng.1"]
    raw = league.strip()
    if raw in LEAGUE_KEY_TO_DISPLAY:
        key = raw
    else:
        normalized = raw.lower().replace("-", "_")
        key = LEAGUE_ALIASES.get(normalized, LEAGUE_ALIASES.get(normalized.replace("_", " "), raw))
    return key, LEAGUE_KEY_TO_DISPLAY.get(key, raw)


def _get_runtime_elo_predictor():
    """Use the production predictor ELO seed built from completed outcomes."""
    global _RUNTIME_ELO_PREDICTOR
    if _RUNTIME_ELO_PREDICTOR is None:
        from backend.scripts.predict_upcoming import EloPredictor
        _RUNTIME_ELO_PREDICTOR = EloPredictor()
    return _RUNTIME_ELO_PREDICTOR


def _get_model_tuning(league_key: str) -> Dict[str, float]:
    global _MODEL_TUNING_CACHE
    if _MODEL_TUNING_CACHE is None:
        tuning_file = Path(__file__).parent / "data" / "model_tuning.json"
        try:
            with open(tuning_file) as f:
                _MODEL_TUNING_CACHE = json.load(f)
        except Exception:
            _MODEL_TUNING_CACHE = {}

    default = {
        "blend_nn_base": 0.66,
        "blend_nn_min": 0.55,
        "blend_nn_max": 0.82,
        "entropy_sensitivity": 0.18,
    }
    league_tuning = (_MODEL_TUNING_CACHE.get("leagues", {}) if _MODEL_TUNING_CACHE else {}).get(league_key, {})
    return {**default, **league_tuning}


def _select_neural_model(league_key: str):
    """Prefer a trained global model when present, otherwise use the league model."""
    try:
        from backend.services.prediction.neural_model import get_league_model_registry
        registry = get_league_model_registry()
        global_model = registry.get_model("global")
        if global_model.is_fitted:
            return global_model, "neural_global_v5"
        league_model = registry.get_model(league_key)
        if league_model.is_fitted:
            return league_model, "neural_ensemble_v5"
    except Exception as exc:
        logger.debug(f"Neural model unavailable for {league_key}: {exc}")
    return None, "elo_poisson"


def _blend_neural_with_elo(
    nn_probs: Dict[str, float],
    elo_probs: Dict[str, float],
    league_key: str,
) -> tuple[Dict[str, float], float, float]:
    tuning = _get_model_tuning(league_key)
    entropy = -sum(max(p, 1e-12) * math.log(max(p, 1e-12)) for p in nn_probs.values())
    entropy_norm = min(1.0, entropy / math.log(3.0))
    nn_weight = float(tuning["blend_nn_base"]) + (1.0 - entropy_norm) * float(tuning["entropy_sensitivity"])
    nn_weight = max(float(tuning["blend_nn_min"]), min(float(tuning["blend_nn_max"]), nn_weight))
    elo_weight = 1.0 - nn_weight
    probs = {
        "home_win": nn_weight * nn_probs["home_win"] + elo_weight * elo_probs["home_win"],
        "draw": nn_weight * nn_probs["draw"] + elo_weight * elo_probs["draw"],
        "away_win": nn_weight * nn_probs["away_win"] + elo_weight * elo_probs["away_win"],
    }
    total = sum(probs.values()) or 1.0
    return {k: v / total for k, v in probs.items()}, nn_weight, entropy_norm


@app.post("/api/predict/unified")
async def predict_match(request: PredictionRequest):
    """Generate a calibrated match prediction using neural models when available."""
    league_key, league_display = _normalize_league_key(request.league)
    model_used = "elo_poisson"
    blend_nn_weight = None
    blend_entropy = None
    runtime_elo = None

    try:
        runtime_elo = _get_runtime_elo_predictor()
        home_elo = runtime_elo.get(request.home_team)
        away_elo = runtime_elo.get(request.away_team)
        elo_probs = runtime_elo.predict(request.home_team, request.away_team, league_display)
        elo_home_xg, elo_away_xg = runtime_elo.predict_goals(request.home_team, request.away_team, league_display)
    except Exception as exc:
        logger.debug(f"Runtime ELO unavailable, falling back to service ELO: {exc}")
        elo = get_elo_system()
        home_elo = elo.get_elo(request.home_team)
        away_elo = elo.get_elo(request.away_team)
        elo_probs = elo.predict_outcome(request.home_team, request.away_team, league_display)
        elo_home_xg = max(0.3, 1.35 + (home_elo - away_elo) / 700)
        elo_away_xg = max(0.2, 1.15 + (away_elo - home_elo) / 800)

    outcome = elo_probs
    predicted_home_goals = elo_home_xg
    predicted_away_goals = elo_away_xg

    neural_model, neural_tag = _select_neural_model(league_key)
    if neural_model is not None and runtime_elo is not None:
        try:
            from backend.scripts.predict_upcoming import _build_match_features
            features = _build_match_features(
                runtime_elo,
                request.home_team,
                request.away_team,
                league_key,
                elo_probs,
                elo_home_xg,
                elo_away_xg,
                league_results=None,
                match_date=datetime.utcnow().isoformat(),
            )
            raw_probs = neural_model.predict_proba(features)[0]
            nn_probs = {
                "home_win": float(raw_probs[0]),
                "draw": float(raw_probs[1]),
                "away_win": float(raw_probs[2]),
            }
            outcome, blend_nn_weight, blend_entropy = _blend_neural_with_elo(nn_probs, elo_probs, league_key)
            raw_goals = neural_model.predict_goals(features)
            predicted_home_goals = 0.75 * float(raw_goals[0, 0]) + 0.25 * elo_home_xg
            predicted_away_goals = 0.75 * float(raw_goals[0, 1]) + 0.25 * elo_away_xg
            model_used = neural_tag
        except Exception as exc:
            logger.debug(f"Neural prediction failed for {league_key}: {exc}")
    
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

    confidence_pct = min(99.9, max(0.1, round(confidence * 100, 1)))
    edge = _edge_from_probabilities(outcome["home_win"], outcome["draw"], outcome["away_win"])
    edge_pct = round(edge * 100, 2)
    threshold_qualified = (
        confidence_pct >= PREDICTION_POLICY_MIN_CONFIDENCE_PCT
        and edge_pct >= PREDICTION_POLICY_MIN_EDGE_PCT
    )
    
    return {
        "home_team": request.home_team,
        "away_team": request.away_team,
        "league": league_key,
        "home_elo": round(home_elo, 0),
        "away_elo": round(away_elo, 0),
        "prediction": prediction,
        "model_used": model_used,
        "blend_nn_weight": round(blend_nn_weight, 4) if blend_nn_weight is not None else None,
        "blend_entropy": round(blend_entropy, 4) if blend_entropy is not None else None,
        "predicted_home_goals": round(max(0.1, min(5.0, predicted_home_goals)), 2),
        "predicted_away_goals": round(max(0.1, min(5.0, predicted_away_goals)), 2),
        "confidence": confidence_pct,  # Clamp between 0.1-99.9%
        "edge_pct": edge_pct,
        "threshold_qualified": threshold_qualified,
        "recommended_action": "play" if threshold_qualified else "pass",
        "recommended_pick": prediction if threshold_qualified else None,
        "policy": {
            "min_confidence_pct": PREDICTION_POLICY_MIN_CONFIDENCE_PCT,
            "min_edge_pct": PREDICTION_POLICY_MIN_EDGE_PCT,
        },
        "probabilities": {
            "home_win": round(outcome["home_win"] * 100, 1),
            "draw": round(outcome["draw"] * 100, 1),
            "away_win": round(outcome["away_win"] * 100, 1),
        }
    }


async def _prediction_card_fields(home_team: str, away_team: str, league_key: str) -> Dict[str, Any]:
    """Return optional card-ready model fields without inventing unavailable data."""
    if not home_team or not away_team:
        return {}

    try:
        prediction = await predict_match(
            PredictionRequest(home_team=home_team, away_team=away_team, league=league_key)
        )
    except Exception as exc:
        logger.debug(f"Skipping card prediction for {home_team} vs {away_team}: {exc}")
        return {}

    probabilities = prediction.get("probabilities") or {}
    required = ("home_win", "draw", "away_win")
    if not all(isinstance(probabilities.get(key), (int, float)) for key in required):
        return {}

    fields: Dict[str, Any] = {
        "predicted_home_win": round(float(probabilities["home_win"]) / 100.0, 4),
        "predicted_draw": round(float(probabilities["draw"]) / 100.0, 4),
        "predicted_away_win": round(float(probabilities["away_win"]) / 100.0, 4),
    }

    if isinstance(prediction.get("predicted_home_goals"), (int, float)):
        fields["predicted_home_goals"] = round(float(prediction["predicted_home_goals"]), 2)
    if isinstance(prediction.get("predicted_away_goals"), (int, float)):
        fields["predicted_away_goals"] = round(float(prediction["predicted_away_goals"]), 2)
    if isinstance(prediction.get("confidence"), (int, float)):
        fields["confidence"] = round(float(prediction["confidence"]) / 100.0, 4)
    if prediction.get("model_used"):
        fields["prediction_model"] = prediction["model_used"]
    if prediction.get("recommended_action"):
        fields["recommended_action"] = prediction["recommended_action"]

    return fields


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
                
                card = {
                    "match_id": match.get("id"),
                    "home_team": home_team,
                    "away_team": away_team,
                    "date": status_info.get("utcTime", ""),
                    "time": status_info.get("utcTime", ""),
                    "actual_home_goals": home_score,
                    "actual_away_goals": away_score,
                    "status": status,
                    "round": match.get("round", ""),
                }
                card.update(await _prediction_card_fields(home_team, away_team, league_key))
                calendar.append(card)
        
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
