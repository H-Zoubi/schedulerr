"""Generate an integration key without writing its secret into the repository."""
import argparse
import hashlib
import secrets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--scope", choices=("read", "write"), default="read")
    args = parser.parse_args()
    if args.user_id < 1:
        parser.error("--user-id must be positive")
    key = "schedulerr_" + secrets.token_urlsafe(32)
    digest = hashlib.sha256(key.encode()).hexdigest()
    print("Save this secret in your AI client's credential storage:")
    print(key)
    print("\nAdd these server settings to the root .env for Docker, or the backend environment:")
    print(f"AI_API_USER_ID={args.user_id}")
    print(f"AI_API_{args.scope.upper()}_KEY_HASH={digest}")


if __name__ == "__main__":
    main()
