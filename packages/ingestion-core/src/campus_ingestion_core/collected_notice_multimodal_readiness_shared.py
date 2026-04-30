from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE,
)
from campus_ingestion_core.wechat_public_notice_multimodal import (
    DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
)

PHASE_05_ID = "phase-05-multimodal-ocr-consumption-readiness"
MEDIA_EXTRACTION_CANDIDATE_INVENTORY_SCHEMA_VERSION = (
    "notice_media_extraction_candidate_inventory.v1"
)
MEDIA_EXTRACTION_CANDIDATE_SCHEMA_VERSION = "notice_media_extraction_candidate.v1"
MULTIMODAL_CANDIDATE_INVENTORY_SCHEMA_VERSION = "notice_multimodal_candidate_inventory.v1"
MULTIMODAL_CANDIDATE_SCHEMA_VERSION = "notice_multimodal_candidate.v1"
MULTIMODAL_STATE_MAPPING_SCHEMA_VERSION = "notice_multimodal_state_mapping.v1"
OCR_BATCH_MANIFEST_SCHEMA_VERSION = "notice_multimodal_ocr_batch_manifest.v1"
OCR_ATTEMPT_PLAN_SCHEMA_VERSION = "notice_multimodal_ocr_attempt_plan.v1"
SEARCHABLE_MERGE_PREVIEW_SCHEMA_VERSION = "notice_multimodal_searchable_merge_preview.v1"
MULTIMODAL_GAP_REPORT_SCHEMA_VERSION = "notice_multimodal_gap_report.v1"
DEFAULT_PHASE_05_ADMISSION_BATCH_ID = "phase-05-multimodal-readiness-dry-run"
RELEASED_FILE_TEXT_EXTRACTION_ATTEMPT_TABLE = (
    "ingestion_projection.collected_notice_released_file_text_extraction_attempt"
)
PDF_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE = (
    "ingestion_projection.collected_notice_pdf_ocr_text_extraction_attempt"
)
OFFICE_TEXT_EXTRACTION_ATTEMPT_TABLE = (
    "ingestion_projection.collected_notice_office_text_extraction_attempt"
)
IMAGE_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE = (
    "ingestion_projection.collected_notice_image_ocr_text_extraction_attempt"
)


@dataclass(frozen=True, slots=True)
class CollectedNoticeMultimodalReadinessPreview:
    candidate_inventory: dict[str, Any]
    state_mapping_report: dict[str, Any]
    ocr_batch_manifest: dict[str, Any]
    ocr_attempt_plan: dict[str, Any]
    searchable_merge_preview: dict[str, Any]
    gap_report: dict[str, Any]


