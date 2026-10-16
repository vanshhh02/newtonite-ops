#!/bin/sh
set -e

echo "[entrypoint] Waiting for database connection and running Alembic migrations..."
alembic upgrade head

echo "[entrypoint] Running idempotent database seed (small dataset if empty)..."
python -m app.seed --scale small --if-empty

echo "[entrypoint] Launching FastAPI uvicorn server on port 8000..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
