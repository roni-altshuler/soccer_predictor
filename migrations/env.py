"""Alembic environment.

We don't use SQLAlchemy models — migrations execute raw SQL constants from
:mod:`backend.pipeline.pg.schema`. That keeps the canonical schema in one place.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context

# Make the repo root importable so `backend.pipeline.*` resolves.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Allow overriding the DSN from the environment.
dsn = os.getenv("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
if dsn:
    config.set_main_option("sqlalchemy.url", dsn)


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import engine_from_config, pool

    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
