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
