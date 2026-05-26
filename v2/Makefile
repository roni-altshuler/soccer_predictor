.PHONY: help install dev down migrate downgrade validate-schema test lint clean

PYTHON ?= python3
PIP    ?= pip
COMPOSE = docker compose -f infra/local/docker-compose.yml

DB_URL ?= postgresql+psycopg://fotpredict:fotpredict@localhost:5432/fotpredict

help:
	@awk 'BEGIN{FS=":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install Python deps (incl. pglast) for schema validation
	$(PIP) install --quiet pglast sqlalchemy alembic pydantic

dev: ## Boot local stack: Postgres+Timescale, Redis, MinIO, Centrifugo
	$(COMPOSE) up -d
	@echo "Postgres on 5432, Redis on 6379, MinIO on 9000, Centrifugo on 8000"

down: ## Stop and remove the local stack
	$(COMPOSE) down

migrate: ## Apply Alembic baseline migration to local Postgres
	cd packages/fotpredict-db && DATABASE_URL=$(DB_URL) alembic upgrade head

downgrade: ## Roll baseline migration back
	cd packages/fotpredict-db && DATABASE_URL=$(DB_URL) alembic downgrade base

validate-schema: ## Syntax-validate the migration without a running DB
	$(PYTHON) scripts/validate_schema.py

test: ## Run all pytest suites
	$(PYTHON) -m pytest

lint: ## Ruff lint
	ruff check .

clean: ## Remove caches
	find . -type d \( -name __pycache__ -o -name .pytest_cache -o -name .ruff_cache -o -name .mypy_cache \) -prune -exec rm -rf {} +
