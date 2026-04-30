from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.collected_notice_classification import (
    classification_target_candidates,
)
from campus_ingestion_core.collected_notice_media_lifecycle import (
    MEDIA_LIFECYCLE_FAILED_RETRYABLE,
    MEDIA_LIFECYCLE_MANUAL_REVIEW,
    MEDIA_LIFECYCLE_PENDING,
)
from campus_ingestion_core.collected_notice_multimodal_readiness_shared import (
    IMAGE_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE,
    MEDIA_EXTRACTION_CANDIDATE_SCHEMA_VERSION,
    OFFICE_TEXT_EXTRACTION_ATTEMPT_TABLE,
    PDF_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE,
    RELEASED_FILE_TEXT_EXTRACTION_ATTEMPT_TABLE,
    mapping_rows,
)
from campus_ingestion_core.internal_notice_consumption_projection_multimodal import (
    NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
    looks_like_low_value_ephemeral_event_poster,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE,
)
from campus_ingestion_core.wechat_public_notice_multimodal import (
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
)

_HIGH_VALUE_TARGETS = frozenset(("transport_schedule", "service_status", "regulation"))
_HIGH_VALUE_KEYWORDS = (
    "班车",
    "校车",
    "通勤",
    "时刻表",
    "接驳",
    "暂停",
    "恢复",
    "开放",
    "关闭",
    "规定",
    "办法",
    "制度",
    "条例",
    "规章",
    "安全管理",
    "流程",
    "申请表",
    "表格",
)
_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
_PDF_SUFFIXES = (".pdf",)
_OFFICE_SUFFIXES = (".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx")
_ARCHIVE_SUFFIXES = (".zip", ".rar", ".7z")
_PROCESSING_FAMILY_SCHEDULE_IMAGE_OCR = "schedule_image_ocr"
_PROCESSING_FAMILY_RELEASED_FILE_TEXT_EXTRACTION = "released_file_text_extraction"
_PROCESSING_FAMILY_PDF_OCR_TEXT_EXTRACTION = "pdf_ocr_text_extraction"
_PROCESSING_FAMILY_OFFICE_TEXT_EXTRACTION = "office_text_extraction"
_PROCESSING_FAMILY_IMAGE_OCR_TEXT_EXTRACTION = "image_ocr_text_extraction"
_MEDIA_ROLE_OWNER_DOCUMENT = "owner_document"
_MEDIA_ROLE_SCHEDULE_TABLE_CARRIER = "schedule_table_carrier"
_MEDIA_ROLE_VISUAL_TEXT_ONLY = "visual_text_only"
_MEDIA_ROLE_SUPPLEMENTAL_MEDIA = "supplemental_media"
_MEDIA_ROLE_SOURCE_CAPTURE_REPAIR = "source_capture_repair"
_TARGET_BLOCKING_ROLES = frozenset(
    (
        _MEDIA_ROLE_OWNER_DOCUMENT,
        _MEDIA_ROLE_SCHEDULE_TABLE_CARRIER,
        _MEDIA_ROLE_VISUAL_TEXT_ONLY,
    )
)
_PROCESSABLE_ATTACHMENT_POLICIES = frozenset(
    (
        "fetch_to_quarantine",
        "fetch_required_for_source_truth",
        "fetch_required_for_admitted_owner",
    )
)


def selected_units(
    *,
    invalid_defer_multimodal_report: Mapping[str, Any],
    searchable_notice_preview: Mapping[str, Any],
) -> tuple[dict[str, Any], ...]:
    requested_unit_ids = {
        str(row.get("unit_id") or "").strip()
        for row in mapping_rows(invalid_defer_multimodal_report.get("needs_multimodal_units"))
        if str(row.get("unit_id") or "").strip()
    }
    units = []
    for row in mapping_rows(searchable_notice_preview.get("units")):
        unit_id = str(row.get("unit_id") or "").strip()
        multimodal_status = str(row.get("multimodal_status") or "").strip()
        media_text_status = str(row.get("media_text_status") or multimodal_status).strip()
        if requested_unit_ids:
            if unit_id in requested_unit_ids:
                units.append(dict(row))
        elif media_text_status in {
            MEDIA_LIFECYCLE_PENDING,
            MEDIA_LIFECYCLE_MANUAL_REVIEW,
            MEDIA_LIFECYCLE_FAILED_RETRYABLE,
        }:
            units.append(dict(row))
    return tuple(sorted(units, key=lambda item: str(item.get("unit_id") or "")))


