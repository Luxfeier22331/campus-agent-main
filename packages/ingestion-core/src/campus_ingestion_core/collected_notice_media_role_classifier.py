from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.collected_notice_media_lifecycle import (
    MEDIA_LIFECYCLE_FAILED_RETRYABLE,
    MEDIA_LIFECYCLE_MANUAL_REVIEW,
    MEDIA_LIFECYCLE_PENDING,
    normalize_media_lifecycle_status,
)

MEDIA_ROLE_OWNER_DOCUMENT = "owner_document"
MEDIA_ROLE_QR_OR_RESERVATION_INSTRUCTION = "qr_or_reservation_instruction"
MEDIA_ROLE_SCHEDULE_TABLE_CARRIER = "schedule_table_carrier"
MEDIA_ROLE_SUPPLEMENTAL_LOCATION_VISUAL = "supplemental_location_visual"
MEDIA_ROLE_UNKNOWN = "unknown"
MEDIA_ROLE_VISUAL_TEXT_ONLY = "visual_text_only"

_IMAGE_MEDIA_KINDS = frozenset(("image", "inline_image"))
_OWNER_DOCUMENT_MEDIA_KINDS = frozenset(("pdf", "office", "document"))
_BLOCKING_MEDIA_STATES = frozenset(
    (MEDIA_LIFECYCLE_PENDING, MEDIA_LIFECYCLE_MANUAL_REVIEW, MEDIA_LIFECYCLE_FAILED_RETRYABLE)
)
_PENDING_UNIT_MEDIA_STATUSES = frozenset(("pending", "failed", "failed_retryable", "manual_review"))
_SCHEDULE_TARGET = "transport_schedule"
_SERVICE_STATUS_TARGET = "service_status"
_REGULATION_TARGET = "regulation"
_SCHEDULE_TABLE_HINTS = (
    "见下表",
    "具体见下表",
    "如下表",
    "运营安排如下",
    "班车安排",
    "接驳车安排",
    "时刻表",
)
_LOCATION_HINTS = ("乘车地点", "上车地点", "下车地点", "A出口", "右转", "西侧", "东侧")
_RESERVATION_HINTS = ("预约", "扫码", "二维码", "扫一扫")


def classify_notice_media_roles(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    target: str,
    text_fact_complete: bool,
) -> list[dict[str, Any]]:
    candidates = _candidate_rows_for_unit(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
    )
    if not candidates:
        return []
    return [
        _media_state(
            unit=unit,
            candidate=candidate,
            target=str(target or ""),
            text_fact_complete=text_fact_complete,
        )
        for candidate in candidates
    ]


def has_pending_unit_media(unit: Mapping[str, Any]) -> bool:
    status = str(unit.get("media_text_status") or unit.get("multimodal_status") or "")
    return status in _PENDING_UNIT_MEDIA_STATUSES


def _candidate_rows_for_unit(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
) -> list[dict[str, Any]]:
    unit_id = str(unit.get("unit_id") or "")
    rows = [
        dict(row)
        for row in multimodal_candidate_inventory.get("candidates") or ()
        if isinstance(row, Mapping) and str(row.get("unit_id") or "") == unit_id
    ]
    if rows:
        return rows
    return []


def _media_state(
    *,
    unit: Mapping[str, Any],
    candidate: Mapping[str, Any],
    target: str,
    text_fact_complete: bool,
) -> dict[str, Any]:
    media_kind = str(candidate.get("media_kind") or "").strip() or _candidate_media_kind(candidate)
    processing_family = str(candidate.get("processing_family") or "")
    status = str(candidate.get("status") or "")
    media_role = _media_role(
        unit=unit,
        candidate=candidate,
        target=target,
        media_kind=media_kind,
        processing_family=processing_family,
        text_fact_complete=text_fact_complete,
    )
    media_state = _media_state_from_status(status)
    target_blocking = _target_blocking(
        candidate=candidate,
        media_role=media_role,
        media_state=media_state,
    )
    return {
        "candidate_id": str(candidate.get("candidate_id") or ""),
        "unit_id": str(unit.get("unit_id") or ""),
        "source_notice_id": str(unit.get("source_notice_id") or ""),
        "media_ref_id": str(candidate.get("media_ref_id") or ""),
        "media_kind": media_kind,
        "media_role": media_role,
        "media_state": media_state,
        "target": target,
        "target_blocking": target_blocking,
        "reason_codes": _reason_codes(
            media_role=media_role,
            media_state=media_state,
            target_blocking=target_blocking,
        ),
    }


