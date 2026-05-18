from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from typing import Any

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_ingestion_core.process import IndexableChunk
from campus_ingestion_core.scope_catalog import QdrantIndexBinding
from campus_ingestion_core.sparse import SparseEmbeddingSettings


def count_by_value(values: Sequence[str] | Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


def hash_values(values: Sequence[str] | Any) -> str:
    digest = hashlib.sha256()
    for value in sorted(str(item) for item in values):
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_hybrid_query_profile(
    *,
    runtime_profile: CollectionRuntimeProfile,
    binding: QdrantIndexBinding,
    sparse_settings: SparseEmbeddingSettings | None,
) -> str:
    payload = {
        "dense_vector_name": runtime_profile.qdrant_index_binding.dense_vector_name
        or binding.dense_vector_name,
        "sparse_vector_name": runtime_profile.qdrant_index_binding.sparse_vector_name
        or binding.sparse_vector_name,
        "dense_prefetch_limit": runtime_profile.dense_prefetch_limit,
        "sparse_prefetch_limit": runtime_profile.sparse_prefetch_limit,
        "rrf_k": runtime_profile.rrf_k,
        "rrf_dense_weight": runtime_profile.rrf_dense_weight,
        "rrf_sparse_weight": runtime_profile.rrf_sparse_weight,
        "reranker_enabled_by_default": runtime_profile.reranker_enabled_by_default,
        "reranker_top_n": runtime_profile.reranker_top_n,
        "reranker_profile_version": runtime_profile.reranker_profile_version or "",
        "reranker_adoption_evidence_id": runtime_profile.reranker_adoption_evidence_id or "",
        "embedding_query_instruction_hash": hash_text(runtime_profile.embedding_query_instruction),
        "sparse_provider": sparse_settings.provider if sparse_settings is not None else "",
        "sparse_model": sparse_settings.model if sparse_settings is not None else "",
        "sparse_tokenizer": sparse_settings.tokenizer if sparse_settings is not None else "",
        "sparse_language": sparse_settings.language if sparse_settings is not None else "",
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def hash_profile_identity(
    *,
    runtime_profile: CollectionRuntimeProfile,
    binding: QdrantIndexBinding,
    embedding_provider: str,
    embedding_model: str,
    embedding_dimensions: int | None,
    sparse_settings: SparseEmbeddingSettings | None,
) -> str:
    payload = {
        "corpus": runtime_profile.corpus,
        "collection": runtime_profile.collection,
        "serving_stage": runtime_profile.serving_stage,
        "query_enabled_by_default": runtime_profile.query_enabled_by_default,
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
        "embedding_dimensions": embedding_dimensions,
        "sparse_provider": sparse_settings.provider if sparse_settings is not None else "",
        "sparse_model": sparse_settings.model if sparse_settings is not None else "",
        "sparse_tokenizer": sparse_settings.tokenizer if sparse_settings is not None else "",
        "sparse_language": sparse_settings.language if sparse_settings is not None else "",
        "cleaning_policy_version": runtime_profile.cleaning_policy_version,
        "chunk_policy_version": runtime_profile.chunk_profile_version,
        "dense_vector_name": runtime_profile.qdrant_index_binding.dense_vector_name
        or binding.dense_vector_name,
        "sparse_vector_name": runtime_profile.qdrant_index_binding.sparse_vector_name
        or binding.sparse_vector_name,
        "dense_prefetch_limit": runtime_profile.dense_prefetch_limit,
        "sparse_prefetch_limit": runtime_profile.sparse_prefetch_limit,
        "rrf_k": runtime_profile.rrf_k,
        "rrf_dense_weight": runtime_profile.rrf_dense_weight,
        "rrf_sparse_weight": runtime_profile.rrf_sparse_weight,
        "reranker_enabled_by_default": runtime_profile.reranker_enabled_by_default,
        "reranker_top_n": runtime_profile.reranker_top_n,
        "reranker_profile_version": runtime_profile.reranker_profile_version or "",
        "reranker_adoption_evidence_id": runtime_profile.reranker_adoption_evidence_id or "",
        "embedding_query_instruction_hash": hash_text(runtime_profile.embedding_query_instruction),
    }
    return hashlib.sha256(repr(tuple(sorted(payload.items()))).encode("utf-8")).hexdigest()


def single_embedding_model(chunks: Sequence[IndexableChunk]) -> str:
    models = {chunk.embedding_model for chunk in chunks if chunk.embedding_model.strip()}
    if not models:
        return ""
    if len(models) != 1:
        raise ValueError("index release chunks must use a single embedding model")
    return next(iter(models))


def resolve_chunk_embedding_dimensions(chunks: Sequence[IndexableChunk]) -> int | None:
    dimensions = {len(chunk.embedding) for chunk in chunks if chunk.embedding is not None}
    if not dimensions:
        return None
    if len(dimensions) != 1:
        raise ValueError("index release chunks must use one dense embedding dimension")
    return next(iter(dimensions))


def hash_chunk_fingerprint(chunks: Sequence[IndexableChunk]) -> str:
    digest = hashlib.sha256()
    for chunk in sorted(chunks, key=lambda item: item.chunk_id):
        payload = {
            "chunk_id": chunk.chunk_id,
            "document_id": chunk.document_id,
            "revision_track": chunk.revision_track,
            "version_id": chunk.version_id,
            "chunk_order": chunk.chunk_order,
            "source_chunk_id": chunk.source_chunk_id,
            "text_sha256": hashlib.sha256(chunk.text.encode("utf-8")).hexdigest(),
            "embedding_model": chunk.embedding_model,
            "metadata": chunk.metadata,
        }
        digest.update(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


__all__ = [
    "count_by_value",
    "hash_chunk_fingerprint",
    "hash_hybrid_query_profile",
    "hash_profile_identity",
    "hash_text",
    "hash_values",
    "resolve_chunk_embedding_dimensions",
    "single_embedding_model",
]
