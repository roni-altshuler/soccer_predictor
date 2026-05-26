"""prediction-svc entrypoint.

Stub. Real pipeline (feature builder -> Triton ensemble call -> isotonic
calibration -> MatchPrediction schema) ports from v1
backend/services/prediction/unified_inference.py in the next phase.
"""
from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="FotPredict Prediction Service", version="0.1.0")

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "prediction-svc"}

    return app


app = create_app()
