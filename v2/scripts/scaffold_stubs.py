#!/usr/bin/env python3
"""One-shot bulk scaffolder for soccer_predictor/v2/ service/package stubs.

Run once after the initial directory layout is in place. Writes pyproject.toml,
__init__.py, main.py (services), and smoke test stubs for every remaining
service and package. Idempotent: skips any file that already exists so a
re-run after manual edits won't trample work.

This file stays in the repo as a record of how the scaffold was generated.
"""
from __future__ import annotations

from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[1]

PYPROJECT_SERVICE = dedent(
    """\
    [project]
    name = "{name}"
    version = "0.1.0"
    description = "{description}"
    requires-python = ">=3.12"
    dependencies = {deps}

    [project.optional-dependencies]
    dev = ["pytest>=8.0", "pytest-asyncio>=0.23"]

    [build-system]
    requires = ["hatchling"]
    build-backend = "hatchling.build"

    [tool.hatch.build.targets.wheel]
    packages = ["src/{pkg}"]
    """
)

PYPROJECT_PACKAGE = dedent(
    """\
    [project]
    name = "{name}"
    version = "0.1.0"
    description = "{description}"
    requires-python = ">=3.12"
    dependencies = {deps}

    [project.optional-dependencies]
    dev = ["pytest>=8.0"]

    [build-system]
    requires = ["hatchling"]
    build-backend = "hatchling.build"

    [tool.hatch.build.targets.wheel]
    packages = ["src/{pkg}"]
    """
)

SERVICE_MAIN = dedent(
    '''\
    """{name} entrypoint.

    Stub. {note}
    """
    from __future__ import annotations

    from fastapi import FastAPI


    def create_app() -> FastAPI:
        app = FastAPI(title="FotPredict {title}", version="0.1.0")

        @app.get("/healthz", tags=["meta"])
        async def healthz() -> dict[str, str]:
            return {{"status": "ok", "service": "{name}"}}

        return app


    app = create_app()
    '''
)

SMOKE_TEST = dedent(
    '''\
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
        from {pkg}.main import app  # noqa: PLC0415

        routes = {{r.path for r in app.routes}}
        assert "/healthz" in routes
    '''
)

PACKAGE_INIT = dedent(
    '''\
    """{description}"""

    __version__ = "0.1.0"
    '''
)

SERVICE_INIT = dedent(
    '''\
    """{description}"""

    __version__ = "0.1.0"
    '''
)

SERVICES = [
    {
        "name": "simulation-svc",
        "pkg": "simulation",
        "title": "Simulation Service",
        "description": "FotPredict v2 simulation service: Ray-batched Monte Carlo league + bracket simulations.",
        "note": "Ray actor + MC engine ports from v1 league_simulator/knockout_simulator in the next phase.",
        "deps": [
            "fastapi>=0.115",
            "uvicorn[standard]>=0.30",
            "pydantic>=2.7",
            "numpy>=1.26",
            "ray[default]>=2.30",
            "fotpredict-core",
            "fotpredict-observability",
        ],
    },
    {
        "name": "realtime-svc",
        "pkg": "realtime",
        "title": "Realtime Service",
        "description": "FotPredict v2 realtime service: Centrifugo connect tokens + Redis Streams subscribers.",
        "note": "Centrifugo HTTP publisher + stream consumer groups land in the next phase.",
        "deps": [
            "fastapi>=0.115",
            "uvicorn[standard]>=0.30",
            "httpx>=0.27",
            "pydantic>=2.7",
            "redis>=5.0",
            "pyjwt[crypto]>=2.8",
            "fotpredict-core",
            "fotpredict-observability",
        ],
    },
    {
        "name": "ingestion-svc",
        "pkg": "ingestion",
        "title": "Ingestion Service",
        "description": "FotPredict v2 ingestion: Arq workers + Temporal activities pulling ESPN/FBref/etc.",
        "note": "IngestionSource protocol, source-specific scrapers, normalizers, and Temporal workflows land in the next phase.",
        "deps": [
            "fastapi>=0.115",
            "uvicorn[standard]>=0.30",
            "httpx>=0.27",
            "pydantic>=2.7",
            "redis>=5.0",
            "arq>=0.26",
            "temporalio>=1.7",
            "beautifulsoup4>=4.12",
            "fotpredict-core",
            "fotpredict-db",
            "fotpredict-observability",
        ],
    },
    {
        "name": "admin-svc",
        "pkg": "admin",
        "title": "Admin Service",
        "description": "FotPredict v2 internal ops: model promotion, ingestion runs, feature flags.",
        "note": "Promotion endpoints + ingestion-run inspectors land in the next phase.",
        "deps": [
            "fastapi>=0.115",
            "uvicorn[standard]>=0.30",
            "pydantic>=2.7",
            "httpx>=0.27",
            "fotpredict-core",
            "fotpredict-db",
            "fotpredict-observability",
        ],
    },
]

