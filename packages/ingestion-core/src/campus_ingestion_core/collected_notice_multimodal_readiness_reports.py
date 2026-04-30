from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.collected_notice_multimodal_readiness_shared import (
    DEFAULT_PHASE_05_ADMISSION_BATCH_ID,
    MEDIA_EXTRACTION_CANDIDATE_INVENTORY_SCHEMA_VERSION,
    MULTIMODAL_CANDIDATE_INVENTORY_SCHEMA_VERSION,
    MULTIMODAL_GAP_REPORT_SCHEMA_VERSION,
    MULTIMODAL_STATE_MAPPING_SCHEMA_VERSION,
    OCR_ATTEMPT_PLAN_SCHEMA_VERSION,
    OCR_BATCH_MANIFEST_SCHEMA_VERSION,
    PHASE_05_ID,
    SEARCHABLE_MERGE_PREVIEW_SCHEMA_VERSION,
    counter,
    family_lifecycle_counts,
    merge_status,
    source_attempt_tables,
)
from campus_ingestion_core.internal_notice_consumption_projection_multimodal import (
    NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
)


def candidate_inventory(
    *,
    units: Sequence[Mapping[str, Any]],
    candidates: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    return {
        "schema_version": MEDIA_EXTRACTION_CANDIDATE_INVENTORY_SCHEMA_VERSION,
        "legacy_schema_version": MULTIMODAL_CANDIDATE_INVENTORY_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_05_ID,
        "unit_count": len(units),
        "candidate_count": len(candidates),
        "counts_by_status": counter(candidates, "status"),
        "counts_by_media_kind": counter(candidates, "media_kind"),
        "counts_by_processing_family": counter(candidates, "processing_family"),
        "counts_by_priority": counter(candidates, "priority"),
        "candidates": [dict(item) for item in candidates],
    }


def state_mapping_report(
    *,
    candidates: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    return {
        "schema_version": MULTIMODAL_STATE_MAPPING_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_05_ID,
        "candidate_count": len(candidates),
        "source_attempt_tables": source_attempt_tables(),
        "candidate_lifecycle_counts": counter(candidates, "status"),
        "family_lifecycle_counts": family_lifecycle_counts(candidates),
    }


def ocr_batch_manifest(
    *,
    candidates: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    pending = [dict(item) for item in candidates if item.get("status") == "pending"]
    batches = []
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for candidate in pending:
        grouped[(str(candidate["processing_family"]), str(candidate["priority"]))].append(candidate)
    for index, ((family, priority), group) in enumerate(sorted(grouped.items()), start=1):
        batches.append(
            {
                "batch_id": f"phase5-{index:03d}-{family}-{priority}",
                "processing_family": family,
                "priority": priority,
                "candidate_count": len(group),
                "candidate_ids": [str(item["candidate_id"]) for item in group],
            }
        )
    return {
        "schema_version": OCR_BATCH_MANIFEST_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "db_writes_enabled": False,
        "object_store_writes_enabled": False,
        "provider_calls_enabled": False,
        "phase": PHASE_05_ID,
        "admission_batch_id": DEFAULT_PHASE_05_ADMISSION_BATCH_ID,
        "candidate_count": len(candidates),
        "pending_attempt_count": len(pending),
        "skipped_count": sum(1 for item in candidates if item.get("status") == "skipped"),
        "failed_count": sum(1 for item in candidates if item.get("status") == "failed"),
        "counts_by_processing_family": counter(pending, "processing_family"),
        "counts_by_media_kind": counter(pending, "media_kind"),
        "counts_by_priority": counter(pending, "priority"),
        "provider_resolution": {
            "provider": "pending_runtime_config",
            "model": "pending_runtime_config",
            "required_at_execution": True,
        },
        "batches": batches,
    }


def ocr_attempt_plan(
    *,
    candidates: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    attempts = []
    for candidate in candidates:
        state = str(candidate.get("status") or "")
        attempts.append(
            {
                "attempt_id": f"{candidate['candidate_id']}:attempt:1",
                "candidate_id": candidate["candidate_id"],
                "unit_id": candidate["unit_id"],
                "source_notice_id": candidate["source_notice_id"],
                "media_ref_id": candidate["media_ref_id"],
                "processing_family": candidate["processing_family"],
                "state": state,
                "action": candidate["policy_action"],
                "attempt_number": 1,
                "provider": "pending_runtime_config" if state == "pending" else "",
                "model": "pending_runtime_config" if state == "pending" else "",
                "provider_model_required": state == "pending",
                "attempt_ledger": candidate["attempt_ledger"],
                "normalized_output_refs": candidate["normalized_output_refs"],
                "reason_codes": candidate["reason_codes"],
                "provenance": candidate["provenance"],
            }
        )
    return {
        "schema_version": OCR_ATTEMPT_PLAN_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": False,
        "phase": PHASE_05_ID,
        "attempt_count": len(attempts),
        "pending_attempt_count": sum(1 for item in attempts if item["state"] == "pending"),
        "attempts": attempts,
    }


def searchable_merge_preview(
    *,
    units: Sequence[Mapping[str, Any]],
    candidates: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    candidates_by_unit: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        candidates_by_unit[str(candidate.get("unit_id") or "")].append(candidate)
    merge_units = []
    for unit in units:
        unit_id = str(unit.get("unit_id") or "")
        unit_candidates = candidates_by_unit.get(unit_id, [])
        merge_units.append(
            {
                "unit_id": unit_id,
                "source_notice_id": str(unit.get("source_notice_id") or ""),
                "source_surface": str(unit.get("source_surface") or ""),
                "title": str(unit.get("title") or ""),
                "source_url": str(unit.get("source_url") or ""),
                "phase4_multimodal_status": str(unit.get("multimodal_status") or ""),
                "multimodal_merge_status": merge_status(unit_candidates),
                "multimodal_candidate_ids": [str(item["candidate_id"]) for item in unit_candidates],
                "planned_multimodal_output_refs": [
                    {
                        "candidate_id": item["candidate_id"],
                        "status": item["status"],
                        "normalized_output_refs": item["normalized_output_refs"],
                    }
                    for item in unit_candidates
                ],
                "normalized_multimodal_fragments": [],
                "search_text_preview": str(unit.get("search_text") or ""),
                "provenance": {
                    "phase4_searchable_unit_id": unit_id,
                    "phase5_candidate_count": len(unit_candidates),
                },
            }
        )
    return {
        "schema_version": SEARCHABLE_MERGE_PREVIEW_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": False,
        "phase": PHASE_05_ID,
        "unit_count": len(merge_units),
        "candidate_count": len(candidates),
        "counts_by_merge_status": counter(merge_units, "multimodal_merge_status"),
        "units": merge_units,
    }


def gap_report(
    *,
    units: Sequence[Mapping[str, Any]],
    candidates: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    gaps = []
    for candidate in candidates:
        status = str(candidate.get("status") or "")
        if status == "skipped":
            continue
        if status in {"pending", "failed"}:
            gaps.append(
                {
                    "candidate_id": candidate["candidate_id"],
                    "unit_id": candidate["unit_id"],
                    "source_notice_id": candidate["source_notice_id"],
                    "title": candidate["title"],
                    "processing_family": candidate["processing_family"],
                    "media_kind": candidate["media_kind"],
                    "media_role": candidate.get("media_role", ""),
                    "target_blocking": bool(candidate.get("target_blocking")),
                    "priority": candidate["priority"],
                    "status": status,
                    "reason_codes": candidate["reason_codes"],
                }
            )
    high_value_skip_violations = [
        dict(item)
        for item in candidates
        if item.get("priority") == "high" and item.get("status") == "skipped"
    ]
    return {
        "schema_version": MULTIMODAL_GAP_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_05_ID,
        "unit_count": len(units),
        "candidate_count": len(candidates),
        "pending_without_output_count": sum(
            1 for item in candidates if item.get("status") == "pending"
        ),
        "failed_candidate_count": sum(1 for item in candidates if item.get("status") == "failed"),
        "missing_processable_media_count": sum(
            1
            for item in candidates
            if "missing_processable_media" in (item.get("reason_codes") or ())
        ),
        "unsupported_media_count": sum(
            1 for item in candidates if "unsupported_media_kind" in (item.get("reason_codes") or ())
        ),
        "skipped_low_value_count": sum(
            1
            for item in candidates
            if item.get("skip_reason")
            == NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER
        ),
        "high_value_pending_count": sum(
            1
            for item in candidates
            if item.get("priority") == "high" and item.get("status") == "pending"
        ),
        "high_value_skip_violation_count": len(high_value_skip_violations),
        "high_value_skip_violations": high_value_skip_violations,
        "gaps": gaps,
        "verdict": "requires_ocr_execution_before_downstream_replay"
        if gaps
        else "ready_for_searchable_merge",
    }


def preview_to_output_files(
    preview: Any,
) -> dict[str, dict[str, Any]]:
    return {
        "media-extraction-candidate-inventory.json": preview.candidate_inventory,
        "multimodal-candidate-inventory.json": preview.candidate_inventory,
        "multimodal-state-mapping-report.json": preview.state_mapping_report,
        "ocr-batch-manifest.dry-run.json": preview.ocr_batch_manifest,
        "ocr-attempt-plan.json": preview.ocr_attempt_plan,
        "multimodal-searchable-merge-preview.json": preview.searchable_merge_preview,
        "multimodal-gap-report.json": preview.gap_report,
    }


def notice_multimodal_consumption_contract_markdown() -> str:
    return """---
doc_type: contract
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Notice Multimodal Consumption Contract

## Scope

`notice_multimodal_consumption` is the notice-side contract for visual or
attachment-backed content that is already captured but not yet searchable as text.
It covers candidate selection, lifecycle state, attempts, provider output refs,
normalized text/layout artifacts, searchable merge input, and downstream
readiness evidence.

It does not own provider execution, prompt design, typed target extraction, or
query serving. Those remain in the existing OCR/multimodal processors and
downstream target consumers.

## Candidate

Each media object or blocked source-body recovery item becomes one candidate.
The identity is deterministic and includes source surface, site, notice id,
media ref, media object key, processing family, priority, and provenance back to
the Phase 4 searchable unit.

Candidate states:

- `pending`: processable media exists and no normalized output is available yet.
- `completed`: a terminal attempt produced searchable normalized output.
- `skipped`: policy intentionally excludes the media, with skip reason.
- `failed`: processing cannot proceed without source repair or unsupported media
  handling.

High-value `transport_schedule`, `service_status`, and `regulation` media must
not be skipped by low-value poster policy.

## Attempt Mapping

Existing attempt tables map into the unified lifecycle:

- `ingestion_projection.internal_notice_schedule_image_ocr_attempt`
  maps schedule image OCR attempts.
- `ingestion_projection.internal_notice_multimodal_attempt`
  maps internal notice image/PDF/Office multimodal attempts.
- `ingestion_projection.wechat_public_notice_multimodal_attempt`
  maps WeChat public notice inline image attempts.

Attempt rows must record provider, model, attempt number, status, source object
identity, admission batch id, and normalized output refs when present.

## Normalized Outputs

A completed attempt must expose separate refs for:

- raw provider response
- plain extracted text
- layout/table elements
- searchable merge input

Searchable merge input must preserve provenance: candidate id, source notice id,
media ref id, source object ref, provider/model, and attempt id.

## Dry-Run Boundary

Phase 5 readiness is read-only. It does not call providers, write object storage,
or write Postgres tables. It only produces manifests proving which candidates
would be processed and where normalized output would be attached later.
"""


__all__ = [
    "candidate_inventory",
    "gap_report",
    "notice_multimodal_consumption_contract_markdown",
    "ocr_attempt_plan",
    "ocr_batch_manifest",
    "preview_to_output_files",
    "searchable_merge_preview",
    "state_mapping_report",
]
