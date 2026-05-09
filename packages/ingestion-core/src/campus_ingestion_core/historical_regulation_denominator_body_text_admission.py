from __future__ import annotations

import hashlib
import html
import json
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_regulation_admission_support import (
    INSTITUTIONAL_TARGET_COLLECTION,
    REGULATION_CLASS_INSTITUTIONAL,
    REGULATION_CLASS_SCOPED,
    REGULATION_TARGET,
    SCOPED_TARGET_COLLECTION,
    _candidate_key,
    _target_identity_preview,
)
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_candidate_store_noop_assertion,
    build_serving_closed_assertion,
)
from campus_ingestion_core.historical_regulation_denominator_expansion import (
    READY_FOR_CANONICAL_CHUNK_V9,
)
from campus_ingestion_core.object_store import build_source_truth_artifact_key
from campus_ingestion_core.settings import DEFAULT_BUCKET_SOURCE

HISTORICAL_REGULATION_BODY_TEXT_ADMISSION_SCHEMA_VERSION = (
    "historical_regulation_body_text_admission.v1"
)

DEFAULT_HISTORICAL_REGULATION_DENOMINATOR_PHASE = "historical-regulation-denominator-expansion"
DEFAULT_SOURCE_CHANNEL = "authenticated_notice_portal"
DEFAULT_RUN_ID = "run14-policy-regulation-expanded"
TARGET_CLASS_BY_COLLECTION = {
    INSTITUTIONAL_TARGET_COLLECTION: REGULATION_CLASS_INSTITUTIONAL,
    SCOPED_TARGET_COLLECTION: REGULATION_CLASS_SCOPED,
}

