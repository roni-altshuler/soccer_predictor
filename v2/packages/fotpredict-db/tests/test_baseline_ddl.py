"""Offline invariants for the baseline DDL.

Catches the silent-regression class of bugs you'd otherwise only see
after `make migrate` against a live Postgres + TimescaleDB:

- Every statement parses against the real PostgreSQL grammar (libpg_query).
- Every entity that has gender semantics carries a NOT NULL ``gender`` column.
- TimescaleDB hypertables include their time/partition columns in the PK.
- Downgrade DROPs cover every table CREATEd by the upgrade.
"""
from __future__ import annotations

import re

import pglast
import pytest

from fotpredict_db.ddl import DOWNGRADE_SQL, UPGRADE_BLOCKS

ALL_DDL = "\n".join(ddl for _name, ddl in UPGRADE_BLOCKS)

# Entities that MUST carry a NOT NULL gender column per blueprint §3.7.
GENDER_REQUIRED_TABLES = {
    "competitions",
    "teams",
    "players",
    "matches",
    "predictions",
    "simulations",
    "prediction_models",
}

HYPERTABLE_CALLS = re.findall(
    r"create_hypertable\('(?P<table>[a-z_]+)','(?P<time_col>[a-z_]+)'"
    r"(?:[^)]*partitioning_column\s*=>\s*'(?P<part_col>[a-z_]+)')?",
    ALL_DDL,
)


def _create_table_ddl(table: str) -> str:
    pattern = re.compile(
        rf"CREATE TABLE {table}\s*\((?P<body>.*?)\)\s*;",
        re.DOTALL,
    )
    match = pattern.search(ALL_DDL)
    assert match is not None, f"CREATE TABLE {table} not found in DDL"
    return match.group("body")


@pytest.mark.parametrize("block_name,ddl", UPGRADE_BLOCKS)
def test_block_parses_against_real_pg_grammar(block_name: str, ddl: str) -> None:
    """Each DDL block round-trips through libpg_query without errors."""
    parsed = pglast.parse_sql(ddl)
    assert len(parsed) > 0, f"block {block_name!r} produced zero statements"


@pytest.mark.parametrize("table", sorted(GENDER_REQUIRED_TABLES))
def test_gender_column_is_first_class(table: str) -> None:
    """Every gender-bearing entity has a NOT NULL ``gender gender_t`` column.

    Guards against the v1 footgun where gender was inferred from the league
    join; v2 denormalises it onto every hot table.
    """
    body = _create_table_ddl(table)
    assert re.search(
        r"\bgender\s+gender_t\s+NOT NULL\b",
        body,
    ), f"table {table} missing NOT NULL gender_t column"


def test_predictions_hypertable_is_gender_partitioned() -> None:
    """predictions must be partitioned by gender so men's/women's writes don't collide."""
    pred_calls = [c for c in HYPERTABLE_CALLS if c[0] == "predictions"]
    assert pred_calls, "predictions hypertable creation not found"
    _table, _time_col, part_col = pred_calls[0]
    assert part_col == "gender", (
        "predictions hypertable must be partitioned by gender (got "
        f"{part_col!r}); see ADR-0006"
    )


def test_hypertable_pks_include_time_and_partition_columns() -> None:
    """TimescaleDB requires unique indexes (PKs included) to contain the time
    column and, when set_number_partitions is used, the partitioning column."""
    pk_pattern = re.compile(
        r"CREATE TABLE (?P<table>[a-z_]+)\s*\((?P<body>.*?)PRIMARY KEY\s*\((?P<pk>[^)]+)\)",
        re.DOTALL,
    )
    pk_by_table = {m.group("table"): m.group("pk") for m in pk_pattern.finditer(ALL_DDL)}
    for table, time_col, part_col in HYPERTABLE_CALLS:
        if table not in pk_by_table:
            continue  # hypertables can omit a composite PK; only check when one exists
        pk_cols = {c.strip() for c in pk_by_table[table].split(",")}
        assert time_col in pk_cols, (
            f"{table} hypertable PK {pk_cols!r} missing time column {time_col!r}"
        )
        if part_col:
            assert part_col in pk_cols, (
                f"{table} PK {pk_cols!r} missing partition column {part_col!r}"
            )


def test_downgrade_drops_every_upgrade_table() -> None:
    """Symmetry check: every CREATE TABLE has a matching DROP TABLE in DOWNGRADE_SQL."""
    created = set(re.findall(r"CREATE TABLE (\w+)", ALL_DDL))
    dropped = set(re.findall(r"DROP TABLE IF EXISTS (\w+)", DOWNGRADE_SQL))
    missing = created - dropped
    assert not missing, f"downgrade missing DROPs for: {sorted(missing)}"


def test_downgrade_drops_every_enum_type() -> None:
    """Every CREATE TYPE … AS ENUM has a matching DROP TYPE in DOWNGRADE_SQL."""
    created = set(re.findall(r"CREATE TYPE (\w+) AS ENUM", ALL_DDL))
    dropped = set(re.findall(r"DROP TYPE IF EXISTS (\w+)", DOWNGRADE_SQL))
    missing = created - dropped
    assert not missing, f"downgrade missing DROP TYPEs for: {sorted(missing)}"


def test_no_singletenancy_user_table_uses_text_email() -> None:
    """users.email must be CITEXT — Clerk's emails are case-insensitive on lookup."""
    users_body = _create_table_ddl("users")
    assert re.search(r"\bemail\s+CITEXT\b", users_body), "users.email must be CITEXT"


def test_team_source_aliases_pk_keys_on_source_pair() -> None:
    """team_source_aliases PK = (source, source_team_id) — single-index-hit
    resolution per blueprint §3.7."""
    body = _create_table_ddl("team_source_aliases")
    assert re.search(
        r"PRIMARY KEY\s*\(\s*source\s*,\s*source_team_id\s*\)",
        body,
    ), "team_source_aliases PK must be (source, source_team_id)"
