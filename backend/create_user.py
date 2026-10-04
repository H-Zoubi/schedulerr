"""Create the single user account.

Usage (inside the api container or a local venv):
    python create_user.py you@example.com

The password is read from a hidden prompt. For scripted setup, set
SCHEDULER_PASSWORD in the environment instead; it is never taken from the command line.
"""

import getpass
import os
import sys
from datetime import datetime, timezone

from app.auth import hash_password
from app.db import SessionLocal
from app.models import User


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage: python create_user.py you@example.com")
    email = sys.argv[1].lower()

    password = os.environ.get("SCHEDULER_PASSWORD")
    if password is None:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords do not match.")
    if len(password) < 12:
        sys.exit("Use at least 12 characters.")

    with SessionLocal() as db:
        if db.query(User).count() > 0:
            sys.exit("A user already exists. This app is single-user.")
        db.add(
            User(
                email=email,
                password_hash=hash_password(password),
                created_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
    print(f"Created user {email}")


if __name__ == "__main__":
    main()
