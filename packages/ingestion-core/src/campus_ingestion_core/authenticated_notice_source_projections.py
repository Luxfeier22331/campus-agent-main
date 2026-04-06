from __future__ import annotations

from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Protocol
import zipfile
from xml.etree import ElementTree

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
)
from campus_ingestion_core.authenticated_notice_source_truth import (
    build_authenticated_notice_notice_document_artifacts,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
)
from campus_ingestion_core.collection_config import resolve_collection_truth_config
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.raw_ingestion import (
    OnlineOcrClient,
    OnlineOcrSettings,
    PaddleOcrAsyncClient,
    S3ObjectStoreClient,
    extract_online_ocr_text,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings


AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_SCHEMA_VERSION = "authenticated_notice_source_projections_v1"
DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE = "authenticated_notice_source_projection"
DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION = "authenticated_notice_source_projection_v1"
AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT = "required_document"
AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT = "conditional_on_extracted_text"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT = "materialized_document"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT = "no_extractable_text"
_DOCX_DOCUMENT_PATH = "word/document.xml"
_WORDPROCESSINGML_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class AuthenticatedNoticeProjectionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentProjection:
    projection_name: str
    target_corpus: str
    target_collection: str
    projection_family: str
    replay_from_source_truth: bool
    derived_from: str


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceProjectionsConfig:
    source_corpus: str
    source_collection: str
    derived_document_fields: tuple[str, ...]
    attachment_projection: AuthenticatedNoticeAttachmentProjection
    attachment_role_map: dict[str, str]
    attachment_kind_map: dict[str, str]
    extraction_policy_version: str
    text_extractable_extensions: tuple[str, ...]
    ocr_required_mime_types: tuple[str, ...]
    ocr_required_extensions: tuple[str, ...]
    reference_only_storage_providers: tuple[str, ...]
    reference_only_ingest_statuses: tuple[str, ...]
    reference_only_url_substrings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceProjectionRequest:
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    source_projections_path: Path | None = None
    default_visibility_scope: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceProjectionReport:
    corpus: str
    collection: str
    parent_notice_count: int
    attachment_ref_count: int
    projected_attachment_count: int
    text_extractable_attachment_count: int
    ocr_attachment_count: int
    ocr_no_text_attachment_count: int
    reference_only_attachment_count: int
    created_document_ids: tuple[str, ...]
    updated_document_ids: tuple[str, ...]
    skipped_document_ids: tuple[str, ...]
    errors: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentProjectionOutcome:
    attachment_ref_id: str
    classification: str
    materialization_policy: str
    outcome: str
    document_id: str
    attachment_object_key: str
    attachment_content_sha256: str
    provider_response_bytes: bytes | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentProjectionResult:
    document: DocumentImportInput | None
    outcome: AuthenticatedNoticeAttachmentProjectionOutcome


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeProjectedNotice:
    documents: tuple[DocumentImportInput, ...]
    attachment_outcomes: tuple[AuthenticatedNoticeAttachmentProjectionOutcome, ...]


@dataclass(frozen=True, slots=True)
class _AuthenticatedNoticeParentSourceTruth:
    record: DocumentRegistryRecord
    manifest: dict[str, Any]
    content_blocks: tuple[dict[str, Any], ...]
    attachment_refs: tuple[dict[str, Any], ...]
    source_keys: tuple[str, ...]
    notice_manifest_key: str
    content_blocks_key: str
    attachment_refs_key: str


def read_authenticated_notice_source_projections_config_path(source: dict[str, str]) -> Path:
    value = (source.get("AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_PATH") or "").strip()
    if value:
        return Path(value)
    config = resolve_collection_truth_config(DEFAULT_AUTHENTICATED_NOTICE_CORPUS, DEFAULT_AUTHENTICATED_NOTICE_COLLECTION)
    if config.source_projections_path is None:
        raise ValueError("internal_notice source-projections.v1.json is required")
    return config.source_projections_path


def load_authenticated_notice_source_projections_config(path: Path) -> AuthenticatedNoticeSourceProjectionsConfig:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if str(payload.get("schema_version") or "") != AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_SCHEMA_VERSION:
        raise ValueError(
            "unsupported authenticated notice source projections schema_version: "
            f"{payload.get('schema_version')!r}"
        )
    attachment_projection_payload = dict(payload.get("attachment_projection") or {})
    return AuthenticatedNoticeSourceProjectionsConfig(
        source_corpus=str(payload.get("source_corpus") or ""),
        source_collection=str(payload.get("source_collection") or ""),
        derived_document_fields=tuple(
            str(item).strip()
            for item in list(payload.get("derived_document_fields") or [])
            if str(item).strip()
        ),
        attachment_projection=AuthenticatedNoticeAttachmentProjection(
            projection_name=str(attachment_projection_payload.get("projection_name") or ""),
            target_corpus=str(attachment_projection_payload.get("target_corpus") or ""),
            target_collection=str(attachment_projection_payload.get("target_collection") or ""),
            projection_family=str(attachment_projection_payload.get("projection_family") or ""),
            replay_from_source_truth=bool(attachment_projection_payload.get("replay_from_source_truth", False)),
            derived_from=str(attachment_projection_payload.get("derived_from") or ""),
        ),
        attachment_role_map={
            str(key).strip(): str(value).strip()
            for key, value in dict(payload.get("attachment_role_map") or {}).items()
            if str(key).strip() and str(value).strip()
        },
        attachment_kind_map={
            str(key).strip(): str(value).strip()
            for key, value in dict(payload.get("attachment_kind_map") or {}).items()
            if str(key).strip() and str(value).strip()
        },
        extraction_policy_version=str(payload.get("extraction_policy_version") or ""),
        text_extractable_extensions=tuple(
            _normalize_extension(item)
            for item in list(payload.get("text_extractable_extensions") or [])
            if _normalize_extension(item) is not None
        ),
        ocr_required_mime_types=tuple(
            str(item).strip().lower()
            for item in list(payload.get("ocr_required_mime_types") or [])
            if str(item).strip()
        ),
        ocr_required_extensions=tuple(
            _normalize_extension(item)
            for item in list(payload.get("ocr_required_extensions") or [])
            if _normalize_extension(item) is not None
        ),
        reference_only_storage_providers=tuple(
            str(item).strip().lower()
            for item in list(payload.get("reference_only_storage_providers") or [])
            if str(item).strip()
        ),
        reference_only_ingest_statuses=tuple(
            str(item).strip().lower()
            for item in list(payload.get("reference_only_ingest_statuses") or [])
            if str(item).strip()
        ),
        reference_only_url_substrings=tuple(
            str(item).strip().lower()
            for item in list(payload.get("reference_only_url_substrings") or [])
            if str(item).strip()
        ),
    )


def rebuild_authenticated_notice_source_projections(
    *,
    request: AuthenticatedNoticeSourceProjectionRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeProjectionObjectStore | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    ocr_client: OnlineOcrClient | None = None,
) -> AuthenticatedNoticeSourceProjectionReport:
    source = env if env is not None else dict(os.environ)
    config_path = request.source_projections_path or read_authenticated_notice_source_projections_config_path(source)
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
    )
    if not parent_source_truths:
        raise ValueError(f"no authenticated notice source-truth parents found for {request.corpus}/{request.collection}")

    runtime_ocr_client = ocr_client
    attachment_ref_count = 0
    projected_attachment_count = 0
    text_extractable_attachment_count = 0
    ocr_attachment_count = 0
    ocr_no_text_attachment_count = 0
    reference_only_attachment_count = 0
    documents: list[DocumentImportInput] = []

    for parent_source_truth in parent_source_truths:
        projected_notice, runtime_ocr_client = _project_parent_source_truth(
            parent_source_truth=parent_source_truth,
            config=config,
            object_store=runtime_object_store,
            object_store_settings=object_store_settings,
            runtime_profile=runtime_profile,
            ocr_client=runtime_ocr_client,
            env=source,
        )
        documents.extend(projected_notice.documents)
        attachment_ref_count += len(parent_source_truth.attachment_refs)
        reference_only_attachment_count += (
            len(parent_source_truth.attachment_refs) - len(projected_notice.attachment_outcomes)
        )
        for outcome in projected_notice.attachment_outcomes:
            if outcome.outcome == AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT:
                projected_attachment_count += 1
            if outcome.classification == "text_extractable":
                text_extractable_attachment_count += 1
            elif outcome.classification == "ocr_required":
                ocr_attachment_count += 1
                if outcome.outcome == AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT:
                    ocr_no_text_attachment_count += 1

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
        scope_refresh=(request.corpus, request.collection),
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
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        skipped_document_ids=stats.skipped_document_ids,
        errors=stats.errors,
    )


