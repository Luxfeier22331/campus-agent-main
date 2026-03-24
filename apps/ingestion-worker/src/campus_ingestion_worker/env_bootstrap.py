from __future__ import annotations

import os
from pathlib import Path


def load_worker_env(*, repo_root: Path | None = None) -> Path | None:
    root = Path(repo_root) if repo_root is not None else Path.cwd()
    for candidate in _dotenv_candidates(root):
        if not candidate.exists():
            continue
        _load_dotenv(candidate)
        return candidate
    return None


def _dotenv_candidates(repo_root: Path) -> tuple[Path, ...]:
    current = repo_root / ".env"
    main = _resolve_main_worktree_root(repo_root) / ".env"
    if current == main:
        return (current,)
    return (current, main)


def _resolve_main_worktree_root(repo_root: Path) -> Path:
    resolved = repo_root.resolve()
    parts = resolved.parts
    if ".worktrees" not in parts:
        return resolved
    marker = parts.index(".worktrees")
    return Path(*parts[:marker])


def _load_dotenv(path: Path) -> None:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        normalized_key = key.strip()
        if not normalized_key or normalized_key in os.environ:
            continue
        os.environ[normalized_key] = value.strip()

