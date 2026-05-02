from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_regulation_admission_support import (
    INSTITUTIONAL_TARGET_COLLECTION,
    REGULATION_CLASS_HISTORICAL_ANNUAL_CYCLE_HOLD,
    REGULATION_CLASS_HISTORICAL_TIME_WINDOW_HOLD,
    REGULATION_CLASS_INSTITUTIONAL,
    REGULATION_CLASS_MANUAL_REVIEW,
    REGULATION_CLASS_SCOPED,
    REGULATION_TARGET,
    SCOPED_TARGET_COLLECTION,
    _candidate_key,
    _target_identity_preview,
)
from campus_ingestion_core.historical_regulation_chunk_backfill import (
    build_serving_closed_assertion,
)

HISTORICAL_OFFLINE_ADMISSION_SCHEMA_VERSION = (
    "collected_notice_regulation_historical_offline_admission.v1"
)
PHASE_08_OFFLINE_ID = "phase-08-regulation-admission-rerun-after-owner-text"
TARGET_COLLECTIONS = (INSTITUTIONAL_TARGET_COLLECTION, SCOPED_TARGET_COLLECTION)
TARGET_CLASS_BY_COLLECTION = {
    INSTITUTIONAL_TARGET_COLLECTION: REGULATION_CLASS_INSTITUTIONAL,
    SCOPED_TARGET_COLLECTION: REGULATION_CLASS_SCOPED,
}
CONVERTIBLE_CLASSES = {
    REGULATION_CLASS_HISTORICAL_ANNUAL_CYCLE_HOLD,
    REGULATION_CLASS_HISTORICAL_TIME_WINDOW_HOLD,
    REGULATION_CLASS_MANUAL_REVIEW,
}


