from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import notifications
from app.db import SessionLocal
from app.main import app
from app.recurrence import next_deadline

# 2026-10-05 is a Monday.
GYM = {
    "title": "Gym", "weekday": 0, "start_time": "07:00:00", "end_time": "08:00:00",
    "start_date": "2026-10-01", "until_date": None, "color": "#4f46e5",
}


def _gym(client, **change):
    res = client.post("/api/time-blocks", json={**GYM, **change})
    assert res.status_code == 201, res.text
    return res.json()


def _routine_items(client, start):
    week = client.get(f"/api/week?start={start}").json()
    return [(d["date"], i["start_time"], i["original_date"]) for d in week for i in d["items"] if i["kind"] == "time"]


# ---------- Every N weeks ----------

def test_every_two_weeks(client):
    _gym(client, interval_weeks=2)
    assert _routine_items(client, "2026-10-05") == [("2026-10-05", "07:00:00", "2026-10-05")]
    assert _routine_items(client, "2026-10-12") == []
    assert len(_routine_items(client, "2026-10-19")) == 1


def test_interval_is_validated(client):
    assert client.post("/api/time-blocks", json={**GYM, "interval_weeks": 0}).status_code == 422
    assert client.post("/api/time-blocks", json={**GYM, "weekday": 7}).status_code == 422


# ---------- One occurrence ----------

def test_skip_one_occurrence(client):
    gym = _gym(client)
    res = client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-12", json={"skipped": True})
    assert res.status_code == 200, res.text
    assert _routine_items(client, "2026-10-12") == []
    assert len(_routine_items(client, "2026-10-05")) == 1
    assert len(_routine_items(client, "2026-10-19")) == 1

    # Restoring brings it back.
    assert client.delete(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-12").status_code == 204
    assert len(_routine_items(client, "2026-10-12")) == 1


def test_move_one_occurrence_to_another_day_and_time(client):
    gym = _gym(client)
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-12", json={
        "new_date": "2026-10-20", "start_time": "18:00:00", "end_time": "19:30:00",
    })
    # Gone from Monday the 12th's week...
    assert _routine_items(client, "2026-10-12") == []
    # ...and shown the next week on Tuesday, next to that week's regular Monday.
    assert sorted(_routine_items(client, "2026-10-19")) == [
        ("2026-10-19", "07:00:00", "2026-10-19"),
        ("2026-10-20", "18:00:00", "2026-10-12"),
    ]
    listed = client.get("/api/time-block-exceptions").json()
    assert listed[0]["on_date"] == "2026-10-12" and listed[0]["new_date"] == "2026-10-20"


def test_occurrence_must_exist(client):
    gym = _gym(client, interval_weeks=2)
    for day in ("2026-10-06", "2026-10-12", "2026-09-28"):  # a Tuesday, an off week, before start
        res = client.put(f"/api/time-blocks/{gym['id']}/occurrences/{day}", json={"skipped": True})
        assert res.status_code == 422, day
    bad_times = {"start_time": "09:00:00", "end_time": "08:00:00"}
    assert client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-05", json=bad_times).status_code == 422
    half = {"start_time": "09:00:00"}
    assert client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-05", json=half).status_code == 422


def test_editing_the_same_occurrence_twice_updates_it(client):
    gym = _gym(client)
    url = f"/api/time-blocks/{gym['id']}/occurrences/2026-10-12"
    client.put(url, json={"skipped": True})
    client.put(url, json={"start_time": "09:00:00", "end_time": "10:00:00"})
    assert _routine_items(client, "2026-10-12") == [("2026-10-12", "09:00:00", "2026-10-12")]
    assert len(client.get("/api/time-block-exceptions").json()) == 1


def test_deleting_a_routine_removes_its_changes(client):
    gym = _gym(client)
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-12", json={"skipped": True})
    client.delete(f"/api/time-blocks/{gym['id']}")
    assert client.get("/api/time-block-exceptions").json() == []


# ---------- This and following ----------

def test_split_changes_only_later_occurrences(client):
    gym = _gym(client)
    client.put(f"/api/reminders/time_block/{gym['id']}", json={"minutes_before": 15})
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-05", json={"skipped": True})
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-26", json={"skipped": True})
    res = client.post(f"/api/time-blocks/{gym['id']}/split", json={
        "from_date": "2026-10-19", "block": {**GYM, "weekday": 2, "start_time": "18:00:00", "end_time": "19:00:00"},
    })
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["before"]["until_date"] == "2026-10-18"
    assert out["after"]["start_date"] == "2026-10-19" and out["after"]["weekday"] == 2

    assert _routine_items(client, "2026-10-12") == [("2026-10-12", "07:00:00", "2026-10-12")]
    assert _routine_items(client, "2026-10-19") == [("2026-10-21", "18:00:00", "2026-10-21")]
    # The earlier skip is kept; the later one belonged to the old schedule and is dropped.
    assert [c["on_date"] for c in client.get("/api/time-block-exceptions").json()] == ["2026-10-05"]
    reminders = client.get("/api/reminders").json()
    assert sorted(r["target_id"] for r in reminders) == sorted([gym["id"], out["after"]["id"]])


def test_split_can_move_the_occurrence_earlier_in_its_week(client):
    gym = _gym(client)
    out = client.post(f"/api/time-blocks/{gym['id']}/split", json={
        "from_date": "2026-10-19", "block": {**GYM, "weekday": 5, "start_date": "2026-10-17"},
    }).json()
    assert out["after"]["start_date"] == "2026-10-17"
    assert _routine_items(client, "2026-10-12") == [
        ("2026-10-12", "07:00:00", "2026-10-12"), ("2026-10-17", "07:00:00", "2026-10-17"),
    ]


