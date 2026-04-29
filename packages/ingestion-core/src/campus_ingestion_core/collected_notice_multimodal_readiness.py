from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_multimodal_readiness_candidates import (
    candidate_records,
    selected_units,
)
from campus_ingestion_core.collected_notice_multimodal_readiness_reports import (
    candidate_inventory,
    gap_report,
    notice_multimodal_consumption_contract_markdown,
    ocr_attempt_plan,
    ocr_batch_manifest,
    preview_to_output_files,
    searchable_merge_preview,
    state_mapping_report,
)
from campus_ingestion_core.collected_notice_multimodal_readiness_shared import (
    PHASE_05_ID,
    CollectedNoticeMultimodalReadinessPreview,
)


def build_collected_notice_multimodal_readiness_preview_from_paths(
    *,
    invalid_defer_multimodal_report_path: Path,
    searchable_notice_preview_path: Path,
    generated_by: str = ("campus_ingestion_worker.preview_collected_notice_multimodal_readiness"),
) -> CollectedNoticeMultimodalReadinessPreview:
    invalid_defer_multimodal_report = _load_json_object(invalid_defer_multimodal_report_path)
    searchable_notice_preview = _load_json_object(searchable_notice_preview_path)
    return build_collected_notice_multimodal_readiness_preview(
        invalid_defer_multimodal_report=invalid_defer_multimodal_report,
        searchable_notice_preview=searchable_notice_preview,
        generated_by=generated_by,
    )


def build_collected_notice_multimodal_readiness_preview(
    *,
    invalid_defer_multimodal_report: Mapping[str, Any],
    searchable_notice_preview: Mapping[str, Any],
    generated_at: str | None = None,
    generated_by: str = ("campus_ingestion_worker.preview_collected_notice_multimodal_readiness"),
) -> CollectedNoticeMultimodalReadinessPreview:
    timestamp = generated_at or utc_now()
    units = selected_units(
        invalid_defer_multimodal_report=invalid_defer_multimodal_report,
        searchable_notice_preview=searchable_notice_preview,
    )
    candidates = candidate_records(units)
    return CollectedNoticeMultimodalReadinessPreview(
        candidate_inventory=candidate_inventory(
            units=units,
            candidates=candidates,
            generated_at=timestamp,
            generated_by=generated_by,
        ),
        state_mapping_report=state_mapping_report(
            candidates=candidates,
            generated_at=timestamp,
            generated_by=generated_by,
        ),
        ocr_batch_manifest=ocr_batch_manifest(
            candidates=candidates,
            generated_at=timestamp,
            generated_by=generated_by,
        ),
        ocr_attempt_plan=ocr_attempt_plan(
            candidates=candidates,
            generated_at=timestamp,
            generated_by=generated_by,
        ),
        searchable_merge_preview=searchable_merge_preview(
            units=units,
            candidates=candidates,
            generated_at=timestamp,
            generated_by=generated_by,
        ),
        gap_report=gap_report(
            units=units,
            candidates=candidates,
            generated_at=timestamp,
            generated_by=generated_by,
        ),
    )


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object: {path}")
    return payload


__all__ = [
    "PHASE_05_ID",
    "CollectedNoticeMultimodalReadinessPreview",
    "build_collected_notice_multimodal_readiness_preview",
    "build_collected_notice_multimodal_readiness_preview_from_paths",
    "notice_multimodal_consumption_contract_markdown",
    "preview_to_output_files",
]
