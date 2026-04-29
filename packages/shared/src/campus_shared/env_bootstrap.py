from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class RepoEnvBootstrapState:
    repo_root: Path
    candidate_path: Path
    loaded_path: Path | None
    file_found: bool
    loaded_keys: tuple[str, ...] = ()
    skipped_existing_keys: tuple[str, ...] = ()


_LAST_REPO_ENV_BOOTSTRAP_STATE: RepoEnvBootstrapState | None = None


def load_repo_env(*, repo_root: Path | None = None) -> Path | None:
    global _LAST_REPO_ENV_BOOTSTRAP_STATE

    root = Path(repo_root) if repo_root is not None else Path.cwd()
    candidate = root / ".env"
    if candidate.exists():
        loaded_keys, skipped_existing_keys = _load_dotenv(candidate)
        _LAST_REPO_ENV_BOOTSTRAP_STATE = RepoEnvBootstrapState(
            repo_root=root,
            candidate_path=candidate,
            loaded_path=candidate,
            file_found=True,
            loaded_keys=loaded_keys,
            skipped_existing_keys=skipped_existing_keys,
        )
        return candidate
    _LAST_REPO_ENV_BOOTSTRAP_STATE = RepoEnvBootstrapState(
        repo_root=root,
        candidate_path=candidate,
        loaded_path=None,
        file_found=False,
    )
    return None


def get_repo_env_bootstrap_state() -> RepoEnvBootstrapState | None:
    return _LAST_REPO_ENV_BOOTSTRAP_STATE


def reset_repo_env_bootstrap_state() -> None:
    global _LAST_REPO_ENV_BOOTSTRAP_STATE
    _LAST_REPO_ENV_BOOTSTRAP_STATE = None


def _load_dotenv(path: Path) -> tuple[tuple[str, ...], tuple[str, ...]]:
    loaded_keys: list[str] = []
    skipped_existing_keys: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        normalized_key = key.strip()
        if not normalized_key:
            continue
        if normalized_key in os.environ:
            skipped_existing_keys.append(normalized_key)
            continue
        os.environ[normalized_key] = value.strip()
        loaded_keys.append(normalized_key)
    return tuple(loaded_keys), tuple(skipped_existing_keys)
