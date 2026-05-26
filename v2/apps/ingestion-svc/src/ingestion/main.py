"""ingestion-svc entrypoint.

Stub. IngestionSource protocol, source-specific scrapers, normalizers, and Temporal workflows land in the next phase.
"""
from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="FotPredict Ingestion Service", version="0.1.0")

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "ingestion-svc"}

    return app


app = create_app()
