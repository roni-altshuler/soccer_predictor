#!/usr/bin/env python3
"""Fetch only explicitly approved, provider-qualified player portraits.

No warehouse ID guessing or cross-provider fallback. An approval records the
subject, asset identity, verified mapping, source URL and permission evidence.
Unknown records are blocked before any request, including with --force.
Existing assets are retained; new versions use content-addressed filenames.

Example (requires separately verified approvals; none are supplied here):
    python -m backend.scripts.fetch_player_headshots \
        --ids espn:45843 --approvals /path/to/reviewed-approvals.json
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import time
from typing import Iterable

import requests
from PIL import Image

from backend.services.data.player_portraits import (
    HEADSHOT_DIR, approved_portrait, cached_portrait, identity_key, parse_identity, read_manifest,
)
from backend.services.data.provider_status import write_json_atomic

PUBLIC_HEADSHOT_DIR = HEADSHOT_DIR
MANIFEST_PATH = PUBLIC_HEADSHOT_DIR / "manifest.json"
HEADERS = {"User-Agent": "Pitchverse/1.0 (+https://github.com/roni-altshuler/soccer_predictor)"}
SLEEP_BETWEEN_REQUESTS = 0.15
TIMEOUT_SECONDS = 8
TARGET_SIZE = (192, 192)


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")


def _resize_to_webp(content: bytes) -> bytes:
    with Image.open(io.BytesIO(content)) as original:
        image = original.convert("RGBA")
        image.thumbnail(TARGET_SIZE, Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        image.save(buf, format="WEBP", quality=88, method=6)
        return buf.getvalue()


def _fetch_one(identity: dict, approval: dict | None) -> bytes | None:
    entry = approved_portrait(identity, approval, published=False)
    if not entry:
        return None
    # Exactly the approved asset's own provider/ID. A failed request does not
    # try the subject's digits against another provider.
    try:
        response = requests.get(entry["source_url"], headers=HEADERS,
                                timeout=TIMEOUT_SECONDS, allow_redirects=False)
        try:
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if response.status_code == 200 and content_type.startswith("image/") and response.content:
                return response.content
            _log(f'Unavailable approved portrait {identity_key(identity)}: HTTP {response.status_code}')
        finally:
            response.close()
    except requests.RequestException as exc:
        _log(f"Portrait request failed: {exc}")
    return None


def _write_new_asset(target: Path, content: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.parent.resolve().is_relative_to(PUBLIC_HEADSHOT_DIR.resolve()):
        raise ValueError("Portrait asset escaped its directory")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            # Unlike replace(), link() cannot overwrite an existing asset.
            os.link(temporary, target)
        except FileExistsError:
            if target.read_bytes() != content:
                raise ValueError("Existing portrait digest path has different bytes")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def fetch_all(ids: Iterable[str], force: bool = False, approvals: dict | None = None) -> dict:
    identities = [parse_identity(key) for key in dict.fromkeys(ids)]
    if approvals is not None and not isinstance(approvals, dict):
        raise ValueError("Portrait approvals must be an object")
    manifest = read_manifest(MANIFEST_PATH)
    approvals = approvals or {}
    changed = False
    fields = ("subject", "asset", "subject_verified", "subject_evidence", "rights", "crosswalk", "source_url")
    for identity in identities:
        key = identity_key(identity)
        approval = approved_portrait(identity, approvals.get(key), published=False)
        if not approval:
            _log(f"Blocked portrait {key}: verified subject and permission evidence required")
            continue
        cached = cached_portrait(identity, manifest, PUBLIC_HEADSHOT_DIR)
        if cached and not force and all(cached.get(field) == approval.get(field) for field in fields):
            continue
        content = _fetch_one(identity, approval)
        if content is None:
            continue
        try:
            webp = _resize_to_webp(content)
            digest = hashlib.sha256(webp).hexdigest()
            asset = approval["asset"]
            relative = f'{asset["provider"]}/{asset["id"]}-{digest}.webp'
            _write_new_asset(PUBLIC_HEADSHOT_DIR / relative, webp)
        except (OSError, ValueError) as exc:
            _log(f"Portrait conversion/cache failed for {key}: {exc}")
            continue
        manifest[key] = {**deepcopy(approval), "sha256": digest, "path": f"/headshots/{relative}"}
        changed = True
        time.sleep(SLEEP_BETWEEN_REQUESTS)
    if changed:
        # Retain every legacy entry and asset; the renderer ignores unverified
        # rows. A failed manifest write leaves old content-addressed files intact.
        write_json_atomic(MANIFEST_PATH, manifest)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Refresh approved assets; never bypass verification")
    parser.add_argument("--ids", required=True, help="Comma-separated qualified IDs, e.g. espn:45843")
    parser.add_argument("--approvals", type=Path, required=True, help="Reviewed subject/rights records keyed by provider:id")
    args = parser.parse_args()
    try:
        if not args.approvals.is_file():
            raise ValueError("Approval file is missing")
        approvals = read_manifest(args.approvals)
        ids = [key.strip() for key in args.ids.split(",") if key.strip()]
        if not ids:
            raise ValueError("At least one qualified ID is required")
        fetch_all(ids, force=args.force, approvals=approvals)
    except (OSError, ValueError) as exc:
        _log(str(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
