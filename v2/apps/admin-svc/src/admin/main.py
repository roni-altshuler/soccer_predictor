"""admin-svc entrypoint.

Stub. Promotion endpoints + ingestion-run inspectors land in the next phase.
"""
from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="FotPredict Admin Service", version="0.1.0")

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "admin-svc"}

    return app


app = create_app()
