from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from pathlib import Path

from .workstream_runtime_shared import (
    DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    DEFAULT_LEASE_SECONDS,
    RENEWABLE_CLAIM_STATUSES,
    ClaimConflictError,
    ClaimNotFoundError,
    _append_jsonl,
    _load_json,
    _write_json_atomic,
    claim_file_path,
    claim_lock,
    ensure_runtime_layout,
    get_native_workstreams,
    get_workstream_dir,
    history_file_path,
    isoformat_utc,
    parse_utc,
    resolve_repo_root,
    utc_now,
    validate_operator_id,
    validate_workstream_name,
)


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
        if (
            current is not None
            and get_effective_claim_status(current, now=current_time) != "expired"
        ):
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
