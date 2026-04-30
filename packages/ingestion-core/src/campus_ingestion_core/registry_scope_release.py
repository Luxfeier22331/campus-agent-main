from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.chunking import (
    CURRICULUM_V1_CHUNK_POLICY_VERSION,
    CURRICULUM_V1_MAX_CHUNK_SIZE,
    CURRICULUM_V2_CHUNK_POLICY_VERSION,
    CURRICULUM_V2_MAX_CHUNK_SIZE,
    CURRICULUM_V2_TABLE_MAX_CHUNK_SIZE,
    DEFAULT_MAX_CHUNK_SIZE,
    HANDBOOK_V1_CHUNK_POLICY_VERSION,
    HANDBOOK_V2_CHUNK_POLICY_VERSION,
    HANDBOOK_V2_MAX_CHUNK_SIZE,
    HANDBOOK_V3_CHUNK_POLICY_VERSION,
    HANDBOOK_V3_MAX_CHUNK_SIZE,
    OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION,
    OFFICIAL_WEB_V2_MAX_CHUNK_SIZE,
)
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    load_chunk_profile,
    load_runtime_profile,
)
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
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.sparse import SparseEmbeddingSettings, build_sparse_embedding_model

DEFAULT_QDRANT_UPSERT_BATCH_SIZE = 128
DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS = 60.0
_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION = "retrieval-qrels-denominator-policy-v1"


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
    qrels_coverage_issues: Sequence[str] | None = None,
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
        retrieval_settings=(
            RetrievalSettings.from_env(source)
            if publish_alias and _requires_release_retrieval_acceptance(runtime_profile)
            else None
        ),
        embedding_cache_stats=embedding_cache_stats,
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
    retrieval_settings: RetrievalSettings | None = None,
    embedding_cache_stats: EmbeddingCacheStats | None = None,
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
    validation = validate_scope_release(corpus=corpus, collection=collection, chunks=tuple(chunks))
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


def _sample_release_payloads(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
    sample_limit: int,
) -> tuple[dict[str, object], ...]:
    records, _ = qdrant_client.scroll(
        collection_name=collection_name,
        limit=max(sample_limit, 1),
        with_payload=True,
        with_vectors=False,
    )
    payloads: list[dict[str, object]] = []
    for record in records or ():
        payload = getattr(record, "payload", None)
        payloads.append(dict(payload or {}) if isinstance(payload, Mapping) else {})
    return tuple(payloads)


def _release_payload_mismatch_issues(
    *,
    payloads: Sequence[Mapping[str, object]],
    expected_release_metadata: Mapping[str, object],
) -> tuple[str, ...]:
    issues: list[str] = []
    required_fields = tuple(expected_release_metadata)
    for index, payload in enumerate(payloads, start=1):
        missing = [field for field in required_fields if field not in payload]
        if missing:
            issues.append(f"sample_{index}_missing_fields:" + ",".join(missing))
            continue
        mismatches = [
            field
            for field, expected_value in expected_release_metadata.items()
            if not _release_metadata_values_match(payload.get(field), expected_value)
        ]
        if mismatches:
            issues.append(f"sample_{index}_metadata_mismatch:" + ",".join(mismatches))
    return tuple(issues)


def _release_metadata_values_match(actual: object, expected: object) -> bool:
    if isinstance(expected, float):
        return _coerce_float(actual) == expected
    if isinstance(expected, int) and not isinstance(expected, bool):
        return _coerce_int(actual) == expected
    if expected is None:
        return actual is None
    return str(actual) == str(expected)


def _read_collection_points_count(
    *,
    qdrant_client: QdrantClient,
    collection_name: str,
) -> int | None:
    try:
        collection_info = qdrant_client.get_collection(collection_name=collection_name)
    except TypeError:
        collection_info = qdrant_client.get_collection(collection_name)
    points_count = getattr(collection_info, "points_count", None)
    return None if points_count is None else int(points_count)


def _is_mock_qdrant_client(qdrant_client: object) -> bool:
    return type(qdrant_client).__module__.startswith("unittest.mock")


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


@dataclass(frozen=True, slots=True)
class _ReleaseChunkQualityBudget:
    max_token_count: int
    source: str
    max_token_count_by_unit_type: dict[str, int]


