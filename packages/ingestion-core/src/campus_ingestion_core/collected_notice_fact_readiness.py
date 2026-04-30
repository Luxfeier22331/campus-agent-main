from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.collected_notice_fact_state_contract import (
    FACT_STATE_SCHEMA_VERSION,
)
from campus_ingestion_core.collected_notice_media_role_classifier import (
    classify_notice_media_roles,
    has_pending_unit_media,
)

FACT_READINESS_BLOCKED_BY_REQUIRED_MEDIA = "blocked_by_required_media"
FACT_READINESS_MISSING = "missing"
FACT_READINESS_READY_FROM_OWNER_TEXT = "ready_from_owner_text"
FACT_READINESS_READY_FROM_TEXT = "ready_from_text"
TARGET_ADMISSION_DEFER = "defer"
TARGET_ADMISSION_NEEDS_MULTIMODAL = "needs_multimodal"
TARGET_ADMISSION_STAGE_READY = "stage_ready"
TRANSPORT_SCHEDULE_TARGET = "transport_schedule"
SERVICE_STATUS_TARGET = "service_status"
REGULATION_TARGET = "regulation"


def build_transport_schedule_fact_readiness(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    text_schedule_row_count: int,
) -> dict[str, Any]:
    text_fact_complete = text_schedule_row_count > 0
    media_states = classify_notice_media_roles(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        target=TRANSPORT_SCHEDULE_TARGET,
        text_fact_complete=text_fact_complete,
    )
    return _build_fact_readiness(
        unit=unit,
        target=TRANSPORT_SCHEDULE_TARGET,
        required_fact_groups=("route", "service_window", "departure_time"),
        ready_fact_groups=(
            ("route", "service_window", "departure_time") if text_fact_complete else ()
        ),
        text_fact_complete=text_fact_complete,
        media_states=media_states,
    )


def build_service_status_fact_readiness(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    text_record_ready: bool,
) -> dict[str, Any]:
    media_states = classify_notice_media_roles(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        target=SERVICE_STATUS_TARGET,
        text_fact_complete=text_record_ready,
    )
    return _build_fact_readiness(
        unit=unit,
        target=SERVICE_STATUS_TARGET,
        required_fact_groups=("subject", "observed_status", "effective_window"),
        ready_fact_groups=(
            ("subject", "observed_status", "effective_window") if text_record_ready else ()
        ),
        text_fact_complete=text_record_ready,
        media_states=media_states,
    )


def build_regulation_fact_readiness(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    owner_text_ready: bool,
) -> dict[str, Any]:
    media_states = classify_notice_media_roles(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        target=REGULATION_TARGET,
        text_fact_complete=owner_text_ready,
    )
    if owner_text_ready:
        return _payload(
            unit=unit,
            target=REGULATION_TARGET,
            fact_readiness_state=FACT_READINESS_READY_FROM_OWNER_TEXT,
            target_admission_state=TARGET_ADMISSION_STAGE_READY,
            required_fact_groups=("owner_document_text", "document_identity"),
            ready_fact_groups=("owner_document_text", "document_identity"),
            missing_fact_groups=(),
            media_states=media_states,
            blocking_media=(),
            reason_codes=("owner_text_facts_complete",),
        )
    return _build_fact_readiness(
        unit=unit,
        target=REGULATION_TARGET,
        required_fact_groups=("owner_document_text", "document_identity"),
        ready_fact_groups=(),
        text_fact_complete=False,
        media_states=media_states,
    )


def _build_fact_readiness(
    *,
    unit: Mapping[str, Any],
    target: str,
    required_fact_groups: tuple[str, ...],
    ready_fact_groups: tuple[str, ...],
    text_fact_complete: bool,
    media_states: list[dict[str, Any]],
) -> dict[str, Any]:
    blocking_media = tuple(row for row in media_states if row.get("target_blocking"))
    pending_nonblocking_media = any(
        row.get("media_state") == "ocr_pending" and not row.get("target_blocking")
        for row in media_states
    ) or (text_fact_complete and has_pending_unit_media(unit) and not blocking_media)
    if text_fact_complete:
        reason_codes = ["body_facts_complete"]
        if pending_nonblocking_media:
            reason_codes.append("supplemental_media_pending")
        return _payload(
            unit=unit,
            target=target,
            fact_readiness_state=FACT_READINESS_READY_FROM_TEXT,
            target_admission_state=TARGET_ADMISSION_STAGE_READY,
            required_fact_groups=required_fact_groups,
            ready_fact_groups=ready_fact_groups,
            missing_fact_groups=(),
            media_states=media_states,
            blocking_media=(),
            reason_codes=tuple(reason_codes),
        )
    if blocking_media or has_pending_unit_media(unit):
        return _payload(
            unit=unit,
            target=target,
            fact_readiness_state=FACT_READINESS_BLOCKED_BY_REQUIRED_MEDIA,
            target_admission_state=TARGET_ADMISSION_NEEDS_MULTIMODAL,
            required_fact_groups=required_fact_groups,
            ready_fact_groups=ready_fact_groups,
            missing_fact_groups=tuple(
                item for item in required_fact_groups if item not in set(ready_fact_groups)
            ),
            media_states=media_states,
            blocking_media=blocking_media or tuple(media_states),
            reason_codes=("required_media_pending",),
        )
    return _payload(
        unit=unit,
        target=target,
        fact_readiness_state=FACT_READINESS_MISSING,
        target_admission_state=TARGET_ADMISSION_DEFER,
        required_fact_groups=required_fact_groups,
        ready_fact_groups=ready_fact_groups,
        missing_fact_groups=tuple(
            item for item in required_fact_groups if item not in set(ready_fact_groups)
        ),
        media_states=media_states,
        blocking_media=(),
        reason_codes=("required_fact_missing",),
    )


def _payload(
    *,
    unit: Mapping[str, Any],
    target: str,
    fact_readiness_state: str,
    target_admission_state: str,
    required_fact_groups: tuple[str, ...],
    ready_fact_groups: tuple[str, ...],
    missing_fact_groups: tuple[str, ...],
    media_states: list[dict[str, Any]] | tuple[dict[str, Any], ...],
    blocking_media: tuple[dict[str, Any], ...],
    reason_codes: tuple[str, ...],
) -> dict[str, Any]:
    return {
        "schema_version": FACT_STATE_SCHEMA_VERSION,
        "target": target,
        "source_unit_state": "searchable_ready" if unit.get("unit_id") else "invalid_capture",
        "fact_readiness_state": fact_readiness_state,
        "target_admission_state": target_admission_state,
        "required_fact_groups": list(required_fact_groups),
        "ready_fact_groups": list(ready_fact_groups),
        "missing_fact_groups": list(missing_fact_groups),
        "reason_codes": list(dict.fromkeys(reason_codes)),
        "media_states": [dict(item) for item in media_states],
        "blocking_media": [dict(item) for item in blocking_media],
        "provenance": {
            "source_notice_id": str(unit.get("source_notice_id") or ""),
            "searchable_unit_id": str(unit.get("unit_id") or ""),
        },
    }


__all__ = [
    "FACT_READINESS_BLOCKED_BY_REQUIRED_MEDIA",
    "FACT_READINESS_MISSING",
    "FACT_READINESS_READY_FROM_OWNER_TEXT",
    "FACT_READINESS_READY_FROM_TEXT",
    "TARGET_ADMISSION_DEFER",
    "TARGET_ADMISSION_NEEDS_MULTIMODAL",
    "TARGET_ADMISSION_STAGE_READY",
    "build_regulation_fact_readiness",
    "build_service_status_fact_readiness",
    "build_transport_schedule_fact_readiness",
]