def candidate_records(
    units: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, Any], ...]:
    candidates: list[dict[str, Any]] = []
    for unit in units:
        raw_attachments = tuple(mapping_rows(unit.get("attachment_refs")))
        attachments = tuple(
            attachment
            for attachment in raw_attachments
            if _is_processable_attachment_ref(attachment)
        )
        if not raw_attachments:
            candidates.append(_source_body_repair_candidate(unit))
            continue
        if not attachments:
            continue
        for index, attachment in enumerate(attachments, start=1):
            candidates.append(_media_candidate(unit, attachment, image_index=index))
    return tuple(sorted(candidates, key=lambda item: str(item["candidate_id"])))


def _is_processable_attachment_ref(attachment: Mapping[str, Any]) -> bool:
    policy = str(attachment.get("attachment_capture_policy") or "").strip()
    return policy in _PROCESSABLE_ATTACHMENT_POLICIES


def _media_candidate(
    unit: Mapping[str, Any],
    attachment: Mapping[str, Any],
    *,
    image_index: int,
) -> dict[str, Any]:
    media_ref_id = _media_ref_id(attachment, image_index=image_index)
    media_kind = _media_kind(attachment)
    reason_codes = list(dict.fromkeys(_reason_codes(unit) + _candidate_reason_codes(media_kind)))
    target_hints = _target_hints(unit)
    priority = _priority(unit, media_kind=media_kind, target_hints=target_hints)
    processing_family = _processing_family(
        unit,
        media_kind=media_kind,
        target_hints=target_hints,
    )
    object_ref = _source_object_ref(unit, attachment)
    status = MEDIA_LIFECYCLE_PENDING
    policy_action = "process"
    skip_reason = ""
    if not object_ref:
        status = MEDIA_LIFECYCLE_FAILED_RETRYABLE
        policy_action = "fail"
        reason_codes.append("missing_source_object_ref")
    elif media_kind in {"archive", "unknown"}:
        status = MEDIA_LIFECYCLE_FAILED_RETRYABLE
        policy_action = "fail"
        reason_codes.append("unsupported_media_kind")
    elif (
        media_kind == "image"
        and priority != "high"
        and looks_like_low_value_ephemeral_event_poster(_policy_text(unit, attachment))
    ):
        status = "skipped"
        policy_action = "skip"
        skip_reason = NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER
        reason_codes.append(skip_reason)
    media_role = _media_role(
        media_kind=media_kind,
        processing_family=processing_family,
        target_hints=target_hints,
    )
    target_blocking = (
        status
        in {
            MEDIA_LIFECYCLE_PENDING,
            MEDIA_LIFECYCLE_MANUAL_REVIEW,
            MEDIA_LIFECYCLE_FAILED_RETRYABLE,
        }
        and media_role in _TARGET_BLOCKING_ROLES
    )
    candidate_id = _candidate_id(
        unit_id=str(unit.get("unit_id") or ""),
        media_ref_id=media_ref_id,
        source_object_key=str((object_ref or {}).get("key") or ""),
        processing_family=processing_family,
    )
    output_refs = _normalized_output_refs(
        candidate_id=candidate_id,
        unit=unit,
        object_key=str((object_ref or {}).get("key") or ""),
    )
    return {
        "schema_version": MEDIA_EXTRACTION_CANDIDATE_SCHEMA_VERSION,
        "candidate_id": candidate_id,
        "unit_id": str(unit.get("unit_id") or ""),
        "source_channel": str(unit.get("source_channel") or ""),
        "source_surface": str(unit.get("source_surface") or ""),
        "source_corpus": str(unit.get("source_corpus") or ""),
        "source_collection": str(unit.get("source_collection") or ""),
        "site_id": str(unit.get("site_id") or ""),
        "source_notice_id": str(unit.get("source_notice_id") or ""),
        "source_document_id": str(unit.get("source_document_id") or ""),
        "title": str(unit.get("title") or ""),
        "published_at": str(unit.get("published_at") or ""),
        "source_url": str(unit.get("source_url") or ""),
        "media_ref_id": media_ref_id,
        "image_index": image_index if media_kind == "image" else None,
        "media_kind": media_kind,
        "media_role": media_role,
        "processing_family": processing_family,
        "target_blocking": target_blocking,
        "priority": priority,
        "status": status,
        "policy_action": policy_action,
        "skip_reason": skip_reason,
        "reason_codes": list(dict.fromkeys(reason_codes)),
        "target_hints": target_hints,
        "classification": dict(unit.get("classification") or {}),
        "source_object_ref": object_ref,
        "attachment_ref": _attachment_projection(attachment),
        "attempt_ledger": _attempt_ledger(
            processing_family=processing_family,
            unit=unit,
            media_ref_id=media_ref_id,
            image_index=image_index,
        ),
        "normalized_output_refs": output_refs,
        "provenance": {
            "phase4_searchable_unit_id": str(unit.get("unit_id") or ""),
            "phase4_admission_batch_id": str(unit.get("admission_batch_id") or ""),
            "run_provenance": dict(unit.get("run_provenance") or {}),
        },
    }


