"""
Prediction-related API endpoints.
"""

from typing import List, Literal, Optional
from datetime import datetime, timezone
import logging
from fastapi import APIRouter, HTTPException, Query, Body

from backend.services.prediction import get_prediction_service
from backend.services.fotmob import get_fotmob_client
from backend.services.ratings import get_elo_system
from backend.models.prediction import MatchPrediction

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/predictions", tags=["predictions"])


# --- ESPN league → warehouse competition_id map (mirrors espn_loader.py) ---
_LEAGUE_NAME_TO_COMPETITION_ID = {
    "Premier League": "eng.1",
    "La Liga": "esp.1",
    "LALIGA EA SPORTS": "esp.1",
    "Bundesliga": "ger.1",
    "Serie A": "ita.1",
    "Ligue 1": "fra.1",
    "Eredivisie": "ned.1",
    "Primeira Liga": "por.1",
    "Liga Portugal": "por.1",
    "MLS": "usa.1",
    "Major League Soccer": "usa.1",
    "UEFA Champions League": "uefa.champions",
    "Champions League": "uefa.champions",
    "UEFA Europa League": "uefa.europa",
    "Europa League": "uefa.europa",
    "FIFA World Cup": "fifa.world",
    "World Cup": "fifa.world",
    "UEFA European Championship": "uefa.euro",
    "EURO 2024": "uefa.euro",
    "Copa América": "conmebol.america",
    "Copa America": "conmebol.america",
}


def _league_name_to_competition_id(league_name: str) -> Optional[str]:
    """Best-effort mapping from FotMob/ESPN league name → warehouse competition_id."""
    if not league_name:
        return None
    if league_name in _LEAGUE_NAME_TO_COMPETITION_ID:
        return _LEAGUE_NAME_TO_COMPETITION_ID[league_name]
    # Loose substring match (handles things like "English Premier League").
    lname = league_name.lower()
    for known, comp in _LEAGUE_NAME_TO_COMPETITION_ID.items():
        if known.lower() in lname or lname in known.lower():
            return comp
    return None


def _try_unified_prediction(
    *,
    home_team: str,
    away_team: str,
    league_name: str,
    kickoff_time: datetime,
    gender: str,
    match_id: int,
    explain: bool = False,
) -> Optional[MatchPrediction]:
    """Try the unified model. Returns None on any failure so caller can fall back."""
    try:
        from backend.services.prediction.unified_inference import predict_for_fixture
    except Exception as exc:
        logger.debug("Unified inference import failed: %s", exc)
        return None

    comp_id = _league_name_to_competition_id(league_name)
    if not comp_id:
        logger.debug("No competition_id mapping for league %r — skipping unified.", league_name)
        return None

    try:
        pred = predict_for_fixture(
            home_team, away_team, comp_id, league_name,
            kickoff_time, gender=gender, explain=explain,
        )
    except Exception as exc:
        logger.warning("Unified prediction errored for %s vs %s: %s", home_team, away_team, exc)
        return None

    if pred is not None:
        # Backfill the integer match_id we got from FotMob since the inference
        # path doesn't know about it.
        pred.match_id = int(match_id)
    return pred


@router.get("/match/{match_id}")
async def predict_match(
    match_id: int,
    gender: Literal["M", "F"] = Query("M", description="Gender universe: M for men's, F for women's."),
    engine: Literal["auto", "unified", "legacy"] = Query(
        "auto",
        description="Which prediction engine to use. 'auto' tries the unified model first and falls back to legacy.",
    ),
    explain: bool = Query(
        False,
        description="Include per-feature attribution ('why this prediction') in the payload. Unified engine only.",
    ),
):
    """
    Get prediction for a specific match.

    Fetches match data from FotMob to identify the teams + league, then runs
    the unified multi-task model when available (or the legacy ELO-Poisson
    service when not). Use `?engine=legacy` to force the legacy path or
    `?engine=unified` to require the new model.
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

    # Try the unified model first when allowed. It pulls everything it needs
    # from the warehouse, so we can skip the rest of the FotMob plumbing.
    if engine in ("auto", "unified"):
        unified = _try_unified_prediction(
            home_team=home_name, away_team=away_name,
            league_name=league, kickoff_time=kickoff_time,
            gender=gender, match_id=match_id, explain=explain,
        )
        if unified is not None:
            try:
                from backend.services.prediction.tracker import get_prediction_tracker
                tracker = get_prediction_tracker()
                top_scorelines = [
                    {"score": s.score, "probability": s.probability}
                    for s in [unified.most_likely_score, *unified.alternative_scores]
                ]
                tracker.store_prediction(
                    match_id=str(match_id),
                    home_team=home_name,
                    away_team=away_name,
                    league=league,
                    match_date=kickoff_time.isoformat()[:10],
                    home_win_prob=unified.outcome.home_win,
                    draw_prob=unified.outcome.draw,
                    away_win_prob=unified.outcome.away_win,
                    home_xG=unified.goals.home_expected_goals,
                    away_xG=unified.goals.away_expected_goals,
                    confidence=unified.confidence.overall,
                    home_elo=unified.factors.home_elo,
                    away_elo=unified.factors.away_elo,
                    gender=gender,
                    predicted_scoreline=unified.most_likely_score.score,
                    top_scorelines=top_scorelines,
                )
            except Exception as exc:
                logger.warning("Auto-store unified prediction failed: %s", exc)
            return unified
        if engine == "unified":
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Unified model unavailable for {home_name} vs {away_name} "
                    f"(gender={gender}, league={league!r}). Try ?engine=legacy or "
                    f"verify the warehouse + model artifact are present."
                ),
            )

    # Generate prediction (legacy path)
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
            gender=gender,
        )
    except Exception as e:
        logger.warning(f"Auto-store prediction failed: {e}")

    return prediction


@router.get("/unified-by-name", response_model=MatchPrediction)
async def predict_by_team_names(
    home_team: str = Query(..., description="Home team name as the warehouse / aliases know it."),
    away_team: str = Query(..., description="Away team name."),
    competition_id: str = Query(..., description="Warehouse competition_id, e.g. 'eng.1' or 'fifa.world.w'."),
    competition_name: Optional[str] = Query(None, description="Display name; defaults to competition_id."),
    kickoff_utc: Optional[datetime] = Query(None, description="ISO 8601 kickoff time. Defaults to 'now'."),
    gender: Literal["M", "F"] = Query("M"),
):
    """
    Run the unified multi-task model directly for an arbitrary home/away/competition.

    This is the endpoint the new prediction wizard UI calls — it doesn't need a
    FotMob match ID, just team names + a warehouse competition_id. Returns the
    same `MatchPrediction` shape as `/match/{match_id}`.

    Returns 503 if the unified artifact for the requested gender hasn't been
    trained yet (run `python -m backend.scripts.train_unified --gender M/F`).
    """
    from backend.services.prediction.unified_inference import predict_for_fixture

    kickoff = (kickoff_utc or datetime.now(timezone.utc))
    pred = predict_for_fixture(
        home_team, away_team,
        competition_id, competition_name or competition_id,
        kickoff, gender=gender,
    )
    if pred is None:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Unified prediction unavailable: either the {gender}-gender artifact "
                f"is missing or one of '{home_team}'/'{away_team}' is not in the warehouse. "
                "Build the warehouse via `python -m backend.scripts.build_warehouse --full` "
                "and train via `python -m backend.scripts.train_unified --gender M`."
            ),
        )
    return pred


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