def _resolve_release_chunk_quality_budget(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
) -> _ReleaseChunkQualityBudget:
    if corpus == "regulations" and collection == "student_rules":
        handbook_limits = {
            HANDBOOK_V1_CHUNK_POLICY_VERSION: DEFAULT_MAX_CHUNK_SIZE,
            HANDBOOK_V2_CHUNK_POLICY_VERSION: HANDBOOK_V2_MAX_CHUNK_SIZE,
            HANDBOOK_V3_CHUNK_POLICY_VERSION: HANDBOOK_V3_MAX_CHUNK_SIZE,
        }
        max_token_count = handbook_limits.get(runtime_profile.chunk_profile_version)
        if max_token_count is None:
            raise ValueError(
                "unsupported student_rules chunk profile version for release gate: "
                f"{runtime_profile.chunk_profile_version}"
            )
        return _ReleaseChunkQualityBudget(
            max_token_count=max_token_count,
            source="student_handbook_runtime_profile",
            max_token_count_by_unit_type={},
        )
    if corpus == "curriculum" and collection == "curriculum_plan":
        if runtime_profile.chunk_profile_version == CURRICULUM_V1_CHUNK_POLICY_VERSION:
            max_token_count = CURRICULUM_V1_MAX_CHUNK_SIZE
            table_max_token_count = CURRICULUM_V1_MAX_CHUNK_SIZE
        elif runtime_profile.chunk_profile_version == CURRICULUM_V2_CHUNK_POLICY_VERSION:
            max_token_count = CURRICULUM_V2_MAX_CHUNK_SIZE
            table_max_token_count = CURRICULUM_V2_TABLE_MAX_CHUNK_SIZE
        else:
            raise ValueError(
                "unsupported curriculum chunk profile version for release gate: "
                f"{runtime_profile.chunk_profile_version}"
            )
        return _ReleaseChunkQualityBudget(
            max_token_count=max_token_count,
            source="curriculum_runtime_profile",
            max_token_count_by_unit_type={"table_unit": table_max_token_count},
        )
    if corpus == "official_web":
        if runtime_profile.chunk_profile_version != OFFICIAL_WEB_V2_CHUNK_POLICY_VERSION:
            raise ValueError(
                "unsupported official_web chunk profile version for release gate: "
                f"{runtime_profile.chunk_profile_version}"
            )
        return _ReleaseChunkQualityBudget(
            max_token_count=OFFICIAL_WEB_V2_MAX_CHUNK_SIZE,
            source="official_web_runtime_profile",
            max_token_count_by_unit_type={},
        )
    chunk_profile = load_chunk_profile(corpus, collection)
    if chunk_profile.chunk_profile_version != runtime_profile.chunk_profile_version:
        raise ValueError(
            "chunk-profile version does not match runtime-profile for "
            f"{corpus}/{collection}: "
            f"{chunk_profile.chunk_profile_version} != {runtime_profile.chunk_profile_version}"
        )
    if chunk_profile.cleaning_policy_version != runtime_profile.cleaning_policy_version:
        raise ValueError(
            "chunk-profile cleaning policy does not match runtime-profile for "
            f"{corpus}/{collection}: "
            f"{chunk_profile.cleaning_policy_version} != {runtime_profile.cleaning_policy_version}"
        )
    lane_max_token_count = max(
        (defaults.max_chunk_size for defaults in chunk_profile.lane_defaults.values()),
        default=chunk_profile.runtime_defaults.max_chunk_size,
    )
    return _ReleaseChunkQualityBudget(
        max_token_count=max(chunk_profile.runtime_defaults.max_chunk_size, lane_max_token_count),
        source="collection_chunk_profile",
        max_token_count_by_unit_type={},
    )


def _resolve_release_qrels_coverage_issues(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
    publish_alias: bool,
    qrels_coverage_issues: Sequence[str] | None,
) -> tuple[str, ...]:
    if not (publish_alias and _requires_release_retrieval_acceptance(runtime_profile)):
        return tuple(str(issue) for issue in qrels_coverage_issues or () if str(issue).strip())
    if qrels_coverage_issues is not None:
        return tuple(str(issue) for issue in qrels_coverage_issues if str(issue).strip())
    return _validate_default_qrels_coverage_for_scope(corpus=corpus, collection=collection)


