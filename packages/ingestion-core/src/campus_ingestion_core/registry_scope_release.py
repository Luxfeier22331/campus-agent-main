from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol, Sequence

from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.index_release import (
    build_index_release_manifest,
    build_release_metadata_payload,
    default_release_id,
    publish_release_alias,
    reset_index_binding,
    resolve_alias_target,
    rollback_release_alias,
    validate_scope_release,
    write_index_release_artifacts,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import (
    IndexableChunk,
    build_indexable_chunks_from_record,
    index_chunks_to_qdrant,
)
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.registry_scope_chunk_preparation import (
    require_verified_chunk_preparation,
)
from campus_ingestion_core.registry_scope_common import (
    record_label,
    select_releasable_registry_records,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.sparse import SparseEmbeddingSettings, build_sparse_embedding_model

DEFAULT_QDRANT_UPSERT_BATCH_SIZE = 128
DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS = 60.0


class RegistryScopeObjectStore(Protocol):
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
class RegistryScopeReleaseReport:
    corpus: str
    collection: str
    release_id: str
    serving_alias: str
    physical_collection_name: str
    previous_physical_collection_name: str | None
    manifest_object_key: str
    validation_summary_object_key: str | None
    validation_status: str
    document_count: int
    point_count: int
    indexed_at: str
    published_at: str | None


def release_registry_scope(
    *,
    corpus: str,
    collection: str,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: RegistryScopeObjectStore | None = None,
    qdrant_client: QdrantClient | None = None,
    publish_alias: bool = True,
    reset_index: bool = False,
    preparation_run_id: str | None = None,
) -> RegistryScopeReleaseReport:
    source = dict(env if env is not None else os.environ)
    runtime_profile = load_runtime_profile(corpus, collection)
    object_store_settings = ObjectStoreSettings.from_env(source)
    if object_store is None:
        from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin

        runtime_object_store: RegistryScopeObjectStore = S3ObjectStoreAdmin(object_store_settings)
    else:
        runtime_object_store = object_store
    runtime_registry = registry or build_document_registry_from_env(
        source,
        prefer_operator=True,
    )
    runtime_qdrant_client = qdrant_client or _build_qdrant_client(
        RetrievalSettings.from_env(source),
        source=source,
    )
    if reset_index:
        reset_index_binding(
            qdrant_client=runtime_qdrant_client,
            binding=runtime_profile.qdrant_index_binding,
        )
    records = select_releasable_registry_records(
        records=runtime_registry.list_by_scope(corpus, collection),
        runtime_profile=runtime_profile,
    )
    if not records:
        raise ValueError(f"no releasable registry records found for {corpus}/{collection}")
    require_verified_chunk_preparation(
        corpus=corpus,
        collection=collection,
        preparation_run_id=preparation_run_id,
        records=records,
        object_store=runtime_object_store,
        bucket=object_store_settings.bucket_derived,
    )

    embedding_model = build_embedding_model(EmbeddingSettings.from_env(source))
    sparse_embedding_model = build_sparse_embedding_model(SparseEmbeddingSettings.from_env(source))
    chunks: list[IndexableChunk] = []
    empty_chunk_documents: list[str] = []
    for record in records:
        document_label = record_label(record)
        document_chunks = build_indexable_chunks_from_record(
            record=record,
            object_store=runtime_object_store,
            bucket=object_store_settings.bucket_derived,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )
        if not document_chunks:
            empty_chunk_documents.append(document_label)
            continue
        chunks.extend(document_chunks)
    if empty_chunk_documents:
        raise ValueError(
            "registry document " + "; ".join(empty_chunk_documents) + " produced no chunks"
        )

    return publish_scope_release(
        corpus=corpus,
        collection=collection,
        records=records,
        chunks=tuple(chunks),
        object_store=runtime_object_store,
        qdrant_client=runtime_qdrant_client,
        object_store_settings=object_store_settings,
        runtime_profile=runtime_profile,
        sparse_embedding_model=sparse_embedding_model,
        publish_alias=publish_alias,
        upsert_batch_size=_read_qdrant_upsert_batch_size(source),
    )


def publish_scope_release(
    *,
    corpus: str,
    collection: str,
    records: Sequence[DocumentRegistryRecord],
    chunks: Sequence[IndexableChunk],
    object_store: RegistryScopeObjectStore,
    qdrant_client: QdrantClient,
    object_store_settings: ObjectStoreSettings,
    runtime_profile: CollectionRuntimeProfile,
    sparse_embedding_model,
    publish_alias: bool,
    upsert_batch_size: int,
) -> RegistryScopeReleaseReport:
    if not records:
        raise ValueError(f"records must not be empty for {corpus}/{collection}")
    if not chunks:
        raise ValueError(f"chunks must not be empty for {corpus}/{collection}")

    binding = runtime_profile.qdrant_index_binding
    release_id = default_release_id()
    physical_collection_name = binding.build_physical_collection_name(release_id)
    previous_physical_collection_name = resolve_alias_target(
        qdrant_client=qdrant_client,
        alias_name=binding.alias_name,
    )
    validation = validate_scope_release(corpus=corpus, collection=collection, chunks=tuple(chunks))
    indexed_at = datetime.now(timezone.utc).isoformat()
    prepublish_manifest = build_index_release_manifest(
        release_id=release_id,
        corpus=corpus,
        collection=collection,
        binding=binding,
        physical_collection_name=physical_collection_name,
        previous_physical_collection_name=previous_physical_collection_name,
        records=tuple(records),
        chunks=tuple(chunks),
        validation=validation,
        indexed_at=indexed_at,
        published_at=None,
        validation_summary_object_key=None,
    )
    release_metadata = build_release_metadata_payload(
        manifest=prepublish_manifest,
        manifest_object_key=(f"{corpus}/releases/{collection}/{release_id}/index-release.json"),
    )

    pending_chunks: list[IndexableChunk] = []
    should_ensure_collection = True

    def flush_pending_chunks() -> None:
        nonlocal pending_chunks, should_ensure_collection
        if not pending_chunks:
            return
        index_chunks_to_qdrant(
            chunks=tuple(pending_chunks),
            qdrant_client=qdrant_client,
            collection_name=physical_collection_name,
            sparse_embedding_model=sparse_embedding_model,
            recreate_collection_on_schema_mismatch=True,
            ensure_collection=should_ensure_collection,
            ensure_payload_indexes=should_ensure_collection,
            extra_payload=release_metadata,
        )
        pending_chunks = []
        should_ensure_collection = False

    try:
        for chunk in chunks:
            pending_chunks.append(chunk)
            if len(pending_chunks) >= upsert_batch_size:
                flush_pending_chunks()
        flush_pending_chunks()
    except Exception:
        if qdrant_client.collection_exists(physical_collection_name):
            qdrant_client.delete_collection(collection_name=physical_collection_name)
        raise

    if validation.status != "passed":
        write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=prepublish_manifest,
            validation_summary=validation.summary,
        )
        if qdrant_client.collection_exists(physical_collection_name):
            qdrant_client.delete_collection(collection_name=physical_collection_name)
        raise ValueError(
            f"index release validation failed for {corpus}/{collection}: {validation.summary}"
        )

    if not publish_alias:
        artifacts = write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=prepublish_manifest,
            validation_summary=validation.summary,
        )
        return _build_release_report(artifacts)

    published_at = datetime.now(timezone.utc).isoformat()
    published_manifest = build_index_release_manifest(
        release_id=release_id,
        corpus=corpus,
        collection=collection,
        binding=binding,
        physical_collection_name=physical_collection_name,
        previous_physical_collection_name=previous_physical_collection_name,
        records=tuple(records),
        chunks=tuple(chunks),
        validation=validation,
        indexed_at=indexed_at,
        published_at=published_at,
        validation_summary_object_key=None,
    )
    alias_published = False
    try:
        publish_release_alias(
            qdrant_client=qdrant_client,
            binding=binding,
            physical_collection_name=physical_collection_name,
        )
        alias_published = True
        artifacts = write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=published_manifest,
            validation_summary=validation.summary,
        )
        return _build_release_report(artifacts)
    except Exception:
        if alias_published and previous_physical_collection_name is not None:
            rollback_release_alias(
                qdrant_client=qdrant_client,
                binding=binding,
                target_collection_name=previous_physical_collection_name,
            )
        elif alias_published:
            reset_index_binding(
                qdrant_client=qdrant_client,
                binding=binding,
            )
        if qdrant_client.collection_exists(physical_collection_name):
            qdrant_client.delete_collection(collection_name=physical_collection_name)
        raise


