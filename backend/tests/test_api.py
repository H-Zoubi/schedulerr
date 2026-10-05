def _column_id(client, key, project_id=None):
    cols = client.get("/api/columns", params={"project_id": project_id} if project_id else {}).json()
    return next(c["id"] for c in cols if c["key"] == key)


def test_task_create_update_delete(client):
    task = client.post("/api/tasks", json={"title": "Report"}).json()
    assert task["column_key"] == "inbox"
    doing = _column_id(client, "doing")
    moved = client.patch(f"/api/tasks/{task['id']}", json={"column_id": doing}).json()
    assert moved["column_key"] == "doing"
    assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert client.get("/api/tasks").json() == []


def test_default_board_has_four_columns(client):
    keys = [c["key"] for c in client.get("/api/columns").json()]
    assert keys == ["inbox", "planned", "doing", "done"]


def test_each_project_has_its_own_columns(client):
    a = client.post("/api/projects", json={"name": "Thesis"}).json()
    b = client.post("/api/projects", json={"name": "Hula"}).json()
    client.post("/api/columns", json={"project_id": a["id"], "name": "Reviewing"})
    names_a = [c["name"] for c in client.get("/api/columns", params={"project_id": a["id"]}).json()]
    names_b = [c["name"] for c in client.get("/api/columns", params={"project_id": b["id"]}).json()]
    assert names_a[-1] == "Reviewing" and len(names_a) == 5
    assert "Reviewing" not in names_b and len(names_b) == 4


def test_task_cannot_use_another_boards_column(client):
    a = client.post("/api/projects", json={"name": "A"}).json()
    a_col = _column_id(client, "inbox", a["id"])
    res = client.post("/api/tasks", json={"title": "t", "column_id": a_col})
    assert res.status_code == 422


def test_moving_task_to_project_starts_in_its_first_column(client):
    task = client.post("/api/tasks", json={"title": "t"}).json()
    proj = client.post("/api/projects", json={"name": "P"}).json()
    moved = client.patch(f"/api/tasks/{task['id']}", json={"project_id": proj["id"]}).json()
    assert moved["project_id"] == proj["id"]
    assert moved["column_key"] == "inbox"


def test_deleting_project_keeps_tasks_on_general_board(client):
    proj = client.post("/api/projects", json={"name": "P"}).json()
    doing = _column_id(client, "doing", proj["id"])
    task = client.post("/api/tasks", json={"title": "t", "project_id": proj["id"], "column_id": doing}).json()
    assert client.delete(f"/api/projects/{proj['id']}").status_code == 204
    kept = next(t for t in client.get("/api/tasks").json() if t["id"] == task["id"])
    assert kept["project_id"] is None
    assert kept["column_key"] == "doing"


def test_deleting_column_moves_its_tasks(client):
    task = client.post("/api/tasks", json={"title": "t"}).json()
    inbox = _column_id(client, "inbox")
    assert client.delete(f"/api/columns/{inbox}").status_code == 204
    moved = next(t for t in client.get("/api/tasks").json() if t["id"] == task["id"])
    assert moved["column_key"] == "planned"


def test_scheduling_an_inbox_task_plans_it(client):
    task = client.post("/api/tasks", json={"title": "t"}).json()
    client.post("/api/task-blocks", json={
        "task_id": task["id"], "start_at": "2026-10-06T10:00:00", "end_at": "2026-10-06T11:00:00",
    })
    planned = next(t for t in client.get("/api/tasks").json() if t["id"] == task["id"])
    assert planned["column_key"] == "planned"


def test_deleting_a_task_removes_its_blocks(client):
    task = client.post("/api/tasks", json={"title": "Report"}).json()
    client.post("/api/task-blocks", json={
        "task_id": task["id"], "start_at": "2026-10-06T10:00:00", "end_at": "2026-10-06T11:00:00",
    })
    client.delete(f"/api/tasks/{task['id']}")
    week = client.get("/api/week?start=2026-10-05").json()
    assert all(not day["items"] for day in week)


def test_times_are_stored_without_timezone_shift(client):
    client.post("/api/events", json={
        "title": "Meet", "start_at": "2026-10-05T10:30:00", "end_at": "2026-10-05T11:00:00",
    })
    week = client.get("/api/week?start=2026-10-05").json()
    event = next(i for d in week for i in d["items"] if i["kind"] == "event")
    assert event["start"] == "2026-10-05T10:30:00"
    assert event["end"] == "2026-10-05T11:00:00"


def test_time_block_appears_on_its_weekday_only(client):
    # Sunday 2026-10-04 is weekday 6.
    client.post("/api/time-blocks", json={
        "title": "Arabic", "weekday": 6, "start_time": "17:00", "end_time": "18:00",
        "start_date": "2026-09-28",
    })
    week = client.get("/api/week?start=2026-09-28").json()
    days_with_block = [d["date"] for d in week if any(i["kind"] == "time" for i in d["items"])]
    assert days_with_block == ["2026-10-04"]


