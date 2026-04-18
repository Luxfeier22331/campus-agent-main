from __future__ import annotations

import colorsys
from dataclasses import dataclass
import hashlib
from html import unescape
from io import BytesIO
import json
import os
from pathlib import Path
import posixpath
import re
from tempfile import TemporaryDirectory
from typing import Any, Protocol, Sequence
from urllib.parse import urlparse, urlunparse
import zipfile
from xml.etree import ElementTree

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
)
from campus_ingestion_core.authenticated_notice_attachment_ocr import (
    build_authenticated_notice_ocr_attachment_artifacts,
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
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    S3ObjectStoreClient,
    build_online_ocr_client,
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
AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MANUAL_REVIEW = "manual_review"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT = "materialized_document"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT = "no_extractable_text"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MANUAL_REVIEW_REQUIRED = "manual_review_required"
AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_SPATIAL_VISUAL_ASSET = "spatial_visual_asset"
AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_OPERATIONAL_SCHEDULE_GUIDE_IMAGE = (
    "operational_schedule_guide_image"
)
_DOCX_DOCUMENT_PATH = "word/document.xml"
_WORDPROCESSINGML_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_XLSX_WORKBOOK_PATH = "xl/workbook.xml"
_XLSX_WORKBOOK_RELS_PATH = "xl/_rels/workbook.xml.rels"
_XLSX_SHARED_STRINGS_PATH = "xl/sharedStrings.xml"
_SPREADSHEETML_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_PACKAGE_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_OFFICE_DOC_REL_ID_ATTR = (
    "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
)
_VISUAL_CLASSIFIER_SAMPLE_EDGE = 128
_VISUAL_CLASSIFIER_AVERAGE_SATURATION_THRESHOLD = 0.15
_VISUAL_CLASSIFIER_COLORFUL_PIXEL_RATIO_THRESHOLD = 0.25
_VISUAL_CLASSIFIER_DOMINANT_COLOR_SHARE_MAX = 0.45
_MACHINE_CODE_SAMPLE_EDGE = 96
_MACHINE_CODE_GRID_EDGE = 29
_MACHINE_CODE_MAX_MIDTONE_RATIO = 0.25
_MACHINE_CODE_MIN_BLACK_RATIO = 0.15
_MACHINE_CODE_MAX_BLACK_RATIO = 0.7
_MACHINE_CODE_MIN_TRANSITION_RATIO = 0.3
_MACHINE_CODE_MIN_FINDER_MATCHES = 2
_DECORATIVE_FRAGMENT_MAX_THIN_SIDE = 64
_DECORATIVE_FRAGMENT_MIN_ASPECT_RATIO = 6.0
_MOBILE_UI_MIN_ASPECT_RATIO = 1.7
_MOBILE_UI_MAX_WIDTH = 480
_MOBILE_UI_MIN_HEIGHT = 240
_NORMALIZED_NOTICE_PROVIDER_SUFFIX = "provider/bundle-import-v1/normalized-notice.json"
_HTML_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
_HTML_ATTR_RE = re.compile(r'([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"')
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_ATTACHMENT_LABEL_PREFIX_RE = re.compile(
    r"^附件(?:(?:\s*[0-9一二三四五六七八九十]+)?\s*[:：/、.-]\s*|\s+)"
)
_UUIDISH_ATTACHMENT_STEM_RE = re.compile(
    r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_GENERIC_IMAGE_STEM_RE = re.compile(r"^(?:image|img|photo|picture|scan|screenshot)(?:[-_ ]?\d+)?$", re.IGNORECASE)


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
    notice_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.source_projections_path is not None:
            object.__setattr__(self, "source_projections_path", Path(self.source_projections_path))
        object.__setattr__(self, "notice_ids", _normalize_notice_ids(self.notice_ids))


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
    manual_review_attachment_count: int
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
    review_reason: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentClassificationResult:
    classification: str
    review_reason: str | None = None


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
        raise ValueError(f"no authenticated notice source-truth parents found for {request.corpus}/{request.collection}")

    runtime_ocr_client = ocr_client
    attachment_ref_count = 0
    projected_attachment_count = 0
    text_extractable_attachment_count = 0
    ocr_attachment_count = 0
    ocr_no_text_attachment_count = 0
    reference_only_attachment_count = 0
    manual_review_attachment_count = 0
    documents: list[DocumentImportInput] = []
    ocr_provider_response_cache: dict[str, bytes] = {}

    for parent_source_truth in parent_source_truths:
        projected_notice, runtime_ocr_client = _project_parent_source_truth(
            parent_source_truth=parent_source_truth,
            config=config,
            object_store=runtime_object_store,
            object_store_settings=object_store_settings,
            runtime_profile=runtime_profile,
            ocr_client=runtime_ocr_client,
            ocr_provider_response_cache=ocr_provider_response_cache,
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
            elif outcome.classification == "manual_review_required":
                manual_review_attachment_count += 1

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
        manual_review_attachment_count=manual_review_attachment_count,
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
    ocr_provider_response_cache: dict[str, bytes] | None,
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
            continue
        if classification == "unsupported_binary":
            raise ValueError(
                "unsupported authenticated notice attachment requires an explicit extractor: "
                f"{parent_source_truth.record.document_id}#{attachment_ref.get('attachment_ref_id')} "
                f"mime_type={attachment_ref.get('mime_type')!r} object_key={attachment_ref.get('object_key')!r}"
            )
        if classification == "ocr_required" and runtime_ocr_client is None:
            runtime_ocr_client = _build_authenticated_notice_async_ocr_client(env)
        result = _build_attachment_projection_result(
            parent_source_truth=parent_source_truth,
            attachment_ref=attachment_ref,
            classification=classification,
            review_reason=classification_result.review_reason,
            config=config,
            object_store=object_store,
            object_store_settings=object_store_settings,
            ocr_client=runtime_ocr_client,
            ocr_provider_response_cache=ocr_provider_response_cache,
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


def _build_authenticated_notice_async_ocr_client(
    env: dict[str, str] | None,
) -> OnlineOcrClient:
    settings = OnlineOcrSettings.from_env(env, required=True)
    if settings is None:  # pragma: no cover
        raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
    if settings.provider != ONLINE_OCR_PROVIDER_ASYNC_JOBS:
        raise ValueError(
            "authenticated notice source-truth replay requires "
            "OCR_PROVIDER_MODE=paddleocr_async_jobs; "
            f"got {settings.provider!r}"
        )
    return build_online_ocr_client(settings)


def _load_parent_source_truths(
    *,
    registry: DocumentRegistry,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings: ObjectStoreSettings,
    corpus: str,
    collection: str,
    notice_ids: tuple[str, ...] = (),
) -> tuple[_AuthenticatedNoticeParentSourceTruth, ...]:
    selected_notice_ids = set(notice_ids)
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
        if not str(record.document_id).startswith("notice:"):
            continue
        notice_manifest_key = _find_processed_key(record, "source-truth/notice-manifest.json")
        content_blocks_key = _find_processed_key(record, "source-truth/content-blocks.jsonl")
        attachment_refs_key = _find_processed_key(record, "source-truth/attachment-refs.jsonl")
        if notice_manifest_key is None or content_blocks_key is None or attachment_refs_key is None:
            continue
        _site_id, notice_id = _parse_notice_document_id(record.document_id)
        if selected_notice_ids and notice_id not in selected_notice_ids:
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
    review_reason: str | None,
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings: ObjectStoreSettings,
    ocr_client: OnlineOcrClient | None,
    ocr_provider_response_cache: dict[str, bytes] | None,
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
    if classification == "manual_review_required":
        return AuthenticatedNoticeAttachmentProjectionResult(
            document=None,
            outcome=AuthenticatedNoticeAttachmentProjectionOutcome(
                attachment_ref_id=attachment_ref_id,
                classification=classification,
                materialization_policy=materialization_policy,
                outcome=AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MANUAL_REVIEW_REQUIRED,
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
    layout_elements_bytes: bytes | None = None
    if classification == "text_extractable":
        text_blocks = _extract_text_extractable_blocks(
            attachment_bytes,
            filename=filename,
        )
        provider_response_bytes = _build_text_extractable_provider_payload(
            attachment_ref=attachment_ref,
            filename=filename,
            text_blocks=text_blocks,
            extraction_policy_version=config.extraction_policy_version,
        )
    elif classification == "ocr_required":
        if ocr_client is None:
            raise ValueError("online OCR client is required for ocr_required attachments")
        provider_response_bytes = None
        if ocr_provider_response_cache is not None:
            provider_response_bytes = ocr_provider_response_cache.get(actual_attachment_sha256)
        if provider_response_bytes is None:
            with TemporaryDirectory() as temp_dir:
                attachment_path = Path(temp_dir) / filename
                attachment_path.write_bytes(attachment_bytes)
                try:
                    provider_result = ocr_client.parse_file(attachment_path)
                except Exception as exc:
                    raise RuntimeError(
                        f"{parent_record.document_id}#{attachment_ref_id} attachment OCR failed: {exc}"
                    ) from exc
            provider_response_bytes = provider_result.provider_result_bytes
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
                attachment_ref.get("final_url") or attachment_ref.get("source_url") or parent_record.source_uri
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
            _build_attachment_markdown_body(title=title, text_blocks=text_blocks)
            if ocr_artifacts is None
            else (f"# {title}\n\n{ocr_artifacts.body_markdown}".strip() + "\n")
        ),
    ).encode("utf-8")
    document_units_bytes = (
        _build_attachment_document_units_bytes(
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


def _classify_attachment_ref(
    *,
    attachment_ref: dict[str, Any],
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    attachment_context_by_ref_id: dict[str, str] | None = None,
) -> AuthenticatedNoticeAttachmentClassificationResult:
    if (
        _normalize_optional_text(attachment_ref.get("object_key")) is None
        or _normalize_optional_text(attachment_ref.get("content_sha256")) is None
        or _normalize_optional_text(attachment_ref.get("byte_size")) is None
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    storage_provider = _normalize_optional_text(attachment_ref.get("storage_provider"))
    ingest_status = _normalize_optional_text(attachment_ref.get("ingest_status"))
    if storage_provider is not None and storage_provider.lower() in config.reference_only_storage_providers:
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if ingest_status is not None and ingest_status.lower() in config.reference_only_ingest_statuses:
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    for url in (
        _normalize_optional_text(attachment_ref.get("source_url")),
        _normalize_optional_text(attachment_ref.get("normalized_source_url")),
        _normalize_optional_text(attachment_ref.get("final_url")),
    ):
        if url is None:
            continue
        lowered_url = url.lower()
        if any(token in lowered_url for token in config.reference_only_url_substrings):
            return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    mime_type = _normalize_optional_text(attachment_ref.get("mime_type"))
    extension = _normalize_extension(_guess_attachment_filename(attachment_ref))
    if extension is not None and extension in config.text_extractable_extensions:
        return AuthenticatedNoticeAttachmentClassificationResult("text_extractable")
    is_ocr_candidate = (
        (mime_type is not None and mime_type.lower() in config.ocr_required_mime_types)
        or (extension is not None and extension in config.ocr_required_extensions)
    )
    if is_ocr_candidate:
        attachment_bytes = _load_attachment_bytes_for_classification(
            attachment_ref=attachment_ref,
            object_store=object_store,
            object_store_settings=object_store_settings,
        )
        inline_image_override = _classify_inline_image_override(
            attachment_ref=attachment_ref,
            attachment_bytes=attachment_bytes,
            attachment_context=_resolve_attachment_context(
                attachment_ref=attachment_ref,
                attachment_context_by_ref_id=attachment_context_by_ref_id,
            ),
        )
        if inline_image_override is not None:
            return inline_image_override
        review_reason = _classify_manual_review_reason(
            attachment_ref=attachment_ref,
            attachment_bytes=attachment_bytes,
        )
        if review_reason is not None:
            return AuthenticatedNoticeAttachmentClassificationResult(
                classification="manual_review_required",
                review_reason=review_reason,
            )
        return AuthenticatedNoticeAttachmentClassificationResult("ocr_required")
    return AuthenticatedNoticeAttachmentClassificationResult("unsupported_binary")


def _classify_manual_review_reason(
    *,
    attachment_ref: dict[str, Any],
    attachment_bytes: bytes | None,
) -> str | None:
    resource_role = _normalize_optional_text(attachment_ref.get("resource_role"))
    if resource_role != "inline_image":
        return None
    if attachment_bytes is None:
        return None
    if _looks_like_spatial_visual_asset(attachment_bytes):
        return AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_SPATIAL_VISUAL_ASSET
    return None


def _classify_inline_image_override(
    *,
    attachment_ref: dict[str, Any],
    attachment_bytes: bytes | None,
    attachment_context: str | None,
) -> AuthenticatedNoticeAttachmentClassificationResult | None:
    resource_role = _normalize_optional_text(attachment_ref.get("resource_role"))
    if resource_role != "inline_image":
        return None
    if attachment_bytes is None:
        return None
    if _looks_like_machine_readable_code_asset(attachment_bytes):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_decorative_inline_fragment(attachment_bytes):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    context_override = _classify_inline_image_context_override(
        attachment_bytes=attachment_bytes,
        attachment_context=attachment_context,
    )
    if context_override is not None:
        return context_override
    return None


def _classify_inline_image_context_override(
    *,
    attachment_bytes: bytes,
    attachment_context: str | None,
) -> AuthenticatedNoticeAttachmentClassificationResult | None:
    normalized_context = _normalize_attachment_context_text(attachment_context)
    if normalized_context is None:
        return None
    if any(token in normalized_context for token in ("二维码", "扫码")):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if "示例证书" in normalized_context:
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if any(token in normalized_context for token in ("社会实践活动", "知行中华")) and any(
        token in normalized_context
        for token in ("活动主题", "活动时间", "活动内容", "青春返乡行")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if any(token in normalized_context for token in ("活动再次出发", "期待你的参加", "正式启动")):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_promotional_hero_image(attachment_bytes) and any(
        token in normalized_context
        for token in ("专场活动", "活动旨在", "故事大会", "期待你的参加", "正式启动")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_promotional_hero_image(attachment_bytes) and any(
        token in normalized_context
        for token in ("社会实践活动", "活动主题", "活动时间", "活动内容", "青春返乡行")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if _looks_like_mobile_ui_screenshot(attachment_bytes) and any(
        token in normalized_context
        for token in ("官方报名小程序", "报名小程序", "作品上传", "我的故事", "等待审核")
    ):
        return AuthenticatedNoticeAttachmentClassificationResult("reference_only")
    if any(
        token in normalized_context
        for token in (
            "选课时间安排",
            "具体选课方式",
            "选课方式参考如下表格",
            "学习时间安排",
            "学习时间及考试安排",
            "选课操作流程",
        )
    ):
        return AuthenticatedNoticeAttachmentClassificationResult(
            "manual_review_required",
            review_reason=AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_OPERATIONAL_SCHEDULE_GUIDE_IMAGE,
        )
    return None


def _load_attachment_bytes_for_classification(
    *,
    attachment_ref: dict[str, Any],
    object_store: AuthenticatedNoticeProjectionObjectStore | None,
    object_store_settings: ObjectStoreSettings | None,
) -> bytes | None:
    object_key = _normalize_optional_text(attachment_ref.get("object_key"))
    if object_key is None or object_store is None or object_store_settings is None:
        return None
    try:
        return object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=object_key,
        )
    except Exception:
        return None


def _looks_like_spatial_visual_asset(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            sample = image.convert("RGB").resize(
                (_VISUAL_CLASSIFIER_SAMPLE_EDGE, _VISUAL_CLASSIFIER_SAMPLE_EDGE)
            )
            palette = sample.quantize(colors=8)
    except Exception:
        return False

    pixel_bytes = sample.tobytes()
    if not pixel_bytes:
        return False
    colorful_pixels = 0
    saturation_total = 0.0
    pixel_count = 0
    for offset in range(0, len(pixel_bytes), 3):
        red, green, blue = pixel_bytes[offset : offset + 3]
        _hue, saturation, _value = colorsys.rgb_to_hsv(
            red / 255.0,
            green / 255.0,
            blue / 255.0,
        )
        pixel_count += 1
        saturation_total += saturation
        if saturation >= 0.2:
            colorful_pixels += 1
    if pixel_count == 0:
        return False

    average_saturation = saturation_total / pixel_count
    colorful_pixel_ratio = colorful_pixels / pixel_count
    dominant_palette_share = _dominant_palette_share(palette)
    return (
        average_saturation >= _VISUAL_CLASSIFIER_AVERAGE_SATURATION_THRESHOLD
        and colorful_pixel_ratio >= _VISUAL_CLASSIFIER_COLORFUL_PIXEL_RATIO_THRESHOLD
        and dominant_palette_share <= _VISUAL_CLASSIFIER_DOMINANT_COLOR_SHARE_MAX
    )


def _looks_like_machine_readable_code_asset(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
            if width <= 0 or height <= 0:
                return False
            if abs(width - height) / max(width, height) > 0.2:
                return False
            grayscale = _crop_to_dark_bbox(image.convert("L"))
            sample = grayscale.resize(
                (_MACHINE_CODE_SAMPLE_EDGE, _MACHINE_CODE_SAMPLE_EDGE)
            )
            sample_pixels = tuple(sample.tobytes())
            grid = grayscale.resize(
                (_MACHINE_CODE_GRID_EDGE, _MACHINE_CODE_GRID_EDGE),
                resample=Image.Resampling.NEAREST,
            )
    except Exception:
        return False

    pixel_count = len(sample_pixels)
    if pixel_count == 0:
        return False
    black_ratio = sum(1 for pixel in sample_pixels if pixel <= 96) / pixel_count
    midtone_ratio = sum(1 for pixel in sample_pixels if 96 < pixel < 192) / pixel_count
    if not (_MACHINE_CODE_MIN_BLACK_RATIO <= black_ratio <= _MACHINE_CODE_MAX_BLACK_RATIO):
        return False
    if midtone_ratio > _MACHINE_CODE_MAX_MIDTONE_RATIO:
        return False

    binary_grid = [
        [0 if grid.getpixel((x, y)) <= 128 else 1 for x in range(_MACHINE_CODE_GRID_EDGE)]
        for y in range(_MACHINE_CODE_GRID_EDGE)
    ]
    if _count_qr_finder_matches(binary_grid) < _MACHINE_CODE_MIN_FINDER_MATCHES:
        return False
    return _transition_ratio(binary_grid) >= _MACHINE_CODE_MIN_TRANSITION_RATIO


def _looks_like_decorative_inline_fragment(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
    except Exception:
        return False
    long_side = max(width, height)
    short_side = min(width, height)
    if short_side <= 0:
        return False
    if long_side <= 64 and short_side <= 64 and (long_side * short_side) >= 256:
        return True
    return (
        short_side <= _DECORATIVE_FRAGMENT_MAX_THIN_SIDE
        and (long_side / short_side) >= _DECORATIVE_FRAGMENT_MIN_ASPECT_RATIO
    )


def _looks_like_mobile_ui_screenshot(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
    except Exception:
        return False
    if width <= 0 or height <= 0:
        return False
    return (
        width <= _MOBILE_UI_MAX_WIDTH
        and height >= _MOBILE_UI_MIN_HEIGHT
        and (height / width) >= _MOBILE_UI_MIN_ASPECT_RATIO
    )


def _looks_like_promotional_hero_image(attachment_bytes: bytes) -> bool:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover
        return False
    try:
        with Image.open(BytesIO(attachment_bytes)) as image:
            width, height = image.size
            if width <= 0 or height <= 0:
                return False
            if (width / height) < 1.4:
                return False
            sample = image.convert("RGB").resize(
                (_VISUAL_CLASSIFIER_SAMPLE_EDGE, _VISUAL_CLASSIFIER_SAMPLE_EDGE)
            )
            palette = sample.quantize(colors=8)
    except Exception:
        return False

    pixel_bytes = sample.tobytes()
    if not pixel_bytes:
        return False
    colorful_pixels = 0
    saturation_total = 0.0
    pixel_count = 0
    for offset in range(0, len(pixel_bytes), 3):
        red, green, blue = pixel_bytes[offset : offset + 3]
        _hue, saturation, _value = colorsys.rgb_to_hsv(
            red / 255.0,
            green / 255.0,
            blue / 255.0,
        )
        pixel_count += 1
        saturation_total += saturation
        if saturation >= 0.2:
            colorful_pixels += 1
    if pixel_count == 0:
        return False
    average_saturation = saturation_total / pixel_count
    colorful_pixel_ratio = colorful_pixels / pixel_count
    dominant_palette_share = _dominant_palette_share(palette)
    return (
        average_saturation >= 0.18
        and colorful_pixel_ratio >= 0.2
        and dominant_palette_share <= 0.7
    )


def _build_attachment_context_by_ref_id(
    *,
    record: DocumentRegistryRecord,
    attachment_refs: tuple[dict[str, Any], ...],
    object_store: AuthenticatedNoticeProjectionObjectStore | None,
    object_store_settings: ObjectStoreSettings | None,
) -> dict[str, str]:
    if object_store is None or object_store_settings is None:
        return {}
    notice_key = _find_processed_key(record, _NORMALIZED_NOTICE_PROVIDER_SUFFIX)
    if notice_key is None:
        return {}
    try:
        payload = _load_json_payload(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source,
                key=notice_key,
            )
        )
    except Exception:
        return {}
    notice_content_html = _normalize_optional_text(payload.get("notice_content_html"))
    if notice_content_html is None:
        return {}
    ref_id_by_url: dict[str, str] = {}
    for attachment_ref in attachment_refs:
        attachment_ref_id = _normalize_optional_text(attachment_ref.get("attachment_ref_id"))
        if attachment_ref_id is None:
            continue
        for field_name in ("normalized_source_url", "final_url", "source_url"):
            normalized_url = _normalize_attachment_context_url(attachment_ref.get(field_name))
            if normalized_url is not None:
                ref_id_by_url.setdefault(normalized_url, attachment_ref_id)
    contexts: dict[str, str] = {}
    for match in _HTML_IMG_TAG_RE.finditer(notice_content_html):
        src = _normalize_attachment_context_url(_html_attribute_value(match.group(0), "src"))
        if src is None:
            continue
        attachment_ref_id = ref_id_by_url.get(src)
        if attachment_ref_id is None:
            continue
        before_text = _strip_html_context_text(notice_content_html[: match.start()])[-160:]
        after_text = _strip_html_context_text(notice_content_html[match.end() :])[:160]
        context_text = " ".join(item for item in (before_text, after_text) if item).strip()
        if not context_text:
            continue
        existing = contexts.get(attachment_ref_id)
        contexts[attachment_ref_id] = (
            f"{existing} {context_text}".strip() if existing is not None else context_text
        )
    return contexts


def _resolve_attachment_context(
    *,
    attachment_ref: dict[str, Any],
    attachment_context_by_ref_id: dict[str, str] | None,
) -> str | None:
    if not attachment_context_by_ref_id:
        return None
    attachment_ref_id = _normalize_optional_text(attachment_ref.get("attachment_ref_id"))
    if attachment_ref_id is None:
        return None
    return attachment_context_by_ref_id.get(attachment_ref_id)


def _normalize_attachment_context_text(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.lower()


def _normalize_attachment_context_url(value: object) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    parsed = urlparse(normalized)
    if not parsed.scheme or not parsed.netloc:
        return normalized
    scheme = parsed.scheme.lower()
    if scheme == "http":
        scheme = "https"
    netloc = parsed.netloc.lower()
    if netloc.endswith(":80"):
        netloc = netloc[:-3]
    return urlunparse((scheme, netloc, parsed.path, "", "", ""))


def _html_attribute_value(tag: str, attribute_name: str) -> str | None:
    target = attribute_name.lower()
    for match in _HTML_ATTR_RE.finditer(tag):
        if match.group(1).lower() == target:
            return unescape(match.group(2)).strip()
    return None


def _strip_html_context_text(value: str) -> str:
    text = _HTML_TAG_RE.sub(" ", value)
    text = unescape(text).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _dominant_palette_share(image) -> float:
    counts = image.getcolors()
    if not counts:
        return 1.0
    total = sum(int(count) for count, _index in counts)
    if total <= 0:
        return 1.0
    return max(int(count) for count, _index in counts) / total


def _count_qr_finder_matches(grid: list[list[int]]) -> int:
    size = len(grid)
    if size < 7:
        return 0
    matches = 0
    for origin_x, origin_y in ((0, 0), (size - 7, 0), (0, size - 7)):
        if _matches_qr_finder_pattern(grid, origin_x=origin_x, origin_y=origin_y):
            matches += 1
    return matches


def _matches_qr_finder_pattern(
    grid: list[list[int]],
    *,
    origin_x: int,
    origin_y: int,
) -> bool:
    matched = 0
    total = 0
    for dy in range(7):
        for dx in range(7):
            expected_black = dx in {0, 6} or dy in {0, 6} or (2 <= dx <= 4 and 2 <= dy <= 4)
            pixel = grid[origin_y + dy][origin_x + dx]
            if (pixel == 0) == expected_black:
                matched += 1
            total += 1
    return total > 0 and matched / total >= 0.55


def _transition_ratio(grid: list[list[int]]) -> float:
    size = len(grid)
    if size <= 1:
        return 0.0
    row_transitions = 0
    col_transitions = 0
    max_row_transitions = 0
    max_col_transitions = 0
    for row in grid:
        row_transitions += sum(1 for left, right in zip(row, row[1:]) if left != right)
        max_row_transitions += len(row) - 1
    for col_index in range(size):
        column = [grid[row_index][col_index] for row_index in range(size)]
        col_transitions += sum(
            1 for top, bottom in zip(column, column[1:]) if top != bottom
        )
        max_col_transitions += len(column) - 1
    if max_row_transitions <= 0 or max_col_transitions <= 0:
        return 0.0
    return min(
        row_transitions / max_row_transitions,
        col_transitions / max_col_transitions,
    )


def _crop_to_dark_bbox(image):
    pixels = image.load()
    width, height = image.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y] <= 180:
                xs.append(x)
                ys.append(y)
    if not xs or not ys:
        return image
    return image.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))


def build_authenticated_notice_attachment_projection_plans(
    *,
    parent_document_id: str,
    attachment_refs: tuple[dict[str, Any], ...],
    config: AuthenticatedNoticeSourceProjectionsConfig,
    object_store: AuthenticatedNoticeProjectionObjectStore | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    parent_record: DocumentRegistryRecord | None = None,
) -> tuple[dict[str, str], ...]:
    site_id, notice_id = _parse_notice_document_id(parent_document_id)
    plans: list[dict[str, str]] = []
    attachment_context_by_ref_id = (
        _build_attachment_context_by_ref_id(
            record=parent_record,
            attachment_refs=attachment_refs,
            object_store=object_store,
            object_store_settings=object_store_settings,
        )
        if parent_record is not None
        else {}
    )
    for attachment_ref in attachment_refs:
        classification_result = _classify_attachment_ref(
            attachment_ref=attachment_ref,
            config=config,
            object_store=object_store,
            object_store_settings=object_store_settings,
            attachment_context_by_ref_id=attachment_context_by_ref_id,
        )
        classification = classification_result.classification
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
        plan = {
            "attachment_ref_id": attachment_ref_id,
            "classification": classification,
            "document_id": f"notice_attachment:{site_id}:{notice_id}:{attachment_ref_id}",
            "materialization_policy": _materialization_policy_for_classification(classification),
        }
        attachment_content_sha256 = _normalize_optional_text(
            attachment_ref.get("content_sha256")
        )
        if attachment_content_sha256 is not None:
            plan["attachment_content_sha256"] = attachment_content_sha256
        if classification_result.review_reason is not None:
            plan["review_reason"] = classification_result.review_reason
        plans.append(plan)
    return tuple(plans)


def _materialization_policy_for_classification(classification: str) -> str:
    if classification == "text_extractable":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT
    if classification == "ocr_required":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT
    if classification == "manual_review_required":
        return AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MANUAL_REVIEW
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
    ref_order = attachment_ref.get("ref_order")
    del notice_title
    prefix = "附件" if ref_order is None else f"附件 {ref_order}"
    for candidate in (
        _normalize_attachment_title_label(_normalize_optional_text(attachment_ref.get("anchor_text"))),
        _normalize_attachment_title_label(filename),
        _normalize_attachment_title_label(_normalize_optional_text(attachment_ref.get("final_url"))),
    ):
        if candidate:
            return f"{prefix} / {candidate}"
    return prefix


def _normalize_attachment_title_label(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    stripped = _ATTACHMENT_LABEL_PREFIX_RE.sub("", normalized).strip()
    if not stripped:
        return None
    if stripped.startswith(("http://", "https://")):
        return None
    candidate_name = Path(stripped.split("?", 1)[0]).name.strip() or stripped
    candidate_stem = Path(candidate_name).stem.strip()
    if not candidate_stem:
        return candidate_name
    if _UUIDISH_ATTACHMENT_STEM_RE.fullmatch(candidate_stem):
        return None
    if _GENERIC_IMAGE_STEM_RE.fullmatch(candidate_stem):
        return None
    return candidate_name


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


def _extract_text_extractable_blocks(
    file_bytes: bytes,
    *,
    filename: str,
) -> tuple[str, ...]:
    extension = _normalize_extension(filename)
    if extension == "docx":
        return _extract_docx_text_blocks(file_bytes)
    if extension == "xlsx":
        return _extract_xlsx_text_blocks(file_bytes)
    if extension == "xls":
        return _extract_xls_text_blocks(file_bytes)
    raise ValueError(f"unsupported text_extractable attachment extension: {filename}")


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


def _extract_xlsx_text_blocks(file_bytes: bytes) -> tuple[str, ...]:
    try:
        with zipfile.ZipFile(BytesIO(file_bytes)) as archive:
            workbook_xml = archive.read(_XLSX_WORKBOOK_PATH)
            workbook_root = ElementTree.fromstring(workbook_xml)
            workbook_relationship_targets = _load_xlsx_workbook_relationship_targets(archive)
            shared_strings = _load_xlsx_shared_strings(archive)
            blocks: list[str] = []
            for sheet in workbook_root.findall(f".//{_SPREADSHEETML_NS}sheet"):
                rel_id = sheet.attrib.get(_OFFICE_DOC_REL_ID_ATTR)
                if not rel_id:
                    continue
                worksheet_target = workbook_relationship_targets.get(rel_id)
                if worksheet_target is None:
                    continue
                worksheet_path = _resolve_xlsx_zip_member_path(
                    base_path=_XLSX_WORKBOOK_PATH,
                    target=worksheet_target,
                )
                sheet_xml = archive.read(worksheet_path)
                sheet_rows = _load_xlsx_sheet_rows(
                    sheet_xml=sheet_xml,
                    shared_strings=shared_strings,
                )
                if not sheet_rows:
                    continue
                sheet_name = (sheet.attrib.get("name") or "").strip()
                blocks.append(_serialize_spreadsheet_sheet_block(sheet_name, sheet_rows))
    except KeyError as exc:
        raise ValueError("xlsx workbook.xml is required") from exc
    if not blocks:
        raise ValueError("xlsx attachment produced no extractable text")
    return tuple(blocks)


def _load_xlsx_workbook_relationship_targets(archive: zipfile.ZipFile) -> dict[str, str]:
    try:
        relationships_root = ElementTree.fromstring(archive.read(_XLSX_WORKBOOK_RELS_PATH))
    except KeyError:
        return {}
    return {
        str(node.attrib.get("Id") or "").strip(): str(node.attrib.get("Target") or "").strip()
        for node in relationships_root.findall(f"{_PACKAGE_REL_NS}Relationship")
        if str(node.attrib.get("Id") or "").strip() and str(node.attrib.get("Target") or "").strip()
    }


def _load_xlsx_shared_strings(archive: zipfile.ZipFile) -> tuple[str, ...]:
    try:
        shared_strings_root = ElementTree.fromstring(archive.read(_XLSX_SHARED_STRINGS_PATH))
    except KeyError:
        return ()
    values: list[str] = []
    for node in shared_strings_root.findall(f"{_SPREADSHEETML_NS}si"):
        values.append(
            "".join(text_node.text or "" for text_node in node.iter(f"{_SPREADSHEETML_NS}t")).strip()
        )
    return tuple(values)


def _resolve_xlsx_zip_member_path(*, base_path: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_path), target))


def _load_xlsx_sheet_rows(
    *,
    sheet_xml: bytes,
    shared_strings: tuple[str, ...],
) -> tuple[str, ...]:
    root = ElementTree.fromstring(sheet_xml)
    rows: list[str] = []
    for row in root.findall(f".//{_SPREADSHEETML_NS}row"):
        cells: dict[int, str] = {}
        for cell in row.findall(f"{_SPREADSHEETML_NS}c"):
            value = _load_xlsx_cell_value(cell=cell, shared_strings=shared_strings)
            if value is None:
                continue
            column_index = _xlsx_column_index(cell.attrib.get("r"))
            cells[column_index] = value
        serialized = _serialize_spreadsheet_row(cells)
        if serialized is not None:
            rows.append(serialized)
    return tuple(rows)


def _load_xlsx_cell_value(
    *,
    cell,
    shared_strings: tuple[str, ...],
) -> str | None:
    cell_type = str(cell.attrib.get("t") or "").strip()
    if cell_type == "inlineStr":
        value = "".join(text_node.text or "" for text_node in cell.iter(f"{_SPREADSHEETML_NS}t")).strip()
        return value or None
    value_node = cell.find(f"{_SPREADSHEETML_NS}v")
    if value_node is None or value_node.text is None:
        return None
    raw_value = value_node.text.strip()
    if not raw_value:
        return None
    if cell_type == "s":
        try:
            shared_string = shared_strings[int(raw_value)]
        except (IndexError, ValueError):
            return raw_value
        return shared_string or None
    if cell_type == "b":
        return "TRUE" if raw_value == "1" else "FALSE"
    return raw_value


def _xlsx_column_index(cell_ref: str | None) -> int:
    if cell_ref is None:
        return 0
    letters = "".join(character for character in cell_ref if character.isalpha()).upper()
    if not letters:
        return 0
    value = 0
    for character in letters:
        value = value * 26 + (ord(character) - ord("A") + 1)
    return value - 1


def _extract_xls_text_blocks(file_bytes: bytes) -> tuple[str, ...]:
    try:
        import xlrd
    except ImportError as exc:  # pragma: no cover - dependency wiring is verified elsewhere.
        raise RuntimeError("xlrd is required for xls attachment extraction") from exc

    workbook = xlrd.open_workbook(file_contents=file_bytes)
    blocks: list[str] = []
    for sheet in workbook.sheets():
        rows: list[str] = []
        for row_index in range(sheet.nrows):
            cells: dict[int, str] = {}
            for col_index in range(sheet.ncols):
                value = _load_xls_cell_value(
                    cell=sheet.cell(row_index, col_index),
                    datemode=workbook.datemode,
                    xlrd_module=xlrd,
                )
                if value is not None:
                    cells[col_index] = value
            serialized = _serialize_spreadsheet_row(cells)
            if serialized is not None:
                rows.append(serialized)
        if rows:
            blocks.append(_serialize_spreadsheet_sheet_block(sheet.name.strip(), rows))
    if not blocks:
        raise ValueError("xls attachment produced no extractable text")
    return tuple(blocks)


def _load_xls_cell_value(*, cell, datemode: int, xlrd_module) -> str | None:
    cell_type = cell.ctype
    value = cell.value
    if cell_type == xlrd_module.XL_CELL_EMPTY:
        return None
    if cell_type == xlrd_module.XL_CELL_BOOLEAN:
        return "TRUE" if bool(value) else "FALSE"
    if cell_type == xlrd_module.XL_CELL_NUMBER:
        number = float(value)
        return str(int(number)) if number.is_integer() else format(number, "g")
    if cell_type == xlrd_module.XL_CELL_DATE:
        datetime_value = xlrd_module.xldate.xldate_as_datetime(value, datemode)
        return datetime_value.isoformat(sep=" ", timespec="seconds")
    text = str(value).strip()
    return text or None


def _serialize_spreadsheet_sheet_block(sheet_name: str, rows: Sequence[str]) -> str:
    prefix = [f"工作表：{sheet_name}"] if sheet_name else []
    return "\n".join((*prefix, *rows))


def _serialize_spreadsheet_row(cells: dict[int, str]) -> str | None:
    if not cells:
        return None
    max_index = max(cells)
    serialized = " | ".join(cells.get(index, "") for index in range(max_index + 1)).strip()
    return serialized or None

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
    fallback_candidate: str | None = None
    for field_name in (
        "original_filename",
        "final_url",
        "source_url",
        "normalized_source_url",
        "anchor_text",
        "object_key",
    ):
        value = _normalize_optional_text(attachment_ref.get(field_name))
        if value is None:
            continue
        candidate = Path(value.split("?", 1)[0]).name.strip()
        if candidate:
            suffix = Path(candidate).suffix.lower().strip()
            if suffix.startswith("."):
                suffix = suffix[1:]
            if suffix:
                return candidate
            if fallback_candidate is None:
                fallback_candidate = candidate
    if fallback_candidate is not None:
        return fallback_candidate
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


def _normalize_notice_ids(values: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted({str(item).strip() for item in values if str(item).strip()}))


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
