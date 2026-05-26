"""api-gateway-svc entrypoint.

Stub. Full middleware order (tenant -> auth -> rate-limit -> observability)
and route surface (matches/predictions/simulations/competitions/teams/users/
billing) per blueprint sections 4 and 6 land in the next implementation phase.
"""
from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(
        title="FotPredict API Gateway",
        version="0.1.0",
        description="BFF gateway. See docs/STATUS.md for what is wired vs stubbed.",
    )

    @app.get("/healthz", tags=["meta"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok", "service": "api-gateway-svc"}

    return app


app = create_app()
