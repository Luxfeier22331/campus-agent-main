from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import json
import os
import re
import tempfile
import uuid


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
        raise ValueError(
            "Invalid operator id: use letters, digits, dots, underscores, or hyphens"
        )
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


def _decorate_claim_record(
    workstream: str,
    record: dict[str, object] | None,
    *,
    now: datetime | None = None,
) -> dict[str, object]:
    now_value = now or utc_now()
    if record is None:
        return {
            "workstream": validate_workstream_name(workstream),
            "effective_status": "unclaimed",
            "claimable": True,
            "claim": None,
        }

    effective_status = get_effective_claim_status(record, now=now_value)
    payload = dict(record)
    payload["effective_status"] = effective_status
    payload["claimable"] = effective_status in {"expired", "unclaimed"}
    payload["claim"] = dict(record)
    return payload


def get_effective_claim_status(
    record: dict[str, object],
    *,
    now: datetime | None = None,
) -> str:
    now_value = now or utc_now()
    lease_expires_at = parse_utc(str(record["lease_expires_at"]))
    if lease_expires_at <= now_value:
        return "expired"
    return str(record["status"])


def _create_claim_record(
    *,
    workstream: str,
    operator_id: str,
    session_key: str,
    now: datetime,
    lease_seconds: int,
    heartbeat_interval_seconds: int,
    inherited_from: dict[str, object] | None = None,
) -> dict[str, object]:
    record: dict[str, object] = {
        "schema_version": 1,
        "workstream": validate_workstream_name(workstream),
        "claim_id": f"claim-{uuid.uuid4().hex}",
        "status": "active",
        "operator_id": validate_operator_id(operator_id),
        "session_key": session_key,
        "created_at": isoformat_utc(now),
        "updated_at": isoformat_utc(now),
        "last_heartbeat_at": isoformat_utc(now),
        "lease_seconds": lease_seconds,
        "heartbeat_interval_seconds": heartbeat_interval_seconds,
        "lease_expires_at": isoformat_utc(now + timedelta(seconds=lease_seconds)),
    }
    if inherited_from is not None:
        record["previous_claim_id"] = inherited_from.get("claim_id")
        record["previous_operator_id"] = inherited_from.get("operator_id")
    return record


def _record_history(
    repo_root: Path | str,
    *,
    event_type: str,
    workstream: str,
    operator_id: str | None,
    session_key: str | None,
    claim_id: str | None,
    now: datetime,
    details: dict[str, object] | None = None,
) -> None:
    row: dict[str, object] = {
        "timestamp": isoformat_utc(now),
        "event_type": event_type,
        "workstream": validate_workstream_name(workstream),
        "operator_id": operator_id,
        "session_key": session_key,
        "claim_id": claim_id,
    }
    if details:
        row["details"] = details
    _append_jsonl(history_file_path(repo_root), row)


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
    try:
        path.unlink()
    except FileNotFoundError:
        pass
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


def get_workstream_claim_status(
    repo_root: Path | str,
    workstream: str,
    *,
    now: datetime | None = None,
) -> dict[str, object]:
    get_workstream_dir(repo_root, workstream)
    record = _load_json(claim_file_path(repo_root, workstream))
    return _decorate_claim_record(workstream, record, now=now)


