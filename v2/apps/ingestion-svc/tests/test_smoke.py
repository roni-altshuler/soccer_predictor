"""Smoke test: the FastAPI app boots and healthz is registered."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def test_app_boots() -> None:
    if importlib.util.find_spec("fastapi") is None:
        pytest.skip("fastapi not installed in this scaffold environment")
    from ingestion.main import app  # noqa: PLC0415

    routes = {r.path for r in app.routes}
    assert "/healthz" in routes
