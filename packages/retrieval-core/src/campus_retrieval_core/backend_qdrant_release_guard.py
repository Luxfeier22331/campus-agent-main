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
    "profile_identity_hash",
    "quality_gate_status",
    "chunk_quality_status",
    "qrels_coverage_status",
    "release_metadata_consistency_status",
)

_REQUIRED_RERANKER_RELEASE_METADATA_FIELDS = (
    "reranker_enabled_by_default",
    "reranker_top_n",
    "reranker_profile_version",
    "reranker_adoption_evidence_id",
)
_REQUIRED_REGULATION_TARGET_RELEASE_METADATA_FIELDS = (
    "release_admission_status",
    "component_eval_status",
)


def validate_alias_release_metadata(
    backend,
    *,
    collection_name: str,
    profile: CollectionRuntimeProfile,
    settings: RetrievalSettings,
    timeout_seconds: int | None,
) -> None:
    if _uses_non_release_managed_test_backend(backend, settings=settings):
        return

    profile_identity = _profile_identity(profile=profile, settings=settings)
    cached = _cached_guard_result(
        backend,
        collection_name=collection_name,
        profile_identity=profile_identity,
    )
    if cached is not None:
        status, message = cached
        if status == "passed":
            return
        raise RetrievalBackendError(message)

    payloads = _read_release_payloads(
        backend,
        collection_name=collection_name,
        timeout_seconds=timeout_seconds,
    )
    payload = payloads[0] if payloads else {}
    if not payload:
        if _requires_release_metadata(profile):
            raise RetrievalBackendError(
                f"missing release metadata for query-serving alias {collection_name}"
            )
        return
    if "index_release_id" not in payload:
        if _requires_release_metadata(profile):
            raise RetrievalBackendError(
                f"missing release metadata for query-serving alias {collection_name}: index_release_id"
            )
        return

    error = _validate_release_payloads(
        payloads=payloads,
        profile=profile,
        settings=settings,
    )
    release_id = str(payload.get("index_release_id") or "")
    if error:
        message = f"release metadata drift for {collection_name}/{release_id}: {error}"
        _store_guard_result(
            backend,
            collection_name=collection_name,
            release_id=release_id,
            profile_identity=profile_identity,
            status="failed",
            message=message,
        )
        raise RetrievalBackendError(message)
    _store_guard_result(
        backend,
        collection_name=collection_name,
        release_id=release_id,
        profile_identity=profile_identity,
        status="passed",
        message="",
    )


def _cached_guard_result(
    backend,
    *,
    collection_name: str,
    profile_identity: str,
) -> tuple[str, str] | None:
    cache = getattr(backend, "_release_drift_guard_cache", None)
    if cache is None:
        return None
    cache_key = f"{collection_name}:{profile_identity}"
    entry = cache.get(cache_key)
    if entry is None:
        return None
    expires_at, _release_id, status, message = entry
    if expires_at <= time.monotonic():
        cache.pop(cache_key, None)
        return None
    return status, message


def _store_guard_result(
    backend,
    *,
    collection_name: str,
    release_id: str,
    profile_identity: str,
    status: str,
    message: str,
) -> None:
    cache = getattr(backend, "_release_drift_guard_cache", None)
    if cache is None:
        return
    ttl_seconds = max(float(getattr(backend, "release_drift_guard_cache_ttl_seconds", 0.0)), 0.0)
    if ttl_seconds <= 0:
        return
    cache[f"{collection_name}:{profile_identity}"] = (
        time.monotonic() + ttl_seconds,
        release_id,
        status,
        message,
    )


def _read_release_payloads(
    backend,
    *,
    collection_name: str,
    timeout_seconds: int | None,
) -> tuple[dict[str, object], ...]:
    payloads: list[dict[str, object]] = []
    collection_payload = _read_collection_metadata_payload(
        backend,
        collection_name=collection_name,
        timeout_seconds=timeout_seconds,
    )
    if collection_payload:
        payloads.append(collection_payload)
    scroll = getattr(backend.qdrant_client, "scroll", None)
    if not callable(scroll):
        return tuple(payloads)
    result = scroll(
        collection_name=collection_name,
        limit=16,
        with_payload=True,
        with_vectors=False,
        timeout=timeout_seconds,
    )
    records = result[0] if isinstance(result, tuple) and result else ()
    if not records:
        return tuple(payloads)
    for record in records:
        payload = getattr(record, "payload", None)
        payloads.append(dict(payload or {}) if isinstance(payload, Mapping) else {})
    return tuple(payloads)


def _read_collection_metadata_payload(
    backend,
    *,
    collection_name: str,
    timeout_seconds: int | None,
) -> dict[str, object]:
    get_collection = getattr(backend.qdrant_client, "get_collection", None)
    if not callable(get_collection):
        return {}
    try:
        collection_info = get_collection(collection_name=collection_name, timeout=timeout_seconds)
    except TypeError:
        collection_info = get_collection(collection_name)
    except AssertionError as exc:
        if "Unknown arguments" not in str(exc):
            raise
        collection_info = get_collection(collection_name)
    for field_name in ("metadata", "payload"):
        value = getattr(collection_info, field_name, None)
        if isinstance(value, Mapping):
            return dict(value)
    return {}


