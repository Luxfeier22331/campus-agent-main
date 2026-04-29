from __future__ import annotations

import hashlib
import os
import tempfile
import uuid
from contextlib import suppress
from pathlib import Path

from .workstream_runtime_shared import (
    WORKSTREAM_SESSION_ENV_KEYS,
    OperatorNotConfiguredError,
    _load_json,
    _write_json_atomic,
    ensure_runtime_layout,
    isoformat_utc,
    operator_file_path,
    resolve_repo_root,
    sanitize_workstream_session_token,
    utc_now,
    validate_operator_id,
    validate_workstream_name,
)


def get_operator_profile(repo_root: Path | str) -> dict[str, object] | None:
    return _load_json(operator_file_path(repo_root))


def set_operator_profile(
    repo_root: Path | str,
    *,
    operator_id: str,
    display_name: str | None = None,
) -> dict[str, object]:
    ensure_runtime_layout(repo_root)
    now = utc_now()
    existing = get_operator_profile(repo_root) or {}
    payload = {
        "schema_version": 1,
        "operator_id": validate_operator_id(operator_id),
        "display_name": display_name.strip() if display_name else None,
        "created_at": existing.get("created_at") or isoformat_utc(now),
        "updated_at": isoformat_utc(now),
    }
    _write_json_atomic(operator_file_path(repo_root), payload)
    return payload


def clear_operator_profile(repo_root: Path | str) -> None:
    path = operator_file_path(repo_root)
    if path.exists():
        path.unlink()


def resolve_operator_id(
    repo_root: Path | str,
    *,
    explicit_operator_id: str | None = None,
    environ: dict[str, str] | None = None,
) -> str:
    env = environ or os.environ
    candidate = explicit_operator_id or env.get("GSD_OPERATOR_ID")
    if candidate:
        return validate_operator_id(candidate)

    operator = get_operator_profile(repo_root)
    if operator and operator.get("operator_id"):
        return validate_operator_id(str(operator["operator_id"]))

    raise OperatorNotConfiguredError(
        "Operator id is not configured. Run `uv run --all-packages python -m scripts.workstream_claim operator set <operator_id>` first."
    )


def resolve_existing_session_key(environ: dict[str, str] | None = None) -> str | None:
    env = environ or os.environ
    for env_key in WORKSTREAM_SESSION_ENV_KEYS:
        token = sanitize_workstream_session_token(env.get(env_key))
        if token:
            return f"{env_key.lower().replace('_', '-')}-{token}"

    for env_key in ("TTY", "SSH_TTY"):
        token = sanitize_workstream_session_token(env.get(env_key))
        if token:
            return f"tty-{token.replace('dev_', '', 1)}"
    return None


def generate_session_key() -> str:
    return f"claim-{uuid.uuid4().hex[:16]}"


def resolve_session_key(
    *,
    explicit_session_key: str | None = None,
    environ: dict[str, str] | None = None,
    allow_generate: bool = True,
) -> str:
    token = sanitize_workstream_session_token(explicit_session_key)
    if token:
        return token
    token = resolve_existing_session_key(environ=environ)
    if token:
        return token
    if allow_generate:
        return generate_session_key()
    raise ValueError("No session key available")


def get_gsd_session_pointer_file(repo_root: Path | str, session_key: str) -> Path:
    repo = resolve_repo_root(repo_root)
    planning_abs = (repo / ".planning").resolve()
    project_id = hashlib.sha1(str(planning_abs).encode("utf-8")).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / "gsd-workstream-sessions" / project_id / session_key


def write_gsd_active_workstream_pointer(
    repo_root: Path | str,
    *,
    workstream: str,
    session_key: str,
) -> Path:
    path = get_gsd_session_pointer_file(repo_root, session_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(validate_workstream_name(workstream) + "\n", encoding="utf-8")
    return path


def clear_gsd_active_workstream_pointer(repo_root: Path | str, *, session_key: str) -> None:
    path = get_gsd_session_pointer_file(repo_root, session_key)
    with suppress(FileNotFoundError):
        path.unlink()
    try:
        if path.parent.exists() and not any(path.parent.iterdir()):
            path.parent.rmdir()
    except OSError:
        pass


def resolve_current_workstream(
    repo_root: Path | str,
    *,
    environ: dict[str, str] | None = None,
) -> str | None:
    repo = resolve_repo_root(repo_root)
    env = environ or os.environ

    direct = env.get("GSD_WORKSTREAM")
    if direct:
        return validate_workstream_name(direct)

    session_key = resolve_existing_session_key(environ=env)
    if session_key:
        pointer_file = get_gsd_session_pointer_file(repo, session_key)
        if pointer_file.exists():
            pointer_value = pointer_file.read_text(encoding="utf-8").strip()
            if pointer_value:
                return validate_workstream_name(pointer_value)

    shared_pointer = repo / ".planning" / "active-workstream"
    if shared_pointer.exists():
        pointer_value = shared_pointer.read_text(encoding="utf-8").strip()
        if pointer_value:
            return validate_workstream_name(pointer_value)
    return None
