.PHONY: test test-backend test-frontend run dev worker seed seed-large migrate docker-up docker-down

PYTHON ?= .venv/bin/python
PYTEST ?= .venv/bin/pytest
ALEMBIC ?= .venv/bin/alembic

export TEST_DATABASE_URL ?= postgresql://postgres:postgres@localhost:5432/newtonite_test
export DATABASE_URL ?= postgresql://postgres:postgres@localhost:5432/newtonite
export SECRET_KEY ?= dev-secret-key-change-in-production-use-hs256
export ALGORITHM ?= HS256
export CORS_ORIGINS ?= http://localhost:5173,http://localhost:3000
export PYTHONPATH ?= backend

test: test-backend test-frontend

test-backend:
	@echo "Running backend test suite against PostgreSQL..."
	@if [ -f "$(PYTEST)" ]; then \
		$(PYTEST) -v backend/tests; \
	else \
		pytest -v backend/tests; \
	fi

test-frontend:
	@if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then \
		echo "Running frontend test suite..."; \
		(cd frontend && npm ci && npm test -- --run); \
	else \
		echo "frontend/ directory is empty or not yet initialized; skipping frontend tests."; \
	fi

dev:
	@echo "Starting backend development server on http://localhost:8000..."
	@cd backend && ../$(PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker:
	@echo "Starting outbox background worker..."
	@cd backend && ../$(PYTHON) -m app.worker

migrate:
	@echo "Applying database migrations..."
	@cd backend && ../$(ALEMBIC) upgrade head

seed:
	@echo "Seeding small dataset (~5,000 items, 12 users, 4 teams)..."
	@cd backend && ../$(PYTHON) -m app.seed --scale small

seed-large:
	@echo "Seeding large dataset (50,000+ items, 500,000+ events)..."
	@cd backend && ../$(PYTHON) -m app.seed --scale large

docker-up:
	docker compose up --build

docker-down:
	docker compose down -v
