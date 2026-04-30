from __future__ import annotations

import json
import os
from dataclasses import dataclass

from campus_ingestion_core.handbook_service_navigation_hybrid_materialization import (
    FLOW_GRAPH_FILENAME,
    HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION,
    is_handbook_service_navigation_projection,
    materialize_handbook_service_navigation_projection_artifact,
)
from campus_ingestion_core.handbook_source_projections import (
    _resolve_projection_source_document,
    build_projection_target_document_id,
    load_handbook_source_projections_config,
)
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
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_document_artifact_key,
    build_raw_asset_key,
    build_source_projection_artifact_key,
    infer_year_label,
)
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
    collection = "student_rules"
    collection_config = _resolve_runtime_collection_config(
        source=source, corpus=corpus, collection=collection
    )
    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(
        source, corpus
    )
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus=corpus,
        expected_collection=collection,
    )
    raw_asset_id = runtime_request.raw_asset_id or split_manifest.raw_asset_id
    if raw_asset_id != split_manifest.raw_asset_id:
        raise ValueError(
            "request raw_asset_id does not match collection split manifest raw_asset_id"
        )
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
    _backfill_handbook_service_navigation_projection_artifacts(
        source=source,
        object_store=runtime_object_store,
        object_store_settings=object_store_settings,
        raw_asset_record=canonical_raw_record,
        split_manifest=split_manifest,
        source_projections_path=collection_config.source_projections_path,
    )

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
            publish_qdrant_alias=_parse_bool(source.get("REBUILD_PUBLISH_ALIAS"), default=False),
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


def _backfill_handbook_service_navigation_projection_artifacts(
    *,
    source: dict[str, str],
    object_store,
    object_store_settings: ObjectStoreSettings,
    raw_asset_record: RawAssetRecord,
    split_manifest,
    source_projections_path,
) -> None:
    config = load_handbook_source_projections_config(source_projections_path)
    manifest_by_document_id = {
        document.document_id: document for document in split_manifest.documents
    }
    year = infer_year_label(raw_asset_record.source_filename)
    for projection in config.projections:
        if not is_handbook_service_navigation_projection(
            projection_name=projection.projection_name,
            target_collection=projection.target_collection,
            attachment_role=projection.attachment_role,
            source_page_start=projection.source_page_start,
            source_page_end=projection.source_page_end,
        ):
            continue
        source_document = _resolve_projection_source_document(
            projection=projection,
            manifest_by_document_id=manifest_by_document_id,
            split_manifest_documents=split_manifest.documents,
        )
        if source_document is None:
            continue
        projection_artifact_key = build_source_projection_artifact_key(
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            projection_name=projection.projection_name,
            filename=FLOW_GRAPH_FILENAME,
            year=year,
        )
        if _object_exists(
            object_store=object_store,
            bucket=object_store_settings.bucket_source,
            key=projection_artifact_key,
        ):
            continue
        legacy_flow_graph_key = build_document_artifact_key(
            corpus=projection.target_corpus,
            collection=projection.target_collection,
            document_id=build_projection_target_document_id(projection=projection),
            revision_track="source-faithful",
            version_id="legacy-projection",
            filename=FLOW_GRAPH_FILENAME,
            title=projection.target_title or source_document.title,
            year=year,
        )
        legacy_payload = _load_optional_bytes(
            object_store=object_store,
            bucket=object_store_settings.bucket_derived,
            key=legacy_flow_graph_key,
        )
        if legacy_payload is not None:
            object_store.put_bytes(
                bucket=object_store_settings.bucket_source,
                key=projection_artifact_key,
                data=_wrap_legacy_projection_payload(
                    legacy_payload=legacy_payload,
                    projection_name=projection.projection_name,
                    raw_asset_record=raw_asset_record,
                    source_document_id=source_document.document_id,
                    source_uri=source_document.source_uri or "",
                    source_handbook_section=source_document.handbook_section
                    or source_document.title,
                    target_document_id=build_projection_target_document_id(projection=projection),
                    target_title=projection.target_title or source_document.title,
                    source_page_start=source_document.page_start,
                    source_page_end=source_document.page_end,
                ),
                content_type="application/json",
            )
            continue
        artifact = materialize_handbook_service_navigation_projection_artifact(
            source=source,
            reader=object_store,
            source_bucket=object_store_settings.bucket_source,
            raw_asset_record=raw_asset_record,
            source_document_id=source_document.document_id,
            source_uri=source_document.source_uri or "",
            source_handbook_section=source_document.handbook_section or source_document.title,
            target_document_id=build_projection_target_document_id(projection=projection),
            target_title=projection.target_title or source_document.title,
            projection_name=projection.projection_name,
            source_page_start=source_document.page_start,
            source_page_end=source_document.page_end,
        )
        object_store.put_bytes(
            bucket=object_store_settings.bucket_source,
            key=artifact.object_key,
            data=artifact.data,
            content_type=artifact.content_type,
        )


def _object_exists(*, object_store, bucket: str, key: str) -> bool:
    return _load_optional_bytes(object_store=object_store, bucket=bucket, key=key) is not None


def _load_optional_bytes(*, object_store, bucket: str, key: str) -> bytes | None:
    try:
        return object_store.get_bytes(bucket=bucket, key=key)
    except Exception:
        return None


def _wrap_legacy_projection_payload(
    *,
    legacy_payload: bytes,
    projection_name: str,
    raw_asset_record: RawAssetRecord,
    source_document_id: str,
    source_uri: str,
    source_handbook_section: str,
    target_document_id: str,
    target_title: str,
    source_page_start: int,
    source_page_end: int,
) -> bytes:
    payload = json.loads(legacy_payload)
    if not isinstance(payload, dict):
        raise ValueError("legacy handbook service navigation flow graph must be a JSON object")
    if (
        str(payload.get("schema_version") or "").strip()
        == HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION
    ):
        return legacy_payload
    wrapped_payload = {
        "schema_version": HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION,
        "projection_name": projection_name,
        "raw_asset_id": raw_asset_record.raw_asset_id,
        "raw_version_id": raw_asset_record.raw_version_id,
        "source_document_id": source_document_id,
        "source_uri": source_uri,
        "source_handbook_section": source_handbook_section,
        "source_page_start": source_page_start,
        "source_page_end": source_page_end,
        "target_document_id": target_document_id,
        "target_title": target_title,
        "extractor_runtime": {"kind": "legacy_document_projection_copy", "mode": "backfill"},
        "flow_graph": payload,
    }
    return (json.dumps(wrapped_payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


__all__ = [
    "DEFAULT_STUDENT_HANDBOOK_CANONICAL_RAW_FILENAME",
    "StudentHandbookMigrationReport",
    "StudentHandbookSourceAssetRequest",
    "migrate_student_handbook_source_faithful",
]
