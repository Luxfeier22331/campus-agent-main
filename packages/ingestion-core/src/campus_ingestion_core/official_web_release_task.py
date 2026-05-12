from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

OFFICIAL_WEB_RELEASE_TASK_TYPES = frozenset(
    {
        "official_web_selected_write_contact_directory",
        "official_web_selected_write_service_guide",
        "official_web_selected_write_academic_calendar",
        "official_web_stable_reference",
    }
)

OFFICIAL_WEB_RELEASE_TASK_EXECUTABLE_STATUSES = frozenset({"claimed", "running", "materialized"})

_LEGACY_WIRE_FIELD_REPLACEMENTS = {
    "attempt_count": "attemptCount",
    "created_at": "createdAt",
    "input_ref": "inputRef",
    "inventory_id": "inventoryId",
    "job_id": "jobId",
    "last_error_code": "lastErrorCode",
    "last_error_message": "lastErrorMessage",
    "lease_expires_at": "leaseExpiresAt",
    "lease_owner": "leaseOwner",
    "max_attempts": "maxAttempts",
    "output_ref": "outputRef",
    "publish_alias": "publishAlias",
    "run_id": "runId",
    "selected_write_target": "selectedWriteTarget",
    "task_id": "taskId",
    "task_type": "taskType",
    "updated_at": "updatedAt",
}


