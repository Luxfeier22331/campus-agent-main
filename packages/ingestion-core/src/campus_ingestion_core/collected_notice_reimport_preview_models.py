from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.authenticated_notice_file_release_import import (
    FILE_RELEASE_SOURCE_SURFACE,
)

PHASE_04_ID = "phase-04-dry-run-reimport-and-universal-search-preview"
REIMPORT_DRY_RUN_SCHEMA_VERSION = "collected_notice_reimport_dry_run.v1"
SOURCE_TRUTH_PREVIEW_SCHEMA_VERSION = "collected_notice_source_truth_preview.v1"
SEARCHABLE_PREVIEW_SCHEMA_VERSION = "collected_notice_searchable_preview.v1"
SEARCHABLE_UNIT_SCHEMA_VERSION = "collected_notice_searchable_unit.v1"
SEARCHABLE_COVERAGE_SCHEMA_VERSION = "collected_notice_searchable_coverage_report.v1"
INVALID_DEFER_MULTIMODAL_SCHEMA_VERSION = (
    "collected_notice_invalid_defer_requires_multimodal_report.v1"
)
SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES = ("notice", FILE_RELEASE_SOURCE_SURFACE)
DEFAULT_PREVIEW_ADMISSION_BATCH_ID = "phase-04-dry-run-searchable-preview"
SEARCH_TEXT_MAX_CHARS = 2_000
BODY_TEXT_MAX_CHARS = 8_000


@dataclass(frozen=True, slots=True)
class CollectedNoticeCapturedRunRef:
    run_id: str
    source_surface: str
    source_bucket: str
    bundle_object_key: str
    manifest_object_key: str
    bundle_content_sha256: str | None = None
    bundle_byte_size: int | None = None
    manifest_content_sha256: str | None = None
    manifest_byte_size: int | None = None
    site_id: str | None = None
    source_home_url: str | None = None
    notices_collected: int | None = None

    def __post_init__(self) -> None:
        for field_name in (
            "run_id",
            "source_surface",
            "source_bucket",
            "bundle_object_key",
            "manifest_object_key",
            "bundle_content_sha256",
            "manifest_content_sha256",
            "site_id",
            "source_home_url",
        ):
            value = getattr(self, field_name)
            if isinstance(value, str):
                object.__setattr__(self, field_name, value.strip() or None)
        for field_name in (
            "run_id",
            "source_surface",
            "source_bucket",
            "bundle_object_key",
            "manifest_object_key",
        ):
            if not getattr(self, field_name):
                raise ValueError(f"{field_name} is required")
        if self.source_surface not in SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES:
            raise ValueError(f"unsupported source_surface: {self.source_surface}")


@dataclass(frozen=True, slots=True)
class CollectedNoticeReimportPreview:
    reimport_plan: dict[str, Any]
    source_truth_preview: dict[str, Any]
    searchable_notice_preview: dict[str, Any]
    coverage_report: dict[str, Any]
    invalid_defer_multimodal_report: dict[str, Any]


@dataclass(frozen=True, slots=True)
class PreparedPreviewItem:
    source_surface: str
    run_ref: CollectedNoticeCapturedRunRef
    source_identifier: str
    site_id: str
    source_corpus: str
    source_collection: str
    title: str
    published_at: str
    source_url: str
    source_home_url: str
    organization_name: str
    body_text: str
    content_blocks: tuple[dict[str, Any], ...]
    attachment_refs: tuple[dict[str, Any], ...]
    source_artifact_keys: dict[str, str]
    raw_asset_id: str
    raw_version_id: str
    document_id: str
    version_id: str
    content_hash: str
    revision_track: str
    canonical_markdown_object_key: str
    document_units_object_key: str
    processed_object_keys: tuple[str, ...]
    provider_response_object_key: str | None
    visibility_level: str
    visibility_scope: str | None
    entitlement_groups: tuple[str, ...]
    policy_projection_version: str
    source_object_refs: tuple[dict[str, Any], ...]
    multimodal_status: str
    reason_codes: tuple[str, ...]
    classification: dict[str, Any]
    source_retention: dict[str, Any]


__all__ = [
    "BODY_TEXT_MAX_CHARS",
    "DEFAULT_PREVIEW_ADMISSION_BATCH_ID",
    "INVALID_DEFER_MULTIMODAL_SCHEMA_VERSION",
    "PHASE_04_ID",
    "REIMPORT_DRY_RUN_SCHEMA_VERSION",
    "SEARCHABLE_COVERAGE_SCHEMA_VERSION",
    "SEARCHABLE_PREVIEW_SCHEMA_VERSION",
    "SEARCHABLE_UNIT_SCHEMA_VERSION",
    "SEARCH_TEXT_MAX_CHARS",
    "SOURCE_TRUTH_PREVIEW_SCHEMA_VERSION",
    "SUPPORTED_COLLECTED_NOTICE_SOURCE_SURFACES",
    "CollectedNoticeCapturedRunRef",
    "CollectedNoticeReimportPreview",
    "PreparedPreviewItem",
]
