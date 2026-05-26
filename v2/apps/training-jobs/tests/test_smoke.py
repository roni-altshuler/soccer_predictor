"""Smoke test: training package imports cleanly."""
from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


def test_training_module_imports() -> None:
    import training  # noqa: F401

    assert training.__version__ == "0.1.0"
