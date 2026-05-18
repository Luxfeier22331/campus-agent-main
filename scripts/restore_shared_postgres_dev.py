from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from scripts.env_sync import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    load_target_seed,
    parse_env_file,
    replace_or_append_env_values,
)
from scripts.restore_local_postgres_dev import (
    APP_API_DEV_VARS_BACKUP_PATH,
    APP_API_DEV_VARS_PATH,
    APP_API_ENV_BACKUP_PATH,
    APP_API_ENV_PATH,
    ROOT_ENV_BACKUP_PATH,
    is_local_postgres_database_url,
)
from scripts.sync_app_api_local_db_env import sync_app_api_local_db_env

DEFAULT_SHARED_APP_API_DATABASE_SSLMODE = "prefer"


def prepare_shared_postgres_restore(
    *,
    repo_root: Path,
    source_env_path: Path | None = None,
    app_api_env_source_path: Path | None = None,
    app_api_dev_vars_source_path: Path | None = None,
    app_api_database_sslmode: str = DEFAULT_SHARED_APP_API_DATABASE_SSLMODE,
) -> dict[str, Any]:
    resolved_repo_root = repo_root.resolve()
    resolved_source_env_path = _resolve_existing_source(
        repo_root=resolved_repo_root,
        explicit_path=source_env_path,
        default_relative_path=ROOT_ENV_BACKUP_PATH,
        label="shared root env",
    )
    _validate_shared_root_env_source(resolved_source_env_path)
    resolved_app_api_env_source_path = _resolve_optional_existing_source(
        repo_root=resolved_repo_root,
        explicit_path=app_api_env_source_path,
        default_relative_path=APP_API_ENV_BACKUP_PATH,
    )
    resolved_app_api_dev_vars_source_path = _resolve_optional_existing_source(
        repo_root=resolved_repo_root,
        explicit_path=app_api_dev_vars_source_path,
        default_relative_path=APP_API_DEV_VARS_BACKUP_PATH,
    )
    normalized_sslmode = _normalize_sslmode(app_api_database_sslmode)
    return {
        "repo_root": str(resolved_repo_root),
        "app_api_database_sslmode": normalized_sslmode,
        "source_paths": {
            "root_env": str(resolved_source_env_path),
            "app_api_env": (
                str(resolved_app_api_env_source_path)
                if resolved_app_api_env_source_path is not None
                else None
            ),
            "app_api_dev_vars": (
                str(resolved_app_api_dev_vars_source_path)
                if resolved_app_api_dev_vars_source_path is not None
                else None
            ),
        },
        "target_paths": {
            "root_env": str(resolved_repo_root / ".env"),
            "app_api_env": str(resolved_repo_root / APP_API_ENV_PATH),
            "app_api_dev_vars": str(resolved_repo_root / APP_API_DEV_VARS_PATH),
        },
    }


