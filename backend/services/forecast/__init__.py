"""Production forecasting: versioning, provenance and live evaluation.

`version`    what model produced a number, hashed from the config that
             determines it rather than from a string someone has to remember
`snapshots`  every forecast we ever published, append-only, so the question
             "what were users shown before that match" stays answerable
`evaluate`   scores the final pre-kickoff snapshot against the result
"""
from backend.services.forecast.version import RELEASE, ModelVersion, compute  # noqa: F401
