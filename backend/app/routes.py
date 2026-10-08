from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from .auth import api_user
from .db import get_db
from .models import (
    Column, Event, Habit, HabitLog, Project, Reminder, Spending, Task, TaskBlock, TimeBlock, TimeBlockException, User,
)
from . import notifications
from .recurrence import exceptions_by_block, expand, is_occurrence, next_deadline

router = APIRouter(dependencies=[Depends(api_user)])

TaskStatus = Literal["inbox", "planned", "doing", "done"]


def _get_or_404(db: DBSession, model, item_id: int):
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
    return item


def _apply(item, data: dict) -> None:
    for key, value in data.items():
        setattr(item, key, value)


def _check_range(start, end, db: DBSession) -> None:
    """Reject an end that is not after the start. Rolls back the pending change first."""
    if start is None or end is None or end <= start:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End must be after start")


# ---------- Week view ----------

class WeekItem(BaseModel):
    kind: Literal["time", "event", "task_block"]
    id: int
    title: str
    start: datetime | None = None  # events and task blocks
    end: datetime | None = None
    start_time: time | None = None  # time blocks: local time on this date
    end_time: time | None = None
    color: str
    task_id: int | None = None
    original_date: date | None = None  # time blocks: the occurrence's date before any move


class WeekDay(BaseModel):
    date: date
    items: list[WeekItem]


@router.get("/week", response_model=list[WeekDay])
def week(start: date, db: DBSession = Depends(get_db)) -> list[WeekDay]:
    """Seven days from `start`, with time blocks expanded per date."""
    days = [start + timedelta(days=i) for i in range(7)]
    range_start = datetime.combine(days[0], time.min)
    range_end = datetime.combine(days[-1] + timedelta(days=1), time.min)

    occurrences = expand(db.query(TimeBlock).all(), exceptions_by_block(db), days[0], days[-1])
    events = (
        db.query(Event)
        .filter(Event.start_at < range_end, Event.end_at > range_start)
        .all()
    )
    task_blocks = (
        db.query(TaskBlock, Task.title)
        .join(Task, Task.id == TaskBlock.task_id)
        .filter(TaskBlock.start_at < range_end, TaskBlock.end_at > range_start)
        .all()
    )

    result = []
    for day in days:
        items: list[WeekItem] = []
        for o in occurrences:
            if o.date != day:
                continue
            items.append(
                WeekItem(
                    kind="time", id=o.block.id, title=o.block.title, color=o.block.color,
                    start_time=o.start_time, end_time=o.end_time, original_date=o.original_date,
                )
            )
        for e in events:
            if e.start_at.date() == day:
                items.append(
                    WeekItem(kind="event", id=e.id, title=e.title, color=e.color,
                             start=e.start_at, end=e.end_at)
                )
        for block, title in task_blocks:
            if block.start_at.date() == day:
                items.append(
                    WeekItem(kind="task_block", id=block.id, title=title,
                             color="#16a34a", start=block.start_at, end=block.end_at,
                             task_id=block.task_id)
                )
        result.append(WeekDay(date=day, items=items))
    return result


# ---------- Time blocks ----------

class TimeBlockIn(BaseModel):
    title: str
    weekday: int
    start_time: time
    end_time: time
    start_date: date
    until_date: date | None = None
    color: str = "#4f46e5"
    interval_weeks: int = Field(default=1, ge=1, le=52)

    @model_validator(mode="after")
    def _end_after_start(self):
        if not 0 <= self.weekday <= 6:
            raise ValueError("weekday must be 0 (Monday) to 6 (Sunday)")
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        if self.until_date and self.until_date < self.start_date:
            raise ValueError("until_date must not be before start_date")
        return self