def test_time_block_respects_until_date(client):
    client.post("/api/time-blocks", json={
        "title": "Short course", "weekday": 6, "start_time": "17:00", "end_time": "18:00",
        "start_date": "2026-09-28", "until_date": "2026-09-30",
    })
    week = client.get("/api/week?start=2026-10-04").json()
    assert all(not any(i["kind"] == "time" for i in d["items"]) for d in week)


def test_time_block_edit_is_saved(client):
    block = client.post("/api/time-blocks", json={
        "title": "Gym", "weekday": 0, "start_time": "07:00", "end_time": "08:00",
        "start_date": "2026-09-28",
    }).json()
    body = {**block, "title": "Gym (moved)", "start_time": "06:00"}
    body.pop("id")
    assert client.patch(f"/api/time-blocks/{block['id']}", json=body).json()["title"] == "Gym (moved)"


def test_event_edit_is_saved(client):
    event = client.post("/api/events", json={
        "title": "Meet", "start_at": "2026-10-05T10:00:00", "end_at": "2026-10-05T11:00:00",
    }).json()
    res = client.patch(f"/api/events/{event['id']}", json={
        "title": "Meet Sam", "start_at": "2026-10-05T14:00:00", "end_at": "2026-10-05T15:00:00",
    })
    assert res.status_code == 200
    week = client.get("/api/week?start=2026-10-05").json()
    moved = next(i for d in week for i in d["items"] if i["kind"] == "event")
    assert moved["title"] == "Meet Sam"
    assert moved["start"] == "2026-10-05T14:00:00"


def test_end_before_start_is_rejected(client):
    assert client.post("/api/events", json={
        "title": "x", "start_at": "2026-10-05T16:00:00", "end_at": "2026-10-05T15:00:00",
    }).status_code == 422
    assert client.post("/api/time-blocks", json={
        "title": "x", "weekday": 0, "start_time": "10:00", "end_time": "09:00",
        "start_date": "2026-09-01",
    }).status_code == 422
    task = client.post("/api/tasks", json={"title": "t"}).json()
    assert client.post("/api/task-blocks", json={
        "task_id": task["id"], "start_at": "2026-10-06T11:00:00", "end_at": "2026-10-06T10:00:00",
    }).status_code == 422


def test_invalid_task_block_move_is_rolled_back(client):
    task = client.post("/api/tasks", json={"title": "t"}).json()
    block = client.post("/api/task-blocks", json={
        "task_id": task["id"], "start_at": "2026-10-06T10:00:00", "end_at": "2026-10-06T11:00:00",
    }).json()
    res = client.patch(f"/api/task-blocks/{block['id']}", json={"end_at": "2026-10-06T09:00:00"})
    assert res.status_code == 422
    week = client.get("/api/week?start=2026-10-05").json()
    kept = next(i for d in week for i in d["items"] if i["kind"] == "task_block")
    assert kept["end"] == "2026-10-06T11:00:00"


def test_null_task_block_times_are_rejected_and_rolled_back(client):
    task = client.post("/api/tasks", json={"title": "t"}).json()
    block = client.post("/api/task-blocks", json={
        "task_id": task["id"], "start_at": "2026-10-06T10:00:00", "end_at": "2026-10-06T11:00:00",
    }).json()
    for field in ("start_at", "end_at"):
        res = client.patch(f"/api/task-blocks/{block['id']}", json={field: None})
        assert res.status_code == 422
    week = client.get("/api/week?start=2026-10-05").json()
    kept = next(i for d in week for i in d["items"] if i["kind"] == "task_block")
    assert kept["start"] == "2026-10-06T10:00:00"
    assert kept["end"] == "2026-10-06T11:00:00"


def test_habit_weekly_count_and_undo_floor(client):
    habit = client.post("/api/habits", json={"title": "Walk", "target_count": 3}).json()
    url = f"/api/habits/{habit['id']}/log?start=2026-09-28&end=2026-10-04"
    client.post(url, json={"logged_on": "2026-10-01", "delta": 1})
    res = client.post(url, json={"logged_on": "2026-10-02", "delta": 1}).json()
    assert res["done"] == 2
    client.post(url, json={"logged_on": "2026-10-02", "delta": -1})
    client.post(url, json={"logged_on": "2026-10-02", "delta": -1})  # would go negative
    res = client.post(url, json={"logged_on": "2026-10-02", "delta": -1}).json()
    assert res["done"] == 1


def test_habit_window_excludes_other_weeks(client):
    habit = client.post("/api/habits", json={"title": "Read"}).json()
    client.post(f"/api/habits/{habit['id']}/log?start=2026-09-28&end=2026-10-04",
                json={"logged_on": "2026-09-01", "delta": 1})
    res = client.get("/api/habits?start=2026-09-28&end=2026-10-04").json()
    assert res[0]["done"] == 0


def test_complete_moves_task_to_done_column(client):
    proj = client.post("/api/projects", json={"name": "P"}).json()
    task = client.post("/api/tasks", json={"title": "t", "project_id": proj["id"]}).json()
    done = client.post(f"/api/tasks/{task['id']}/complete").json()
    assert done["done"] is True
    assert done["column_key"] == "done"
    assert done["project_id"] == proj["id"]