def acquire_workstream_claim(
    repo_root: Path | str,
    *,
    workstream: str,
    operator_id: str,
    session_key: str,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    heartbeat_interval_seconds: int = DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    now: datetime | None = None,
    reason: str | None = None,
    force: bool = False,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    slug = validate_workstream_name(workstream)
    actor = validate_operator_id(operator_id)
    get_workstream_dir(repo, slug)
    ensure_runtime_layout(repo)
    current_time = now or utc_now()

    with claim_lock(repo, slug):
        current = _load_json(claim_file_path(repo, slug))
        if current is not None:
            effective_status = get_effective_claim_status(current, now=current_time)
            same_holder = (
                current.get("operator_id") == actor and current.get("session_key") == session_key
            )
            if effective_status != "expired" and not force:
                if same_holder:
                    renewed = dict(current)
                    renewed["updated_at"] = isoformat_utc(current_time)
                    renewed["last_heartbeat_at"] = isoformat_utc(current_time)
                    renewed["lease_expires_at"] = isoformat_utc(
                        current_time + timedelta(seconds=int(current["lease_seconds"]))
                    )
                    _write_json_atomic(claim_file_path(repo, slug), renewed)
                    _record_history(
                        repo,
                        event_type="claim_reentered",
                        workstream=slug,
                        operator_id=actor,
                        session_key=session_key,
                        claim_id=str(renewed["claim_id"]),
                        now=current_time,
                    )
                    return _decorate_claim_record(slug, renewed, now=current_time)

                raise ClaimConflictError(
                    f"Workstream '{slug}' is already claimed by {current.get('operator_id')}"
                )

        record = _create_claim_record(
            workstream=slug,
            operator_id=actor,
            session_key=session_key,
            now=current_time,
            lease_seconds=lease_seconds,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
            inherited_from=current,
        )
        _write_json_atomic(claim_file_path(repo, slug), record)
        _record_history(
            repo,
            event_type="claim_acquired" if current is None else "claim_taken_over",
            workstream=slug,
            operator_id=actor,
            session_key=session_key,
            claim_id=str(record["claim_id"]),
            now=current_time,
            details={"reason": reason} if reason else None,
        )
        return _decorate_claim_record(slug, record, now=current_time)


def renew_workstream_claim(
    repo_root: Path | str,
    *,
    workstream: str,
    claim_id: str,
    operator_id: str,
    session_key: str,
    now: datetime | None = None,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    slug = validate_workstream_name(workstream)
    actor = validate_operator_id(operator_id)
    current_time = now or utc_now()

    with claim_lock(repo, slug):
        current = _load_json(claim_file_path(repo, slug))
        if current is None:
            return {"renewed": False, "reason": "unclaimed", "workstream": slug}
        if get_effective_claim_status(current, now=current_time) == "expired":
            return {"renewed": False, "reason": "expired", "workstream": slug}
        if current.get("status") not in RENEWABLE_CLAIM_STATUSES:
            return {"renewed": False, "reason": "not_renewable", "workstream": slug}
        if (
            current.get("claim_id") != claim_id
            or current.get("operator_id") != actor
            or current.get("session_key") != session_key
        ):
            return {"renewed": False, "reason": "claim_mismatch", "workstream": slug}

        renewed = dict(current)
        renewed["updated_at"] = isoformat_utc(current_time)
        renewed["last_heartbeat_at"] = isoformat_utc(current_time)
        renewed["lease_expires_at"] = isoformat_utc(
            current_time + timedelta(seconds=int(current["lease_seconds"]))
        )
        _write_json_atomic(claim_file_path(repo, slug), renewed)
        return {
            "renewed": True,
            **_decorate_claim_record(slug, renewed, now=current_time),
        }


def release_workstream_claim(
    repo_root: Path | str,
    *,
    workstream: str,
    reason: str,
    claim_id: str | None = None,
    operator_id: str | None = None,
    session_key: str | None = None,
    force: bool = False,
    strict: bool = True,
    now: datetime | None = None,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    slug = validate_workstream_name(workstream)
    current_time = now or utc_now()

    with claim_lock(repo, slug):
        current = _load_json(claim_file_path(repo, slug))
        if current is None:
            if strict:
                raise ClaimNotFoundError(f"Workstream '{slug}' is not currently claimed")
            return {"released": False, "reason": "unclaimed", "workstream": slug}

        matches_holder = True
        if claim_id is not None and current.get("claim_id") != claim_id:
            matches_holder = False
        if operator_id is not None and current.get("operator_id") != operator_id:
            matches_holder = False
        if session_key is not None and current.get("session_key") != session_key:
            matches_holder = False

        if not force and not matches_holder:
            if strict:
                raise ClaimConflictError(
                    f"Workstream '{slug}' is currently claimed by {current.get('operator_id')}"
                )
            return {"released": False, "reason": "claim_mismatch", "workstream": slug}

        claim_path = claim_file_path(repo, slug)
        claim_path.unlink(missing_ok=True)
        _record_history(
            repo,
            event_type="claim_released" if matches_holder else "claim_force_released",
            workstream=slug,
            operator_id=operator_id or str(current.get("operator_id")),
            session_key=session_key or str(current.get("session_key")),
            claim_id=claim_id or str(current.get("claim_id")),
            now=current_time,
            details={"reason": reason},
        )
        return {
            "released": True,
            "workstream": slug,
            "released_at": isoformat_utc(current_time),
            "previous_claim_id": current.get("claim_id"),
        }


def handoff_workstream_claim(
    repo_root: Path | str,
    *,
    workstream: str,
    claim_id: str,
    operator_id: str,
    session_key: str,
    to_operator_id: str,
    note: str | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    slug = validate_workstream_name(workstream)
    actor = validate_operator_id(operator_id)
    recipient = validate_operator_id(to_operator_id)
    current_time = now or utc_now()

    with claim_lock(repo, slug):
        current = _load_json(claim_file_path(repo, slug))
        if current is None:
            raise ClaimNotFoundError(f"Workstream '{slug}' is not currently claimed")
        if get_effective_claim_status(current, now=current_time) == "expired":
            raise ClaimConflictError(f"Workstream '{slug}' claim has already expired")
        if (
            current.get("claim_id") != claim_id
            or current.get("operator_id") != actor
            or current.get("session_key") != session_key
        ):
            raise ClaimConflictError(
                f"Workstream '{slug}' is currently claimed by {current.get('operator_id')}"
            )

        handoff = dict(current)
        handoff["status"] = "handoff_pending"
        handoff["updated_at"] = isoformat_utc(current_time)
        handoff["last_heartbeat_at"] = isoformat_utc(current_time)
        handoff["lease_expires_at"] = isoformat_utc(
            current_time + timedelta(seconds=int(current["lease_seconds"]))
        )
        handoff["handoff_to_operator_id"] = recipient
        handoff["handoff_note"] = note
        handoff["handoff_requested_at"] = isoformat_utc(current_time)
        handoff["handoff_requested_by"] = actor
        _write_json_atomic(claim_file_path(repo, slug), handoff)
        _record_history(
            repo,
            event_type="claim_handoff_requested",
            workstream=slug,
            operator_id=actor,
            session_key=session_key,
            claim_id=claim_id,
            now=current_time,
            details={"to_operator_id": recipient, "note": note},
        )
        return _decorate_claim_record(slug, handoff, now=current_time)


def accept_workstream_handoff(
    repo_root: Path | str,
    *,
    workstream: str,
    operator_id: str,
    session_key: str,
    lease_seconds: int | None = None,
    heartbeat_interval_seconds: int | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    slug = validate_workstream_name(workstream)
    actor = validate_operator_id(operator_id)
    current_time = now or utc_now()

    with claim_lock(repo, slug):
        current = _load_json(claim_file_path(repo, slug))
        if current is None:
            raise ClaimNotFoundError(f"Workstream '{slug}' is not currently claimed")
        if get_effective_claim_status(current, now=current_time) == "expired":
            raise ClaimConflictError(f"Workstream '{slug}' claim has already expired")
        if current.get("status") != "handoff_pending":
            raise ClaimConflictError(f"Workstream '{slug}' does not have a pending handoff")
        if current.get("handoff_to_operator_id") != actor:
            raise ClaimConflictError(
                f"Workstream '{slug}' handoff is reserved for {current.get('handoff_to_operator_id')}"
            )

        accepted = _create_claim_record(
            workstream=slug,
            operator_id=actor,
            session_key=session_key,
            now=current_time,
            lease_seconds=lease_seconds or int(current["lease_seconds"]),
            heartbeat_interval_seconds=heartbeat_interval_seconds
            or int(current["heartbeat_interval_seconds"]),
            inherited_from=current,
        )
        _write_json_atomic(claim_file_path(repo, slug), accepted)
        _record_history(
            repo,
            event_type="claim_handoff_accepted",
            workstream=slug,
            operator_id=actor,
            session_key=session_key,
            claim_id=str(accepted["claim_id"]),
            now=current_time,
            details={
                "previous_claim_id": current.get("claim_id"),
                "previous_operator_id": current.get("operator_id"),
            },
        )
        return _decorate_claim_record(slug, accepted, now=current_time)


def takeover_workstream_claim(
    repo_root: Path | str,
    *,
    workstream: str,
    operator_id: str,
    session_key: str,
    reason: str,
    force: bool = False,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    heartbeat_interval_seconds: int = DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    now: datetime | None = None,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    slug = validate_workstream_name(workstream)
    actor = validate_operator_id(operator_id)
    current_time = now or utc_now()
    get_workstream_dir(repo, slug)
    ensure_runtime_layout(repo)

    with claim_lock(repo, slug):
        current = _load_json(claim_file_path(repo, slug))
        if current is not None and get_effective_claim_status(current, now=current_time) != "expired":
            if not force:
                raise ClaimConflictError(
                    f"Workstream '{slug}' is still actively claimed by {current.get('operator_id')}"
                )

        record = _create_claim_record(
            workstream=slug,
            operator_id=actor,
            session_key=session_key,
            now=current_time,
            lease_seconds=lease_seconds,
            heartbeat_interval_seconds=heartbeat_interval_seconds,
            inherited_from=current,
        )
        _write_json_atomic(claim_file_path(repo, slug), record)
        _record_history(
            repo,
            event_type="claim_taken_over",
            workstream=slug,
            operator_id=actor,
            session_key=session_key,
            claim_id=str(record["claim_id"]),
            now=current_time,
            details={"reason": reason, "force": force},
        )
        return _decorate_claim_record(slug, record, now=current_time)


def list_workstream_claims(
    repo_root: Path | str,
    *,
    now: datetime | None = None,
) -> list[dict[str, object]]:
    repo = resolve_repo_root(repo_root)
    current_time = now or utc_now()
    claims: list[dict[str, object]] = []
    for slug in get_native_workstreams(repo):
        record = _load_json(claim_file_path(repo, slug))
        claims.append(_decorate_claim_record(slug, record, now=current_time))
    return claims


def collect_claim_doctor_status(
    repo_root: Path | str,
    *,
    environ: dict[str, str] | None = None,
    now: datetime | None = None,
) -> dict[str, object]:
    repo = resolve_repo_root(repo_root)
    session_key = resolve_existing_session_key(environ=environ)
    active_workstream = resolve_current_workstream(repo, environ=environ)
    pointer_file = (
        get_gsd_session_pointer_file(repo, session_key) if session_key else None
    )
    return {
        "repo_root": str(repo),
        "runtime_root": str(runtime_root(repo)),
        "operator": get_operator_profile(repo),
        "session_key": session_key,
        "active_workstream": active_workstream,
        "session_pointer_path": str(pointer_file) if pointer_file else None,
        "session_pointer_exists": pointer_file.exists() if pointer_file else False,
        "claims": list_workstream_claims(repo, now=now),
    }
