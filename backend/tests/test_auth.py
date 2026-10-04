from .conftest import EMAIL, PASSWORD


def test_me_requires_login(anon):
    assert anon.get("/auth/me").status_code == 401


def test_login_sets_session_and_me_returns_user(anon):
    res = anon.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert res.status_code == 200
    assert "HttpOnly" in res.headers["set-cookie"]
    assert "Secure" in res.headers["set-cookie"]
    assert anon.get("/auth/me").json()["email"] == EMAIL


def test_wrong_password_is_401(anon):
    res = anon.post("/auth/login", json={"email": EMAIL, "password": "wrong"})
    assert res.status_code == 401


def test_logout_ends_session(client):
    assert client.post("/auth/logout").status_code == 204
    assert client.get("/auth/me").status_code == 401


def test_rate_limit_locks_after_five_failures(anon):
    for _ in range(5):
        assert anon.post("/auth/login", json={"email": EMAIL, "password": "wrong"}).status_code == 401
    # Even the right password is refused while locked.
    assert anon.post("/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code == 429


def test_successful_login_resets_email_counter_but_not_ip_counter(anon):
    # Four failures: under both limits.
    for _ in range(4):
        anon.post("/auth/login", json={"email": EMAIL, "password": "wrong"})
    assert anon.post("/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code == 200
    # The email counter was reset, but the IP still has four failures, so one more is allowed.
    assert anon.post("/auth/login", json={"email": EMAIL, "password": "wrong"}).status_code == 401
    # Now the IP has five failures and is locked.
    assert anon.post("/auth/login", json={"email": EMAIL, "password": "wrong"}).status_code == 429


def test_expired_sessions_are_removed_on_next_login(anon):
    from datetime import datetime, timedelta, timezone

    from app.db import SessionLocal
    from app.models import Session as DbSession
    from app.models import User

    anon.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == EMAIL).one()
        past = datetime.now(timezone.utc) - timedelta(days=1)
        db.add(DbSession(token_hash="expired-test-hash", user_id=user.id,
                         created_at=past, expires_at=past))
        db.commit()

    anon.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})

    with SessionLocal() as db:
        assert db.get(DbSession, "expired-test-hash") is None
