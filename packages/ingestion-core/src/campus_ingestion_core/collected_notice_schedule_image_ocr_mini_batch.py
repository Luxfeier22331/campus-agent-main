from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_media_extraction_closeout import (
    build_schedule_image_ocr_media_extraction_closeout_result_manifest,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderResult,
    admit_schedule_image_ocr_child_document,
    normalize_schedule_image_ocr_attachment_ref_id,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_transport_schedule_materialization import (
    _extract_rows_from_table_matrix,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import _source_ref

PHASE_06_3_ID = "phase-06-3-schedule-image-ocr-mini-batch"
SCHEDULE_IMAGE_OCR_EXECUTION_MANIFEST_SCHEMA_VERSION = (
    "collected_notice_schedule_image_ocr_execution_manifest.v1"
)
SCHEDULE_IMAGE_OCR_GAP_REPORT_SCHEMA_VERSION = "collected_notice_schedule_image_ocr_gap_report.v1"
SCHEDULE_IMAGE_OCR_SEARCHABLE_MERGE_SCHEMA_VERSION = (
    "collected_notice_schedule_image_ocr_searchable_merge_preview.v1"
)
SCHEDULE_IMAGE_OCR_TRANSPORT_REPLAY_SCHEMA_VERSION = (
    "collected_notice_schedule_image_ocr_transport_replay_dry_run.v1"
)
SCHEDULE_IMAGE_OCR_TRANSPORT_STAGE_SCHEMA_VERSION = (
    "collected_notice_schedule_image_ocr_transport_stage_report.v1"
)
SCHEDULE_IMAGE_OCR_TRANSPORT_CONSISTENCY_SCHEMA_VERSION = (
    "collected_notice_schedule_image_ocr_transport_consistency_report.v1"
)


def build_schedule_image_ocr_mini_batch_manifest_from_paths(
    *,
    consumer_admission_manifest_path: Path,
    multimodal_candidate_inventory_path: Path,
    generated_by: str = "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch",
) -> dict[str, Any]:
    return build_schedule_image_ocr_mini_batch_manifest(
        consumer_admission_manifest=_load_json_object(consumer_admission_manifest_path),
        multimodal_candidate_inventory=_load_json_object(multimodal_candidate_inventory_path),
        generated_by=generated_by,
    )


def build_schedule_image_ocr_mini_batch_manifest(
    *,
    consumer_admission_manifest: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch",
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    eligible_entries = _eligible_admission_entries(consumer_admission_manifest)
    eligible_by_notice_id = {
        str(entry.get("source_notice_id") or ""): dict(entry) for entry in eligible_entries
    }
    selected: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for candidate in _mapping_rows(multimodal_candidate_inventory.get("candidates")):
        if str(candidate.get("processing_family") or "") != "schedule_image_ocr":
            continue
        decision = _candidate_selection_decision(
            candidate=candidate,
            eligible_by_notice_id=eligible_by_notice_id,
        )
        if decision:
            blocked.append({**_candidate_ref(candidate), "reason_codes": decision})
            continue
        selected.append(_execution_entry(candidate, eligible_by_notice_id))
    selected = sorted(
        selected,
        key=lambda item: (str(item["source_notice_id"]), int(item["image_index"] or 0)),
    )
    blocked = sorted(
        blocked, key=lambda item: (str(item["source_notice_id"]), item["candidate_id"])
    )
    evidence_inventory = [_evidence_inventory_row(entry) for entry in selected]
    selected_notice_ids = sorted({str(entry["source_notice_id"]) for entry in selected})
    execution_manifest = {
        "schema_version": SCHEDULE_IMAGE_OCR_EXECUTION_MANIFEST_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": True,
        "object_store_writes_enabled": False,
        "db_writes_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_3_ID,
        "selection_policy": {
            "name": "phase6-3-baseline-aware-schedule-image-ocr-mini-batch",
            "version": "v1",
        },
        "selected_notice_ids": selected_notice_ids,
        "counts": {
            "selected_notice_count": len(selected_notice_ids),
            "selected_image_count": len(selected),
            "blocked_candidate_count": len(blocked),
        },
        "entries": selected,
    }
    gap_report = {
        "schema_version": SCHEDULE_IMAGE_OCR_GAP_REPORT_SCHEMA_VERSION,
        "generated_at": timestamp,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_3_ID,
        "selected_notice_ids": selected_notice_ids,
        "selected_image_count": len(selected),
        "blocked_candidate_count": len(blocked),
        "blocked_candidates": blocked,
    }
    return {
        "execution_manifest": execution_manifest,
        "evidence_inventory": evidence_inventory,
        "gap_report": gap_report,
    }


def build_schedule_image_ocr_mini_batch_post_run_preview_from_paths(
    *,
    searchable_notice_preview_path: Path,
    execution_manifest_path: Path,
    ocr_output_dir: Path,
    generated_by: str = "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch",
) -> dict[str, Any]:
    return build_schedule_image_ocr_mini_batch_post_run_preview(
        searchable_notice_preview=_load_json_object(searchable_notice_preview_path),
        execution_manifest=_load_json_object(execution_manifest_path),
        ocr_output_dir=ocr_output_dir,
        generated_by=generated_by,
    )


def build_schedule_image_ocr_mini_batch_post_run_preview(
    *,
    searchable_notice_preview: Mapping[str, Any],
    execution_manifest: Mapping[str, Any],
    ocr_output_dir: Path,
    generated_at: str | None = None,
    generated_by: str = "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch",
) -> dict[str, Any]:
    timestamp = generated_at or utc_now()
    items = _load_ocr_items(ocr_output_dir=ocr_output_dir, execution_manifest=execution_manifest)
    units_by_notice_id = _searchable_units_by_notice_id(searchable_notice_preview)
    fragments_by_notice_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    rows: list[dict[str, Any]] = []
    item_reports: list[dict[str, Any]] = []
    for item in items:
        evidence = item["evidence"]
        result = item["result"]
        decision = admit_schedule_image_ocr_child_document(
            evidence=evidence,
            result=result,
            generated_at=timestamp,
        )
        fragment = _normalized_fragment(
            evidence=evidence,
            result=result,
            admission_status=decision.status,
            admission_reason=decision.reason,
        )
        fragments_by_notice_id[evidence.notice_id].append(fragment)
        unit = units_by_notice_id.get(evidence.notice_id)
        extracted_rows: list[dict[str, Any]] = []
        if unit is not None and decision.document is not None:
            extracted_rows = _transport_rows_from_ocr_tables(
                unit=unit,
                evidence=evidence,
                result=result,
                source_attachment_document_id=decision.document.document_id,
            )
            rows.extend(extracted_rows)
        item_reports.append(
            {
                "notice_id": evidence.notice_id,
                "attachment_ref_id": evidence.attachment_ref_id,
                "image_index": evidence.image_index,
                "provider": result.provider,
                "model": result.model,
                "confidence": result.confidence,
                "table_count": len(result.tables),
                "admission_status": decision.status,
                "admission_reason": decision.reason,
                "extracted_schedule_row_count": len(extracted_rows),
            }
        )
    searchable_merge_preview = _searchable_merge_preview(
        units_by_notice_id=units_by_notice_id,
        execution_manifest=execution_manifest,
        fragments_by_notice_id=fragments_by_notice_id,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    transport_replay = _transport_replay_dry_run(
        rows=rows,
        execution_manifest=execution_manifest,
        item_reports=item_reports,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    transport_stage = _transport_stage_report(
        rows=rows,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    consistency = _transport_consistency_report(
        execution_manifest=execution_manifest,
        transport_replay=transport_replay,
        transport_stage=transport_stage,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    gap_report = _post_run_gap_report(
        execution_manifest=execution_manifest,
        item_reports=item_reports,
        generated_at=timestamp,
        generated_by=generated_by,
    )
    closeout_result_manifest = build_schedule_image_ocr_media_extraction_closeout_result_manifest(
        execution_manifest=execution_manifest,
        post_run_preview={"post_run_gap_report": gap_report},
        generated_at=timestamp,
    )
    return {
        "searchable_merge_preview": searchable_merge_preview,
        "transport_replay_dry_run": transport_replay,
        "transport_stage_report": transport_stage,
        "transport_consistency_report": consistency,
        "post_run_gap_report": gap_report,
        "media_extraction_closeout_result_manifest": closeout_result_manifest,
    }


def mini_batch_manifest_output_files(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schedule-image-ocr-execution-manifest.json": payload["execution_manifest"],
        "schedule-image-ocr-evidence-inventory.json": payload["evidence_inventory"],
        "schedule-image-ocr-gap-report.json": payload["gap_report"],
    }


def mini_batch_post_run_output_files(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schedule-image-ocr-searchable-merge-preview.json": payload["searchable_merge_preview"],
        "transport-ocr-replay.dry-run.json": payload["transport_replay_dry_run"],
        "transport-ocr-stage-report.json": payload["transport_stage_report"],
        "transport-ocr-consistency-report.json": payload["transport_consistency_report"],
        "schedule-image-ocr-post-run-gap-report.json": payload["post_run_gap_report"],
        "media-extraction-closeout-result-manifest.json": payload[
            "media_extraction_closeout_result_manifest"
        ],
    }


def _eligible_admission_entries(manifest: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    return tuple(
        row
        for row in _mapping_rows(manifest.get("entries"))
        if str(row.get("consumption_class") or "") == "needs_multimodal"
        and str(row.get("ocr_priority") or "") == "execute_now"
    )


def _candidate_selection_decision(
    *,
    candidate: Mapping[str, Any],
    eligible_by_notice_id: Mapping[str, Mapping[str, Any]],
) -> list[str]:
    reasons: list[str] = []
    notice_id = str(candidate.get("source_notice_id") or "")
    if notice_id not in eligible_by_notice_id:
        reasons.append("notice_not_ocr_execute_now")
    if str(candidate.get("media_kind") or "") != "image":
        reasons.append("candidate_not_image")
    if str(candidate.get("priority") or "") != "high":
        reasons.append("candidate_not_high_priority")
    if str(candidate.get("status") or "") not in {"pending", "failed"}:
        reasons.append("candidate_not_pending_or_failed")
    source_ref = candidate.get("source_object_ref")
    if not isinstance(source_ref, Mapping) or not str(source_ref.get("key") or "").strip():
        reasons.append("missing_source_object_ref")
    return list(dict.fromkeys(reasons))


def _execution_entry(
    candidate: Mapping[str, Any],
    eligible_by_notice_id: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    source_ref = dict(candidate.get("source_object_ref") or {})
    notice_id = str(candidate.get("source_notice_id") or "")
    admission_entry = dict(eligible_by_notice_id.get(notice_id) or {})
    return {
        "candidate_id": str(candidate.get("candidate_id") or ""),
        "unit_id": str(candidate.get("unit_id") or ""),
        "source_notice_id": notice_id,
        "title": str(candidate.get("title") or admission_entry.get("title") or ""),
        "published_at": str(
            candidate.get("published_at") or admission_entry.get("published_at") or ""
        ),
        "media_ref_id": str(candidate.get("media_ref_id") or ""),
        "image_index": int(candidate.get("image_index") or 0),
        "media_kind": str(candidate.get("media_kind") or ""),
        "processing_family": str(candidate.get("processing_family") or ""),
        "priority": str(candidate.get("priority") or ""),
        "status": str(candidate.get("status") or ""),
        "source_object_ref": source_ref,
        "normalized_output_refs": dict(candidate.get("normalized_output_refs") or {}),
        "attempt_ledger": dict(candidate.get("attempt_ledger") or {}),
        "admission_context": {
            "consumption_class": str(admission_entry.get("consumption_class") or ""),
            "overlay_kind": str(admission_entry.get("overlay_kind") or ""),
            "temporal_relation": str(admission_entry.get("temporal_relation") or ""),
            "ocr_priority": str(admission_entry.get("ocr_priority") or ""),
            "baseline_gate_reason_codes": list(
                admission_entry.get("baseline_gate_reason_codes") or ()
            ),
        },
        "reason_codes": list(candidate.get("reason_codes") or ()),
    }


def _evidence_inventory_row(entry: Mapping[str, Any]) -> dict[str, Any]:
    source_ref = dict(entry.get("source_object_ref") or {})
    object_key = str(source_ref.get("key") or "")
    return {
        "notice_id": str(entry.get("source_notice_id") or ""),
        "source_notice_id": str(entry.get("source_notice_id") or ""),
        "notice_title": str(entry.get("title") or ""),
        "release_time": str(entry.get("published_at") or ""),
        "organization": "",
        "image_index": int(entry.get("image_index") or 0),
        "attachment_ref_id": normalize_schedule_image_ocr_attachment_ref_id(
            str(entry.get("media_ref_id") or "")
        ),
        "filename": Path(object_key).name,
        "mime_type": str(source_ref.get("mime_type") or "application/octet-stream"),
        "byte_size": int(source_ref.get("byte_size") or 0),
        "sha256": str(source_ref.get("sha256") or ""),
        "object_key": object_key,
        "object_exists": bool(object_key and source_ref.get("sha256")),
        "image_use": "schedule_table_image",
        "reason_codes": list(entry.get("reason_codes") or ()),
        "context_before": str(entry.get("title") or ""),
        "context_after": "",
    }


def _candidate_ref(candidate: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "candidate_id": str(candidate.get("candidate_id") or ""),
        "unit_id": str(candidate.get("unit_id") or ""),
        "source_notice_id": str(candidate.get("source_notice_id") or ""),
        "title": str(candidate.get("title") or ""),
        "media_ref_id": str(candidate.get("media_ref_id") or ""),
        "image_index": int(candidate.get("image_index") or 0),
        "processing_family": str(candidate.get("processing_family") or ""),
        "status": str(candidate.get("status") or ""),
    }


def _load_ocr_items(
    *,
    ocr_output_dir: Path,
    execution_manifest: Mapping[str, Any],
) -> tuple[dict[str, Any], ...]:
    expected = {
        (str(entry.get("source_notice_id") or ""), int(entry.get("image_index") or 0))
        for entry in _mapping_rows(execution_manifest.get("entries"))
    }
    items: list[dict[str, Any]] = []
    for manifest_path in sorted(Path(ocr_output_dir).glob("**/manifest.json")):
        evidence = _evidence_from_payload(_read_json_object(manifest_path))
        if (evidence.notice_id, evidence.image_index) not in expected:
            continue
        result = _provider_result_from_payload(
            _read_json_object(manifest_path.parent / "ocr-result.json")
        )
        items.append({"evidence": evidence, "result": result})
    return tuple(items)


def _evidence_from_payload(payload: Mapping[str, Any]) -> ScheduleImageOcrEvidence:
    return ScheduleImageOcrEvidence(
        notice_id=_required_text(payload, "notice_id"),
        notice_title=_text(payload.get("notice_title")),
        release_time=_text(payload.get("release_time")),
        organization=_text(payload.get("organization")),
        image_index=int(payload.get("image_index") or 0),
        attachment_ref_id=normalize_schedule_image_ocr_attachment_ref_id(
            _text(payload.get("attachment_ref_id"))
        ),
        filename=_text(payload.get("filename")),
        mime_type=_text(payload.get("mime_type")) or "application/octet-stream",
        byte_size=int(payload.get("byte_size") or 0),
        sha256=_required_text(payload, "sha256"),
        object_key=_required_text(payload, "object_key"),
        image_use=_text(payload.get("image_use")) or "schedule_image_candidate",
        reason_codes=tuple(str(item) for item in payload.get("reason_codes") or () if str(item)),
        context_before=_text(payload.get("context_before")),
        context_after=_text(payload.get("context_after")),
    )


def _provider_result_from_payload(payload: Mapping[str, Any]) -> ScheduleImageOcrProviderResult:
    return ScheduleImageOcrProviderResult(
        provider=_text(payload.get("provider")) or "unknown",
        model=_text(payload.get("model")) or "unknown",
        confidence=_confidence(_text(payload.get("confidence"))),
        extracted_text=_text(payload.get("extracted_text")),
        tables=_tables(payload.get("tables")),
        layout_elements=tuple(
            dict(item) for item in payload.get("layout_elements") or () if isinstance(item, dict)
        ),
        raw_response=payload.get("raw_response") if "raw_response" in payload else dict(payload),
    )


def _searchable_units_by_notice_id(
    searchable_notice_preview: Mapping[str, Any],
) -> dict[str, Mapping[str, Any]]:
    return {
        str(unit.get("source_notice_id") or ""): unit
        for unit in _mapping_rows(searchable_notice_preview.get("units"))
    }


def _normalized_fragment(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    admission_status: str,
    admission_reason: str,
) -> dict[str, Any]:
    return {
        "source_notice_id": evidence.notice_id,
        "attachment_ref_id": evidence.attachment_ref_id,
        "image_index": evidence.image_index,
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "admission_status": admission_status,
        "admission_reason": admission_reason,
        "text": result.extracted_text,
        "table_count": len(result.tables),
        "tables": [[list(row) for row in table] for table in result.tables],
    }


def _transport_rows_from_ocr_tables(
    *,
    unit: Mapping[str, Any],
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    source_attachment_document_id: str,
) -> list[dict[str, Any]]:
    entry = _projection_entry(unit)
    source_ref = _source_ref(entry)
    parent_text = "\n".join(
        text
        for text in (
            str(unit.get("body_text") or ""),
            evidence.notice_title,
            result.extracted_text,
        )
        if text
    )
    rows = []
    for table in result.tables:
        rows.extend(
            _extract_rows_from_table_matrix(
                matrix=table,
                projection_entry=entry,
                source_ref=source_ref,
                source_attachment_document_id=source_attachment_document_id,
                parent_text=parent_text,
            )
        )
    return [_row_payload(row) for row in rows]


def _searchable_merge_preview(
    *,
    units_by_notice_id: Mapping[str, Mapping[str, Any]],
    execution_manifest: Mapping[str, Any],
    fragments_by_notice_id: Mapping[str, Sequence[Mapping[str, Any]]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    selected_notice_ids = tuple(
        str(item) for item in execution_manifest.get("selected_notice_ids") or ()
    )
    units = []
    for notice_id in selected_notice_ids:
        unit = dict(units_by_notice_id.get(notice_id) or {})
        fragments = [dict(item) for item in fragments_by_notice_id.get(notice_id, ())]
        base_text = str(unit.get("search_text") or unit.get("body_text") or "")
        fragment_text = "\n\n".join(
            str(item.get("text") or "")
            for item in fragments
            if item.get("admission_status") == "admitted" and item.get("text")
        )
        units.append(
            {
                "unit_id": unit.get("unit_id", ""),
                "source_notice_id": notice_id,
                "title": unit.get("title", ""),
                "phase4_multimodal_status": unit.get("multimodal_status", ""),
                "multimodal_merge_status": _merge_status(fragments),
                "normalized_multimodal_fragments": fragments,
                "search_text_preview": "\n\n".join(
                    item for item in (base_text, fragment_text) if item
                ),
                "provenance": {
                    "phase4_searchable_unit_id": unit.get("unit_id", ""),
                    "phase6_3_execution_manifest_schema": execution_manifest.get(
                        "schema_version", ""
                    ),
                },
            }
        )
    return {
        "schema_version": SCHEDULE_IMAGE_OCR_SEARCHABLE_MERGE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": True,
        "phase": PHASE_06_3_ID,
        "unit_count": len(units),
        "fragment_count": sum(len(row["normalized_multimodal_fragments"]) for row in units),
        "units": units,
    }


def _merge_status(fragments: Sequence[Mapping[str, Any]]) -> str:
    if not fragments:
        return "pending"
    admitted_count = sum(1 for item in fragments if item.get("admission_status") == "admitted")
    if admitted_count == len(fragments):
        return "completed"
    if admitted_count:
        return "partial_requires_review"
    return "requires_review"


def _transport_replay_dry_run(
    *,
    rows: Sequence[Mapping[str, Any]],
    execution_manifest: Mapping[str, Any],
    item_reports: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    return {
        "schema_version": SCHEDULE_IMAGE_OCR_TRANSPORT_REPLAY_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "provider_calls_enabled": True,
        "current_promotion_enabled": False,
        "phase": PHASE_06_3_ID,
        "target": "transport_schedule",
        "source_notice_ids": list(execution_manifest.get("selected_notice_ids") or ()),
        "ocr_item_count": len(item_reports),
        "extracted_schedule_row_count": len(rows),
        "transport_schedule_rows": [dict(row) for row in rows],
        "ocr_item_reports": [dict(row) for row in item_reports],
    }


def _transport_stage_report(
    *,
    rows: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    candidates = [
        {
            "stage_candidate_id": (
                "stage:transport_schedule:ocr:"
                f"{row.get('source_notice_id')}:{row.get('source_attachment_document_id')}:{index}"
            ),
            "source_notice_id": row.get("source_notice_id"),
            "target": "transport_schedule",
            "row": dict(row),
        }
        for index, row in enumerate(rows, start=1)
    ]
    return {
        "schema_version": SCHEDULE_IMAGE_OCR_TRANSPORT_STAGE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "phase": PHASE_06_3_ID,
        "target": "transport_schedule",
        "stage_candidate_count": len(candidates),
        "stage_candidates": candidates,
    }


def _transport_consistency_report(
    *,
    execution_manifest: Mapping[str, Any],
    transport_replay: Mapping[str, Any],
    transport_stage: Mapping[str, Any],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    selected_image_count = int(
        (execution_manifest.get("counts") or {}).get("selected_image_count") or 0
    )
    if selected_image_count and not transport_replay.get("extracted_schedule_row_count"):
        issues.append({"field": "transport_schedule_rows", "reason": "no_ocr_rows_extracted"})
    if transport_replay.get("extracted_schedule_row_count") != transport_stage.get(
        "stage_candidate_count"
    ):
        issues.append({"field": "stage_candidate_count", "reason": "does_not_match_extracted_rows"})
    return {
        "schema_version": SCHEDULE_IMAGE_OCR_TRANSPORT_CONSISTENCY_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_3_ID,
        "target": "transport_schedule",
        "verdict": "passed" if not issues else "blocked",
        "issues": issues,
        "selected_notice_ids": list(execution_manifest.get("selected_notice_ids") or ()),
        "selected_image_count": selected_image_count,
        "extracted_schedule_row_count": transport_replay.get("extracted_schedule_row_count", 0),
        "stage_candidate_count": transport_stage.get("stage_candidate_count", 0),
        "current_promotion_enabled": False,
    }


def _post_run_gap_report(
    *,
    execution_manifest: Mapping[str, Any],
    item_reports: Sequence[Mapping[str, Any]],
    generated_at: str,
    generated_by: str,
) -> dict[str, Any]:
    expected = {
        (str(entry.get("source_notice_id") or ""), int(entry.get("image_index") or 0))
        for entry in _mapping_rows(execution_manifest.get("entries"))
    }
    observed = {
        (str(item.get("notice_id") or ""), int(item.get("image_index") or 0))
        for item in item_reports
    }
    missing = sorted(expected - observed)
    rejected = [
        dict(item) for item in item_reports if str(item.get("admission_status") or "") != "admitted"
    ]
    return {
        "schema_version": SCHEDULE_IMAGE_OCR_GAP_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_06_3_ID,
        "expected_image_count": len(expected),
        "observed_image_count": len(observed),
        "missing_ocr_output_count": len(missing),
        "rejected_ocr_item_count": len(rejected),
        "missing_ocr_outputs": [
            {"source_notice_id": notice_id, "image_index": image_index}
            for notice_id, image_index in missing
        ],
        "rejected_ocr_items": rejected,
        "verdict": "ready_for_transport_replay"
        if not missing and not rejected
        else "requires_review",
    }


def _projection_entry(unit: Mapping[str, Any]) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
        source_corpus=str(unit.get("source_corpus") or "campus_notices"),
        source_collection=str(unit.get("source_collection") or "internal_notice"),
        source_notice_id=str(unit.get("source_notice_id") or ""),
        unit_id=str(unit.get("unit_id") or ""),
        primary_role=NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_CAMPUS_SERVICES,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        temporal_policy=NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=str(unit.get("source_document_id") or ""),
        source_notice_release_time=str(unit.get("published_at") or ""),
        role_metadata={
            "notice_title": str(unit.get("title") or ""),
            "organization_name": "",
            "service_status_candidate_kind": "transport_schedule",
        },
        updated_at=str(unit.get("updated_at") or ""),
    )


def _row_payload(row: Any) -> dict[str, Any]:
    payload = asdict(row)
    payload["service_date_ranges"] = [list(item) for item in row.service_date_ranges]
    return payload


def _tables(value: object) -> tuple[tuple[tuple[str, ...], ...], ...]:
    if not isinstance(value, list | tuple):
        return ()
    tables: list[tuple[tuple[str, ...], ...]] = []
    for raw_table in value:
        if not isinstance(raw_table, list | tuple):
            continue
        rows: list[tuple[str, ...]] = []
        for raw_row in raw_table:
            if isinstance(raw_row, list | tuple):
                rows.append(tuple(str(cell or "").strip() for cell in raw_row))
        if rows:
            tables.append(tuple(rows))
    return tuple(tables)


def _confidence(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"high", "medium", "low"}:
        return normalized
    return "low"


def _mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(row for row in value if isinstance(row, Mapping))


def _load_json_object(path: Path) -> dict[str, Any]:
    return _read_json_object(Path(path))


def _read_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


def _text(value: object) -> str:
    return str(value or "").strip()


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = _text(payload.get(key))
    if not value:
        raise ValueError(f"schedule image OCR payload missing required field: {key}")
    return value


__all__ = [
    "PHASE_06_3_ID",
    "build_schedule_image_ocr_mini_batch_manifest",
    "build_schedule_image_ocr_mini_batch_manifest_from_paths",
    "build_schedule_image_ocr_mini_batch_post_run_preview",
    "build_schedule_image_ocr_mini_batch_post_run_preview_from_paths",
    "mini_batch_manifest_output_files",
    "mini_batch_post_run_output_files",
]
