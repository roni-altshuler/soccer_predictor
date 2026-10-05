"""Small shared failure and atomic-cache helpers for ingestion CLIs."""
import json
import os
from pathlib import Path
import tempfile


class ProviderUnavailable(RuntimeError):
    """A provider failed or returned invalid data, rather than a valid empty list."""


def valid_player_identity(player: dict, id_key: str, *name_keys: str) -> bool:
    """Require a usable ID or name; reject malformed supplied identity fields."""
    identifier = player.get(id_key)
    if identifier is not None:
        if isinstance(identifier, bool) or not isinstance(identifier, (int, str)):
            return False
        if isinstance(identifier, int) and identifier <= 0:
            return False
        if isinstance(identifier, str) and not identifier.strip():
            return False
    names = [player.get(key) for key in name_keys]
    if any(name is not None and (not isinstance(name, str) or not name.strip()) for name in names):
        return False
    return identifier is not None or any(name is not None for name in names)


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         delete=False) as fh:
            temporary = Path(fh.name)
            json.dump(payload, fh, indent=2, ensure_ascii=False, allow_nan=False)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