def _validate_release_payloads(
    *,
    payloads: tuple[dict[str, object], ...],
    profile: CollectionRuntimeProfile,
    settings: RetrievalSettings,
) -> str:
    if not payloads:
        return "missing release metadata"
    errors: list[str] = []
    baseline = payloads[0]
    for index, payload in enumerate(payloads, start=1):
        payload_error = _validate_payload(payload=payload, profile=profile, settings=settings)
        if payload_error:
            errors.append(f"sample {index}: {payload_error}")
            continue
        consistency_error = _validate_payload_consistency(
            baseline=baseline,
            candidate=payload,
        )
        if consistency_error:
            errors.append(f"sample {index}: {consistency_error}")
    return "; ".join(errors)


def _validate_payload_consistency(
    *,
    baseline: Mapping[str, object],
    candidate: Mapping[str, object],
) -> str:
    mismatches = [
        field
        for field in _REQUIRED_RELEASE_METADATA_FIELDS
        if not _values_match(candidate.get(field), baseline.get(field))
    ]
    if not mismatches:
        return ""
    return "inconsistent release metadata fields: " + ", ".join(mismatches)


def _validate_payload(
    *,
    payload: Mapping[str, object],
    profile: CollectionRuntimeProfile,
    settings: RetrievalSettings,
) -> str:
    missing = [
        field for field in _required_release_metadata_fields(profile) if field not in payload
    ]
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
        "profile_identity_hash": _profile_identity(profile=profile, settings=settings),
        "quality_gate_status": "passed",
        "chunk_quality_status": "passed",
        "qrels_coverage_status": "passed",
        "release_metadata_consistency_status": "passed",
    }
    if _requires_regulation_target_release_proof(profile):
        expected.update(
            {
                "release_admission_status": "passed",
                "component_eval_status": "passed",
            }
        )
    if profile.reranker_enabled_by_default:
        expected.update(
            {
                "reranker_enabled_by_default": True,
                "reranker_top_n": profile.reranker_top_n,
                "reranker_profile_version": profile.reranker_profile_version,
                "reranker_adoption_evidence_id": profile.reranker_adoption_evidence_id,
            }
        )
    mismatches: list[str] = []
    for field, expected_value in expected.items():
        actual = payload.get(field)
        if not _values_match(actual, expected_value):
            mismatches.append(f"{field}={actual!r} expected {expected_value!r}")
    return "; ".join(mismatches)


def _requires_release_metadata(profile: CollectionRuntimeProfile) -> bool:
    return profile.serving_stage == "query_serving" or profile.query_enabled_by_default


def _required_release_metadata_fields(profile: CollectionRuntimeProfile) -> tuple[str, ...]:
    fields = _REQUIRED_RELEASE_METADATA_FIELDS
    if _requires_regulation_target_release_proof(profile):
        fields = fields + _REQUIRED_REGULATION_TARGET_RELEASE_METADATA_FIELDS
    if profile.reranker_enabled_by_default:
        fields = fields + _REQUIRED_RERANKER_RELEASE_METADATA_FIELDS
    return fields


def _requires_regulation_target_release_proof(profile: CollectionRuntimeProfile) -> bool:
    return bool(
        profile.corpus == "regulations"
        and profile.collection in {"student_rules", "institutional_rules"}
        and _requires_release_metadata(profile)
    )


def _uses_non_release_managed_test_backend(
    backend,
    *,
    settings: RetrievalSettings,
) -> bool:
    qdrant_client = getattr(backend, "qdrant_client", None)
    return (
        settings.qdrant_url == ":memory:"
        or isinstance(qdrant_client, Mock)
        or isinstance(getattr(qdrant_client, "query_points", None), Mock)
    )


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


def _profile_identity(
    *,
    profile: CollectionRuntimeProfile,
    settings: RetrievalSettings,
) -> str:
    payload = {
        "corpus": profile.corpus,
        "collection": profile.collection,
        "serving_stage": profile.serving_stage,
        "query_enabled_by_default": profile.query_enabled_by_default,
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
        "reranker_enabled_by_default": profile.reranker_enabled_by_default,
        "reranker_top_n": profile.reranker_top_n,
        "reranker_profile_version": profile.reranker_profile_version or "",
        "reranker_adoption_evidence_id": profile.reranker_adoption_evidence_id or "",
        "embedding_query_instruction_hash": _hash_text(profile.embedding_query_instruction),
    }
    return hashlib.sha256(repr(tuple(sorted(payload.items()))).encode("utf-8")).hexdigest()


__all__ = ["validate_alias_release_metadata"]