def _validate_default_qrels_coverage_for_scope(*, corpus: str, collection: str) -> tuple[str, ...]:
    scope_key = f"{corpus}/{collection}"
    policy_path = _default_qrels_denominator_policy_path()
    policy_payload = _load_json_object(policy_path)
    policy_issues = _validate_qrels_denominator_policy_payload(policy_payload, scope_key=scope_key)
    scopes = policy_payload.get("scopes") if isinstance(policy_payload.get("scopes"), dict) else {}
    policy = scopes.get(scope_key) if isinstance(scopes, dict) else None
    if not isinstance(policy, dict):
        return (f"{scope_key}: missing qrels coverage policy",)
    qrels_path = _resolve_qrels_fixture_path(
        fixture=str(policy.get("fixture") or ""),
        policy_path=policy_path,
    )
    if not qrels_path.exists():
        return (f"{scope_key}: missing qrels fixture {qrels_path}",)
    payload = _load_json_object(qrels_path)
    cases = tuple(item for item in payload.get("cases") or () if isinstance(item, dict))
    issues: list[str] = list(policy_issues)
    case_count = len(cases)
    min_case_count = int(policy["min_case_count"])
    if case_count < min_case_count:
        issues.append(f"{scope_key}: qrels case count {case_count} below minimum {min_case_count}")
    coverage_classes = _raw_qrels_coverage_classes(cases)
    for required_class in policy["required_classes"]:
        if required_class not in coverage_classes:
            issues.append(f"{scope_key}: missing qrels coverage class {required_class}")
    declared_scenarios, scenario_issues = _declared_qrels_scenarios(payload=payload, cases=cases)
    issues.extend(f"{scope_key}: {issue}" for issue in scenario_issues)
    for required_scenario in policy["required_scenarios"]:
        if required_scenario not in declared_scenarios:
            issues.append(f"{scope_key}: missing qrels scenario {required_scenario}")
    scenario_denominator_classes = policy.get("scenario_denominator_classes")
    if not isinstance(scenario_denominator_classes, dict):
        scenario_denominator_classes = {}
    for scenario_id in declared_scenarios:
        denominator_classes = tuple(
            str(item).strip()
            for item in scenario_denominator_classes.get(scenario_id, ())
            if str(item).strip()
        )
        if not denominator_classes:
            issues.append(
                f"{scope_key}: qrels scenario {scenario_id} has no denominator class mapping"
            )
    return tuple(issues)


def _load_json_object(path) -> dict[str, object]:
    import json

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"qrels fixture must be a JSON object: {path}")
    return payload


def _default_qrels_denominator_policy_path():
    return (
        _repo_root()
        / "packages"
        / "evals"
        / "fixtures"
        / "retrieval_qrels_denominator_policy.v1.json"
    )


def _resolve_qrels_fixture_path(*, fixture: str, policy_path):
    from pathlib import Path

    path = Path(fixture)
    if path.is_absolute():
        return path
    fixture_root = _repo_root() / "packages" / "evals" / "fixtures"
    direct_path = fixture_root / path
    if direct_path.exists():
        return direct_path
    return Path(policy_path).parent / path


def _validate_qrels_denominator_policy_payload(
    payload: dict[str, object],
    *,
    scope_key: str,
) -> tuple[str, ...]:
    issues: list[str] = []
    if payload.get("schema_version") != _QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION:
        issues.append(
            "retrieval qrels denominator policy schema_version must be "
            f"{_QRELS_DENOMINATOR_POLICY_SCHEMA_VERSION}"
        )
    normalized_classes = {
        str(item).strip()
        for item in payload.get("normalized_denominator_classes") or ()
        if str(item).strip()
    }
    scopes = payload.get("scopes") if isinstance(payload.get("scopes"), dict) else {}
    scope_policy = scopes.get(scope_key) if isinstance(scopes, dict) else None
    if not isinstance(scope_policy, dict):
        return tuple(issues)
    scenario_classes = scope_policy.get("scenario_denominator_classes")
    if not isinstance(scenario_classes, dict):
        scenario_classes = {}
    for scenario_id in tuple(
        str(item).strip()
        for item in scope_policy.get("required_scenarios") or ()
        if str(item).strip()
    ):
        denominator_classes = tuple(
            str(item).strip() for item in scenario_classes.get(scenario_id, ()) if str(item).strip()
        )
        if not denominator_classes:
            issues.append(
                f"{scope_key}: required scenario {scenario_id} has no denominator class mapping"
            )
        for denominator_class in denominator_classes:
            if denominator_class not in normalized_classes:
                issues.append(
                    f"{scope_key}: scenario {scenario_id} references unknown denominator class "
                    f"{denominator_class}"
                )
    return tuple(issues)


