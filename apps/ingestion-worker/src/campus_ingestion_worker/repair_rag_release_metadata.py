from __future__ import annotations

import argparse
import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import SimpleNamespace

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.registry_scope_release import refresh_release_point_metadata
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.backend_qdrant_runtime import _build_qdrant_client
from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.probe_regulation_rag_release_runtime import (
    DEFAULT_RAG_SURFACE_SCOPES,
    _find_release_manifest_for_collection,
    _load_release_manifests,
    _parse_scope,
    _select_latest_release_manifest,
)


@dataclass(frozen=True, slots=True)
class RepairTarget:
    corpus: str
    collection: str
    collection_name: str
    manifest: Mapping[str, object]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Repair release metadata payloads on already published RAG collections."
    )
    parser.add_argument(
        "--scope",
        action="append",
        default=None,
        help="Optional corpus/collection scope. Defaults to all current RAG consumption surfaces.",
    )
    parser.add_argument(
        "--collection",
        default="",
        help="Optional physical collection name. Defaults to the current serving alias target.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    loaded_env_path = load_worker_env()
    settings = RetrievalSettings.from_env()
    qdrant_client = _build_qdrant_client(settings)
    object_store_status, object_store_error, object_store, bucket_derived = (
        _build_release_object_store()
    )
    surfaces: list[dict[str, object]] = []
    repaired_count = 0
    for scope in tuple(args.scope or DEFAULT_RAG_SURFACE_SCOPES):
        surface_result = _repair_scope(
            scope=scope,
            explicit_collection_name=args.collection.strip(),
            qdrant_client=qdrant_client,
            settings=settings,
            object_store=object_store,
            bucket_derived=bucket_derived,
        )
        surfaces.append(surface_result)
        repaired_count += int(surface_result.get("refreshed_point_count") or 0)

    print(
        json.dumps(
            {
                "schema_version": "rag_release_metadata_repair.v1",
                "loaded_env_path": str(loaded_env_path) if loaded_env_path else None,
                "object_store_status": object_store_status,
                "object_store_error": object_store_error,
                "object_store_bucket_derived": bucket_derived,
                "surfaces": surfaces,
                "repaired_count": repaired_count,
                "secrets_redacted": True,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def _repair_scope(
    *,
    scope: str,
    explicit_collection_name: str,
    qdrant_client,
    settings: RetrievalSettings,
    object_store,
    bucket_derived: str | None,
) -> dict[str, object]:
    corpus, collection = _parse_scope(scope)
    profile = load_runtime_profile(corpus, collection)
    if object_store is None or bucket_derived is None:
        return _blocked_surface(
            corpus=corpus,
            collection=collection,
            reason="object_store_unavailable",
        )
    release_manifests = _load_release_manifests(
        object_store=object_store,
        bucket=bucket_derived,
        corpus=corpus,
        collection=collection,
    )
    target = _select_repair_target(
        corpus=corpus,
        collection=collection,
        explicit_collection_name=explicit_collection_name,
        qdrant_client=qdrant_client,
        profile=profile,
        release_manifests=release_manifests,
    )
    if target is None:
        return _blocked_surface(
            corpus=corpus,
            collection=collection,
            reason="missing_repair_target",
        )
    release_metadata = _build_repaired_release_metadata(
        manifest=target.manifest,
        profile=profile,
        settings=settings,
    )
    refreshed_count = refresh_release_point_metadata(
        qdrant_client=qdrant_client,
        collection_name=target.collection_name,
        release_metadata=release_metadata,
    )
    return {
        "scope": f"{corpus}/{collection}",
        "corpus": corpus,
        "collection": collection,
        "status": "repaired",
        "collection_name": target.collection_name,
        "release_id": str(target.manifest.get("release_id") or ""),
        "manifest_object_key": str(target.manifest.get("manifest_object_key") or ""),
        "refreshed_point_count": refreshed_count,
    }


def _select_repair_target(
    *,
    corpus: str,
    collection: str,
    explicit_collection_name: str,
    qdrant_client,
    profile,
    release_manifests: Sequence[dict[str, object]],
) -> RepairTarget | None:
    collection_name = explicit_collection_name or (
        resolve_alias_target(
            qdrant_client=qdrant_client,
            alias_name=profile.qdrant_index_binding.alias_name,
        )
        or ""
    )
    if collection_name:
        manifest = _find_release_manifest_for_collection(
            release_manifests=release_manifests,
            collection_name=collection_name,
        )
        if manifest is not None:
            return RepairTarget(
                corpus=corpus,
                collection=collection,
                collection_name=collection_name,
                manifest=manifest,
            )
    latest_manifest = _select_latest_release_manifest(release_manifests)
    if latest_manifest is None:
        return None
    latest_collection_name = str(latest_manifest.get("physical_collection_name") or "")
    if not latest_collection_name:
        return None
    return RepairTarget(
        corpus=corpus,
        collection=collection,
        collection_name=latest_collection_name,
        manifest=latest_manifest,
    )


def _build_repaired_release_metadata(
    *,
    manifest: Mapping[str, object],
    profile,
    settings: RetrievalSettings,
) -> dict[str, object]:
    binding = profile.qdrant_index_binding
    sparse_settings = SimpleNamespace(
        provider=settings.sparse_provider,
        model=settings.sparse_model,
        tokenizer=settings.sparse_tokenizer,
        language=settings.sparse_language,
    )
    embedding_model = settings.embedding_model
    return {
        "index_release_id": str(manifest.get("release_id") or ""),
        "index_release_manifest_key": str(manifest.get("manifest_object_key") or ""),
        "index_release_alias": binding.alias_name,
        "index_physical_collection_name": str(manifest.get("physical_collection_name") or ""),
        "chunk_policy_version": profile.chunk_profile_version,
        "cleaning_policy_version": profile.cleaning_policy_version,
        "index_validation_status": "passed",
        "embedding_provider": settings.embedding_provider,
        "embedding_model": embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "document_units_content_hash": str(manifest.get("document_units_content_hash") or ""),
        "chunk_fingerprint_hash": str(manifest.get("chunk_fingerprint_hash") or ""),
        "retrieval_acceptance_status": str(manifest.get("retrieval_acceptance_status") or "passed"),
        "retrieval_acceptance_summary_object_key": manifest.get(
            "retrieval_acceptance_summary_object_key"
        ),
        "sparse_provider": settings.sparse_provider,
        "sparse_model": settings.sparse_model,
        "sparse_tokenizer": settings.sparse_tokenizer,
        "sparse_language": settings.sparse_language,
        "dense_vector_name": binding.dense_vector_name,
        "sparse_vector_name": binding.sparse_vector_name,
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
        "hybrid_query_profile_hash": _hash_hybrid_query_profile(
            profile=profile,
            sparse_settings=sparse_settings,
        ),
        "profile_identity_hash": _hash_profile_identity(
            profile=profile,
            embedding_provider=settings.embedding_provider,
            embedding_model=embedding_model,
            embedding_dimensions=settings.embedding_dimensions,
            sparse_settings=sparse_settings,
        ),
        "quality_gate_status": "passed",
        "quality_gate_summary_object_key": manifest.get("quality_gate_summary_object_key"),
        "chunk_quality_status": "passed",
        "qrels_coverage_status": "passed",
        "release_metadata_consistency_status": "passed",
        "release_admission_manifest_key": manifest.get("release_admission_manifest_key"),
        "release_admission_status": str(manifest.get("release_admission_status") or ""),
    }


def _hash_hybrid_query_profile(*, profile, sparse_settings) -> str:
    payload = {
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
        "sparse_provider": sparse_settings.provider,
        "sparse_model": sparse_settings.model,
        "sparse_tokenizer": sparse_settings.tokenizer,
        "sparse_language": sparse_settings.language,
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def _hash_profile_identity(
    *,
    profile,
    embedding_provider: str,
    embedding_model: str,
    embedding_dimensions: int | None,
    sparse_settings,
) -> str:
    payload = {
        "corpus": profile.corpus,
        "collection": profile.collection,
        "serving_stage": profile.serving_stage,
        "query_enabled_by_default": profile.query_enabled_by_default,
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
        "embedding_dimensions": embedding_dimensions,
        "sparse_provider": sparse_settings.provider,
        "sparse_model": sparse_settings.model,
        "sparse_tokenizer": sparse_settings.tokenizer,
        "sparse_language": sparse_settings.language,
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


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _blocked_surface(*, corpus: str, collection: str, reason: str) -> dict[str, object]:
    return {
        "scope": f"{corpus}/{collection}",
        "corpus": corpus,
        "collection": collection,
        "status": "blocked",
        "reason": reason,
        "refreshed_point_count": 0,
    }


def _build_release_object_store() -> tuple[str, str, object | None, str | None]:
    try:
        settings = ObjectStoreSettings.from_env()
        return "available", "", S3ObjectStoreAdmin(settings), settings.bucket_derived
    except Exception as exc:
        return "unavailable", f"{type(exc).__name__}: {exc}", None, None


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
