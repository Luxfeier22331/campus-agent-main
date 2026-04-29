from __future__ import annotations

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
    now = time.monotonic()
    with backend._dense_query_cache_lock:
        cached = backend._dense_query_cache.get(normalized_query)
        if cached is not None:
            expires_at, embedding = cached
            if expires_at > now:
                backend._dense_query_cache.move_to_end(normalized_query)
                return embedding
            backend._dense_query_cache.pop(normalized_query, None)
    embedding = tuple(
        float(item) for item in backend.embedding_model.get_query_embedding(normalized_query)
    )
    if backend.dense_query_cache_ttl_seconds > 0 and backend.dense_query_cache_max_entries > 0:
        with backend._dense_query_cache_lock:
            backend._dense_query_cache[normalized_query] = (
                now + backend.dense_query_cache_ttl_seconds,
                embedding,
            )
            backend._dense_query_cache.move_to_end(normalized_query)
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


__all__ = ["get_dense_query_embedding"]