def _media_role(
    *,
    unit: Mapping[str, Any],
    candidate: Mapping[str, Any],
    target: str,
    media_kind: str,
    processing_family: str,
    text_fact_complete: bool,
) -> str:
    candidate_role = str(candidate.get("media_role") or "").strip()
    if candidate_role:
        return candidate_role
    policy_text = _policy_text(unit=unit, candidate=candidate)
    if target == _REGULATION_TARGET or media_kind in _OWNER_DOCUMENT_MEDIA_KINDS:
        return MEDIA_ROLE_OWNER_DOCUMENT
    if any(hint in policy_text for hint in _RESERVATION_HINTS):
        return MEDIA_ROLE_QR_OR_RESERVATION_INSTRUCTION
    if target == _SCHEDULE_TARGET:
        if text_fact_complete and media_kind in _IMAGE_MEDIA_KINDS:
            if any(hint in policy_text for hint in _LOCATION_HINTS):
                return MEDIA_ROLE_SUPPLEMENTAL_LOCATION_VISUAL
            return MEDIA_ROLE_SUPPLEMENTAL_LOCATION_VISUAL
        if processing_family == "schedule_image_ocr":
            return MEDIA_ROLE_SCHEDULE_TABLE_CARRIER
        if media_kind in _IMAGE_MEDIA_KINDS and any(
            hint in policy_text for hint in _SCHEDULE_TABLE_HINTS
        ):
            return MEDIA_ROLE_SCHEDULE_TABLE_CARRIER
    if target == _SERVICE_STATUS_TARGET:
        if text_fact_complete:
            return (
                MEDIA_ROLE_SUPPLEMENTAL_LOCATION_VISUAL
                if media_kind in _IMAGE_MEDIA_KINDS
                else MEDIA_ROLE_VISUAL_TEXT_ONLY
            )
        return MEDIA_ROLE_VISUAL_TEXT_ONLY
    if media_kind in _IMAGE_MEDIA_KINDS:
        return MEDIA_ROLE_VISUAL_TEXT_ONLY
    return MEDIA_ROLE_UNKNOWN


def _target_blocking(
    *,
    candidate: Mapping[str, Any],
    media_role: str,
    media_state: str,
) -> bool:
    if "target_blocking" in candidate:
        target_blocking = candidate.get("target_blocking")
        if not isinstance(target_blocking, bool):
            raise ValueError("target_blocking must be a boolean")
        return target_blocking
    return media_state in _BLOCKING_MEDIA_STATES and media_role in {
        MEDIA_ROLE_OWNER_DOCUMENT,
        MEDIA_ROLE_SCHEDULE_TABLE_CARRIER,
        MEDIA_ROLE_VISUAL_TEXT_ONLY,
    }


def _media_state_from_status(status: str) -> str:
    return normalize_media_lifecycle_status(status)


def _reason_codes(
    *,
    media_role: str,
    media_state: str,
    target_blocking: bool,
) -> list[str]:
    reason_codes = [media_role]
    if target_blocking:
        reason_codes.append("required_media_pending")
    elif media_state in _BLOCKING_MEDIA_STATES:
        reason_codes.append("supplemental_media_pending")
    return reason_codes


def _candidate_media_kind(candidate: Mapping[str, Any]) -> str:
    attachment = candidate.get("attachment_ref")
    if isinstance(attachment, Mapping):
        return _attachment_media_kind(attachment)
    return "image"


def _attachment_media_kind(attachment: Mapping[str, Any]) -> str:
    filename = str(
        attachment.get("filename") or attachment.get("name") or attachment.get("object_key") or ""
    ).lower()
    if filename.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")):
        return "image"
    if filename.endswith(".pdf"):
        return "pdf"
    if filename.endswith((".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")):
        return "office"
    return str(attachment.get("media_kind") or attachment.get("kind") or "unknown")


def _policy_text(*, unit: Mapping[str, Any], candidate: Mapping[str, Any]) -> str:
    attachment = candidate.get("attachment_ref")
    attachment_text = ""
    if isinstance(attachment, Mapping):
        attachment_text = " ".join(
            str(attachment.get(field) or "")
            for field in ("filename", "name", "caption", "alt", "text")
        )
    return "\n".join(
        part
        for part in (
            str(unit.get("title") or ""),
            str(unit.get("body_text") or ""),
            str(unit.get("search_text") or ""),
            str(candidate.get("media_ref_id") or ""),
            attachment_text,
        )
        if part
    )


__all__ = [
    "MEDIA_ROLE_OWNER_DOCUMENT",
    "MEDIA_ROLE_QR_OR_RESERVATION_INSTRUCTION",
    "MEDIA_ROLE_SCHEDULE_TABLE_CARRIER",
    "MEDIA_ROLE_SUPPLEMENTAL_LOCATION_VISUAL",
    "MEDIA_ROLE_UNKNOWN",
    "MEDIA_ROLE_VISUAL_TEXT_ONLY",
    "classify_notice_media_roles",
    "has_pending_unit_media",
]
