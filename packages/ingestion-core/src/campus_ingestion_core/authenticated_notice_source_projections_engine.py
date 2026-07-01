from __future__ import annotations

import os

from campus_ingestion_core.authenticated_notice_source_projection_attachments import (
    LayoutElementsBuilder,
    TextExtractableExtractor,
    _build_attachment_projection_result,
)
from campus_ingestion_core.authenticated_notice_source_projection_cache import (
    _build_ocr_provider_response_cache,
    _OcrProviderResponseCache,
    _read_positive_env_int,
)
from campus_ingestion_core.authenticated_notice_source_projection_ocr_runtime import (
    _resolve_authenticated_notice_ocr_runtime,
)
from campus_ingestion_core.authenticated_notice_source_projections_classification import (
    _build_attachment_context_by_ref_id,
    _classify_attachment_ref,
)
from campus_ingestion_core.authenticated_notice_source_projections_shared import (
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
    AuthenticatedNoticeAttachmentProjectionOutcome,
    AuthenticatedNoticeOcrRuntime,
    AuthenticatedNoticeProjectedNotice,
    AuthenticatedNoticeProjectionObjectStore,
    AuthenticatedNoticeSourceProjectionReport,
    AuthenticatedNoticeSourceProjectionRequest,
    AuthenticatedNoticeSourceProjectionsConfig,
    _AuthenticatedNoticeParentSourceTruth,
    _build_parent_notice_document,
    _load_parent_source_truths,
    _parse_notice_document_id,
    _resolve_embedding_model,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.campus_agent_ingestion_support import (
    DocumentImportInput,
    collect_import_document_stats,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.raw_ingestion_online_ocr import OnlineOcrClient
from campus_ingestion_core.raw_ingestion_source_truth_support import S3ObjectStoreClient
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings


def rebuild_authenticated_notice_source_projections_impl(
    *,
    request: AuthenticatedNoticeSourceProjectionRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeProjectionObjectStore | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    ocr_client: OnlineOcrClient | None = None,
    ocr_clients: dict[str, OnlineOcrClient] | None = None,
    text_extractable_extractor: TextExtractableExtractor,
    layout_elements_builder: LayoutElementsBuilder,
) -> AuthenticatedNoticeSourceProjectionReport:
    source = env if env is not None else dict(os.environ)
    config_path = (
        request.source_projections_path
        or read_authenticated_notice_source_projections_config_path(source)
    )
    config = load_authenticated_notice_source_projections_config(config_path)
    if config.source_corpus != request.corpus or config.source_collection != request.collection:
        raise ValueError(
            "authenticated notice source projection config scope mismatch: "
            f"expected {request.corpus}/{request.collection}, "
            f"got {config.source_corpus}/{config.source_collection}"
        )

    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreClient(object_store_settings)
    registry = document_registry or build_document_registry_from_env(source)
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    parent_source_truths = _load_parent_source_truths(
        registry=registry,
        object_store=runtime_object_store,
        object_store_settings=object_store_settings,
        corpus=request.corpus,
        collection=request.collection,
        notice_ids=request.notice_ids,
    )
    if request.notice_ids:
        found_notice_ids = {
            _parse_notice_document_id(parent_source_truth.record.document_id)[1]
            for parent_source_truth in parent_source_truths
        }
        missing_notice_ids = tuple(
            notice_id for notice_id in request.notice_ids if notice_id not in found_notice_ids
        )
        if missing_notice_ids:
            raise ValueError(
                "authenticated notice source projection notice_ids not found in source-truth parents: "
                + ", ".join(missing_notice_ids)
            )
    if not parent_source_truths:
        raise ValueError(
            f"no authenticated notice source-truth parents found for {request.corpus}/{request.collection}"
        )

    runtime_ocr = (
        _resolve_authenticated_notice_ocr_runtime(
            env=source,
            runtime_profile=runtime_profile,
            ocr_client=ocr_client,
            ocr_clients=ocr_clients,
        )
        if ocr_client or ocr_clients
        else None
    )
    attachment_ref_count = 0
    projected_attachment_count = 0
    text_extractable_attachment_count = 0
    ocr_attachment_count = 0
    ocr_no_text_attachment_count = 0
    reference_only_attachment_count = 0
    multimodal_processing_attachment_count = 0
    unsupported_binary_attachment_count = 0
    documents: list[DocumentImportInput] = []
    ocr_provider_response_cache = _build_ocr_provider_response_cache(env=source)
    max_attachment_bytes = _read_positive_env_int(
        env=source,
        key="INGESTION_MAX_ATTACHMENT_BYTES",
        default=25 * 1024 * 1024,
    )
    max_ocr_input_bytes = _read_positive_env_int(
        env=source,
        key="INGESTION_MAX_OCR_INPUT_BYTES",
        default=25 * 1024 * 1024,
    )

    for parent_source_truth in parent_source_truths:
        projected_notice, runtime_ocr = _project_parent_source_truth(
            parent_source_truth=parent_source_truth,
            config=config,
            object_store=runtime_object_store,
            object_store_settings=object_store_settings,
            runtime_profile=runtime_profile,
            ocr_runtime=runtime_ocr,
            ocr_provider_response_cache=ocr_provider_response_cache,
            max_attachment_bytes=max_attachment_bytes,
            max_ocr_input_bytes=max_ocr_input_bytes,
            env=source,
            text_extractable_extractor=text_extractable_extractor,
            layout_elements_builder=layout_elements_builder,
        )
        documents.extend(projected_notice.documents)
        attachment_ref_count += len(parent_source_truth.attachment_refs)
        reference_only_attachment_count += projected_notice.reference_only_attachment_count
        unsupported_binary_attachment_count += projected_notice.unsupported_binary_attachment_count
        for outcome in projected_notice.attachment_outcomes:
            if outcome.outcome == AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT:
                projected_attachment_count += 1
            if outcome.classification == "text_extractable":
                text_extractable_attachment_count += 1
            elif outcome.classification == "ocr_required":
                ocr_attachment_count += 1
                if outcome.outcome == AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT:
                    ocr_no_text_attachment_count += 1
            elif outcome.classification == "multimodal_processing_required":
                multimodal_processing_attachment_count += 1

    stats = collect_import_document_stats(
        documents=documents,
        registry=registry,
        raw_asset_registry=runtime_raw_asset_registry,
        writer=runtime_object_store,
        object_store=object_store_settings,
        parser_version=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
        embedding_model=_resolve_embedding_model(parent_source_truths),
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        default_visibility_scope=request.default_visibility_scope,
        scope_refresh=None if request.notice_ids else (request.corpus, request.collection),
    )
    return AuthenticatedNoticeSourceProjectionReport(
        corpus=request.corpus,
        collection=request.collection,
        parent_notice_count=len(parent_source_truths),
        attachment_ref_count=attachment_ref_count,
        projected_attachment_count=projected_attachment_count,
        text_extractable_attachment_count=text_extractable_attachment_count,
        ocr_attachment_count=ocr_attachment_count,
        ocr_no_text_attachment_count=ocr_no_text_attachment_count,
        reference_only_attachment_count=reference_only_attachment_count,
        multimodal_processing_attachment_count=multimodal_processing_attachment_count,
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        skipped_document_ids=stats.skipped_document_ids,
        errors=stats.errors,
        unsupported_binary_attachment_count=unsupported_binary_attachment_count,
    )


def _project_parent_source_truth(
    *,
    parent_source_truth: _AuthenticatedNoticeParentSourceTruth,
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings: ObjectStoreSettings,
    runtime_profile,
    ocr_runtime: AuthenticatedNoticeOcrRuntime | None,
    ocr_provider_response_cache: _OcrProviderResponseCache | None,
    max_attachment_bytes: int,
    max_ocr_input_bytes: int,
    env: dict[str, str],
    text_extractable_extractor: TextExtractableExtractor,
    layout_elements_builder: LayoutElementsBuilder,
) -> tuple[AuthenticatedNoticeProjectedNotice, AuthenticatedNoticeOcrRuntime | None]:
    documents: list[DocumentImportInput] = [
        _build_parent_notice_document(
            parent_source_truth=parent_source_truth,
            runtime_profile=runtime_profile,
        )
    ]
    attachment_outcomes: list[AuthenticatedNoticeAttachmentProjectionOutcome] = []
    runtime_ocr = ocr_runtime
    reference_only_attachment_count = 0
    unsupported_binary_attachment_count = 0
    attachment_context_by_ref_id = _build_attachment_context_by_ref_id(
        record=parent_source_truth.record,
        attachment_refs=parent_source_truth.attachment_refs,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )
    for attachment_ref in parent_source_truth.attachment_refs:
        classification_result = _classify_attachment_ref(
            attachment_ref=attachment_ref,
            config=config,
            object_store=object_store,
            object_store_settings=object_store_settings,
            attachment_context_by_ref_id=attachment_context_by_ref_id,
        )
        classification = classification_result.classification
        if classification == "reference_only":
            reference_only_attachment_count += 1
            continue
        if classification == "unsupported_binary":
            unsupported_binary_attachment_count += 1
            continue
        if classification == "ocr_required" and runtime_ocr is None:
            runtime_ocr = _resolve_authenticated_notice_ocr_runtime(
                env=env,
                runtime_profile=runtime_profile,
                ocr_client=None,
                ocr_clients=None,
            )
        result = _build_attachment_projection_result(
            parent_source_truth=parent_source_truth,
            attachment_ref=attachment_ref,
            classification=classification,
            review_reason=classification_result.review_reason,
            config=config,
            object_store=object_store,
            object_store_settings=object_store_settings,
            ocr_runtime=runtime_ocr,
            ocr_provider_response_cache=ocr_provider_response_cache,
            max_attachment_bytes=max_attachment_bytes,
            max_ocr_input_bytes=max_ocr_input_bytes,
            runtime_profile=runtime_profile,
            text_extractable_extractor=text_extractable_extractor,
            layout_elements_builder=layout_elements_builder,
        )
        attachment_outcomes.append(result.outcome)
        if result.document is not None:
            documents.append(result.document)
    return (
        AuthenticatedNoticeProjectedNotice(
            documents=tuple(documents),
            attachment_outcomes=tuple(attachment_outcomes),
            reference_only_attachment_count=reference_only_attachment_count,
            unsupported_binary_attachment_count=unsupported_binary_attachment_count,
        ),
        runtime_ocr,
    )