def _source_body_repair_candidate(unit: Mapping[str, Any]) -> dict[str, Any]:
    media_ref_id = "source-body"
    processing_family = "source_capture_repair"
    reason_codes = list(dict.fromkeys((*_reason_codes(unit), "missing_processable_media")))
    candidate_id = _candidate_id(
        unit_id=str(unit.get("unit_id") or ""),
        media_ref_id=media_ref_id,
        source_object_key="",
        processing_family=processing_family,
    )
    return {
        "schema_version": MEDIA_EXTRACTION_CANDIDATE_SCHEMA_VERSION,
        "candidate_id": candidate_id,
        "unit_id": str(unit.get("unit_id") or ""),
        "source_channel": str(unit.get("source_channel") or ""),
        "source_surface": str(unit.get("source_surface") or ""),
        "source_corpus": str(unit.get("source_corpus") or ""),
        "source_collection": str(unit.get("source_collection") or ""),
        "site_id": str(unit.get("site_id") or ""),
        "source_notice_id": str(unit.get("source_notice_id") or ""),
        "source_document_id": str(unit.get("source_document_id") or ""),
        "title": str(unit.get("title") or ""),
        "published_at": str(unit.get("published_at") or ""),
        "source_url": str(unit.get("source_url") or ""),
        "media_ref_id": media_ref_id,
        "image_index": None,
        "media_kind": "source_body",
        "media_role": _MEDIA_ROLE_SOURCE_CAPTURE_REPAIR,
        "processing_family": processing_family,
        "target_blocking": False,
        "priority": _priority(unit, media_kind="source_body", target_hints=_target_hints(unit)),
        "status": MEDIA_LIFECYCLE_FAILED_RETRYABLE,
        "policy_action": "fail",
        "skip_reason": "",
        "reason_codes": reason_codes,
        "target_hints": _target_hints(unit),
        "classification": dict(unit.get("classification") or {}),
        "source_object_ref": None,
        "attachment_ref": None,
        "attempt_ledger": _attempt_ledger(
            processing_family=processing_family,
            unit=unit,
            media_ref_id=media_ref_id,
            image_index=0,
        ),
        "normalized_output_refs": _normalized_output_refs(
            candidate_id=candidate_id,
            unit=unit,
            object_key="",
        ),
        "provenance": {
            "phase4_searchable_unit_id": str(unit.get("unit_id") or ""),
            "phase4_admission_batch_id": str(unit.get("admission_batch_id") or ""),
            "run_provenance": dict(unit.get("run_provenance") or {}),
        },
    }


