import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

# ---------- CSRF: Origin check for state-changing requests ----------

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

# Comma-separated list, e.g. "https://planner.example.com,http://localhost:5173".
ALLOWED_ORIGINS = {
    o.strip().rstrip("/")
    for o in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8000"
    ).split(",")
    if o.strip()
}


class OriginCheck:
    """Rejects unsafe requests whose Origin is not ours.

    The session cookie is SameSite=Lax, which already blocks most cross-site
    POSTs. This is a second layer. Requests with no Origin header (curl, tests,
    server-to-server) are allowed, because browsers always send Origin on
    cross-site unsafe requests.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope["method"] in SAFE_METHODS:
            return await self.app(scope, receive, send)

        headers = dict(scope["headers"])
        origin = headers.get(b"origin", b"").decode().rstrip("/")
        fetch_site = headers.get(b"sec-fetch-site", b"").decode()

        blocked = (origin and origin not in ALLOWED_ORIGINS) or fetch_site == "cross-site"
        if blocked:
            response = JSONResponse({"detail": "Cross-site request blocked"}, status_code=403)
            return await response(scope, receive, send)
        return await self.app(scope, receive, send)


# ---------- Login rate limiting ----------

MAX_FAILURES = 5          # wrong passwords allowed...
WINDOW_SECONDS = 15 * 60  # ...within this window, per key


class FailureLimiter:
    """Sliding-window counter of failed logins, keyed by email and by client IP."""

    def __init__(self):
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> deque[float]:
        q = self._failures[key]
        while q and now - q[0] > WINDOW_SECONDS:
            q.popleft()
        return q

    def check(self, keys: list[str]) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                if len(self._recent(key, now)) >= MAX_FAILURES:
                    raise HTTPException(
                        status.HTTP_429_TOO_MANY_REQUESTS,
                        "Too many failed sign-in attempts. Try again in 15 minutes.",
                    )

    def record_failure(self, keys: list[str]) -> None:
        now = time.monotonic()
        with self._lock:
            for key in keys:
                self._recent(key, now).append(now)

    def clear(self, keys: list[str]) -> None:
        with self._lock:
            for key in keys:
                self._failures.pop(key, None)


login_limiter = FailureLimiter()


def login_keys(request: Request, email: str) -> list[str]:
    # Behind the Cloudflare Tunnel, request.client is the local tunnel process,
    # so the per-IP key only helps once real client IPs are passed through.
    # The per-email key works either way.
    return [f"email:{email.lower()}", f"ip:{request.client.host if request.client else 'unknown'}"]
