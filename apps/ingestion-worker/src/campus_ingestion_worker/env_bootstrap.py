from __future__ import annotations

from pathlib import Path

from campus_shared.env_bootstrap import load_repo_env


def load_worker_env(*, repo_root: Path | None = None) -> Path | None:
    return load_repo_env(repo_root=repo_root)
