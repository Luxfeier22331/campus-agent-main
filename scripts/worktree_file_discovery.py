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


def changed_worktree_paths(
    *, root: Path | None = None, base_ref: str = "origin/main"
) -> tuple[Path, ...]:
    base = root or repo_root()
    merge_base = _git_stdout(("merge-base", base_ref, "HEAD"), root=base).strip()
    candidates: list[str] = []
    candidates.extend(
        _git_stdout(("diff", "--name-only", "-z", f"{merge_base}..HEAD"), root=base).split("\0")
    )
    candidates.extend(_git_stdout(("diff", "--name-only", "-z", "--cached"), root=base).split("\0"))
    candidates.extend(_git_stdout(("diff", "--name-only", "-z"), root=base).split("\0"))
    candidates.extend(
        _git_stdout(("ls-files", "-z", "--others", "--exclude-standard"), root=base).split("\0")
    )
    seen: set[str] = set()
    paths: list[Path] = []
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        path = base / candidate
        if path.exists():
            paths.append(path)
    return tuple(paths)


def _git_stdout(args: tuple[str, ...], *, root: Path) -> str:
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", *args],
        check=True,
        capture_output=True,
        text=True,
        cwd=root,
    )
    return result.stdout
