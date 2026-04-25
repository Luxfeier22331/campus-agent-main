from __future__ import annotations

from campus_ingestion_core.authenticated_notice_source_projections_classification import (
    _build_attachment_title,
    _classify_attachment_ref,
    build_authenticated_notice_attachment_projection_plans,
    build_authenticated_notice_attachment_routing_records,
)
from campus_ingestion_core.authenticated_notice_source_projections_engine import (
    _project_parent_source_truth as _project_parent_source_truth_impl,
)
from campus_ingestion_core.authenticated_notice_source_projections_engine import (
    _resolve_authenticated_notice_ocr_runtime,
    rebuild_authenticated_notice_source_projections_impl,
)
from campus_ingestion_core.authenticated_notice_source_projections_shared import (
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MULTIMODAL_PROCESSING_REQUIRED,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_UNSUPPORTED_BINARY,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MULTIMODAL_PROCESSING,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT,
    AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_SCHEMA_VERSION,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
    AuthenticatedNoticeAttachmentProjection,
    AuthenticatedNoticeAttachmentProjectionOutcome,
    AuthenticatedNoticeProjectedNotice,
    AuthenticatedNoticeSourceProjectionReport,
    AuthenticatedNoticeSourceProjectionRequest,
    AuthenticatedNoticeSourceProjectionsConfig,
    _AuthenticatedNoticeParentSourceTruth,
    _find_processed_key,
    _load_json_payload,
    _load_jsonl_rows,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.file_asset_text_extractable import (
    build_text_extractable_layout_elements_bytes,
    extract_text_extractable_file_asset,
)


def rebuild_authenticated_notice_source_projections(
    *,
    request: AuthenticatedNoticeSourceProjectionRequest,
    env: dict[str, str] | None = None,
    object_store=None,
    document_registry=None,
    raw_asset_registry=None,
    ocr_client=None,
) -> AuthenticatedNoticeSourceProjectionReport:
    return rebuild_authenticated_notice_source_projections_impl(
        request=request,
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        ocr_client=ocr_client,
        text_extractable_extractor=extract_text_extractable_file_asset,
        layout_elements_builder=build_text_extractable_layout_elements_bytes,
    )


def _project_parent_source_truth(
    *,
    parent_source_truth,
    config,
    object_store,
    object_store_settings,
    runtime_profile,
    ocr_runtime,
    ocr_provider_response_cache,
    env,
):
    return _project_parent_source_truth_impl(
        parent_source_truth=parent_source_truth,
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
        runtime_profile=runtime_profile,
        ocr_runtime=ocr_runtime,
        ocr_provider_response_cache=ocr_provider_response_cache,
        env=env,
        text_extractable_extractor=extract_text_extractable_file_asset,
        layout_elements_builder=build_text_extractable_layout_elements_bytes,
    )


__all__ = [
    "AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT",
    "AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MULTIMODAL_PROCESSING_REQUIRED",
    "AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT",
    "AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_UNSUPPORTED_BINARY",
    "AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT",
    "AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MULTIMODAL_PROCESSING",
    "AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT",
    "AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_SCHEMA_VERSION",
    "DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE",
    "DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION",
    "AuthenticatedNoticeAttachmentProjection",
    "AuthenticatedNoticeAttachmentProjectionOutcome",
    "AuthenticatedNoticeProjectedNotice",
    "AuthenticatedNoticeSourceProjectionReport",
    "AuthenticatedNoticeSourceProjectionRequest",
    "AuthenticatedNoticeSourceProjectionsConfig",
    "_AuthenticatedNoticeParentSourceTruth",
    "_build_attachment_title",
    "_classify_attachment_ref",
    "_find_processed_key",
    "_load_json_payload",
    "_load_jsonl_rows",
    "_project_parent_source_truth",
    "_resolve_authenticated_notice_ocr_runtime",
    "build_authenticated_notice_attachment_projection_plans",
    "build_authenticated_notice_attachment_routing_records",
    "load_authenticated_notice_source_projections_config",
    "read_authenticated_notice_source_projections_config_path",
    "rebuild_authenticated_notice_source_projections",
]
