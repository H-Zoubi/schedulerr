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
- Browser sessions have full single-user permissions. AI integrations can use
  separate read-only or read/write API keys (see below).
- To apply a committed update on a Docker host, rebuild with
  `docker compose up -d --build`. Back up the database first and verify the login
  screen shows `v0.1.1` afterward. A Git commit alone does not update the running API.

## AI access to your planner

Open **AI access** in the app to create a named key. Choose read-only or
read/write permissions and an expiry (90 days by default). Copy the secret when
it appears: it is only returned once and is never stored in the browser. The
server stores its hash. Revoke a key on this page to stop access immediately.
Only a signed-in browser session can manage keys; AI keys cannot create other keys.
Apply migrations before running the updated backend (`python -m alembic upgrade head`);
Docker applies them automatically on startup.

For environment-managed keys, you can also generate a key from the project root:

```powershell
python backend/create_api_key.py --user-id 1
```

Use your account's actual ID (shown by `/auth/me` while signed in). The default
key can read the planner. Add `--scope write` if your AI should also create,
edit, and delete items. These permissions cover every `/api/` resource,
including tasks, habits, projects, and reminders as well as the calendar.

Save the printed secret in your AI client's credential storage. Add the printed
`AI_API_USER_ID` and key hash settings to the root `.env` for Docker Compose.
For a local backend, set these as environment variables before starting Uvicorn;
the backend does not automatically load `.env`. No key is enabled until configured.
Recreate the API container after configuration with `docker compose up -d --build api`.

Your AI client sends `Authorization: Bearer YOUR_KEY` to your HTTPS planner URL.
For example, `GET /api/week?start=2026-10-05` returns seven days of calendar items.
The API schemas are available at the backend's `/docs` and `/openapi.json` routes
(port 8000 locally); the production web proxy does not expose those routes.
Calendar timestamps follow the planner's local timezone.

Generate a replacement key and replace its hash to rotate access, or remove
the hash to revoke access. Restart/recreate the backend afterward. Keep the raw
secret out of Git and frontend code. This connects an AI to this project's
planner; Google Calendar or Outlook integration would require a separate OAuth setup.
Environment-managed keys are configured outside the app and do not appear in the UI.

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
