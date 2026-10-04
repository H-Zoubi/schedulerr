# Personal Self-Hosted Scheduler — Plan

(Original plan, kept here as the reference document. Decisions made since are recorded in README.md.)

## Goal

Build an original, self-hosted personal planning app that combines a real calendar-style scheduler with tasks, flexible habits, and a Kanban board. It should feel good on both phone and desktop, without requiring App Store distribution or an Apple developer licence.

## Product principles

- **Mobile-first, desktop-capable.** The phone experience is primary; desktop adds a wider weekly view.
- **Calendar and task board are connected, not competing systems.** A task can remain unscheduled or be time-blocked when it needs a place in the week.
- **Habits do not need fake appointments.** A habit can have a daily or weekly target without occupying a fixed time slot.
- **Keep the system easy to change.** Recurring commitments, one-off events, task durations, and plans should all be quick to edit or move.
- **Private and portable.** The app and data are self-hosted, with simple backup and export paths.

## Core item types

### Scheduled events
- Recurring courses, work shifts, routines, and appointments
- One-off meetings and events
- Start/end times, recurrence rules, and optional reminders
- One-time edits without changing every future occurrence

### Tasks
- An unscheduled inbox
- Optional deadline, duration estimate, project, and priority
- Can be dragged into the calendar to create a time block
- Can move through a Kanban workflow

### Habits
- Daily or weekly targets, such as "walk three times this week"
- Completion tracking and optional streaks
- No calendar slot by default
- Can optionally be scheduled for a particular session when useful

### Projects
- Initial workflow: Inbox, Planned, Doing, Done
- Tasks can be moved between columns quickly
- Meeting preparation and follow-up can be linked to the meeting event

## Main screens

1. **Week Schedule** — day/week time grid, fixed and one-off events, time-blocked tasks, drag to reschedule/resize/move tasks into open time, warnings for overlaps and insufficient buffer.
2. **Today** — today's blocks, due and scheduled tasks, flexible habits due today or still needed this week, short unscheduled list.
3. **Inbox** — fast capture; quick conversion into a block or Kanban task.
4. **Habits** — daily and weekly progress, completion controls, targets, optional streak history.
5. **Kanban** — project tasks by workflow stage; cards movable between columns and schedulable from the board.

## First prototype scope

- Week schedule with seeded recurring courses and one-off events
- Task inbox and basic task creation
- Time-blocking tasks in the week view
- Flexible habits with daily/weekly targets and completion state
- Kanban board with basic drag/move behaviour
- A responsive phone layout and a wider desktop weekly layout

## Later phases

- Calendar import/export (iCalendar), notifications and reminders, offline-first data handling and sync recovery, PWA installation, search/filters/reviews/statistics, backup/restore and export, optional planning assistance.

## Recommended technology stack

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript |
| Backend | Python + FastAPI |
| Calendar | Schedule-X |
| Database | PostgreSQL |
| Deployment | Docker Compose |
| Mobile delivery | Progressive Web App |
| Offline and caching | Service worker / Workbox |

## Hosting approach

- React frontend, Python API, and PostgreSQL as Docker containers on a personal computer or small server.
- Secure remote access via reverse proxy and HTTPS.
- HTTPS before enabling browser notifications or installing the app on a phone.
- Automatic database backups and manual export from the start of production.

## Notifications

- Reminders in the first production version.
- Self-hosted **ntfy** as a delivery option, alongside browser notifications.
- Notification preferences stored per reminder.

## Decisions still to make

- **Remote access:** required; securely usable away from home.
- **External calendar import:** not needed initially.
- **Habit cadence:** support both daily and weekly targets.
- **Reminders:** required in the first production version, with ntfy support.
