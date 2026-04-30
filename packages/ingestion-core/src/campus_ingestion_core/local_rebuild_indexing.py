from __future__ import annotations

import hashlib
from collections.abc import Callable
from datetime import UTC, datetime

from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.index_release import (
    build_index_release_manifest,
    build_release_metadata_payload,
    default_release_id,
    resolve_alias_target,
    validate_scope_release,
    write_index_release_artifacts,
)
from campus_ingestion_core.local_rebuild_runtime import (
    _build_qdrant_client,
    _resolve_target_qdrant_binding,
    _should_publish_qdrant_alias_for_replay,
)
from campus_ingestion_core.local_rebuild_support import (
    DEFAULT_QDRANT_UPSERT_BATCH_SIZE,
    _RebuildTraceRecorder,
    _run_traced_stage,
)
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl, index_chunks_to_qdrant
from campus_ingestion_core.registry import DocumentRegistry
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.sparse import SparseEmbeddingSettings, build_sparse_embedding_model


def _index_replayed_documents(
    *,
    source: dict[str, str],
    registry: DocumentRegistry,
    documents: list[DocumentImportInput],
    object_store,
    qdrant_client: QdrantClient | None,
    trace_recorder: _RebuildTraceRecorder | None = None,
) -> None:
    runtime_qdrant_client = qdrant_client or _build_qdrant_client(
        RetrievalSettings.from_env(source), source=source
    )
    object_store_settings = ObjectStoreSettings.from_env(source)
    upsert_batch_size = _read_qdrant_upsert_batch_size(source)
    embedding_settings = EmbeddingSettings.from_env(source)
    embedding_model = build_embedding_model(embedding_settings)
    sparse_embedding_model = build_sparse_embedding_model(SparseEmbeddingSettings.from_env(source))
    _should_publish_qdrant_alias_for_replay(source)
    release_id = default_release_id()
    documents_by_scope: dict[tuple[str, str], list[DocumentImportInput]] = {}
    for document in documents:
        scope = (document.corpus, document.collection)
        documents_by_scope.setdefault(scope, []).append(document)

    for (corpus, collection), scope_documents in documents_by_scope.items():
        binding = _resolve_target_qdrant_binding(corpus=corpus, collection=collection)
        physical_collection_name = binding.build_physical_collection_name(release_id)
        previous_physical_collection_name = resolve_alias_target(
            qdrant_client=runtime_qdrant_client,
            alias_name=binding.alias_name,
        )
        records, chunks, document_units_sha256_by_key = _run_traced_stage(
            trace_recorder,
            "replay.index_scope.prepare",
            lambda corpus=corpus, collection=collection, scope_documents=scope_documents: (
                _prepare_replay_scope_chunks(
                    corpus=corpus,
                    collection=collection,
                    scope_documents=scope_documents,
                    registry=registry,
                    embedding_model=embedding_model,
                    sparse_embedding_model=sparse_embedding_model,
                )
            ),
            fields={
                "scope": f"{corpus}/{collection}",
                "document_count": len(scope_documents),
                "alias_name": binding.alias_name,
                "physical_collection_name": physical_collection_name,
            },
            result_fields=lambda payload: {
                "record_count": len(payload[0]),
                "chunk_count": len(payload[1]),
            },
        )
        if not chunks:
            continue
        _validate_chunk_embedding_runtime_identity(chunks=chunks, settings=embedding_settings)

        validation = _run_traced_stage(
            trace_recorder,
            "replay.index_scope.validate",
            lambda corpus=corpus, collection=collection, chunks=chunks: validate_scope_release(
                corpus=corpus, collection=collection, chunks=tuple(chunks)
            ),
            fields={
                "scope": f"{corpus}/{collection}",
                "chunk_count": len(chunks),
            },
            result_fields=lambda result: {"validation_status": result.status},
        )
        validation_summary_object_key = build_index_release_artifact_key(
            corpus=corpus,
            collection=collection,
            release_id=release_id,
            filename="validation-summary.json",
        )
        indexed_at = datetime.now(UTC).isoformat()
        manifest_object_key = build_index_release_artifact_key(
            corpus=corpus,
            collection=collection,
            release_id=release_id,
            filename="index-release.json",
        )
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
            validation_summary_object_key=validation_summary_object_key,
            embedding_provider=embedding_settings.provider,
            embedding_dimensions=embedding_settings.dimensions,
            document_units_sha256_by_key=document_units_sha256_by_key,
            runtime_profile=load_runtime_profile(corpus, collection),
            sparse_settings=getattr(sparse_embedding_model, "settings", None),
        )
        release_metadata = build_release_metadata_payload(
            manifest=prepublish_manifest,
            manifest_object_key=manifest_object_key,
        )

        pending_chunks = []
        should_ensure_collection = True

        def flush_pending_chunks(
            bucket: list[object] = pending_chunks,
            collection_name: str = physical_collection_name,
            extra_payload: dict[str, object] = release_metadata,
        ) -> None:
            nonlocal should_ensure_collection
            if not bucket:
                return
            index_chunks_to_qdrant(
                chunks=tuple(bucket),
                qdrant_client=runtime_qdrant_client,
                collection_name=collection_name,
                sparse_embedding_model=sparse_embedding_model,
                recreate_collection_on_schema_mismatch=True,
                ensure_collection=should_ensure_collection,
                ensure_payload_indexes=should_ensure_collection,
                extra_payload=extra_payload,
            )
            bucket.clear()
            should_ensure_collection = False

        def add_pending_chunk(chunk: object, bucket: list[object] = pending_chunks) -> None:
            bucket.append(chunk)

        try:
            _run_traced_stage(
                trace_recorder,
                "replay.index_scope.upsert_qdrant",
                lambda chunks=chunks: _upsert_replay_scope_chunks(
                    chunks=chunks,
                    upsert_batch_size=upsert_batch_size,
                    add_pending_chunk=add_pending_chunk,
                    flush_pending_chunks=flush_pending_chunks,
                ),
                fields={
                    "scope": f"{corpus}/{collection}",
                    "chunk_count": len(chunks),
                    "upsert_batch_size": upsert_batch_size,
                    "physical_collection_name": physical_collection_name,
                },
            )
        except Exception:
            if runtime_qdrant_client.collection_exists(physical_collection_name):
                runtime_qdrant_client.delete_collection(collection_name=physical_collection_name)
            raise

        if validation.status != "passed":
            _run_traced_stage(
                trace_recorder,
                "replay.index_scope.write_artifacts_preview",
                lambda prepublish_manifest=prepublish_manifest, validation=validation: (
                    write_index_release_artifacts(
                        writer=object_store,
                        bucket=object_store_settings.bucket_derived,
                        manifest=prepublish_manifest,
                        validation_summary=validation.summary,
                    )
                ),
                fields={
                    "scope": f"{corpus}/{collection}",
                    "publish_alias": False,
                },
            )
            if runtime_qdrant_client.collection_exists(physical_collection_name):
                runtime_qdrant_client.delete_collection(collection_name=physical_collection_name)
            raise ValueError(
                f"index release validation failed for {corpus}/{collection}: {validation.summary}"
            )

        _run_traced_stage(
            trace_recorder,
            "replay.index_scope.write_artifacts_preview",
            lambda prepublish_manifest=prepublish_manifest, validation=validation: (
                write_index_release_artifacts(
                    writer=object_store,
                    bucket=object_store_settings.bucket_derived,
                    manifest=prepublish_manifest,
                    validation_summary=validation.summary,
                )
            ),
            fields={
                "scope": f"{corpus}/{collection}",
                "publish_alias": False,
            },
        )


