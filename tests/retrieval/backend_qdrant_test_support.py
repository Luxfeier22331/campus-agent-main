from __future__ import annotations

import unittest
import uuid
from dataclasses import replace
from unittest.mock import Mock, patch

from campus_contracts import (
    DEFAULT_POLICY_PROJECTION_VERSION,
    AuthorizedRetrievalFilter,
    EvidenceBundle,
    EvidenceSource,
    PersonalizationHint,
)
from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl, index_chunks_to_qdrant
from campus_ingestion_core.process_indexing import required_payload_index_schemas
from campus_ingestion_core.scope_catalog import QdrantIndexBinding
from campus_ingestion_core.sparse import (
    MockSparseEmbeddingSettings,
    SparseEmbeddingSettings,
    build_mock_sparse_embedding_model,
    build_sparse_embedding_model,
)
from campus_retrieval_core.backend_qdrant import (
    CorpusQueryDisabledError,
    QdrantRetrievalBackend,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
    _apply_document_diversity_policy,
    _apply_no_hit_policy,
    _apply_official_web_low_signal_policy,
    _apply_preferred_document_bias,
    _build_document_support_query_text,
    _build_hybrid_prefetch,
    _build_metadata_filters,
    _build_qdrant_client,
    _build_qdrant_filter,
    _build_rrf_query,
    _prefer_curriculum_semester_course_list_sources,
)
from campus_retrieval_core.evidence_ranking import (
    prioritize_evidence_sources,
    query_targets_source_title,
    select_supporting_evidence_sources,
)
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import (
    RetrievalSettings,
)
from llama_index.core.schema import TextNode
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from qdrant_client.http.exceptions import ResponseHandlingException

from tests.support.in_memory_registry import InMemoryDocumentRegistry

STUDENT_HANDBOOK_QDRANT_COLLECTION = load_runtime_profile(
    "regulations", "student_rules"
).qdrant_index_binding.alias_name


def _make_source(
    *,
    doc_id: str,
    chunk_id: str,
    snippet: str,
    score: float,
    collection: str = "curriculum_plan",
    source_channel: str = "pdf_ocr",
    anchor: dict[str, object] | None = None,
    source_title: str = "",
    structural_path: tuple[str, ...] = (),
    content_kind: str = "",
    content_role: str = "",
    detail_label: str = "",
    is_answer_bearing: bool = False,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"v1:{chunk_id}",
        chunk_id=chunk_id,
        anchor=anchor or {},
        canonical_url=f"https://campus.example/{chunk_id}",
        latest_url=f"https://campus.example/{chunk_id}",
        source_channel=source_channel,
        collection=collection,
        is_current=False,
        snippet=snippet,
        score=score,
        source_title=source_title,
        structural_path=structural_path,
        content_kind=content_kind,
        content_role=content_role,
        detail_label=detail_label,
        is_answer_bearing=is_answer_bearing,
    )


def _authorized_filter(
    *,
    entitlement_groups: tuple[str, ...] = ("students",),
    visibility_scope: str | None = "north",
    visibility_level: str = "public",
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION,
) -> AuthorizedRetrievalFilter:
    return AuthorizedRetrievalFilter(
        entitlement_groups=entitlement_groups,
        visibility_level=visibility_level,
        visibility_scope=visibility_scope,
        policy_projection_version=policy_projection_version,
    )


def _make_runtime_profile(
    *,
    corpus: str = "regulations",
    collection: str = "student_rules",
    serving_surface: str | None = None,
    supports_freshness_sensitive_queries: bool = False,
    freshness_max_age_hours: int | None = None,
    live_search_fallback_allowed: bool = False,
    retrieval_top_k: int = 8,
    current_only: bool = True,
    serving_revision_tracks: tuple[str, ...] = ("current-effective", "source-faithful"),
    dense_prefetch_limit: int = 20,
    sparse_prefetch_limit: int = 20,
    rrf_k: int = 60,
    rrf_dense_weight: float = 1.0,
    rrf_sparse_weight: float = 1.0,
    document_support_limit: int = 24,
    document_support_strategy: str = "followup_query",
    embedding_query_instruction: str = (
        "Given a campus policy or handbook question, retrieve relevant passages that answer the query."
    ),
) -> CollectionRuntimeProfile:
    return CollectionRuntimeProfile(
        corpus=corpus,
        collection=collection,
        serving_stage="query_serving",
        allowed_artifact_modes=("normalized", "source_truth_only"),
        split_manifest_required=True,
        cleaning_policy_version=f"{collection}_cleaning_v1",
        chunk_profile_version=f"{collection}_semantic_v1",
        retrieval_enabled=True,
        query_enabled_by_default=True,
        serving_surface=serving_surface,
        supports_freshness_sensitive_queries=supports_freshness_sensitive_queries,
        freshness_max_age_hours=freshness_max_age_hours,
        live_search_fallback_allowed=live_search_fallback_allowed,
        retrieval_top_k=retrieval_top_k,
        current_only=current_only,
        serving_revision_tracks=serving_revision_tracks,
        dense_prefetch_limit=dense_prefetch_limit,
        sparse_prefetch_limit=sparse_prefetch_limit,
        rrf_k=rrf_k,
        rrf_dense_weight=rrf_dense_weight,
        rrf_sparse_weight=rrf_sparse_weight,
        document_support_limit=document_support_limit,
        document_support_strategy=document_support_strategy,
        embedding_query_instruction=embedding_query_instruction,
        no_hit_min_top_score=0.6,
        no_hit_min_score_gap=0.1,
        qdrant_index_binding=QdrantIndexBinding(
            alias_name=collection, collection_prefix=collection
        ),
    )