def _project_parent_source_truth(
    *,
    parent_source_truth: _AuthenticatedNoticeParentSourceTruth,
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings: ObjectStoreSettings,
    runtime_profile,
    ocr_client: OnlineOcrClient | None,
    env: dict[str, str],
) -> tuple[AuthenticatedNoticeProjectedNotice, OnlineOcrClient | None]:
    documents: list[DocumentImportInput] = [
        _build_parent_notice_document(
            parent_source_truth=parent_source_truth,
            runtime_profile=runtime_profile,
        )
    ]
    attachment_outcomes: list[AuthenticatedNoticeAttachmentProjectionOutcome] = []
    runtime_ocr_client = ocr_client
    for attachment_ref in parent_source_truth.attachment_refs:
        classification = _classify_attachment_ref(
            attachment_ref=attachment_ref,
            config=config,
        )
        if classification == "reference_only":
            continue
        if classification == "unsupported_binary":
            raise ValueError(
                "unsupported authenticated notice attachment requires an explicit extractor: "
                f"{parent_source_truth.record.document_id}#{attachment_ref.get('attachment_ref_id')} "
                f"mime_type={attachment_ref.get('mime_type')!r} object_key={attachment_ref.get('object_key')!r}"
            )
        if classification == "ocr_required" and runtime_ocr_client is None:
            settings = OnlineOcrSettings.from_env(env, required=True)
            if settings is None:  # pragma: no cover
                raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
            runtime_ocr_client = PaddleOcrAsyncClient(settings)
        result = _build_attachment_projection_result(
            parent_source_truth=parent_source_truth,
            attachment_ref=attachment_ref,
            classification=classification,
            config=config,
            object_store=object_store,
            object_store_settings=object_store_settings,
            ocr_client=runtime_ocr_client,
            runtime_profile=runtime_profile,
        )
        attachment_outcomes.append(result.outcome)
        if result.document is not None:
            documents.append(result.document)
    return (
        AuthenticatedNoticeProjectedNotice(
            documents=tuple(documents),
            attachment_outcomes=tuple(attachment_outcomes),
        ),
        runtime_ocr_client,
    )


