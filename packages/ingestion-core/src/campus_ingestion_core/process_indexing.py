from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.process_chunking import build_indexable_chunks_from_jsonl
from campus_ingestion_core.process_shared import IndexableChunk, ProcessArtifactReader
from campus_ingestion_core.sparse import (
    SparseEmbeddingModel,
    SparseEmbeddingSettings,
    build_sparse_embedding_model,
)

PayloadIndexSchema = tuple[tuple[str, qdrant_models.PayloadSchemaType], ...]


@dataclass(frozen=True, slots=True)
class PayloadIndexAuditReport:
    status: str
    collection_name: str
    expected_indexes: dict[str, str]
    missing_indexes: tuple[str, ...] = ()
    mismatched_indexes: tuple[str, ...] = ()
    skipped_reason: str = ""

    @property
    def summary(self) -> dict[str, object]:
        return {
            "status": self.status,
            "collection_name": self.collection_name,
            "expected_indexes": self.expected_indexes,
            "missing_indexes": self.missing_indexes,
            "mismatched_indexes": self.mismatched_indexes,
            "skipped_reason": self.skipped_reason,
        }


def build_indexable_chunks_from_record(
    *,
    record,
    object_store: ProcessArtifactReader,
    bucket: str,
    chunk_profile=None,
    embedding_model=None,
    sparse_embedding_model=None,
) -> tuple[IndexableChunk, ...]:
    document_units_key = record.document_units_object_key
    if not document_units_key:
        raise ValueError("document_units_object_key is required to build indexable chunks")
    structured_jsonl_bytes = object_store.get_bytes(bucket=bucket, key=document_units_key)
    return build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=structured_jsonl_bytes,
        chunk_profile=chunk_profile,
        embedding_model=embedding_model,
        sparse_embedding_model=sparse_embedding_model,
    )


def index_chunks_to_qdrant(
    *,
    chunks: Sequence[IndexableChunk],
    qdrant_client: QdrantClient,
    collection_name: str,
    sparse_embedding_model: SparseEmbeddingModel | None = None,
    recreate_collection_on_schema_mismatch: bool = False,
    ensure_collection: bool = True,
    ensure_payload_indexes: bool = True,
    extra_payload: dict[str, object] | None = None,
) -> tuple[str, ...]:
    if not chunks:
        return ()
    runtime_sparse_embedding_model = sparse_embedding_model or build_sparse_embedding_model(
        SparseEmbeddingSettings()
    )
    runtime_profile = load_runtime_profile(chunks[0].corpus, chunks[0].collection)
    runtime_extra_payload = dict(extra_payload or {})
    if ensure_collection:
        ensure_collection_exists(
            qdrant_client=qdrant_client,
            collection_name=collection_name,
            dense_vector_size=resolve_dense_vector_size(chunks),
            dense_vector_name=runtime_profile.qdrant_index_binding.dense_vector_name,
            sparse_vector_name=runtime_profile.qdrant_index_binding.sparse_vector_name,
            recreate_on_mismatch=recreate_collection_on_schema_mismatch,
        )
    if ensure_payload_indexes:
        ensure_payload_indexes_exist(qdrant_client=qdrant_client, collection_name=collection_name)
    points: list[qdrant_models.PointStruct] = []
    for chunk in chunks:
        node = chunk.to_node()
        if runtime_extra_payload:
            node.metadata.update(runtime_extra_payload)
        if chunk.embedding is None:
            raise ValueError(f"chunk {chunk.chunk_id} is missing dense embedding")
        sparse_vector = resolve_sparse_vector(
            chunk=chunk,
            sparse_embedding_model=runtime_sparse_embedding_model,
        )
        points.append(
            qdrant_models.PointStruct(
                id=str(uuid.uuid5(uuid.NAMESPACE_URL, chunk.chunk_id)),
                vector={
                    runtime_profile.qdrant_index_binding.dense_vector_name: list(chunk.embedding),
                    runtime_profile.qdrant_index_binding.sparse_vector_name: sparse_vector,
                },
                payload={
                    "_node_content": node.model_dump_json(),
                    **node.metadata,
                },
            )
        )
    qdrant_client.upsert(
        collection_name=collection_name,
        points=points,
        wait=True,
    )
    return tuple(str(point.id) for point in points)