_HTML_BREAK_RE = re.compile(
    r"</(?:p|div|section|article|li|tr|h[1-6]|br|table|tbody|thead)>",
    re.IGNORECASE,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINE_RE = re.compile(r"\n{3,}")
_YEAR_RE = re.compile(r"(?:19|20)\d{2}")
_ANNUAL_CYCLE_MARKERS = (
    "硕博连读",
    "英才计划",
    "推荐",
    "免试攻读",
    "推免",
    "招生实施细则",
)
_TIME_BOUND_MARKERS = ("暑假期间", "寒假期间", "暂行", "试行", "过渡期")
_SCHOOL_UNIT_SUFFIXES = (
    "学院",
    "学部",
    "研究院",
    "中心",
    "处",
    "部",
    "办公室",
)


class HistoricalRegulationBodyTextObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


def build_historical_regulation_body_text_owner_admission(
    *,
    ready_candidates: Mapping[str, Any],
    normalized_notice_bundle: Sequence[Mapping[str, Any]] | Mapping[str, Any],
    object_store: HistoricalRegulationBodyTextObjectStore,
    bucket_source: str = DEFAULT_BUCKET_SOURCE,
    run_id: str = DEFAULT_RUN_ID,
    source_channel: str = DEFAULT_SOURCE_CHANNEL,
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_core.historical_regulation_denominator_body_text_admission"
    ),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    bundle_by_notice = _index_normalized_notice_bundle(normalized_notice_bundle)
    ready_rows = [
        dict(row)
        for row in _mapping_rows(ready_candidates.get("records"))
        if str(row.get("status") or "") == READY_FOR_CANONICAL_CHUNK_V9
    ]
    entries = [
        _build_admission_entry(
            candidate=row,
            normalized_notice=bundle_by_notice.get(
                _required_text(row.get("source_notice_id"), "source_notice_id")
            ),
            object_store=object_store,
            bucket_source=bucket_source,
            run_id=run_id,
            source_channel=source_channel,
            generated_at=timestamp,
        )
        for row in ready_rows
    ]
    class_counts = Counter(str(entry["regulation_admission_class"]) for entry in entries)
    collection_counts = Counter(str(entry["target_collection"]) for entry in entries)
    admission_manifest = {
        "schema_version": "collected_notice_consumer_admission.v1",
        "batch_id": f"{run_id}-body-text-owner-admission",
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "offline_body_text_owner_admission",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": DEFAULT_HISTORICAL_REGULATION_DENOMINATOR_PHASE,
        "target": REGULATION_TARGET,
        "source_scope": {
            "source_channel": source_channel,
            "source_notice_ids": [str(entry["source_notice_id"]) for entry in entries],
            "target": REGULATION_TARGET,
            "historical_denominator_expansion": True,
        },
        "baseline": "historical_collected_notice_body_text_owner",
        "selection_policy": {
            "name": "historical-regulation-denominator-body-text-owner-admission",
            "version": "v1",
            "ready_status": READY_FOR_CANONICAL_CHUNK_V9,
            "required_owner_text_status": "ready",
            "release_lane_opened": False,
        },
        "entries": entries,
        "counts": {
            "entry_count": len(entries),
            "downstream_admitted": len(entries),
            "search_only": 0,
            "defer": 0,
            "needs_multimodal": 0,
            "invalid_capture": 0,
            "by_regulation_admission_class": dict(sorted(class_counts.items())),
            "by_target_collection": dict(sorted(collection_counts.items())),
        },
    }
    candidate_audit = {
        "schema_version": "collected_notice_regulation_candidate_audit.v1",
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "offline_body_text_owner_admission",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": DEFAULT_HISTORICAL_REGULATION_DENOMINATOR_PHASE,
        "target": REGULATION_TARGET,
        "candidate_count": len(entries),
        "class_counts": dict(sorted(class_counts.items())),
        "candidates": [_candidate_row(entry) for entry in entries],
    }
    selected_notice_ids = [str(entry["source_notice_id"]) for entry in entries]
    return {
        "schema_version": HISTORICAL_REGULATION_BODY_TEXT_ADMISSION_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "offline_body_text_owner_admission",
        "write_enabled": False,
        "target": REGULATION_TARGET,
        "selected_notice_ids": selected_notice_ids,
        "selected_count": len(selected_notice_ids),
        "admission_manifest": admission_manifest,
        "candidate_audit": candidate_audit,
        "serving_closed_assertion": build_serving_closed_assertion(generated_at=timestamp),
        "candidate_store_noop_assertion": build_candidate_store_noop_assertion(
            generated_at=timestamp
        ),
    }


def _build_admission_entry(
    *,
    candidate: Mapping[str, Any],
    normalized_notice: Mapping[str, Any] | None,
    object_store: HistoricalRegulationBodyTextObjectStore,
    bucket_source: str,
    run_id: str,
    source_channel: str,
    generated_at: str,
) -> dict[str, Any]:
    source_notice_id = _required_text(candidate.get("source_notice_id"), "source_notice_id")
    if normalized_notice is None:
        raise ValueError(f"normalized notice {source_notice_id} is missing")
    notice = normalized_notice.get("notice")
    if not isinstance(notice, Mapping):
        notice = normalized_notice
    title = _required_text(
        candidate.get("title") or notice.get("notice_title"),
        "title",
    )
    target_collection = _required_target_collection(candidate.get("target_collection"))
    owner_text = _html_to_text(notice.get("notice_content"))
    if not owner_text:
        raise ValueError(f"notice {source_notice_id} owner text body is empty")
    organization_name = str(notice.get("organization_name") or "").strip()
    source_notice_release_time = _required_text(
        notice.get("notice_release_time") or candidate.get("source_notice_release_time"),
        "source_notice_release_time",
    )
    release_year = _year_from_text(source_notice_release_time) or _year_from_text(title)
    source_ref = _write_owner_text_source_truth(
        source_notice_id=source_notice_id,
        title=title,
        owner_text=owner_text,
        organization_name=organization_name,
        source_notice_release_time=source_notice_release_time,
        normalized_notice=normalized_notice,
        object_store=object_store,
        bucket_source=bucket_source,
        source_channel=source_channel,
        run_id=run_id,
        year=release_year,
        generated_at=generated_at,
    )
    issuing_org = organization_name or "中央民族大学"
    regulation_class = TARGET_CLASS_BY_COLLECTION[target_collection]
    target_identity = _target_identity_preview(
        regulation_title=title,
        issuing_org=issuing_org,
        target_collection=target_collection,
    )
    candidate_key = _candidate_key(
        regulation_title=title,
        issuing_org=issuing_org,
        target_collection=target_collection,
    )
    document_nature = _document_nature(title=title, owner_text=owner_text)
    cycle_year = _year_from_text(title) or release_year
    school_unit_name = _school_unit_name(
        title=title,
        organization_name=organization_name,
        document_nature=document_nature,
    )
    return {
        "entry_id": f"notice:muc_internal_portal:{source_notice_id}",
        "source_channel": source_channel,
        "source_surface": "notice_body",
        "source_corpus": "campus_notices",
        "source_collection": "internal_notice",
        "site_id": "muc_internal_portal",
        "source_notice_id": source_notice_id,
        "source_document_id": f"notice:muc_internal_portal:{source_notice_id}",
        "title": title,
        "published_at": source_notice_release_time,
        "source_notice_release_time": source_notice_release_time,
        "body_excerpt": _preview_text(owner_text, limit=240),
        "source_url": str(notice.get("notice_link") or "")
        or f"campusrag://collected-notice/{source_notice_id}",
        "run_id": run_id,
        "source_object_refs": [
            {**source_ref, "role": "searchable_merge_input"},
        ],
        "consumption_class": "downstream_admitted",
        "regulation_admission_class": regulation_class,
        "target": REGULATION_TARGET,
        "target_surface": f"regulations/{target_collection}",
        "target_collection": target_collection,
        "target_identity_preview": target_identity,
        "candidate_key": candidate_key,
        "regulation_title_normalized": title,
        "issuing_org": issuing_org,
        "document_nature": document_nature,
        "cycle_year": cycle_year,
        "school_unit_name": school_unit_name,
        "applicability_status": "historical_stock",
        "promotion_disposition": "historical_denominator_chunk_only",
        "recommended_query_surface": "",
        "target_hints": {
            "document_nature": document_nature,
            "cycle_year": cycle_year,
            "school_unit_name": school_unit_name,
        },
        "multimodal_policy": "not_required",
        "owner_text_status": "ready",
        "owner_text_recovery": {
            "source": "historical_normalized_notice_body_text",
            "written_refs": {"searchable_merge_input": source_ref},
            "owner_text_length": len(owner_text),
            "owner_text_sha256": hashlib.sha256(owner_text.encode("utf-8")).hexdigest(),
        },
        "fact_readiness_state": "ready",
        "target_admission_state": "downstream_admitted",
        "fact_readiness": {
            "fact_readiness_state": "ready",
            "target_admission_state": "downstream_admitted",
            "source_admission_class": regulation_class,
        },
        "reason_codes": [
            "historical_denominator_body_text_owner_admitted",
            "owner_text_normalized_from_ingest_body",
            "serving_closed",
        ],
        "preconditions": [
            "normalized_notice_body_present",
            "owner_text_ready",
            "historical_denominator_expansion",
            "canonical_materialization_required",
            "chunk_only_backfill",
        ],
        "searchable_unit_id": f"searchable:notice_body:muc_internal_portal:{source_notice_id}",
    }


def _write_owner_text_source_truth(
    *,
    source_notice_id: str,
    title: str,
    owner_text: str,
    organization_name: str,
    source_notice_release_time: str,
    normalized_notice: Mapping[str, Any],
    object_store: HistoricalRegulationBodyTextObjectStore,
    bucket_source: str,
    source_channel: str,
    run_id: str,
    year: str | None,
    generated_at: str,
) -> dict[str, str]:
    raw_asset_id = f"notice-{source_notice_id}"
    raw_version_id = f"{run_id}:notice-{source_notice_id}"
    key = build_source_truth_artifact_key(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename="searchable-merge-input.json",
        source_channel=source_channel,
        year=year,
    )
    payload = {
        "schema_version": "authenticated_notice_body_text_owner_source_truth.v1",
        "generated_at": generated_at,
        "source_channel": source_channel,
        "source_notice_id": source_notice_id,
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "title": title,
        "organization_name": organization_name,
        "source_notice_release_time": source_notice_release_time,
        "owner_text_ready": True,
        "owner_text": owner_text,
        "owner_text_sha256": hashlib.sha256(owner_text.encode("utf-8")).hexdigest(),
        "source_payload_notice_id": str(normalized_notice.get("notice_id") or source_notice_id),
        "cleaning_stage": "ingestion_body_text_owner_admission",
    }
    object_store.put_bytes(
        bucket=bucket_source,
        key=key,
        data=(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
            "utf-8"
        ),
        content_type="application/json; charset=utf-8",
    )
    return {
        "bucket": bucket_source,
        "key": key,
        "content_type": "application/json; charset=utf-8",
    }


def _candidate_row(entry: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "source_notice_id": entry.get("source_notice_id"),
        "source_surface": entry.get("source_surface"),
        "source_document_id": entry.get("source_document_id"),
        "searchable_unit_id": entry.get("searchable_unit_id"),
        "title": entry.get("title"),
        "regulation_title_normalized": entry.get("regulation_title_normalized"),
        "issuing_org": entry.get("issuing_org"),
        "candidate_key": entry.get("candidate_key"),
        "regulation_admission_class": entry.get("regulation_admission_class"),
        "consumption_class": entry.get("consumption_class"),
        "target_collection": entry.get("target_collection"),
        "target_identity_preview": entry.get("target_identity_preview"),
        "document_nature": entry.get("document_nature"),
        "cycle_year": entry.get("cycle_year"),
        "school_unit_name": entry.get("school_unit_name"),
        "applicability_status": entry.get("applicability_status"),
        "promotion_disposition": entry.get("promotion_disposition"),
        "source_notice_release_time": entry.get("source_notice_release_time"),
        "recommended_query_surface": entry.get("recommended_query_surface"),
        "reason_codes": list(entry.get("reason_codes") or ()),
        "owner_text_status": entry.get("owner_text_status"),
        "owner_text_recovery": entry.get("owner_text_recovery") or {},
        "target_hints": entry.get("target_hints") or {},
    }


def _index_normalized_notice_bundle(
    payload: Sequence[Mapping[str, Any]] | Mapping[str, Any],
) -> dict[str, Mapping[str, Any]]:
    if isinstance(payload, Mapping):
        raw_rows = payload.get("notices") or payload.get("records") or ()
    else:
        raw_rows = payload
    return {
        _normalized_notice_id(row): row
        for row in raw_rows
        if isinstance(row, Mapping) and _normalized_notice_id(row)
    }


def _normalized_notice_id(row: Mapping[str, Any]) -> str:
    for value in (
        row.get("notice_id"),
        row.get("source_notice_id"),
        row.get("id"),
    ):
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    notice = row.get("notice")
    if isinstance(notice, Mapping):
        normalized = str(notice.get("notice_id") or "").strip()
        if normalized:
            return normalized
    return ""


def _html_to_text(value: object) -> str:
    text = str(value or "")
    if not text.strip():
        return ""
    text = _HTML_BREAK_RE.sub("\n", text)
    text = _HTML_TAG_RE.sub("", text)
    text = html.unescape(text)
    text = "\n".join(_WHITESPACE_RE.sub(" ", line).strip() for line in text.splitlines())
    text = _BLANK_LINE_RE.sub("\n\n", text)
    return text.strip()


def _document_nature(*, title: str, owner_text: str) -> str:
    combined = f"{title}\n{owner_text}"
    if any(marker in combined for marker in _ANNUAL_CYCLE_MARKERS):
        return "annual_cycle_rule"
    if any(marker in combined for marker in _TIME_BOUND_MARKERS):
        return "time_bound_operational_rule"
    return "time_bound_operational_rule"


def _school_unit_name(
    *,
    title: str,
    organization_name: str,
    document_nature: str,
) -> str | None:
    if document_nature != "annual_cycle_rule":
        return organization_name or None
    for value in (organization_name, title):
        unit = _extract_school_unit_name(value)
        if unit:
            return unit
    return None


def _extract_school_unit_name(value: str) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    for suffix in _SCHOOL_UNIT_SUFFIXES:
        if normalized.endswith(suffix) and len(normalized) <= 40:
            return normalized
    match = re.search(r"中央民族大学(?P<unit>[^ 　，,。；;：:]{2,30}?学院)", normalized)
    if match is not None:
        return match.group("unit").strip()
    match = re.search(r"(?P<unit>[^ 　，,。；;：:]{2,30}?学院)", normalized)
    if match is not None:
        return match.group("unit").strip()
    return None


def _year_from_text(value: object) -> str | None:
    match = _YEAR_RE.search(str(value or ""))
    return match.group(0) if match is not None else None


def _preview_text(text: str, *, limit: int) -> str:
    stripped = text.strip()
    if len(stripped) <= limit:
        return stripped
    return stripped[: limit - 1].rstrip() + "…"


def _required_target_collection(value: object) -> str:
    normalized = str(value or "").strip()
    if normalized not in TARGET_CLASS_BY_COLLECTION:
        raise ValueError(f"unsupported target_collection: {normalized or '<missing>'}")
    return normalized


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


__all__ = [
    "DEFAULT_HISTORICAL_REGULATION_DENOMINATOR_PHASE",
    "HISTORICAL_REGULATION_BODY_TEXT_ADMISSION_SCHEMA_VERSION",
    "build_historical_regulation_body_text_owner_admission",
]
