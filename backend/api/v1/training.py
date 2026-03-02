"""
Model training and management API endpoints.

Provides endpoints for:
- Triggering model retraining on historical data
- Checking training status and metrics
- Viewing model metadata and feature importances
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/training", tags=["training"])

# Track training state
_training_state = {
    "is_training": False,
    "last_result": None,
    "last_error": None,
}


class TrainRequest(BaseModel):
    """Request model for triggering training."""
    leagues: Optional[List[str]] = None
    min_season: int = 2018
    force_fetch: bool = False


class TrainingStatus(BaseModel):
    """Response model for training status."""
    is_training: bool
    last_result: Optional[Dict[str, Any]] = None
    last_error: Optional[str] = None


async def _run_training(leagues, min_season, force_fetch):
    """Background task for model training."""
    global _training_state
    try:
        from backend.services.prediction.training import train_model_pipeline
        result = await train_model_pipeline(
            leagues=leagues,
            min_season=min_season,
            force_fetch=force_fetch,
        )
        _training_state["last_result"] = result
        _training_state["last_error"] = None
        logger.info(f"Training completed: {result.get('status')}")
    except Exception as e:
        _training_state["last_error"] = str(e)
        logger.error(f"Training failed: {e}")
    finally:
        _training_state["is_training"] = False


@router.post("/train")
async def trigger_training(
    request: TrainRequest,
    background_tasks: BackgroundTasks,
):
    """
    Trigger model retraining on historical match data.
    
    This runs as a background task. Check /training/status for progress.
    """
    global _training_state
    
    if _training_state["is_training"]:
        raise HTTPException(
            status_code=409,
            detail="Training is already in progress"
        )
    
    _training_state["is_training"] = True
    _training_state["last_error"] = None
    
    background_tasks.add_task(
        _run_training,
        request.leagues,
        request.min_season,
        request.force_fetch,
    )
    
    return {
        "message": "Training started in background",
        "leagues": request.leagues or "all",
        "min_season": request.min_season,
    }


@router.get("/status")
async def get_training_status() -> TrainingStatus:
    """Get current training status and last results."""
    return TrainingStatus(**_training_state)


@router.get("/model-info")
async def get_model_info():
    """Get information about the currently loaded model."""
    try:
        from backend.services.prediction.training import get_model_trainer
        trainer = get_model_trainer()
        
        return {
            "model_loaded": trainer.model is not None,
            "metadata": trainer.training_metadata,
            "feature_names": trainer.feature_names,
            "feature_count": len(trainer.feature_names),
        }
    except Exception as e:
        return {
            "model_loaded": False,
            "error": str(e),
        }


@router.get("/historical-data")
async def get_historical_data_summary():
    """Get summary of cached historical match data."""
    try:
        from backend.services.prediction.historical_data import get_historical_collector
        collector = get_historical_collector()
        counts = collector.get_cached_match_count()
        total = sum(counts.values())
        
        return {
            "total_matches": total,
            "by_league": counts,
        }
    except Exception as e:
        return {"error": str(e)}