class TimeBlockOut(TimeBlockIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


class OccurrenceIn(BaseModel):
    """Skip one occurrence, or move it to another date and/or time."""
    skipped: bool = False
    new_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None

    @model_validator(mode="after")
    def _check(self):
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("Give both start_time and end_time, or neither")
        if self.start_time and self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class OccurrenceOut(OccurrenceIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    time_block_id: int
    on_date: date


class SplitIn(BaseModel):
    """Change a routine from one occurrence onward: earlier ones keep the old settings."""
    from_date: date
    block: TimeBlockIn


class SplitOut(BaseModel):
    before: TimeBlockOut | None  # None when the split starts at the first occurrence
    after: TimeBlockOut


@router.get("/time-blocks", response_model=list[TimeBlockOut])
def list_time_blocks(db: DBSession = Depends(get_db)):
    return db.query(TimeBlock).order_by(TimeBlock.weekday, TimeBlock.start_time).all()


@router.post("/time-blocks", response_model=TimeBlockOut, status_code=201)
def create_time_block(body: TimeBlockIn, db: DBSession = Depends(get_db)):
    item = TimeBlock(**body.model_dump())
    db.add(item)
    db.commit()
    return item


@router.patch("/time-blocks/{item_id}", response_model=TimeBlockOut)
def update_time_block(item_id: int, body: TimeBlockIn, db: DBSession = Depends(get_db)):
    item = _get_or_404(db, TimeBlock, item_id)
    _apply(item, body.model_dump())
    db.commit()
    return item


@router.delete("/time-blocks/{item_id}", status_code=204)
def delete_time_block(item_id: int, db: DBSession = Depends(get_db)):
    db.delete(_get_or_404(db, TimeBlock, item_id))
    db.commit()
    return Response(status_code=204)


@router.get("/time-block-exceptions", response_model=list[OccurrenceOut])
def list_occurrence_changes(db: DBSession = Depends(get_db)):
    return db.query(TimeBlockException).order_by(TimeBlockException.on_date).all()


def _occurrence_or_422(db: DBSession, block: TimeBlock, on_date: date) -> None:
    if not is_occurrence(block, on_date):
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "That routine has no occurrence on this date")


@router.put("/time-blocks/{item_id}/occurrences/{on_date}", response_model=OccurrenceOut)
def change_occurrence(item_id: int, on_date: date, body: OccurrenceIn, db: DBSession = Depends(get_db)):
    """Skip or move the occurrence originally on `on_date`. The rest of the routine is unchanged."""
    block = _get_or_404(db, TimeBlock, item_id)
    _occurrence_or_422(db, block, on_date)
    row = (db.query(TimeBlockException)
           .filter(TimeBlockException.time_block_id == item_id, TimeBlockException.on_date == on_date)
           .one_or_none())
    if row is None:
        row = TimeBlockException(time_block_id=item_id, on_date=on_date)
        db.add(row)
    _apply(row, body.model_dump())
    db.commit()
    return row


@router.delete("/time-blocks/{item_id}/occurrences/{on_date}", status_code=204)
def restore_occurrence(item_id: int, on_date: date, db: DBSession = Depends(get_db)):
    """Put a skipped or moved occurrence back where the routine has it."""
    _get_or_404(db, TimeBlock, item_id)
    (db.query(TimeBlockException)
     .filter(TimeBlockException.time_block_id == item_id, TimeBlockException.on_date == on_date)
     .delete())
    db.commit()
    return Response(status_code=204)


@router.post("/time-blocks/{item_id}/split", response_model=SplitOut)
def split_time_block(item_id: int, body: SplitIn, db: DBSession = Depends(get_db)):
    """Apply `block` from the occurrence on `from_date` onward ("this and following").

    The original routine ends the day before and a new routine carries the changes, keeping
    the original end date and reminder. Changes to occurrences from that date on are dropped.
    """
    old = _get_or_404(db, TimeBlock, item_id)
    _occurrence_or_422(db, old, body.from_date)
    data = body.block.model_dump()
    # The new routine may start up to six days earlier (an occurrence dragged back within its
    # week); anything earlier would repeat the old routine's previous occurrence, so it starts
    # at from_date instead.
    if data["start_date"] < body.from_date - timedelta(days=6):
        data["start_date"] = body.from_date
    if data["until_date"] is not None and data["until_date"] < data["start_date"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "until_date must not be before start_date")
    new = TimeBlock(**data)
    db.add(new)
    db.query(TimeBlockException).filter(
        TimeBlockException.time_block_id == old.id, TimeBlockException.on_date >= body.from_date,
    ).delete()
    db.flush()
    reminder = (db.query(Reminder)
                .filter(Reminder.kind == "time_block", Reminder.target_id == old.id).one_or_none())
    if reminder:
        db.add(Reminder(kind="time_block", target_id=new.id, minutes_before=reminder.minutes_before))

    earlier = body.from_date - timedelta(days=1)
    has_earlier = any(is_occurrence(old, earlier - timedelta(days=d))
                      for d in range(max(0, (earlier - old.start_date).days + 1)))
    if not has_earlier:
        # The split starts at the first occurrence, so nothing of the old routine is left.
        if reminder:
            db.delete(reminder)
        db.delete(old)
        db.commit()
        return SplitOut(before=None, after=new)
    old.until_date = earlier
    db.commit()
    return SplitOut(before=old, after=new)


# ---------- Events ----------

class EventIn(BaseModel):
    title: str
    start_at: datetime
    end_at: datetime
    color: str = "#0891b2"
    location: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=5000)

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class EventOut(EventIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("/events", response_model=list[EventOut])
def list_events(db: DBSession = Depends(get_db)):
    return db.query(Event).order_by(Event.start_at).all()


@router.post("/events", response_model=EventOut, status_code=201)
def create_event(body: EventIn, db: DBSession = Depends(get_db)):
    item = Event(**body.model_dump())
    db.add(item)
    db.commit()
    return item


@router.patch("/events/{item_id}", response_model=EventOut)
def update_event(item_id: int, body: EventIn, db: DBSession = Depends(get_db)):
    item = _get_or_404(db, Event, item_id)
    _apply(item, body.model_dump())
    db.commit()
    return item


@router.delete("/events/{item_id}", status_code=204)
def delete_event(item_id: int, db: DBSession = Depends(get_db)):
    db.delete(_get_or_404(db, Event, item_id))
    db.commit()
    return Response(status_code=204)


# ---------- Projects ----------

class ProjectIn(BaseModel):
    name: str
    color: str = "#4f46e5"
    deadline: date | None = None


class ProjectPatch(BaseModel):
    name: str | None = None
    color: str | None = None
    deadline: date | None = None


class ProjectOut(ProjectIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: DBSession = Depends(get_db)):
    return db.query(Project).order_by(Project.name).all()


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, db: DBSession = Depends(get_db)):
    item = Project(**body.model_dump())
    db.add(item)
    db.commit()
    _scope_columns(db, item.id)
    return item


