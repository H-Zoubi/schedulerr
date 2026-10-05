import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session as DBSession

from .db import get_db
from .models import ApiKey, Session, User

COOKIE_NAME = "schedulerr_session"
SESSION_DAYS = 30

# New hashes include their parameters; legacy hashes are upgraded on login.
_SCRYPT = {"n": 2**17, "r": 8, "p": 1, "dklen": 64, "maxmem": 2**28}
_LEGACY_SCRYPT = {**_SCRYPT, "n": 2**15}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt$131072$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) == 3 and parts[0] == "scrypt":
            _, salt_hex, digest_hex = parts
            params = _LEGACY_SCRYPT
        elif len(parts) == 6 and parts[:4] == ["scrypt", "131072", "8", "1"]:
            _, _, _, _, salt_hex, digest_hex = parts
            params = _SCRYPT
        else:
            return False
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **params)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


def password_needs_rehash(stored: str) -> bool:
    return not stored.startswith("scrypt$131072$8$1$")


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


def api_user(
    request: Request,
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: DBSession = Depends(get_db),
) -> User:
    """API integrations use scoped bearer keys; browser sessions still work."""
    authorization = request.headers.get("Authorization")
    if authorization is None:
        return current_user(token=token, db=db)
    scheme, _, key = authorization.partition(" ")
    if scheme.lower() != "bearer" or not key or len(key) > 512:
        raise HTTPException(401, "Invalid API key", headers={"WWW-Authenticate": "Bearer"})
    digest = _hash_token(key)
    row = db.query(ApiKey).filter(ApiKey.token_hash == digest).one_or_none()
    if row is not None:
        if row.expires_at is not None and row.expires_at.replace(tzinfo=timezone.utc) <= _now():
            raise HTTPException(401, "API key expired", headers={"WWW-Authenticate": "Bearer"})
        if row.scope not in {"read", "write"}:
            raise HTTPException(401, "Invalid API key")
        if row.scope == "read" and request.method not in {"GET", "HEAD", "OPTIONS"}:
            raise HTTPException(403, "This API key is read-only")
        user = db.get(User, row.user_id)
        if user is None:
            raise HTTPException(401, "Invalid API key")
        return user
    scope = None
    for name, permission in (("AI_API_READ_KEY_HASH", "read"), ("AI_API_WRITE_KEY_HASH", "write")):
        configured = os.environ.get(name, "")
        if configured and hmac.compare_digest(digest, configured):
            scope = permission
    if scope is None:
        raise HTTPException(401, "Invalid API key", headers={"WWW-Authenticate": "Bearer"})
    if scope == "read" and request.method not in {"GET", "HEAD", "OPTIONS"}:
        raise HTTPException(403, "This API key is read-only")
    try:
        user_id = int(os.environ.get("AI_API_USER_ID", ""))
    except ValueError:
        raise HTTPException(401, "API key account is not configured")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(401, "API key account is not configured")
    return user
