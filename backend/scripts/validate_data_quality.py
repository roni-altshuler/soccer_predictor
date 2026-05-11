"""Validate historical data coverage and training-source integrity.

The goal is to fail closed when tournament or current-season source data
disappears. This protects model retraining from silently accepting empty
competition files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
HISTORICAL_DIR = REPO_ROOT / "backend" / "data" / "historical"

REQUIRED_SEASON_MINIMUMS: dict[str, dict[int, int]] = {
    "euro": {
        2000: 31,
        2004: 31,
        2008: 31,
        2012: 31,
        2016: 51,
        2020: 51,
        2024: 51,
    },
    "copa_america": {
        2001: 20,
        2004: 20,
        2007: 20,
        2011: 20,
        2015: 20,
        2016: 30,
        2019: 20,
        2021: 20,
        2024: 30,
    },
    "champions_league": {
        2025: 160,
    },
    "europa_league": {
        2025: 160,
    },
}

REQUIRED_FIELDS = (
    "date",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
    "result",
)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return {"matches": data, "match_count": len(data)}
    if isinstance(data, dict):
        return data
    raise ValueError(f"{path} is not a JSON object or list")


def season_path(league: str, season: int) -> Path:
    return HISTORICAL_DIR / f"{league}_{season}_{season + 1}.json"


def count_matches(data: dict[str, Any]) -> int:
    matches = data.get("matches")
    if not isinstance(matches, list):
        return 0
    return len(matches)


def validate_match_rows(path: Path, matches: list[dict[str, Any]], errors: list[str]) -> None:
    seen_ids: set[str] = set()
    for index, match in enumerate(matches):
        for field in REQUIRED_FIELDS:
            if match.get(field) in (None, ""):
                errors.append(f"{path.name}: row {index} missing {field}")

        match_id = str(match.get("match_id") or "")
        if match_id:
            if match_id in seen_ids:
                errors.append(f"{path.name}: duplicate match_id {match_id}")
            seen_ids.add(match_id)

        result = match.get("result")
        if result not in {"H", "D", "A"}:
            errors.append(f"{path.name}: row {index} has invalid result {result!r}")

        for score_field in ("home_score", "away_score"):
            score = match.get(score_field)
            if not isinstance(score, int) or score < 0:
                errors.append(f"{path.name}: row {index} has invalid {score_field} {score!r}")


def validate_all_files() -> tuple[list[dict[str, Any]], list[str]]:
    summaries: list[dict[str, Any]] = []
    errors: list[str] = []

    for path in sorted(HISTORICAL_DIR.glob("*.json")):
        try:
            data = load_json(path)
        except Exception as exc:
            errors.append(f"{path.name}: cannot parse JSON ({exc})")
            continue

        matches = data.get("matches") if isinstance(data.get("matches"), list) else []
        actual_count = len(matches)
        declared_count = data.get("match_count")
        if declared_count is not None and declared_count != actual_count:
            errors.append(
                f"{path.name}: match_count={declared_count} but matches has {actual_count} rows"
            )

        if matches:
            validate_match_rows(path, matches, errors)

        summaries.append(
            {
                "file": path.name,
                "league": data.get("league"),
                "season": data.get("season"),
                "matches": actual_count,
                "source": data.get("source"),
            }
        )

    return summaries, errors


def validate_required_coverage(errors: list[str]) -> list[dict[str, Any]]:
    coverage: list[dict[str, Any]] = []

    for league, seasons in REQUIRED_SEASON_MINIMUMS.items():
        for season, minimum in seasons.items():
            path = season_path(league, season)
            if not path.exists():
                errors.append(f"{path.name}: required source file is missing")
                coverage.append(
                    {
                        "league": league,
                        "season": season,
                        "minimum": minimum,
                        "matches": 0,
                        "status": "missing",
                    }
                )
                continue

            data = load_json(path)
            matches = count_matches(data)
            status = "pass" if matches >= minimum else "fail"
            if status == "fail":
                errors.append(
                    f"{path.name}: {matches} matches found, expected at least {minimum}"
                )

            coverage.append(
                {
                    "league": league,
                    "season": season,
                    "minimum": minimum,
                    "matches": matches,
                    "status": status,
                }
            )

    return coverage


def main() -> int:
    if not HISTORICAL_DIR.exists():
        print(json.dumps({"status": "fail", "errors": ["historical data directory missing"]}, indent=2))
        return 1

    summaries, errors = validate_all_files()
    coverage = validate_required_coverage(errors)

    total_historical_matches = sum(item["matches"] for item in summaries)
    result = {
        "status": "pass" if not errors else "fail",
        "historical_files": len(summaries),
        "total_historical_matches": total_historical_matches,
        "required_coverage": coverage,
        "errors": errors,
    }

    print(json.dumps(result, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