@router.patch("/projects/{item_id}", response_model=ProjectOut)
def update_project(item_id: int, body: ProjectPatch, db: DBSession = Depends(get_db)):
    item = _get_or_404(db, Project, item_id)
    _apply(item, body.model_dump(exclude_unset=True))
    db.commit()
    return item


@router.delete("/projects/{item_id}", status_code=204)
def delete_project(item_id: int, db: DBSession = Depends(get_db)):
    """Its tasks are kept and move to the general board, into the column with the same key."""
    item = _get_or_404(db, Project, item_id)
    general = _scope_columns(db, None)
    general_by_key = {c.key: c for c in general if c.key}
    old_keys = {c.id: c.key for c in db.query(Column).filter(Column.project_id == item.id)}
    for task in db.query(Task).filter(Task.project_id == item.id).all():
        task.project_id = None
        target = general_by_key.get(old_keys.get(task.column_id), general[0])
        task.column_id = target.id
    db.delete(item)
    db.commit()
    return Response(status_code=204)


# ---------- Columns ----------

DEFAULT_COLUMNS = [
    ("inbox", "Inbox", False),
    ("planned", "Planned", False),
    ("doing", "Doing", False),
    ("done", "Done", True),
]


def _scope_filter(query, project_id: int | None):
    """Columns of one board: project_id None is the general board."""
    if project_id is None:
        return query.filter(Column.project_id.is_(None))
    return query.filter(Column.project_id == project_id)


def _scope_columns(db: DBSession, project_id: int | None) -> list[Column]:
    """All columns of a board, in order. A board with no columns gets the defaults."""
    query = _scope_filter(db.query(Column), project_id).order_by(Column.position, Column.id)
    cols = query.all()
    if not cols:
        for position, (key, name, is_done) in enumerate(DEFAULT_COLUMNS):
            db.add(Column(project_id=project_id, name=name, key=key,
                          position=position, is_done=is_done))
        db.commit()
        cols = query.all()
    return cols


def _resolve_column(db: DBSession, column_id: int | None, project_id: int | None) -> Column:
    """The column a task should go in. Defaults to the first column of its board."""
    if column_id is None:
        return _scope_columns(db, project_id)[0]
    column = _get_or_404(db, Column, column_id)
    if column.project_id != project_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "That column belongs to a different board")
    return column


