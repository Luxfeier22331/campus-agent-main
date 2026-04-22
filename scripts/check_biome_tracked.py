from __future__ import annotations

import subprocess
from pathlib import Path

from scripts.worktree_file_discovery import worktree_paths

_BIOME_TRACKED_PATHS = (
    ".markdownlint-cli2.jsonc",
    "biome.jsonc",
    "package.json",
    "turbo.json",
    "apps",
    "packages",
    "configs",
    "scripts",
    "tests",
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def tracked_biome_files(*, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    return tuple(path for path in worktree_paths(*_BIOME_TRACKED_PATHS, root=base) if path.exists())


def main() -> int:
    files = tracked_biome_files()
    if not files:
        print("No current-worktree files matched the Biome live-surface pathspecs.")
        return 0
    command = [
        "pnpm",
        "exec",
        "biome",
        "check",
        "--files-ignore-unknown=true",
        *(str(path.relative_to(repo_root())) for path in files),
    ]
    completed = subprocess.run(command, cwd=repo_root())
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
