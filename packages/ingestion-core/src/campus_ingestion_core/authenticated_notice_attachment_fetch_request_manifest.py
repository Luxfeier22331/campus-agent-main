from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.authenticated_notice_attachment_bytes import (
    has_collected_attachment_bytes,
)

FETCH_REQUEST_MANIFEST_SCHEMA = "authenticated_notice_attachment_fetch_request_manifest_v1"

FETCH_REQUEST_POLICIES = {
    "fetch_to_quarantine",
    "fetch_required_for_source_truth",
    "fetch_required_for_admitted_owner",
}

REQUIRED_SOURCE_OBJECT_POLICIES = {
    "fetch_required_for_source_truth",
    "fetch_required_for_admitted_owner",
}

DEFAULT_RETENTION_CLASS_BY_POLICY = {
    "fetch_to_quarantine": "quarantine_candidate",
    "fetch_required_for_source_truth": "permanent_source_truth",
    "fetch_required_for_admitted_owner": "admitted_source_bytes",
}


def build_authenticated_notice_attachment_fetch_request_manifest(
    *,
    notice_manifest: Mapping[str, Any],
    attachment_refs: tuple[Mapping[str, Any], ...],
) -> dict[str, Any]:
    site_id = _required_text(notice_manifest, "site_id")
    notice_id = _required_text(notice_manifest, "notice_id")
    raw_asset_id = _required_text(notice_manifest, "raw_asset_id")
    raw_version_id = _required_text(notice_manifest, "raw_version_id")
    requests = [
        _build_fetch_request(
            attachment_ref=attachment_ref,
            notice_id=notice_id,
            site_id=site_id,
        )
        for attachment_ref in attachment_refs
        if _requires_collector_fetch(attachment_ref)
    ]
    invalid_attachment_refs = [
        invalid_ref
        for attachment_ref in attachment_refs
        if (invalid_ref := _invalid_attachment_ref(attachment_ref)) is not None
    ]
    return {
        "schema_version": FETCH_REQUEST_MANIFEST_SCHEMA,
        "site_id": site_id,
        "notice_id": notice_id,
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "fetch_request_count": len(requests),
        "required_source_object_count": sum(
            1 for request in requests if request["required_source_object"]
        ),
        "missing_required_source_object_count": sum(
            1
            for invalid_ref in invalid_attachment_refs
            if invalid_ref["code"] == "required_source_object_missing_bytes_without_fetch"
        ),
        "invalid_attachment_refs": invalid_attachment_refs,
        "requests": requests,
    }


def _build_fetch_request(
    *,
    attachment_ref: Mapping[str, Any],
    notice_id: str,
    site_id: str,
) -> dict[str, Any]:
    attachment_ref_id = _required_text(attachment_ref, "attachment_ref_id")
    policy = _attachment_capture_policy(attachment_ref)
    source_url = _first_text(
        attachment_ref.get("source_url"),
        attachment_ref.get("normalized_source_url"),
        attachment_ref.get("final_url"),
    )
    if source_url is None:
        raise ValueError(
            f"attachment_ref {attachment_ref_id} requires source_url for fetch request"
        )
    required_source_object = policy in REQUIRED_SOURCE_OBJECT_POLICIES
    row = {
        "site_id": site_id,
        "notice_id": notice_id,
        "attachment_ref_id": attachment_ref_id,
        "attachment_capture_policy": policy,
        "attachment_capture_state": _optional_text(attachment_ref.get("attachment_capture_state"))
        or "not_attempted",
        "retention_class": _optional_text(attachment_ref.get("retention_class"))
        or DEFAULT_RETENTION_CLASS_BY_POLICY[policy],
        "required_source_object": required_source_object,
        "source_object_role": _optional_text(attachment_ref.get("source_object_role")),
        "source_url": source_url,
        "normalized_source_url": _optional_text(attachment_ref.get("normalized_source_url")),
        "final_url": _optional_text(attachment_ref.get("final_url")),
        "mime_type": _optional_text(attachment_ref.get("mime_type")),
        "byte_fetch_required_reason": _optional_text(
            attachment_ref.get("byte_fetch_required_reason")
        ),
        "promotion_owner": _optional_text(attachment_ref.get("promotion_owner")),
        "promotion_decision_id": _optional_text(attachment_ref.get("promotion_decision_id")),
        "collector_admission": {
            "noticeId": notice_id,
            "attachmentRefId": attachment_ref_id,
            "attachmentCapturePolicy": policy,
        },
    }
    if required_source_object and row["source_object_role"] is None:
        row["source_object_role"] = "notice_attachment_source_bytes"
    return row


def _attachment_capture_policy(attachment_ref: Mapping[str, Any]) -> str:
    policy = _optional_text(attachment_ref.get("attachment_capture_policy"))
    return policy or "metadata_only"


def _requires_collector_fetch(attachment_ref: Mapping[str, Any]) -> bool:
    if _is_terminal_unavailable_ref(attachment_ref):
        return False
    if _attachment_capture_policy(attachment_ref) not in FETCH_REQUEST_POLICIES:
        return False
    if _explicit_false(attachment_ref.get("byte_fetch_required")):
        return False
    if has_collected_attachment_bytes(attachment_ref):
        return False
    state = _optional_text(attachment_ref.get("attachment_capture_state"))
    return state not in {"uploaded_quarantine", "uploaded_required"}


def _is_terminal_unavailable_ref(attachment_ref: Mapping[str, Any]) -> bool:
    if _optional_text(attachment_ref.get("attachment_capture_policy")) == "terminal_unavailable":
        return True
    if _optional_text(attachment_ref.get("terminal_reason")) is not None:
        return True
    if _optional_text(attachment_ref.get("last_error_class")) == "terminal_unavailable":
        return True
    return _optional_text(attachment_ref.get("attachment_capture_state")) == "terminal_missing"


def _invalid_attachment_ref(attachment_ref: Mapping[str, Any]) -> dict[str, str] | None:
    policy = _attachment_capture_policy(attachment_ref)
    if policy not in REQUIRED_SOURCE_OBJECT_POLICIES:
        return None
    if _is_terminal_unavailable_ref(attachment_ref):
        return None
    if has_collected_attachment_bytes(attachment_ref):
        return None
    if not _explicit_false(attachment_ref.get("byte_fetch_required")):
        return None
    return {
        "attachment_ref_id": _required_text(attachment_ref, "attachment_ref_id"),
        "code": "required_source_object_missing_bytes_without_fetch",
        "attachment_capture_policy": policy,
    }


def _explicit_false(value: Any) -> bool:
    if value is False:
        return True
    if isinstance(value, str):
        return value.strip().lower() in {"0", "false", "no", "off"}
    return False


def _required_text(mapping: Mapping[str, Any], key: str) -> str:
    value = _optional_text(mapping.get(key))
    if value is None:
        raise ValueError(f"{key} is required")
    return value


def _optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _first_text(*values: Any) -> str | None:
    for value in values:
        text = _optional_text(value)
        if text is not None:
            return text
    return None


__all__ = [
    "FETCH_REQUEST_MANIFEST_SCHEMA",
    "FETCH_REQUEST_POLICIES",
    "build_authenticated_notice_attachment_fetch_request_manifest",
]
