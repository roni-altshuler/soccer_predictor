"""Explicit small coverage audit. Does not write the warehouse or run training.

python -m backend.scripts.audit_openfootball --source-commit <40-char SHA> \
    --sample en.1:2026 --sample fr.1:2025 --cache-dir /tmp/of-observations
"""

import argparse
import asyncio
import json
import sys
from dataclasses import asdict
from pathlib import Path

import httpx

from backend.services.data.openfootball_adapter import OpenFootballAdapter, _selection
from backend.services.data.provider_status import ProviderUnavailable


def selection(value: str) -> tuple[str, int]:
    try:
        competition, year = value.split(":")
        return competition, int(year)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "use source-league-code:start-year, e.g. en.1:2026"
        ) from exc


async def audit(args) -> dict:
    samples = list(dict.fromkeys(args.sample))
    if len(samples) > 5:
        raise ProviderUnavailable(
            "audit requires at most five explicit league-season samples"
        )
    # Validate the entire selection before the first network request.
    for competition, year in samples:
        _selection(args.source_commit, competition, year)
    async with httpx.AsyncClient(
        headers={"User-Agent": "SoccerPredictor-OpenFootballAudit/1"}
    ) as client:
        adapter = OpenFootballAdapter(client, cache_dir=args.cache_dir, max_requests=6)
        reports = []
        for competition, year in samples:
            snapshot = await adapter.read(
                source_commit=args.source_commit,
                competition=competition,
                season_start_year=year,
            )
            reports.append(
                {
                    "competition_id": snapshot.competition_id,
                    "season_start_year": year,
                    "provenance": asdict(snapshot.provenance),
                    "coverage": asdict(snapshot.coverage),
                }
            )
        return {
            "schema_version": "openfootball-audit/v1",
            "requests_used": adapter.requests_used,
            "samples": reports,
        }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--sample", action="append", type=selection, required=True)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(asyncio.run(audit(args)), indent=2, ensure_ascii=False))
    except (ProviderUnavailable, OSError) as exc:
        print(f"OpenFootball audit failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
