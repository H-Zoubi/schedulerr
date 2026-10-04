"""Reminders and push notifications.

Two self-hosted push services are supported, and either or both can be configured:

- ntfy:   NTFY_TOPIC (required), NTFY_URL (default https://ntfy.sh), NTFY_TOKEN (optional)
- Gotify: GOTIFY_URL and GOTIFY_TOKEN (the application token)

A background thread checks reminders about once a minute. Each occurrence is
recorded when sent, so a reminder never fires twice. Times are the app's local
wall-clock times, so the server clock is read in APP_TIMEZONE (e.g. Asia/Amman).
"""

import logging
import os
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session as DBSession

from .models import Event, Reminder, ReminderSent, Task, TaskBlock, TimeBlock

log = logging.getLogger("scheduler.notifications")

KINDS = ("event", "task_block", "time_block")

# How far back a missed reminder is still sent, and how far ahead we look.
LOOKBEHIND = timedelta(hours=1)
LOOKAHEAD = timedelta(days=1)
CHECK_EVERY_SECONDS = 60


def app_now() -> datetime:
    """Current local time in the app's timezone, as a naive datetime (matching stored values)."""
    zone = ZoneInfo(os.environ.get("APP_TIMEZONE", "UTC"))
    return datetime.now(zone).replace(tzinfo=None)


def providers() -> dict[str, bool]:
    return {
        "ntfy": bool(os.environ.get("NTFY_TOPIC")),
        "gotify": bool(os.environ.get("GOTIFY_URL") and os.environ.get("GOTIFY_TOKEN")),
    }


def send(title: str, message: str, priority: int = 4) -> list[str]:
    """Send to every configured provider. Returns the names used; raises if a send fails."""
    used: list[str] = []

    topic = os.environ.get("NTFY_TOPIC")
    if topic:
        base = os.environ.get("NTFY_URL", "https://ntfy.sh").rstrip("/")
        headers = {}
        if token := os.environ.get("NTFY_TOKEN"):
            headers["Authorization"] = f"Bearer {token}"
        # ntfy accepts a JSON body at its base URL, so non-ASCII titles are safe.
        res = httpx.post(base, json={"topic": topic, "title": title, "message": message,
                                     "priority": min(max(priority, 1), 5)},
                         headers=headers, timeout=10)
        res.raise_for_status()
        used.append("ntfy")

    gotify_url = os.environ.get("GOTIFY_URL")
    gotify_token = os.environ.get("GOTIFY_TOKEN")
    if gotify_url and gotify_token:
        res = httpx.post(f"{gotify_url.rstrip('/')}/message",
                         json={"title": title, "message": message,
                               "priority": min(max(priority, 0), 10)},
                         headers={"X-Gotify-Key": gotify_token}, timeout=10)
        res.raise_for_status()
        used.append("gotify")

    return used


# ---------- Finding what is due ----------

def _occurrences(db: DBSession, kind: str, now: datetime):
    """Yield (target_id, title, start) for every item of this kind near `now`."""
    low, high = now - LOOKBEHIND, now + LOOKAHEAD

    if kind == "event":
        for e in db.query(Event).filter(Event.start_at >= low, Event.start_at <= high):
            yield e.id, e.title, e.start_at

    elif kind == "task_block":
        rows = (db.query(TaskBlock, Task.title)
                .join(Task, Task.id == TaskBlock.task_id)
                .filter(TaskBlock.start_at >= low, TaskBlock.start_at <= high))
        for block, title in rows:
            yield block.id, title, block.start_at

    elif kind == "time_block":
        day = low.date()
        while day <= high.date():
            blocks = (db.query(TimeBlock)
                      .filter(TimeBlock.weekday == day.weekday(),
                              TimeBlock.start_date <= day)
                      .all())
            for b in blocks:
                if b.until_date is not None and b.until_date < day:
                    continue
                start = datetime.combine(day, b.start_time)
                if low <= start <= high:
                    yield b.id, b.title, start
            day += timedelta(days=1)


def _message(start: datetime, minutes_before: int) -> str:
    when = start.strftime("%a %d %b, %H:%M")
    if minutes_before == 0:
        return f"Starts now ({when})"
    return f"Starts in {minutes_before} min ({when})"


def run_once(db: DBSession, now: datetime | None = None) -> int:
    """Send every reminder that is due and not yet sent. Returns how many were sent."""
    now = now or app_now()
    reminders = db.query(Reminder).all()
    sent = 0

    for kind in KINDS:
        wanted = [r for r in reminders if r.kind == kind]
        if not wanted:
            continue
        occurrences = list(_occurrences(db, kind, now))

        for reminder in wanted:
            for target_id, title, start in occurrences:
                if target_id != reminder.target_id:
                    continue
                if now < start - timedelta(minutes=reminder.minutes_before):
                    continue  # not yet time
                if db.get(ReminderSent, (reminder.id, start)) is not None:
                    continue  # already sent for this occurrence
                try:
                    send(title, _message(start, reminder.minutes_before))
                except Exception:
                    log.exception("could not send reminder %s", reminder.id)
                    continue  # retried on the next pass
                db.add(ReminderSent(reminder_id=reminder.id, occurrence_start=start, sent_at=now))
                db.commit()
                sent += 1

    return sent


# ---------- Background worker ----------

_stop = threading.Event()


def _loop(session_factory) -> None:
    while not _stop.is_set():
        try:
            with session_factory() as db:
                run_once(db)
        except Exception:
            log.exception("reminder check failed")
        _stop.wait(CHECK_EVERY_SECONDS)


def start_worker(session_factory) -> None:
    """Start the reminder thread. Set NOTIFICATIONS_WORKER=0 to disable it (used in tests)."""
    if os.environ.get("NOTIFICATIONS_WORKER", "1") != "1":
        return
    threading.Thread(target=_loop, args=(session_factory,), daemon=True, name="reminders").start()
