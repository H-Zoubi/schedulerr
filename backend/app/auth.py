import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session as DBSession

from .db import get_db
from .models import Session, User

COOKIE_NAME = "scheduler_session"
SESSION_DAYS = 30

# scrypt parameters (N=2**15, r=8, p=1) follow OWASP's current minimum recommendation.
_SCRYPT = {"n": 2**15, "r": 8, "p": 1, "dklen": 64, "maxmem": 2**26}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: DBSession, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = _now()
    # Clear out sessions that have expired, so the table doesn't grow forever.
    db.query(Session).filter(Session.expires_at < now).delete()
    db.add(
        Session(
            token_hash=_hash_token(token),
            user_id=user.id,
            created_at=now,
            expires_at=now + timedelta(days=SESSION_DAYS),
        )
    )
    db.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        secure=True,  # Served over HTTPS via the Cloudflare Tunnel.
        samesite="lax",
        path="/",
    )


def delete_session(db: DBSession, token: str | None, response: Response) -> None:
    if token:
        db.query(Session).filter(Session.token_hash == _hash_token(token)).delete()
        db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


def current_user(
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: DBSession = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    row = db.get(Session, _hash_token(token))
    if row is None or row.expires_at.replace(tzinfo=timezone.utc) < _now():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return user
