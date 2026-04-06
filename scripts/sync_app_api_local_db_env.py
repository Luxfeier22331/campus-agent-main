from __future__ import annotations

import argparse
from pathlib import Path

from scripts.env_sync import (
    SHARED_POSTGRES_ENV_KEY,
    load_target_seed,
    parse_env_file,
    replace_or_append_env_values,
    require_env_value,
    resolve_source_env_path,
)


TARGET_PATH = Path("apps/app-api/.env")
TARGET_KEYS = (
    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
    "APP_API_MANAGEMENT_DATABASE_URL",
)


def sync_app_api_local_db_env(
    repo_root: Path,
    source_env_path: Path | None = None,
) -> Path:
    source_path = source_env_path or resolve_source_env_path(repo_root)
    if not source_path.exists():
        raise FileNotFoundError(f"Source env file not found: {source_path}")

    source_values = parse_env_file(source_path)
    database_url = require_env_value(source_values, SHARED_POSTGRES_ENV_KEY)

    target_path = repo_root / TARGET_PATH
    target_path.parent.mkdir(parents=True, exist_ok=True)
    assignments = {target_key: database_url for target_key in TARGET_KEYS}
    content = replace_or_append_env_values(load_target_seed(target_path), assignments)
    target_path.write_text(content, encoding="utf-8")
    return target_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fan out the root-worktree shared Supabase Postgres URL into the app-api local "
            "process env used by Wrangler Hyperdrive local development and Drizzle commands."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--source-env",
        type=Path,
        default=None,
        help="Optional explicit source .env path. Defaults to the root worktree .env.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = sync_app_api_local_db_env(
        repo_root=args.repo_root.resolve(),
        source_env_path=args.source_env.resolve() if args.source_env else None,
    )
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