def source_attempt_tables() -> dict[str, dict[str, Any]]:
    return {
        DEFAULT_INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_ATTEMPT_TABLE: {
            "processing_family": "schedule_image_ocr",
            "join_key_fields": [
                "source_corpus",
                "source_collection",
                "source_notice_id",
                "attachment_ref_id",
                "image_index",
            ],
            "status_mapping": {
                "stored": "completed",
                "processed": "completed",
                "failed": "failed_retryable",
            },
            "normalized_output_fields": [
                "provider_response_key",
                "layout_elements_key",
                "ocr_manifest_key",
            ],
        },
        RELEASED_FILE_TEXT_EXTRACTION_ATTEMPT_TABLE: {
            "processing_family": "released_file_text_extraction",
            "join_key_fields": [
                "source_corpus",
                "source_collection",
                "source_notice_id",
                "unit_id",
                "media_ref_id",
                "attempt_number",
            ],
            "status_mapping": {
                "owner_text_ready": "completed",
                "failed": "failed_retryable",
                "failed_terminal": "failed_terminal",
                "no_extractable_text": "skipped",
            },
            "normalized_output_fields": [
                "provider_response",
                "plain_text",
                "layout_elements",
                "searchable_merge_input",
            ],
        },
        PDF_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE: {
            "processing_family": "pdf_ocr_text_extraction",
            "join_key_fields": [
                "source_corpus",
                "source_collection",
                "source_notice_id",
                "unit_id",
                "media_ref_id",
                "attempt_number",
            ],
            "status_mapping": {
                "owner_text_ready": "completed",
                "failed": "failed_retryable",
                "failed_terminal": "failed_terminal",
                "no_extractable_text": "skipped",
            },
            "normalized_output_fields": [
                "provider_response",
                "plain_text",
                "layout_elements",
                "searchable_merge_input",
            ],
        },
        OFFICE_TEXT_EXTRACTION_ATTEMPT_TABLE: {
            "processing_family": "office_text_extraction",
            "join_key_fields": [
                "source_corpus",
                "source_collection",
                "source_notice_id",
                "unit_id",
                "media_ref_id",
                "attempt_number",
            ],
            "status_mapping": {
                "owner_text_ready": "completed",
                "failed": "failed_retryable",
                "failed_terminal": "failed_terminal",
                "no_extractable_text": "skipped",
            },
            "normalized_output_fields": [
                "provider_response",
                "plain_text",
                "layout_elements",
                "searchable_merge_input",
            ],
        },
        IMAGE_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE: {
            "processing_family": "image_ocr_text_extraction",
            "join_key_fields": [
                "source_corpus",
                "source_collection",
                "source_notice_id",
                "unit_id",
                "media_ref_id",
                "attempt_number",
            ],
            "status_mapping": {
                "ocr_text_ready": "completed",
                "failed": "failed_retryable",
                "failed_terminal": "failed_terminal",
                "no_extractable_text": "skipped",
                "low_confidence": "manual_review",
            },
            "normalized_output_fields": [
                "provider_response",
                "plain_text",
                "layout_elements",
                "searchable_merge_input",
            ],
        },
        DEFAULT_WECHAT_PUBLIC_NOTICE_MULTIMODAL_ATTEMPT_TABLE: {
            "processing_family": "wechat_public_notice_multimodal",
            "join_key_fields": [
                "source_corpus",
                "source_collection",
                "source_notice_id",
                "unit_id",
                "media_ref_id",
                "attempt_number",
            ],
            "status_mapping": {
                "admitted": "completed",
                "no_extractable_text": "skipped",
                "fetch_failed": "failed_retryable",
                "ocr_failed": "failed_retryable",
                "pending": "pending",
            },
            "normalized_output_fields": [
                "fetch_manifest_key",
                "ocr_manifest_key",
                "provider_response_key",
                "layout_elements_key",
            ],
        },
    }


def family_lifecycle_counts(
    candidates: Sequence[Mapping[str, Any]],
) -> dict[str, dict[str, int]]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        grouped[str(candidate.get("processing_family") or "")].append(candidate)
    return {family: counter(items, "status") for family, items in sorted(grouped.items())}


def merge_status(candidates: Sequence[Mapping[str, Any]]) -> str:
    statuses = {str(item.get("status") or "") for item in candidates}
    if "pending" in statuses:
        return "pending"
    if "manual_review" in statuses:
        return "manual_review"
    if "failed_retryable" in statuses:
        return "failed_retryable"
    if "failed_terminal" in statuses:
        return "failed_terminal"
    if statuses == {"skipped"}:
        return "skipped"
    if "completed" in statuses:
        return "completed"
    return "not_required"


def counter(rows: Sequence[Mapping[str, Any]], key: str) -> dict[str, int]:
    return dict(Counter(str(row.get(key) or "") for row in rows))


def mapping_rows(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, Sequence) or isinstance(value, str):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


__all__ = [
    "DEFAULT_PHASE_05_ADMISSION_BATCH_ID",
    "IMAGE_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE",
    "MEDIA_EXTRACTION_CANDIDATE_INVENTORY_SCHEMA_VERSION",
    "MEDIA_EXTRACTION_CANDIDATE_SCHEMA_VERSION",
    "MULTIMODAL_CANDIDATE_INVENTORY_SCHEMA_VERSION",
    "MULTIMODAL_CANDIDATE_SCHEMA_VERSION",
    "MULTIMODAL_GAP_REPORT_SCHEMA_VERSION",
    "MULTIMODAL_STATE_MAPPING_SCHEMA_VERSION",
    "OCR_ATTEMPT_PLAN_SCHEMA_VERSION",
    "OCR_BATCH_MANIFEST_SCHEMA_VERSION",
    "OFFICE_TEXT_EXTRACTION_ATTEMPT_TABLE",
    "PDF_OCR_TEXT_EXTRACTION_ATTEMPT_TABLE",
    "PHASE_05_ID",
    "RELEASED_FILE_TEXT_EXTRACTION_ATTEMPT_TABLE",
    "SEARCHABLE_MERGE_PREVIEW_SCHEMA_VERSION",
    "CollectedNoticeMultimodalReadinessPreview",
    "counter",
    "family_lifecycle_counts",
    "mapping_rows",
    "merge_status",
    "source_attempt_tables",
]
