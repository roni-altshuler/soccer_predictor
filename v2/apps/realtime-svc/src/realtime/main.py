"""realtime-svc entrypoint.

Stub. Centrifugo HTTP publisher + stream consumer groups land in the next phase.
"""
from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="FotPredict Realtime Service", version="0.1.0")

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "realtime-svc"}

    return app


app = create_app()
