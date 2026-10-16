import os
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from app.config import settings
from app.models import Base
from app.database import get_db
from app.main import app

# Ensure tests point to TEST_DATABASE_URL
TEST_DB_URL = os.getenv("TEST_DATABASE_URL", settings.TEST_DATABASE_URL)
os.environ["DATABASE_URL"] = TEST_DB_URL

test_engine = create_engine(
    TEST_DB_URL,
    pool_size=40,
    max_overflow=20,
    pool_pre_ping=True,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    """Ensure test database schema and triggers are fully applied."""
    with test_engine.connect() as conn:
        Base.metadata.create_all(conn)
        
        # Ensure append-only trigger exists
        conn.execute(text("""
        CREATE OR REPLACE FUNCTION reject_activity_events_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'activity_events is append-only: updates and deletes are rejected';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_activity_events_append_only ON activity_events;
        CREATE TRIGGER trg_activity_events_append_only
        BEFORE UPDATE OR DELETE ON activity_events
        FOR EACH ROW
        EXECUTE FUNCTION reject_activity_events_mutation();
        """))
        conn.commit()
    yield


@pytest.fixture(autouse=True)
def clean_database():
    """Clean tables before each test to ensure test isolation."""
    with test_engine.connect() as conn:
        conn.execute(text("TRUNCATE notifications, activity_events, work_items, idempotency_keys, outbox, team_memberships, users, teams RESTART IDENTITY CASCADE;"))
        conn.commit()
    yield


@pytest.fixture
def db() -> Session:
    """Provide a clean test database session."""
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def override_db():
    """Override FastAPI get_db dependency to point to test database."""
    def _get_test_db():
        session = TestSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _get_test_db
    yield
    app.dependency_overrides.pop(get_db, None)


def get_test_db_session() -> Session:
    """Helper for spawning separate database sessions in concurrent tests."""
    return TestSessionLocal()
