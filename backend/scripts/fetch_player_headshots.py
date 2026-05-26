#!/usr/bin/env python3
"""
fetch_player_headshots.py
=========================
Pull player headshots from FotMob (primary) and ESPN (fallback), resize each
to a 192x192 WebP, and write them to ``public/headshots/<player_id>.webp``.
Also writes a manifest at ``public/headshots/manifest.json`` mapping
``player_id`` -> ``"/headshots/<player_id>.webp"``.

Frontend reads the manifest via the ``useHeadshotManifest`` hook in
``src/hooks/useHeadshotManifest.ts`` and renders headshots through the
``<PlayerAvatar>`` primitive with an initials fallback when the manifest
doesn't carry the player.

Usage:
    /home/ronaltshuler/code/.venv/bin/python backend/scripts/fetch_player_headshots.py
    /home/ronaltshuler/code/.venv/bin/python backend/scripts/fetch_player_headshots.py --force
    /home/ronaltshuler/code/.venv/bin/python backend/scripts/fetch_player_headshots.py --ids 12994,11111

Sources (in priority order):
    1. FotMob: https://images.fotmob.com/image_resources/playerimages/<id>.png
    2. ESPN:   https://a.espncdn.com/i/headshots/soccer/players/full/<id>.png

The script is idempotent: skip-if-exists unless ``--force`` is set. 404s on
lower-league players are logged and tolerated — ``PlayerAvatar`` falls back
to initials without a broken-image flash.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Iterable

import requests
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_HEADSHOT_DIR = REPO_ROOT / "public" / "headshots"
MANIFEST_PATH = PUBLIC_HEADSHOT_DIR / "manifest.json"
WAREHOUSE_PATH = REPO_ROOT / "backend" / "data" / "warehouse.sqlite"

SOURCES = [
    ("fotmob", "https://images.fotmob.com/image_resources/playerimages/{}.png"),
    ("espn", "https://a.espncdn.com/i/headshots/soccer/players/full/{}.png"),
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux) FotPredict-AI/2.3 (+https://github.com/ronaltshuler/soccer_predictor)"
    )
}

SLEEP_BETWEEN_REQUESTS = 0.15  # 150 ms — polite, well under any rate limit
TIMEOUT_SECONDS = 8
TARGET_SIZE = (192, 192)


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _load_player_ids_from_warehouse() -> list[str]:
    if not WAREHOUSE_PATH.exists():
        _log(f"WARN: warehouse not found at {WAREHOUSE_PATH}; nothing to do.")
        return []
    con = sqlite3.connect(str(WAREHOUSE_PATH))
    try:
        # Best-effort: the schema may carry a `squads` or `players` table; we
        # try a few common names and union whatever we find.
        cur = con.cursor()
        candidates = ("squads", "players", "player", "lineups")
        ids: set[str] = set()
        for table in candidates:
            try:
                cur.execute(f"SELECT DISTINCT player_id FROM {table} WHERE player_id IS NOT NULL")
                for (pid,) in cur.fetchall():
                    if pid is not None:
                        ids.add(str(int(pid)) if isinstance(pid, (int, float)) else str(pid))
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
    PUBLIC_HEADSHOT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def _resize_to_webp(content: bytes) -> bytes:
    image = Image.open(io.BytesIO(content))
    image = image.convert("RGBA")
    image.thumbnail(TARGET_SIZE, Image.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="WEBP", quality=88, method=6)
    return buf.getvalue()


def _fetch_one(player_id: str) -> bytes | None:
    for source, url_template in SOURCES:
        url = url_template.format(player_id)
        try:
            response = requests.get(url, headers=HEADERS, timeout=TIMEOUT_SECONDS, stream=True)
        except requests.RequestException as exc:
            _log(f"  {source}: request failed for {player_id}: {exc}")
            continue
        if response.status_code == 200 and response.content:
            _log(f"  ok {source} {player_id}")
            return response.content
        if response.status_code != 404:
            _log(f"  {source} HTTP {response.status_code} for {player_id}")
    return None


def fetch_all(ids: Iterable[str], force: bool = False) -> dict[str, str]:
    PUBLIC_HEADSHOT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = _existing_manifest()
    ok = 0
    skipped = 0
    failed = 0
    for player_id in ids:
        target = PUBLIC_HEADSHOT_DIR / f"{player_id}.webp"
        if target.exists() and not force:
            manifest[player_id] = f"/headshots/{player_id}.webp"
            skipped += 1
            continue
        content = _fetch_one(player_id)
        if not content:
            failed += 1
            continue
        try:
            target.write_bytes(_resize_to_webp(content))
        except Exception as exc:
            _log(f"  resize failed for {player_id}: {exc}")
            failed += 1
            continue
        manifest[player_id] = f"/headshots/{player_id}.webp"
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
        help="Comma-separated player IDs to fetch (instead of reading from warehouse)",
    )
    args = parser.parse_args()

    if args.ids:
        ids = [s.strip() for s in args.ids.split(",") if s.strip()]
    else:
        ids = _load_player_ids_from_warehouse()
    if not ids:
        _log("No player IDs to process. Pass --ids or populate the warehouse first.")
        return 0
    _log(f"Processing {len(ids)} player ids (force={args.force})...")
    fetch_all(ids, force=args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