@dataclass(frozen=True, slots=True)
class OfficialWebReleaseTask:
    task_id: str
    task_type: str
    status: str
    inventory_id: str
    job_id: str
    run_id: str
    input_ref: Mapping[str, Any]
    created_at: datetime
    updated_at: datetime
    attempt_count: int = 0
    max_attempts: int = 3
    lease_owner: str = ""
    lease_expires_at: datetime | None = None
    output_ref: Mapping[str, Any] | None = None
    selected_write_target: str = ""
    publish_alias: bool = False
    last_error_code: str = ""
    last_error_message: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "task_id", _required_text(self.task_id, "task_id"))
        object.__setattr__(self, "task_type", _task_type(self.task_type))
        object.__setattr__(self, "status", _required_text(self.status, "status"))
        object.__setattr__(self, "inventory_id", _required_text(self.inventory_id, "inventory_id"))
        object.__setattr__(self, "job_id", _required_text(self.job_id, "job_id"))
        object.__setattr__(self, "run_id", _required_text(self.run_id, "run_id"))
        object.__setattr__(self, "input_ref", _mapping(self.input_ref, "input_ref"))
        object.__setattr__(self, "created_at", _datetime(self.created_at, "created_at"))
        object.__setattr__(self, "updated_at", _datetime(self.updated_at, "updated_at"))
        object.__setattr__(self, "attempt_count", _non_negative_int(self.attempt_count))
        object.__setattr__(self, "max_attempts", max(1, int(self.max_attempts)))
        object.__setattr__(self, "lease_owner", str(self.lease_owner or "").strip())
        object.__setattr__(
            self,
            "lease_expires_at",
            None
            if self.lease_expires_at is None
            else _datetime(self.lease_expires_at, "lease_expires_at"),
        )
        object.__setattr__(
            self,
            "output_ref",
            None if self.output_ref is None else _mapping(self.output_ref, "output_ref"),
        )
        object.__setattr__(
            self, "selected_write_target", str(self.selected_write_target or "").strip()
        )
        object.__setattr__(self, "last_error_code", str(self.last_error_code or "").strip())
        object.__setattr__(self, "last_error_message", str(self.last_error_message or "").strip())

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> OfficialWebReleaseTask:
        _reject_legacy_wire_fields(payload)
        input_ref = _mapping(payload.get("inputRef"), "inputRef")
        return cls(
            attempt_count=_int(payload.get("attemptCount"), 0),
            created_at=payload.get("createdAt"),
            input_ref=input_ref,
            inventory_id=_text(payload.get("inventoryId")),
            job_id=_text(payload.get("jobId")),
            last_error_code=_text(payload.get("lastErrorCode"), required=False),
            last_error_message=_text(
                payload.get("lastErrorMessage"),
                required=False,
            ),
            lease_expires_at=payload.get("leaseExpiresAt"),
            lease_owner=_text(
                payload.get("leaseOwner"),
                required=False,
            ),
            max_attempts=_int(payload.get("maxAttempts"), 3),
            output_ref=_optional_mapping(payload.get("outputRef")),
            publish_alias=bool(payload.get("publishAlias") is True),
            run_id=_text(payload.get("runId")),
            selected_write_target=_text(
                payload.get("selectedWriteTarget"),
                required=False,
            ),
            status=_text(payload.get("status")),
            task_id=_text(payload.get("taskId")),
            task_type=_text(payload.get("taskType")),
            updated_at=payload.get("updatedAt"),
        )

    @property
    def release_id(self) -> str:
        return self.task_id

    def claim(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        if self.status not in {"queued", "failed_retryable"} and not self.is_lease_expired(now=now):
            raise ValueError("official web release task is not claimable")
        timestamp = now or utc_now()
        return replace(
            self,
            attempt_count=self.attempt_count + 1,
            lease_expires_at=timestamp + timedelta(seconds=lease_seconds),
            lease_owner=_required_text(worker_id, "worker_id"),
            status="claimed",
            updated_at=timestamp,
        )

    def mark_running(
        self,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now()
        return replace(self, status="running", updated_at=timestamp)

    def heartbeat(
        self,
        *,
        worker_id: str,
        lease_seconds: int,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now()
        return replace(
            self,
            lease_expires_at=timestamp + timedelta(seconds=max(1, int(lease_seconds))),
            updated_at=timestamp,
        )

    def materialize(
        self,
        *,
        output_ref: Mapping[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now()
        return replace(
            self, output_ref=dict(output_ref), status="materialized", updated_at=timestamp
        )

    def publish(
        self,
        *,
        output_ref: Mapping[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now()
        return replace(
            self,
            lease_expires_at=None,
            lease_owner="",
            output_ref=dict(output_ref),
            status="published",
            updated_at=timestamp,
        )

    def mark_indexed(
        self,
        *,
        output_ref: Mapping[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now()
        return replace(
            self,
            lease_expires_at=None,
            lease_owner="",
            output_ref=dict(output_ref),
            status="indexed",
            updated_at=timestamp,
        )

    def fail_retryable(
        self,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now()
        exhausted = self.attempt_count >= self.max_attempts
        return replace(
            self,
            last_error_code=_required_text(error_code, "error_code"),
            last_error_message=_required_text(error_message, "error_message"),
            lease_expires_at=None,
            lease_owner="",
            status="failed_terminal" if exhausted else "failed_retryable",
            updated_at=timestamp,
        )

    def fail_terminal(
        self,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        self.require_lease_owner(worker_id=worker_id, now=now)
        timestamp = now or utc_now()
        return replace(
            self,
            last_error_code=_required_text(error_code, "error_code"),
            last_error_message=_required_text(error_message, "error_message"),
            lease_expires_at=None,
            lease_owner="",
            status="failed_terminal",
            updated_at=timestamp,
        )

    def require_lease_owner(self, *, worker_id: str, now: datetime | None = None) -> None:
        if self.status not in OFFICIAL_WEB_RELEASE_TASK_EXECUTABLE_STATUSES:
            raise ValueError("official web release task is not executable")
        if self.lease_owner and self.lease_owner != _required_text(worker_id, "worker_id"):
            raise ValueError("official web release task is not leased by this worker")
        if self.lease_expires_at is not None and self.lease_expires_at <= (now or utc_now()):
            raise ValueError("official web release task lease has expired")

    def is_lease_expired(self, *, now: datetime | None = None) -> bool:
        return self.status in OFFICIAL_WEB_RELEASE_TASK_EXECUTABLE_STATUSES and (
            self.lease_expires_at is None or self.lease_expires_at <= (now or utc_now())
        )

    def to_payload(self) -> dict[str, Any]:
        return {
            "attemptCount": self.attempt_count,
            "createdAt": self.created_at.isoformat(),
            "inputRef": dict(self.input_ref),
            "inventoryId": self.inventory_id,
            "jobId": self.job_id,
            "lastErrorCode": self.last_error_code or None,
            "lastErrorMessage": self.last_error_message or None,
            "leaseExpiresAt": self.lease_expires_at.isoformat() if self.lease_expires_at else None,
            "leaseOwner": self.lease_owner or None,
            "maxAttempts": self.max_attempts,
            "outputRef": dict(self.output_ref or {}),
            "publishAlias": self.publish_alias,
            "runId": self.run_id,
            "selectedWriteTarget": self.selected_write_target or None,
            "status": self.status,
            "taskId": self.task_id,
            "taskType": self.task_type,
            "updatedAt": self.updated_at.isoformat(),
        }


def build_official_web_release_task(
    *,
    input_ref: Mapping[str, Any],
    inventory_id: str,
    job_id: str,
    run_id: str,
    task_id: str,
    task_type: str,
    now: datetime | None = None,
    selected_write_target: str = "",
    publish_alias: bool = False,
) -> OfficialWebReleaseTask:
    timestamp = now or utc_now()
    return OfficialWebReleaseTask(
        created_at=timestamp,
        input_ref=dict(input_ref),
        inventory_id=inventory_id,
        job_id=job_id,
        publish_alias=publish_alias,
        run_id=run_id,
        selected_write_target=selected_write_target,
        status="queued",
        task_id=task_id,
        task_type=task_type,
        updated_at=timestamp,
    )


def utc_now() -> datetime:
    return datetime.now(tz=UTC)


def _reject_legacy_wire_fields(payload: Mapping[str, Any]) -> None:
    legacy_replacements = {
        legacy_field: canonical_field
        for legacy_field, canonical_field in _LEGACY_WIRE_FIELD_REPLACEMENTS.items()
        if legacy_field in payload
    }
    if legacy_replacements:
        replacements = ", ".join(
            f"{legacy_field}->{canonical_field}"
            for legacy_field, canonical_field in legacy_replacements.items()
        )
        raise ValueError(
            f"legacy release task fields are not accepted; use camelCase fields: {replacements}"
        )


def _datetime(value: Any, field_name: str) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value.strip():
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    raise ValueError(f"{field_name} must be a datetime")


def _int(value: Any, default_value: int) -> int:
    if value is None:
        return default_value
    return int(value)


def _mapping(value: Any, field_name: str) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    raise ValueError(f"{field_name} must be an object")


def _non_negative_int(value: Any) -> int:
    parsed = int(value)
    if parsed < 0:
        raise ValueError("integer must be non-negative")
    return parsed


def _optional_mapping(value: Any) -> Mapping[str, Any] | None:
    if value is None:
        return None
    return _mapping(value, "outputRef")


def _required_text(value: Any, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


def _task_type(value: Any) -> str:
    task_type = _required_text(value, "task_type")
    if task_type not in OFFICIAL_WEB_RELEASE_TASK_TYPES:
        raise ValueError(f"unsupported official web release task type: {task_type}")
    return task_type


def _text(value: Any, *, required: bool = True) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError("text value is required")
    return text