def _load_parent_source_truths(
    *,
    registry: DocumentRegistry,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings: ObjectStoreSettings,
    corpus: str,
    collection: str,
) -> tuple[_AuthenticatedNoticeParentSourceTruth, ...]:
    records = tuple(
        sorted(
            registry.list_by_scope(corpus, collection),
            key=lambda record: (record.document_id, record.revision_track, record.version_id),
        )
    )
    parents: list[_AuthenticatedNoticeParentSourceTruth] = []
    for record in records:
        if record.source_channel != "authenticated_notice_portal":
            continue
        notice_manifest_key = _find_processed_key(record, "source-truth/notice-manifest.json")
        content_blocks_key = _find_processed_key(record, "source-truth/content-blocks.jsonl")
        attachment_refs_key = _find_processed_key(record, "source-truth/attachment-refs.jsonl")
        if notice_manifest_key is None or content_blocks_key is None or attachment_refs_key is None:
            continue
        manifest = _load_json_payload(
            object_store.get_bytes(bucket=object_store_settings.bucket_source, key=notice_manifest_key)
        )
        content_blocks = _load_jsonl_rows(
            object_store.get_bytes(bucket=object_store_settings.bucket_source, key=content_blocks_key)
        )
        attachment_refs = _load_jsonl_rows(
            object_store.get_bytes(bucket=object_store_settings.bucket_source, key=attachment_refs_key)
        )
        parents.append(
            _AuthenticatedNoticeParentSourceTruth(
                record=record,
                manifest=manifest,
                content_blocks=content_blocks,
                attachment_refs=attachment_refs,
                source_keys=tuple(
                    key for key in record.processed_object_keys if key and is_source_object_key(str(key))
                ),
                notice_manifest_key=notice_manifest_key,
                content_blocks_key=content_blocks_key,
                attachment_refs_key=attachment_refs_key,
            )
        )
    return tuple(parents)


