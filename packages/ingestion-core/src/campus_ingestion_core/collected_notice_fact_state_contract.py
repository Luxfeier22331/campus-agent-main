from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

FACT_STATE_SCHEMA_VERSION = "notice_ingest_fact_state.v1"

SOURCE_UNIT_STATES = frozenset(
    (
        "captured",
        "queued",
        "source_truth_ready",
        "searchable_ready",
        "target_candidate",
        "target_replay_evaluated",
        "invalid_capture",
    )
)

MEDIA_STATES = frozenset(
    (
        "not_required",
        "ocr_pending",
        "ocr_ready",
        "ocr_low_confidence",
        "manual_review",
        "failed_retryable",
        "failed_terminal",
    )
)

FACT_READINESS_STATES = frozenset(
    (
        "ready_from_text",
        "ready_from_owner_text",
        "ready_from_ocr",
        "ready_from_mixed_sources",
        "partial",
        "missing",
        "blocked_by_required_media",
        "review_required",
    )
)

TARGET_ADMISSION_STATES = frozenset(
    (
        "stage_ready",
        "search_only",
        "needs_multimodal",
        "defer",
        "manual_review",
        "blocked",
    )
)


def validate_fact_state_payload(payload: Mapping[str, Any]) -> None:
    if not isinstance(payload, Mapping):
        raise ValueError("fact state payload must be an object")
    _require_value(payload, "schema_version", {FACT_STATE_SCHEMA_VERSION})
    _require_text(payload, "target")
    _require_value(payload, "source_unit_state", SOURCE_UNIT_STATES)
    _require_value(payload, "fact_readiness_state", FACT_READINESS_STATES)
    _require_value(payload, "target_admission_state", TARGET_ADMISSION_STATES)
    for field_name in (
        "required_fact_groups",
        "ready_fact_groups",
        "missing_fact_groups",
        "reason_codes",
        "media_states",
        "blocking_media",
    ):
        _require_sequence(payload, field_name)
    if not isinstance(payload.get("provenance"), Mapping):
        raise ValueError("provenance must be an object")
    for index, media_state in enumerate(payload.get("media_states") or ()):
        if not isinstance(media_state, Mapping):
            raise ValueError(f"media_states[{index}] must be an object")
        _require_text(media_state, "media_role", prefix=f"media_states[{index}]")
        _require_value(
            media_state,
            "media_state",
            MEDIA_STATES,
            prefix=f"media_states[{index}]",
        )
        if not isinstance(media_state.get("target_blocking"), bool):
            raise ValueError(f"media_states[{index}].target_blocking must be a boolean")


def _require_text(
    payload: Mapping[str, Any],
    field_name: str,
    *,
    prefix: str = "",
) -> None:
    value = payload.get(field_name)
    if not isinstance(value, str) or not value.strip():
        path = f"{prefix}.{field_name}" if prefix else field_name
        raise ValueError(f"{path} must be a non-empty string")


def _require_value(
    payload: Mapping[str, Any],
    field_name: str,
    allowed_values: set[str] | frozenset[str],
    *,
    prefix: str = "",
) -> None:
    value = payload.get(field_name)
    if value not in allowed_values:
        path = f"{prefix}.{field_name}" if prefix else field_name
        raise ValueError(f"{path} has unsupported value: {value}")


def _require_sequence(payload: Mapping[str, Any], field_name: str) -> None:
    value = payload.get(field_name)
    if not isinstance(value, Sequence) or isinstance(value, str | bytes):
        raise ValueError(f"{field_name} must be a sequence")


__all__ = [
    "FACT_READINESS_STATES",
    "FACT_STATE_SCHEMA_VERSION",
    "MEDIA_STATES",
    "SOURCE_UNIT_STATES",
    "TARGET_ADMISSION_STATES",
    "validate_fact_state_payload",
]
