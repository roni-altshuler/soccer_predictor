"""Initial core schema.

Revision ID: 001_initial_core
Revises:
Create Date: 2026-05-24

Applies the full set of DDL statements in :mod:`backend.pipeline.pg.schema`.
Each statement uses ``IF NOT EXISTS`` so the migration is idempotent — running
``alembic upgrade head`` on a partially-populated database is safe.

Down-grade is intentionally a single ``DROP SCHEMA ... CASCADE`` per schema.
"""
from __future__ import annotations

from alembic import op

from backend.pipeline.pg.schema import ALL_DDL, SCHEMAS

revision = "001_initial_core"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    for stmt in ALL_DDL:
        op.execute(stmt)


def downgrade() -> None:
    for schema in reversed(SCHEMAS):
        op.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