def _build_parent_notice_document(
    *,
    parent_source_truth: _AuthenticatedNoticeParentSourceTruth,
    runtime_profile,
) -> DocumentImportInput:
    manifest = parent_source_truth.manifest
    title = str(manifest.get("notice_title_normalized") or manifest.get("notice_title_raw") or parent_source_truth.record.document_id)
    source_uri = str(manifest.get("source_notice_link") or parent_source_truth.record.source_uri)
    canonical_markdown_bytes, document_units_bytes = build_authenticated_notice_notice_document_artifacts(
        document_id=parent_source_truth.record.document_id,
        version_id=parent_source_truth.record.version_id,
        source_uri=source_uri,
        title=title,
        content_blocks=parent_source_truth.content_blocks,
    )
    metadata: dict[str, object] = {
        "document_id": parent_source_truth.record.document_id,
        "version_id": parent_source_truth.record.version_id,
        "source_url": source_uri,
        "source_id": parent_source_truth.record.document_id,
        "raw_page_start": None,
        "raw_page_end": None,
    }
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=parent_source_truth.record.entitlement_groups,
        visibility_scope=parent_source_truth.record.visibility_scope,
        visibility_level=parent_source_truth.record.visibility_level,
        policy_projection_version=parent_source_truth.record.policy_projection_version,
    )
    metadata["status"] = parent_source_truth.record.status
    return DocumentImportInput(
        source_label=f"{parent_source_truth.record.document_id}#primary",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=canonical_markdown_bytes,
        metadata=metadata,
        import_source=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
        revision_track=parent_source_truth.record.revision_track,
        source_channel=parent_source_truth.record.source_channel,
        is_current=parent_source_truth.record.is_current,
        corpus=parent_source_truth.record.corpus,
        collection=parent_source_truth.record.collection,
        visibility_scope=parent_source_truth.record.visibility_scope,
        status=parent_source_truth.record.status,
        raw_source_uri=source_uri,
        raw_asset_id=str(manifest.get("raw_asset_id") or ""),
        raw_version_id=str(manifest.get("raw_version_id") or ""),
        provider_response_object_key=parent_source_truth.record.provider_response_object_key,
        additional_processed_object_keys=tuple(
            key for key in parent_source_truth.source_keys if key != parent_source_truth.record.provider_response_object_key
        ),
        title=title,
        year=_derive_notice_year(manifest=manifest, runtime_profile=runtime_profile),
    )


