"""New free-tier data loaders (Phase 7)."""

from backend.pipeline.loaders.statsbomb import StatsBombLoader
from backend.pipeline.loaders.wikidata import WikidataLoader
from backend.pipeline.loaders.api_football import APIFootballLoader
from backend.pipeline.loaders.transfermarkt import TransfermarktLoader

__all__ = [
    "StatsBombLoader",
    "WikidataLoader",
    "APIFootballLoader",
    "TransfermarktLoader",
]
