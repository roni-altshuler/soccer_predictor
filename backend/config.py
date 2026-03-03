"""
Configuration management for Soccer Predictor backend.
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # App settings
    APP_NAME: str = "Soccer Predictor API"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = True
    
    # API settings
    API_PREFIX: str = "/api/v1"
    
    # FotMob API settings
    FOTMOB_BASE_URL: str = "https://www.fotmob.com/api"
    FOTMOB_RATE_LIMIT: int = 60  # requests per minute
    FOTMOB_CACHE_TTL: int = 300  # 5 minutes default
    FOTMOB_LIVE_CACHE_TTL: int = 30  # 30 seconds for live data
    
    # Database settings (for future use)
    DATABASE_URL: Optional[str] = None
    
    # Redis settings (for future caching)
    REDIS_URL: Optional[str] = None
    
    # ML Model settings
    MODEL_PATH: str = "ml/models"
    DEFAULT_ELO: float = 1500.0
    ELO_K_FACTOR: float = 32.0
    
    # CORS settings
    CORS_ORIGINS: list = ["http://localhost:3000", "https://*.vercel.app"]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# League ID mappings for FotMob
LEAGUE_IDS = {
    "premier_league": 47,
    "la_liga": 87,
    "bundesliga": 54,
    "serie_a": 55,
    "ligue_1": 53,
    "eredivisie": 57,
    "primeira_liga": 61,
    "mls": 130,
    "champions_league": 42,
    "europa_league": 73,
    "conference_league": 0,
    "world_cup": 0,
}

# League display names
LEAGUE_NAMES = {
    47: "Premier League",
    87: "La Liga",
    54: "Bundesliga",
    55: "Serie A",
    53: "Ligue 1",
    57: "Eredivisie",
    61: "Primeira Liga",
    130: "MLS",
    42: "Champions League",
    73: "Europa League",
    0: "Conference League",
}

# Country codes for flag display
LEAGUE_COUNTRIES = {
    47: "gb-eng",
    87: "es",
    54: "de",
    55: "it",
    53: "fr",
    57: "nl",
    61: "pt",
    130: "us",
    42: "eu",
    73: "eu",
    0: "eu",
}
