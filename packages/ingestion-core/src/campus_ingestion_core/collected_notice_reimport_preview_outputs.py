from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_shared import (
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
)
from campus_ingestion_core.collected_notice_reimport_preview_models import (
    INVALID_DEFER_MULTIMODAL_SCHEMA_VERSION,
    PHASE_04_ID,
    REIMPORT_DRY_RUN_SCHEMA_VERSION,
    SEARCH_TEXT_MAX_CHARS,
    SEARCHABLE_COVERAGE_SCHEMA_VERSION,
    SEARCHABLE_UNIT_SCHEMA_VERSION,
    SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES,
    CollectedNoticeCapturedRunRef,
    PreparedPreviewItem,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED, DEFAULT_BUCKET_SOURCE


def _source_truth_candidate(
    item: PreparedPreviewItem,
    *,
    bucket_source: str,
    bucket_derived: str,
) -> dict[str, Any]:
    return {
        "source_surface": item.source_surface,
        "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        "source_corpus": item.source_corpus,
        "source_collection": item.source_collection,
        "site_id": item.site_id,
        "source_identifier": item.source_identifier,
        "run_id": item.run_ref.run_id,
        "document": {
            "document_id": item.document_id,
            "revision_track": item.revision_track,
            "version_id": item.version_id,
            "source_url": item.source_url,
            "title": item.title,
            "published_at": item.published_at,
            "content_hash": item.content_hash,
            "document_units_object_ref": {
                "bucket": bucket_derived,
                "key": item.document_units_object_key,
                "role": "document_units",
            },
            "canonical_markdown_object_ref": {
                "bucket": bucket_derived,
                "key": item.canonical_markdown_object_key,
                "role": "canonical_markdown",
            },
            "processed_object_keys": list(item.processed_object_keys),
            "visibility_level": item.visibility_level,
            "entitlement_groups": list(item.entitlement_groups),
            "policy_projection_version": item.policy_projection_version,
        },
        "raw_asset": {
            "raw_asset_id": item.raw_asset_id,
            "raw_version_id": item.raw_version_id,
        },
        "source_truth_artifact_refs": [
            {"bucket": bucket_source, "key": key, "role": role}
            for role, key in sorted(item.source_artifact_keys.items())
        ],
        "source_object_refs": list(item.source_object_refs),
        "attachment_refs": list(item.attachment_refs),
        "media_text_status": item.multimodal_status,
        "media_text_reason_codes": list(item.reason_codes),
        "multimodal_status": item.multimodal_status,
        "source_retention": dict(item.source_retention),
        "reason_codes": list(item.reason_codes),
    }


def _searchable_unit(
    item: PreparedPreviewItem,
    *,
    generated_at: str,
    admission_batch_id: str,
) -> dict[str, Any]:
    search_text = _search_text(item)
    return {
        "schema_version": SEARCHABLE_UNIT_SCHEMA_VERSION,
        "unit_id": f"searchable:{item.source_surface}:{item.site_id}:{item.source_identifier}",
        "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        "source_surface": item.source_surface,
        "source_corpus": item.source_corpus,
        "source_collection": item.source_collection,
        "site_id": item.site_id,
        "source_notice_id": item.source_identifier,
        "source_document_id": item.document_id,
        "title": item.title,
        "published_at": item.published_at,
        "source_url": item.source_url,
        "source_home_url": item.source_home_url,
        "source_object_refs": list(item.source_object_refs),
        "run_provenance": {
            "run_id": item.run_ref.run_id,
            "bundle_object_key": item.run_ref.bundle_object_key,
            "manifest_object_key": item.run_ref.manifest_object_key,
            "replay_phase": PHASE_04_ID,
        },
        "body_text": item.body_text,
        "body_excerpt": item.body_text[:800],
        "attachment_refs": list(item.attachment_refs),
        "media_text_status": item.multimodal_status,
        "media_text_reason_codes": list(item.reason_codes),
        "multimodal_status": item.multimodal_status,
        "search_text": search_text,
        "visibility_level": item.visibility_level,
        "entitlement_groups": list(item.entitlement_groups),
        "admission_batch_id": admission_batch_id,
        "normalized_markdown_object_key": item.canonical_markdown_object_key,
        "target_hints": _target_hints(item),
        "classification": dict(item.classification),
        "source_retention": dict(item.source_retention),
        "defer_reason_codes": [],
        "invalid_reason_codes": [],
        "reason_codes": list(item.reason_codes),
        "created_at": generated_at,
        "updated_at": generated_at,
    }


def _reimport_plan(
    *,
    selected_run_refs: Sequence[CollectedNoticeCapturedRunRef],
    source_truth_candidates: Sequence[dict[str, Any]],
    searchable_units: Sequence[dict[str, Any]],
    coverage_report: dict[str, Any],
    invalid_defer_multimodal_report: dict[str, Any],
    duplicate_skips: Sequence[dict[str, Any]],
    input_refs: dict[str, Any],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    source_artifact_object_count = sum(
        len(candidate["source_truth_artifact_refs"]) for candidate in source_truth_candidates
    )
    admission_entries = [_admission_entry(unit) for unit in searchable_units]
    report_id = _report_id(selected_run_refs, searchable_units)
    return {
        "schema_version": REIMPORT_DRY_RUN_SCHEMA_VERSION,
        "report_id": report_id,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_04_ID,
        "input_refs": input_refs,
        "selection_policy": {
            "name": "verified-run-object-native-reimport-preview",
            "version": "phase4.v1",
            "source_surfaces": list(SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES),
        },
        "planned_writes": {
            "raw_asset_registry_rows": len(source_truth_candidates),
            "document_registry_rows": len(source_truth_candidates),
            "source_truth_inventory_rows": len(source_truth_candidates),
            "source_artifact_object_count": source_artifact_object_count,
            "derived_document_object_count": len(source_truth_candidates) * 2,
            "searchable_read_model_rows": len(searchable_units),
            "consumer_admission_candidate_rows": len(admission_entries),
        },
        "planned_deletes": {},
        "planned_updates": {},
        "planned_skips": [
            *list(invalid_defer_multimodal_report.get("invalid_captures") or ()),
            *list(duplicate_skips),
        ],
        "planned_defers": list(invalid_defer_multimodal_report.get("deferred_units") or ()),
        "planned_blocks": [],
        "counts": {
            "selected_run_count": len(selected_run_refs),
            "source_truth_candidate_count": len(source_truth_candidates),
            "searchable_unit_count": len(searchable_units),
            "invalid_capture_count": invalid_defer_multimodal_report["invalid_capture_count"],
            "needs_multimodal_count": invalid_defer_multimodal_report["needs_multimodal_count"],
            "duplicate_source_identity_skipped_count": len(duplicate_skips),
            "missing_searchable_unit_count": coverage_report["missing_searchable_unit_count"],
            "by_source_surface": dict(Counter(unit["source_surface"] for unit in searchable_units)),
        },
        "preconditions": [
            "write mode must consume this dry-run report as explicit manifest input",
            "Phase 5 must complete multimodal candidates before typed target replay",
            "operator must review invalid_capture rows before execution",
        ],
        "backup_requirements": {
            "database_tables": [
                "document_registry",
                "raw_asset_registry",
                "authenticated_notice_source_truth_inventory",
                "internal_notice_read_model",
                "notice_consumption_projection",
            ],
            "object_buckets": [DEFAULT_BUCKET_SOURCE, DEFAULT_BUCKET_DERIVED],
            "required_before_write": True,
        },
        "write_manifest_candidate": {
            "schema_version": "collected_notice_reimport_write_manifest_candidate.v1",
            "dry_run_report_id": report_id,
            "source_truth_candidates": list(source_truth_candidates),
            "searchable_units": list(searchable_units),
            "consumer_admission_candidates": admission_entries,
        },
        "verification_queries": [
            {
                "name": "source_truth_inventory_count_matches_preview",
                "expected_count": len(source_truth_candidates),
            },
            {
                "name": "searchable_unit_count_matches_preview",
                "expected_count": len(searchable_units),
            },
        ],
    }


def _coverage_report(
    *,
    prepared_items: Sequence[PreparedPreviewItem],
    searchable_units: Sequence[dict[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    valid_keys = {
        _source_key(
            source_surface=item.source_surface,
            site_id=item.site_id,
            source_identifier=item.source_identifier,
        )
        for item in prepared_items
    }
    searchable_keys = {
        _source_key(
            source_surface=str(unit["source_surface"]),
            site_id=str(unit["site_id"]),
            source_identifier=str(unit["source_notice_id"]),
        )
        for unit in searchable_units
    }
    missing = tuple(sorted(valid_keys - searchable_keys))
    extra = tuple(sorted(searchable_keys - valid_keys))
    valid_count = len(valid_keys)
    return {
        "schema_version": SEARCHABLE_COVERAGE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_04_ID,
        "valid_captured_notice_count": valid_count,
        "searchable_unit_count": len(searchable_units),
        "coverage_ratio": (len(searchable_keys & valid_keys) / valid_count) if valid_count else 1.0,
        "missing_searchable_unit_count": len(missing),
        "extra_searchable_unit_count": len(extra),
        "duplicate_searchable_unit_count": len(searchable_units) - len(searchable_keys),
        "missing_searchable_units": list(missing),
        "extra_searchable_units": list(extra),
        "verdict": "passed" if not missing and not extra else "failed",
    }


def _invalid_defer_multimodal_report(
    *,
    invalid_captures: Sequence[dict[str, Any]],
    searchable_units: Sequence[dict[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    needs_multimodal_units = [
        _unit_summary(unit)
        for unit in searchable_units
        if unit["multimodal_status"] in {"pending", "failed"}
    ]
    deferred_units = [
        _unit_summary(unit) for unit in searchable_units if unit.get("defer_reason_codes")
    ]
    return {
        "schema_version": INVALID_DEFER_MULTIMODAL_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "phase": PHASE_04_ID,
        "invalid_capture_count": len(invalid_captures),
        "defer_count": len(deferred_units),
        "needs_multimodal_count": len(needs_multimodal_units),
        "invalid_captures": list(invalid_captures),
        "deferred_units": deferred_units,
        "needs_multimodal_units": needs_multimodal_units,
    }


def _search_text(item: PreparedPreviewItem) -> str:
    values = [
        item.title,
        item.organization_name,
        item.source_identifier,
        item.published_at,
        item.source_url,
        item.body_text,
    ]
    for attachment in item.attachment_refs:
        values.extend(
            [
                str(attachment.get("anchor_text") or ""),
                str(attachment.get("original_filename") or ""),
                str(attachment.get("source_url") or ""),
                str(attachment.get("final_url") or ""),
            ]
        )
    return "\n".join(value.strip() for value in values if value and value.strip())[
        :SEARCH_TEXT_MAX_CHARS
    ]


def _target_hints(item: PreparedPreviewItem) -> dict[str, Any]:
    classification_targets = list(item.classification.get("target_candidates") or ())
    return {
        "candidate_targets": classification_targets,
        "policy": "notice-family-classification.v1",
        "hint_strength": "classifier_route" if classification_targets else "none",
        "weak_keyword_targets": _weak_keyword_targets(item),
    }


def _weak_keyword_targets(item: PreparedPreviewItem) -> list[str]:
    text = f"{item.title}\n{item.body_text}".lower()
    hints = []
    if any(token in text for token in ("班车", "校车", "通勤车", "发车", "时刻表")):
        hints.append("transport_schedule")
    if any(token in text for token in ("规章", "办法", "规定", "条例", "制度")):
        hints.append("regulation")
    if any(token in text for token in ("暂停", "恢复", "开放", "关闭", "停用", "启用")):
        hints.append("service_status")
    return list(dict.fromkeys(hints))


def _admission_entry(unit: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "entry_id": f"notice:{unit['site_id']}:{unit['source_notice_id']}",
        "source_channel": unit["source_channel"],
        "source_surface": unit["source_surface"],
        "source_corpus": unit["source_corpus"],
        "source_collection": unit["source_collection"],
        "site_id": unit["site_id"],
        "source_notice_id": unit["source_notice_id"],
        "source_document_id": unit["source_document_id"],
        "source_url": unit["source_url"],
        "run_id": unit["run_provenance"]["run_id"],
        "source_object_refs": unit["source_object_refs"],
        "consumption_class": "search_only",
        "target": None,
        "target_surface": None,
        "target_hints": unit["target_hints"],
        "multimodal_policy": "pending"
        if unit["multimodal_status"] == "pending"
        else "not_required",
        "reason_codes": unit["reason_codes"],
        "preconditions": [],
        "searchable_unit_id": unit["unit_id"],
    }


def _input_refs(
    *,
    selected_run_refs: Sequence[CollectedNoticeCapturedRunRef],
    rejected_run_refs: Sequence[Mapping[str, Any]],
    input_inventory_path: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "selected_run_refs": [asdict(ref) for ref in selected_run_refs],
        "rejected_run_refs": list(rejected_run_refs),
    }
    if input_inventory_path:
        payload["captured_runs_inventory_path"] = input_inventory_path
    return payload


def _report_id(
    selected_run_refs: Sequence[CollectedNoticeCapturedRunRef],
    searchable_units: Sequence[Mapping[str, Any]],
) -> str:
    payload = {
        "runs": [asdict(ref) for ref in selected_run_refs],
        "units": [
            {
                "unit_id": unit["unit_id"],
                "source_notice_id": unit["source_notice_id"],
                "source_surface": unit["source_surface"],
            }
            for unit in searchable_units
        ],
    }
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    return f"collected-notice-reimport-preview-{digest}"


def _unit_summary(unit: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "unit_id": unit["unit_id"],
        "source_surface": unit["source_surface"],
        "source_notice_id": unit["source_notice_id"],
        "title": unit["title"],
        "source_url": unit["source_url"],
        "multimodal_status": unit["multimodal_status"],
        "reason_codes": unit["reason_codes"],
        "source_object_refs": unit["source_object_refs"],
    }


def _source_key(*, source_surface: str, site_id: str, source_identifier: str) -> str:
    return f"{source_surface}:{site_id}:{source_identifier}"


__all__ = [
    "_coverage_report",
    "_input_refs",
    "_invalid_defer_multimodal_report",
    "_reimport_plan",
    "_searchable_unit",
    "_source_truth_candidate",
]
