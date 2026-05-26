"""baseline schema (gender_t universes, football domain, hypertables, registry)

Revision ID: 0001
Revises:
Create Date: 2026-05-26 00:00:00.000000

Implements §3 of the v2 blueprint
(~/.claude/plans/act-as-a-senior-iterative-corbato.md).
The DDL itself lives in ``fotpredict_db.ddl.baseline`` so it can be parsed
offline by pglast without pulling Alembic in.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

from fotpredict_db.ddl import DOWNGRADE_SQL, UPGRADE_BLOCKS

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for _name, ddl in UPGRADE_BLOCKS:
        op.execute(ddl)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)
