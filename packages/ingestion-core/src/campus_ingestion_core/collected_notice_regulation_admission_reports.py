from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.collected_notice_fact_readiness import fact_readiness_entry_fields
from campus_ingestion_core.collected_notice_regulation_admission_support import (
    REGULATION_CLASS_NEEDS_MULTIMODAL,
    REGULATION_TARGET,
    _multimodal_policy,
    _owner_text_status,
    _preconditions,
)


def _admission_manifest(
    *,
    decisions: Sequence[Any],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
    evidence_refs: Mapping[str, str],
    schema_version: str,
    phase_id: str,
) -> dict[str, Any]:
    entries = [_admission_entry(decision) for decision in decisions]
    class_counts = Counter(entry["regulation_admission_class"] for entry in entries)
    consumption_counts = Counter(entry["consumption_class"] for entry in entries)
    target_collection_counts = Counter(
        entry.get("target_collection") or "none" for entry in entries
    )
    return {
        "schema_version": schema_version,
        "batch_id": "phase6-r1-regulation-candidate-admission",
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": phase_id,
        "target": REGULATION_TARGET,
        "source_scope": {
            "source_notice_ids": [entry["source_notice_id"] for entry in entries],
            "target": REGULATION_TARGET,
            "queue_backed": queue_backed,
        },
        "baseline": "captured_but_not_imported",
        "selection_policy": {
            "name": "phase6-r1-regulation-candidate-admission",
            "version": "v1",
            "queue_backed_required": queue_backed,
        },
        "entries": entries,
        "counts": {
            "entry_count": len(entries),
            "downstream_admitted": consumption_counts.get("downstream_admitted", 0),
            "search_only": consumption_counts.get("search_only", 0),
            "defer": consumption_counts.get("defer", 0),
            "needs_multimodal": consumption_counts.get("needs_multimodal", 0),
            "invalid_capture": consumption_counts.get("invalid_capture", 0),
            "by_regulation_admission_class": dict(sorted(class_counts.items())),
            "by_target_collection": dict(sorted(target_collection_counts.items())),
        },
        "evidence_refs": {
            "searchable_preview": evidence_refs.get("searchable_preview", ""),
            "multimodal_inventory": evidence_refs.get("multimodal_inventory", ""),
            "queue_consume_trace": evidence_refs.get("queue_consume_trace", ""),
            "owner_text_execution_report": evidence_refs.get("owner_text_execution_report", ""),
        },
    }


def _admission_entry(decision: Any) -> dict[str, Any]:
    unit = decision.unit
    return {
        "entry_id": f"notice:{unit.get('site_id')}:{unit.get('source_notice_id')}",
        "source_channel": unit.get("source_channel"),
        "source_surface": unit.get("source_surface"),
        "source_corpus": unit.get("source_corpus"),
        "source_collection": unit.get("source_collection"),
        "site_id": unit.get("site_id"),
        "source_notice_id": unit.get("source_notice_id"),
        "source_document_id": unit.get("source_document_id"),
        "title": unit.get("title"),
        "published_at": unit.get("published_at"),
        "body_excerpt": unit.get("body_excerpt"),
        "source_url": unit.get("source_url"),
        "run_id": dict(unit.get("run_provenance") or {}).get("run_id", ""),
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "consumption_class": decision.consumption_class,
        "regulation_admission_class": decision.regulation_admission_class,
        "target": REGULATION_TARGET if decision.admitted else None,
        "target_surface": decision.target_surface,
        "target_collection": decision.target_collection,
        "target_identity_preview": decision.target_identity_preview,
        "candidate_key": decision.candidate_key,
        "regulation_title_normalized": decision.regulation_title,
        "issuing_org": decision.issuing_org,
        "cycle_year": decision.cycle_year,
        "applicability_status": decision.applicability_status,
        "promotion_disposition": decision.promotion_disposition,
        "recommended_query_surface": decision.recommended_query_surface,
        "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
        "duplicate_primary_searchable_unit_id": decision.duplicate_primary_searchable_unit_id,
        "target_hints": unit.get("target_hints") or {},
        "multimodal_policy": _multimodal_policy(unit),
        "owner_text_status": _owner_text_status(unit),
        "owner_text_recovery": unit.get("owner_text_recovery") or {},
        **fact_readiness_entry_fields(decision.fact_readiness),
        "reason_codes": list(decision.reason_codes),
        "preconditions": _preconditions(decision),
        "searchable_unit_id": unit.get("unit_id"),
    }


