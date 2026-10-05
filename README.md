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

## Public hosting security (v0.1.1)

- Keep the public site behind HTTPS. For a Cloudflare Tunnel running on the host,
  point it at `http://127.0.0.1:8080`; Docker now binds this port only to localhost.
  A tunnel running in Docker should reach `http://web:80` on the same Docker network.
- Set `ALLOWED_ORIGINS` to your exact public HTTPS origin.
- Set `POSTGRES_PASSWORD` explicitly before starting Docker. For an existing database,
  use its current password: changing the environment variable does not rotate the
  database password. Rotate an existing weak password in PostgreSQL separately,
  then update the environment to match. URL-encode special characters in the
  `DATABASE_URL` connection string, or choose a long random alphanumeric password.
- Password hashes upgrade automatically on successful login; existing accounts and
  sessions remain usable. New scrypt hashes use about 128 MiB per verification.
  The backend permits at most two concurrent password checks per worker.
- Nginx adds login request throttling, a request body limit, and browser security
  headers. These protections require the production Nginx frontend; Vite is for
  local development only. The Nginx limit uses the connecting peer address, which
  may be shared by all visitors behind a tunnel. It does not trust arbitrary
  forwarded client-IP headers.
- Backend login failure counters remain per-process and reset on restart. Use
  Cloudflare Access or edge rate limiting for protection across restarts or replicas.
- API access currently has full single-user permissions. Do not give an untrusted
  integration your session cookie.
- To apply a committed update on a Docker host, rebuild with
  `docker compose up -d --build`. Back up the database first and verify the login
  screen shows `v0.1.1` afterward. A Git commit alone does not update the running API.

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
