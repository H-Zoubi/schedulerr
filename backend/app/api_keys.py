import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from .auth import _hash_token, _now, current_user
from .db import get_db
from .models import ApiKey, User


def key_owner(request: Request, user: User = Depends(current_user)) -> User:
    # Integration credentials cannot manage credentials, even alongside a cookie.
    if request.headers.get("Authorization") is not None:
        raise HTTPException(403, "Sign in without an API key to manage access")
    return user


router = APIRouter(prefix="/auth/api-keys", tags=["API keys"])


class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    scope: Literal["read", "write"] = "read"
    expires_in_days: int | None = Field(default=90, ge=1, le=365)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a name")
        return value.strip()


class KeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    prefix: str
    scope: Literal["read", "write"]
    created_at: datetime
    expires_at: datetime | None


class CreatedKey(KeyOut):
    key: str


@router.get("", response_model=list[KeyOut])
def list_keys(user: User = Depends(key_owner), db: Session = Depends(get_db)):
    return db.query(ApiKey).filter(ApiKey.user_id == user.id).order_by(ApiKey.id.desc()).all()


@router.post("", response_model=CreatedKey, status_code=201)
def create_key(body: KeyIn, user: User = Depends(key_owner), db: Session = Depends(get_db)):
    secret = "schedulerr_" + secrets.token_urlsafe(32)
    now = _now()
    row = ApiKey(user_id=user.id, name=body.name, token_hash=_hash_token(secret),
                 prefix=secret[:18], scope=body.scope, created_at=now,
                 expires_at=now + timedelta(days=body.expires_in_days) if body.expires_in_days else None)
    db.add(row)
    db.commit()
    return CreatedKey(**KeyOut.model_validate(row).model_dump(), key=secret)


@router.delete("/{key_id}", status_code=204)
def revoke_key(key_id: int, user: User = Depends(key_owner), db: Session = Depends(get_db)):
    row = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.user_id == user.id).one_or_none()
    if row is None:
        raise HTTPException(404, "API key not found")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
