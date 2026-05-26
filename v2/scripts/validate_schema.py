#!/usr/bin/env python3
"""Syntax-validate the Alembic baseline migration using libpg_query (pglast).

We can't always run against a live Postgres in this environment (no Docker /
local PG), so we extract the raw SQL blocks from the migration and round-trip
them through the actual PostgreSQL parser. This catches every grammar error,
including TimescaleDB function-call shape and gender-partitioned hypertable
PK rules, but does NOT catch semantic problems (e.g. wrong column type for
an FK).

Live-DB validation runs via `make migrate` once the local stack
(infra/local/docker-compose.yml) is up. The migration is the single source of
truth — this script imports it from packages/fotpredict-db rather than
re-parsing the file.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pglast

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "packages" / "fotpredict-db" / "src"))

from fotpredict_db.ddl import UPGRADE_BLOCKS  # noqa: E402


def main() -> int:
    failures: list[tuple[str, str, Exception]] = []
    total_stmts = 0

    for name, ddl in UPGRADE_BLOCKS:
        try:
            parsed = pglast.parse_sql(ddl)
        except pglast.parser.ParseError as exc:
            failures.append((name, "<block>", exc))
            continue
        block_stmts = len(parsed)
        total_stmts += block_stmts
        print(f"  ok  {name:<22} ({block_stmts:>3} statements)")

    print()
    if failures:
        print(f"FAILED: {len(failures)} block(s) had parse errors")
        for name, _stmt, exc in failures:
            print(f"  - {name}: {exc}")
        return 1

    print(f"OK: {len(UPGRADE_BLOCKS)} blocks, {total_stmts} statements parsed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
