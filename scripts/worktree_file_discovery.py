from __future__ import annotations

import subprocess
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def worktree_paths(*pathspecs: str, root: Path | None = None) -> tuple[Path, ...]:
    base = root or repo_root()
    result = subprocess.run(
        [
            "git",
            "-c",
            "core.quotePath=false",
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            *pathspecs,
        ],
        check=True,
        capture_output=True,
        cwd=base,
    )
    seen: set[str] = set()
    paths: list[Path] = []
    for item in result.stdout.split(b"\0"):
        if not item:
            continue
        relative_path = item.decode("utf-8")
        if relative_path in seen:
            continue
        seen.add(relative_path)
        path = base / relative_path
        if path.exists():
            paths.append(path)
    return tuple(paths)
