"""Public service exports, loaded only when explicitly requested.

Importing an ingestion submodule must not initialize the prediction stack or
require numerical/ML dependencies. Existing public imports remain supported.
"""

from importlib import import_module

__all__ = [
    "FotMobClient",
    "get_fotmob_client",
    "cleanup_fotmob_client",
    "PredictionService",
    "get_prediction_service",
    "EloRatingSystem",
    "get_elo_system",
]

_MODULES = {
    "FotMobClient": "fotmob", "get_fotmob_client": "fotmob", "cleanup_fotmob_client": "fotmob",
    "PredictionService": "prediction", "get_prediction_service": "prediction",
    "EloRatingSystem": "ratings", "get_elo_system": "ratings",
}


def __getattr__(name):
    if name not in _MODULES:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(f"{__name__}.{_MODULES[name]}"), name)
    globals()[name] = value
    return value