def _attempt_ledger(
    *,
    processing_family: str,
    unit: Mapping[str, Any],
    media_ref_id: str,
    image_index: int,
) -> dict[str, Any]:
    if processing_family == "schedule_image_ocr":
        table = DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE
        identity = {
            "source_corpus": str(unit.get("source_corpus") or ""),
            "source_collection": str(unit.get("source_collection") or ""),
            "source_notice_id": str(unit.get("source_notice_id") or ""),
            "attachment_ref_id": media_ref_id,
            "image_index": image_index,
        }
    elif processing_family in {
        _PROCESSING_FAMILY_RELEASED_FILE_TEXT_EXTRACTION,
        _PROCESSING_FAMILY_PDF_OCR_TEXT_EXTRACTION,
        _PROCESSING_FAMILY_OFFICE_TEXT_EXTRACTION,
        _PROCESSING_FAMILY_IMAGE_OCR_TEXT_EXTRACTION,
    }:
        table = {
            _PROCESSING_FAMILY_RELEASED_FILE_TEXT_EXTRACTION: (
                RELEASED_FILE_TEXT_EXTRACTION_ATTEMPT_TABLE
            ),
            _PROCESSING_FAMILY_PDF_OCR_TEXT_EXTRACTION: PDF_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE,
            _PROCESSING_FAMILY_OFFICE_TEXT_EXTRACTION: OFFICE_TEXT_EXTRACTION_ATTEMPT_TABLE,
            _PROCESSING_FAMILY_IMAGE_OCR_TEXT_EXTRACTION: IMAGE_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE,
        }[processing_family]
        identity = {
            "source_corpus": str(unit.get("source_corpus") or ""),
            "source_collection": str(unit.get("source_collection") or ""),
            "source_notice_id": str(unit.get("source_notice_id") or ""),
            "unit_id": str(unit.get("unit_id") or ""),
            "media_ref_id": media_ref_id,
            "attempt_number": 1,
        }
    elif processing_family == "wechat_public_notice_multimodal":
        table = DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE
        identity = {
            "source_corpus": str(unit.get("source_corpus") or ""),
            "source_collection": str(unit.get("source_collection") or ""),
            "source_notice_id": str(unit.get("source_notice_id") or ""),
            "unit_id": str(unit.get("unit_id") or ""),
            "media_ref_id": media_ref_id,
            "attempt_number": 1,
        }
    else:
        table = "collector_source_repair_queue"
        identity = {
            "source_notice_id": str(unit.get("source_notice_id") or ""),
            "unit_id": str(unit.get("unit_id") or ""),
            "media_ref_id": media_ref_id,
        }
    return {"table": table, "identity": identity}


def _normalized_output_refs(
    *,
    candidate_id: str,
    unit: Mapping[str, Any],
    object_key: str,
) -> dict[str, dict[str, str]]:
    bucket = _source_bucket_from_unit(unit)
    base_prefix = _output_base_prefix(
        object_key=object_key,
        source_surface=str(unit.get("source_surface") or ""),
        site_id=str(unit.get("site_id") or ""),
        source_notice_id=str(unit.get("source_notice_id") or ""),
        candidate_id=candidate_id,
    )
    return {
        "provider_response": {
            "bucket": bucket,
            "key": f"{base_prefix}/provider/media-extraction-v1/provider-response.jsonl",
            "role": "provider_response",
        },
        "plain_text": {
            "bucket": bucket,
            "key": f"{base_prefix}/source-truth/visual-text.jsonl",
            "role": "plain_text",
        },
        "layout_elements": {
            "bucket": bucket,
            "key": f"{base_prefix}/source-truth/layout-elements.jsonl",
            "role": "layout_elements",
        },
        "searchable_merge_input": {
            "bucket": bucket,
            "key": f"{base_prefix}/source-truth/searchable-merge-input.json",
            "role": "searchable_merge_input",
        },
    }


