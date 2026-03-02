"""API v1 router."""

from fastapi import APIRouter

from backend.api.v1.matches import router as matches_router
from backend.api.v1.predictions import router as predictions_router
from backend.api.v1.teams import router as teams_router
from backend.api.v1.leagues import router as leagues_router
from backend.api.v1.auth import router as auth_router
from backend.api.v1.knockout import router as knockout_router
from backend.api.v1.weather import router as weather_router
from backend.api.v1.referee import router as referee_router
from backend.api.v1.tracking import router as tracking_router
from backend.api.v1.training import router as training_router

router = APIRouter(prefix="/api/v1")

router.include_router(matches_router)
router.include_router(predictions_router)
router.include_router(teams_router)
router.include_router(leagues_router)
router.include_router(auth_router)
router.include_router(knockout_router)
router.include_router(weather_router)
router.include_router(referee_router)
router.include_router(tracking_router)
router.include_router(training_router)