def build_historical_offline_regulation_admission(
    *,
    admission_manifest: Mapping[str, Any],
    candidate_audit: Mapping[str, Any],
    target_collection_overrides: Mapping[str, str] | None = None,
    selected_notice_ids: Sequence[str] | None = None,
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_core.collected_notice_regulation_historical_offline_admission"
    ),
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    overrides = _normalize_collection_overrides(target_collection_overrides or {})
    selected_ids = _selected_notice_ids(
        admission_manifest=admission_manifest,
        selected_notice_ids=selected_notice_ids,
        target_collection_overrides=overrides,
    )
    candidate_collection_by_notice = _candidate_collection_by_notice(candidate_audit)
    entries = [
        _offline_entry(
            entry=entry,
            candidate_collection_by_notice=candidate_collection_by_notice,
            overrides=overrides,
        )
        for entry in _mapping_rows(admission_manifest.get("entries"))
        if str(entry.get("source_notice_id") or "").strip() in selected_ids
    ]
    class_counts = Counter(str(entry["regulation_admission_class"]) for entry in entries)
    collection_counts = Counter(str(entry["target_collection"]) for entry in entries)
    converted_original_classes = Counter(
        str(entry["historical_offline_admission"]["source_regulation_admission_class"])
        for entry in entries
    )
    resolution_report = {
        "schema_version": HISTORICAL_OFFLINE_ADMISSION_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "phase": PHASE_08_OFFLINE_ID,
        "mode": "offline_chunk_only_admission",
        "write_enabled": False,
        "target": REGULATION_TARGET,
        "selected_notice_ids": [str(entry["source_notice_id"]) for entry in entries],
        "selected_count": len(entries),
        "converted_count": len(entries),
        "converted_counts_by_source_class": dict(sorted(converted_original_classes.items())),
        "selected_counts_by_collection": dict(sorted(collection_counts.items())),
        "query_serving_opened": False,
        "rag_release_opened": False,
        "conversion_policy": (
            "historical stock regulation owner-text-ready entries may be canonicalized "
            "and chunked offline without opening serving or release lanes"
        ),
    }
    admission = {
        "schema_version": "collected_notice_consumer_admission.v1",
        "batch_id": "historical-offline-regulation-canonical-chunk-admission",
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_08_OFFLINE_ID,
        "target": REGULATION_TARGET,
        "source_scope": {
            "source_notice_ids": [str(entry["source_notice_id"]) for entry in entries],
            "target": REGULATION_TARGET,
            "historical_offline_chunk_only": True,
        },
        "baseline": "historical_stock_owner_text_ready_chunk_only",
        "selection_policy": {
            "name": "historical-offline-regulation-canonical-chunk-admission",
            "version": "v1",
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
    candidate_rows = [_candidate_row(entry) for entry in entries]
    return {
        "schema_version": HISTORICAL_OFFLINE_ADMISSION_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "phase": PHASE_08_OFFLINE_ID,
        "mode": "dry_run",
        "write_enabled": False,
        "target": REGULATION_TARGET,
        "resolution_report": resolution_report,
        "admission_manifest": admission,
        "candidate_audit": {
            "schema_version": "collected_notice_regulation_candidate_audit.v1",
            "generated_at": timestamp,
            "generated_by": generated_by,
            "mode": "dry_run",
            "write_enabled": False,
            "current_promotion_enabled": False,
            "phase": PHASE_08_OFFLINE_ID,
            "target": REGULATION_TARGET,
            "candidate_count": len(candidate_rows),
            "class_counts": dict(sorted(class_counts.items())),
            "candidates": candidate_rows,
        },
        "serving_closed_assertion": build_serving_closed_assertion(generated_at=timestamp),
    }


def _offline_entry(
    *,
    entry: Mapping[str, Any],
    candidate_collection_by_notice: Mapping[str, str],
    overrides: Mapping[str, str],
) -> dict[str, Any]:
    source_notice_id = _required_text(entry.get("source_notice_id"), "source_notice_id")
    if str(entry.get("owner_text_status") or "") != "ready":
        raise ValueError(f"notice {source_notice_id} must have owner_text_status=ready")
    recovery = entry.get("owner_text_recovery")
    if not isinstance(recovery, Mapping) or not isinstance(recovery.get("written_refs"), Mapping):
        raise ValueError(f"notice {source_notice_id} must have owner_text_recovery written_refs")
    source_class = str(entry.get("regulation_admission_class") or "").strip()
    if source_class not in CONVERTIBLE_CLASSES and str(entry.get("consumption_class") or "") not in {
        "downstream_admitted",
    }:
        raise ValueError(f"notice {source_notice_id} is not convertible for offline backfill")
    title = _required_text(
        entry.get("regulation_title_normalized") or entry.get("title"),
        "regulation_title_normalized",
    )
    issuing_org = str(entry.get("issuing_org") or "中央民族大学").strip() or "中央民族大学"
    target_collection = _target_collection(
        source_notice_id=source_notice_id,
        entry=entry,
        candidate_collection_by_notice=candidate_collection_by_notice,
        overrides=overrides,
    )
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
    reason_codes = list(
        dict.fromkeys(
            (
                *[str(item) for item in entry.get("reason_codes") or () if str(item)],
                "historical_offline_chunk_only_backfill",
                "serving_closed",
            )
        )
    )
    converted = dict(entry)
    converted.update(
        {
            "target": REGULATION_TARGET,
            "target_surface": f"regulations/{target_collection}",
            "target_collection": target_collection,
            "target_identity_preview": target_identity,
            "candidate_key": candidate_key,
            "regulation_title_normalized": title,
            "issuing_org": issuing_org,
            "consumption_class": "downstream_admitted",
            "regulation_admission_class": TARGET_CLASS_BY_COLLECTION[target_collection],
            "fact_readiness_state": "ready",
            "target_admission_state": "downstream_admitted",
            "reason_codes": reason_codes,
            "preconditions": list(
                dict.fromkeys(
                    (
                        *[
                            str(item)
                            for item in entry.get("preconditions") or ()
                            if str(item)
                        ],
                        "owner_text_ready",
                        "historical_offline_chunk_only_backfill",
                    )
                )
            ),
            "historical_offline_admission": {
                "source_regulation_admission_class": source_class,
                "source_consumption_class": entry.get("consumption_class"),
                "release_lane_opened": False,
                "serving_opened": False,
            },
        }
    )
    return converted


def _target_collection(
    *,
    source_notice_id: str,
    entry: Mapping[str, Any],
    candidate_collection_by_notice: Mapping[str, str],
    overrides: Mapping[str, str],
) -> str:
    for value in (
        overrides.get(source_notice_id),
        candidate_collection_by_notice.get(source_notice_id),
        entry.get("target_collection"),
    ):
        normalized = str(value or "").strip()
        if normalized in TARGET_COLLECTIONS:
            return normalized
    raise ValueError(f"notice {source_notice_id} is missing target_collection")


def _candidate_collection_by_notice(candidate_audit: Mapping[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for row in _mapping_rows(candidate_audit.get("candidates")):
        source_notice_id = str(row.get("source_notice_id") or "").strip()
        target_collection = str(row.get("target_collection") or "").strip()
        if source_notice_id and target_collection in TARGET_COLLECTIONS:
            result[source_notice_id] = target_collection
    return result


def _normalize_collection_overrides(values: Mapping[str, str]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in values.items():
        source_notice_id = str(key).strip()
        target_collection = str(value).strip()
        if not source_notice_id:
            continue
        if target_collection not in TARGET_COLLECTIONS:
            raise ValueError(f"unsupported target_collection for {source_notice_id}")
        normalized[source_notice_id] = target_collection
    return normalized


def _selected_notice_ids(
    *,
    admission_manifest: Mapping[str, Any],
    selected_notice_ids: Sequence[str] | None,
    target_collection_overrides: Mapping[str, str],
) -> set[str]:
    if selected_notice_ids is not None:
        return {str(value).strip() for value in selected_notice_ids if str(value).strip()}
    return {
        str(entry.get("source_notice_id") or "").strip()
        for entry in _mapping_rows(admission_manifest.get("entries"))
        if _is_selected_entry(entry)
    } | set(target_collection_overrides)


def _is_selected_entry(entry: Mapping[str, Any]) -> bool:
    if str(entry.get("owner_text_status") or "") != "ready":
        return False
    if str(entry.get("consumption_class") or "") == "downstream_admitted":
        return True
    return str(entry.get("regulation_admission_class") or "") in CONVERTIBLE_CLASSES


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
        "reason_codes": list(entry.get("reason_codes") or ()),
        "owner_text_status": entry.get("owner_text_status"),
        "owner_text_recovery": entry.get("owner_text_recovery") or {},
        "source_object_refs": list(entry.get("source_object_refs") or ()),
        "source_url": entry.get("source_url"),
        "historical_offline_admission": entry.get("historical_offline_admission") or {},
    }


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _required_text(value: object, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


__all__ = [
    "HISTORICAL_OFFLINE_ADMISSION_SCHEMA_VERSION",
    "PHASE_08_OFFLINE_ID",
    "build_historical_offline_regulation_admission",
]
