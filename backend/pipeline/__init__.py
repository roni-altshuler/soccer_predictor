"""FotPredict AI data pipeline.

Houses the Postgres / Redis / Streams / WebSocket evolution of the original
SQLite-only warehouse in `backend/services/data/`. Designed so that the legacy
SQLite path keeps working until each component is opted-in via environment
flags:

* ``PIPELINE_DUAL_WRITE=true`` makes every existing loader also write to
  Postgres via :mod:`backend.pipeline.pg.warehouse`.
* ``PIPELINE_READ_FROM=pg`` switches FastAPI read paths to Postgres.
* ``PIPELINE_PUBLISH_LIVE=true`` makes the live score service publish to
  Redis Streams instead of (or in addition to) the in-memory cache.

No phase requires a big-bang cutover; each flag flips independently.
"""

from backend.pipeline.settings import PipelineSettings, get_pipeline_settings

__all__ = ["PipelineSettings", "get_pipeline_settings"]
