from __future__ import annotations

import json
import os
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

WORKSTREAM_SESSION_ENV_KEYS = [
    "GSD_SESSION_KEY",
    "CODEX_THREAD_ID",
    "CLAUDE_SESSION_ID",
    "CLAUDE_CODE_SSE_PORT",
    "OPENCODE_SESSION_ID",
    "GEMINI_SESSION_ID",
    "CURSOR_SESSION_ID",
    "WINDSURF_SESSION_ID",
    "TERM_SESSION_ID",
    "WT_SESSION",
    "TMUX_PANE",
    "ZELLIJ_SESSION_NAME",
]
RENEWABLE_CLAIM_STATUSES = {"active", "handoff_pending"}
DEFAULT_LEASE_SECONDS = 20 * 60
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 60
WORKSTREAM_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
OPERATOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class WorkstreamClaimError(RuntimeError):
    pass


class ClaimConflictError(WorkstreamClaimError):
    pass


class ClaimNotFoundError(WorkstreamClaimError):
    pass


class OperatorNotConfiguredError(WorkstreamClaimError):
    pass


class WorkstreamNotFoundError(WorkstreamClaimError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_utc(value: datetime) -> str:
    normalized = value.astimezone(timezone.utc).replace(microsecond=0)
    return normalized.isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def sanitize_workstream_session_token(value: object | None) -> str | None:
    if value is None:
        return None
    token = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(value).strip()).strip("_")
    if not token:
        return None
    return token[:160]


def validate_workstream_name(workstream: str) -> str:
    candidate = workstream.strip()
    if not WORKSTREAM_NAME_PATTERN.fullmatch(candidate):
        raise ValueError(
            "Invalid workstream name: must contain only letters, digits, underscores, and hyphens"
        )
    return candidate


def validate_operator_id(operator_id: str) -> str:
    candidate = operator_id.strip()
    if not OPERATOR_ID_PATTERN.fullmatch(candidate):
        raise ValueError("Invalid operator id: use letters, digits, dots, underscores, or hyphens")
    return candidate


def resolve_repo_root(repo_root: Path | str | None = None) -> Path:
    if repo_root is not None:
        candidate = Path(repo_root).resolve()
        if not (candidate / ".planning").exists():
            raise FileNotFoundError(f"{candidate} does not contain .planning/")
        return candidate

    current = Path.cwd().resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".planning").exists():
            return candidate
    raise FileNotFoundError("Could not locate repo root containing .planning/")


def planning_root(repo_root: Path | str) -> Path:
    return resolve_repo_root(repo_root) / ".planning"


def runtime_root(repo_root: Path | str) -> Path:
    return planning_root(repo_root) / "runtime"


def claims_root(repo_root: Path | str) -> Path:
    return runtime_root(repo_root) / "workstream-claims"


def claim_file_path(repo_root: Path | str, workstream: str) -> Path:
    return claims_root(repo_root) / f"{validate_workstream_name(workstream)}.json"


def claim_lock_path(repo_root: Path | str, workstream: str) -> Path:
    return claims_root(repo_root) / f"{validate_workstream_name(workstream)}.lock"


def history_file_path(repo_root: Path | str) -> Path:
    return runtime_root(repo_root) / "workstream-claim-history.jsonl"


def operator_file_path(repo_root: Path | str) -> Path:
    return runtime_root(repo_root) / "operator.json"


def ensure_runtime_layout(repo_root: Path | str) -> None:
    claims_root(repo_root).mkdir(parents=True, exist_ok=True)


def get_native_workstreams(repo_root: Path | str) -> list[str]:
    root = planning_root(repo_root) / "workstreams"
    if not root.exists():
        return []
    return sorted(path.name for path in root.iterdir() if path.is_dir())


def get_workstream_dir(repo_root: Path | str, workstream: str) -> Path:
    slug = validate_workstream_name(workstream)
    path = planning_root(repo_root) / "workstreams" / slug
    if not path.exists():
        raise WorkstreamNotFoundError(
            f"Native workstream '{slug}' does not exist under .planning/workstreams/"
        )
    return path


def _load_json(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + f".tmp-{uuid.uuid4().hex}")
    tmp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp_path, path)


def _append_jsonl(path: Path, row: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


@contextmanager
def claim_lock(repo_root: Path | str, workstream: str):
    lock_path = claim_lock_path(repo_root, workstream)
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    handle = lock_path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            if handle.tell() == 0 and handle.read(1) == b"":
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
