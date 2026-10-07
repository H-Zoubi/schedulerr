"""Getting data out and back in: a full JSON export/import and a subscribable calendar feed.

The calendar feed is read by phone and desktop calendar apps, which cannot send an
Authorization header, so its secret is part of the URL. It is stored like an API key
(hashed, scope "feed") but grants nothing except this one read-only feed.
"""

import json
import os
import secrets
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import Date, DateTime, Time, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .api_keys import key_owner
from .auth import _hash_token, _now, api_user
from .db import Base, get_db
from .models import ApiKey, Event, ReminderSent, Task, TaskBlock, TimeBlock, User

EXPORT_FORMAT = 1

# Everything that belongs to the planner. Accounts, sessions and keys are deliberately left out.
EXPORT_TABLES = [
    "projects", "columns", "tasks", "task_blocks", "time_blocks", "events",
    "habits", "habit_logs", "reminders",
]

FEED_SCOPE = "feed"
FEED_DAYS_BACK = 90


# ---------- Export / import ----------

export_router = APIRouter(tags=["Backup"])


def _tables():
    # sorted_tables is in dependency order: parents before children.
    return [t for t in Base.metadata.sorted_tables if t.name in EXPORT_TABLES]


def _encode(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value


def _decode(column, value):
    if value is None or not isinstance(value, str):
        return value
    kind = column.type
    if isinstance(kind, DateTime):
        return datetime.fromisoformat(value)
    if isinstance(kind, Date):
        return date.fromisoformat(value)
    if isinstance(kind, Time):
        return time.fromisoformat(value)
    return value


@export_router.get("/export")
def export_all(_: User = Depends(api_user), db: Session = Depends(get_db)):
    tables = _tables()
    data = {}
    for table in tables:
        rows = db.execute(table.select().order_by(*table.primary_key.columns)).mappings().all()
        data[table.name] = [{k: _encode(v) for k, v in row.items()} for row in rows]
    stamp = _now().strftime("%Y-%m-%d")
    return Response(
        content=json.dumps(
            {"app": "schedulerr", "format": EXPORT_FORMAT, "exported_at": _now().isoformat(), "tables": data},
            ensure_ascii=False,
        ),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="schedulerr-{stamp}.json"'},
    )


class ImportIn(BaseModel):
    app: str
    format: int
    tables: dict[str, list[dict]]


class ImportResult(BaseModel):
    imported: dict[str, int]


@export_router.post("/import", response_model=ImportResult)
def import_all(body: ImportIn, _: User = Depends(key_owner), db: Session = Depends(get_db)):
    """Replaces all planner data with the contents of an export. Signed-in browser only."""
    if body.app != "schedulerr" or body.format != EXPORT_FORMAT:
        raise HTTPException(422, "This is not a Schedulerr export this version can read")
    tables = _tables()
    known = {t.name: t for t in tables}
    unknown = set(body.tables) - set(known)
    if unknown:
        raise HTTPException(422, f"Unknown tables in export: {', '.join(sorted(unknown))}")

    prepared: dict[str, list[dict]] = {}
    try:
        for name, rows in body.tables.items():
            columns = {c.name: c for c in known[name].columns}
            out = []
            for row in rows:
                extra = set(row) - set(columns)
                if extra:
                    raise ValueError(f"{name}: unknown fields {', '.join(sorted(extra))}")
                out.append({k: _decode(columns[k], v) for k, v in row.items()})
            prepared[name] = out
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, f"Could not read the export: {exc}")

    try:
        db.query(ReminderSent).delete()
        for table in reversed(tables):
            db.execute(table.delete())
        for table in tables:
            if prepared.get(table.name):
                db.execute(table.insert(), prepared[table.name])
        _reset_sequences(db, tables)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        detail = str(getattr(exc, "orig", exc)).splitlines()[0][:200]
        raise HTTPException(422, f"The export does not fit the database: {detail}")
    return ImportResult(imported={t.name: len(prepared.get(t.name, [])) for t in tables})


def _reset_sequences(db: Session, tables) -> None:
    """Rows were inserted with their ids, so PostgreSQL's id counters must catch up."""
    if db.get_bind().dialect.name != "postgresql":
        return
    for table in tables:
        if "id" in table.columns:
            db.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table.name}), 0) + 1, false)"
            ))


# ---------- Calendar feed ----------

feed_admin = APIRouter(prefix="/auth/calendar-feed", tags=["Calendar feed"])
feed_router = APIRouter(tags=["Calendar feed"])


class FeedStatus(BaseModel):
    enabled: bool
    created_at: datetime | None = None
    path: str | None = None  # only returned right after creating


def _feed_rows(db: Session, user: User):
    return db.query(ApiKey).filter(ApiKey.user_id == user.id, ApiKey.scope == FEED_SCOPE)


