from __future__ import annotations

from dataclasses import dataclass, replace
import json
import os
from pathlib import Path
from typing import Any

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.authenticated_notice_source_truth import (
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
    AuthenticatedNoticeSourceMaterial,
    prepare_authenticated_notice_source_material,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    S3ObjectStoreWriter,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_document_artifact_key,
    build_raw_asset_key,
    build_source_provider_artifact_key,
    build_source_truth_artifact_key,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.campusrag_ingestion_support import utc_now


DEFAULT_AUTHENTICATED_NOTICE_CORPUS = "campus_notices"
DEFAULT_AUTHENTICATED_NOTICE_COLLECTION = "internal_notice"
DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL = "Qwen3-Embedding-4B"
DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION = "authenticated_notice_import_v1"
DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE = "authenticated_notice_bootstrap_import"
DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE = "campus"
DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS = ("campus_members",)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeImportRequest:
    bundle_path: Path
    export_manifest_path: Path | None
    site_id: str
    source_home_url: str
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    default_entitlement_groups: tuple[str, ...] = DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE
    parser_version: str = DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION
    embedding_model: str = DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL
    import_source: str = DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE

    def __post_init__(self) -> None:
        object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        if self.export_manifest_path is not None:
            object.__setattr__(self, "export_manifest_path", Path(self.export_manifest_path))
        object.__setattr__(self, "default_entitlement_groups", tuple(group.strip() for group in self.default_entitlement_groups if group.strip()))
        assert_known_scope(self.corpus, self.collection)
        if not self.site_id.strip():
            raise ValueError("site_id is required")
        if not self.source_home_url.strip():
            raise ValueError("source_home_url is required")


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticePreparedImport:
    notice_id: str
    raw_asset_id: str
    raw_version_id: str
    raw_record: RawAssetRecord
    capture_artifacts: dict[str, bytes]
    provider_artifacts: dict[str, bytes]
    source_truth_artifacts: dict[str, bytes]
    source_artifact_keys: dict[str, str]
    document_import: DocumentImportInput


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeBundleImportResult:
    notice_count: int
    notice_imports: tuple[AuthenticatedNoticePreparedImport, ...]


def import_authenticated_notice_bundle(
    request: AuthenticatedNoticeImportRequest,
) -> AuthenticatedNoticeBundleImportResult:
    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    export_manifest = _load_optional_json(request.export_manifest_path)
    bundle_payload = _load_bundle_payload(request.bundle_path)
    prepared: list[AuthenticatedNoticePreparedImport] = []
    for bundle_record in bundle_payload:
        material = prepare_authenticated_notice_source_material(
            bundle_record=bundle_record,
            export_manifest=export_manifest,
            site_id=request.site_id,
            source_home_url=request.source_home_url,
        )
        prepared.append(
            _prepare_notice_import(
                material=material,
                request=request,
                cleaning_policy_version=runtime_profile.cleaning_policy_version,
            )
        )
    return AuthenticatedNoticeBundleImportResult(
        notice_count=len(prepared),
        notice_imports=tuple(prepared),
    )


def import_authenticated_notice_export(
    *,
    request: AuthenticatedNoticeImportRequest,
    env: dict[str, str] | None = None,
    object_store: S3ObjectStoreWriter | object | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    object_store_settings = ObjectStoreSettings.from_env(source)
    writer = object_store or S3ObjectStoreWriter(object_store_settings)
    registry = document_registry or build_document_registry_from_env(source)
    raw_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    prepared = import_authenticated_notice_bundle(request)

    raw_uploaded_count = 0
    raw_reused_count = 0
    for notice_import in prepared.notice_imports:
        existing_raw_record = raw_registry.get(
            notice_import.raw_record.raw_asset_id,
            notice_import.raw_record.raw_version_id,
        )
        if existing_raw_record is None:
            raw_registry.upsert(notice_import.raw_record)
            raw_uploaded_count += 1
        else:
            raw_reused_count += 1
        for artifact_path, payload in (
            list(notice_import.capture_artifacts.items())
            + list(notice_import.provider_artifacts.items())
            + list(notice_import.source_truth_artifacts.items())
        ):
            key = notice_import.source_artifact_keys[artifact_path]
            writer.put_bytes(
                bucket=object_store_settings.bucket_source,
                key=key,
                data=payload,
                content_type=_content_type_for_artifact(artifact_path),
            )

    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    stats = collect_import_document_stats(
        documents=[
            _materialize_document_import_for_persistence(notice_import.document_import, notice_import.source_artifact_keys)
            for notice_import in prepared.notice_imports
        ],
        registry=registry,
        raw_asset_registry=raw_registry,
        writer=writer,
        object_store=object_store_settings,
        parser_version=request.parser_version,
        embedding_model=request.embedding_model,
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        default_visibility_scope=request.visibility_scope,
        scope_refresh=(request.corpus, request.collection),
    )
    return {
        "notice_count": prepared.notice_count,
        "created_document_ids": list(stats.created_document_ids),
        "updated_document_ids": list(stats.updated_document_ids),
        "skipped_document_ids": list(stats.skipped_document_ids),
        "raw_uploaded_count": raw_uploaded_count,
        "raw_reused_count": raw_reused_count,
        "errors": list(stats.errors),
    }


def _prepare_notice_import(
    *,
    material: AuthenticatedNoticeSourceMaterial,
    request: AuthenticatedNoticeImportRequest,
    cleaning_policy_version: str,
) -> AuthenticatedNoticePreparedImport:
    document_id = f"notice:{request.site_id}:{material.notice_id}"
    version_id = material.raw_version_id
    detail_key = build_raw_asset_key(
        corpus=request.corpus,
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        filename="detail-response.json",
        source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        year=material.year,
    )
    source_artifact_keys: dict[str, str] = {
        "capture/list-response.json": build_raw_asset_key(
            corpus=request.corpus,
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="list-response.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "capture/detail-response.json": detail_key,
        "capture/fetch-metadata.json": build_raw_asset_key(
            corpus=request.corpus,
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="fetch-metadata.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "provider/normalized-notice.json": build_source_provider_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="normalized-notice.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=material.year,
        ),
        "provider/discovered-links.jsonl": build_source_provider_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="discovered-links.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=material.year,
        ),
        "provider/attachment-observations.jsonl": build_source_provider_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="attachment-observations.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=material.year,
        ),
        "source-truth/notice-manifest.json": build_source_truth_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="notice-manifest.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "source-truth/content-blocks.jsonl": build_source_truth_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="content-blocks.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
        "source-truth/attachment-refs.jsonl": build_source_truth_artifact_key(
            raw_asset_id=material.raw_asset_id,
            raw_version_id=material.raw_version_id,
            filename="attachment-refs.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=material.year,
        ),
    }
    document_units_key = build_document_artifact_key(
        corpus=request.corpus,
        collection=request.collection,
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        filename="document-units.jsonl",
        title=material.title,
        year=material.year,
    )
    metadata: dict[str, Any] = {
        "document_id": document_id,
        "version_id": version_id,
        "source_url": material.source_uri,
        "source_id": document_id,
        "raw_page_start": None,
        "raw_page_end": None,
    }
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=request.default_entitlement_groups,
        visibility_scope=request.visibility_scope,
        visibility_level="restricted" if request.default_entitlement_groups else "public",
        policy_projection_version=DEFAULT_POLICY_PROJECTION_VERSION,
    )
    document_import = DocumentImportInput(
        source_label=f"notice:{material.notice_id}",
        document_units_bytes=material.document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=material.canonical_markdown_bytes,
        metadata=metadata,
        import_source=request.import_source,
        revision_track="source-faithful",
        source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        is_current=False,
        corpus=request.corpus,
        collection=request.collection,
        visibility_scope=request.visibility_scope,
        raw_source_uri=material.source_uri,
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        provider_response_object_key=source_artifact_keys["provider/normalized-notice.json"],
        additional_processed_object_keys=(
            "document-units.jsonl",
            "capture/list-response.json",
            "capture/detail-response.json",
            "capture/fetch-metadata.json",
            "provider/normalized-notice.json",
            "provider/discovered-links.jsonl",
            "provider/attachment-observations.jsonl",
            "source-truth/notice-manifest.json",
            "source-truth/content-blocks.jsonl",
            "source-truth/attachment-refs.jsonl",
        ),
        title=material.title,
        year=material.year,
    )
    raw_record = RawAssetRecord(
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        corpus=request.corpus,
        collection=request.collection,
        raw_source_uri=material.source_uri,
        content_hash=material.raw_version_id.split(":", 1)[1],
        source_filename="detail-response.json",
        object_key=detail_key,
        ingestion_timestamp=utc_now(),
        import_source=request.import_source,
    )
    return AuthenticatedNoticePreparedImport(
        notice_id=material.notice_id,
        raw_asset_id=material.raw_asset_id,
        raw_version_id=material.raw_version_id,
        raw_record=raw_record,
        capture_artifacts=material.capture_artifacts,
        provider_artifacts=material.provider_artifacts,
        source_truth_artifacts=material.source_truth_artifacts,
        source_artifact_keys=source_artifact_keys,
        document_import=document_import,
    )


