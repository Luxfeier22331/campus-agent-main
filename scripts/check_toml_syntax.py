from __future__ import annotations

import sys
import tomllib
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_toml_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return worktree_paths("*.toml", root=base)


def validate_toml_file(path: Path) -> None:
    tomllib.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    failures: list[str] = []
    for path in tracked_toml_files():
        try:
            validate_toml_file(path)
        except (OSError, tomllib.TOMLDecodeError) as exc:
            failures.append(f"{path.relative_to(repo_root())}: {exc}")
    if failures:
        print("TOML syntax check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print(f"Validated {len(tracked_toml_files())} TOML files from current worktree.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
