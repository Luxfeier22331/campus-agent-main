from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_sql_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths("*.sql", root=base)
        if not path.relative_to(base).as_posix().startswith(".planning/")
    )


def validate_sql_file(path: Path, *, root: Path | None = None) -> None:
    base = root or repo_root()
    subprocess.run(
        [
            "sqlfluff",
            "lint",
            "--config",
            ".sqlfluff",
            str(path.relative_to(base)),
        ],
        check=True,
        capture_output=True,
        text=True,
        cwd=base,
    )


def main() -> int:
    failures: list[str] = []
    files = tracked_sql_files()
    for path in files:
        try:
            validate_sql_file(path)
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or exc.stdout or "").strip()
            failures.append(f"{path.relative_to(repo_root())}: {stderr}")
        except OSError as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")

    if failures:
        print("SQL lint failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(files)} SQL files from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
