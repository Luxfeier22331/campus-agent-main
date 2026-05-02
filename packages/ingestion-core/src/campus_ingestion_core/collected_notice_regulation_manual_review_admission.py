from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_regulation_admission_support import (
    INSTITUTIONAL_TARGET_COLLECTION,
    REGULATION_CLASS_INSTITUTIONAL,
    REGULATION_CLASS_MANUAL_REVIEW,
    REGULATION_CLASS_SCOPED,
    REGULATION_TARGET,
    SCOPED_TARGET_COLLECTION,
    _candidate_key,
    _load_json_object,
    _mapping_rows,
    _target_identity_preview,
)

PHASE_11_ID = "phase-11-second-batch-manual-review-admission"
MANUAL_REVIEW_RESOLUTION_SCHEMA_VERSION = (
    "collected_notice_regulation_manual_review_resolution.v1"
)
TARGET_COLLECTIONS = (INSTITUTIONAL_TARGET_COLLECTION, SCOPED_TARGET_COLLECTION)
TARGET_CLASS_BY_COLLECTION = {
    INSTITUTIONAL_TARGET_COLLECTION: REGULATION_CLASS_INSTITUTIONAL,
    SCOPED_TARGET_COLLECTION: REGULATION_CLASS_SCOPED,
}


def build_manual_review_regulation_admission_from_paths(
    *,
    candidate_audit_path: Path,
    owner_text_execution_report_path: Path,
    resolutions: Mapping[str, object],
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_worker.promote_collected_notice_regulation_manual_review_batch"
    ),
) -> dict[str, Any]:
    return build_manual_review_regulation_admission(
        candidate_audit=_load_json_object(candidate_audit_path),
        owner_text_execution_report=_load_json_object(owner_text_execution_report_path),
        resolutions=resolutions,
        generated_at=generated_at,
        generated_by=generated_by,
        evidence_refs={
            "candidate_audit": str(candidate_audit_path),
            "owner_text_execution_report": str(owner_text_execution_report_path),
        },
    )


