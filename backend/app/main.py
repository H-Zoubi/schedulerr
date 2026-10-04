from datetime import datetime, timezone

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session as DBSession

from .auth import (
    COOKIE_NAME,
    create_session,
    current_user,
    delete_session,
    hash_password,
    verify_password,
)
from . import routes
from .db import get_db
from .models import User
from .security import OriginCheck, login_keys, login_limiter
from . import notifications
from .db import SessionLocal

app = FastAPI(title="Scheduler API")
app.add_middleware(OriginCheck)
app.include_router(routes.router, prefix="/api")


@app.on_event("startup")
def start_reminders() -> None:
    notifications.start_worker(SessionLocal)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: DBSession = Depends(get_db)) -> User:
    keys = login_keys(request, body.email)
    login_limiter.check(keys)
    user = db.query(User).filter(User.email == body.email.lower()).one_or_none()
    # Same error whether the email or password is wrong, so the email can't be probed.
    if user is None or not verify_password(body.password, user.password_hash):
        login_limiter.record_failure(keys)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    # Only the email counter resets on success, so one valid login can't wipe the IP counter.
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
