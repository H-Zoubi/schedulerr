from datetime import date, datetime, time

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Session(Base):
    __tablename__ = "sessions"

    # Stored as a SHA-256 hash; the raw token only ever lives in the user's cookie.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prefix: Mapped[str] = mapped_column(String(24))
    scope: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TimeBlock(Base):
    """Recurring fixed slot, e.g. every Sunday 08:00-09:00. Not completable."""

    __tablename__ = "time_blocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    weekday: Mapped[int] = mapped_column(Integer)  # 0 = Monday ... 6 = Sunday
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    start_date: Mapped[date] = mapped_column(Date)
    until_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    color: Mapped[str] = mapped_column(String(20), default="#4f46e5")


class Event(Base):
    """One-off commitment, e.g. a meeting."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    start_at: Mapped[datetime] = mapped_column(DateTime)
    end_at: Mapped[datetime] = mapped_column(DateTime)
    color: Mapped[str] = mapped_column(String(20), default="#0891b2")


class Project(Base):
    """A board of its own. Its tasks use the same four statuses as the general board."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(20), default="#4f46e5")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)


class Column(Base):
    """One column on a board. project_id NULL means the general board (unassigned tasks)."""

    __tablename__ = "columns"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(100))
    # Default columns carry a key so the app can find them: inbox | planned | doing | done.
    key: Mapped[str | None] = mapped_column(String(20), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str] = mapped_column(String(2000), default="")
    column_id: Mapped[int | None] = mapped_column(
        ForeignKey("columns.id", ondelete="SET NULL"), nullable=True
    )
    # No ON DELETE here: deleting a project is handled in the route, which moves its tasks.
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # 0 = none, 1 = low, 2 = medium, 3 = high.
    priority: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TaskBlock(Base):
    """A task placed into open time. Moving it changes only the block."""

    __tablename__ = "task_blocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    start_at: Mapped[datetime] = mapped_column(DateTime)
    end_at: Mapped[datetime] = mapped_column(DateTime)


class Habit(Base):
    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    target_count: Mapped[int] = mapped_column(Integer, default=1)
    # day | week. Weekly is the default.
    target_period: Mapped[str] = mapped_column(String(10), default="week")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class HabitLog(Base):
    __tablename__ = "habit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"))
    logged_on: Mapped[date] = mapped_column(Date)
    count: Mapped[int] = mapped_column(Integer, default=1)


class Reminder(Base):
    """A reminder on one item: kind is event | task_block | time_block."""

    __tablename__ = "reminders"
    __table_args__ = (UniqueConstraint("kind", "target_id", name="uq_reminder_target"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[int] = mapped_column(Integer)
    minutes_before: Mapped[int] = mapped_column(Integer, default=0)


class ReminderSent(Base):
    """Records each occurrence already notified, so nothing fires twice."""

    __tablename__ = "reminders_sent"

    reminder_id: Mapped[int] = mapped_column(
        ForeignKey("reminders.id", ondelete="CASCADE"), primary_key=True
    )
    occurrence_start: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime)