class ColumnIn(BaseModel):
    name: str
    project_id: int | None = None
    is_done: bool = False


class ColumnPatch(BaseModel):
    name: str | None = None
    position: int | None = None
    is_done: bool | None = None


class ColumnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int | None
    name: str
    key: str | None
    position: int
    is_done: bool


@router.get("/columns", response_model=list[ColumnOut])
def list_columns(project_id: int | None = None, db: DBSession = Depends(get_db)):
    """Columns for one board. Omit project_id for the general board."""
    return _scope_columns(db, project_id)


@router.post("/columns", response_model=ColumnOut, status_code=201)
def create_column(body: ColumnIn, db: DBSession = Depends(get_db)):
    _scope_columns(db, body.project_id)
    last = _scope_filter(db.query(func.max(Column.position)), body.project_id).scalar()
    item = Column(project_id=body.project_id, name=body.name, is_done=body.is_done,
                  position=(last or 0) + 1)
    db.add(item)
    db.commit()
    return item


@router.patch("/columns/{item_id}", response_model=ColumnOut)
def update_column(item_id: int, body: ColumnPatch, db: DBSession = Depends(get_db)):
    item = _get_or_404(db, Column, item_id)
    _apply(item, body.model_dump(exclude_unset=True))
    db.commit()
    return item


@router.delete("/columns/{item_id}", status_code=204)
def delete_column(item_id: int, db: DBSession = Depends(get_db)):
    """Its tasks move to the first other column of the same board."""
    item = _get_or_404(db, Column, item_id)
    others = [c for c in _scope_columns(db, item.project_id) if c.id != item.id]
    if not others:
        raise HTTPException(status.HTTP_409_CONFLICT, "A board needs at least one column")
    db.query(Task).filter(Task.column_id == item.id).update({"column_id": others[0].id})
    db.delete(item)
    db.commit()
    return Response(status_code=204)


# ---------- Tasks ----------

class TaskIn(BaseModel):
    title: str
    notes: str = ""
    project_id: int | None = None
    column_id: int | None = None
    duration_minutes: int | None = None
    deadline: date | None = None
    priority: int = Field(default=0, ge=0, le=3)
    position: int = 0
    repeat_every: int | None = Field(default=None, ge=1, le=365)
    repeat_unit: Literal["day", "week", "month", "year"] | None = None

    @model_validator(mode="after")
    def _repeat_pair(self):
        _check_repeat(self.repeat_every, self.repeat_unit)
        return self


def _check_repeat(every, unit) -> None:
    if (every is None) != (unit is None):
        raise ValueError("Set both repeat_every and repeat_unit, or neither")


class TaskPatch(BaseModel):
    title: str | None = None
    notes: str | None = None
    project_id: int | None = None
    column_id: int | None = None
    duration_minutes: int | None = None
    deadline: date | None = None
    position: int | None = None
    priority: int | None = Field(default=None, ge=0, le=3)
    repeat_every: int | None = Field(default=None, ge=1, le=365)
    repeat_unit: Literal["day", "week", "month", "year"] | None = None

    @model_validator(mode="after")
    def _repeat_pair(self):
        if "repeat_every" in self.model_fields_set or "repeat_unit" in self.model_fields_set:
            _check_repeat(self.repeat_every, self.repeat_unit)
        return self


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    notes: str
    project_id: int | None
    column_id: int | None
    column_key: str | None  # inbox | planned | doing | done for default columns, else None
    done: bool              # True when the task sits in a column marked as done
    duration_minutes: int | None
    deadline: date | None
    position: int
    priority: int
    repeat_every: int | None
    repeat_unit: str | None


def _task_out(task: Task, columns: dict[int, Column]) -> dict:
    column = columns.get(task.column_id)
    return {
        "id": task.id,
        "title": task.title,
        "notes": task.notes,
        "project_id": task.project_id,
        "column_id": task.column_id,
        "column_key": column.key if column else None,
        "done": bool(column and column.is_done),
        "duration_minutes": task.duration_minutes,
        "deadline": task.deadline,
        "position": task.position,
        "priority": task.priority or 0,
        "repeat_every": task.repeat_every,
        "repeat_unit": task.repeat_unit,
    }


