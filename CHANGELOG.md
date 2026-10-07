# Changelog

## Unreleased

- Add location and notes to events; a location that is a link can be opened from the event.
- Flag overlapping calendar items in the calendar, the item details and Today.
- Add a "Buffer between blocks" setting used by "Plan my day" and "Next free slot".
- Add Settings → Backup: download all planner data as JSON and restore it.
- Add a private calendar feed (`.ics`) for subscribing from other calendar apps.
- Add a `backup` service to Docker Compose that keeps nightly `pg_dump` files.
- Stop iOS from zooming into small form fields on touch devices.

- Move API key management into Settings → API keys and drop the "AI" wording from the UI and docs; the old `/access` address opens Settings.
- Make the Docker frontend bind address configurable with `WEB_BIND` (default `127.0.0.1`) so a Cloudflare Tunnel on another host can reach it.

## 0.1.1 — 2026-10-05

- Upgrade scrypt password hashing on successful login while preserving existing accounts.
- Reserve concurrent login attempts and cap simultaneous password hashing per worker.
- Bound login password length and reject malformed stored hashes safely.
- Prevent caching authenticated API responses and add browser security headers.
- Add production Nginx login throttling and request body limits.
- Bind the Docker frontend to localhost for host-based Cloudflare Tunnels and require an explicit database password.
- Reject null task-block timestamps without changing stored data.
- Show the package version on the login screen, desktop sidebar, and mobile header.

Existing Docker deployments must set their current database password explicitly before rebuilding.
See README.md for deployment instructions and remaining limitations.
