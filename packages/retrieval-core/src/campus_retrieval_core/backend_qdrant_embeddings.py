from __future__ import annotations

import hashlib
import json
import time

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile

from campus_retrieval_core.backend_qdrant_query import _build_dense_query_text


def get_dense_query_embedding(
    backend,
    query_text: str,
    *,
    profile: CollectionRuntimeProfile,
) -> tuple[float, ...]:
    normalized_query = _build_dense_query_text(
        query_text=query_text,
        instruction=profile.embedding_query_instruction,
    )
    cache_key = _build_dense_query_cache_key(
        backend,
        normalized_query=normalized_query,
        profile=profile,
    )
    now = time.monotonic()
    with backend._dense_query_cache_lock:
        cached = backend._dense_query_cache.get(cache_key)
        if cached is not None:
            expires_at, embedding = cached
            if expires_at > now:
                backend._dense_query_cache.move_to_end(cache_key)
                return embedding
            backend._dense_query_cache.pop(cache_key, None)
    embedding = tuple(
        float(item) for item in backend.embedding_model.get_query_embedding(normalized_query)
    )
    if backend.dense_query_cache_ttl_seconds > 0 and backend.dense_query_cache_max_entries > 0:
        with backend._dense_query_cache_lock:
            backend._dense_query_cache[cache_key] = (
                now + backend.dense_query_cache_ttl_seconds,
                embedding,
            )
            backend._dense_query_cache.move_to_end(cache_key)
            trim_dense_query_cache(backend, now=now)
    return embedding


def trim_dense_query_cache(backend, *, now: float) -> None:
    expired_keys = [
        key for key, (expires_at, _) in backend._dense_query_cache.items() if expires_at <= now
    ]
    for key in expired_keys:
        backend._dense_query_cache.pop(key, None)
    while len(backend._dense_query_cache) > backend.dense_query_cache_max_entries:
        backend._dense_query_cache.popitem(last=False)


def _build_dense_query_cache_key(
    backend,
    *,
    normalized_query: str,
    profile: CollectionRuntimeProfile,
) -> str:
    settings = backend.settings
    payload = {
        "query_sha256": hashlib.sha256(normalized_query.encode("utf-8")).hexdigest(),
        "embedding_provider": settings.embedding_provider,
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "corpus": profile.corpus,
        "collection": profile.collection,
        "cleaning_policy_version": profile.cleaning_policy_version,
        "chunk_profile_version": profile.chunk_profile_version,
        "dense_vector_name": profile.qdrant_index_binding.dense_vector_name,
        "embedding_query_instruction_hash": hashlib.sha256(
            profile.embedding_query_instruction.encode("utf-8")
        ).hexdigest(),
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


__all__ = ["get_dense_query_embedding"]
