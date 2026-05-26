"""Standalone DDL blocks for the baseline schema.

Kept Alembic-free so they can be parsed by libpg_query (pglast) without
pulling in the full migration toolchain. The Alembic migration imports
``UPGRADE_BLOCKS`` from here and executes each in order.
"""

from fotpredict_db.ddl.baseline import UPGRADE_BLOCKS, DOWNGRADE_SQL

__all__ = ["UPGRADE_BLOCKS", "DOWNGRADE_SQL"]
