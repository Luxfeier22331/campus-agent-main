from __future__ import annotations

import hashlib
import os
from collections.abc import Callable

from campus_ingestion_core.authenticated_notice_attachment_ocr import (
    build_authenticated_notice_ocr_attachment_artifacts,
)
from campus_ingestion_core.authenticated_notice_source_projections_classification import (
    _build_attachment_context_by_ref_id,
    _build_attachment_title,
    _build_attachment_version_id,
    _build_text_extractable_provider_payload,
    _classify_attachment_ref,
    _guess_attachment_filename,
    _materialization_policy_for_classification,
    _resolve_attachment_kind,
    _resolve_attachment_role,
)
from campus_ingestion_core.authenticated_notice_source_projections_shared import (
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MULTIMODAL_PROCESSING_REQUIRED,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    AuthenticatedNoticeAttachmentProjectionOutcome,
    AuthenticatedNoticeAttachmentProjectionResult,
    AuthenticatedNoticeOcrProviderRuntime,
    AuthenticatedNoticeOcrRuntime,
    AuthenticatedNoticeProjectedNotice,
    AuthenticatedNoticeProjectionObjectStore,
    AuthenticatedNoticeSourceProjectionReport,
    AuthenticatedNoticeSourceProjectionRequest,
    AuthenticatedNoticeSourceProjectionsConfig,
    _AuthenticatedNoticeParentSourceTruth,
    _build_attachment_document_units_bytes,
    _build_attachment_document_units_bytes_from_layout_rows,
    _build_attachment_markdown_body,
    _build_attachment_markdown_body_from_layout_rows,
    _build_parent_notice_document,
    _derive_notice_year,
    _load_jsonl_rows,
    _load_parent_source_truths,
    _normalize_authenticated_notice_ocr_provider_payload,
    _normalize_optional_text,
    _parse_notice_document_id,
    _render_canonical_markdown,
    _resolve_embedding_model,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.file_asset_contract import ExtractionOutcome
from campus_ingestion_core.raw_ingestion import (
    ONLINE_OCR_PROVIDER_MINERU_API,
    OnlineOcrClient,
    OnlineOcrSettings,
    S3ObjectStoreClient,
    build_online_ocr_client,
    parse_online_ocr_bytes,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings

TextExtractableExtractor = Callable[..., ExtractionOutcome]
LayoutElementsBuilder = Callable[..., bytes | None]


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
    ocr_provider_response_cache: dict[str, bytes] = {}

    for parent_source_truth in parent_source_truths:
        projected_notice, runtime_ocr = _project_parent_source_truth(
            parent_source_truth=parent_source_truth,
            config=config,
            object_store=runtime_object_store,
            object_store_settings=object_store_settings,
            runtime_profile=runtime_profile,
            ocr_runtime=runtime_ocr,
            ocr_provider_response_cache=ocr_provider_response_cache,
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
    ocr_provider_response_cache: dict[str, bytes] | None,
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


def _resolve_authenticated_notice_ocr_runtime(
    *,
    env: dict[str, str] | None,
    runtime_profile=None,
    ocr_client: OnlineOcrClient | None,
    ocr_clients: dict[str, OnlineOcrClient] | None = None,
) -> AuthenticatedNoticeOcrRuntime:
    source = env if env is not None else {}
    active_settings = OnlineOcrSettings.from_env(source, required=False)
    mineru_settings = OnlineOcrSettings.from_env(
        source,
        prefix="OCR_MINERU_",
        default_provider=ONLINE_OCR_PROVIDER_MINERU_API,
    )
    settings_by_provider: dict[str, OnlineOcrSettings] = {}
    if active_settings is not None:
        settings_by_provider[active_settings.provider] = active_settings
    if mineru_settings is not None:
        settings_by_provider[mineru_settings.provider] = mineru_settings

    explicit_clients = dict(ocr_clients or {})
    single_client_provider = (
        active_settings.provider if active_settings is not None else ONLINE_OCR_PROVIDER_ASYNC_JOBS
    )
    if ocr_client is not None and single_client_provider not in explicit_clients:
        explicit_clients[single_client_provider] = ocr_client

    available_providers = set(settings_by_provider) | set(explicit_clients)
    if not available_providers:
        OnlineOcrSettings.from_env(source, required=True)
        raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")

    preferred_provider = str(getattr(runtime_profile, "source_ocr_provider", "") or "").strip()
    active_provider = (
        active_settings.provider if active_settings is not None else single_client_provider
    )
    primary_provider = (
        preferred_provider if preferred_provider in available_providers else active_provider
    )
    if primary_provider not in available_providers:
        primary_provider = sorted(available_providers)[0]

    primary_runtime = _build_authenticated_notice_ocr_provider_runtime(
        provider=primary_provider,
        settings_by_provider=settings_by_provider,
        explicit_clients=explicit_clients,
    )
    fallback_runtimes: list[AuthenticatedNoticeOcrProviderRuntime] = []
    fallback_enabled = bool(getattr(runtime_profile, "source_ocr_fallback_enabled", False))
    if fallback_enabled:
        for provider in (active_provider, ONLINE_OCR_PROVIDER_ASYNC_JOBS):
            if provider == primary_runtime.provider or provider not in available_providers:
                continue
            fallback_runtimes.append(
                _build_authenticated_notice_ocr_provider_runtime(
                    provider=provider,
                    settings_by_provider=settings_by_provider,
                    explicit_clients=explicit_clients,
                )
            )
            break
    return AuthenticatedNoticeOcrRuntime(
        client=primary_runtime.client,
        provider=primary_runtime.provider,
        fallback_runtimes=tuple(fallback_runtimes),
    )


def _build_authenticated_notice_ocr_provider_runtime(
    *,
    provider: str,
    settings_by_provider: dict[str, OnlineOcrSettings],
    explicit_clients: dict[str, OnlineOcrClient],
) -> AuthenticatedNoticeOcrProviderRuntime:
    client = explicit_clients.get(provider)
    if client is not None:
        return AuthenticatedNoticeOcrProviderRuntime(client=client, provider=provider)
    settings = settings_by_provider.get(provider)
    if settings is None:
        raise ValueError(f"{provider} OCR settings are not configured")
    return AuthenticatedNoticeOcrProviderRuntime(
        client=build_online_ocr_client(settings),
        provider=provider,
    )


def _build_attachment_projection_result(
    *,
    parent_source_truth: _AuthenticatedNoticeParentSourceTruth,
    attachment_ref: dict[str, object],
    classification: str,
    review_reason: str | None,
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings: ObjectStoreSettings,
    ocr_runtime: AuthenticatedNoticeOcrRuntime | None,
    ocr_provider_response_cache: dict[str, bytes] | None,
    runtime_profile,
    text_extractable_extractor: TextExtractableExtractor,
    layout_elements_builder: LayoutElementsBuilder,
) -> AuthenticatedNoticeAttachmentProjectionResult:
    manifest = parent_source_truth.manifest
    parent_record = parent_source_truth.record
    site_id, notice_id = _parse_notice_document_id(parent_record.document_id)
    attachment_ref_id = str(attachment_ref.get("attachment_ref_id") or "")
    if not attachment_ref_id:
        raise ValueError(f"{parent_record.document_id} attachment_ref_id is required")
    object_key = _normalize_optional_text(attachment_ref.get("object_key"))
    if object_key is None:
        raise ValueError(f"{parent_record.document_id}#{attachment_ref_id} object_key is required")
    attachment_bytes = object_store.get_bytes(
        bucket=object_store_settings.bucket_source, key=object_key
    )
    actual_attachment_sha256 = hashlib.sha256(attachment_bytes).hexdigest()
    expected_attachment_sha256 = _normalize_optional_text(attachment_ref.get("content_sha256"))
    if (
        expected_attachment_sha256 is not None
        and expected_attachment_sha256 != actual_attachment_sha256
    ):
        raise ValueError(
            f"{parent_record.document_id}#{attachment_ref_id} attachment content_sha256 mismatch: "
            f"expected {expected_attachment_sha256}, got {actual_attachment_sha256}"
        )
    filename = _guess_attachment_filename(attachment_ref)
    title = _build_attachment_title(
        notice_title=str(
            manifest.get("notice_title_normalized")
            or manifest.get("notice_title_raw")
            or parent_record.document_id
        ),
        attachment_ref=attachment_ref,
        filename=filename,
    )
    derived_document_id = f"notice_attachment:{site_id}:{notice_id}:{attachment_ref_id}"
    version_id = _build_attachment_version_id(
        attachment_content_sha256=actual_attachment_sha256,
        extraction_class=classification,
        extraction_policy_version=config.extraction_policy_version,
    )
    materialization_policy = _materialization_policy_for_classification(classification)
    if classification == "multimodal_processing_required":
        return AuthenticatedNoticeAttachmentProjectionResult(
            document=None,
            outcome=AuthenticatedNoticeAttachmentProjectionOutcome(
                attachment_ref_id=attachment_ref_id,
                classification=classification,
                materialization_policy=materialization_policy,
                outcome=AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MULTIMODAL_PROCESSING_REQUIRED,
                document_id=derived_document_id,
                attachment_object_key=object_key,
                attachment_content_sha256=actual_attachment_sha256,
                provider_response_bytes=None,
                review_reason=review_reason,
            ),
        )

    metadata: dict[str, object] = {
        "document_id": derived_document_id,
        "version_id": version_id,
        "source_url": str(
            attachment_ref.get("final_url")
            or attachment_ref.get("source_url")
            or parent_record.source_uri
        ),
        "source_id": derived_document_id,
        "raw_page_start": None,
        "raw_page_end": None,
        "projection_name": config.attachment_projection.projection_name,
        "derived_from": config.attachment_projection.derived_from,
        "derived_from_document_id": parent_record.document_id,
        "derived_from_raw_asset_id": str(manifest.get("raw_asset_id") or ""),
        "derived_from_raw_version_id": str(manifest.get("raw_version_id") or ""),
        "parent_document_id": parent_record.document_id,
        "attachment_ref_id": attachment_ref_id,
        "attachment_kind": _resolve_attachment_kind(classification=classification, config=config),
        "attachment_role": _resolve_attachment_role(attachment_ref=attachment_ref, config=config),
        "attachment_content_sha256": actual_attachment_sha256,
        "attachment_mime_type": _normalize_optional_text(attachment_ref.get("mime_type")),
        "attachment_object_key": object_key,
        "attachment_filename": filename,
        "source_resource_role": _normalize_optional_text(attachment_ref.get("resource_role")),
        "source_relation_source": _normalize_optional_text(attachment_ref.get("relation_source")),
        "extraction_class": classification,
        "extraction_policy_version": config.extraction_policy_version,
        "status": parent_record.status,
    }
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=parent_record.entitlement_groups,
        visibility_scope=parent_record.visibility_scope,
        visibility_level=parent_record.visibility_level,
        policy_projection_version=parent_record.policy_projection_version,
    )

    layout_elements_bytes: bytes | None = None
    structured_layout_rows: tuple[dict[str, object], ...] = ()
    if classification == "text_extractable":
        extraction_outcome = text_extractable_extractor(
            attachment_bytes,
            filename=filename,
            media_type=_normalize_optional_text(attachment_ref.get("mime_type")),
            source_object_key=object_key,
        )
        text_blocks = extraction_outcome.text_blocks
        layout_elements_bytes = layout_elements_builder(
            attachment_bytes,
            filename=filename,
            media_type=_normalize_optional_text(attachment_ref.get("mime_type")),
            source_object_key=object_key,
        )
        if layout_elements_bytes is not None:
            structured_layout_rows = _load_jsonl_rows(layout_elements_bytes)
        provider_response_bytes = _build_text_extractable_provider_payload(
            attachment_ref=attachment_ref,
            extraction_policy_version=config.extraction_policy_version,
            extraction_outcome=extraction_outcome,
        )
    elif classification == "ocr_required":
        if ocr_runtime is None:
            raise ValueError("online OCR client is required for ocr_required attachments")
        provider_response_bytes = None
        if ocr_provider_response_cache is not None:
            provider_response_bytes = ocr_provider_response_cache.get(actual_attachment_sha256)
        if provider_response_bytes is None:
            provider_response_bytes = _parse_attachment_with_ocr_runtimes(
                ocr_runtime=ocr_runtime,
                file_bytes=attachment_bytes,
                filename=filename,
                media_type=_normalize_optional_text(attachment_ref.get("mime_type")),
                error_prefix=(
                    f"{parent_record.document_id}#{attachment_ref_id} attachment OCR failed"
                ),
            )
            if ocr_provider_response_cache is not None:
                ocr_provider_response_cache[actual_attachment_sha256] = provider_response_bytes
        text_blocks = ()
    else:  # pragma: no cover
        raise ValueError(f"unsupported attachment classification: {classification}")

    ocr_artifacts = None
    if classification == "ocr_required":
        ocr_artifacts = build_authenticated_notice_ocr_attachment_artifacts(
            document_id=derived_document_id,
            version_id=version_id,
            source_uri=str(
                attachment_ref.get("final_url")
                or attachment_ref.get("source_url")
                or parent_record.source_uri
            ),
            title=title,
            attachment_ref_id=attachment_ref_id,
            provider_response_bytes=provider_response_bytes,
            metadata=metadata,
        )
        if ocr_artifacts is not None:
            layout_elements_bytes = ocr_artifacts.layout_elements_bytes
    if not text_blocks and ocr_artifacts is None:
        return AuthenticatedNoticeAttachmentProjectionResult(
            document=None,
            outcome=AuthenticatedNoticeAttachmentProjectionOutcome(
                attachment_ref_id=attachment_ref_id,
                classification=classification,
                materialization_policy=materialization_policy,
                outcome=AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT,
                document_id=derived_document_id,
                attachment_object_key=object_key,
                attachment_content_sha256=actual_attachment_sha256,
                provider_response_bytes=provider_response_bytes,
                review_reason=review_reason,
            ),
        )

    canonical_markdown_bytes = _render_canonical_markdown(
        metadata={
            key: metadata[key]
            for key in (
                "projection_name",
                "derived_from",
                "derived_from_document_id",
                "derived_from_raw_asset_id",
                "derived_from_raw_version_id",
                "parent_document_id",
                "attachment_ref_id",
                "attachment_kind",
                "attachment_role",
                "attachment_content_sha256",
                "attachment_mime_type",
                "attachment_object_key",
                "attachment_filename",
                "source_resource_role",
                "source_relation_source",
                "extraction_class",
                "extraction_policy_version",
                "visibility_scope",
                "visibility_level",
                "entitlement_groups",
                "policy_projection_version",
            )
            if key in metadata
        },
        body=(
            _build_attachment_markdown_body_from_layout_rows(
                title=title,
                layout_rows=structured_layout_rows,
            )
            if structured_layout_rows
            else _build_attachment_markdown_body(title=title, text_blocks=text_blocks)
            if ocr_artifacts is None
            else (f"# {title}\n\n{ocr_artifacts.body_markdown}".strip() + "\n")
        ),
    ).encode("utf-8")

    document_units_bytes = (
        _build_attachment_document_units_bytes_from_layout_rows(
            document_id=derived_document_id,
            version_id=version_id,
            source_uri=str(metadata["source_url"]),
            title=title,
            layout_rows=structured_layout_rows,
            attachment_ref=attachment_ref,
            metadata=metadata,
        )
        if structured_layout_rows
        else _build_attachment_document_units_bytes(
            document_id=derived_document_id,
            version_id=version_id,
            source_uri=str(metadata["source_url"]),
            title=title,
            text_blocks=text_blocks,
            attachment_ref=attachment_ref,
            metadata=metadata,
        )
        if ocr_artifacts is None
        else ocr_artifacts.document_units_bytes
    )

    return AuthenticatedNoticeAttachmentProjectionResult(
        document=DocumentImportInput(
            source_label=f"{parent_record.document_id}#{attachment_ref_id}",
            document_units_bytes=document_units_bytes,
            provider_response_bytes=provider_response_bytes,
            layout_elements_bytes=layout_elements_bytes,
            canonical_markdown_bytes=canonical_markdown_bytes,
            metadata=metadata,
            import_source=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
            revision_track=parent_record.revision_track,
            source_channel=parent_record.source_channel,
            is_current=parent_record.is_current,
            corpus=config.attachment_projection.target_corpus,
            collection=config.attachment_projection.target_collection,
            visibility_scope=parent_record.visibility_scope,
            status=parent_record.status,
            raw_source_uri=parent_record.source_uri,
            raw_asset_id=str(manifest.get("raw_asset_id") or ""),
            raw_version_id=str(manifest.get("raw_version_id") or ""),
            provider_response_object_key=None,
            additional_processed_object_keys=(
                parent_source_truth.notice_manifest_key,
                parent_source_truth.content_blocks_key,
                parent_source_truth.attachment_refs_key,
            ),
            title=title,
            year=_derive_notice_year(manifest=manifest, runtime_profile=runtime_profile),
        ),
        outcome=AuthenticatedNoticeAttachmentProjectionOutcome(
            attachment_ref_id=attachment_ref_id,
            classification=classification,
            materialization_policy=materialization_policy,
            outcome=AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT,
            document_id=derived_document_id,
            attachment_object_key=object_key,
            attachment_content_sha256=actual_attachment_sha256,
            provider_response_bytes=None,
            review_reason=review_reason,
        ),
    )


def _parse_attachment_with_ocr_runtimes(
    *,
    ocr_runtime: AuthenticatedNoticeOcrRuntime,
    file_bytes: bytes,
    filename: str,
    media_type: str | None,
    error_prefix: str,
) -> bytes:
    runtimes = (
        AuthenticatedNoticeOcrProviderRuntime(
            client=ocr_runtime.client,
            provider=ocr_runtime.provider,
        ),
        *ocr_runtime.fallback_runtimes,
    )
    errors: list[str] = []
    for runtime in runtimes:
        try:
            provider_result = parse_online_ocr_bytes(
                ocr_client=runtime.client,
                file_bytes=file_bytes,
                filename=filename,
                media_type=media_type,
            )
            return _normalize_authenticated_notice_ocr_provider_payload(
                provider_response_bytes=provider_result.provider_result_bytes,
                provider=runtime.provider,
            )
        except Exception as exc:
            errors.append(str(exc) if len(runtimes) == 1 else f"{runtime.provider}: {exc}")
    raise RuntimeError(f"{error_prefix}: {' | '.join(errors)}")