def build_manual_review_regulation_admission(
    *,
    candidate_audit: Mapping[str, Any],
    owner_text_execution_report: Mapping[str, Any],
    resolutions: Mapping[str, object],
    generated_at: str | None = None,
    generated_by: str = (
        "campus_ingestion_worker.promote_collected_notice_regulation_manual_review_batch"
    ),
    evidence_refs: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    resolved_specs = _normalize_resolutions(resolutions)
    if not resolved_specs:
        raise ValueError("manual-review regulation resolutions are required")
    candidates = _index_by_notice_id(candidate_audit.get("candidates"), label="candidate audit")
    owner_text_results = _index_by_notice_id(
        owner_text_execution_report.get("attempt_results"),
        label="owner text execution report",
    )
    selected_entries = [
        _resolved_admission_entry(
            candidate=candidates.get(notice_id),
            owner_text_result=owner_text_results.get(notice_id),
            notice_id=notice_id,
            resolution=resolution,
        )
        for notice_id, resolution in resolved_specs.items()
    ]
    class_counts = Counter(str(entry["regulation_admission_class"]) for entry in selected_entries)
    collection_counts = Counter(str(entry["target_collection"]) for entry in selected_entries)
    resolution_report = {
        "schema_version": MANUAL_REVIEW_RESOLUTION_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "phase": PHASE_11_ID,
        "mode": "admission_preflight",
        "write_enabled": False,
        "target": REGULATION_TARGET,
        "selected_notice_ids": [str(entry["source_notice_id"]) for entry in selected_entries],
        "selected_count": len(selected_entries),
        "selected_counts_by_collection": dict(sorted(collection_counts.items())),
        "selected_target_document_ids": [
            str(entry["target_identity_preview"]) for entry in selected_entries
        ],
        "resolved_source_admission_class": REGULATION_CLASS_MANUAL_REVIEW,
        "resolution_policy": "explicit_manual_review_resolution_only",
        "query_serving_opened": False,
        "rag_release_opened": False,
        "entries": [
            {
                "source_notice_id": entry["source_notice_id"],
                "title": entry["title"],
                "target_collection": entry["target_collection"],
                "target_surface": entry["target_surface"],
                "target_document_id": entry["target_identity_preview"],
                "decision_source": entry["manual_review_resolution"]["decision_source"],
                "rationale": entry["manual_review_resolution"]["rationale"],
            }
            for entry in selected_entries
        ],
        "evidence_refs": dict(evidence_refs or {}),
    }
    admission_manifest = {
        "schema_version": "collected_notice_consumer_admission.v1",
        "batch_id": "phase11-manual-review-regulation-admission",
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_11_ID,
        "target": REGULATION_TARGET,
        "source_scope": {
            "source_notice_ids": [
                str(entry["source_notice_id"]) for entry in selected_entries
            ],
            "target": REGULATION_TARGET,
            "manual_review_resolved": True,
        },
        "baseline": "manual_review_resolved_but_not_imported",
        "selection_policy": {
            "name": "phase11-manual-review-regulation-admission",
            "version": "v1",
            "resolution_required": True,
        },
        "entries": selected_entries,
        "counts": {
            "entry_count": len(selected_entries),
            "downstream_admitted": len(selected_entries),
            "search_only": 0,
            "defer": 0,
            "needs_multimodal": 0,
            "invalid_capture": 0,
            "by_regulation_admission_class": dict(sorted(class_counts.items())),
            "by_target_collection": dict(sorted(collection_counts.items())),
        },
        "evidence_refs": dict(evidence_refs or {}),
    }
    candidate_audit_report = {
        "schema_version": "collected_notice_regulation_candidate_audit.v1",
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_11_ID,
        "target": REGULATION_TARGET,
        "candidate_count": len(selected_entries),
        "class_counts": dict(sorted(class_counts.items())),
        "candidates": [_candidate_row_from_entry(entry) for entry in selected_entries],
    }
    return {
        "resolution_report": resolution_report,
        "admission_manifest": admission_manifest,
        "candidate_audit": candidate_audit_report,
    }


def _resolved_admission_entry(
    *,
    candidate: Mapping[str, Any] | None,
    owner_text_result: Mapping[str, Any] | None,
    notice_id: str,
    resolution: Mapping[str, str],
) -> dict[str, Any]:
    if candidate is None:
        raise ValueError(f"resolved notice {notice_id} is missing from candidate audit")
    if str(candidate.get("regulation_admission_class") or "") != REGULATION_CLASS_MANUAL_REVIEW:
        raise ValueError(f"resolved notice {notice_id} must be manual_review")
    if str(candidate.get("owner_text_status") or "") != "ready":
        raise ValueError(f"resolved notice {notice_id} must have owner_text_status=ready")
    if owner_text_result is None:
        raise ValueError(f"resolved notice {notice_id} is missing owner text execution result")
    if str(owner_text_result.get("owner_text_status") or "") != "ready":
        raise ValueError(f"resolved notice {notice_id} must have owner_text_status=ready")
    target_collection = _required_target_collection(resolution["target_collection"])
    title = _required_text(
        candidate.get("regulation_title_normalized") or candidate.get("title"),
        "regulation_title_normalized",
    )
    issuing_org = str(candidate.get("issuing_org") or "中央民族大学").strip() or "中央民族大学"
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
    owner_text_recovery = _owner_text_recovery(candidate=candidate, owner_text_result=owner_text_result)
    reason_codes = tuple(
        dict.fromkeys(
            (
                "manual_review_resolved",
                *[str(item) for item in candidate.get("reason_codes") or () if str(item)],
                "owner_text_recovered",
            )
        )
    )
    return {
        "entry_id": f"notice:{_site_id(candidate)}:{notice_id}",
        "source_channel": str(candidate.get("source_channel") or "authenticated_notice_portal"),
        "source_surface": str(candidate.get("source_surface") or "file_release"),
        "source_corpus": str(candidate.get("source_corpus") or "authenticated_documents"),
        "source_collection": str(candidate.get("source_collection") or "file_release_source"),
        "site_id": _site_id(candidate),
        "source_notice_id": notice_id,
        "source_document_id": str(
            candidate.get("source_document_id") or f"file-release:muc_internal_portal:{notice_id}"
        ),
        "title": title,
        "published_at": candidate.get("published_at"),
        "body_excerpt": candidate.get("body_excerpt"),
        "source_url": candidate.get("source_url"),
        "run_id": dict(candidate.get("run_provenance") or {}).get("run_id", ""),
        "source_object_refs": list(candidate.get("source_object_refs") or ()),
        "consumption_class": "downstream_admitted",
        "regulation_admission_class": TARGET_CLASS_BY_COLLECTION[target_collection],
        "target": REGULATION_TARGET,
        "target_surface": f"regulations/{target_collection}",
        "target_collection": target_collection,
        "target_identity_preview": target_identity,
        "candidate_key": candidate_key,
        "regulation_title_normalized": title,
        "issuing_org": issuing_org,
        "cycle_year": candidate.get("cycle_year"),
        "applicability_status": candidate.get("applicability_status"),
        "promotion_disposition": "manual_review_resolved_downstream_admitted",
        "recommended_query_surface": candidate.get("recommended_query_surface"),
        "duplicate_primary_source_notice_id": candidate.get("duplicate_primary_source_notice_id"),
        "duplicate_primary_searchable_unit_id": candidate.get(
            "duplicate_primary_searchable_unit_id"
        ),
        "target_hints": candidate.get("target_hints") or {},
        "multimodal_policy": "completed",
        "owner_text_status": "ready",
        "owner_text_recovery": owner_text_recovery,
        "fact_readiness_state": "ready",
        "target_admission_state": "downstream_admitted",
        "fact_readiness": {
            "fact_readiness_state": "ready",
            "target_admission_state": "downstream_admitted",
            "source_admission_class": REGULATION_CLASS_MANUAL_REVIEW,
        },
        "reason_codes": list(reason_codes),
        "preconditions": [
            "searchable_unit_present",
            "source_object_refs_present",
            "owner_text_ready",
            "manual_review_resolution_present",
            "phase11_selected_promotion_required",
        ],
        "searchable_unit_id": str(
            candidate.get("searchable_unit_id")
            or owner_text_result.get("searchable_unit_id")
            or f"searchable:file_release:muc_internal_portal:{notice_id}"
        ),
        "manual_review_resolution": {
            "source_admission_class": REGULATION_CLASS_MANUAL_REVIEW,
            "target_collection": target_collection,
            "decision_source": str(resolution.get("decision_source") or "operator_review"),
            "rationale": str(resolution.get("rationale") or "").strip(),
        },
    }


def _candidate_row_from_entry(entry: Mapping[str, Any]) -> dict[str, Any]:
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
        "cycle_year": entry.get("cycle_year"),
        "applicability_status": entry.get("applicability_status"),
        "promotion_disposition": entry.get("promotion_disposition"),
        "recommended_query_surface": entry.get("recommended_query_surface"),
        "duplicate_primary_source_notice_id": entry.get("duplicate_primary_source_notice_id"),
        "duplicate_primary_searchable_unit_id": entry.get(
            "duplicate_primary_searchable_unit_id"
        ),
        "reason_codes": list(entry.get("reason_codes") or ()),
        "owner_text_status": entry.get("owner_text_status"),
        "owner_text_recovery": entry.get("owner_text_recovery") or {},
        "fact_readiness_state": entry.get("fact_readiness_state"),
        "target_admission_state": entry.get("target_admission_state"),
        "source_object_refs": list(entry.get("source_object_refs") or ()),
        "source_url": entry.get("source_url"),
        "manual_review_resolution": entry.get("manual_review_resolution") or {},
    }


