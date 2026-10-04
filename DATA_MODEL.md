# Data model (draft 1)

## Time items on the calendar

There are three kinds of things that occupy time. They share one calendar but behave differently.

| Kind | Example | Completable? | Recurs? |
| --- | --- | --- | --- |
| **Time block** (`time_block`) | "Every Sunday 08:00–09:00" | No. You are simply on schedule. | Yes, always |
| **Event** (`event`) | "Meeting with Sam, Thu 15:00–16:00" | No | Optional |
| **Task block** (`task_block`) | "Write report, Tue 10:00–12:00" | Yes, via its task | No, one per placement |

Time blocks and events are fixed commitments. Task blocks are placements of a task into open time.

## Tables

### `time_block`
- `id`
- `title`
- `rrule` (RFC 5545, e.g. `FREQ=WEEKLY;BYDAY=SU`)
- `start_time`, `end_time` (local time of day)
- `start_date` (first occurrence), `until_date` (optional)
- `timezone`
- `color`
- `notes`

### `time_block_exception`
- `block_id`, `occurrence_date`
- `action`: `cancelled` or `moved`
- `new_start`, `new_end` (when moved)

### `event`
- `id`, `title`, `start_at`, `end_at`, `timezone`
- `rrule` (optional, same mechanism as time blocks)
- `location`, `notes`
- `linked_meeting_id` is not needed. Prep and follow-up tasks link to the event through `task.event_id`.

### `task`
- `id`, `title`, `notes`
- `status`: `inbox` | `planned` | `doing` | `done`. **Inbox is a status, not a separate table.**
- `project_id` (optional)
- `priority` (optional)
- `deadline` (optional)
- `duration_minutes` (estimate, optional)
- `event_id` (optional, for prep and follow-up links)
- `position` (ordering within a Kanban column)
- `created_at`, `completed_at`

### `project`
- `id`, `name`, `color`

### `task_block`
- `id`, `task_id`
- `start_at`, `end_at`
- A task can have many blocks. Moving a block changes only the block; the task keeps its status and history.

### `habit`
- `id`, `title`
- `target_count`, `target_period`: `day` | `week`
- `archived`

### `habit_log`
- `habit_id`, `logged_on` (date), `count`
- Streaks are computed from logs, not stored.

## Decisions reflected here

- Weekly is the default habit target period.
- Habits have no calendar slot unless a `task_block` is created for them.
- Single-occurrence edits to recurring time blocks use exceptions, so the series is never rewritten by a one-off change.
- All times are stored with a timezone; recurrences are expanded at read time.

## Open questions

- Should a time block be able to hold a task (e.g. "homework during Sunday class")? Current answer: no; use a separate task block.
- Do events need a "done" state? Current answer: no.
