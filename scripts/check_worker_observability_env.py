from __future__ import annotations

import argparse
import json
from pathlib import Path

from scripts.env_sync import parse_env_file

OBSERVABILITY_TARGET_REQUIREMENTS = {
    "apps/app-api/.dev.vars": {
        "required_keys": (
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
            "APP_API_OTEL_INGEST_ENDPOINT",
            "APP_API_OTEL_INGEST_SHARED_SECRET",
        ),
    },
    "apps/operator-console-web/.dev.vars": {
        "required_keys": (
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
        ),
    },
    "apps/campus-web/.dev.vars": {
        "required_keys": (
            "SENTRY_DSN",
            "SENTRY_ENVIRONMENT",
            "SENTRY_RELEASE",
        ),
    },
}


def _normalize_value(values: dict[str, str], key: str) -> str:
    return values.get(key, "").strip()


def collect_worker_observability_status(
    repo_root: Path,
    source_env_path: Path | None = None,
) -> dict[str, object]:
    if source_env_path is not None:
        raise ValueError(
            "--source-env was retired; Worker observability checks now read app-local .dev.vars only."
        )
    targets: dict[str, object] = {}

    for relative_path, requirement in OBSERVABILITY_TARGET_REQUIREMENTS.items():
        target_path = repo_root / relative_path
        target_values = parse_env_file(target_path) if target_path.exists() else {}
        missing_keys = [
            key for key in requirement["required_keys"] if not _normalize_value(target_values, key)
        ]
        target_ready = target_path.exists() and not missing_keys
        targets[relative_path] = {
            "exists": target_path.exists(),
            "missing_keys": missing_keys,
            "ready": target_ready,
        }

    overall_ready = all(bool(target["ready"]) for target in targets.values())
    return {
        "overall_ready": overall_ready,
        "targets": targets,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check whether app-local Worker .dev.vars files contain the observability "
            "keys required for local Worker smoke."
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
        help="Retired. Worker observability checks read app-local .dev.vars only.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the status report as JSON.",
    )
    return parser.parse_args()


def _print_text_report(status: dict[str, object]) -> None:
    print(f"overall_ready={status['overall_ready']}")

    for relative_path, target in status["targets"].items():
        print(f"{relative_path}: ready={target['ready']} exists={target['exists']}")
        if target["missing_keys"]:
            print(f"{relative_path}: missing_keys=" + ",".join(target["missing_keys"]))


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