def _build_attachment_projection_result(
    *,
    parent_source_truth: _AuthenticatedNoticeParentSourceTruth,
    attachment_ref: dict[str, Any],
    classification: str,
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings: ObjectStoreSettings,
    ocr_client: OnlineOcrClient | None,
    runtime_profile,
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
    attachment_bytes = object_store.get_bytes(bucket=object_store_settings.bucket_source, key=object_key)
    actual_attachment_sha256 = hashlib.sha256(attachment_bytes).hexdigest()
    expected_attachment_sha256 = _normalize_optional_text(attachment_ref.get("content_sha256"))
    if expected_attachment_sha256 is not None and expected_attachment_sha256 != actual_attachment_sha256:
        raise ValueError(
            f"{parent_record.document_id}#{attachment_ref_id} attachment content_sha256 mismatch: "
            f"expected {expected_attachment_sha256}, got {actual_attachment_sha256}"
        )
    filename = _guess_attachment_filename(attachment_ref)
    title = _build_attachment_title(
        notice_title=str(manifest.get("notice_title_normalized") or manifest.get("notice_title_raw") or parent_record.document_id),
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
    if classification == "text_extractable":
        text_blocks = _extract_docx_text_blocks(attachment_bytes)
        provider_response_bytes = _build_text_extractable_provider_payload(
            attachment_ref=attachment_ref,
            filename=filename,
            text_blocks=text_blocks,
            extraction_policy_version=config.extraction_policy_version,
        )
    elif classification == "ocr_required":
        if ocr_client is None:
            raise ValueError("online OCR client is required for ocr_required attachments")
        with TemporaryDirectory() as temp_dir:
            attachment_path = Path(temp_dir) / filename
            attachment_path.write_bytes(attachment_bytes)
            provider_result = ocr_client.parse_file(attachment_path)
        provider_response_bytes = provider_result.provider_result_bytes
        text_blocks = _extract_ocr_text_blocks(provider_result.provider_result_bytes)
    else:  # pragma: no cover
        raise ValueError(f"unsupported attachment classification: {classification}")
    if not text_blocks:
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
            ),
        )

    metadata: dict[str, object] = {
        "document_id": derived_document_id,
        "version_id": version_id,
        "source_url": str(attachment_ref.get("final_url") or attachment_ref.get("source_url") or parent_record.source_uri),
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
        body=_build_attachment_markdown_body(title=title, text_blocks=text_blocks),
    ).encode("utf-8")
    document_units_bytes = _build_attachment_document_units_bytes(
        document_id=derived_document_id,
        version_id=version_id,
        source_uri=str(metadata["source_url"]),
        title=title,
        text_blocks=text_blocks,
        attachment_ref=attachment_ref,
        metadata=metadata,
    )
    return AuthenticatedNoticeAttachmentProjectionResult(
        document=DocumentImportInput(
            source_label=f"{parent_record.document_id}#{attachment_ref_id}",
            document_units_bytes=document_units_bytes,
            provider_response_bytes=provider_response_bytes,
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
        ),
    )


def _classify_attachment_ref(
    *,
    attachment_ref: dict[str, Any],
    config: AuthenticatedNoticeSourceProjectionsConfig,
) -> str:
    if (
        _normalize_optional_text(attachment_ref.get("object_key")) is None
        or _normalize_optional_text(attachment_ref.get("content_sha256")) is None
        or _normalize_optional_text(attachment_ref.get("byte_size")) is None
    ):
        return "reference_only"
    storage_provider = _normalize_optional_text(attachment_ref.get("storage_provider"))
    ingest_status = _normalize_optional_text(attachment_ref.get("ingest_status"))
    if storage_provider is not None and storage_provider.lower() in config.reference_only_storage_providers:
        return "reference_only"
    if ingest_status is not None and ingest_status.lower() in config.reference_only_ingest_statuses:
        return "reference_only"
    for url in (
        _normalize_optional_text(attachment_ref.get("source_url")),
        _normalize_optional_text(attachment_ref.get("normalized_source_url")),
        _normalize_optional_text(attachment_ref.get("final_url")),
    ):
        if url is None:
            continue
        lowered_url = url.lower()
        if any(token in lowered_url for token in config.reference_only_url_substrings):
            return "reference_only"
    mime_type = _normalize_optional_text(attachment_ref.get("mime_type"))
    extension = _normalize_extension(_guess_attachment_filename(attachment_ref))
    if extension is not None and extension in config.text_extractable_extensions:
        return "text_extractable"
    if mime_type is not None and mime_type.lower() in config.ocr_required_mime_types:
        return "ocr_required"
    if extension is not None and extension in config.ocr_required_extensions:
        return "ocr_required"
    return "unsupported_binary"


