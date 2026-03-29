from __future__ import annotations

import argparse
from pathlib import Path


OBSERVABILITY_TARGETS = {
    "apps/app-api/.dev.vars": {
        "SENTRY_DSN": "SENTRY_DSN_API",
        "AXIOM_ENDPOINT": "AXIOM_ENDPOINT",
        "AXIOM_DATASET": "AXIOM_DATASET",
        "AXIOM_TOKEN": "AXIOM_TOKEN",
    },
    "apps/public-chat-web/.dev.vars": {
        "SENTRY_DSN": "SENTRY_DSN_CHAT",
    },
    "apps/protected-panel-web/.dev.vars": {
        "SENTRY_DSN": "SENTRY_DSN_PANEL",
    },
}

REQUIRED_SOURCE_KEYS = (
    "SENTRY_DSN_API",
    "SENTRY_DSN_CHAT",
    "SENTRY_DSN_PANEL",
)


def resolve_source_env_path(repo_root: Path) -> Path:
    if repo_root.parent.name == ".worktrees":
        return repo_root.parent.parent / ".env"
    return repo_root / ".env"


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _replace_or_append_env_values(existing_text: str, assignments: dict[str, str]) -> str:
    pending = dict(assignments)
    output_lines: list[str] = []

    for raw_line in existing_text.splitlines():
        if "=" not in raw_line:
            output_lines.append(raw_line)
            continue

        key, _ = raw_line.split("=", 1)
        normalized_key = key.strip()
        if normalized_key in pending:
            output_lines.append(f"{normalized_key}={pending.pop(normalized_key)}")
        else:
            output_lines.append(raw_line)

    for key, value in pending.items():
        output_lines.append(f"{key}={value}")

    return "\n".join(output_lines) + "\n"


def _load_target_seed(target_path: Path) -> str:
    if target_path.exists():
        return target_path.read_text(encoding="utf-8")

    example_path = target_path.with_name(f"{target_path.name}.example")
    if example_path.exists():
        return example_path.read_text(encoding="utf-8")

    return ""


def sync_worker_observability_env(
    repo_root: Path,
    source_env_path: Path | None = None,
) -> list[Path]:
    source_path = source_env_path or resolve_source_env_path(repo_root)
    if not source_path.exists():
        raise FileNotFoundError(f"Source env file not found: {source_path}")

    source_values = parse_env_file(source_path)
    missing = [key for key in REQUIRED_SOURCE_KEYS if not source_values.get(key)]
    if missing:
        raise ValueError(
            "Missing required observability keys in source env: " + ", ".join(missing)
        )

    written_paths: list[Path] = []
    for relative_target, mapping in OBSERVABILITY_TARGETS.items():
        target_path = repo_root / relative_target
        target_path.parent.mkdir(parents=True, exist_ok=True)

        assignments = {
            target_key: source_values[source_key]
            for target_key, source_key in mapping.items()
            if source_values.get(source_key)
        }
        content = _replace_or_append_env_values(_load_target_seed(target_path), assignments)
        target_path.write_text(content, encoding="utf-8")
        written_paths.append(target_path)

    return written_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fan out root-worktree observability values into app-local Worker .dev.vars files "
            "without changing runtime env ownership."
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
    written_paths = sync_worker_observability_env(
        repo_root=args.repo_root.resolve(),
        source_env_path=args.source_env.resolve() if args.source_env else None,
    )
    for path in written_paths:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
