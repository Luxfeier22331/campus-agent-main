from __future__ import annotations

import argparse
import json
from pathlib import Path

from scripts.env_sync import parse_env_file, resolve_source_env_path

SOURCE_REQUIRED_KEYS = (
    "SENTRY_DSN",
    "AXIOM_ENDPOINT",
    "AXIOM_DATASET",
    "AXIOM_TOKEN",
)

OBSERVABILITY_TARGET_REQUIREMENTS = {
    "apps/app-api/.dev.vars": {
        "required_keys": (
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
            "AXIOM_ENDPOINT",
            "AXIOM_DATASET",
            "AXIOM_TOKEN",
        ),
        "source_mapping": {
            "SENTRY_DSN": "SENTRY_DSN",
            "AXIOM_ENDPOINT": "AXIOM_ENDPOINT",
            "AXIOM_DATASET": "AXIOM_DATASET",
            "AXIOM_TOKEN": "AXIOM_TOKEN",
        },
    },
    "apps/public-chat-web/.dev.vars": {
        "required_keys": (
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
        ),
        "source_mapping": {
            "SENTRY_DSN": "SENTRY_DSN",
        },
    },
    "apps/operator-console-web/.dev.vars": {
        "required_keys": (
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
        ),
        "source_mapping": {
            "SENTRY_DSN": "SENTRY_DSN",
        },
    },
    "apps/campus-web/.dev.vars": {
        "required_keys": (
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
        ),
        "source_mapping": {
            "SENTRY_DSN": "SENTRY_DSN",
        },
    },
}


def _normalize_value(values: dict[str, str], key: str) -> str:
    return values.get(key, "").strip()


def collect_worker_observability_status(
    repo_root: Path,
    source_env_path: Path | None = None,
) -> dict[str, object]:
    source_path = source_env_path or resolve_source_env_path(repo_root)
    if not source_path.exists():
        raise FileNotFoundError(f"Source env file not found: {source_path}")

    source_values = parse_env_file(source_path)
    source_missing = [
        key for key in SOURCE_REQUIRED_KEYS if not _normalize_value(source_values, key)
    ]
    targets: dict[str, object] = {}

    for relative_path, requirement in OBSERVABILITY_TARGET_REQUIREMENTS.items():
        target_path = repo_root / relative_path
        target_values = parse_env_file(target_path) if target_path.exists() else {}
        missing_keys = [
            key for key in requirement["required_keys"] if not _normalize_value(target_values, key)
        ]
        mismatched_keys = [
            target_key
            for target_key, source_key in requirement["source_mapping"].items()
            if _normalize_value(target_values, target_key)
            and _normalize_value(source_values, source_key)
            and _normalize_value(target_values, target_key)
            != _normalize_value(source_values, source_key)
        ]
        target_ready = target_path.exists() and not missing_keys and not mismatched_keys
        targets[relative_path] = {
            "exists": target_path.exists(),
            "missing_keys": missing_keys,
            "mismatched_keys": mismatched_keys,
            "ready": target_ready,
        }

    overall_ready = not source_missing and all(bool(target["ready"]) for target in targets.values())
    return {
        "overall_ready": overall_ready,
        "recommended_sync_command": (
            "uv run --all-packages python -m scripts.sync_worker_observability_env"
        ),
        "source_env_path": str(source_path),
        "source_ready": not source_missing,
        "source_missing_keys": source_missing,
        "targets": targets,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check whether root-worktree observability values are present and correctly "
            "fanned out into app-local Worker .dev.vars files."
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
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the status report as JSON.",
    )
    return parser.parse_args()


def _print_text_report(status: dict[str, object]) -> None:
    print(f"overall_ready={status['overall_ready']}")
    print(f"source_env_path={status['source_env_path']}")
    print(f"source_ready={status['source_ready']}")
    source_missing = status["source_missing_keys"]
    if source_missing:
        print("source_missing_keys=" + ",".join(source_missing))

    for relative_path, target in status["targets"].items():
        print(f"{relative_path}: ready={target['ready']} exists={target['exists']}")
        if target["missing_keys"]:
            print(f"{relative_path}: missing_keys=" + ",".join(target["missing_keys"]))
        if target["mismatched_keys"]:
            print(f"{relative_path}: mismatched_keys=" + ",".join(target["mismatched_keys"]))

    if not status["overall_ready"]:
        print("recommended_sync_command=" + str(status["recommended_sync_command"]))


def main() -> int:
    args = parse_args()
    status = collect_worker_observability_status(
        repo_root=args.repo_root.resolve(),
        source_env_path=args.source_env.resolve() if args.source_env else None,
    )
    if args.json:
        print(json.dumps(status, ensure_ascii=True, indent=2, sort_keys=True))
    else:
        _print_text_report(status)
    return 0 if status["overall_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