def _roll_forward(task: Task) -> None:
    """A repeating task isn't finished by completing it: its deadline moves to the next one."""
    task.deadline = next_deadline(task.deadline, task.repeat_every, task.repeat_unit, date.today())


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(db: DBSession = Depends(get_db)):
    columns = {c.id: c for c in db.query(Column).all()}
    tasks = db.query(Task).order_by(Task.position, Task.id).all()
    return [_task_out(t, columns) for t in tasks]


@router.post("/tasks", response_model=TaskOut, status_code=201)
def create_task(body: TaskIn, db: DBSession = Depends(get_db)):
    column = _resolve_column(db, body.column_id, body.project_id)
    data = body.model_dump(exclude={"column_id"})
    task = Task(**data, column_id=column.id, created_at=datetime.now().astimezone())
    db.add(task)
    db.commit()
    return _task_out(task, {c.id: c for c in db.query(Column).all()})


@router.patch("/tasks/{item_id}", response_model=TaskOut)
def update_task(item_id: int, body: TaskPatch, db: DBSession = Depends(get_db)):
    item = _get_or_404(db, Task, item_id)
    data = body.model_dump(exclude_unset=True)
    if "project_id" in data and data["project_id"] != item.project_id and "column_id" not in data:
        # Moving to another board: start at that board's first column.
        data["column_id"] = None
    if "project_id" in data or "column_id" in data:
        project_id = data.get("project_id", item.project_id)
        target = _resolve_column(db, data.get("column_id"), project_id)
        data["column_id"] = target.id
        repeats = data.get("repeat_every", item.repeat_every) and data.get("repeat_unit", item.repeat_unit)
        current = db.get(Column, item.column_id) if item.column_id else None
        if repeats and target.is_done and not (current and current.is_done):
            # Dropped into Done: count it as completed and keep it where it was.
            data.pop("column_id")
            data.pop("project_id", None)
            _apply(item, data)
            _roll_forward(item)
            db.commit()
            return _task_out(item, {c.id: c for c in db.query(Column).all()})
    _apply(item, data)
    db.commit()
    return _task_out(item, {c.id: c for c in db.query(Column).all()})


@router.post("/tasks/{item_id}/complete", response_model=TaskOut)
def complete_task(item_id: int, db: DBSession = Depends(get_db)):
    """Move a task to the first done column of its own board."""
    item = _get_or_404(db, Task, item_id)
    done = (_scope_filter(db.query(Column), item.project_id)
            .filter(Column.is_done.is_(True))
            .order_by(Column.position, Column.id)
            .first())
    if done is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "This board has no done column")
    if item.repeat_every and item.repeat_unit:
        _roll_forward(item)
    else:
        item.column_id = done.id
    db.commit()
    return _task_out(item, {c.id: c for c in db.query(Column).all()})


@router.delete("/tasks/{item_id}", status_code=204)
def delete_task(item_id: int, db: DBSession = Depends(get_db)):
    db.delete(_get_or_404(db, Task, item_id))
    db.commit()
    return Response(status_code=204)


# ---------- Task blocks ----------

class TaskBlockIn(BaseModel):
    task_id: int
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def _end_after_start(self):
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class TaskBlockPatch(BaseModel):
    start_at: datetime | None = None
    end_at: datetime | None = None