def _source_object_ref(
    unit: Mapping[str, Any],
    attachment: Mapping[str, Any],
) -> dict[str, Any] | None:
    object_key = _optional_text(attachment.get("object_key"))
    if not object_key:
        return None
    payload: dict[str, Any] = {
        "bucket": _optional_text(attachment.get("bucket")) or _source_bucket_from_unit(unit),
        "key": object_key,
        "role": str(attachment.get("resource_role") or "attachment"),
    }
    for target_key, source_key in (
        ("sha256", "content_sha256"),
        ("byte_size", "byte_size"),
        ("mime_type", "mime_type"),
        ("source_url", "source_url"),
        ("final_url", "final_url"),
    ):
        value = attachment.get(source_key)
        if value not in {None, ""}:
            payload[target_key] = value
    return payload


def _attachment_projection(attachment: Mapping[str, Any]) -> dict[str, Any]:
    keys = (
        "attachment_ref_id",
        "ref_order",
        "resource_role",
        "content_kind",
        "anchor_text",
        "original_filename",
        "source_url",
        "final_url",
        "object_key",
        "content_sha256",
        "mime_type",
        "byte_size",
        "ingest_status",
    )
    return {key: attachment.get(key) for key in keys if attachment.get(key) not in {None, ""}}


def _processing_family(
    unit: Mapping[str, Any],
    *,
    media_kind: str,
    target_hints: Sequence[str],
) -> str:
    if str(unit.get("source_surface") or "") == "wechat_public_notice":
        return "wechat_public_notice_multimodal"
    if media_kind == "image" and "transport_schedule" in target_hints:
        return _PROCESSING_FAMILY_SCHEDULE_IMAGE_OCR
    if media_kind == "pdf" and str(unit.get("source_surface") or "") == "file_release":
        return _PROCESSING_FAMILY_RELEASED_FILE_TEXT_EXTRACTION
    if media_kind == "pdf":
        return _PROCESSING_FAMILY_PDF_OCR_TEXT_EXTRACTION
    if media_kind == "office":
        return _PROCESSING_FAMILY_OFFICE_TEXT_EXTRACTION
    if media_kind == "image":
        return _PROCESSING_FAMILY_IMAGE_OCR_TEXT_EXTRACTION
    return "source_capture_repair"


def _media_role(
    *,
    media_kind: str,
    processing_family: str,
    target_hints: Sequence[str],
) -> str:
    if "regulation" in target_hints or media_kind in {"pdf", "office"}:
        return _MEDIA_ROLE_OWNER_DOCUMENT
    if processing_family == _PROCESSING_FAMILY_SCHEDULE_IMAGE_OCR:
        return _MEDIA_ROLE_SCHEDULE_TABLE_CARRIER
    if "service_status" in target_hints:
        return _MEDIA_ROLE_VISUAL_TEXT_ONLY
    return _MEDIA_ROLE_SUPPLEMENTAL_MEDIA


def _priority(
    unit: Mapping[str, Any],
    *,
    media_kind: str,
    target_hints: Sequence[str],
) -> str:
    text = f"{unit.get('title') or ''}\n{unit.get('search_text') or ''}"
    classification = unit.get("classification")
    target_signals = (
        classification_target_candidates(unit)
        if isinstance(classification, Mapping)
        else target_hints
    )
    if _HIGH_VALUE_TARGETS.intersection(target_signals):
        return "high"
    if isinstance(classification, Mapping):
        return "normal"
    if any(keyword in text for keyword in _HIGH_VALUE_KEYWORDS):
        return "high"
    if media_kind == "source_body":
        return "normal"
    return "normal"


def _media_kind(attachment: Mapping[str, Any]) -> str:
    mime_type = str(attachment.get("mime_type") or "").strip().lower()
    filename = str(
        attachment.get("original_filename")
        or attachment.get("anchor_text")
        or attachment.get("source_url")
        or ""
    ).strip()
    role = str(attachment.get("resource_role") or "").strip().lower()
    if (
        role == "inline_image"
        or mime_type.startswith("image/")
        or _has_suffix(filename, _IMAGE_SUFFIXES)
    ):
        return "image"
    if mime_type == "application/pdf" or _has_suffix(filename, _PDF_SUFFIXES):
        return "pdf"
    if _is_office_like(mime_type=mime_type, filename=filename):
        return "office"
    if "zip" in mime_type or _has_suffix(filename, _ARCHIVE_SUFFIXES):
        return "archive"
    return "unknown"


