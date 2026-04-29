from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
    classify_authenticated_notice_bundle_record,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_models import (
    AuthenticatedNoticeRoutingObjectStore,
    AuthenticatedNoticeRoutingSample,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_policy import (
    resolve_authenticated_notice_routing_decision,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)


def sample_authenticated_notice_routing_from_bundle_record(
    record: Mapping[str, Any],
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None = None,
) -> AuthenticatedNoticeRoutingSample:
    notice = dict(record.get("notice") or {})
    classification = classify_authenticated_notice_bundle_record(dict(record), config=config)
    notice_title = str(notice.get("notice_title") or "").strip()
    notice_type_names = tuple(
        dict.fromkeys(
            str(item.get("notice_type_name") or "").strip()
            for item in list(notice.get("categories") or ())
            if isinstance(item, Mapping) and str(item.get("notice_type_name") or "").strip()
        )
    )
    attachment_counts = _resolve_attachment_counts(record, inventory_entry)
    decision = resolve_authenticated_notice_routing_decision(
        config=config,
        family=classification.family,
        admission_policy=classification.admission_policy,
        title=notice_title,
        body=str(notice.get("notice_content") or ""),
        attachment_counts=attachment_counts,
    )
    suggested_consumption_route = decision.suggested_consumption_route
    machine_processing_policy = decision.machine_processing_policy
    return AuthenticatedNoticeRoutingSample(
        notice_id=str(record.get("notice_id") or notice.get("notice_id") or "").strip(),
        notice_title=notice_title,
        notice_type_names=notice_type_names,
        notice_family=classification.family,
        admission_policy=classification.admission_policy,
        priority=classification.priority,
        suggested_consumption_route=suggested_consumption_route,
        machine_processing_policy=machine_processing_policy,
        attachment_processing_policy=decision.attachment_processing_policy,
        attachment_processing_reason=decision.attachment_processing_reason,
        matched_title_patterns=classification.matched_title_patterns,
        matched_body_patterns=classification.matched_body_patterns,
        attachment_ref_count=attachment_counts["attachment_ref_count"],
        attachment_document_count=attachment_counts["attachment_document_count"],
        text_extractable_count=attachment_counts["text_extractable_count"],
        ocr_required_count=attachment_counts["ocr_required_count"],
        reference_only_count=attachment_counts["reference_only_count"],
        multimodal_processing_required_count=attachment_counts[
            "multimodal_processing_required_count"
        ],
    )


def sample_authenticated_notice_routing_from_inventory_entry(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    object_store: AuthenticatedNoticeRoutingObjectStore | None,
    source_bucket: str,
) -> AuthenticatedNoticeRoutingSample:
    body_text = _resolve_inventory_body_text(
        entry,
        object_store=object_store,
        source_bucket=source_bucket,
    )
    return sample_authenticated_notice_routing_from_bundle_record(
        _bundle_record_from_inventory_entry(entry, notice_content=body_text),
        config=config,
        inventory_entry=entry,
    )


def _bundle_record_from_inventory_entry(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    notice_content: str = "",
) -> dict[str, Any]:
    parent_snapshot = dict(entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or entry.document_id)
    notice_type_names = tuple(
        str(item).strip()
        for item in parent_snapshot.get("notice_type_names") or ()
        if str(item).strip()
    )
    categories = tuple({"notice_type": "", "notice_type_name": name} for name in notice_type_names)
    return {
        "notice_id": entry.notice_id,
        "notice": {
            "notice_id": entry.notice_id,
            "notice_title": notice_title,
            "notice_content": notice_content or str(parent_snapshot.get("notice_content") or ""),
            "notice_release_time": parent_snapshot.get("notice_release_time"),
            "categories": categories,
        },
        "notice_attachments": list(parent_snapshot.get("attachment_projection_plans") or ()),
        "attachments": [],
    }


def _resolve_inventory_body_text(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    object_store: AuthenticatedNoticeRoutingObjectStore | None,
    source_bucket: str,
) -> str:
    parent_snapshot = dict(entry.parent_snapshot or {})
    existing = str(parent_snapshot.get("notice_content") or "").strip()
    if existing:
        return existing
    if object_store is None:
        return ""
    normalized_bucket = str(source_bucket or "").strip()
    if not normalized_bucket:
        raise ValueError("source_bucket is required when loading notice content blocks")
    content_blocks_key = str(
        entry.content_blocks_key or parent_snapshot.get("content_blocks_key") or ""
    )
    if not content_blocks_key.strip():
        return ""
    try:
        payload = object_store.get_bytes(bucket=normalized_bucket, key=content_blocks_key.strip())
    except Exception:
        return ""
    return _extract_content_blocks_text(payload)


def _extract_content_blocks_text(payload: bytes) -> str:
    texts: list[str] = []
    for raw_line in payload.decode("utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        block = json.loads(line)
        text = (
            str(block.get("text_normalized") or "").strip()
            or str(block.get("text_raw") or "").strip()
            or str(block.get("link_text") or "").strip()
        )
        if text:
            texts.append(text)
    return "\n".join(texts)


def _resolve_attachment_counts(
    record: Mapping[str, Any],
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> dict[str, int]:
    if inventory_entry is not None:
        return {
            "attachment_ref_count": int(inventory_entry.attachment_ref_count or 0),
            "attachment_document_count": int(inventory_entry.attachment_document_count or 0),
            "text_extractable_count": int(inventory_entry.text_extractable_count or 0),
            "ocr_required_count": int(inventory_entry.ocr_required_count or 0),
            "reference_only_count": int(inventory_entry.reference_only_count or 0),
            "multimodal_processing_required_count": int(
                inventory_entry.multimodal_processing_required_count or 0
            ),
        }
    attachments = tuple(record.get("notice_attachments") or record.get("attachments") or ())
    return {
        "attachment_ref_count": len(attachments),
        "attachment_document_count": 0,
        "text_extractable_count": 0,
        "ocr_required_count": 0,
        "reference_only_count": 0,
        "multimodal_processing_required_count": 0,
    }


__all__ = [
    "sample_authenticated_notice_routing_from_bundle_record",
    "sample_authenticated_notice_routing_from_inventory_entry",
]
