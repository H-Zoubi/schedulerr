# schedulerr

A self-hosted personal planner: a week calendar, time blocks, events, tasks with time blocks, flexible habits, and a Kanban board. Mobile-first, works on desktop.

See [PLAN.md](PLAN.md) for the product plan and [DATA_MODEL.md](DATA_MODEL.md) for the data model.

## Status: MVP

Working:
- Login (single user, scrypt password hashing, HttpOnly session cookie)
- Week view: time blocks, events, and task blocks. Phone shows one day at a time; desktop shows the full week.
- Add events and time blocks; tap a block to delete it
- Inbox: quick capture, and schedule a task into the week (sets it to Planned)
- Board: Inbox, Planned, Doing, Done. Move cards with the arrow buttons.
- Habits: daily or weekly targets, +1 and undo logging, archive

Not in the MVP yet:
- Drag to reschedule or resize (edit by deleting and re-creating for now)
- Recurrence exceptions (editing one occurrence of a time block)
- Overlap warnings, Kanban drag and drop, habit streaks
- Notifications, import/export, backup, PWA install, offline
- Docker and Cloudflare Tunnel setup (PostgreSQL is the target; SQLite is used for development now)

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
- `frontend/src/`: React and TypeScript app. `pages/` holds one file per screen.

## Decisions

- Single user. Remote access will go through a Cloudflare Tunnel, so the in-app login stays required.
- Three kinds of time item: time blocks (recurring, not completable), events, and task blocks.
- Tasks have a status (Inbox, Planned, Doing, Done). Inbox is a status, not a separate table.
- Habits default to weekly targets; daily is optional. Habits have no calendar slot unless you choose one.
- The calendar is a simple custom grid rather than Schedule-X, until Schedule-X's licence and drag features are checked.
