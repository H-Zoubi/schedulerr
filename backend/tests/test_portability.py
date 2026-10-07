from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.portability import _fold


@pytest.fixture
def outsider():
    """A calendar app: no session cookie, no API key."""
    return TestClient(app, base_url="https://testserver")


def _seed(client):
    project = client.post("/api/projects", json={"name": "Thesis"}).json()
    task = client.post("/api/tasks", json={"title": "Write intro", "project_id": project["id"]}).json()
    client.post("/api/task-blocks", json={
        "task_id": task["id"], "start_at": "2026-10-06T09:00:00", "end_at": "2026-10-06T10:00:00",
    })
    event = client.post("/api/events", json={
        "title": "Dentist", "start_at": "2026-10-07T15:00:00", "end_at": "2026-10-07T15:45:00",
        "location": "Main St 4", "notes": "Bring card",
    }).json()
    client.post("/api/time-blocks", json={
        "title": "Gym", "weekday": 0, "start_time": "07:00:00", "end_time": "08:00:00",
        "start_date": "2026-10-01", "until_date": "2026-12-31",
    })
    habit = client.post("/api/habits", json={"title": "Walk", "target_count": 3, "target_period": "week"}).json()
    client.post(f"/api/habits/{habit['id']}/log?start=2026-10-05&end=2026-10-11", json={"logged_on": "2026-10-06", "delta": 1})
    client.put(f"/api/reminders/event/{event['id']}", json={"minutes_before": 10})
    return event


def test_event_location_and_notes_are_saved(client):
    event = _seed(client)
    assert event["location"] == "Main St 4"
    assert event["notes"] == "Bring card"
    res = client.patch(f"/api/events/{event['id']}", json={
        "title": "Dentist", "start_at": event["start_at"], "end_at": event["end_at"],
        "location": "", "notes": "Moved online",
    })
    assert res.json()["location"] == ""
    assert res.json()["notes"] == "Moved online"


def test_event_location_has_a_length_limit(client):
    res = client.post("/api/events", json={
        "title": "x", "start_at": "2026-10-07T15:00:00", "end_at": "2026-10-07T16:00:00", "location": "x" * 301,
    })
    assert res.status_code == 422


def test_export_then_import_restores_everything(client):
    _seed(client)
    res = client.get("/api/export")
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    dump = res.json()
    assert dump["app"] == "schedulerr"
    assert len(dump["tables"]["events"]) == 1
    assert "users" not in dump["tables"] and "api_keys" not in dump["tables"]

    # Change things, then restore the export.
    client.post("/api/events", json={"title": "Extra", "start_at": "2026-10-08T09:00:00", "end_at": "2026-10-08T10:00:00"})
    for t in client.get("/api/tasks").json():
        client.delete(f"/api/tasks/{t['id']}")

    res = client.post("/api/import", json=dump)
    assert res.status_code == 200, res.text
    assert res.json()["imported"]["events"] == 1
    assert client.get("/api/export").json()["tables"] == dump["tables"]

    # New rows still get fresh ids after an import that kept the old ones.
    created = client.post("/api/tasks", json={"title": "After import"})
    assert created.status_code == 201


def test_import_rejects_bad_files_without_changing_data(client):
    _seed(client)
    before = client.get("/api/export").json()["tables"]
    assert client.post("/api/import", json={"app": "other", "format": 1, "tables": {}}).status_code == 422
    assert client.post("/api/import", json={"app": "schedulerr", "format": 1, "tables": {"users": []}}).status_code == 422
    bad_row = {"app": "schedulerr", "format": 1, "tables": {"events": [{"id": 1, "nope": 2}]}}
    assert client.post("/api/import", json=bad_row).status_code == 422
    broken = {"app": "schedulerr", "format": 1, "tables": {"events": [{"id": 1, "title": "x"}]}}
    assert client.post("/api/import", json=broken).status_code == 422
    assert client.get("/api/export").json()["tables"] == before


def test_import_needs_a_browser_session(anon):
    assert anon.post("/api/import", json={"app": "schedulerr", "format": 1, "tables": {}}).status_code == 401


def test_calendar_feed(client, outsider):
    _seed(client)
    assert client.get("/auth/calendar-feed").json()["enabled"] is False
    created = client.post("/auth/calendar-feed").json()
    path = created["path"]
    assert path.startswith("/api/feed/") and path.endswith(".ics")
    status = client.get("/auth/calendar-feed").json()
    assert status["enabled"] is True and status["path"] is None

    res = outsider.get(path)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/calendar")
    body = res.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    assert "SUMMARY:Dentist" in body and "LOCATION:Main St 4" in body
    assert "SUMMARY:Write intro" in body
    # The Gym routine repeats on Mondays from the first Monday after its start date.
    assert "DTSTART:20261005T070000Z" in body
    assert "RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z" in body

    # The feed link is not an API key, and does not show up as one.
    token = path.removeprefix("/api/feed/").removesuffix(".ics")
    assert outsider.get("/api/tasks", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.get("/auth/api-keys").json() == []

    # A new link replaces the old one; turning it off stops it.
    new_path = client.post("/auth/calendar-feed").json()["path"]
    assert outsider.get(path).status_code == 404
    assert outsider.get(new_path).status_code == 200
    assert client.delete("/auth/calendar-feed").status_code == 204
    assert outsider.get(new_path).status_code == 404


def test_feed_uses_app_timezone(client, outsider, monkeypatch):
    monkeypatch.setenv("APP_TIMEZONE", "Asia/Amman")
    client.post("/api/events", json={"title": "Call", "start_at": "2026-10-07T15:00:00", "end_at": "2026-10-07T16:00:00"})
    path = client.post("/auth/calendar-feed").json()["path"]
    body = outsider.get(path).text
    assert "DTSTART;TZID=Asia/Amman:20261007T150000" in body
    assert "X-WR-TIMEZONE:Asia/Amman" in body


def test_feed_skips_old_items(client, outsider):
    old = (date.today() - timedelta(days=200)).isoformat()
    client.post("/api/events", json={"title": "Ancient", "start_at": f"{old}T09:00:00", "end_at": f"{old}T10:00:00"})
    body = outsider.get(client.post("/auth/calendar-feed").json()["path"]).text
    assert "Ancient" not in body


def test_long_lines_are_folded():
    line = "SUMMARY:" + "é" * 80
    folded = _fold(line)
    assert all(len(part.encode()) <= 75 for part in folded.split("\r\n"))
    assert folded.replace("\r\n ", "") == line
