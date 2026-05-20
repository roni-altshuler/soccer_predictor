"""Pytest configuration: make the repo root importable.

Both `backend/tests/test_*.py` and any future top-level tests use
absolute imports like ``from backend.services.data.warehouse import ...``.
Adding the project root to ``sys.path`` lets `pytest` discover those
modules without requiring an editable install.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
