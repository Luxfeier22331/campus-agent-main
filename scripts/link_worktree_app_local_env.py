from __future__ import annotations

import argparse
import os
from pathlib import Path

APP_LOCAL_ENV_PATHS = (
    ".env",
    "apps/app-api/.dev.vars",
    "apps/app-api/.env",
    "apps/campus-web/.env",
    "apps/campus-web/.dev.vars",
    "apps/operator-console-web/.dev.vars",
    "apps/official-web-collector/.env",
    "apps/authenticated-notice-collector/.env",
    "apps/wechat-official-account-collector/.env",
    "env/commands/campus-docs-reader-build.env",
)


def resolve_source_repo_root(repo_root: Path) -> Path:
    resolved = repo_root.resolve()
    if resolved.parent.name == ".worktrees":
        return resolved.parent.parent
    return resolved


def _link_path(source_path: Path, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    relative_source = Path(os.path.relpath(source_path, start=target_path.parent))
    target_path.symlink_to(relative_source)


def link_worktree_app_local_env(
    repo_root: Path,
    paths: tuple[str, ...] = APP_LOCAL_ENV_PATHS,
) -> list[Path]:
    resolved_repo_root = repo_root.resolve()
    source_repo_root = resolve_source_repo_root(resolved_repo_root)

    if source_repo_root == resolved_repo_root:
        return []

    linked_paths: list[Path] = []
    for relative_path in paths:
        source_path = source_repo_root / relative_path
        if not source_path.exists():
            continue

        target_path = resolved_repo_root / relative_path
        if target_path.exists() or target_path.is_symlink():
            if target_path.is_symlink() and target_path.resolve() == source_path.resolve():
                linked_paths.append(target_path)
                continue
            raise FileExistsError(
                f"Refusing to replace existing app-local env target: {target_path}"
            )

        _link_path(source_path, target_path)
        linked_paths.append(target_path)

    return linked_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Link local env files from the root worktree into the current feature "
            "worktree without changing env ownership."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root for the current worktree. Defaults to this script's repo root.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    linked_paths = link_worktree_app_local_env(repo_root=args.repo_root.resolve())
    for path in linked_paths:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
