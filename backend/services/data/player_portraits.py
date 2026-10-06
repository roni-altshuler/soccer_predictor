"""Explicit identity/permission records for local player portraits; no requests."""
import hashlib
import json
from pathlib import Path
import re

PROVIDERS = {"espn", "fotmob"}
SOURCE_TEMPLATES = {
    "espn": "https://a.espncdn.com/i/headshots/soccer/players/full/{}.png",
    "fotmob": "https://images.fotmob.com/image_resources/playerimages/{}.png",
}
HEADSHOT_DIR = Path(__file__).resolve().parents[3] / "public" / "headshots"


def identity_key(identity) -> str | None:
    if (not isinstance(identity, dict) or not isinstance(identity.get("provider"), str)
            or identity.get("provider") not in PROVIDERS):
        return None
    identifier = identity.get("id")
    if not isinstance(identifier, str) or not re.fullmatch(r"[1-9][0-9]*", identifier):
        return None
    return f'{identity["provider"]}:{identifier}'


def parse_identity(key: str) -> dict:
    provider, separator, identifier = key.partition(":")
    identity = {"provider": provider, "id": identifier}
    if not separator or identity_key(identity) != key:
        raise ValueError("Use a provider-qualified player ID, for example espn:45843")
    return identity


def _evidence(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def approved_portrait(identity, entry, *, published: bool = True) -> dict | None:
    """Require explicit subject/rights evidence, never infer it from a CDN URL."""
    key = identity_key(identity)
    if not key or not isinstance(entry, dict) or identity_key(entry.get("subject")) != key:
        return None
    asset = entry.get("asset")
    asset_key = identity_key(asset)
    if not asset_key or entry.get("subject_verified") is not True or not _evidence(entry.get("subject_evidence")):
        return None
    rights = entry.get("rights")
    if not isinstance(rights, dict) or rights.get("status") != "permitted" or not _evidence(rights.get("evidence")):
        return None
    crosswalk = entry.get("crosswalk")
    if asset_key != key or crosswalk is not None:
        if (not isinstance(crosswalk, dict) or crosswalk.get("verified") is not True
                or identity_key(crosswalk.get("subject")) != key
                or identity_key(crosswalk.get("asset")) != asset_key
                or not _evidence(crosswalk.get("evidence"))):
            return None
    if entry.get("source_url") != SOURCE_TEMPLATES[asset["provider"]].format(asset["id"]):
        return None
    if published:
        digest = entry.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            return None
        expected = f'/headshots/{asset["provider"]}/{asset["id"]}-{digest}.webp'
        if entry.get("path") != expected:
            return None
    return entry


def read_manifest(path: Path) -> dict:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Portrait manifest must be an object")
    return payload


def cached_portrait(identity, manifest: dict, directory: Path = HEADSHOT_DIR) -> dict | None:
    entry = approved_portrait(identity, manifest.get(identity_key(identity)))
    if not entry:
        return None
    target = directory / entry["path"].removeprefix("/headshots/")
    try:
        if (not target.resolve().is_relative_to(directory.resolve())
                or hashlib.sha256(target.read_bytes()).hexdigest() != entry["sha256"]):
            return None
    except OSError:
        return None
    return entry


def player_portrait(identity, directory: Path = HEADSHOT_DIR) -> dict | None:
    try:
        return cached_portrait(identity, read_manifest(directory / "manifest.json"), directory)
    except (OSError, ValueError):
        return None
