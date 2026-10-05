import hashlib
from datetime import timedelta

import pytest

from app.db import SessionLocal
from app.auth import _now
from app.models import ApiKey, User


@pytest.fixture
def keys(monkeypatch):
    with SessionLocal() as db:
        user_id = db.query(User).one().id
    monkeypatch.setenv("AI_API_USER_ID", str(user_id))
    for scope in ("READ", "WRITE"):
        monkeypatch.setenv(f"AI_API_{scope}_KEY_HASH", hashlib.sha256(scope.encode()).hexdigest())


def test_read_key_reads_calendar_but_cannot_modify(anon, keys):
    anon.headers["Authorization"] = "Bearer READ"
    assert anon.get("/api/week?start=2026-10-05").status_code == 200
    assert anon.post("/api/events", json={}).status_code == 403
    assert anon.delete("/api/events/1").status_code == 403
    assert anon.get("/auth/me").status_code == 401


def test_write_key_creates_event(anon, keys):
    anon.headers["Authorization"] = "Bearer WRITE"
    res = anon.post("/api/events", json={"title": "AI event", "start_at": "2026-10-05T09:00:00", "end_at": "2026-10-05T10:00:00"})
    assert res.status_code == 201, res.text
    assert anon.delete(f"/api/events/{res.json()['id']}").status_code == 204


@pytest.mark.parametrize("authorization", ["Bearer wrong", "Bearer", "Basic READ", "Bearer "])
def test_bad_key_does_not_fall_back_to_cookie(client, keys, authorization):
    client.headers["Authorization"] = authorization
    assert client.get("/api/week?start=2026-10-05").status_code == 401


def test_revocation_and_missing_account(anon, keys, monkeypatch):
    anon.headers["Authorization"] = "Bearer READ"
    monkeypatch.delenv("AI_API_USER_ID")
    assert anon.get("/api/week?start=2026-10-05").status_code == 401
    monkeypatch.setenv("AI_API_USER_ID", "999999")
    assert anon.get("/api/week?start=2026-10-05").status_code == 401
    monkeypatch.delenv("AI_API_READ_KEY_HASH")
    assert anon.get("/api/week?start=2026-10-05").status_code == 401


def test_key_does_not_bypass_origin_checks(anon, keys):
    res = anon.post("/api/events", json={}, headers={"Authorization": "Bearer WRITE", "Origin": "https://other.example"})
    assert res.status_code == 403


def test_ui_key_lifecycle_and_secret_storage(client):
    response = client.post("/auth/api-keys", json={"name": " My AI "})
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["scope"] == "read"
    assert created["name"] == "My AI"
    secret = created["key"]
    with SessionLocal() as db:
        row = db.get(ApiKey, created["id"])
        assert row.token_hash == hashlib.sha256(secret.encode()).hexdigest()
        assert row.token_hash != secret
        assert row.expires_at is not None
    listed = client.get("/auth/api-keys")
    assert secret not in listed.text
    assert "token_hash" not in listed.text
    assert "key" not in listed.json()[0]
    headers = {"Authorization": f"Bearer {secret}"}
    assert client.get("/api/week?start=2026-10-05", headers=headers).status_code == 200
    assert client.post("/api/events", json={}, headers=headers).status_code == 403
    assert client.delete(f"/auth/api-keys/{created['id']}").status_code == 204
    assert client.get("/api/week?start=2026-10-05", headers=headers).status_code == 401
    assert client.get("/auth/api-keys").json() == []


def test_ui_write_key_and_expiry(client):
    created = client.post("/auth/api-keys", json={"name": "Writer", "scope": "write", "expires_in_days": None}).json()
    headers = {"Authorization": f"Bearer {created['key']}"}
    assert created["expires_at"] is None
    response = client.post("/api/events", json={"title": "AI event", "start_at": "2026-10-05T09:00:00", "end_at": "2026-10-05T10:00:00"}, headers=headers)
    assert response.status_code == 201
    with SessionLocal() as db:
        db.get(ApiKey, created["id"]).expires_at = _now() - timedelta(seconds=1)
        db.commit()
    assert client.get("/api/week?start=2026-10-05", headers=headers).status_code == 401


def test_key_management_requires_browser_login(anon, client):
    created = client.post("/auth/api-keys", json={"name": "AI", "scope": "write"}).json()
    client.cookies.clear()
    for caller in (anon, client):
        caller.headers["Authorization"] = f"Bearer {created['key']}"
        assert caller.get("/auth/api-keys").status_code == 401
        assert caller.post("/auth/api-keys", json={"name": "Other"}).status_code == 401
        assert caller.delete(f"/auth/api-keys/{created['id']}").status_code == 401


def test_key_cannot_manage_keys_even_with_cookie(client):
    key = client.post("/auth/api-keys", json={"name": "AI", "scope": "write"}).json()
    client.headers["Authorization"] = f"Bearer {key['key']}"
    assert client.get("/auth/api-keys").status_code == 403
    assert client.post("/auth/api-keys", json={"name": "Other"}).status_code == 403
    assert client.delete(f"/auth/api-keys/{key['id']}").status_code == 403


@pytest.mark.parametrize("body", [{"name": "   "}, {"name": "x", "scope": "admin"}, {"name": "x", "expires_in_days": 0}])
def test_invalid_key_settings(client, body):
    assert client.post("/auth/api-keys", json=body).status_code == 422


def test_key_management_rejects_cross_site_requests(client):
    assert client.post("/auth/api-keys", json={"name": "AI"}, headers={"Origin": "https://other.example"}).status_code == 403