def execute_shared_postgres_restore(plan: dict[str, Any]) -> dict[str, Any]:
    repo_root = Path(str(plan["repo_root"]))
    source_paths = dict(plan["source_paths"])
    shared_root_env_source = Path(str(source_paths["root_env"]))
    target_root_env_path = _rewrite_root_env_from_shared_source(
        repo_root=repo_root,
        source_env_path=shared_root_env_source,
    )
    target_app_api_env_path = _restore_or_sync_app_api_env(
        repo_root=repo_root,
        source_env_path=shared_root_env_source,
        app_api_env_source_path=(
            Path(str(source_paths["app_api_env"])) if source_paths.get("app_api_env") else None
        ),
    )
    target_app_api_dev_vars_path = _restore_app_api_dev_vars(
        repo_root=repo_root,
        app_api_dev_vars_source_path=(
            Path(str(source_paths["app_api_dev_vars"]))
            if source_paths.get("app_api_dev_vars")
            else None
        ),
        app_api_database_sslmode=str(plan["app_api_database_sslmode"]),
    )
    return {
        "ok": True,
        "repo_root": str(repo_root),
        "source_paths": source_paths,
        "target_paths": {
            "root_env": str(target_root_env_path),
            "app_api_env": str(target_app_api_env_path),
            "app_api_dev_vars": str(target_app_api_dev_vars_path),
        },
        "app_api_database_sslmode": str(plan["app_api_database_sslmode"]),
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Restore the current worktree from local Postgres mode back to shared/cloud "
            "Postgres env values using backup snapshots or explicit source env files."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    parser.add_argument(
        "--shared-root-env",
        type=Path,
        default=None,
        help="Optional explicit source env file containing shared/cloud Postgres keys.",
    )
    parser.add_argument(
        "--shared-app-api-env",
        type=Path,
        default=None,
        help="Optional explicit app-api .env source. Defaults to the saved pre-local backup if present.",
    )
    parser.add_argument(
        "--shared-app-api-dev-vars",
        type=Path,
        default=None,
        help="Optional explicit app-api .dev.vars source. Defaults to the saved pre-local backup if present.",
    )
    parser.add_argument(
        "--app-api-database-sslmode",
        default=DEFAULT_SHARED_APP_API_DATABASE_SSLMODE,
        help="Default APP_API_DATABASE_SSLMODE when no app-api dev vars backup is available.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the restore report as JSON.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    plan = prepare_shared_postgres_restore(
        repo_root=args.repo_root.resolve(),
        source_env_path=args.shared_root_env.resolve() if args.shared_root_env else None,
        app_api_env_source_path=(
            args.shared_app_api_env.resolve() if args.shared_app_api_env else None
        ),
        app_api_dev_vars_source_path=(
            args.shared_app_api_dev_vars.resolve() if args.shared_app_api_dev_vars else None
        ),
        app_api_database_sslmode=args.app_api_database_sslmode,
    )
    result = execute_shared_postgres_restore(plan)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        _print_text_report(result)
    return 0


def _rewrite_root_env_from_shared_source(
    *,
    repo_root: Path,
    source_env_path: Path,
) -> Path:
    source_values = parse_env_file(source_env_path)
    shared_runtime_url = source_values.get(SHARED_POSTGRES_ENV_KEY, "").strip()
    shared_operator_url = source_values.get(SHARED_POSTGRES_OPERATOR_ENV_KEY, "").strip()
    assignments = {
        key: value
        for key, value in (
            (SHARED_POSTGRES_ENV_KEY, shared_runtime_url),
            (
                SHARED_POSTGRES_OPERATOR_ENV_KEY,
                shared_operator_url,
            ),
            (
                "DOCUMENT_REGISTRY_DATABASE_URL",
                source_values.get("DOCUMENT_REGISTRY_DATABASE_URL", "").strip()
                or shared_runtime_url,
            ),
            (
                "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
                source_values.get("DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL", "").strip()
                or shared_operator_url,
            ),
            (
                "RAW_ASSET_REGISTRY_DATABASE_URL",
                source_values.get("RAW_ASSET_REGISTRY_DATABASE_URL", "").strip()
                or shared_runtime_url,
            ),
            (
                "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
                source_values.get("RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL", "").strip()
                or shared_operator_url,
            ),
        )
        if value
    }
    target_path = repo_root / ".env"
    content = replace_or_append_env_values(
        load_target_seed(target_path),
        assignments,
        drop_keys=(
            "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL",
            "DOCUMENT_REGISTRY_MANAGEMENT_DATABASE_URL",
            "RAW_ASSET_REGISTRY_MANAGEMENT_DATABASE_URL",
        ),
    )
    target_path.write_text(content, encoding="utf-8")
    return target_path


def _restore_or_sync_app_api_env(
    *,
    repo_root: Path,
    source_env_path: Path,
    app_api_env_source_path: Path | None,
) -> Path:
    target_path = repo_root / APP_API_ENV_PATH
    if app_api_env_source_path is None:
        return sync_app_api_local_db_env(
            repo_root=repo_root,
            source_env_path=source_env_path,
        )

    source_values = parse_env_file(app_api_env_source_path)
    assignments = {
        key: value
        for key, value in (
            (
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB",
                source_values.get(
                    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB", ""
                ).strip(),
            ),
            (
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH",
                source_values.get(
                    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH", ""
                ).strip(),
            ),
            (
                "APP_API_OPERATOR_DATABASE_URL",
                source_values.get("APP_API_OPERATOR_DATABASE_URL", "").strip(),
            ),
        )
        if value
    }
    content = replace_or_append_env_values(
        load_target_seed(target_path),
        assignments,
        drop_keys=("APP_API_MANAGEMENT_DATABASE_URL",),
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    return target_path


def _restore_app_api_dev_vars(
    *,
    repo_root: Path,
    app_api_dev_vars_source_path: Path | None,
    app_api_database_sslmode: str,
) -> Path:
    target_path = repo_root / APP_API_DEV_VARS_PATH
    resolved_sslmode = app_api_database_sslmode
    if app_api_dev_vars_source_path is not None:
        source_values = parse_env_file(app_api_dev_vars_source_path)
        resolved_sslmode = (
            source_values.get("APP_API_DATABASE_SSLMODE", "").strip() or app_api_database_sslmode
        )
    content = replace_or_append_env_values(
        load_target_seed(target_path),
        {"APP_API_DATABASE_SSLMODE": _normalize_sslmode(resolved_sslmode)},
    )
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(content, encoding="utf-8")
    return target_path


def _resolve_existing_source(
    *,
    repo_root: Path,
    explicit_path: Path | None,
    default_relative_path: Path,
    label: str,
) -> Path:
    candidate = _resolve_optional_existing_source(
        repo_root=repo_root,
        explicit_path=explicit_path,
        default_relative_path=default_relative_path,
    )
    if candidate is None:
        raise FileNotFoundError(
            f"Missing {label} source; provide an explicit path or create {default_relative_path}"
        )
    return candidate


def _resolve_optional_existing_source(
    *,
    repo_root: Path,
    explicit_path: Path | None,
    default_relative_path: Path,
) -> Path | None:
    if explicit_path is not None:
        resolved = explicit_path.resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Source file not found: {resolved}")
        return resolved
    default_source = repo_root / default_relative_path
    return default_source if default_source.exists() else None


def _validate_shared_root_env_source(source_env_path: Path) -> None:
    source_values = parse_env_file(source_env_path)
    runtime_url = source_values.get(SHARED_POSTGRES_ENV_KEY, "").strip()
    operator_url = source_values.get(SHARED_POSTGRES_OPERATOR_ENV_KEY, "").strip()
    if not runtime_url or not operator_url:
        raise ValueError(
            "shared root env source must define CAMPUS_SHARED_POSTGRES_URL and "
            "CAMPUS_SHARED_POSTGRES_OPERATOR_URL"
        )
    if is_local_postgres_database_url(runtime_url) or is_local_postgres_database_url(operator_url):
        raise ValueError("shared root env source still points at the local Postgres DSN")


def _normalize_sslmode(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in {"disable", "prefer", "require"}:
        raise ValueError("APP_API_DATABASE_SSLMODE must be one of disable|prefer|require")
    return normalized


def _print_text_report(result: dict[str, Any]) -> None:
    print("shared_postgres_restore=ok")
    print(f"repo_root={result['repo_root']}")
    print(f"root_env={result['target_paths']['root_env']}")
    print(f"app_api_env={result['target_paths']['app_api_env']}")
    print(f"app_api_dev_vars={result['target_paths']['app_api_dev_vars']}")
    print(f"app_api_database_sslmode={result['app_api_database_sslmode']}")


if __name__ == "__main__":
    raise SystemExit(main())
