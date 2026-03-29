from __future__ import annotations

from dataclasses import dataclass
import os

from campus_ingestion_core.local_rebuild import (
    LocalDataRebuildReport,
    QdrantAdmin,
    RebuildRequest,
    ReplayObjectStore,
    S3ObjectStoreAdmin,
    _build_raw_asset_registry_for_rebuild,
    _normalize_optional_text,
    _parse_bool,
    _resolve_runtime_collection_config,
    rebuild_local_data,
)
from campus_ingestion_core.object_store import build_raw_asset_key
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import load_split_manifest


DEFAULT_STUDENT_HANDBOOK_CANONICAL_RAW_FILENAME = "学生手册_2018.pdf"


@dataclass(frozen=True, slots=True)
class StudentHandbookMigrationReport:
    canonical_raw_filename: str
    previous_raw_object_key: str
    canonical_raw_object_key: str
    rebuild_report: LocalDataRebuildReport


@dataclass(frozen=True, slots=True)
class StudentHandbookSourceAssetRequest:
    raw_version_id: str
    raw_asset_id: str | None = None
    source_pdf: str | None = None
    canonical_raw_filename: str = DEFAULT_STUDENT_HANDBOOK_CANONICAL_RAW_FILENAME


def migrate_student_handbook_source_faithful(
    *,
    env: dict[str, str] | None = None,
    request: StudentHandbookSourceAssetRequest | None = None,
    object_store: ReplayObjectStore | None = None,
    qdrant_admin: QdrantAdmin | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> StudentHandbookMigrationReport:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or _build_student_handbook_source_asset_request_from_env(source)
    corpus = "regulations"
    collection = "student_handbook"
    collection_config = _resolve_runtime_collection_config(source=source, corpus=corpus, collection=collection)
    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus=corpus,
        expected_collection=collection,
    )
    raw_asset_id = runtime_request.raw_asset_id or split_manifest.raw_asset_id
    if raw_asset_id != split_manifest.raw_asset_id:
        raise ValueError("request raw_asset_id does not match collection split manifest raw_asset_id")
    canonical_raw_filename = runtime_request.canonical_raw_filename
    raw_version_id = runtime_request.raw_version_id
    raw_record = runtime_raw_asset_registry.get(raw_asset_id, raw_version_id)
    if raw_record is None:
        raise ValueError("raw asset registry record is required before handbook migration")

    canonical_raw_object_key = build_raw_asset_key(
        corpus=corpus,
        raw_asset_id=raw_record.raw_asset_id,
        raw_version_id=raw_record.raw_version_id,
        filename=canonical_raw_filename,
    )
    canonical_raw_record = RawAssetRecord(
        raw_asset_id=raw_record.raw_asset_id,
        raw_version_id=raw_record.raw_version_id,
        corpus=corpus,
        collection=collection,
        raw_source_uri=raw_record.raw_source_uri,
        content_hash=raw_record.content_hash,
        source_filename=canonical_raw_filename,
        object_key=canonical_raw_object_key,
        ingestion_timestamp=raw_record.ingestion_timestamp,
        import_source=raw_record.import_source,
    )
    if raw_record.object_key != canonical_raw_object_key:
        raw_bytes = runtime_object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=raw_record.object_key,
        )
        runtime_object_store.put_bytes(
            bucket=object_store_settings.bucket_source,
            key=canonical_raw_object_key,
            data=raw_bytes,
            content_type="application/pdf",
        )
        runtime_object_store.delete_prefix(
            bucket=object_store_settings.bucket_source,
            prefix=raw_record.object_key,
            exclude_keys=(canonical_raw_object_key,),
        )
    runtime_raw_asset_registry.upsert(canonical_raw_record)

    rebuild_env = dict(source)
    rebuild_env["REPLAY_SOURCE_PDF"] = canonical_raw_filename
    rebuild_report = rebuild_local_data(
        env=rebuild_env,
        request=RebuildRequest(
            corpus=corpus,
            collection=collection,
            import_mode="provider_response_replay",
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            source_pdf=canonical_raw_filename,
            reset_qdrant=_parse_bool(source.get("REBUILD_RESET_QDRANT"), default=False),
            index_qdrant=_parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False),
            publish_qdrant_alias=_parse_bool(source.get("REBUILD_PUBLISH_ALIAS"), default=True),
        ),
        object_store=runtime_object_store,
        qdrant_admin=qdrant_admin,
        document_registry=document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
    )
    return StudentHandbookMigrationReport(
        canonical_raw_filename=canonical_raw_filename,
        previous_raw_object_key=raw_record.object_key,
        canonical_raw_object_key=canonical_raw_object_key,
        rebuild_report=rebuild_report,
    )


def _build_student_handbook_source_asset_request_from_env(
    source: dict[str, str],
) -> StudentHandbookSourceAssetRequest:
    raw_version_id = _normalize_optional_text(source.get("RAW_VERSION_ID"))
    raw_asset_id = _normalize_optional_text(source.get("RAW_ASSET_ID"))
    if raw_version_id is None:
        raise ValueError("RAW_VERSION_ID is required for handbook source migration")
    return StudentHandbookSourceAssetRequest(
        raw_version_id=raw_version_id,
        raw_asset_id=raw_asset_id,
        source_pdf=_normalize_optional_text(source.get("REPLAY_SOURCE_PDF")),
        canonical_raw_filename=(
            _normalize_optional_text(source.get("HANDBOOK_CANONICAL_RAW_FILENAME"))
            or DEFAULT_STUDENT_HANDBOOK_CANONICAL_RAW_FILENAME
        ),
    )


__all__ = [
    "DEFAULT_STUDENT_HANDBOOK_CANONICAL_RAW_FILENAME",
    "StudentHandbookMigrationReport",
    "StudentHandbookSourceAssetRequest",
    "migrate_student_handbook_source_faithful",
]
