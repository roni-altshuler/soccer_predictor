#!/usr/bin/env python3
"""
fetch_team_badges.py
====================
Pull club crests from FotMob and ESPN, resize to 96x96 WebP, and write them
to ``public/badges/<team_id>.webp`` with a manifest at
``public/badges/manifest.json``.

Frontend reads the manifest via the ``useTeamBadgeManifest`` hook in
``src/hooks/useHeadshotManifest.ts`` and renders crests through the
``<TeamBadge>`` primitive with an initials fallback when missing.

Usage:
    /home/ronaltshuler/code/.venv/bin/python backend/scripts/fetch_team_badges.py
    /home/ronaltshuler/code/.venv/bin/python backend/scripts/fetch_team_badges.py --ids 8650,9825 --force

Sources (priority order):
    1. FotMob: https://images.fotmob.com/image_resources/logo/teamlogo/<id>.png
    2. ESPN:   https://a.espncdn.com/i/teamlogos/soccer/500/<id>.png

The script is idempotent; lower-league teams 404 cleanly and ``TeamBadge``
falls back to a team-color initials chip.
"""
from __future__ import annotations

import argparse
import io
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Iterable

import requests
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_BADGE_DIR = REPO_ROOT / "public" / "badges"
MANIFEST_PATH = PUBLIC_BADGE_DIR / "manifest.json"
WAREHOUSE_PATH = REPO_ROOT / "backend" / "data" / "warehouse.sqlite"

SOURCES = [
    ("fotmob", "https://images.fotmob.com/image_resources/logo/teamlogo/{}.png"),
    ("espn", "https://a.espncdn.com/i/teamlogos/soccer/500/{}.png"),
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux) FotPredict-AI/2.3 (+https://github.com/ronaltshuler/soccer_predictor)"
    )
}

SLEEP_BETWEEN_REQUESTS = 0.12
TIMEOUT_SECONDS = 8
TARGET_SIZE = (96, 96)


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _load_team_ids_from_warehouse() -> list[str]:
    if not WAREHOUSE_PATH.exists():
        _log(f"WARN: warehouse not found at {WAREHOUSE_PATH}; nothing to do.")
        return []
    con = sqlite3.connect(str(WAREHOUSE_PATH))
    try:
        cur = con.cursor()
        candidates = ("teams", "team", "matches")
        ids: set[str] = set()
        for table in candidates:
            for col in ("team_id", "home_team_id", "away_team_id", "id"):
                try:
                    cur.execute(f"SELECT DISTINCT {col} FROM {table} WHERE {col} IS NOT NULL")
                    for (tid,) in cur.fetchall():
                        if tid is not None:
                            ids.add(str(int(tid)) if isinstance(tid, (int, float)) else str(tid))
                except sqlite3.Error:
                    continue
        return sorted(ids, key=lambda s: int(s) if s.isdigit() else hash(s))
    finally:
        con.close()


def _existing_manifest() -> dict[str, str]:
    if not MANIFEST_PATH.exists():
        return {}
    try:
        return json.loads(MANIFEST_PATH.read_text())
    except json.JSONDecodeError:
        return {}


def _save_manifest(manifest: dict[str, str]) -> None:
    PUBLIC_BADGE_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def _resize_to_webp(content: bytes) -> bytes:
    image = Image.open(io.BytesIO(content))
    image = image.convert("RGBA")
    image.thumbnail(TARGET_SIZE, Image.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="WEBP", quality=90, method=6)
    return buf.getvalue()


def _fetch_one(team_id: str) -> bytes | None:
    for source, url_template in SOURCES:
        url = url_template.format(team_id)
        try:
            response = requests.get(url, headers=HEADERS, timeout=TIMEOUT_SECONDS, stream=True)
        except requests.RequestException as exc:
            _log(f"  {source}: request failed for {team_id}: {exc}")
            continue
        if response.status_code == 200 and response.content:
            _log(f"  ok {source} {team_id}")
            return response.content
        if response.status_code != 404:
            _log(f"  {source} HTTP {response.status_code} for {team_id}")
    return None


def fetch_all(ids: Iterable[str], force: bool = False) -> dict[str, str]:
    PUBLIC_BADGE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = _existing_manifest()
    ok = 0
    skipped = 0
    failed = 0
    for team_id in ids:
        target = PUBLIC_BADGE_DIR / f"{team_id}.webp"
        if target.exists() and not force:
            manifest[team_id] = f"/badges/{team_id}.webp"
            skipped += 1
            continue
        content = _fetch_one(team_id)
        if not content:
            failed += 1
            continue
        try:
            target.write_bytes(_resize_to_webp(content))
        except Exception as exc:
            _log(f"  resize failed for {team_id}: {exc}")
            failed += 1
            continue
        manifest[team_id] = f"/badges/{team_id}.webp"
        ok += 1
        time.sleep(SLEEP_BETWEEN_REQUESTS)
    _save_manifest(manifest)
    _log(f"\nDone. fetched={ok} skipped={skipped} failed={failed} manifest={MANIFEST_PATH}")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Re-download even if file already exists")
    parser.add_argument(
        "--ids",
        type=str,
        default=None,
        help="Comma-separated team IDs to fetch (instead of reading from warehouse)",
    )
    args = parser.parse_args()

    if args.ids:
        ids = [s.strip() for s in args.ids.split(",") if s.strip()]
    else:
        ids = _load_team_ids_from_warehouse()
    if not ids:
        _log("No team IDs to process. Pass --ids or populate the warehouse first.")
        return 0
    _log(f"Processing {len(ids)} team ids (force={args.force})...")
    fetch_all(ids, force=args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
