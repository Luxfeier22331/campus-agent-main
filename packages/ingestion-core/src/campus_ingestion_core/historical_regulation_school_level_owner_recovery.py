from __future__ import annotations

import html
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_candidate_store_noop_assertion,
    build_serving_closed_assertion,
)

HISTORICAL_REGULATION_SCHOOL_LEVEL_OWNER_RECOVERY_SCHEMA_VERSION = (
    "historical_regulation_school_level_owner_recovery.v1"
)

OWNER_SOURCE_CANDIDATE_FOUND = "owner_source_candidate_found"
BLOCKED_NO_OWNER_SOURCE = "blocked_no_owner_source"
BLOCKED_INCOMPLETE_OWNER_TEXT = "blocked_incomplete_owner_text"

_RECOVERY_STATUSES = {
    "wrapper_needs_owner_text_recovery",
    "wrapper_summary_backlog",
}
_SOURCE_KEYS = ("links", "notice_attachments", "attachments")
_INCOMPLETE_OWNER_TEXT_REASON_CODES = {
    "body_text_not_complete_owner_policy",
}
_OWNER_TEXT_ARTICLE_RE = re.compile(r"第[一二三四五六七八九十百千万0-9]+条")
_SUMMARY_MARKERS = ("特此通知", "请遵照执行", "请认真执行", "请各单位", "附件：")