def _load_bundle_payload(path: Path) -> tuple[dict[str, Any], ...]:
    if not path.exists():
        raise ValueError(f"bundle_path does not exist: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("authenticated notice bundle must be a JSON array")
    return tuple(item for item in payload if isinstance(item, dict))


def _load_optional_json(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    if not path.exists():
        raise ValueError(f"export_manifest_path does not exist: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("export manifest must be a JSON object")
    return payload


def _content_type_for_artifact(path: str) -> str:
    if path.endswith(".jsonl"):
        return "application/x-ndjson"
    if path.endswith(".json"):
        return "application/json"
    if path.endswith(".md"):
        return "text/markdown; charset=utf-8"
    return "application/octet-stream"


def _materialize_document_import_for_persistence(
    document: DocumentImportInput,
    source_artifact_keys: dict[str, str],
) -> DocumentImportInput:
    translated_keys = tuple(
        source_artifact_keys.get(key, key)
        for key in document.additional_processed_object_keys
    )
    provider_response_object_key = document.provider_response_object_key
    if provider_response_object_key is not None:
        provider_response_object_key = source_artifact_keys.get(
            "provider/normalized-notice.json",
            provider_response_object_key,
        )
    return replace(
        document,
        provider_response_object_key=provider_response_object_key,
        additional_processed_object_keys=translated_keys,
    )


__all__ = [
    "AuthenticatedNoticeBundleImportResult",
    "AuthenticatedNoticeImportRequest",
    "AuthenticatedNoticePreparedImport",
    "import_authenticated_notice_bundle",
    "import_authenticated_notice_export",
]