class TaskBlockOut(TaskBlockIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("/task-blocks", response_model=list[TaskBlockOut])
def list_task_blocks(start: date | None = None, end: date | None = None,
                     db: DBSession = Depends(get_db)):
    """All task blocks, optionally only those overlapping start..end (inclusive dates)."""
    query = db.query(TaskBlock)
    if start is not None:
        query = query.filter(TaskBlock.end_at > datetime.combine(start, time.min))
    if end is not None:
        query = query.filter(TaskBlock.start_at < datetime.combine(end + timedelta(days=1), time.min))
    return query.order_by(TaskBlock.start_at).all()


@router.post("/task-blocks", response_model=TaskBlockOut, status_code=201)
def create_task_block(body: TaskBlockIn, db: DBSession = Depends(get_db)):
    task = _get_or_404(db, Task, body.task_id)
    item = TaskBlock(**body.model_dump())
    db.add(item)
    current = db.get(Column, task.column_id) if task.column_id else None
    if current is not None and current.key == "inbox":
        planned = _scope_filter(db.query(Column), task.project_id).filter(Column.key == "planned").one_or_none()
        if planned is not None:
            task.column_id = planned.id
    db.commit()
    return item


@router.patch("/task-blocks/{item_id}", response_model=TaskBlockOut)
def update_task_block(item_id: int, body: TaskBlockPatch, db: DBSession = Depends(get_db)):
    item = _get_or_404(db, TaskBlock, item_id)
    _apply(item, body.model_dump(exclude_unset=True))
    _check_range(item.start_at, item.end_at, db)
    db.commit()
    return item


@router.delete("/task-blocks/{item_id}", status_code=204)
def delete_task_block(item_id: int, db: DBSession = Depends(get_db)):
    db.delete(_get_or_404(db, TaskBlock, item_id))
    db.commit()
    return Response(status_code=204)


# ---------- Habits ----------

class HabitIn(BaseModel):
    title: str
    target_count: int = 1
    target_period: Literal["day", "week"] = "week"


class HabitPatch(BaseModel):
    title: str | None = None
    target_count: int | None = None
    target_period: Literal["day", "week"] | None = None
    archived: bool | None = None


class HabitOut(HabitIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    archived: bool
    done: int  # completions in the requested window


class LogIn(BaseModel):
    logged_on: date
    delta: int = 1  # +1 to log, -1 to undo


def _habit_out(db: DBSession, habit: Habit, start: date, end: date) -> HabitOut:
    done = (
        db.query(HabitLog)
        .filter(HabitLog.habit_id == habit.id,
                HabitLog.logged_on >= start, HabitLog.logged_on <= end)
        .with_entities(HabitLog.count)
        .all()
    )
    return HabitOut(
        id=habit.id, title=habit.title, target_count=habit.target_count,
        target_period=habit.target_period, archived=habit.archived,
        done=sum(c for (c,) in done),
    )


@router.get("/habits", response_model=list[HabitOut])
def list_habits(start: date, end: date, db: DBSession = Depends(get_db)):
    """Completions are counted between start and end (inclusive)."""
    habits = db.query(Habit).filter(Habit.archived.is_(False)).order_by(Habit.id).all()
    return [_habit_out(db, h, start, end) for h in habits]


class HabitLogOut(BaseModel):
    habit_id: int
    logged_on: date
    count: int


@router.get("/habits/history", response_model=list[HabitLogOut])
def habit_history(start: date, end: date, db: DBSession = Depends(get_db)):
    """Per-day completion counts between start and end (inclusive), for streaks and charts."""
    logs = (
        db.query(HabitLog)
        .filter(HabitLog.logged_on >= start, HabitLog.logged_on <= end, HabitLog.count > 0)
        .order_by(HabitLog.logged_on)
        .all()
    )
    return [HabitLogOut(habit_id=l.habit_id, logged_on=l.logged_on, count=l.count) for l in logs]


@router.post("/habits", response_model=HabitOut, status_code=201)
def create_habit(body: HabitIn, db: DBSession = Depends(get_db)):
    habit = Habit(**body.model_dump())
    db.add(habit)
    db.commit()
    today = date.today()
    return _habit_out(db, habit, today, today)


@router.patch("/habits/{item_id}", response_model=HabitOut)
def update_habit(item_id: int, body: HabitPatch, db: DBSession = Depends(get_db)):
    habit = _get_or_404(db, Habit, item_id)
    _apply(habit, body.model_dump(exclude_unset=True))
    db.commit()
    today = date.today()
    return _habit_out(db, habit, today, today)


@router.post("/habits/{item_id}/log", response_model=HabitOut)
def log_habit(item_id: int, body: LogIn, start: date, end: date,
              db: DBSession = Depends(get_db)):
    habit = _get_or_404(db, Habit, item_id)
    log = (
        db.query(HabitLog)
        .filter(HabitLog.habit_id == habit.id, HabitLog.logged_on == body.logged_on)
        .one_or_none()
    )
    if log is None:
        log = HabitLog(habit_id=habit.id, logged_on=body.logged_on, count=0)
        db.add(log)
    log.count = max(0, log.count + body.delta)
    db.commit()
    return _habit_out(db, habit, start, end)


# ---------- Notifications and reminders ----------

@router.get("/notifications/status")
def notification_status():
    """Which push services are configured. Secrets are never returned."""
    return notifications.providers()


@router.post("/notifications/test")
def notification_test():
    try:
        used = notifications.send("Schedulerr", "Test notification: reminders are working.", priority=3)
    except Exception as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not send: {exc}")
    if not used:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "No notification service is configured (set NTFY_TOPIC or GOTIFY_URL and GOTIFY_TOKEN).")
    return {"sent_to": used}


class ReminderOut(BaseModel):
    kind: str
    target_id: int
    minutes_before: int


class ReminderIn(BaseModel):
    minutes_before: int | None  # None removes the reminder


_REMINDER_MODELS = {"event": Event, "task_block": TaskBlock, "time_block": TimeBlock}


@router.get("/reminders", response_model=list[ReminderOut])
def list_reminders(db: DBSession = Depends(get_db)):
    return [ReminderOut(kind=r.kind, target_id=r.target_id, minutes_before=r.minutes_before)
            for r in db.query(Reminder).all()]


@router.put("/reminders/{kind}/{target_id}", response_model=ReminderOut | None)
def set_reminder(kind: str, target_id: int, body: ReminderIn, db: DBSession = Depends(get_db)):
    model = _REMINDER_MODELS.get(kind)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown item type")
    _get_or_404(db, model, target_id)
    existing = db.query(Reminder).filter(Reminder.kind == kind, Reminder.target_id == target_id).one_or_none()
    if body.minutes_before is None:
        if existing is not None:
            db.delete(existing)
            db.commit()
        return Response(status_code=204)
    if body.minutes_before < 0 or body.minutes_before > 7 * 24 * 60:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "minutes_before must be 0 to 10080")
    if existing is None:
        existing = Reminder(kind=kind, target_id=target_id)
        db.add(existing)
    existing.minutes_before = body.minutes_before
    db.commit()
    return ReminderOut(kind=kind, target_id=target_id, minutes_before=existing.minutes_before)


