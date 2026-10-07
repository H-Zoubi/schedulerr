"""Expanding routines into dated occurrences, and rolling repeating tasks forward.

Every place that shows or acts on routine occurrences (the week view, reminders and the
calendar feed) goes through `expand`, so skipped and moved occurrences agree everywhere.
The frontend mirrors these rules in lib/derive.ts.
"""

from dataclasses import dataclass
from datetime import date, time, timedelta

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from .models import TimeBlock, TimeBlockException


@dataclass
class Occurrence:
    block: TimeBlock
    original_date: date  # the date the routine's rule gives this occurrence
    date: date           # where it actually is (differs when moved)
    start_time: time
    end_time: time
    moved: bool = False


def first_occurrence(block: TimeBlock) -> date:
    return block.start_date + timedelta(days=(block.weekday - block.start_date.weekday()) % 7)


def is_occurrence(block: TimeBlock, day: date) -> bool:
    """True when the routine's rule (ignoring exceptions) puts an occurrence on `day`."""
    if day.weekday() != block.weekday or day < block.start_date:
        return False
    if block.until_date is not None and day > block.until_date:
        return False
    weeks = (day - first_occurrence(block)).days // 7
    return weeks % max(1, block.interval_weeks or 1) == 0


def exceptions_by_block(db: Session) -> dict[int, dict[date, TimeBlockException]]:
    out: dict[int, dict[date, TimeBlockException]] = {}
    for exc in db.query(TimeBlockException).all():
        out.setdefault(exc.time_block_id, {})[exc.on_date] = exc
    return out


def expand(blocks: list[TimeBlock], exceptions: dict[int, dict[date, TimeBlockException]],
           start: date, end: date) -> list[Occurrence]:
    """Every occurrence shown between start and end (inclusive), with exceptions applied."""
    out: list[Occurrence] = []
    for block in blocks:
        own = exceptions.get(block.id, {})
        day = start
        while day <= end:
            if day not in own and is_occurrence(block, day):
                out.append(Occurrence(block, day, day, block.start_time, block.end_time))
            day += timedelta(days=1)
        # Moved occurrences can land in range even when their original date is outside it.
        for exc in own.values():
            if exc.skipped or not is_occurrence(block, exc.on_date):
                continue
            where = exc.new_date or exc.on_date
            if start <= where <= end:
                out.append(Occurrence(block, exc.on_date, where,
                                      exc.start_time or block.start_time,
                                      exc.end_time or block.end_time, moved=True))
    return out


# ---------- Repeating tasks ----------

REPEAT_UNITS = ("day", "week", "month", "year")


def _step(unit: str, every: int) -> relativedelta:
    return {
        "day": relativedelta(days=every),
        "week": relativedelta(weeks=every),
        "month": relativedelta(months=every),
        "year": relativedelta(years=every),
    }[unit]


def next_deadline(current: date | None, every: int, unit: str, today: date) -> date:
    """The next deadline after completing a repeating task.

    Counts from the old deadline so "every month on the 1st" stays on the 1st, and skips
    ahead past today so finishing an overdue task doesn't leave the next one overdue too.
    """
    anchor = current or today
    n = 1
    nxt = anchor + _step(unit, every * n)
    while nxt <= today:
        n += 1
        nxt = anchor + _step(unit, every * n)
    return nxt
