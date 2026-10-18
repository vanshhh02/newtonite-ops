.PHONY: test test-backend test-frontend run dev worker seed seed-large migrate docker-up docker-down

# Auto-detect Python virtualenv whether located in backend/.venv or .venv/
VENV_DIR ?= $(shell [ -d backend/.venv ] && echo "backend/.venv" || ([ -d .venv ] && echo ".venv" || echo ""))
PYTHON   ?= $(if $(VENV_DIR),$(VENV_DIR)/bin/python,python3)
PYTEST   ?= $(if $(VENV_DIR),$(VENV_DIR)/bin/pytest,pytest)
ALEMBIC  ?= $(if $(VENV_DIR),$(VENV_DIR)/bin/alembic,alembic)

export TEST_DATABASE_URL ?= postgresql://postgres:postgres@localhost:5432/newtonite_test
export DATABASE_URL ?= postgresql://postgres:postgres@localhost:5432/newtonite
export SECRET_KEY ?= dev-secret-key-change-in-production-use-hs256
export ALGORITHM ?= HS256
export CORS_ORIGINS ?= http://localhost:5173,http://localhost:3000
export PYTHONPATH ?= backend

test: test-backend test-frontend

test-backend:
	@echo "Running backend test suite against PostgreSQL..."
	@$(PYTEST) -v backend/tests

test-frontend:
	@if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then \
		echo "Running frontend test suite..."; \
		(cd frontend && ([ -d "node_modules" ] || npm install) && npm test -- --run); \
	else \
		echo "frontend/ directory is empty or not yet initialized; skipping frontend tests."; \
	fi

run:
	@echo "Starting fullstack development servers (backend on :8000, frontend on :5173)..."
	@(trap 'kill 0' SIGINT SIGTERM EXIT; \
	  PYTHONPATH=backend $(PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend & \
	  (cd frontend && npm run dev) & \
	  wait)

dev:
	@echo "Starting backend development server on http://localhost:8000..."
	@PYTHONPATH=backend $(PYTHON) -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend

worker:
	@echo "Starting outbox background worker..."
	@PYTHONPATH=backend $(PYTHON) -m app.worker

migrate:
	@echo "Applying database migrations..."
	@(cd backend && $(if $(filter backend/%,$(ALEMBIC)),./.venv/bin/alembic,../$(ALEMBIC)) upgrade head)

seed:
	@echo "Seeding small dataset (~5,000 items, 12 users, 4 teams)..."
	@PYTHONPATH=backend $(PYTHON) -m app.seed --scale small

seed-large:
	@echo "Seeding large dataset (50,000+ items, 500,000+ events)..."
	@PYTHONPATH=backend $(PYTHON) -m app.seed --scale large

docker-up:
	docker compose up --build

docker-down:
	docker compose down -v