def ensure_payload_indexes_exist(*, qdrant_client: QdrantClient, collection_name: str) -> None:
    if not qdrant_client.collection_exists(collection_name):
        return
    if is_local_qdrant_backend(qdrant_client):
        return
    for field_name, field_schema in required_payload_index_schemas():
        qdrant_client.create_payload_index(
            collection_name=collection_name,
            field_name=field_name,
            field_schema=field_schema,
            wait=True,
        )


def required_payload_index_schemas() -> PayloadIndexSchema:
    return (
        ("document_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("revision_track", qdrant_models.PayloadSchemaType.KEYWORD),
        ("version_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("corpus", qdrant_models.PayloadSchemaType.KEYWORD),
        ("collection", qdrant_models.PayloadSchemaType.KEYWORD),
        ("canonical_course_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("canonical_course_family_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("canonical_program_family_id", qdrant_models.PayloadSchemaType.KEYWORD),
        ("visibility_scope", qdrant_models.PayloadSchemaType.KEYWORD),
        ("entitlement_groups", qdrant_models.PayloadSchemaType.KEYWORD),
        ("visibility_level", qdrant_models.PayloadSchemaType.KEYWORD),
        ("policy_projection_version", qdrant_models.PayloadSchemaType.KEYWORD),
        ("status", qdrant_models.PayloadSchemaType.KEYWORD),
        ("source_channel", qdrant_models.PayloadSchemaType.KEYWORD),
        ("is_current", qdrant_models.PayloadSchemaType.BOOL),
    )


def audit_payload_indexes(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
) -> PayloadIndexAuditReport:
    expected = {
        field_name: _payload_schema_type_name(field_schema)
        for field_name, field_schema in required_payload_index_schemas()
    }
    if is_local_qdrant_backend(qdrant_client):
        return PayloadIndexAuditReport(
            status="skipped",
            collection_name=collection_name,
            expected_indexes=expected,
            skipped_reason="local_qdrant_backend",
        )
    if not qdrant_client.collection_exists(collection_name):
        return PayloadIndexAuditReport(
            status="failed",
            collection_name=collection_name,
            expected_indexes=expected,
            missing_indexes=tuple(expected),
        )
    collection_info = qdrant_client.get_collection(collection_name=collection_name)
    payload_schema = _collection_payload_schema(collection_info)
    missing: list[str] = []
    mismatched: list[str] = []
    for field_name, expected_type in expected.items():
        if field_name not in payload_schema:
            missing.append(field_name)
            continue
        actual_type = _payload_schema_type_name(payload_schema[field_name])
        if actual_type != expected_type:
            mismatched.append(field_name)
    status = "passed" if not missing and not mismatched else "failed"
    return PayloadIndexAuditReport(
        status=status,
        collection_name=collection_name,
        expected_indexes=expected,
        missing_indexes=tuple(missing),
        mismatched_indexes=tuple(mismatched),
    )


def ensure_collection_exists(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    dense_vector_name: str,
    sparse_vector_name: str,
    dense_vector_size: int,
    recreate_on_mismatch: bool,
) -> None:
    if not qdrant_client.collection_exists(collection_name):
        create_collection(
            qdrant_client=qdrant_client,
            collection_name=collection_name,
            dense_vector_name=dense_vector_name,
            sparse_vector_name=sparse_vector_name,
            dense_vector_size=dense_vector_size,
        )
        return
    if collection_schema_matches(
        qdrant_client=qdrant_client,
        collection_name=collection_name,
        dense_vector_name=dense_vector_name,
        sparse_vector_name=sparse_vector_name,
        dense_vector_size=dense_vector_size,
    ):
        return
    if not recreate_on_mismatch:
        raise ValueError(f"collection {collection_name} does not match dense+sparse schema")
    qdrant_client.delete_collection(collection_name=collection_name)
    create_collection(
        qdrant_client=qdrant_client,
        collection_name=collection_name,
        dense_vector_name=dense_vector_name,
        sparse_vector_name=sparse_vector_name,
        dense_vector_size=dense_vector_size,
    )


def create_collection(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    dense_vector_name: str,
    sparse_vector_name: str,
    dense_vector_size: int,
) -> None:
    qdrant_client.create_collection(
        collection_name=collection_name,
        vectors_config={
            dense_vector_name: qdrant_models.VectorParams(
                size=dense_vector_size,
                distance=qdrant_models.Distance.COSINE,
            )
        },
        sparse_vectors_config={
            sparse_vector_name: qdrant_models.SparseVectorParams(
                modifier=qdrant_models.Modifier.IDF
            ),
        },
    )


def collection_schema_matches(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    dense_vector_name: str,
    sparse_vector_name: str,
    dense_vector_size: int,
) -> bool:
    info = qdrant_client.get_collection(collection_name=collection_name)
    params = info.config.params
    vectors = params.vectors
    if not isinstance(vectors, dict):
        return False
    dense = vectors.get(dense_vector_name)
    sparse = (params.sparse_vectors or {}).get(sparse_vector_name)
    return (
        dense is not None
        and getattr(dense, "size", None) == dense_vector_size
        and getattr(dense, "distance", None) == qdrant_models.Distance.COSINE
        and sparse is not None
        and getattr(sparse, "modifier", None) == qdrant_models.Modifier.IDF
    )


def resolve_sparse_vector(
    *,
    chunk: IndexableChunk,
    sparse_embedding_model: SparseEmbeddingModel,
) -> qdrant_models.Document | qdrant_models.SparseVector:
    if bool(chunk.sparse_indices) != bool(chunk.sparse_values):
        raise ValueError(f"chunk {chunk.chunk_id} sparse vector is incomplete")
    if len(chunk.sparse_indices) != len(chunk.sparse_values):
        raise ValueError(f"chunk {chunk.chunk_id} sparse vector length mismatch")
    if chunk.sparse_indices:
        return qdrant_models.SparseVector(
            indices=list(chunk.sparse_indices), values=list(chunk.sparse_values)
        )
    return sparse_embedding_model.build_document(chunk.text)


def resolve_dense_vector_size(chunks: Sequence[IndexableChunk]) -> int:
    first_embedding = next(
        (chunk.embedding for chunk in chunks if chunk.embedding is not None), None
    )
    if first_embedding is None:
        raise ValueError("chunk embedding is required for qdrant indexing")
    return len(first_embedding)


def is_local_qdrant_backend(qdrant_client: QdrantClient) -> bool:
    client = getattr(qdrant_client, "_client", None)
    return client is not None and type(client).__module__.startswith("qdrant_client.local.")


def _collection_payload_schema(collection_info: object) -> Mapping[str, object]:
    payload_schema = getattr(collection_info, "payload_schema", None)
    if isinstance(payload_schema, Mapping):
        return payload_schema
    config = getattr(collection_info, "config", None)
    config_payload_schema = getattr(config, "payload_schema", None)
    if isinstance(config_payload_schema, Mapping):
        return config_payload_schema
    if isinstance(collection_info, Mapping):
        raw_schema = collection_info.get("payload_schema")
        if isinstance(raw_schema, Mapping):
            return raw_schema
    return {}


def _payload_schema_type_name(value: object) -> str:
    for attribute_name in (
        "data_type",
        "field_schema",
        "schema",
        "type",
    ):
        attribute_value = getattr(value, attribute_name, None)
        if attribute_value is not None:
            return _payload_schema_type_name(attribute_value)
    if isinstance(value, Mapping):
        for key in ("data_type", "field_schema", "schema", "type"):
            if key in value:
                return _payload_schema_type_name(value[key])
    raw_value = getattr(value, "value", value)
    normalized = str(raw_value).strip().lower()
    if "." in normalized:
        normalized = normalized.rsplit(".", 1)[-1]
    return normalized


__all__ = [
    "PayloadIndexAuditReport",
    "audit_payload_indexes",
    "build_indexable_chunks_from_record",
    "index_chunks_to_qdrant",
    "required_payload_index_schemas",
]
