from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
from campus_ingestion_core.embed import (
    EmbeddingSettings,
    build_embedding_model,
    validate_ingestion_retrieval_embedding_env_alignment,
)
from campus_ingestion_core.embedding_cache import (
    CacheAwareEmbeddingModel,
    EmbeddingCacheStats,
    ObjectStoreEmbeddingCache,
    build_cache_profile_identity,
)
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
from campus_ingestion_core.index_release_acceptance import (
    build_release_retrieval_acceptance_executor,
    evaluate_release_chunk_quality,
    load_release_retrieval_acceptance_cases,
    run_release_retrieval_acceptance,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import (
    IndexableChunk,
    build_indexable_chunks_from_record,
    index_chunks_to_qdrant,
)
from campus_ingestion_core.process_indexing import audit_payload_indexes
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.registry_scope_chunk_preparation import (
    require_verified_chunk_preparation,
    verify_prepared_chunks_match_manifest,
)
from campus_ingestion_core.registry_scope_common import (
    record_label,
    select_releasable_registry_records,
)
from campus_ingestion_core.regulation_rag_release_admission import (
    assert_regulation_rag_release_admission_allows_release,
    require_regulation_rag_release_admission_key,
)
from campus_ingestion_core.registry_scope_release_support import (
    build_fallback_retrieval_settings as _build_fallback_retrieval_settings,
)
from campus_ingestion_core.registry_scope_release_support import (
    build_qdrant_client as _build_qdrant_client,
)
from campus_ingestion_core.registry_scope_release_support import (
    document_units_sha256_by_key as _document_units_sha256_by_key,
)
from campus_ingestion_core.registry_scope_release_support import (
    embedding_cache_enabled as _embedding_cache_enabled,
)
from campus_ingestion_core.registry_scope_release_support import (
    is_mock_qdrant_client as _is_mock_qdrant_client,
)
from campus_ingestion_core.registry_scope_release_support import (
    read_collection_points_count as _read_collection_points_count,
)
from campus_ingestion_core.registry_scope_release_support import (
    read_qdrant_upsert_batch_size as _read_qdrant_upsert_batch_size,
)
from campus_ingestion_core.registry_scope_release_support import (
    release_payload_mismatch_issues as _release_payload_mismatch_issues,
)
from campus_ingestion_core.registry_scope_release_support import (
    requires_release_retrieval_acceptance as _requires_release_retrieval_acceptance,
)
from campus_ingestion_core.registry_scope_release_support import (
    resolve_release_chunk_quality_budget as _resolve_release_chunk_quality_budget,
)
from campus_ingestion_core.registry_scope_release_support import (
    resolve_release_qrels_coverage_issues as _resolve_release_qrels_coverage_issues,
)
from campus_ingestion_core.registry_scope_release_support import (
    sample_release_payloads as _sample_release_payloads,
)
from campus_ingestion_core.registry_scope_release_support import (
    validate_chunk_embedding_runtime_identity as _validate_chunk_embedding_runtime_identity,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.sparse import SparseEmbeddingSettings, build_sparse_embedding_model


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
    retrieval_acceptance_status: str
    retrieval_acceptance_summary_object_key: str | None
    post_publish_audit_status: str = ""
    post_publish_audit_summary_object_key: str | None = None
    embedding_cache_hit_count: int = 0
    embedding_cache_miss_count: int = 0
    embedding_provider_call_count: int = 0
    release_admission_manifest_key: str | None = None
    release_admission_status: str = ""


@dataclass(frozen=True, slots=True)
class ReleasePostPublishAuditResult:
    status: str
    summary: dict[str, object]


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
    acceptance_case_path: str | None = None,
    release_admission_manifest_key: str | None = None,
    qrels_coverage_issues: Sequence[str] | None = None,
    official_web_min_release_documents: int | None = None,
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
    resolved_release_admission_manifest_key = require_regulation_rag_release_admission_key(
        corpus=corpus,
        collection=collection,
        runtime_profile=runtime_profile,
        publish_alias=publish_alias,
        explicit_key=release_admission_manifest_key,
        env=source,
    )
    if reset_index:
        reset_index_binding(
            qdrant_client=runtime_qdrant_client,
            binding=runtime_profile.qdrant_index_binding,
        )
    if publish_alias:
        validate_ingestion_retrieval_embedding_env_alignment(source)
    records = select_releasable_registry_records(
        records=runtime_registry.list_by_scope(corpus, collection),
        runtime_profile=runtime_profile,
    )
    if not records:
        raise ValueError(f"no releasable registry records found for {corpus}/{collection}")
    preparation_manifest = require_verified_chunk_preparation(
        corpus=corpus,
        collection=collection,
        preparation_run_id=preparation_run_id,
        records=records,
        object_store=runtime_object_store,
        bucket=object_store_settings.bucket_derived,
    )
    release_admission = assert_regulation_rag_release_admission_allows_release(
        corpus=corpus,
        collection=collection,
        runtime_profile=runtime_profile,
        publish_alias=publish_alias,
        manifest_key=resolved_release_admission_manifest_key,
        records=records,
        preparation_manifest=preparation_manifest,
        object_store=runtime_object_store,
        bucket=object_store_settings.bucket_derived,
    )

    embedding_settings = EmbeddingSettings.from_env(source)
    embedding_cache_stats = EmbeddingCacheStats()
    embedding_model = build_embedding_model(embedding_settings)
    if _embedding_cache_enabled(source):
        embedding_model = CacheAwareEmbeddingModel(
            provider_model=embedding_model,
            cache=ObjectStoreEmbeddingCache(
                object_store=runtime_object_store,
                bucket=object_store_settings.bucket_derived,
                settings=embedding_settings,
                profile_identity=build_cache_profile_identity(
                    corpus=corpus,
                    collection=collection,
                    cleaning=runtime_profile.cleaning_policy_version,
                    chunk=runtime_profile.chunk_profile_version,
                ),
            ),
            stats=embedding_cache_stats,
        )
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
    _validate_chunk_embedding_runtime_identity(chunks=tuple(chunks), settings=embedding_settings)
    verify_prepared_chunks_match_manifest(manifest=preparation_manifest, chunks=tuple(chunks))

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
        embedding_provider=embedding_settings.provider,
        embedding_dimensions=embedding_settings.dimensions,
        document_units_sha256_by_key=_document_units_sha256_by_key(preparation_manifest),
        publish_alias=publish_alias,
        upsert_batch_size=_read_qdrant_upsert_batch_size(source),
        acceptance_case_path=acceptance_case_path,
        qrels_coverage_issues=qrels_coverage_issues,
        official_web_min_release_documents=official_web_min_release_documents,
        retrieval_settings=(
            RetrievalSettings.from_env(source)
            if publish_alias and _requires_release_retrieval_acceptance(runtime_profile)
            else None
        ),
        embedding_cache_stats=embedding_cache_stats,
        release_admission_manifest_key=resolved_release_admission_manifest_key,
        release_admission_status=(
            release_admission.admission_status if release_admission is not None else ""
        ),
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
    embedding_provider: str = "",
    embedding_dimensions: int | None = None,
    document_units_sha256_by_key: dict[str, str] | None = None,
    acceptance_case_path: str | None = None,
    qrels_coverage_issues: Sequence[str] | None = None,
    official_web_min_release_documents: int | None = None,
    retrieval_settings: RetrievalSettings | None = None,
    embedding_cache_stats: EmbeddingCacheStats | None = None,
    release_admission_manifest_key: str | None = None,
    release_admission_status: str = "",
) -> RegistryScopeReleaseReport:
    if not records:
        raise ValueError(f"records must not be empty for {corpus}/{collection}")
    if not chunks:
        raise ValueError(f"chunks must not be empty for {corpus}/{collection}")
    if (
        publish_alias
        and _requires_release_retrieval_acceptance(runtime_profile)
        and not (acceptance_case_path or "").strip()
    ):
        raise ValueError(
            f"retrieval acceptance case path is required to publish {corpus}/{collection}"
        )

    binding = runtime_profile.qdrant_index_binding
    release_id = default_release_id()
    physical_collection_name = binding.build_physical_collection_name(release_id)
    previous_physical_collection_name = resolve_alias_target(
        qdrant_client=qdrant_client,
        alias_name=binding.alias_name,
    )
    validation = validate_scope_release(
        corpus=corpus,
        collection=collection,
        chunks=tuple(chunks),
        official_web_min_release_documents=official_web_min_release_documents,
    )
    chunk_budget = _resolve_release_chunk_quality_budget(
        corpus=corpus,
        collection=collection,
        runtime_profile=runtime_profile,
    )
    qrels_issues = _resolve_release_qrels_coverage_issues(
        corpus=corpus,
        collection=collection,
        runtime_profile=runtime_profile,
        publish_alias=publish_alias,
        qrels_coverage_issues=qrels_coverage_issues,
    )
    qrels_coverage_required = publish_alias and _requires_release_retrieval_acceptance(
        runtime_profile
    )
    quality_gate = evaluate_release_chunk_quality(
        chunks=tuple(chunks),
        max_token_count=chunk_budget.max_token_count,
        max_token_count_source=chunk_budget.source,
        max_token_count_by_unit_type=chunk_budget.max_token_count_by_unit_type,
        qrels_coverage_issues=qrels_issues,
        qrels_coverage_required=qrels_coverage_required,
    )
    indexed_at = datetime.now(UTC).isoformat()
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
        embedding_provider=embedding_provider,
        embedding_dimensions=embedding_dimensions,
        document_units_sha256_by_key=document_units_sha256_by_key,
        runtime_profile=runtime_profile,
        sparse_settings=getattr(sparse_embedding_model, "settings", None),
        quality_gate_status=quality_gate.status,
        chunk_quality_status=quality_gate.chunk_quality_status,
        qrels_coverage_status=quality_gate.qrels_coverage_status,
        release_metadata_consistency_status=quality_gate.release_metadata_consistency_status,
        release_admission_manifest_key=release_admission_manifest_key,
        release_admission_status=release_admission_status,
    )
    if (
        publish_alias
        and _requires_release_retrieval_acceptance(runtime_profile)
        and quality_gate.status != "passed"
    ):
        write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=prepublish_manifest,
            validation_summary=validation.summary,
            quality_gate_summary=quality_gate.summary,
        )
        raise ValueError(
            f"release quality gate failed for {corpus}/{collection}: {quality_gate.summary}"
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
            quality_gate_summary=quality_gate.summary,
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
            quality_gate_summary=quality_gate.summary,
        )
        return _build_release_report(artifacts, embedding_cache_stats=embedding_cache_stats)

    acceptance_result = None
    if _requires_release_retrieval_acceptance(runtime_profile):
        cases = load_release_retrieval_acceptance_cases(
            str(acceptance_case_path),
            corpus=corpus,
            collection=collection,
        )
        acceptance_result = run_release_retrieval_acceptance(
            cases=cases,
            executor=build_release_retrieval_acceptance_executor(
                qdrant_client=qdrant_client,
                settings=retrieval_settings
                or _build_fallback_retrieval_settings(
                    chunks=tuple(chunks),
                    embedding_provider=embedding_provider,
                    embedding_dimensions=embedding_dimensions,
                ),
                runtime_profile=runtime_profile,
                sparse_embedding_model=sparse_embedding_model,
            ),
            physical_collection_name=physical_collection_name,
        )
        accepted_manifest = build_index_release_manifest(
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
            embedding_provider=embedding_provider,
            embedding_dimensions=embedding_dimensions,
            document_units_sha256_by_key=document_units_sha256_by_key,
            retrieval_acceptance_status=acceptance_result.status,
            runtime_profile=runtime_profile,
            sparse_settings=getattr(sparse_embedding_model, "settings", None),
            quality_gate_status=quality_gate.status,
            quality_gate_summary_object_key=prepublish_manifest.quality_gate_summary_object_key,
            chunk_quality_status=quality_gate.chunk_quality_status,
            qrels_coverage_status=quality_gate.qrels_coverage_status,
            release_metadata_consistency_status=quality_gate.release_metadata_consistency_status,
            release_admission_manifest_key=release_admission_manifest_key,
            release_admission_status=release_admission_status,
        )
        acceptance_artifacts = write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=accepted_manifest,
            validation_summary=validation.summary,
            retrieval_acceptance_summary=acceptance_result.summary,
            quality_gate_summary=quality_gate.summary,
        )
        if acceptance_result.status != "passed":
            if qdrant_client.collection_exists(physical_collection_name):
                qdrant_client.delete_collection(collection_name=physical_collection_name)
            raise ValueError(
                f"retrieval acceptance failed for {corpus}/{collection}: "
                f"{acceptance_result.summary}"
            )
        prepublish_manifest = acceptance_artifacts.manifest

    if acceptance_result is None:
        prepublish_artifacts = write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=prepublish_manifest,
            validation_summary=validation.summary,
            quality_gate_summary=quality_gate.summary,
        )
        prepublish_manifest = prepublish_artifacts.manifest
    refresh_release_point_metadata(
        qdrant_client=qdrant_client,
        collection_name=physical_collection_name,
        release_metadata=build_release_metadata_payload(
            manifest=prepublish_manifest,
            manifest_object_key=f"{corpus}/releases/{collection}/{release_id}/index-release.json",
        ),
    )

    published_at = datetime.now(UTC).isoformat()
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
        embedding_provider=embedding_provider,
        embedding_dimensions=embedding_dimensions,
        document_units_sha256_by_key=document_units_sha256_by_key,
        retrieval_acceptance_status=prepublish_manifest.retrieval_acceptance_status,
        retrieval_acceptance_summary_object_key=prepublish_manifest.retrieval_acceptance_summary_object_key,
        runtime_profile=runtime_profile,
        sparse_settings=getattr(sparse_embedding_model, "settings", None),
        quality_gate_status=prepublish_manifest.quality_gate_status,
        quality_gate_summary_object_key=prepublish_manifest.quality_gate_summary_object_key,
        chunk_quality_status=prepublish_manifest.chunk_quality_status,
        qrels_coverage_status=prepublish_manifest.qrels_coverage_status,
        release_metadata_consistency_status=prepublish_manifest.release_metadata_consistency_status,
        release_admission_manifest_key=release_admission_manifest_key,
        release_admission_status=release_admission_status,
    )
    alias_published = False
    try:
        publish_release_alias(
            qdrant_client=qdrant_client,
            binding=binding,
            physical_collection_name=physical_collection_name,
        )
        alias_published = True
        published_artifacts = write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=published_manifest,
            validation_summary=validation.summary,
            retrieval_acceptance_summary=(
                acceptance_result.summary if acceptance_result is not None else None
            ),
            quality_gate_summary=quality_gate.summary,
        )
        audit = audit_published_scope_release(
            qdrant_client=qdrant_client,
            object_store=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=published_artifacts.manifest,
            manifest_object_key=published_artifacts.manifest_object_key,
            expected_release_metadata=build_release_metadata_payload(
                manifest=prepublish_manifest,
                manifest_object_key=published_artifacts.manifest_object_key,
            ),
        )
        audited_artifacts = write_index_release_artifacts(
            writer=object_store,
            bucket=object_store_settings.bucket_derived,
            manifest=published_artifacts.manifest,
            validation_summary=validation.summary,
            retrieval_acceptance_summary=(
                acceptance_result.summary if acceptance_result is not None else None
            ),
            quality_gate_summary=quality_gate.summary,
            post_publish_audit_summary=audit.summary,
        )
        if audit.status == "failed":
            raise ValueError(
                f"post-publish release audit failed for {corpus}/{collection}: {audit.summary}"
            )
        return _build_release_report(
            audited_artifacts,
            embedding_cache_stats=embedding_cache_stats,
        )
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


