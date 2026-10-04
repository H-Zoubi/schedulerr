# schedulerr

A self-hosted personal planner: a week calendar, time blocks, events, tasks with time blocks, flexible habits, and a Kanban board. Mobile-first, works on desktop.

See [PLAN.md](PLAN.md) for the product plan and [DATA_MODEL.md](DATA_MODEL.md) for the data model.

## Features

- **Today**: now/next card, an agenda with your free gaps marked, one-click **Plan my day** (fits unscheduled tasks into free time), due and overdue tasks, habit check-ins.
- **Calendar**: day, 3-day, week and month views. Click or drag on empty time to create; drag to move, drag the bottom edge to resize; drag tasks in from the side tray or from the deadline chips in each day header. Overlaps sit side by side. Mini month, working-hours shading, a live "now" line, Ctrl/⌘ + scroll to zoom, swipe between days on phones.
- **Tasks**: Inbox, Today, Upcoming (next 14 days), All and Completed lists, plus one per board. Keyboard navigation, multi-select with bulk actions, inline add.
- **Board**: Kanban per project. Drag cards and columns (with live placeholders and edge auto-scroll), long-press to drag on touch, inline rename, add cards at the top or bottom.
- **Habits**: daily or weekly targets, streaks, a tappable week strip, and an 18-week heatmap.
- **Quick add** (`C` anywhere, or the + button) understands plain language: `Dentist fri 3pm 45m`, `Write report #thesis !1 due tomorrow`, `Gym every mon, wed 7-8am`.
- **Command palette** (`⌘K` / `Ctrl+K`) searches tasks, events, boards and habits, and runs commands. Press `?` for every shortcut.
- Task details open in a side drawer and save as you type. Priorities, deadlines, estimates, scheduled blocks and "next free slot".
- Reminders per calendar item (ntfy / Gotify), light and dark themes, accent colours, 12/24-hour clock, Monday or Sunday week start.

### How it stays fast

All data loads once, then every change is applied on screen immediately and synced in the background. If the server rejects a change it is rolled back with a message. Deletes show an **Undo** toast and are only sent once it expires. Recurring routines are expanded in the browser, so switching weeks or views needs no network round trip. The app refreshes quietly when you come back to the tab.

## Not done yet

- Recurrence exceptions (moving one occurrence of a routine; moving a routine moves the series, with Undo)
- Overlap warnings, import/export, backup, PWA install, offline mode

## Run it locally

Backend (Python 3.12+), from `backend/`:

```bash
python -m pip install -r requirements.txt
python -m alembic upgrade head
python create_user.py you@example.com
python -m uvicorn app.main:app --port 8000
```

Frontend (Node 20+), in a second terminal, from `frontend/`:

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and sign in.

The backend reads `DATABASE_URL` and defaults to PostgreSQL. For local development without Postgres, set SQLite first:

```bash
export DATABASE_URL="sqlite:///./dev.db"
```

Run the tests (from `backend/`):

```bash
python -m pytest
```

The schema is managed by Alembic. After changing `models.py`, create a migration with `python -m alembic revision --autogenerate -m "describe change"` and apply it with `python -m alembic upgrade head`.

## Layout

- `backend/app/`: FastAPI app. `main.py` (auth routes), `routes.py` (resources), `models.py`, `auth.py`, `db.py`
- `backend/create_user.py`: creates the single account
- `frontend/src/`: React and TypeScript app.
  - `store.ts`: in-memory data with optimistic updates, undoable deletes and temporary ids
  - `lib/`: router, preferences, natural-language parser (`nlp.ts`), derived data (`derive.ts`), toasts
  - `components/`: shared UI (dialogs, popovers, quick add, command palette, task drawer)
  - `pages/`: one file per screen; `pages/calendar/` holds the time grid, month grid and popovers

## Decisions

- Single user. Remote access will go through a Cloudflare Tunnel, so the in-app login stays required.
- Three kinds of time item: time blocks (recurring, not completable), events, and task blocks.
- Tasks have a status (Inbox, Planned, Doing, Done). Inbox is a status, not a separate table.
- Tasks have a priority: none, low, medium or high.
- Habits default to weekly targets; daily is optional. Habits have no calendar slot unless you choose one.
- The calendar is a custom grid (no calendar library), so drag, resize and layout behave the same with mouse, pen and touch.
- No UI dependencies beyond React: icons are inline SVG and styles are one hand-written stylesheet with light and dark tokens.