def _candidate_audit(
    *,
    decisions: Sequence[Any],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
    schema_version: str,
    phase_id: str,
) -> dict[str, Any]:
    candidates = [_audit_row(decision) for decision in decisions]
    return {
        "schema_version": schema_version,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": phase_id,
        "target": REGULATION_TARGET,
        "queue_backed": queue_backed,
        "candidate_count": len(candidates),
        "class_counts": dict(
            sorted(Counter(row["regulation_admission_class"] for row in candidates).items())
        ),
        "candidates": candidates,
    }


def _audit_row(decision: Any) -> dict[str, Any]:
    unit = decision.unit
    return {
        "source_notice_id": unit.get("source_notice_id"),
        "source_surface": unit.get("source_surface"),
        "source_document_id": unit.get("source_document_id"),
        "searchable_unit_id": unit.get("unit_id"),
        "title": unit.get("title"),
        "regulation_title_normalized": decision.regulation_title,
        "issuing_org": decision.issuing_org,
        "candidate_key": decision.candidate_key,
        "regulation_admission_class": decision.regulation_admission_class,
        "consumption_class": decision.consumption_class,
        "target_collection": decision.target_collection,
        "target_identity_preview": decision.target_identity_preview,
        "cycle_year": decision.cycle_year,
        "applicability_status": decision.applicability_status,
        "promotion_disposition": decision.promotion_disposition,
        "recommended_query_surface": decision.recommended_query_surface,
        "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
        "duplicate_primary_searchable_unit_id": decision.duplicate_primary_searchable_unit_id,
        "reason_codes": list(decision.reason_codes),
        "owner_text_status": _owner_text_status(unit),
        "owner_text_recovery": unit.get("owner_text_recovery") or {},
        "fact_readiness_state": decision.fact_readiness["fact_readiness_state"],
        "target_admission_state": decision.fact_readiness["target_admission_state"],
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "source_url": unit.get("source_url"),
    }


def _rejected_deferred_source_report(
    *,
    decisions: Sequence[Any],
    generated_at: str,
    generated_by: str,
    schema_version: str,
    phase_id: str,
) -> dict[str, Any]:
    entries = []
    for decision in decisions:
        if decision.admitted:
            continue
        unit = decision.unit
        entries.append(
            {
                "source_notice_id": unit.get("source_notice_id"),
                "candidate_target": REGULATION_TARGET,
                "regulation_admission_class": decision.regulation_admission_class,
                "consumption_class": decision.consumption_class,
                "reason_codes": list(decision.reason_codes),
                "cycle_year": decision.cycle_year,
                "applicability_status": decision.applicability_status,
                "promotion_disposition": decision.promotion_disposition,
                "recommended_query_surface": decision.recommended_query_surface,
                "searchable_exists": bool(unit.get("unit_id")),
                "source_object_ref_count": len(unit.get("source_object_refs") or ()),
                "multimodal_processing_could_change_decision": (
                    decision.regulation_admission_class == REGULATION_CLASS_NEEDS_MULTIMODAL
                ),
                "duplicate_primary_source_notice_id": decision.duplicate_primary_source_notice_id,
            }
        )
    return {
        "schema_version": schema_version,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": phase_id,
        "target": REGULATION_TARGET,
        "entry_count": len(entries),
        "entries": entries,
    }


def _source_to_searchable_trace(
    *,
    decisions: Sequence[Any],
    generated_at: str,
    generated_by: str,
    queue_backed: bool,
    schema_version: str,
    phase_id: str,
) -> dict[str, Any]:
    entries = [_source_trace_entry(decision) for decision in decisions]
    return {
        "schema_version": schema_version,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": phase_id,
        "target": REGULATION_TARGET,
        "queue_backed": queue_backed,
        "entry_count": len(entries),
        "entries": entries,
    }


def _source_trace_entry(decision: Any) -> dict[str, Any]:
    unit = decision.unit
    queue_trace_row = dict(decision.queue_trace_row or {})
    return {
        "source_notice_id": unit.get("source_notice_id"),
        "source_surface": unit.get("source_surface"),
        "source_document_id": unit.get("source_document_id"),
        "searchable_unit_id": unit.get("unit_id"),
        "source_url": unit.get("source_url"),
        "source_object_refs": list(unit.get("source_object_refs") or ()),
        "queue_job_id": queue_trace_row.get("job_id"),
        "queue_replay_batch_id": queue_trace_row.get("replay_batch_id"),
        "queue_source_object_refs": list(queue_trace_row.get("source_object_refs") or ()),
        "regulation_admission_class": decision.regulation_admission_class,
        "consumption_class": decision.consumption_class,
        "candidate_key": decision.candidate_key,
        "target_identity_preview": decision.target_identity_preview,
        "owner_text_status": _owner_text_status(unit),
    }