def test_split_at_first_occurrence_replaces_the_routine(client):
    gym = _gym(client)
    out = client.post(f"/api/time-blocks/{gym['id']}/split", json={
        "from_date": "2026-10-05", "block": {**GYM, "start_time": "06:00:00", "end_time": "07:00:00"},
    }).json()
    assert out["before"] is None
    assert [b["id"] for b in client.get("/api/time-blocks").json()] == [out["after"]["id"]]


# ---------- Reminders and calendar feed follow the changes ----------

@pytest.fixture
def sent(monkeypatch):
    calls = []
    monkeypatch.setattr(notifications, "send", lambda title, message, priority=4: calls.append(title) or ["fake"])
    return calls


def _run(now):
    with SessionLocal() as db:
        return notifications.run_once(db, now=now)


def test_reminders_skip_and_follow_moved_occurrences(client, sent):
    gym = _gym(client)
    client.put(f"/api/reminders/time_block/{gym['id']}", json={"minutes_before": 0})
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-05", json={"skipped": True})
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-12", json={
        "start_time": "09:00:00", "end_time": "10:00:00",
    })
    assert _run(datetime(2026, 10, 5, 7, 0)) == 0   # skipped
    assert _run(datetime(2026, 10, 12, 7, 0)) == 0  # moved away from 7:00...
    assert _run(datetime(2026, 10, 12, 9, 0)) == 1  # ...to 9:00
    assert _run(datetime(2026, 10, 19, 7, 0)) == 1  # untouched week


def test_feed_excludes_and_republishes_changed_occurrences(client):
    gym = _gym(client, interval_weeks=2)
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-05", json={"skipped": True})
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-19", json={
        "new_date": "2026-10-20", "start_time": "18:00:00", "end_time": "19:00:00",
    })
    path = client.post("/auth/calendar-feed").json()["path"]
    body = TestClient(app, base_url="https://testserver").get(path).text
    assert "RRULE:FREQ=WEEKLY;INTERVAL=2" in body
    assert "EXDATE:20261005T070000Z" in body and "EXDATE:20261019T070000Z" in body
    assert "DTSTART:20261020T180000Z" in body
    assert body.count("SUMMARY:Gym") == 2


def test_export_includes_occurrence_changes(client):
    gym = _gym(client)
    client.put(f"/api/time-blocks/{gym['id']}/occurrences/2026-10-12", json={"skipped": True})
    dump = client.get("/api/export").json()
    assert len(dump["tables"]["time_block_exceptions"]) == 1
    client.delete(f"/api/time-blocks/{gym['id']}")
    assert client.post("/api/import", json=dump).status_code == 200
    assert _routine_items(client, "2026-10-12") == []


# ---------- Repeating tasks ----------

TODAY = date.today()


def test_next_deadline_rules():
    d = date(2026, 1, 31)
    assert next_deadline(d, 1, "month", date(2026, 1, 1)) == date(2026, 2, 28)
    assert next_deadline(d, 2, "month", date(2026, 1, 1)) == date(2026, 3, 31)
    assert next_deadline(date(2026, 10, 1), 1, "week", date(2026, 10, 1)) == date(2026, 10, 8)
    # Finishing an overdue task skips ahead to the first deadline after today.
    assert next_deadline(date(2026, 9, 1), 1, "week", date(2026, 10, 7)) == date(2026, 10, 13)
    # No deadline yet: count from today.
    assert next_deadline(None, 3, "day", date(2026, 10, 7)) == date(2026, 10, 10)
    assert next_deadline(date(2024, 2, 29), 1, "year", date(2024, 3, 1)) == date(2025, 2, 28)


def test_completing_a_repeating_task_rolls_it_forward(client):
    deadline = TODAY.isoformat()
    task = client.post("/api/tasks", json={
        "title": "Water plants", "deadline": deadline, "repeat_every": 3, "repeat_unit": "day",
    }).json()
    assert task["repeat_every"] == 3 and task["repeat_unit"] == "day"
    res = client.post(f"/api/tasks/{task['id']}/complete").json()
    assert res["done"] is False
    assert res["column_key"] == "inbox"
    assert res["deadline"] == (TODAY + timedelta(days=3)).isoformat()


def test_dropping_a_repeating_task_in_done_rolls_it_forward(client):
    task = client.post("/api/tasks", json={
        "title": "Rent", "deadline": TODAY.isoformat(), "repeat_every": 1, "repeat_unit": "month",
    }).json()
    doing = next(c["id"] for c in client.get("/api/columns").json() if c["key"] == "doing")
    done = next(c["id"] for c in client.get("/api/columns").json() if c["key"] == "done")
    client.patch(f"/api/tasks/{task['id']}", json={"column_id": doing})
    res = client.patch(f"/api/tasks/{task['id']}", json={"column_id": done}).json()
    assert res["column_key"] == "doing" and res["done"] is False
    assert res["deadline"] > TODAY.isoformat()


def test_turning_repeat_off_lets_the_task_complete(client):
    task = client.post("/api/tasks", json={"title": "x", "repeat_every": 1, "repeat_unit": "week"}).json()
    off = client.patch(f"/api/tasks/{task['id']}", json={"repeat_every": None, "repeat_unit": None}).json()
    assert off["repeat_every"] is None
    assert client.post(f"/api/tasks/{task['id']}/complete").json()["done"] is True


def test_repeat_needs_both_fields(client):
    assert client.post("/api/tasks", json={"title": "x", "repeat_every": 2}).status_code == 422
    assert client.post("/api/tasks", json={"title": "x", "repeat_unit": "fortnight", "repeat_every": 1}).status_code == 422
    task = client.post("/api/tasks", json={"title": "x"}).json()
    assert client.patch(f"/api/tasks/{task['id']}", json={"repeat_unit": "day"}).status_code == 422