TRAINING_NOTE = dedent(
    '''\
    """training-jobs: one-shot K8s GPU jobs.

    Not a long-running service — entrypoints invoked by Temporal-triggered
    K8s Jobs. The unified PyTorch trainer ports from
    soccer_predictor/backend/scripts/train_unified.py in the next phase.
    """

    __version__ = "0.1.0"


    def main() -> int:
        print("training-jobs scaffold: see docs/STATUS.md for what is wired.")
        return 0
    '''
)

TRAINING_PYPROJECT = dedent(
    """\
    [project]
    name = "training-jobs"
    version = "0.1.0"
    description = "FotPredict v2 training jobs (PyTorch + Feast + MLflow). One-shot K8s GPU Jobs."
    requires-python = ">=3.12"
    dependencies = [
        "torch>=2.2",
        "numpy>=1.26",
        "scikit-learn>=1.4",
        "pandas>=2.2",
        "mlflow>=2.13",
        "pyarrow>=16.0",
        "fotpredict-core",
        "fotpredict-db",
        "fotpredict-ml",
    ]

    [project.optional-dependencies]
    dev = ["pytest>=8.0"]

    [build-system]
    requires = ["hatchling"]
    build-backend = "hatchling.build"

    [tool.hatch.build.targets.wheel]
    packages = ["src/training"]
    """
)

PACKAGES = [
    {
        "name": "fotpredict-core",
        "pkg": "fotpredict_core",
        "description": "Pydantic schemas, enums, and shared error types for FotPredict v2.",
        "deps": ["pydantic>=2.7"],
    },
    {
        "name": "fotpredict-ml",
        "pkg": "fotpredict_ml",
        "description": "Feast feature definitions and shared inference utilities for FotPredict v2.",
        "deps": ["pydantic>=2.7", "numpy>=1.26"],
    },
    {
        "name": "fotpredict-clients",
        "pkg": "fotpredict_clients",
        "description": "Typed gRPC + HTTP clients between FotPredict v2 services.",
        "deps": ["httpx>=0.27", "pydantic>=2.7", "grpcio>=1.62"],
    },
    {
        "name": "fotpredict-observability",
        "pkg": "fotpredict_observability",
        "description": "OpenTelemetry + structlog configuration shared across FotPredict v2 services.",
        "deps": [
            "opentelemetry-api>=1.25",
            "opentelemetry-sdk>=1.25",
            "structlog>=24.1",
        ],
    },
    {
        "name": "fotpredict-testing",
        "pkg": "fotpredict_testing",
        "description": "Shared pytest fixtures and fakes (fake Triton, fake Redis) for FotPredict v2.",
        "deps": ["pytest>=8.0", "fakeredis>=2.23"],
    },
]


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return  # idempotent
    path.write_text(content)


def scaffold_service(svc: dict) -> None:
    base = ROOT / "apps" / svc["name"]
    deps_repr = "[\n" + ",\n".join(f"    {d!r}" for d in svc["deps"]) + ",\n]"
    _write(
        base / "pyproject.toml",
        PYPROJECT_SERVICE.format(
            name=svc["name"], description=svc["description"], pkg=svc["pkg"], deps=deps_repr
        ),
    )
    _write(
        base / "src" / svc["pkg"] / "__init__.py",
        SERVICE_INIT.format(description=svc["description"]),
    )
    _write(
        base / "src" / svc["pkg"] / "main.py",
        SERVICE_MAIN.format(
            name=svc["name"], title=svc["title"], pkg=svc["pkg"], note=svc["note"]
        ),
    )
    _write(base / "tests" / "test_smoke.py", SMOKE_TEST.format(pkg=svc["pkg"]))


def scaffold_training() -> None:
    base = ROOT / "apps" / "training-jobs"
    _write(base / "pyproject.toml", TRAINING_PYPROJECT)
    _write(base / "src" / "training" / "__init__.py", TRAINING_NOTE)
    _write(
        base / "tests" / "test_smoke.py",
        dedent(
            """\
            \"\"\"Smoke test: training package imports cleanly.\"\"\"
            from __future__ import annotations

            import sys
            from pathlib import Path

            SRC = Path(__file__).resolve().parents[1] / "src"
            if str(SRC) not in sys.path:
                sys.path.insert(0, str(SRC))


            def test_training_module_imports() -> None:
                import training  # noqa: F401

                assert training.__version__ == "0.1.0"
            """
        ),
    )


def scaffold_package(pkg: dict) -> None:
    base = ROOT / "packages" / pkg["name"]
    deps_repr = "[\n" + ",\n".join(f"    {d!r}" for d in pkg["deps"]) + ",\n]"
    _write(
        base / "pyproject.toml",
        PYPROJECT_PACKAGE.format(
            name=pkg["name"], description=pkg["description"], pkg=pkg["pkg"], deps=deps_repr
        ),
    )
    _write(
        base / "src" / pkg["pkg"] / "__init__.py",
        PACKAGE_INIT.format(description=pkg["description"]),
    )


def main() -> int:
    for svc in SERVICES:
        scaffold_service(svc)
    scaffold_training()
    for pkg in PACKAGES:
        scaffold_package(pkg)
    print(f"scaffolded {len(SERVICES) + 1} services and {len(PACKAGES)} packages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
