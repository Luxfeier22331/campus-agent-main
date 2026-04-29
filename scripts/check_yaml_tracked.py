from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_yaml_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(
        path
        for path in worktree_paths("*.yml", "*.yaml", root=base)
        if not path.relative_to(base).as_posix().startswith(".planning/")
    )


def main() -> int:
    files = tracked_yaml_files()
    if not files:
        print("No current-worktree YAML files matched the live-surface pathspecs.")
        return 0
    command = [
        "yamllint",
        "-c",
        ".yamllint.yml",
        *(str(path.relative_to(repo_root())) for path in files),
    ]
    completed = subprocess.run(command, cwd=repo_root())
    if completed.returncode == 0:
        print(f"Validated {len(files)} YAML files from current worktree outside .planning/.")
        return 0
    print("YAML lint failed.", file=sys.stderr)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
