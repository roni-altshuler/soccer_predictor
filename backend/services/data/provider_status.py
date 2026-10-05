"""Small shared failure and atomic-cache helpers for ingestion CLIs."""
import json
import os
from pathlib import Path
import tempfile


class ProviderUnavailable(RuntimeError):
    """A provider failed or returned invalid data, rather than a valid empty list."""


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