def build_historical_regulation_school_level_owner_recovery_audit(
    *,
    school_level_inventory: Mapping[str, Any],
    collected_bundle: object,
    generated_at: str | None = None,
    generated_by: str = ("campus_ingestion_core.historical_regulation_school_level_owner_recovery"),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    bundle_by_notice_id = _bundle_by_notice_id(collected_bundle)
    target_records = [
        dict(record)
        for record in _mapping_rows(school_level_inventory.get("records"))
        if _is_school_level_recovery_target(record)
    ]
    records = [
        _build_record(
            inventory_record=record,
            bundle_record=bundle_by_notice_id.get(str(record.get("source_notice_id") or "")),
        )
        for record in target_records
    ]
    source_candidate_records = [
        record for record in records if record["status"] == OWNER_SOURCE_CANDIDATE_FOUND
    ]
    blocked_records = [
        record
        for record in records
        if record["status"] in {BLOCKED_NO_OWNER_SOURCE, BLOCKED_INCOMPLETE_OWNER_TEXT}
    ]
    status_counts = Counter(str(record["status"]) for record in records)
    return {
        "schema_version": HISTORICAL_REGULATION_SCHOOL_LEVEL_OWNER_RECOVERY_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "offline_owner_text_source_readiness_audit",
        "write_enabled": False,
        "scope": "school_level_regulation_owner_text_recovery",
        "target_notice_ids": _notice_ids(records),
        "source_candidate_notice_ids": _notice_ids(source_candidate_records),
        "blocked_notice_ids": _notice_ids(blocked_records),
        "canonical_chunk_ready_notice_ids": [],
        "source_candidate_count": len(source_candidate_records),
        "blocked_count": len(blocked_records),
        "status_counts": dict(sorted(status_counts.items())),
        "records": records,
        "policy": {
            "scope_baseline": "school_level_regulation_owner_text_recovery_only",
            "required_target_collection": "institutional_rules",
            "stop_point": "owner_text_source_readiness_only",
            "canonical_chunk_admission": (
                "requires separate owner text extraction and quality validation"
            ),
            "disallowed_downstream_steps": [
                "canonical_materialization_from_wrapper_notice",
                "document_units_from_wrapper_notice",
                "rag_release_candidate_enqueue",
                "embedding",
                "index_release",
                "alias_publish",
            ],
        },
        "serving_closed_assertion": build_serving_closed_assertion(generated_at=timestamp),
        "candidate_store_noop_assertion": _candidate_store_noop_assertion(generated_at=timestamp),
    }


def _build_record(
    *,
    inventory_record: Mapping[str, Any],
    bundle_record: Mapping[str, Any] | None,
) -> dict[str, Any]:
    notice_id = _required_text(inventory_record.get("source_notice_id"), "source_notice_id")
    bundle_record = bundle_record or {}
    source_refs = _owner_source_refs(bundle_record)
    body_text = _body_text(bundle_record)
    original_reason_codes = [
        str(value) for value in inventory_record.get("reason_codes") or () if str(value).strip()
    ]
    status, reason_codes = _classify_recovery_record(
        original_reason_codes=original_reason_codes,
        source_refs=source_refs,
        body_text=body_text,
    )
    return {
        "source_notice_id": notice_id,
        "title": str(inventory_record.get("title") or ""),
        "effective_regulation_title": str(inventory_record.get("effective_regulation_title") or ""),
        "target_collection": str(inventory_record.get("target_collection") or ""),
        "target_surface": str(inventory_record.get("target_surface") or ""),
        "target_document_id": str(inventory_record.get("target_document_id") or ""),
        "object_storage_prefix": str(inventory_record.get("object_storage_prefix") or ""),
        "inventory_status": str(inventory_record.get("status") or ""),
        "status": status,
        "reason_codes": reason_codes,
        "inventory_reason_codes": original_reason_codes,
        "owner_source_candidate_count": len(source_refs),
        "owner_source_refs": source_refs,
        "body_text_length": len(body_text),
        "body_has_article_structure": bool(_OWNER_TEXT_ARTICLE_RE.search(body_text)),
        "document_site_eligible": False,
        "rag_consumption_eligible": False,
        "downstream_consumption_status": "not_ready_for_downstream_consumption",
        "query_serving_opened": False,
        "rag_release_opened": False,
        "embedding_opened": False,
        "index_release_opened": False,
        "alias_publish_opened": False,
    }


def _classify_recovery_record(
    *,
    original_reason_codes: Sequence[str],
    source_refs: Sequence[Mapping[str, str]],
    body_text: str,
) -> tuple[str, list[str]]:
    if any(reason in _INCOMPLETE_OWNER_TEXT_REASON_CODES for reason in original_reason_codes):
        return BLOCKED_INCOMPLETE_OWNER_TEXT, [
            *original_reason_codes,
            "requires_complete_owner_policy_source",
        ]
    if source_refs:
        return OWNER_SOURCE_CANDIDATE_FOUND, [
            "owner_source_candidate_found",
            "requires_owner_text_extraction_quality_gate",
        ]
    return BLOCKED_NO_OWNER_SOURCE, [
        *original_reason_codes,
        "no_captured_attachment_or_link",
        *_summary_reason_codes(body_text),
    ]


def _summary_reason_codes(body_text: str) -> list[str]:
    if any(marker in body_text for marker in _SUMMARY_MARKERS):
        return ["notice_body_is_wrapper_or_summary"]
    return ["owner_text_source_not_found"]


def _is_school_level_recovery_target(record: Mapping[str, Any]) -> bool:
    return (
        str(record.get("target_collection") or "") == "institutional_rules"
        and str(record.get("status") or "") in _RECOVERY_STATUSES
    )


def _owner_source_refs(bundle_record: Mapping[str, Any]) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    for key in _SOURCE_KEYS:
        for index, item in enumerate(_mapping_rows(bundle_record.get(key))):
            ref = _source_ref(source_kind=key, index=index, item=item)
            if ref:
                refs.append(ref)
    return refs


def _source_ref(*, source_kind: str, index: int, item: Mapping[str, Any]) -> dict[str, str] | None:
    href = str(
        item.get("href")
        or item.get("url")
        or item.get("download_url")
        or item.get("file_url")
        or item.get("source_url")
        or ""
    ).strip()
    name = str(
        item.get("name")
        or item.get("title")
        or item.get("text")
        or item.get("filename")
        or item.get("file_name")
        or ""
    ).strip()
    if not href and not name:
        return None
    return {
        "source_kind": source_kind,
        "source_index": str(index),
        "href": href,
        "name": name,
    }


def _bundle_by_notice_id(payload: object) -> dict[str, Mapping[str, Any]]:
    return {
        str(row.get("notice_id") or _notice_id_from_nested_notice(row) or "").strip(): row
        for row in _bundle_rows(payload)
        if str(row.get("notice_id") or _notice_id_from_nested_notice(row) or "").strip()
    }


def _notice_id_from_nested_notice(row: Mapping[str, Any]) -> object:
    notice = row.get("notice")
    if not isinstance(notice, Mapping):
        return ""
    return notice.get("notice_id")


def _body_text(bundle_record: Mapping[str, Any]) -> str:
    notice = bundle_record.get("notice") if isinstance(bundle_record.get("notice"), Mapping) else {}
    return _html_to_text(
        str(notice.get("notice_content") or bundle_record.get("notice_content") or "")
    )


def _html_to_text(value: str) -> str:
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", value)
    text = re.sub(r"(?i)</\s*p\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).replace("\xa0", " ")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _bundle_rows(payload: object) -> tuple[Mapping[str, Any], ...]:
    rows: object
    if isinstance(payload, Mapping):
        rows = payload.get("notices") or payload.get("records") or payload.get("items") or ()
    else:
        rows = payload
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        return ()
    return tuple(row for row in rows if isinstance(row, Mapping))


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(row for row in value if isinstance(row, Mapping))


def _notice_ids(records: Sequence[Mapping[str, Any]]) -> list[str]:
    return [str(record["source_notice_id"]) for record in records]


def _candidate_store_noop_assertion(*, generated_at: str) -> dict[str, Any]:
    assertion = build_candidate_store_noop_assertion(generated_at=generated_at)
    assertion["candidate_enqueue_opened"] = False
    assertion["rag_release_candidate_rows_created"] = 0
    return assertion


def _required_text(value: object, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{label} is required")
    return text


__all__ = [
    "BLOCKED_INCOMPLETE_OWNER_TEXT",
    "BLOCKED_NO_OWNER_SOURCE",
    "HISTORICAL_REGULATION_SCHOOL_LEVEL_OWNER_RECOVERY_SCHEMA_VERSION",
    "OWNER_SOURCE_CANDIDATE_FOUND",
    "build_historical_regulation_school_level_owner_recovery_audit",
]