# ---------- Spendings ----------

class SpendingIn(BaseModel):
    amount_cents: int = Field(ge=1, le=10_000_000)
    note: str = Field(default="", max_length=300)
    tag: str = Field(default="", max_length=50)
    spent_on: date | None = None

    @model_validator(mode="after")
    def _strip(self):
        self.note = self.note.strip()
        self.tag = self.tag.strip()
        return self


class SpendingPatch(BaseModel):
    amount_cents: int | None = Field(default=None, ge=1, le=10_000_000)
    note: str | None = Field(default=None, max_length=300)
    tag: str | None = Field(default=None, max_length=50)
    spent_on: date | None = None

    @model_validator(mode="after")
    def _strip(self):
        if self.note is not None:
            self.note = self.note.strip()
        if self.tag is not None:
            self.tag = self.tag.strip()
        return self


class SpendingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    amount_cents: int
    note: str
    tag: str
    spent_on: date
    created_at: datetime


@router.get("/spendings", response_model=list[SpendingOut])
def list_spendings(start: date | None = None, end: date | None = None, db: DBSession = Depends(get_db)):
    query = db.query(Spending)
    if start is not None:
        query = query.filter(Spending.spent_on >= start)
    if end is not None:
        query = query.filter(Spending.spent_on <= end)
    return query.order_by(Spending.spent_on.desc(), Spending.created_at.desc(), Spending.id.desc()).all()


@router.post("/spendings", response_model=SpendingOut, status_code=201)
def create_spending(body: SpendingIn, db: DBSession = Depends(get_db)):
    item = Spending(
        amount_cents=body.amount_cents,
        note=body.note,
        tag=body.tag,
        spent_on=body.spent_on or date.today(),
        created_at=datetime.now().astimezone(),
    )
    db.add(item)
    db.commit()
    return item


@router.patch("/spendings/{item_id}", response_model=SpendingOut)
def update_spending(item_id: int, body: SpendingPatch, db: DBSession = Depends(get_db)):
    item = _get_or_404(db, Spending, item_id)
    _apply(item, body.model_dump(exclude_unset=True))
    db.commit()
    return item


@router.delete("/spendings/{item_id}", status_code=204)
def delete_spending(item_id: int, db: DBSession = Depends(get_db)):
    db.delete(_get_or_404(db, Spending, item_id))
    db.commit()
    return Response(status_code=204)