def _make_registry_record(
    *,
    document_id: str,
    version_id: str,
    entitlement_groups: tuple[str, ...],
    revision_track: str = "source-faithful",
    is_current: bool = True,
    status: str = "active",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=revision_track,
        version_id=version_id,
        source_uri=f"https://campus.example/handbook/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="student_rules",
        entitlement_groups=entitlement_groups,
        visibility_scope=None,
        status=status,
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="mock-embedding-8d",
        source_channel="pdf_ocr",
        is_current=is_current,
        document_units_object_key=(
            "regulations/documents/student_rules/"
            f"{document_id.replace(':', '-')}/source-faithful/undated/document-units.jsonl"
        ),
        processed_object_keys=(
            "regulations/documents/student_rules/"
            f"{document_id.replace(':', '-')}/source-faithful/undated/document-units.jsonl",
        ),
        import_source="raw_online_ocr",
    )


def _make_structured_jsonl(*, document_id: str, version_id: str, text: str) -> bytes:
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"visibility_level":"public","entitlement_groups":[]}}'.replace("'", '"').encode("utf-8")
    )


def _make_structured_jsonl_with_visibility_level(
    *,
    document_id: str,
    version_id: str,
    text: str,
    visibility_level: str = "public",
) -> bytes:
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"visibility_level":"{visibility_level}","entitlement_groups":[]}}'.replace(
            "'", '"'
        ).encode("utf-8")
    )


def _make_structured_jsonl_with_entitlement_groups(
    *,
    document_id: str,
    version_id: str,
    text: str,
    visibility_level: str = "public",
    entitlement_groups: tuple[str, ...],
) -> bytes:
    serialized_groups = ",".join(f'"{group}"' for group in entitlement_groups)
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"visibility_level":"{visibility_level}","entitlement_groups":[{serialized_groups}]}}'.replace(
            "'", '"'
        ).encode("utf-8")
    )


def _collect_filter_keys(filter_node: object) -> list[str]:
    if hasattr(filter_node, "key"):
        return [filter_node.key]
    keys: list[str] = []
    for nested in getattr(filter_node, "filters", ()):
        keys.extend(_collect_filter_keys(nested))
    return keys


def _collect_qdrant_filter_keys(filter_node: object) -> list[str]:
    key = getattr(filter_node, "key", None)
    if isinstance(key, str):
        return [key]
    is_empty = getattr(filter_node, "is_empty", None)
    empty_key = getattr(is_empty, "key", None)
    keys: list[str] = [empty_key] if isinstance(empty_key, str) else []
    for attr_name in ("must", "should", "must_not"):
        for nested in getattr(filter_node, attr_name, ()) or ():
            keys.extend(_collect_qdrant_filter_keys(nested))
    return keys


__all__ = (
    "DEFAULT_POLICY_PROJECTION_VERSION",
    "STUDENT_HANDBOOK_QDRANT_COLLECTION",
    "AuthorizedRetrievalFilter",
    "ChunkProfile",
    "CollectionRuntimeProfile",
    "CorpusQueryDisabledError",
    "DocumentRegistryRecord",
    "EvidenceBundle",
    "EvidenceSource",
    "InMemoryDocumentRegistry",
    "Mock",
    "MockEmbeddingSettings",
    "MockSparseEmbeddingSettings",
    "PersonalizationHint",
    "QdrantClient",
    "QdrantIndexBinding",
    "QdrantRetrievalBackend",
    "ResponseHandlingException",
    "RestrictedDocumentAccessDeniedError",
    "RetrievalBackendError",
    "RetrievalRequest",
    "RetrievalSettings",
    "SparseEmbeddingSettings",
    "TextNode",
    "_apply_document_diversity_policy",
    "_apply_no_hit_policy",
    "_apply_official_web_low_signal_policy",
    "_apply_preferred_document_bias",
    "_authorized_filter",
    "_build_document_support_query_text",
    "_build_hybrid_prefetch",
    "_build_metadata_filters",
    "_build_qdrant_client",
    "_build_qdrant_filter",
    "_build_rrf_query",
    "_collect_filter_keys",
    "_collect_qdrant_filter_keys",
    "_make_registry_record",
    "_make_runtime_profile",
    "_make_source",
    "_make_structured_jsonl",
    "_make_structured_jsonl_with_entitlement_groups",
    "_make_structured_jsonl_with_visibility_level",
    "_prefer_curriculum_semester_course_list_sources",
    "build_indexable_chunks_from_jsonl",
    "build_mock_embedding_model",
    "build_mock_sparse_embedding_model",
    "build_sparse_embedding_model",
    "index_chunks_to_qdrant",
    "load_runtime_profile",
    "patch",
    "prioritize_evidence_sources",
    "qdrant_models",
    "query_targets_source_title",
    "replace",
    "required_payload_index_schemas",
    "select_supporting_evidence_sources",
    "unittest",
    "uuid",
)
