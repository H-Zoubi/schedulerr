# Changelog

## Unreleased

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
