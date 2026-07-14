"""Unified data warehouse and ingestion layer for FotPredict AI.

This package replaces the JSON-file caching that lives under
`backend/data/historical/` with a single SQLite warehouse
(`backend/data/warehouse.sqlite`) that all ML training and inference
code reads from.

Each `*_loader.py` module knows how to pull one source (ESPN,
football-data.co.uk, ClubElo, OpenFootball, FBref, Understat, Open-Meteo)
and write canonical rows into the warehouse via `warehouse.upsert_matches`
and the related upsert helpers.

Run `python -m backend.scripts.build_warehouse --full` to (re)populate
everything; individual loaders can also be invoked directly for
incremental refreshes.
"""

from backend.services.data.warehouse import (
    WAREHOUSE_PATH,
    MatchEvent,
    Warehouse,
    open_warehouse,
)

__all__ = ["WAREHOUSE_PATH", "MatchEvent", "Warehouse", "open_warehouse"]