def _normalize_resolutions(resolutions: Mapping[str, object]) -> dict[str, dict[str, str]]:
    normalized: dict[str, dict[str, str]] = {}
    for key, value in resolutions.items():
        notice_id = str(key).strip()
        if not notice_id:
            continue
        if isinstance(value, str):
            target_collection = value
            payload: Mapping[str, object] = {"target_collection": value}
        elif isinstance(value, Mapping):
            target_collection = str(value.get("target_collection") or "")
            payload = value
        else:
            raise ValueError(f"resolution for notice {notice_id} must be a mapping or string")
        normalized[notice_id] = {
            "target_collection": _required_target_collection(target_collection),
            "decision_source": str(payload.get("decision_source") or "operator_review"),
            "rationale": str(payload.get("rationale") or "").strip(),
        }
    return dict(sorted(normalized.items()))


def _index_by_notice_id(value: object, *, label: str) -> dict[str, Mapping[str, Any]]:
    rows = _mapping_rows(value)
    indexed: dict[str, Mapping[str, Any]] = {}
    for row in rows:
        notice_id = str(row.get("source_notice_id") or "").strip()
        if not notice_id:
            continue
        if notice_id in indexed:
            raise ValueError(f"{label} contains duplicate source_notice_id: {notice_id}")
        indexed[notice_id] = row
    return indexed


def _owner_text_recovery(
    *,
    candidate: Mapping[str, Any],
    owner_text_result: Mapping[str, Any],
) -> dict[str, Any]:
    recovery = candidate.get("owner_text_recovery")
    if isinstance(recovery, Mapping) and isinstance(recovery.get("written_refs"), Mapping):
        return dict(recovery)
    refs = owner_text_result.get("written_refs")
    if not isinstance(refs, Mapping):
        raise ValueError(
            f"resolved notice {owner_text_result.get('source_notice_id')} is missing owner text refs"
        )
    return {
        "provider": owner_text_result.get("provider"),
        "model": owner_text_result.get("model"),
        "owner_text_length": owner_text_result.get("owner_text_length"),
        "owner_text_sha256": owner_text_result.get("owner_text_sha256"),
        "source_notice_id": owner_text_result.get("source_notice_id"),
        "written_refs": {key: dict(ref) for key, ref in refs.items() if isinstance(ref, Mapping)},
    }


def _site_id(candidate: Mapping[str, Any]) -> str:
    site_id = str(candidate.get("site_id") or "").strip()
    if site_id:
        return site_id
    searchable_unit_id = str(candidate.get("searchable_unit_id") or "")
    if "muc_internal_portal" in searchable_unit_id:
        return "muc_internal_portal"
    return "muc_internal_portal"


def _required_target_collection(value: object) -> str:
    target_collection = str(value or "").strip()
    if target_collection not in TARGET_COLLECTIONS:
        raise ValueError(
            "manual-review resolution target_collection must be one of: "
            + ", ".join(TARGET_COLLECTIONS)
        )
    return target_collection


def _required_text(value: object, field_name: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field_name} is required")
    return text


__all__ = [
    "MANUAL_REVIEW_RESOLUTION_SCHEMA_VERSION",
    "PHASE_11_ID",
    "build_manual_review_regulation_admission",
    "build_manual_review_regulation_admission_from_paths",
]