def _prepare_replay_scope_chunks(
    *,
    corpus: str,
    collection: str,
    scope_documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    embedding_model: object,
    sparse_embedding_model: object,
) -> tuple[list[object], list[object], dict[str, str]]:
    records = []
    chunks = []
    document_units_sha256_by_key: dict[str, str] = {}
    missing_registry_documents: list[str] = []
    empty_chunk_documents: list[str] = []
    for document in scope_documents:
        document_id = str(document.metadata["document_id"])
        version_id = str(document.metadata["version_id"])
        document_label = f"{corpus}/{collection} {document_id}@{version_id}"
        record = registry.get(document_id, document.revision_track, version_id)
        if record is None:
            missing_registry_documents.append(document_label)
            continue
        records.append(record)
        if record.document_units_object_key:
            document_units_sha256_by_key[record.document_units_object_key] = hashlib.sha256(
                document.document_units_bytes
            ).hexdigest()
        document_chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=document.document_units_bytes,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )
        if not document_chunks:
            empty_chunk_documents.append(document_label)
            continue
        chunks.extend(document_chunks)
    if missing_registry_documents:
        raise ValueError(
            "missing registry record for replayed document " + "; ".join(missing_registry_documents)
        )
    if empty_chunk_documents:
        raise ValueError(
            "replayed document " + "; ".join(empty_chunk_documents) + " produced no chunks"
        )
    return records, chunks, document_units_sha256_by_key


def _upsert_replay_scope_chunks(
    *,
    chunks: list[object],
    upsert_batch_size: int,
    add_pending_chunk: Callable[[object], None],
    flush_pending_chunks: Callable[[], None],
) -> None:
    pending_count = 0
    for chunk in chunks:
        add_pending_chunk(chunk)
        pending_count += 1
        if pending_count >= upsert_batch_size:
            flush_pending_chunks()
            pending_count = 0
    flush_pending_chunks()


def _read_qdrant_upsert_batch_size(source: dict[str, str]) -> int:
    raw_value = (
        source.get("QDRANT_UPSERT_BATCH_SIZE") or str(DEFAULT_QDRANT_UPSERT_BATCH_SIZE)
    ).strip()
    batch_size = int(raw_value)
    if batch_size <= 0:
        raise ValueError("QDRANT_UPSERT_BATCH_SIZE must be greater than zero")
    return batch_size


def _validate_chunk_embedding_runtime_identity(
    *,
    chunks: list[object],
    settings: EmbeddingSettings,
) -> None:
    chunk_models = {
        chunk.embedding_model for chunk in chunks if getattr(chunk, "embedding_model", "").strip()
    }
    if chunk_models and chunk_models != {settings.model}:
        raise ValueError(
            "replay chunk embedding model mismatch: "
            f"expected {settings.model}, got {', '.join(sorted(chunk_models))}"
        )
    if settings.dimensions is None:
        return
    chunk_dimensions = {
        len(chunk.embedding) for chunk in chunks if getattr(chunk, "embedding", None) is not None
    }
    if chunk_dimensions and chunk_dimensions != {settings.dimensions}:
        raise ValueError(
            "replay chunk embedding dimensions mismatch: "
            f"expected {settings.dimensions}, got {', '.join(str(item) for item in sorted(chunk_dimensions))}"
        )
