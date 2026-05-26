"""Cold archiver — Postgres → Cloudflare R2 (Parquet).

Run monthly to:

1. Dump each archivable table/partition to Parquet (zstd-compressed)
2. Upload to ``s3://{bucket}/archive/{schema}/{table}/year={Y}/month={M}/data.parquet``
3. Verify the object exists + checksum
4. DETACH or DELETE the partition from the hot table
5. Record the move in ``core.archive_manifest``

Designed to run on a free-tier R2 account. Uses ``boto3`` with the S3-compatible
R2 endpoint.

Usage::

    python -m backend.pipeline.workers.archiver --dry-run
    python -m backend.pipeline.workers.archiver --month 2024-01
    python -m backend.pipeline.workers.archiver --table fact_match_events --month 2024-01

The retention plan lives in :data:`RETENTION_POLICY`. Tables not listed there
are never auto-archived.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    PYARROW_AVAILABLE = True
except Exception:  # pragma: no cover
    pa = None  # type: ignore[assignment]
    pq = None  # type: ignore[assignment]
    PYARROW_AVAILABLE = False

try:
    import boto3
    BOTO3_AVAILABLE = True
except Exception:  # pragma: no cover
    boto3 = None  # type: ignore[assignment]
    BOTO3_AVAILABLE = False


@dataclass(frozen=True)
class RetentionEntry:
    schema: str
    table: str
    hot_months: int                      # keep last N months hot
    partition_key: str                   # column used for partitioning
    partitioned: bool                    # whether the table itself is partitioned


RETENTION_POLICY: tuple[RetentionEntry, ...] = (
    RetentionEntry("core", "fact_matches", hot_months=60, partition_key="kickoff_utc", partitioned=True),
    RetentionEntry("core", "fact_match_events", hot_months=18, partition_key="source_ts", partitioned=True),
    RetentionEntry("core", "fact_standings_snapshot", hot_months=24, partition_key="snapshot_date", partitioned=False),
    RetentionEntry("core", "fact_player_stats_match", hot_months=120, partition_key="match_id", partitioned=False),
    RetentionEntry("core", "ingest_runs", hot_months=3, partition_key="started_at", partitioned=False),
)


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _next_month(d: date) -> date:
    return date(d.year + (d.month // 12), (d.month % 12) + 1, 1)


def _r2_client():
    if not BOTO3_AVAILABLE:
        raise RuntimeError("boto3 not installed")
    from backend.pipeline.settings import get_pipeline_settings
    s = get_pipeline_settings()
    if not (s.r2_endpoint_url and s.r2_access_key_id and s.r2_secret_access_key and s.r2_bucket):
        raise RuntimeError("R2_* env vars not fully configured")
    return boto3.client(
        "s3",
        endpoint_url=s.r2_endpoint_url,
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        region_name="auto",
    ), s.r2_bucket


def _r2_object_key(schema: str, table: str, month: date) -> str:
    return f"archive/{schema}/{table}/year={month.year}/month={month.month:02d}/data.parquet"


def archive_month(
    entry: RetentionEntry,
    month: date,
    *,
    dry_run: bool = False,
) -> dict:
    """Archive a single month's partition for one table. Idempotent."""
    if not PYARROW_AVAILABLE:
        raise RuntimeError("pyarrow not installed; cannot write Parquet")

    from backend.pipeline.pg.warehouse import get_pg_warehouse
    pg = get_pg_warehouse()
    if pg is None:
        raise RuntimeError("DATABASE_URL not set")

    start = _month_start(month)
    end = _next_month(start)

    result = {
        "schema": entry.schema,
        "table": entry.table,
        "month": start.isoformat(),
        "rows": 0,
        "bytes": 0,
        "uploaded": False,
        "deleted_from_hot": False,
        "r2_key": _r2_object_key(entry.schema, entry.table, start),
    }

    # 1) Stream rows out of Postgres into an Arrow table
    select_cols = "*"
    where = f"{entry.partition_key} >= %s AND {entry.partition_key} < %s"
    sql = f"SELECT {select_cols} FROM {entry.schema}.{entry.table} WHERE {where}"

    with pg.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, (start, end))
        cols = [d.name for d in cur.description] if cur.description else []
        rows = cur.fetchall()
    if not rows:
        logger.info("No rows to archive for %s.%s @ %s", entry.schema, entry.table, start)
        return result

    table = pa.Table.from_pylist([dict(zip(cols, r)) for r in rows])
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    body = buf.getvalue()
    sha = hashlib.sha256(body).hexdigest()
    result["rows"] = len(rows)
    result["bytes"] = len(body)

    if dry_run:
        logger.info(
            "[dry-run] would upload %d rows / %d bytes to %s",
            result["rows"], result["bytes"], result["r2_key"],
        )
        return result

    # 2) Upload to R2
    client, bucket = _r2_client()
    client.put_object(
        Bucket=bucket,
        Key=result["r2_key"],
        Body=body,
        ContentType="application/vnd.apache.parquet",
        Metadata={"sha256": sha, "rows": str(result["rows"])},
    )
    # verify
    head = client.head_object(Bucket=bucket, Key=result["r2_key"])
    if head.get("Metadata", {}).get("sha256") != sha:
        raise RuntimeError("R2 object metadata mismatch — refusing to delete from hot")
    result["uploaded"] = True

    # 3) Record manifest + remove hot
    with pg.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO core.archive_manifest
                (schema_name, table_name, partition_key, r2_object_key, rows, bytes, sha256)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (schema_name, table_name, partition_key) DO UPDATE SET
                r2_object_key = EXCLUDED.r2_object_key,
                rows = EXCLUDED.rows,
                bytes = EXCLUDED.bytes,
                sha256 = EXCLUDED.sha256,
                archived_at = now()
            """,
            (
                entry.schema, entry.table, start.isoformat(),
                result["r2_key"], result["rows"], result["bytes"], sha,
            ),
        )
        if entry.partitioned:
            part_name = f"{entry.table}_{start.strftime('%Y_%m')}"
            cur.execute(
                f"ALTER TABLE {entry.schema}.{entry.table} DETACH PARTITION {entry.schema}.{part_name}"
            )
            cur.execute(f"DROP TABLE {entry.schema}.{part_name}")
        else:
            cur.execute(
                f"DELETE FROM {entry.schema}.{entry.table} WHERE {entry.partition_key} >= %s AND {entry.partition_key} < %s",
                (start, end),
            )
        conn.commit()
    result["deleted_from_hot"] = True
    return result


def archive_due(*, today: Optional[date] = None, dry_run: bool = False) -> list[dict]:
    """Archive every partition older than its policy retention."""
    today = today or datetime.now(timezone.utc).date()
    results: list[dict] = []
    for entry in RETENTION_POLICY:
        cutoff = _month_start(today) - timedelta(days=30 * entry.hot_months)
        cutoff = _month_start(cutoff)
        # archive everything between (oldest existing partition) and cutoff (exclusive).
        # For simplicity, archive just the one month right before cutoff each run.
        target = _month_start(cutoff - timedelta(days=1))
        try:
            results.append(archive_month(entry, target, dry_run=dry_run))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Archive failed for %s.%s @ %s: %s", entry.schema, entry.table, target, exc)
            results.append({
                "schema": entry.schema, "table": entry.table,
                "month": target.isoformat(), "error": str(exc),
            })
    return results


def _main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Postgres → R2 archiver")
    parser.add_argument("--month", help="YYYY-MM partition month to archive")
    parser.add_argument("--table", help="table name; defaults to all due tables")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args(argv)
    logging.basicConfig(level=args.log_level, format="%(levelname)s %(name)s: %(message)s")

    if args.month:
        try:
            month = date.fromisoformat(args.month + "-01")
        except ValueError:
            logger.error("--month must be YYYY-MM")
            return 1
        entries = [e for e in RETENTION_POLICY if not args.table or e.table == args.table]
        for entry in entries:
            try:
                r = archive_month(entry, month, dry_run=args.dry_run)
                logger.info("%s.%s @ %s → %s", entry.schema, entry.table, month, r)
            except Exception as exc:  # noqa: BLE001
                logger.exception("failed: %s", exc)
        return 0

    results = archive_due(dry_run=args.dry_run)
    for r in results:
        logger.info("%s", r)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main())