def _build_release_report(
    artifacts,
    *,
    embedding_cache_stats: EmbeddingCacheStats | None = None,
) -> RegistryScopeReleaseReport:
    manifest = artifacts.manifest
    cache_stats = embedding_cache_stats or EmbeddingCacheStats()
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
        retrieval_acceptance_status=manifest.retrieval_acceptance_status,
        retrieval_acceptance_summary_object_key=manifest.retrieval_acceptance_summary_object_key,
        post_publish_audit_status=manifest.post_publish_audit_status,
        post_publish_audit_summary_object_key=manifest.post_publish_audit_summary_object_key,
        embedding_cache_hit_count=cache_stats.hit_count,
        embedding_cache_miss_count=cache_stats.miss_count,
        embedding_provider_call_count=cache_stats.provider_call_count,
        release_admission_manifest_key=manifest.release_admission_manifest_key,
        release_admission_status=manifest.release_admission_status,
    )


def refresh_release_point_metadata(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    release_metadata: Mapping[str, object],
    batch_size: int = 256,
) -> int:
    if _is_mock_qdrant_client(qdrant_client):
        return 0
    if not qdrant_client.collection_exists(collection_name):
        raise ValueError(
            f"cannot refresh release metadata for missing collection {collection_name}"
        )
    scroll_offset: object | None = None
    refreshed_count = 0
    while True:
        records, next_offset = qdrant_client.scroll(
            collection_name=collection_name,
            limit=batch_size,
            offset=scroll_offset,
            with_payload=False,
            with_vectors=False,
        )
        point_ids = [record.id for record in records or ()]
        if point_ids:
            qdrant_client.set_payload(
                collection_name=collection_name,
                payload=dict(release_metadata),
                points=point_ids,
                wait=True,
            )
            refreshed_count += len(point_ids)
        if not next_offset or not point_ids:
            break
        scroll_offset = next_offset
    return refreshed_count