def build_authenticated_notice_attachment_projection_plans(
    *,
    parent_document_id: str,
    attachment_refs: tuple[dict[str, Any], ...],
    config: AuthenticatedNoticeSourceProjectionsConfig,
) -> tuple[dict[str, str], ...]:
    site_id, notice_id = _parse_notice_document_id(parent_document_id)
    plans: list[dict[str, str]] = []
    for attachment_ref in attachment_refs:
        classification = _classify_attachment_ref(
            attachment_ref=attachment_ref,
            config=config,
        )
        attachment_ref_id = str(attachment_ref.get("attachment_ref_id") or "").strip()
        if classification == "reference_only":
            continue
        if classification == "unsupported_binary":
            raise ValueError(
                "unsupported authenticated notice attachment requires an explicit extractor before replay: "
                f"{parent_document_id}#{attachment_ref_id or 'unknown'}"
            )
        if not attachment_ref_id:
            raise ValueError(f"{parent_document_id} attachment_ref_id is required")
        plans.append(
            {
                "attachment_ref_id": attachment_ref_id,
                "classification": classification,
                "document_id": f"notice_attachment:{site_id}:{notice_id}:{attachment_ref_id}",
                "materialization_policy": _materialization_policy_for_classification(classification),
            }
        )
    return tuple(plans)


def _materialization_policy_for_classification(classification: str) -> str:
    if classification == "text_extractable":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT
    if classification == "ocr_required":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT
    raise ValueError(f"unsupported materialization policy classification: {classification}")


def _resolve_attachment_kind(
    *,
    classification: str,
    config: AuthenticatedNoticeSourceProjectionsConfig,
) -> str:
    value = config.attachment_kind_map.get(classification)
    if value is None:
        raise ValueError(f"attachment_kind_map missing classification: {classification}")
    return value


def _resolve_attachment_role(
    *,
    attachment_ref: dict[str, Any],
    config: AuthenticatedNoticeSourceProjectionsConfig,
) -> str:
    resource_role = _normalize_optional_text(attachment_ref.get("resource_role")) or "attachment"
    return config.attachment_role_map.get(resource_role, "notice_attachment_document")


def _build_attachment_title(
    *,
    notice_title: str,
    attachment_ref: dict[str, Any],
    filename: str,
) -> str:
    label = (
        _normalize_optional_text(attachment_ref.get("anchor_text"))
        or _normalize_optional_text(attachment_ref.get("final_url"))
        or filename
    )
    ref_order = attachment_ref.get("ref_order")
    if ref_order is None:
        return f"{notice_title} / 附件 / {label}"
    return f"{notice_title} / 附件 {ref_order} / {label}"


def _build_attachment_version_id(
    *,
    attachment_content_sha256: str,
    extraction_class: str,
    extraction_policy_version: str,
) -> str:
    version_payload = json.dumps(
        {
            "attachment_content_sha256": attachment_content_sha256,
            "extraction_class": extraction_class,
            "extraction_policy_version": extraction_policy_version,
        },
        ensure_ascii=False,
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(version_payload).hexdigest()}"


def _build_attachment_markdown_body(*, title: str, text_blocks: tuple[str, ...]) -> str:
    return "\n\n".join((f"# {title}", *text_blocks)).strip() + "\n"