def _build_release_report(artifacts) -> RegistryScopeReleaseReport:
    manifest = artifacts.manifest
    return RegistryScopeReleaseReport(
        corpus=manifest.corpus,
        collection=manifest.collection,
        release_id=manifest.release_id,
        serving_alias=manifest.serving_alias,
        physical_collection_name=manifest.physical_collection_name,
        previous_physical_collection_name=manifest.previous_physical_collection_name,
        manifest_object_key=artifacts.manifest_object_key,
        validation_summary_object_key=artifacts.validation_summary_object_key,
        validation_status=manifest.validation_status,
        document_count=manifest.document_count,
        point_count=manifest.point_count,
        indexed_at=manifest.indexed_at,
        published_at=manifest.published_at,
    )


def _build_qdrant_client(
    settings: RetrievalSettings,
    *,
    source: dict[str, str] | None = None,
) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=_resolve_ingestion_qdrant_timeout_seconds(
            source=source,
            default_timeout_seconds=settings.qdrant_timeout_seconds,
        ),
        cloud_inference=True,
    )


def _resolve_ingestion_qdrant_timeout_seconds(
    *,
    source: dict[str, str] | None,
    default_timeout_seconds: float,
) -> float:
    env = source if source is not None else {}
    raw_value = (env.get("INGESTION_QDRANT_TIMEOUT_SECONDS") or "").strip()
    if raw_value:
        timeout_seconds = float(raw_value)
        if timeout_seconds <= 0:
            raise ValueError("INGESTION_QDRANT_TIMEOUT_SECONDS must be greater than zero")
        return timeout_seconds
    return max(default_timeout_seconds, DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS)


def _read_qdrant_upsert_batch_size(source: dict[str, str]) -> int:
    raw_value = (
        source.get("QDRANT_UPSERT_BATCH_SIZE") or str(DEFAULT_QDRANT_UPSERT_BATCH_SIZE)
    ).strip()
    batch_size = int(raw_value)
    if batch_size <= 0:
        raise ValueError("QDRANT_UPSERT_BATCH_SIZE must be greater than zero")
    return batch_size


__all__ = ["RegistryScopeReleaseReport", "publish_scope_release", "release_registry_scope"]
