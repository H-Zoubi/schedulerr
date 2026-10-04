import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

# Point the app at a throwaway SQLite file before anything imports app.db.
_db_dir = tempfile.mkdtemp(prefix="schedulerr-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_db_dir, 'test.db').as_posix()}"
os.environ.setdefault("NOTIFICATIONS_WORKER", "0")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import hash_password  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.security import login_limiter  # noqa: E402

EMAIL = "tester@example.com"
PASSWORD = "correct horse battery"
ORIGIN = "http://localhost:5173"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    # Build the schema with the real migrations, so the tests catch migration problems.
    command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")
    with SessionLocal() as db:
        db.add(User(email=EMAIL, password_hash=hash_password(PASSWORD),
                    created_at=datetime.now(timezone.utc)))
        db.commit()
    yield


@pytest.fixture(autouse=True)
def _clean():
    """Each test starts with empty data (the user is kept) and no rate-limit state."""
    login_limiter._failures.clear()
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            if table.name != "users":
                conn.execute(table.delete())
    yield


@pytest.fixture
def anon():
    return TestClient(app, base_url="https://testserver", headers={"Origin": ORIGIN})


@pytest.fixture
def client(anon):
    res = anon.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return anon
