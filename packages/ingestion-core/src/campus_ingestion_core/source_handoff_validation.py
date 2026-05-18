from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

SOURCE_HANDOFF_SCHEMA_VERSION = "source_handoff.v1"
INGESTION_EXECUTION_SCHEMA_VERSION = "ingestion_execution.v1"
INGESTION_STEP_SCHEMA_VERSION = "ingestion_step.v1"
INGESTION_CHILD_TASK_SCHEMA_VERSION = "ingestion_child_task.v1"
INGESTION_EVENT_SCHEMA_VERSION = "ingestion_event.v1"

SOURCE_CHANNELS = frozenset(("official_web", "authenticated_notice_portal"))
SOURCE_RUN_OWNERS = frozenset(("app_api_official_web", "authenticated_notice_collector_ledger"))
SOURCE_OBJECT_ROLES = frozenset(
    (
        "handoff_bundle",
        "handoff_manifest",
        "official_web_page_manifest",
        "official_web_content_blocks",
        "notice_attachment_source_bytes",
        "file_release_released_source_bytes",
        "provider_capture",
        "quality_audit",
    )
)
SOURCE_HANDOFF_KINDS = frozenset(
    (
        "official_web_source_truth_replay",
        "authenticated_notice_import",
        "authenticated_file_release_import",
        "source_repair",
    )
)
SOURCE_HANDOFF_STATUSES = frozenset(
    ("created", "verifying", "verified", "rejected", "superseded", "cancelled")
)
OBJECT_VERIFICATION_STATUSES = frozenset(
    (
        "pending",
        "checking",
        "matched",
        "missing",
        "checksum_mismatch",
        "size_mismatch",
        "skipped_optional",
        "failed_retryable",
    )
)
INGESTION_EXECUTION_STATUSES = frozenset(
    (
        "queued",
        "claimed",
        "running",
        "completed",
        "failed_retryable",
        "failed_terminal",
        "dead_letter",
        "cancelled",
    )
)
INGESTION_RESULT_KINDS = frozenset(
    ("none", "noop", "staged", "promoted", "materialized", "failed", "cancelled")
)
INGESTION_REQUESTED_RESULT_KINDS = frozenset(
    ("stage_only", "promote", "materialize_only", "validate_only")
)
INGESTION_STEP_STATUSES = frozenset(
    (
        "pending",
        "running",
        "passed",
        "skipped",
        "failed_retryable",
        "failed_terminal",
        "cancelled",
    )
)
INGESTION_CHILD_TASK_STATUSES = frozenset(
    (
        "pending",
        "running",
        "completed",
        "skipped",
        "failed_retryable",
        "failed_terminal",
        "manual_review",
        "cancelled",
    )
)
FORBIDDEN_PAYLOAD_FIELDS = frozenset(
    (
        "body_text",
        "raw_html",
        "html",
        "content_blocks",
        "attachment_bytes",
        "ocr_payload",
        "ocr_raw_text",
        "image_bytes",
        "cookie",
        "jwt",
        "token",
        "sso_tgc",
        "authorization",
        "secret",
        "raw_prompt",
        "raw_query",
        "local_path",
        "bundle_path",
        "manifest_path",
        "source_file_path",
    )
)


def build_stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha256("|".join(str(part) for part in parts).encode("utf-8")).hexdigest()
    return f"{prefix}:{digest[:32]}"


def validate_operator_safe_payload(payload: Mapping[str, Any] | Sequence[Any]) -> None:
    _validate_operator_safe_payload(payload, path=())


def utc_now_dt() -> datetime:
    return datetime.now(UTC)


def _validate_operator_safe_payload(value: object, *, path: tuple[str, ...]) -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            key_text = str(key)
            if key_text in FORBIDDEN_PAYLOAD_FIELDS:
                dotted = ".".join((*path, key_text))
                raise ValueError(f"forbidden payload field: {dotted}")
            if isinstance(item, str):
                _reject_local_path(item, ".".join((*path, key_text)))
            _validate_operator_safe_payload(item, path=(*path, key_text))
    elif isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        for index, item in enumerate(value):
            _validate_operator_safe_payload(item, path=(*path, str(index)))


def _required_text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} is required")
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def _allowlisted_text(value: object, label: str, allowed: frozenset[str]) -> str:
    normalized = _required_text(value, label)
    if normalized not in allowed:
        raise ValueError(f"unsupported {label}: {normalized}")
    return normalized


def _required_sha256(value: object, label: str) -> str:
    normalized = _required_text(value, label)
    if len(normalized) != 64 or any(char not in "0123456789abcdef" for char in normalized):
        raise ValueError(f"{label} must be a lowercase sha256 hex digest")
    return normalized


def _required_non_negative_int(value: object, label: str) -> int:
    parsed = _optional_non_negative_int(value, label)
    if parsed is None:
        raise ValueError(f"{label} must be a non-negative integer")
    return parsed


def _optional_non_negative_int(value: object, label: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a non-negative integer")
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return parsed


def _positive_int(value: object, label: str) -> int:
    parsed = _required_non_negative_int(value, label)
    if parsed <= 0:
        raise ValueError(f"{label} must be greater than zero")
    return parsed


def _seconds_delta(seconds: int) -> timedelta:
    return timedelta(seconds=_positive_int(seconds, "lease_seconds"))


def _coerce_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    raise ValueError("datetime value must be a datetime or ISO string")


def _coerce_required_datetime(value: datetime | str | None, label: str) -> datetime:
    parsed = _coerce_datetime(value)
    if parsed is None:
        raise ValueError(f"{label} is required")
    return parsed


def _format_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _reject_local_path(value: str, label: str) -> None:
    normalized = str(value or "").strip()
    local_prefixes = ("/", "./", "../", ".tmp/", "tmp/", "var/", "./var/", "file://")
    if normalized.startswith(local_prefixes) or "\\\\" in normalized:
        raise ValueError(f"{label} must not be a local path")


__all__ = [
    "FORBIDDEN_PAYLOAD_FIELDS",
    "INGESTION_CHILD_TASK_SCHEMA_VERSION",
    "INGESTION_CHILD_TASK_STATUSES",
    "INGESTION_EVENT_SCHEMA_VERSION",
    "INGESTION_EXECUTION_SCHEMA_VERSION",
    "INGESTION_EXECUTION_STATUSES",
    "INGESTION_REQUESTED_RESULT_KINDS",
    "INGESTION_RESULT_KINDS",
    "INGESTION_STEP_SCHEMA_VERSION",
    "INGESTION_STEP_STATUSES",
    "OBJECT_VERIFICATION_STATUSES",
    "SOURCE_CHANNELS",
    "SOURCE_HANDOFF_KINDS",
    "SOURCE_HANDOFF_SCHEMA_VERSION",
    "SOURCE_HANDOFF_STATUSES",
    "SOURCE_OBJECT_ROLES",
    "SOURCE_RUN_OWNERS",
    "build_stable_id",
    "utc_now_dt",
    "validate_operator_safe_payload",
]
