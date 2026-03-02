"""
Prediction tracking API endpoints.

Handles storing predictions, updating outcomes, and retrieving accuracy metrics.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from pydantic import BaseModel

from backend.services.prediction.tracker import get_prediction_tracker

router = APIRouter(prefix="/tracking", tags=["tracking"])


class StorePredictionRequest(BaseModel):
    """Request to store a prediction."""
    match_id: str
    home_team: str
    away_team: str
    league: str
    match_date: str
    home_win_prob: float
    draw_prob: float
    away_win_prob: float
    home_xG: float
    away_xG: float
    confidence: float
    home_elo: Optional[float] = None
    away_elo: Optional[float] = None
    weather_factor: Optional[float] = 1.0
    referee_factor: Optional[float] = 1.0


class UpdateOutcomeRequest(BaseModel):
    """Request to update match outcome."""
    match_id: str
    home_goals: int
    away_goals: int


@router.post("/store")
async def store_prediction(request: StorePredictionRequest):
    """
    Store a prediction before a match.
    
    This should be called when generating a prediction for an upcoming match.
    """
    tracker = get_prediction_tracker()
    
    record = tracker.store_prediction(
        match_id=request.match_id,
        home_team=request.home_team,
        away_team=request.away_team,
        league=request.league,
        match_date=request.match_date,
        home_win_prob=request.home_win_prob,
        draw_prob=request.draw_prob,
        away_win_prob=request.away_win_prob,
        home_xG=request.home_xG,
        away_xG=request.away_xG,
        confidence=request.confidence,
        home_elo=request.home_elo or 0.0,
        away_elo=request.away_elo or 0.0,
        weather_factor=request.weather_factor or 1.0,
        referee_factor=request.referee_factor or 1.0,
    )
    
    return {
        "success": True,
        "match_id": record.match_id,
        "predicted_winner": record.predicted_winner,
        "predicted_scoreline": record.predicted_scoreline,
    }


@router.post("/outcome")
async def update_outcome(request: UpdateOutcomeRequest):
    """
    Update a prediction with the actual match outcome.
    
    This should be called after a match completes.
    """
    tracker = get_prediction_tracker()
    
    record = tracker.update_outcome(
        match_id=request.match_id,
        home_goals=request.home_goals,
        away_goals=request.away_goals,
    )
    
    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"No prediction found for match {request.match_id}"
        )
    
    return {
        "success": True,
        "match_id": record.match_id,
        "predicted_winner": record.predicted_winner,
        "actual_winner": record.actual_winner,
        "winner_correct": record.winner_correct,
        "scoreline_correct": record.scoreline_correct,
        "predicted_scoreline": record.predicted_scoreline,
        "actual_scoreline": f"{record.actual_home_goals}-{record.actual_away_goals}",
    }


@router.get("/prediction/{match_id}")
async def get_prediction(match_id: str):
    """
    Get a stored prediction by match ID.
    
    Returns the prediction and outcome (if completed).
    """
    tracker = get_prediction_tracker()
    record = tracker.get_prediction(match_id)
    
    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"No prediction found for match {match_id}"
        )
    
    return record.to_dict()


@router.get("/recent")
async def get_recent_predictions(
    limit: int = Query(50, ge=1, le=200),
    league: Optional[str] = None,
    completed_only: bool = False,
):
    """
    Get recent predictions.
    
    Args:
        limit: Maximum number of predictions to return
        league: Filter by league
        completed_only: Only return predictions with outcomes
    """
    tracker = get_prediction_tracker()
    predictions = tracker.get_recent_predictions(
        limit=limit,
        league=league,
        completed_only=completed_only,
    )
    
    return {
        "count": len(predictions),
        "predictions": [p.to_dict() for p in predictions],
    }


@router.get("/accuracy")
async def get_accuracy_metrics(
    league: Optional[str] = None,
    days: Optional[int] = Query(None, ge=1, le=365),
):
    """
    Get model accuracy metrics.
    
    Args:
        league: Filter to specific league
        days: Only consider predictions from last N days
    """
    tracker = get_prediction_tracker()
    metrics = tracker.calculate_accuracy_metrics(league=league, days=days)
    
    return metrics.to_dict()


@router.get("/accuracy/by-league")
async def get_accuracy_by_league():
    """
    Get accuracy metrics broken down by league.
    """
    tracker = get_prediction_tracker()
    return tracker.get_league_performance()


@router.get("/model-adjustments")
async def get_model_adjustments():
    """
    Get suggested model adjustments based on prediction performance.
    
    These adjustments can be applied to improve future predictions.
    """
    tracker = get_prediction_tracker()
    adjustments = tracker.get_model_adjustments()
    metrics = tracker.calculate_accuracy_metrics(days=90)
    
    return {
        "adjustments": adjustments,
        "based_on": {
            "total_predictions": metrics.completed_predictions,
            "recent_accuracy": round(metrics.recent_accuracy, 3),
            "brier_score": round(metrics.brier_score, 4),
        },
    }


@router.post("/fetch-outcomes")
async def fetch_outcomes():
    """
    Manually trigger outcome fetching for pending predictions.
    
    Checks ESPN for finished matches and updates stored predictions
    with real results, then updates ELO ratings.
    """
    from backend.services.prediction.outcome_fetcher import get_outcome_fetcher
    
    fetcher = get_outcome_fetcher()
    result = await fetcher.update_pending_predictions()
    return result


@router.get("/outcome-status")
async def outcome_fetcher_status():
    """Get the current status of the automatic outcome fetcher."""
    from backend.services.prediction.outcome_fetcher import get_outcome_fetcher
    
    fetcher = get_outcome_fetcher()
    return fetcher.get_status()


@router.get("/accuracy/trend")
async def get_accuracy_trend(
    window: int = Query(10, ge=5, le=100, description="Rolling window size"),
    league: Optional[str] = None,
):
    """
    Get rolling accuracy trend over time.
    
    Returns accuracy calculated over a rolling window
    so users can see how the model improves.
    """
    tracker = get_prediction_tracker()
    completed = tracker.get_recent_predictions(limit=500, completed_only=True, league=league)
    
    # Sort chronologically
    completed.sort(key=lambda p: p.match_date)
    
    trend = []
    for i in range(window, len(completed) + 1):
        batch = completed[i - window : i]
        correct = sum(1 for p in batch if p.winner_correct)
        accuracy = correct / len(batch)
        trend.append({
            "index": i,
            "date": batch[-1].match_date,
            "accuracy": round(accuracy, 4),
            "correct": correct,
            "total": len(batch),
            "sample_match": f"{batch[-1].home_team} vs {batch[-1].away_team}",
        })
    
    return {
        "window": window,
        "data_points": len(trend),
        "trend": trend,
        "latest_accuracy": trend[-1]["accuracy"] if trend else None,
    }


@router.get("/accuracy/summary")
async def get_accuracy_summary():
    """
    Get comprehensive accuracy summary for the dashboard.
    
    Combines overall metrics, by-league breakdown, trend, and recent predictions.
    """
    tracker = get_prediction_tracker()
    
    overall = tracker.calculate_accuracy_metrics()
    recent_30 = tracker.calculate_accuracy_metrics(days=30)
    by_league = tracker.get_league_performance()
    
    recent_preds = tracker.get_recent_predictions(limit=20, completed_only=True)
    recent_form = ["W" if p.winner_correct else "L" for p in recent_preds]
    
    # Streak calculation
    current_streak = 0
    streak_type = None
    for r in recent_form:
        if streak_type is None:
            streak_type = r
            current_streak = 1
        elif r == streak_type:
            current_streak += 1
        else:
            break
    
    return {
        "overall": overall.to_dict(),
        "last_30_days": recent_30.to_dict(),
        "by_league": by_league,
        "recent_form": recent_form[:10],
        "current_streak": {"type": streak_type or "N/A", "count": current_streak},
        "recent_predictions": [
            {
                "match_id": p.match_id,
                "home_team": p.home_team,
                "away_team": p.away_team,
                "league": p.league,
                "match_date": p.match_date,
                "predicted_winner": p.predicted_winner,
                "predicted_scoreline": p.predicted_scoreline,
                "actual_scoreline": f"{p.actual_home_goals}-{p.actual_away_goals}" if p.actual_home_goals is not None else None,
                "actual_winner": p.actual_winner,
                "winner_correct": p.winner_correct,
                "scoreline_correct": p.scoreline_correct,
                "confidence": p.confidence,
                "home_win_prob": p.predicted_home_win,
                "draw_prob": p.predicted_draw,
                "away_win_prob": p.predicted_away_win,
            }
            for p in recent_preds
        ],
    }
