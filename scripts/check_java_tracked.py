from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

_JAVA_TRACKED_PATHS = ("apps/legacy-office-conversion-service/src/**/*.java",)
_JAVA_PREFIX = "apps/legacy-office-conversion-service/src/"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_java_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths(*_JAVA_TRACKED_PATHS, root=base)
        if _is_tracked_java_candidate(path.relative_to(base).as_posix())
    )


def _is_tracked_java_candidate(path: str) -> bool:
    return path.startswith(_JAVA_PREFIX) and path.endswith(".java")


def run_java_lint(*, root: Path | None = None) -> None:
    base = root or repo_root()
    subprocess.run(
        [
            "docker",
            "build",
            "--file",
            "apps/legacy-office-conversion-service/Dockerfile",
            "--target",
            "lint",
            ".",
        ],
        check=True,
        cwd=base,
    )


def main() -> int:
    files = tracked_java_files()
    if not files:
        print(
            "No current-worktree Java files matched the legacy office conversion service surface."
        )
        return 0
    try:
        run_java_lint()
    except FileNotFoundError:
        print("Java lint requires Docker to be installed and available on PATH.", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        return exc.returncode or 1
    print(
        f"Validated {len(files)} Java files from current worktree via Docker-based Spotless check."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
