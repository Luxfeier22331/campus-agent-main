from __future__ import annotations

from campus_ingestion_core.authenticated_notice_source_truth_artifacts import (
    prepare_authenticated_notice_source_material,
)
from campus_ingestion_core.authenticated_notice_source_truth_shared import (
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
    AuthenticatedNoticeSourceMaterial,
    build_authenticated_notice_attachment_capture_key,
    build_authenticated_notice_raw_asset_id,
    build_authenticated_notice_raw_version_id,
    infer_authenticated_notice_year,
    resolve_authenticated_notice_attachment_object_key,
)

__all__ = [
    "AUTHENTICATED_NOTICE_SOURCE_CHANNEL",
    "AuthenticatedNoticeSourceMaterial",
    "build_authenticated_notice_attachment_capture_key",
    "build_authenticated_notice_raw_asset_id",
    "build_authenticated_notice_raw_version_id",
    "infer_authenticated_notice_year",
    "prepare_authenticated_notice_source_material",
    "resolve_authenticated_notice_attachment_object_key",
]
