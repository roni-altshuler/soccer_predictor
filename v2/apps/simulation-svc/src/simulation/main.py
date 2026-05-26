"""simulation-svc entrypoint.

Stub. Ray actor + MC engine ports from v1 league_simulator/knockout_simulator in the next phase.
"""
from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="FotPredict Simulation Service", version="0.1.0")

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "simulation-svc"}

    return app


app = create_app()
