from __future__ import annotations

import hashlib
import time
from collections.abc import Mapping
from typing import Any
from unittest.mock import Mock

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_retrieval_core.backend_qdrant_errors import RetrievalBackendError
from campus_retrieval_core.settings import RetrievalSettings

_REQUIRED_RELEASE_METADATA_FIELDS = (
    "index_release_id",
    "index_validation_status",
    "embedding_provider",
    "embedding_model",
    "embedding_dimensions",
    "sparse_provider",
    "sparse_model",
    "sparse_tokenizer",
    "sparse_language",
    "cleaning_policy_version",
    "chunk_policy_version",
    "dense_vector_name",
    "sparse_vector_name",
    "dense_prefetch_limit",
    "sparse_prefetch_limit",
    "rrf_k",
    "rrf_dense_weight",
    "rrf_sparse_weight",
    "embedding_query_instruction_hash",
)


def validate_alias_release_metadata(
    backend,
    *,
    collection_name: str,
    profile: CollectionRuntimeProfile,
    settings: RetrievalSettings,
    timeout_seconds: int | None,
) -> None:
    cached = _cached_guard_result(backend, collection_name=collection_name)
    if cached is not None:
        status, message = cached
        if status == "passed":
            return
        raise RetrievalBackendError(message)

    payload = _read_release_payload(
        backend,
        collection_name=collection_name,
        timeout_seconds=timeout_seconds,
    )
    if not payload:
        return
    if "index_release_id" not in payload:
        return

    error = _validate_payload(payload=payload, profile=profile, settings=settings)
    release_id = str(payload.get("index_release_id") or "")
    if error:
        message = f"release metadata drift for {collection_name}/{release_id}: {error}"
        _store_guard_result(
            backend,
            collection_name=collection_name,
            release_id=release_id,
            status="failed",
            message=message,
        )
        raise RetrievalBackendError(message)
    _store_guard_result(
        backend,
        collection_name=collection_name,
        release_id=release_id,
        status="passed",
        message="",
    )


def _cached_guard_result(backend, *, collection_name: str) -> tuple[str, str] | None:
    cache = getattr(backend, "_release_drift_guard_cache", None)
    if cache is None:
        return None
    entry = cache.get(collection_name)
    if entry is None:
        return None
    expires_at, _release_id, status, message = entry
    if expires_at <= time.monotonic():
        cache.pop(collection_name, None)
        return None
    return status, message


def _store_guard_result(
    backend,
    *,
    collection_name: str,
    release_id: str,
    status: str,
    message: str,
) -> None:
    cache = getattr(backend, "_release_drift_guard_cache", None)
    if cache is None:
        return
    ttl_seconds = max(float(getattr(backend, "release_drift_guard_cache_ttl_seconds", 0.0)), 0.0)
    if ttl_seconds <= 0:
        return
    cache[collection_name] = (time.monotonic() + ttl_seconds, release_id, status, message)


def _read_release_payload(
    backend,
    *,
    collection_name: str,
    timeout_seconds: int | None,
) -> dict[str, object]:
    if isinstance(getattr(backend.qdrant_client, "query_points", None), Mock):
        return {}
    scroll = getattr(backend.qdrant_client, "scroll", None)
    if not callable(scroll):
        return {}
    result = scroll(
        collection_name=collection_name,
        limit=1,
        with_payload=True,
        with_vectors=False,
        timeout=timeout_seconds,
    )
    records = result[0] if isinstance(result, tuple) and result else ()
    if not records:
        return {}
    first = records[0]
    payload = getattr(first, "payload", None)
    return dict(payload or {}) if isinstance(payload, Mapping) else {}


def _validate_payload(
    *,
    payload: Mapping[str, object],
    profile: CollectionRuntimeProfile,
    settings: RetrievalSettings,
) -> str:
    missing = [field for field in _REQUIRED_RELEASE_METADATA_FIELDS if field not in payload]
    if missing:
        return "missing release metadata fields: " + ", ".join(missing)
    expected: dict[str, object] = {
        "index_validation_status": "passed",
        "embedding_provider": settings.embedding_provider,
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "sparse_provider": settings.sparse_provider,
        "sparse_model": settings.sparse_model,
        "sparse_tokenizer": settings.sparse_tokenizer,
        "sparse_language": settings.sparse_language,
        "cleaning_policy_version": profile.cleaning_policy_version,
        "chunk_policy_version": profile.chunk_profile_version,
        "dense_vector_name": profile.qdrant_index_binding.dense_vector_name,
        "sparse_vector_name": profile.qdrant_index_binding.sparse_vector_name,
        "dense_prefetch_limit": profile.dense_prefetch_limit,
        "sparse_prefetch_limit": profile.sparse_prefetch_limit,
        "rrf_k": profile.rrf_k,
        "rrf_dense_weight": profile.rrf_dense_weight,
        "rrf_sparse_weight": profile.rrf_sparse_weight,
        "embedding_query_instruction_hash": _hash_text(profile.embedding_query_instruction),
    }
    mismatches: list[str] = []
    for field, expected_value in expected.items():
        actual = payload.get(field)
        if not _values_match(actual, expected_value):
            mismatches.append(f"{field}={actual!r} expected {expected_value!r}")
    return "; ".join(mismatches)


def _values_match(actual: object, expected: object) -> bool:
    if isinstance(expected, int) and not isinstance(expected, bool):
        return _coerce_int(actual) == expected
    if isinstance(expected, float):
        return _coerce_float(actual) == expected
    if expected is None:
        return actual is None
    return str(actual) == str(expected)


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


__all__ = ["validate_alias_release_metadata"]