def _candidate_reason_codes(media_kind: str) -> list[str]:
    if media_kind == "image":
        return ["image_attachment_pending_text_extraction"]
    if media_kind == "pdf":
        return ["pdf_attachment_pending_text_extraction"]
    if media_kind == "office":
        return ["office_attachment_pending_text_extraction"]
    if media_kind == "archive":
        return ["archive_attachment_pending_text_extraction"]
    return ["unknown_attachment_pending_text_extraction"]


def _media_ref_id(attachment: Mapping[str, Any], *, image_index: int) -> str:
    for key in ("attachment_ref_id", "media_ref_id"):
        value = _optional_text(attachment.get(key))
        if value:
            return value
    return f"attachment-{image_index:04d}"


def _candidate_id(
    *,
    unit_id: str,
    media_ref_id: str,
    source_object_key: str,
    processing_family: str,
) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {
                "unit_id": unit_id,
                "media_ref_id": media_ref_id,
                "source_object_key": source_object_key,
                "processing_family": processing_family,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"notice-mm:{digest}"


def _target_hints(unit: Mapping[str, Any]) -> list[str]:
    hints = unit.get("target_hints")
    if not isinstance(hints, Mapping):
        return []
    raw_targets = hints.get("candidate_targets")
    if not isinstance(raw_targets, Sequence) or isinstance(raw_targets, str):
        return []
    return list(dict.fromkeys(str(item).strip() for item in raw_targets if str(item).strip()))


def _reason_codes(unit: Mapping[str, Any]) -> list[str]:
    raw = unit.get("reason_codes")
    if not isinstance(raw, Sequence) or isinstance(raw, str):
        return []
    return [str(item).strip() for item in raw if str(item).strip()]


def _source_bucket_from_unit(unit: Mapping[str, Any]) -> str:
    refs = unit.get("source_object_refs")
    if isinstance(refs, Sequence) and not isinstance(refs, str):
        for ref in refs:
            if isinstance(ref, Mapping):
                bucket = _optional_text(ref.get("bucket"))
                if bucket:
                    return bucket
    return "campus-rag-source"


def _output_base_prefix(
    *,
    object_key: str,
    source_surface: str,
    site_id: str,
    source_notice_id: str,
    candidate_id: str,
) -> str:
    if object_key:
        marker = "/capture/"
        if marker in object_key:
            return object_key.split(marker, maxsplit=1)[0]
        return object_key.rsplit("/", maxsplit=1)[0]
    safe_candidate = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", candidate_id)
    return (
        "notice_multimodal/source-repair/"
        f"{source_surface}/{site_id}/{source_notice_id}/{safe_candidate}"
    )


def _policy_text(unit: Mapping[str, Any], attachment: Mapping[str, Any]) -> str:
    return "\n".join(
        str(value or "")
        for value in (
            unit.get("title"),
            unit.get("body_text"),
            unit.get("search_text"),
            attachment.get("anchor_text"),
            attachment.get("original_filename"),
        )
    )


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _has_suffix(value: str, suffixes: Sequence[str]) -> bool:
    normalized = value.lower()
    return any(normalized.endswith(suffix) for suffix in suffixes)


def _is_office_like(*, mime_type: str, filename: str) -> bool:
    if _has_suffix(filename, _OFFICE_SUFFIXES):
        return True
    return any(
        token in mime_type
        for token in (
            "msword",
            "officedocument",
            "ms-excel",
            "ms-powerpoint",
            "spreadsheet",
            "presentation",
            "wordprocessing",
        )
    )


__all__ = [
    "candidate_records",
    "selected_units",
]