def audit_published_scope_release(
    *,
    qdrant_client: QdrantClient,
    object_store: RegistryScopeObjectStore,
    bucket: str,
    manifest,
    manifest_object_key: str,
    expected_release_metadata: Mapping[str, object],
    sample_limit: int = 16,
) -> ReleasePostPublishAuditResult:
    if _is_mock_qdrant_client(qdrant_client):
        return ReleasePostPublishAuditResult(
            status="skipped",
            summary={
                "status": "skipped",
                "reason": "mock_qdrant_client",
                "release_id": manifest.release_id,
                "physical_collection_name": manifest.physical_collection_name,
            },
        )
    issues: list[str] = []
    alias_target = resolve_alias_target(
        qdrant_client=qdrant_client,
        alias_name=manifest.serving_alias,
    )
    if alias_target != manifest.physical_collection_name:
        issues.append(
            f"alias_target_mismatch:{alias_target or '<none>'}!={manifest.physical_collection_name}"
        )
    if not qdrant_client.collection_exists(manifest.physical_collection_name):
        issues.append("missing_physical_collection")
        payloads: tuple[dict[str, object], ...] = ()
        points_count: int | None = None
    else:
        points_count = _read_collection_points_count(
            qdrant_client=qdrant_client,
            collection_name=manifest.physical_collection_name,
        )
        payload_index_audit = audit_payload_indexes(
            qdrant_client=qdrant_client,
            collection_name=manifest.physical_collection_name,
        )
        issues.extend(
            f"payload_index_missing:{field_name}"
            for field_name in payload_index_audit.missing_indexes
        )
        issues.extend(
            f"payload_index_schema_mismatch:{field_name}"
            for field_name in payload_index_audit.mismatched_indexes
        )
        if points_count == 0:
            issues.append("empty_physical_collection")
        payloads = _sample_release_payloads(
            qdrant_client=qdrant_client,
            collection_name=manifest.physical_collection_name,
            sample_limit=sample_limit,
        )
        if not payloads:
            issues.append("missing_sampled_point_payload")
    if not qdrant_client.collection_exists(manifest.physical_collection_name):
        payload_index_audit_summary = {"status": "not_applicable", "reason": "missing_collection"}
    else:
        payload_index_audit_summary = payload_index_audit.summary
    issues.extend(
        _release_payload_mismatch_issues(
            payloads=payloads,
            expected_release_metadata=expected_release_metadata,
        )
    )
    object_keys = [
        manifest_object_key,
        manifest.validation_summary_object_key,
        manifest.quality_gate_summary_object_key,
    ]
    if manifest.retrieval_acceptance_status:
        object_keys.append(manifest.retrieval_acceptance_summary_object_key)
    for object_key in object_keys:
        if not object_key:
            issues.append("missing_release_artifact_key")
            continue
        try:
            object_store.get_bytes(bucket=bucket, key=str(object_key))
        except Exception:
            issues.append(f"missing_release_artifact:{object_key}")
    status = "passed" if not issues else "failed"
    return ReleasePostPublishAuditResult(
        status=status,
        summary={
            "status": status,
            "release_id": manifest.release_id,
            "serving_alias": manifest.serving_alias,
            "alias_target": alias_target,
            "physical_collection_name": manifest.physical_collection_name,
            "points_count": points_count,
            "sampled_payload_count": len(payloads),
            "payload_index_audit": payload_index_audit_summary,
            "issues": tuple(issues),
        },
    )


__all__ = ["RegistryScopeReleaseReport", "publish_scope_release", "release_registry_scope"]
