from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_pnpm_lock_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths("pnpm-lock.yaml", "**/pnpm-lock.yaml", root=base)
        for line in [path.relative_to(base).as_posix()]
        if not line.startswith(".planning/")
        and "/vendor/" not in line
        and "/node_modules/" not in line
        and path.exists()
    )


def unexpected_pnpm_lock_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(path for path in tracked_pnpm_lock_files(root=base) if path.parent != base)


def build_root_pnpm_lock_check_command() -> list[str]:
    return [
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--lockfile-only",
    ]


def validate_pnpm_lockfile(path: Path, *, root: Path | None = None) -> None:
    base = root or repo_root()
    subprocess.run(
        build_root_pnpm_lock_check_command(),
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )


def main(*, root: Path | None = None) -> int:
    base = root or repo_root()
    failures: list[str] = []
    unexpected_lockfiles = unexpected_pnpm_lock_files(root=base)
    for path in unexpected_lockfiles:
        failures.append(
            f"{path.relative_to(base)}: app-local pnpm lockfiles are not supported; "
            "use the root pnpm-lock.yaml"
        )
    if failures:
        print("pnpm lock integrity check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    files = tracked_pnpm_lock_files(root=base)
    for path in files:
        if path.parent != base:
            continue
        try:
            validate_pnpm_lockfile(path, root=base)
        except (FileNotFoundError, OSError) as exc:
            failures.append(f"{path.relative_to(base)}: {exc}")
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            failures.append(f"{path.relative_to(base)}: {stderr}")
    if failures:
        print("pnpm lock integrity check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("Validated root pnpm lockfile from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
