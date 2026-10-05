from datetime import datetime, timezone

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session as DBSession

from .auth import (
    COOKIE_NAME,
    create_session,
    current_user,
    delete_session,
    hash_password,
    password_needs_rehash,
    verify_password,
)
from . import routes
from .db import get_db
from .models import User
from .security import OriginCheck, login_keys, login_limiter
from . import notifications
from .db import SessionLocal

app = FastAPI(title="Schedulerr API")
app.add_middleware(OriginCheck)
app.include_router(routes.router, prefix="/api")


@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(("/auth/", "/api/")):
        response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.on_event("startup")
def start_reminders() -> None:
    notifications.start_worker(SessionLocal)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class UserOut(BaseModel):
    id: int
    email: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: DBSession = Depends(get_db)) -> User:
    keys = login_keys(request, body.email)
    with login_limiter.attempt(keys):
        user = db.query(User).filter(User.email == body.email.lower()).one_or_none()
        # Missing accounts still do expensive verification to reduce email probing.
        stored = user.password_hash if user else "scrypt$131072$8$1$" + "00" * 16 + "$" + "00" * 64
        valid = verify_password(body.password, stored)
        if user is None or not valid:
            login_limiter.record_failure(keys)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
        if password_needs_rehash(user.password_hash):
            user.password_hash = hash_password(body.password)
        # A valid login cannot wipe the IP failure counter.
        login_limiter.clear(keys[:1])
        create_session(db, user, response)
    return user


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: DBSession = Depends(get_db),
) -> Response:
    delete_session(db, token, response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@app.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> User:
    return user
