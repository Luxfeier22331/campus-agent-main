from __future__ import annotations

import hashlib
import shutil
import tempfile
from collections.abc import Callable
from pathlib import Path

from campus_ingestion_core.authenticated_notice_attachment_ocr import (
    build_authenticated_notice_ocr_attachment_artifacts,
)
from campus_ingestion_core.authenticated_notice_source_projection_cache import (
    _OcrProviderResponseCache,
)
from campus_ingestion_core.authenticated_notice_source_projection_io import _sha256_file
from campus_ingestion_core.authenticated_notice_source_projection_ocr_runtime import (
    _parse_attachment_with_ocr_runtimes,
)
from campus_ingestion_core.authenticated_notice_source_projections_classification import (
    _build_attachment_title,
    _build_attachment_version_id,
    _build_text_extractable_provider_payload,
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
    AuthenticatedNoticeAttachmentProjectionOutcome,
    AuthenticatedNoticeAttachmentProjectionResult,
    AuthenticatedNoticeOcrRuntime,
    AuthenticatedNoticeProjectionObjectStore,
    AuthenticatedNoticeSourceProjectionsConfig,
    _AuthenticatedNoticeParentSourceTruth,
    _build_attachment_document_units_bytes,
    _build_attachment_document_units_bytes_from_layout_rows,
    _build_attachment_markdown_body,
    _build_attachment_markdown_body_from_layout_rows,
    _derive_notice_year,
    _load_jsonl_rows,
    _normalize_optional_text,
    _parse_notice_document_id,
    _render_canonical_markdown,
)
from campus_ingestion_core.campus_agent_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
)
from campus_ingestion_core.file_asset_contract import ExtractionOutcome
from campus_ingestion_core.settings import ObjectStoreSettings

TextExtractableExtractor = Callable[..., ExtractionOutcome]
LayoutElementsBuilder = Callable[..., bytes | None]


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
    ocr_provider_response_cache: _OcrProviderResponseCache | None,
    max_attachment_bytes: int,
    max_ocr_input_bytes: int,
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

    attachment_bytes: bytes | None = None
    attachment_file_path: Path | None = None
    temp_dir: Path | None = None
    try:
        if classification == "ocr_required":
            download_file = getattr(object_store, "download_file", None)
            if callable(download_file):
                temp_dir = Path(tempfile.mkdtemp(prefix="authenticated-notice-attachment-"))
                attachment_file_path = (
                    temp_dir / Path(_guess_attachment_filename(attachment_ref)).name
                )
                download_file(
                    bucket=object_store_settings.bucket_source,
                    key=object_key,
                    file_path=str(attachment_file_path),
                )
                attachment_size_bytes = attachment_file_path.stat().st_size
                actual_attachment_sha256 = _sha256_file(attachment_file_path)
            else:
                attachment_bytes = object_store.get_bytes(
                    bucket=object_store_settings.bucket_source,
                    key=object_key,
                )
                attachment_size_bytes = len(attachment_bytes)
                actual_attachment_sha256 = hashlib.sha256(attachment_bytes).hexdigest()
        else:
            attachment_bytes = object_store.get_bytes(
                bucket=object_store_settings.bucket_source,
                key=object_key,
            )
            attachment_size_bytes = len(attachment_bytes)
            actual_attachment_sha256 = hashlib.sha256(attachment_bytes).hexdigest()

        if attachment_size_bytes > max_attachment_bytes:
            raise ValueError(
                f"{parent_record.document_id}#{attachment_ref_id} attachment size {attachment_size_bytes} "
                f"exceeds INGESTION_MAX_ATTACHMENT_BYTES={max_attachment_bytes}"
            )
        if classification == "ocr_required" and attachment_size_bytes > max_ocr_input_bytes:
            raise ValueError(
                f"{parent_record.document_id}#{attachment_ref_id} OCR input size {attachment_size_bytes} "
                f"exceeds INGESTION_MAX_OCR_INPUT_BYTES={max_ocr_input_bytes}"
            )

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
            "attachment_kind": _resolve_attachment_kind(
                classification=classification, config=config
            ),
            "attachment_role": _resolve_attachment_role(
                attachment_ref=attachment_ref, config=config
            ),
            "attachment_content_sha256": actual_attachment_sha256,
            "attachment_mime_type": _normalize_optional_text(attachment_ref.get("mime_type")),
            "attachment_object_key": object_key,
            "attachment_filename": filename,
            "source_resource_role": _normalize_optional_text(attachment_ref.get("resource_role")),
            "source_relation_source": _normalize_optional_text(
                attachment_ref.get("relation_source")
            ),
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
            if attachment_bytes is None and attachment_file_path is not None:
                attachment_bytes = attachment_file_path.read_bytes()
            if attachment_bytes is None:  # pragma: no cover
                raise ValueError("attachment bytes are required for text_extractable processing")
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
                    file_path=attachment_file_path,
                    filename=filename,
                    media_type=_normalize_optional_text(attachment_ref.get("mime_type")),
                    error_prefix=(
                        f"{parent_record.document_id}#{attachment_ref_id} attachment OCR failed"
                    ),
                )
                if ocr_provider_response_cache is not None:
                    ocr_provider_response_cache.put(
                        actual_attachment_sha256, provider_response_bytes
                    )
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
    finally:
        if temp_dir is not None:
            shutil.rmtree(temp_dir, ignore_errors=True)