def _build_attachment_document_units_bytes(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    title: str,
    text_blocks: tuple[str, ...],
    attachment_ref: dict[str, Any],
    metadata: dict[str, object],
) -> bytes:
    shared_anchor = {
        "source_uri": source_uri,
        "attachment_ref_id": attachment_ref.get("attachment_ref_id"),
        "resource_role": attachment_ref.get("resource_role"),
    }
    shared_metadata = {
        "projection_name": metadata.get("projection_name"),
        "parent_document_id": metadata.get("parent_document_id"),
        "attachment_ref_id": metadata.get("attachment_ref_id"),
        "attachment_kind": metadata.get("attachment_kind"),
        "attachment_role": metadata.get("attachment_role"),
        "attachment_filename": metadata.get("attachment_filename"),
        "attachment_mime_type": metadata.get("attachment_mime_type"),
        "extraction_class": metadata.get("extraction_class"),
    }
    rows = [
        {
            "doc_id": document_id,
            "version_id": version_id,
            "chunk_id": "attachment-title",
            "root_unit_id": "attachment-title",
            "unit_type": "attachment_title",
            "text": title,
            "raw_text": title,
            "clean_text": title,
            "anchor": dict(shared_anchor),
            "metadata": dict(shared_metadata),
        }
    ]
    for index, text in enumerate(text_blocks, start=1):
        rows.append(
            {
                "doc_id": document_id,
                "version_id": version_id,
                "chunk_id": f"attachment-body-{index:04d}",
                "root_unit_id": f"attachment-body-{index:04d}",
                "unit_type": "attachment_body",
                "text": text,
                "raw_text": text,
                "clean_text": text,
                "anchor": dict(shared_anchor),
                "metadata": dict(shared_metadata),
            }
        )
    return _jsonl_bytes(rows)


def _build_text_extractable_provider_payload(
    *,
    attachment_ref: dict[str, Any],
    filename: str,
    text_blocks: tuple[str, ...],
    extraction_policy_version: str,
) -> bytes:
    payload = {
        "schema_version": "authenticated_notice_attachment_text_extract_v1",
        "attachment_ref_id": attachment_ref.get("attachment_ref_id"),
        "filename": filename,
        "mime_type": attachment_ref.get("mime_type"),
        "extraction_class": "text_extractable",
        "extraction_policy_version": extraction_policy_version,
        "text_blocks": list(text_blocks),
    }
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _extract_docx_text_blocks(file_bytes: bytes) -> tuple[str, ...]:
    try:
        with zipfile.ZipFile(BytesIO(file_bytes)) as archive:
            document_xml = archive.read(_DOCX_DOCUMENT_PATH)
    except KeyError as exc:
        raise ValueError("docx document.xml is required") from exc
    root = ElementTree.fromstring(document_xml)
    body = root.find(f".//{_WORDPROCESSINGML_NS}body")
    if body is None:
        raise ValueError("docx body is required")
    blocks: list[str] = []
    for child in list(body):
        if child.tag == f"{_WORDPROCESSINGML_NS}p":
            text = "".join(text_node.text or "" for text_node in child.iter(f"{_WORDPROCESSINGML_NS}t")).strip()
            if text:
                blocks.append(text)
            continue
        if child.tag != f"{_WORDPROCESSINGML_NS}tbl":
            continue
        table_rows: list[str] = []
        for table_row in child.findall(f"{_WORDPROCESSINGML_NS}tr"):
            cells: list[str] = []
            for table_cell in table_row.findall(f"{_WORDPROCESSINGML_NS}tc"):
                cell_text = "".join(
                    text_node.text or "" for text_node in table_cell.iter(f"{_WORDPROCESSINGML_NS}t")
                ).strip()
                if cell_text:
                    cells.append(cell_text)
            if cells:
                table_rows.append(" | ".join(cells))
        if table_rows:
            blocks.append("\n".join(table_rows))
    if not blocks:
        raise ValueError("docx attachment produced no extractable text")
    return tuple(blocks)


def _extract_ocr_text_blocks(provider_result_bytes: bytes) -> tuple[str, ...]:
    decoded = provider_result_bytes.decode("utf-8")
    texts: list[str] = []
    for line in decoded.splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        try:
            payload = json.loads(normalized)
        except json.JSONDecodeError:
            continue
        candidate = payload.get("result") if isinstance(payload, dict) and isinstance(payload.get("result"), dict) else payload
        if not isinstance(candidate, dict):
            continue
        text = _normalize_extracted_text(extract_online_ocr_text(candidate))
        if text:
            texts.append(text)
    if texts:
        return tuple(texts)
    payload = json.loads(decoded)
    candidate = payload.get("result") if isinstance(payload, dict) and isinstance(payload.get("result"), dict) else payload
    if not isinstance(candidate, dict):
        raise ValueError("ocr provider payload must be a JSON object")
    text = _normalize_extracted_text(extract_online_ocr_text(candidate))
    if not text:
        return ()
    return (text,)