@feed_admin.get("", response_model=FeedStatus)
def feed_status(user: User = Depends(key_owner), db: Session = Depends(get_db)):
    row = _feed_rows(db, user).first()
    return FeedStatus(enabled=row is not None, created_at=row.created_at if row else None)


@feed_admin.post("", response_model=FeedStatus, status_code=201)
def create_feed(user: User = Depends(key_owner), db: Session = Depends(get_db)):
    """Creates the feed link, replacing any earlier one (which stops working)."""
    _feed_rows(db, user).delete()
    secret = secrets.token_urlsafe(32)
    now = _now()
    db.add(ApiKey(user_id=user.id, name="Calendar feed", token_hash=_hash_token(secret),
                  prefix="feed", scope=FEED_SCOPE, created_at=now, expires_at=None))
    db.commit()
    return FeedStatus(enabled=True, created_at=now, path=f"/api/feed/{secret}.ics")


@feed_admin.delete("", status_code=204)
def delete_feed(user: User = Depends(key_owner), db: Session = Depends(get_db)):
    _feed_rows(db, user).delete()
    db.commit()
    return Response(status_code=204)


@feed_router.get("/feed/{token}.ics")
def calendar_feed(token: str, request: Request, db: Session = Depends(get_db)):
    if len(token) > 128:
        raise HTTPException(404)
    row = db.query(ApiKey).filter(ApiKey.token_hash == _hash_token(token),
                                  ApiKey.scope == FEED_SCOPE).one_or_none()
    if row is None:
        raise HTTPException(404, "Calendar feed not found")
    since = datetime.combine(date.today() - timedelta(days=FEED_DAYS_BACK), time.min)
    body = build_ics(db, since, request.url.hostname or "schedulerr")
    return Response(content=body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'inline; filename="schedulerr.ics"'})


# ---------- iCalendar ----------

def _escape(value: str) -> str:
    return (value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _fold(line: str) -> str:
    """Lines longer than 75 octets continue on the next line after a space (RFC 5545 3.1)."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, current, size = [], "", 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        if size + n > (75 if not parts else 74):
            parts.append(current)
            current, size = "", 0
        current += ch
        size += n
    parts.append(current)
    return "\r\n ".join(parts)


def build_ics(db: Session, since: datetime, host: str) -> str:
    tz_name = os.environ.get("APP_TIMEZONE", "UTC")
    zone = ZoneInfo(tz_name)
    utc = tz_name.upper() in {"UTC", "ETC/UTC", "GMT"}

    def local(prop: str, value: datetime) -> str:
        stamp = value.strftime("%Y%m%dT%H%M%S")
        return f"{prop}:{stamp}Z" if utc else f"{prop};TZID={tz_name}:{stamp}"

    def until_utc(day: date) -> str:
        end = datetime.combine(day, time(23, 59, 59), tzinfo=zone).astimezone(timezone.utc)
        return end.strftime("%Y%m%dT%H%M%SZ")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Schedulerr//Calendar feed//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Schedulerr",
        f"X-WR-TIMEZONE:{tz_name}", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]

    def vevent(uid: str, title: str, start: datetime, end: datetime, extra: list[str] = ()):
        lines.extend([
            "BEGIN:VEVENT", f"UID:{uid}@{host}", f"DTSTAMP:{stamp}",
            local("DTSTART", start), local("DTEND", end), f"SUMMARY:{_escape(title)}",
            *extra, "END:VEVENT",
        ])

    for ev in db.query(Event).filter(Event.end_at >= since).order_by(Event.start_at):
        extra = []
        if ev.location:
            extra.append(f"LOCATION:{_escape(ev.location)}")
        if ev.notes:
            extra.append(f"DESCRIPTION:{_escape(ev.notes)}")
        vevent(f"event-{ev.id}", ev.title, ev.start_at, ev.end_at, extra)

    for tb in db.query(TimeBlock).filter((TimeBlock.until_date.is_(None)) | (TimeBlock.until_date >= since.date())):
        # The first occurrence is the first matching weekday on or after start_date.
        first = tb.start_date + timedelta(days=(tb.weekday - tb.start_date.weekday()) % 7)
        if tb.until_date and first > tb.until_date:
            continue
        rule = "RRULE:FREQ=WEEKLY" + (f";UNTIL={until_utc(tb.until_date)}" if tb.until_date else "")
        vevent(f"routine-{tb.id}", tb.title, datetime.combine(first, tb.start_time),
               datetime.combine(first, tb.end_time), [rule])

    blocks = (db.query(TaskBlock, Task).join(Task, Task.id == TaskBlock.task_id)
              .filter(TaskBlock.end_at >= since).order_by(TaskBlock.start_at))
    for block, task in blocks:
        extra = [f"DESCRIPTION:{_escape(task.notes)}"] if task.notes else []
        vevent(f"task-block-{block.id}", task.title, block.start_at, block.end_at, extra)

    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"
