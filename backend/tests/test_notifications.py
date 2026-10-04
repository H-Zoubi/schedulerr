from datetime import datetime

import pytest

from app import notifications
from app.db import SessionLocal


@pytest.fixture
def sent(monkeypatch):
    """Record every notification instead of sending it."""
    calls = []

    def fake_send(title, message, priority=4):
        calls.append((title, message))
        return ["fake"]

    monkeypatch.setattr(notifications, "send", fake_send)
    return calls


def _run(now: datetime) -> int:
    with SessionLocal() as db:
        return notifications.run_once(db, now=now)


def _event(client, start="2026-10-05T10:00:00", end="2026-10-05T11:00:00", title="Meet"):
    return client.post("/api/events", json={"title": title, "start_at": start, "end_at": end}).json()


def test_event_reminder_fires_at_offset_once(client, sent):
    event = _event(client)
    client.put(f"/api/reminders/event/{event['id']}", json={"minutes_before": 10})

    assert _run(datetime(2026, 10, 5, 9, 45)) == 0          # 15 min before: too early
    assert _run(datetime(2026, 10, 5, 9, 50)) == 1          # 10 min before: fires
    assert _run(datetime(2026, 10, 5, 9, 55)) == 0          # already sent
    assert len(sent) == 1
    assert "Meet" == sent[0][0]
    assert "10 min" in sent[0][1]


def test_time_block_reminder_fires_on_each_occurrence(client, sent):
    # Monday 2026-10-05 is weekday 0.
    block = client.post("/api/time-blocks", json={
        "title": "Database", "weekday": 0, "start_time": "11:30", "end_time": "13:00",
        "start_date": "2026-09-28",
    }).json()
    client.put(f"/api/reminders/time_block/{block['id']}", json={"minutes_before": 5})

    assert _run(datetime(2026, 10, 5, 11, 26)) == 1
    assert _run(datetime(2026, 10, 5, 11, 27)) == 0
    # The following Monday is a separate occurrence.
    assert _run(datetime(2026, 10, 12, 11, 26)) == 1
    assert [title for title, _ in sent] == ["Database", "Database"]


def test_time_block_respects_until_date(client, sent):
    block = client.post("/api/time-blocks", json={
        "title": "Short", "weekday": 0, "start_time": "11:30", "end_time": "13:00",
        "start_date": "2026-09-28", "until_date": "2026-10-05",
    }).json()
    client.put(f"/api/reminders/time_block/{block['id']}", json={"minutes_before": 0})
    assert _run(datetime(2026, 10, 12, 11, 30)) == 0


def test_missed_reminder_is_not_sent_hours_later(client, sent):
    event = _event(client, start="2026-10-05T10:00:00", end="2026-10-05T11:00:00")
    client.put(f"/api/reminders/event/{event['id']}", json={"minutes_before": 0})
    assert _run(datetime(2026, 10, 5, 13, 0)) == 0
    assert sent == []


def test_failed_send_is_retried_on_next_run(client, monkeypatch):
    event = _event(client)
    client.put(f"/api/reminders/event/{event['id']}", json={"minutes_before": 0})

    calls = []

    def flaky_send(title, message, priority=4):
        calls.append(title)
        if len(calls) == 1:
            raise RuntimeError("network down")
        return ["fake"]

    monkeypatch.setattr(notifications, "send", flaky_send)
    assert _run(datetime(2026, 10, 5, 10, 0)) == 0   # failed, nothing recorded
    assert _run(datetime(2026, 10, 5, 10, 1)) == 1   # retried and sent
    assert len(calls) == 2


def test_reminder_can_be_removed(client, sent):
    event = _event(client)
    client.put(f"/api/reminders/event/{event['id']}", json={"minutes_before": 5})
    assert client.put(f"/api/reminders/event/{event['id']}", json={"minutes_before": None}).status_code == 204
    assert client.get("/api/reminders").json() == []


def test_reminder_validation(client):
    event = _event(client)
    assert client.put(f"/api/reminders/event/{event['id']}", json={"minutes_before": -1}).status_code == 422
    assert client.put(f"/api/reminders/event/9999", json={"minutes_before": 5}).status_code == 404
    assert client.put(f"/api/reminders/habit/1", json={"minutes_before": 5}).status_code == 404


def test_status_reports_providers_without_secrets(client, monkeypatch):
    monkeypatch.setenv("NTFY_TOPIC", "secret-topic-name")
    monkeypatch.delenv("GOTIFY_URL", raising=False)
    status = client.get("/api/notifications/status").json()
    assert status == {"ntfy": True, "gotify": False}
    assert "secret-topic-name" not in str(status)


def test_test_endpoint_needs_a_configured_provider(client, monkeypatch):
    monkeypatch.delenv("NTFY_TOPIC", raising=False)
    monkeypatch.delenv("GOTIFY_URL", raising=False)
    monkeypatch.delenv("GOTIFY_TOKEN", raising=False)
    assert client.post("/api/notifications/test").status_code == 409


def test_ntfy_payload(monkeypatch):
    posted = {}

    class Response:
        def raise_for_status(self):
            pass

    def fake_post(url, json, headers, timeout):
        posted.update(url=url, json=json, headers=headers)
        return Response()

    monkeypatch.setenv("NTFY_TOPIC", "my-topic")
    monkeypatch.setenv("NTFY_URL", "https://ntfy.example.com/")
    monkeypatch.setenv("NTFY_TOKEN", "tk_123")
    monkeypatch.delenv("GOTIFY_URL", raising=False)
    monkeypatch.setattr(notifications.httpx, "post", fake_post)

    assert notifications.send("Lecture", "Starts in 10 min") == ["ntfy"]
    assert posted["url"] == "https://ntfy.example.com"
    assert posted["json"]["topic"] == "my-topic"
    assert posted["json"]["title"] == "Lecture"
    assert posted["headers"] == {"Authorization": "Bearer tk_123"}


def test_gotify_payload(monkeypatch):
    posted = {}

    class Response:
        def raise_for_status(self):
            pass

    def fake_post(url, json, headers, timeout):
        posted.update(url=url, json=json, headers=headers)
        return Response()

    monkeypatch.delenv("NTFY_TOPIC", raising=False)
    monkeypatch.setenv("GOTIFY_URL", "https://gotify.example.com/")
    monkeypatch.setenv("GOTIFY_TOKEN", "app_tok")
    monkeypatch.setattr(notifications.httpx, "post", fake_post)

    assert notifications.send("Lecture", "Starts now") == ["gotify"]
    assert posted["url"] == "https://gotify.example.com/message"
    assert posted["headers"] == {"X-Gotify-Key": "app_tok"}
    assert posted["json"]["message"] == "Starts now"
