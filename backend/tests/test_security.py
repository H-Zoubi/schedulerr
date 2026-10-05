def test_cross_site_write_is_refused(client):
    res = client.post("/api/tasks", json={"title": "x"}, headers={"Origin": "https://evil.example"})
    assert res.status_code == 403


def test_cross_site_fetch_metadata_is_refused(client):
    res = client.post("/api/tasks", json={"title": "x"}, headers={"Sec-Fetch-Site": "cross-site"})
    assert res.status_code == 403


def test_app_origin_write_is_allowed(client):
    assert client.post("/api/tasks", json={"title": "x"}).status_code == 201


def test_reads_are_not_origin_checked(client):
    assert client.get("/api/tasks", headers={"Origin": "https://evil.example"}).status_code == 200


def test_api_requires_login(anon):
    assert anon.get("/api/tasks").status_code == 401


def test_private_responses_are_not_cached(client):
    for path in ("/auth/me", "/api/tasks"):
        res = client.get(path)
        assert res.headers["cache-control"] == "no-store"
        assert res.headers["x-content-type-options"] == "nosniff"


def test_pending_login_counts_toward_failure_limit():
    import pytest
    from fastapi import HTTPException
    from app.security import FailureLimiter

    limiter = FailureLimiter()
    keys = ["email:user", "ip:local"]
    for _ in range(4):
        limiter.record_failure(keys)
    with limiter.attempt(keys):
        with pytest.raises(HTTPException) as error:
            with limiter.attempt(keys):
                pass
        assert error.value.status_code == 429
    assert not limiter._pending
    with limiter.attempt(keys):
        pass


def test_hash_concurrency_is_bounded_and_slots_are_released():
    import pytest
    from fastapi import HTTPException
    from app.security import FailureLimiter

    limiter = FailureLimiter()
    with limiter.attempt(["first"]), limiter.attempt(["second"]):
        with pytest.raises(HTTPException) as error:
            with limiter.attempt(["third"]):
                pass
        assert error.value.status_code == 429
    with pytest.raises(RuntimeError):
        with limiter.attempt(["first"]):
            raise RuntimeError("verification failed")
    with limiter.attempt(["first"]), limiter.attempt(["second"]):
        pass
