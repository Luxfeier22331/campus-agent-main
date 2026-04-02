from __future__ import annotations

import os
from pathlib import Path


def load_repo_env(*, repo_root: Path | None = None) -> Path | None:
    root = Path(repo_root) if repo_root is not None else Path.cwd()
    candidate = root / ".env"
    if candidate.exists():
        _load_dotenv(candidate)
        return candidate
    return None


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