def _normalize_extracted_text(value: str) -> str:
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(line.split()).strip() for line in normalized.split("\n")]
    return "\n".join(line for line in lines if line)


def _parse_notice_document_id(document_id: str) -> tuple[str, str]:
    parts = [part.strip() for part in document_id.split(":")]
    if len(parts) != 3 or parts[0] != "notice" or not parts[1] or not parts[2]:
        raise ValueError(f"unsupported authenticated notice parent document_id: {document_id!r}")
    return parts[1], parts[2]


def _resolve_embedding_model(parent_source_truths: tuple[_AuthenticatedNoticeParentSourceTruth, ...]) -> str:
    embedding_model = next(
        (
            record.record.embedding_model.strip()
            for record in parent_source_truths
            if record.record.embedding_model.strip()
        ),
        "",
    )
    if not embedding_model:
        raise ValueError("authenticated notice source projection requires a non-empty embedding_model")
    return embedding_model


def _derive_notice_year(*, manifest: dict[str, Any], runtime_profile) -> str | None:
    del runtime_profile
    for field_name in ("notice_release_time", "notice_create_time", "notice_first_time"):
        value = _normalize_optional_text(manifest.get(field_name))
        if value is None:
            continue
        if len(value) >= 4 and value[:4].isdigit():
            return value[:4]
    return None


def _find_processed_key(record: DocumentRegistryRecord, suffix: str) -> str | None:
    for key in record.processed_object_keys:
        normalized = str(key).strip()
        if normalized.endswith(suffix):
            return normalized
    return None


def _load_json_payload(file_bytes: bytes) -> dict[str, Any]:
    payload = json.loads(file_bytes.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("authenticated notice source projection expects a JSON object")
    return payload


def _load_jsonl_rows(file_bytes: bytes) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for line in file_bytes.decode("utf-8").splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if isinstance(payload, dict):
            rows.append(payload)
    return tuple(rows)


def _render_canonical_markdown(*, metadata: dict[str, object], body: str) -> str:
    lines = ["---"]
    for key, value in metadata.items():
        if value is None or value == "":
            continue
        lines.append(f"{key}: {_format_front_matter_value(value)}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def _format_front_matter_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    text = str(value)
    if not text:
        return '""'
    if any(ch in text for ch in ["#", "[", "]", "{", "}", ","]) or text != text.strip():
        return json.dumps(text, ensure_ascii=False)
    return text


def _guess_attachment_filename(attachment_ref: dict[str, Any]) -> str:
    for field_name in ("final_url", "source_url", "normalized_source_url", "anchor_text", "object_key"):
        value = _normalize_optional_text(attachment_ref.get(field_name))
        if value is None:
            continue
        candidate = Path(value.split("?", 1)[0]).name.strip()
        if candidate:
            return candidate
    attachment_ref_id = _normalize_optional_text(attachment_ref.get("attachment_ref_id")) or "attachment"
    return f"{attachment_ref_id}.bin"


def _normalize_extension(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    suffix = Path(normalized).suffix.lower().strip()
    if suffix.startswith("."):
        suffix = suffix[1:]
    if suffix:
        return suffix
    return normalized.lstrip(".") or None


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _jsonl_bytes(rows: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


__all__ = [
    "AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT",
    "AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT",
    "AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT",
    "AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT",
    "AuthenticatedNoticeAttachmentProjection",
    "AuthenticatedNoticeAttachmentProjectionOutcome",
    "AuthenticatedNoticeProjectedNotice",
    "AuthenticatedNoticeSourceProjectionReport",
    "AuthenticatedNoticeSourceProjectionRequest",
    "AuthenticatedNoticeSourceProjectionsConfig",
    "AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_SCHEMA_VERSION",
    "build_authenticated_notice_attachment_projection_plans",
    "load_authenticated_notice_source_projections_config",
    "read_authenticated_notice_source_projections_config_path",
    "rebuild_authenticated_notice_source_projections",
]