def _raw_qrels_coverage_classes(cases: Sequence[dict[str, object]]) -> set[str]:
    coverage: set[str] = set()
    for case in cases:
        expected_sources = tuple(
            item for item in case.get("expected_sources") or () if isinstance(item, dict)
        )
        forbidden_sources = tuple(
            item for item in case.get("forbidden_sources") or () if isinstance(item, dict)
        )
        request_overrides = case.get("request_overrides")
        if expected_sources:
            coverage.add("positive")
        else:
            coverage.add("no_hit")
        if forbidden_sources:
            coverage.add("forbidden")
        if any(str(source.get("version_id") or "").strip() for source in expected_sources):
            coverage.add("version_locked")
        if isinstance(request_overrides, dict) and request_overrides:
            coverage.add("authz")
    return coverage


def _declared_qrels_scenarios(
    *,
    payload: dict[str, object],
    cases: Sequence[dict[str, object]],
) -> tuple[set[str], tuple[str, ...]]:
    raw_scenarios = payload.get("coverage_scenarios")
    if not isinstance(raw_scenarios, dict):
        return set(), ("missing qrels coverage_scenarios",)
    case_ids = {str(case.get("case_id") or "").strip() for case in cases}
    scenarios: set[str] = set()
    issues: list[str] = []
    for scenario_id, raw_case_ids in raw_scenarios.items():
        normalized_scenario_id = str(scenario_id).strip()
        if not normalized_scenario_id:
            issues.append("empty qrels scenario id")
            continue
        if not isinstance(raw_case_ids, list | tuple):
            issues.append(f"qrels scenario {normalized_scenario_id} must list case ids")
            continue
        scenario_case_ids = tuple(
            str(case_id).strip() for case_id in raw_case_ids if str(case_id).strip()
        )
        if not scenario_case_ids:
            issues.append(f"qrels scenario {normalized_scenario_id} has no cases")
            continue
        missing_case_ids = sorted(set(scenario_case_ids) - case_ids)
        if missing_case_ids:
            issues.append(
                f"qrels scenario {normalized_scenario_id} references missing cases: "
                + ", ".join(missing_case_ids)
            )
            continue
        scenarios.add(normalized_scenario_id)
    return scenarios, tuple(issues)


def _repo_root():
    from pathlib import Path

    return Path(__file__).resolve().parents[4]


def _validate_chunk_embedding_runtime_identity(
    *,
    chunks: Sequence[IndexableChunk],
    settings: EmbeddingSettings,
) -> None:
    chunk_models = {chunk.embedding_model for chunk in chunks if chunk.embedding_model.strip()}
    if chunk_models and chunk_models != {settings.model}:
        raise ValueError(
            "release chunk embedding model mismatch: "
            f"expected {settings.model}, got {', '.join(sorted(chunk_models))}"
        )
    if settings.dimensions is None:
        return
    chunk_dimensions = {len(chunk.embedding) for chunk in chunks if chunk.embedding is not None}
    if chunk_dimensions and chunk_dimensions != {settings.dimensions}:
        raise ValueError(
            "release chunk embedding dimensions mismatch: "
            f"expected {settings.dimensions}, got {', '.join(str(item) for item in sorted(chunk_dimensions))}"
        )


def _requires_release_retrieval_acceptance(profile: CollectionRuntimeProfile) -> bool:
    return bool(profile.serving_stage == "query_serving" and profile.query_enabled_by_default)


def _embedding_cache_enabled(source: dict[str, str]) -> bool:
    return (source.get("INGESTION_EMBEDDING_CACHE_ENABLED") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _build_fallback_retrieval_settings(
    *,
    chunks: Sequence[IndexableChunk],
    embedding_provider: str,
    embedding_dimensions: int | None,
) -> RetrievalSettings:
    embedding_model = next((chunk.embedding_model for chunk in chunks if chunk.embedding_model), "")
    if not embedding_model:
        embedding_model = "mock-embedding"
    return RetrievalSettings(
        qdrant_url=":memory:",
        embedding_provider=embedding_provider or "mock",
        embedding_model=embedding_model,
        embedding_dimensions=embedding_dimensions,
        sparse_provider="mock",
    )


def _document_units_sha256_by_key(manifest) -> dict[str, str] | None:
    if manifest is None:
        return None
    values: dict[str, str] = {}
    for document in manifest.documents:
        if document.document_units_object_key and document.document_units_sha256:
            values[document.document_units_object_key] = document.document_units_sha256
    return values or None


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
