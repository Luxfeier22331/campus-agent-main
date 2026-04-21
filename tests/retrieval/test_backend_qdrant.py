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
    "regulations", "student_handbook"
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
    collection: str = "student_handbook",
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
        collection="student_handbook",
        entitlement_groups=entitlement_groups,
        visibility_scope=None,
        status=status,
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="campusrag-import-v1",
        embedding_model="mock-embedding-8d",
        source_channel="pdf_ocr",
        is_current=is_current,
        document_units_object_key=(
            "regulations/documents/student_handbook/"
            f"{document_id.replace(':', '-')}/source-faithful/undated/document-units.jsonl"
        ),
        processed_object_keys=(
            "regulations/documents/student_handbook/"
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


class BackendQdrantTest(unittest.TestCase):
    def test_build_metadata_filters_treats_public_visibility_as_public_level(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        self.assertEqual(filters.condition.value, "and")
        self.assertEqual(len(filters.filters), 5)
        self.assertEqual(filters.filters[0].key, "corpus")
        self.assertEqual(filters.filters[0].value, "regulations")
        self.assertEqual(filters.filters[1].key, "collection")
        self.assertEqual(filters.filters[1].value, "student_handbook")
        self.assertEqual(filters.filters[2].key, "revision_track")
        self.assertEqual(filters.filters[2].operator.value, "in")
        self.assertEqual(filters.filters[2].value, ["current-effective", "source-faithful"])
        self.assertEqual(filters.filters[3].key, "status")
        self.assertEqual(filters.filters[3].value, "active")
        authz_filter = filters.filters[4]
        self.assertEqual(authz_filter.condition.value, "or")
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_level", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_build_metadata_filters_ignore_personalization_hint_for_authz_and_serving_scope(
        self,
    ) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="保研流程",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
                personalization_hint=PersonalizationHint(
                    actor_claim_terms=("2023 cohort", "philosophy major"),
                    recent_goal="咨询保研",
                    confirmed_slot_terms=("推免资格",),
                ),
            )
        )

        self.assertEqual(filters.condition.value, "and")
        self.assertEqual(len(filters.filters), 5)
        self.assertEqual(filters.filters[0].key, "corpus")
        self.assertEqual(filters.filters[1].key, "collection")
        self.assertEqual(filters.filters[2].key, "revision_track")
        self.assertEqual(filters.filters[3].key, "status")
        authz_filter = filters.filters[4]
        self.assertEqual(authz_filter.condition.value, "or")
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)

    def test_build_metadata_filters_prefers_authorized_filter_fields(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        authz_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertIn("visibility_scope", auth_keys)
        self.assertNotIn("campus_scope", auth_keys)

    def test_build_metadata_filters_uses_projection_payload_keys(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="保研流程",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        auth_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(auth_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertIn("visibility_scope", auth_keys)

    def test_build_metadata_filters_omit_entitlement_group_predicates_when_authorized_filter_has_no_entitlement_groups(
        self,
    ) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        authz_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(authz_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertNotIn("acl_level", auth_keys)
        self.assertNotIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_build_qdrant_filter_omits_entitlement_group_predicates_when_authorized_filter_has_no_entitlement_groups(
        self,
    ) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        auth_filter = qdrant_filter.must[3]
        auth_keys = _collect_qdrant_filter_keys(auth_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertNotIn("acl_level", auth_keys)
        self.assertNotIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_build_qdrant_filter_applies_explicit_version_filters_before_current_only(self) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="旧版国奖评审办法",
                corpus="regulations",
                collection="student_handbook",
                target_document_ids=("handbook:national-scholarship",),
                target_version_ids=("v1:national-scholarship",),
                target_revision_track="source-faithful",
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        conditions = qdrant_filter.must or []
        version_conditions = [
            condition for condition in conditions if getattr(condition, "key", None) == "version_id"
        ]
        self.assertEqual(len(version_conditions), 1)
        self.assertEqual(
            getattr(getattr(version_conditions[0], "match", None), "any", None),
            ["v1:national-scholarship"],
        )
        revision_conditions = [
            condition
            for condition in conditions
            if getattr(condition, "key", None) == "revision_track"
        ]
        self.assertEqual(len(revision_conditions), 1)
        self.assertEqual(
            getattr(getattr(revision_conditions[0], "match", None), "value", None),
            "source-faithful",
        )
        self.assertFalse(
            any(getattr(condition, "key", None) == "is_current" for condition in conditions)
        )

    def test_backend_fail_closes_scoped_restricted_documents_when_request_has_no_visibility_scope(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        restricted = replace(
            _make_registry_record(
                document_id="handbook:north-campus",
                version_id="v1:north-campus",
                entitlement_groups=("students",),
            ),
            visibility_scope="north",
        )
        registry.upsert(restricted)

        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        restricted_chunks = build_indexable_chunks_from_jsonl(
            record=restricted,
            structured_jsonl_bytes=_make_structured_jsonl_with_entitlement_groups(
                document_id=restricted.document_id,
                version_id=restricted.version_id,
                text="North campus student office hours are restricted.",
                entitlement_groups=("students",),
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        index_chunks_to_qdrant(
            chunks=restricted_chunks,
            qdrant_client=backend.qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="Tell me about north campus office hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(
                    entitlement_groups=("students",),
                    visibility_scope=None,
                ),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())

    def test_backend_raises_access_denied_for_targeted_restricted_document_without_authorization(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        restricted = replace(
            _make_registry_record(
                document_id="handbook:restricted-notice",
                version_id="v1:restricted-notice",
                entitlement_groups=("students",),
            ),
            visibility_level="restricted",
        )
        registry.upsert(restricted)

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with self.assertRaises(RestrictedDocumentAccessDeniedError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="这条通知写了什么？",
                    corpus="regulations",
                    collection="student_handbook",
                    target_document_ids=(restricted.document_id,),
                    authorized_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=(),
                        visibility_level="public",
                        visibility_scope=None,
                    ),
                )
            )

    def test_backend_raises_access_denied_when_any_targeted_document_is_restricted_without_authorization(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        allowed = _make_registry_record(
            document_id="handbook:allowed-notice",
            version_id="v1:allowed-notice",
            entitlement_groups=(),
        )
        restricted = replace(
            _make_registry_record(
                document_id="handbook:restricted-notice",
                version_id="v1:restricted-notice",
                entitlement_groups=("students",),
            ),
            visibility_level="restricted",
        )
        registry.upsert(allowed)
        registry.upsert(restricted)

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with self.assertRaises(RestrictedDocumentAccessDeniedError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="这条通知写了什么？",
                    corpus="regulations",
                    collection="student_handbook",
                    target_document_ids=(allowed.document_id, restricted.document_id),
                    authorized_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=(),
                        visibility_level="public",
                        visibility_scope=None,
                    ),
                )
            )

    def test_build_qdrant_filter_adds_target_document_constraint_when_present(self) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="国奖评审办法里的论文要求是什么？",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                target_document_ids=(
                    "handbook:national-scholarship",
                    "handbook:professional-scholarship",
                ),
            )
        )

        document_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "document_id"
        ]

        self.assertEqual(len(document_conditions), 1)
        self.assertEqual(
            getattr(getattr(document_conditions[0], "match", None), "any", None),
            ["handbook:national-scholarship", "handbook:professional-scholarship"],
        )

    def test_build_metadata_filters_adds_canonical_course_filters_when_present(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="思政课有哪些专业要上",
                corpus="curriculum",
                collection="course_facts",
                canonical_course_ids=("course:muc.xigai",),
                canonical_course_family_ids=("course_family:muc.ideological_political_theory",),
            )
        )

        filter_keys = _collect_filter_keys(filters)
        self.assertIn("canonical_course_id", filter_keys)
        self.assertIn("canonical_course_family_id", filter_keys)

    def test_build_qdrant_filter_adds_canonical_course_constraints_when_present(self) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="思政课有哪些专业要上",
                corpus="curriculum",
                collection="course_facts",
                canonical_course_ids=("course:muc.xigai",),
                canonical_course_family_ids=("course_family:muc.ideological_political_theory",),
            )
        )

        course_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "canonical_course_id"
        ]
        family_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "canonical_course_family_id"
        ]

        self.assertEqual(len(course_conditions), 1)
        self.assertEqual(
            getattr(getattr(course_conditions[0], "match", None), "any", None),
            ["course:muc.xigai"],
        )
        self.assertEqual(len(family_conditions), 1)
        self.assertEqual(
            getattr(getattr(family_conditions[0], "match", None), "any", None),
            ["course_family:muc.ideological_political_theory"],
        )

    def test_build_metadata_filters_adds_canonical_program_family_filter_when_present(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="民族班有哪些",
                corpus="curriculum",
                collection="program_family_facts",
                canonical_program_family_ids=("program_family:muc.ethnic_experimental_class",),
            )
        )

        filter_keys = _collect_filter_keys(filters)
        self.assertIn("canonical_program_family_id", filter_keys)

    def test_build_qdrant_filter_adds_canonical_program_family_constraint_when_present(
        self,
    ) -> None:
        qdrant_filter = _build_qdrant_filter(
            RetrievalRequest(
                query_text="基地班有哪些",
                corpus="curriculum",
                collection="program_family_facts",
                canonical_program_family_ids=("program_family:muc.base_class",),
            )
        )

        family_conditions = [
            condition
            for condition in qdrant_filter.must or ()
            if getattr(condition, "key", None) == "canonical_program_family_id"
        ]

        self.assertEqual(len(family_conditions), 1)
        self.assertEqual(
            getattr(getattr(family_conditions[0], "match", None), "any", None),
            ["program_family:muc.base_class"],
        )

    def test_build_metadata_filters_ignore_preferred_document_ids(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="基地班培养方案",
                corpus="curriculum",
                collection="curriculum_plan",
                preferred_document_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
            )
        )

        filter_keys = _collect_filter_keys(filters)
        self.assertNotIn("preferred_document_ids", filter_keys)
        self.assertNotIn("document_id", filter_keys)

    def test_apply_preferred_document_bias_promotes_preferred_doc_at_ranking_time(self) -> None:
        biased_sources = _apply_preferred_document_bias(
            sources=(
                _make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law:chunk-0004",
                    snippet="第四学期 国际公法、知识产权法。",
                    score=0.92,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:history-strong-base:chunk-0004",
                    snippet="第四学期 中国史学史、史学理论专题。",
                    score=0.88,
                ),
            ),
            preferred_document_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
        )

        self.assertEqual(
            [source.doc_id for source in biased_sources],
            [
                "curriculum:历史学（强基计划）本科人才培养方案",
                "curriculum:法学（民族实验班）本科人才培养方案",
            ],
        )

    def test_apply_official_web_low_signal_policy_fail_closes_generic_campus_name_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public_pages:article:news-1",
                    chunk_id="official-web:news-1",
                    snippet="中央民族大学召开专题工作会议。",
                    score=0.93,
                    collection="muc_public_pages",
                    source_title="中央民族大学召开专题工作会议",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_official_web_low_signal_policy_fail_closes_unanchored_life_service_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="食堂营业时间",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public_pages:article:news-2",
                    chunk_id="official-web:news-2",
                    snippet="中央民族大学与北京丰台人才集团共建就业实习实践基地。",
                    score=0.89,
                    collection="muc_public_pages",
                    source_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_official_web_low_signal_policy_keeps_specific_anchored_query(self) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="民族团结进步促进法 解读",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public_pages:article:news-3",
                    chunk_id="official-web:news-3",
                    snippet="校长强世功接受“统战新语”专访，解读民族团结进步促进法。",
                    score=0.91,
                    collection="muc_public_pages",
                    source_title="校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(len(filtered), 1)

    def test_apply_official_web_low_signal_policy_fail_closes_freshness_sensitive_query_when_profile_is_not_freshness_ready(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="muc_public_pages",
            serving_surface="mixed",
            supports_freshness_sensitive_queries=False,
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学今天有什么讲座",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public_pages:article:notice-1",
                    chunk_id="official-web:notice-1",
                    snippet="民图一小时信息素养讲座将于4月2日14:00在丰台校区图书馆视听空间125室举行。",
                    score=0.92,
                    collection="muc_public_pages",
                    source_title="民图一小时信息素养讲座",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_official_web_low_signal_policy_applies_to_stable_reference_scope(self) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
            supports_freshness_sensitive_queries=False,
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学今天有什么讲座",
            sources=(
                _make_source(
                    doc_id="official_web:stable_reference:article:notice-1",
                    chunk_id="official-web:stable-reference:notice-1",
                    snippet="讲座将于4月2日14:00举行。",
                    score=0.92,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="讲座预告",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_document_diversity_policy_collapses_same_doc_official_web_results(self) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学与北京丰台人才集团共建就业实习实践基地",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:employment-base",
                    chunk_id="official-web:employment-base:chunk-1",
                    snippet="中央民族大学与北京丰台人才集团共建就业实习实践基地。",
                    score=0.93,
                    collection="muc_public_pages",
                    source_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:employment-base",
                    chunk_id="official-web:employment-base:chunk-2",
                    snippet="双方将在就业实习实践等方面深化合作。",
                    score=0.91,
                    collection="muc_public_pages",
                    source_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    content_role="supporting_detail",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:law-interpretation",
                    chunk_id="official-web:law-interpretation:chunk-1",
                    snippet="校长强世功接受“统战新语”专访 解读民族团结进步促进法。",
                    score=0.89,
                    collection="muc_public_pages",
                    source_title="校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:employment-base",
                    "official-web:employment-base:chunk-1",
                ),
                (
                    "official_web:muc_public:article_detail:law-interpretation",
                    "official-web:law-interpretation:chunk-1",
                ),
            ),
        )

    def test_apply_document_diversity_policy_keeps_other_collections_unchanged(self) -> None:
        profile = _make_runtime_profile()
        original_sources = (
            _make_source(
                doc_id="handbook:library",
                chunk_id="handbook:library:chunk-1",
                snippet="图书馆开放时间为 08:00-22:00。",
                score=0.93,
                collection="student_handbook",
            ),
            _make_source(
                doc_id="handbook:library",
                chunk_id="handbook:library:chunk-2",
                snippet="图书馆节假日开放时间另行通知。",
                score=0.91,
                collection="student_handbook",
            ),
        )

        self.assertEqual(
            _apply_document_diversity_policy(
                profile=profile,
                query_text="图书馆开放时间",
                sources=original_sources,
            ),
            original_sources,
        )

    def test_apply_document_diversity_policy_locks_official_web_title_target_to_single_doc(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="official-web:school-profile:chunk-1",
                    snippet="中央民族大学学校简介。",
                    score=0.91,
                    collection="muc_public_pages",
                    source_title="学校简介",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    chunk_id="official-web:school-overview:chunk-1",
                    snippet="学校概况包含学校简介等内容。",
                    score=0.93,
                    collection="muc_public_pages",
                    source_title="学校概况",
                    structural_path=("学校概况", "学校简介"),
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "official-web:school-profile:chunk-1",
                ),
            ),
        )

    def test_apply_document_diversity_policy_prefers_lead_chunk_for_title_targeted_official_web_reference_doc(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0003",
                    snippet="2021年，“中央民族学院开学”入选《中国共产党一百年大事记》。学校拥有一支结构合理的高水平师资队伍。",
                    score=0.95,
                    collection="muc_public_pages",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0001",
                    snippet="中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。",
                    score=0.91,
                    collection="muc_public_pages",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-0001",
                ),
            ),
        )

    def test_apply_document_diversity_policy_applies_to_stable_reference_scope(self) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0003",
                    snippet="学校拥有结构合理的高水平师资队伍。",
                    score=0.95,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0001",
                    snippet="中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-0001",
                ),
            ),
        )

    def test_apply_document_diversity_policy_rejects_parent_heading_match_for_school_overview_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校概况",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    chunk_id="school-overview:chunk-0001",
                    snippet="标题：学校概况 学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校概况",
                    structural_path=("学校概况",),
                    content_kind="article_body",
                    content_role="primary_content",
                    anchor={"segment_ord": 1},
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    chunk_id="school-overview:chunk-0005",
                    snippet="标题：学校概况 学校设有1个学部、26个学院，有覆盖12个学科门类的71个本科专业。",
                    score=0.89,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校概况",
                    structural_path=("学校概况",),
                    content_kind="article_body",
                    content_role="primary_content",
                    anchor={"segment_ord": 5},
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0001",
                    snippet="标题：学校简介 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.92,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="article_body",
                    content_role="primary_content",
                    anchor={"segment_ord": 1, "section_path": ["学校概况", "学校简介"]},
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    "school-overview:chunk-0001",
                ),
                (
                    "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    "school-overview:chunk-0005",
                ),
            ),
        )

    def test_index_chunks_to_qdrant_skips_payload_indexes_for_local_backend(self) -> None:
        record = _make_registry_record(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            entitlement_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Local qdrant indexing should not create payload indexes.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.create_payload_index = Mock(
            side_effect=AssertionError("should not be called")
        )  # type: ignore[method-assign]

        ids = index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        self.assertEqual(len(ids), 1)

    def test_index_chunks_to_qdrant_creates_named_dense_and_sparse_vectors_for_remote_backend(
        self,
    ) -> None:
        record = _make_registry_record(
            document_id="handbook:test-remote",
            version_id="v1:test-remote",
            entitlement_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Remote qdrant indexing should create visibility payload indexes.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.collection_exists = Mock(side_effect=[False, True])  # type: ignore[method-assign]
        qdrant_client.create_collection = Mock()  # type: ignore[method-assign]
        qdrant_client.upsert = Mock()  # type: ignore[method-assign]
        qdrant_client.create_payload_index = Mock()  # type: ignore[method-assign]
        with patch("campus_ingestion_core.process._is_local_qdrant_backend", return_value=False):
            ids = index_chunks_to_qdrant(
                chunks=chunks,
                qdrant_client=qdrant_client,
                collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
                sparse_embedding_model=build_sparse_embedding_model(SparseEmbeddingSettings()),
            )

        self.assertEqual(ids, (str(uuid.uuid5(uuid.NAMESPACE_URL, chunks[0].chunk_id)),))
        qdrant_client.create_collection.assert_called_once()
        create_kwargs = qdrant_client.create_collection.call_args.kwargs
        self.assertIn("dense", create_kwargs["vectors_config"])
        self.assertIn("sparse", create_kwargs["sparse_vectors_config"])
        qdrant_client.upsert.assert_called_once()
        point = qdrant_client.upsert.call_args.kwargs["points"][0]
        self.assertIn("dense", point.vector)
        self.assertIn("sparse", point.vector)
        self.assertIsInstance(point.vector["sparse"], qdrant_models.Document)
        self.assertEqual(point.vector["sparse"].model, "qdrant/bm25")
        indexed_fields = [
            call.kwargs["field_name"] for call in qdrant_client.create_payload_index.call_args_list
        ]
        self.assertEqual(
            indexed_fields,
            [
                "document_id",
                "revision_track",
                "version_id",
                "corpus",
                "collection",
                "canonical_course_id",
                "canonical_course_family_id",
                "canonical_program_family_id",
                "visibility_scope",
                "entitlement_groups",
                "visibility_level",
                "policy_projection_version",
                "status",
                "source_channel",
                "is_current",
            ],
        )
        indexed_schemas = {
            call.kwargs["field_name"]: call.kwargs["field_schema"]
            for call in qdrant_client.create_payload_index.call_args_list
        }
        self.assertTrue(
            all(
                indexed_schemas[field_name] == qdrant_models.PayloadSchemaType.KEYWORD
                for field_name in indexed_fields
                if field_name != "is_current"
            )
        )
        self.assertEqual(indexed_schemas["is_current"], qdrant_models.PayloadSchemaType.BOOL)

    def test_backend_rejects_query_disabled_corpus(self) -> None:
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        with self.assertRaisesRegex(CorpusQueryDisabledError, "campus_services/service_catalog"):
            backend.retrieve(
                RetrievalRequest(
                    query_text="宿舍报修流程",
                    corpus="campus_services",
                    collection="service_catalog",
                )
            )

    def test_retrieval_settings_from_env_reads_registry_database_url(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": ":memory:",
                "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres",
            }
        )

        self.assertEqual(settings.qdrant_url, ":memory:")
        self.assertEqual(
            settings.document_registry_database_url,
            "postgresql://registry.example/postgres",
        )
        self.assertEqual(settings.embedding_provider, "gitee")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.sparse_provider, "qdrant")
        self.assertEqual(settings.sparse_model, "qdrant/bm25")
        self.assertEqual(settings.sparse_tokenizer, "multilingual")
        self.assertEqual(settings.sparse_language, "none")

    def test_retrieval_settings_from_env_falls_back_to_shared_postgres_url(self) -> None:
        settings = RetrievalSettings.from_env(
            {
                "QDRANT_URL": ":memory:",
                "CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared.example/postgres",
            }
        )

        self.assertEqual(
            settings.document_registry_database_url, "postgresql://shared.example/postgres"
        )

    def test_retrieval_settings_from_env_requires_explicit_qdrant_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "QDRANT_URL is required"):
            RetrievalSettings.from_env({})

    def test_retrieval_settings_from_env_no_longer_requires_qdrant_collection(self) -> None:
        settings = RetrievalSettings.from_env({"QDRANT_URL": ":memory:"})

        self.assertEqual(settings.qdrant_url, ":memory:")

    def test_retrieval_settings_default_qwen3_dimensions_to_native_width(self) -> None:
        settings = RetrievalSettings(
            qdrant_url=":memory:",
            document_registry_database_url="postgresql://registry.example/postgres",
        )

        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.sparse_model, "qdrant/bm25")

    def test_sparse_embedding_settings_default_to_qdrant_bm25_for_handbook(self) -> None:
        settings = SparseEmbeddingSettings.from_env({})

        self.assertEqual(settings.provider, "qdrant")
        self.assertEqual(settings.model, "qdrant/bm25")
        self.assertEqual(settings.tokenizer, "multilingual")
        self.assertEqual(settings.language, "none")

    def test_build_hybrid_prefetch_uses_sparse_vector_query_for_native_hybrid(self) -> None:
        class _DenseEmbeddingModel:
            def get_query_embedding(self, query: str) -> list[float]:
                self.query = query
                return [0.1] * 8

        class _SparseEmbeddingModel:
            def __init__(self) -> None:
                self.query_calls: list[str] = []

            def build_document(
                self, text: str
            ) -> qdrant_models.Document | qdrant_models.SparseVector:
                raise AssertionError(
                    "document embedding should not be used during retrieval query prefetch"
                )

            def build_query(
                self, text: str
            ) -> qdrant_models.Document | qdrant_models.SparseVector | None:
                self.query_calls.append(text)
                return qdrant_models.Document(
                    text=text,
                    model="qdrant/bm25",
                    options=qdrant_models.Bm25Config(
                        tokenizer=qdrant_models.TokenizerType.MULTILINGUAL,
                        language="none",
                        lowercase=True,
                        ascii_folding=False,
                    ),
                )

        dense_embedding_model = _DenseEmbeddingModel()
        sparse_embedding_model = _SparseEmbeddingModel()
        profile = _make_runtime_profile(
            dense_prefetch_limit=11,
            sparse_prefetch_limit=13,
            embedding_query_instruction="Retrieve handbook passages about the requested office or schedule.",
        )

        prefetch = _build_hybrid_prefetch(
            request=RetrievalRequest(
                query_text="scholarship office hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=3,
            ),
            profile=profile,
            embedding_model=dense_embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        self.assertEqual(
            dense_embedding_model.query,
            (
                "Instruct: Retrieve handbook passages about the requested office or schedule.\n"
                "Query: scholarship office hours"
            ),
        )
        self.assertEqual(sparse_embedding_model.query_calls, ["scholarship office hours"])
        self.assertEqual(len(prefetch), 2)
        self.assertEqual(prefetch[0].using, "dense")
        self.assertEqual(prefetch[1].using, "sparse")
        self.assertEqual(prefetch[0].limit, 11)
        self.assertEqual(prefetch[1].limit, 13)
        self.assertIsInstance(prefetch[1].query, qdrant_models.Document)
        self.assertEqual(prefetch[1].query.model, "qdrant/bm25")
        self.assertEqual(prefetch[1].query.text, "scholarship office hours")
        dense_filter = prefetch[0].filter
        self.assertIsNotNone(dense_filter)
        dense_conditions = dense_filter.must or []
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "status"
                and getattr(getattr(condition, "match", None), "value", None) == "active"
                for condition in dense_conditions
            )
        )
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "is_current"
                and getattr(getattr(condition, "match", None), "value", None) is True
                for condition in dense_conditions
            )
        )
        self.assertTrue(
            any(
                getattr(condition, "key", None) == "revision_track"
                and getattr(getattr(condition, "match", None), "any", None)
                == ["current-effective", "source-faithful"]
                for condition in dense_conditions
            )
        )

    def test_build_rrf_query_uses_runtime_profile_weights(self) -> None:
        query = _build_rrf_query(
            _make_runtime_profile(
                rrf_k=37,
                rrf_dense_weight=1.6,
                rrf_sparse_weight=0.7,
            )
        )

        self.assertEqual(query.rrf.k, 37)
        self.assertEqual(query.rrf.weights, [1.6, 0.7])

    def test_backend_caches_dense_query_embedding_within_ttl(self) -> None:
        class _CountingDenseEmbeddingModel:
            def __init__(self) -> None:
                self.calls: list[str] = []

            def get_query_embedding(self, query: str) -> list[float]:
                self.calls.append(query)
                return [0.1] * 8

        registry = InMemoryDocumentRegistry()
        embedding_model = _CountingDenseEmbeddingModel()
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        backend.qdrant_client.query_points = Mock(  # type: ignore[method-assign]
            return_value=qdrant_models.QueryResponse(points=[])
        )

        request = RetrievalRequest(
            query_text="library hours",
            corpus="regulations",
            collection="student_handbook",
            authorized_filter=_authorized_filter(),
        )
        backend.retrieve(request)
        backend.retrieve(request)

        self.assertEqual(
            embedding_model.calls,
            [
                "Instruct: Given a campus policy or handbook question, retrieve relevant passages that answer "
                "the query.\nQuery: library hours"
            ],
        )

    def test_build_qdrant_client_uses_plain_remote_configuration(self) -> None:
        settings = RetrievalSettings(
            qdrant_url="https://example-cloud.qdrant.io",
            qdrant_api_key="secret",
        )
        fake_client = object()

        with patch(
            "campus_retrieval_core.backend_qdrant.QdrantClient", return_value=fake_client
        ) as client_ctor:
            result = _build_qdrant_client(settings)

        self.assertIs(result, fake_client)
        client_ctor.assert_called_once_with(
            url="https://example-cloud.qdrant.io",
            api_key="secret",
            timeout=settings.qdrant_timeout_seconds,
            cloud_inference=True,
            check_compatibility=False,
            trust_env=False,
        )

    def test_backend_uses_collection_exists_without_alias_listing_precheck(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.get_aliases = Mock(
            side_effect=AssertionError("alias listing should not be called")
        )
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        qdrant_client.collection_exists.assert_called_once_with("student_handbook")
        qdrant_client.query_points.assert_called_once()
        qdrant_client.get_aliases.assert_not_called()

    def test_backend_caches_positive_collection_existence_checks(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        request = RetrievalRequest(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_handbook",
            authorized_filter=_authorized_filter(),
            top_k=5,
        )

        backend.retrieve(request)
        backend.retrieve(request)

        qdrant_client.collection_exists.assert_called_once_with("student_handbook")
        self.assertEqual(qdrant_client.query_points.call_count, 2)

    def test_backend_retries_transient_collection_exists_failures(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                True,
            ]
        )
        qdrant_client.query_points = Mock(return_value=qdrant_models.QueryResponse(points=[]))
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        self.assertEqual(qdrant_client.collection_exists.call_count, 3)
        qdrant_client.query_points.assert_called_once()

    def test_backend_retries_transient_query_points_failures(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                qdrant_models.QueryResponse(points=[]),
            ]
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="学生证丢了怎么办",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        self.assertEqual(qdrant_client.query_points.call_count, 3)

    def test_backend_raises_when_transient_query_points_failures_exhaust_retries(self) -> None:
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.query_points = Mock(
            side_effect=[
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
                ResponseHandlingException(
                    RuntimeError("_ssl.c:983: The handshake operation timed out")
                ),
            ]
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with self.assertRaises(RetrievalBackendError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="学生证丢了怎么办",
                    corpus="regulations",
                    collection="student_handbook",
                    authorized_filter=_authorized_filter(),
                    top_k=5,
                )
            )

        self.assertEqual(qdrant_client.query_points.call_count, 3)

    def test_backend_returns_evidence_bundle_with_source_locator(self) -> None:
        registry = InMemoryDocumentRegistry()
        record = _make_registry_record(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            entitlement_groups=("students",),
        )
        registry.upsert(record)

        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Library hours are from 08:00 to 22:00 for students.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=backend.qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="What are the library hours?",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
            )
        )

        self.assertIsInstance(result, EvidenceBundle)
        self.assertEqual(result.corpus, "regulations")
        self.assertEqual(result.collection, "student_handbook")
        self.assertEqual(len(result.sources), 1)
        source = result.sources[0]
        self.assertEqual(source.doc_id, "handbook:test-001")
        self.assertEqual(source.revision_track, "source-faithful")
        self.assertEqual(source.version_id, "v1:test-001")
        self.assertEqual(source.source_channel, "pdf_ocr")
        self.assertEqual(source.collection, "student_handbook")
        self.assertTrue(source.is_current)
        self.assertEqual(source.canonical_url, "https://campus.example/handbook/handbook:test-001")
        self.assertEqual(source.latest_url, source.canonical_url)
        self.assertEqual(source.anchor["page_start"], 5)
        self.assertIn("08:00", source.snippet)

    def test_backend_uses_qdrant_native_hybrid_query_with_explicit_rrf_config(self) -> None:
        registry = InMemoryDocumentRegistry()
        record = _make_registry_record(
            document_id="handbook:hybrid-winner",
            version_id="v1:hybrid-winner",
            entitlement_groups=("students",),
        )
        registry.upsert(record)

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        backend.qdrant_client.query_points = Mock(  # type: ignore[method-assign]
            return_value=qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="chunk-hybrid-001",
                        version=1,
                        score=0.77,
                        payload={
                            "_node_content": TextNode(
                                text="Hybrid winner surfaced by native hybrid query.",
                                metadata={
                                    "document_id": record.document_id,
                                    "revision_track": record.revision_track,
                                    "version_id": record.version_id,
                                    "chunk_id": "chunk-hybrid-001",
                                    "anchor": {"page_start": 3, "page_end": 3},
                                    "visibility_level": "public",
                                    "source_channel": "pdf_ocr",
                                    "collection": "student_handbook",
                                    "is_current": False,
                                },
                            ).model_dump_json(),
                        },
                    )
                ]
            )
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="scholarship office hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=3,
            )
        )

        self.assertEqual(len(result.sources), 1)
        self.assertEqual(result.sources[0].doc_id, "handbook:hybrid-winner")
        profile = load_runtime_profile("regulations", "student_handbook")
        query_kwargs = backend.qdrant_client.query_points.call_args.kwargs
        self.assertIsInstance(query_kwargs["query"], qdrant_models.RrfQuery)
        self.assertEqual(query_kwargs["query"].rrf.k, profile.rrf_k)
        self.assertEqual(
            query_kwargs["query"].rrf.weights,
            [profile.rrf_dense_weight, profile.rrf_sparse_weight],
        )
        self.assertEqual(len(query_kwargs["prefetch"]), 2)
        self.assertEqual(query_kwargs["prefetch"][0].using, "dense")
        self.assertEqual(query_kwargs["prefetch"][1].using, "sparse")
        self.assertEqual(query_kwargs["prefetch"][0].limit, profile.dense_prefetch_limit)
        self.assertEqual(query_kwargs["prefetch"][1].limit, profile.sparse_prefetch_limit)

    def test_backend_skips_sources_with_missing_registry_or_revision_metadata(self) -> None:
        registry = InMemoryDocumentRegistry()
        record = _make_registry_record(
            document_id="handbook:test-skip",
            version_id="v1:test-skip",
            entitlement_groups=("students",),
        )
        registry.upsert(record)

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        backend.qdrant_client.query_points = Mock(  # type: ignore[method-assign]
            return_value=qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="chunk-missing-001",
                        version=1,
                        score=0.8,
                        payload={
                            "_node_content": TextNode(
                                text="Missing revision metadata should be skipped.",
                                metadata={
                                    "document_id": record.document_id,
                                    "version_id": record.version_id,
                                    "chunk_id": "chunk-missing-001",
                                },
                            ).model_dump_json()
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="chunk-missing-002",
                        version=1,
                        score=0.7,
                        payload={
                            "_node_content": TextNode(
                                text="Unknown registry record should also be skipped.",
                                metadata={
                                    "document_id": "handbook:missing-record",
                                    "revision_track": "source-faithful",
                                    "version_id": "v1:missing-record",
                                    "chunk_id": "chunk-missing-002",
                                },
                            ).model_dump_json()
                        },
                    ),
                ]
            )
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
            )
        )

        self.assertEqual(result.sources, ())

    def test_backend_uses_payload_urls_when_evidence_payload_is_complete(self) -> None:
        registry = InMemoryDocumentRegistry()
        record = _make_registry_record(
            document_id="handbook:payload-complete",
            version_id="v1:payload-complete",
            entitlement_groups=("students",),
            is_current=True,
        )
        registry.upsert(record)

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        backend.qdrant_client.query_points = Mock(  # type: ignore[method-assign]
            return_value=qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="chunk-payload-001",
                        version=1,
                        score=0.93,
                        payload={
                            "_node_content": TextNode(
                                text="Library opening hours are from 08:00 to 22:00.",
                                metadata={
                                    "document_id": "handbook:payload-complete",
                                    "revision_track": "source-faithful",
                                    "version_id": "v1:payload-complete",
                                    "chunk_id": "chunk-payload-001",
                                    "anchor": {"page_start": 5, "page_end": 5},
                                    "visibility_level": "public",
                                    "source_channel": "pdf_ocr",
                                    "collection": "student_handbook",
                                    "is_current": True,
                                    "canonical_url": "https://payload.example/should-not-win",
                                    "latest_url": "https://payload.example/should-not-win",
                                },
                            ).model_dump_json(),
                        },
                    )
                ]
            )
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
            )
        )

        self.assertEqual(len(result.sources), 1)
        source = result.sources[0]
        self.assertEqual(source.doc_id, "handbook:payload-complete")
        self.assertTrue(source.is_current)
        self.assertEqual(source.canonical_url, "https://payload.example/should-not-win")
        self.assertEqual(source.latest_url, "https://payload.example/should-not-win")

    def test_backend_applies_authz_filter_before_returning_sources(self) -> None:
        registry = InMemoryDocumentRegistry()
        allowed = _make_registry_record(
            document_id="handbook:students",
            version_id="v1:students",
            entitlement_groups=("students",),
        )
        blocked = _make_registry_record(
            document_id="handbook:staff",
            version_id="v1:staff",
            entitlement_groups=("staff",),
        )
        registry.upsert(allowed)
        registry.upsert(blocked)

        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        allowed_chunks = build_indexable_chunks_from_jsonl(
            record=allowed,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=allowed.document_id,
                version_id=allowed.version_id,
                text="Students can enter the library until 22:00.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        blocked_chunks = build_indexable_chunks_from_jsonl(
            record=blocked,
            structured_jsonl_bytes=_make_structured_jsonl_with_visibility_level(
                document_id=blocked.document_id,
                version_id=blocked.version_id,
                text="Staff office hours are private.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        index_chunks_to_qdrant(
            chunks=[*allowed_chunks, *blocked_chunks],
            qdrant_client=backend.qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="Tell me about office or library hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual([source.doc_id for source in result.sources], ["handbook:students"])

    def test_backend_fail_closes_when_document_has_entitlement_groups_even_if_structured_visibility_is_public(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        restricted = _make_registry_record(
            document_id="handbook:staff-only",
            version_id="v1:staff-only",
            entitlement_groups=("staff",),
        )
        registry.upsert(restricted)

        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        restricted_chunks = build_indexable_chunks_from_jsonl(
            record=restricted,
            structured_jsonl_bytes=_make_structured_jsonl_with_entitlement_groups(
                document_id=restricted.document_id,
                version_id=restricted.version_id,
                text="Staff office hours are private.",
                entitlement_groups=("staff",),
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )

        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        index_chunks_to_qdrant(
            chunks=restricted_chunks,
            qdrant_client=backend.qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="Tell me about office hours",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())

    def test_backend_returns_empty_bundle_on_no_hit(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="unknown question",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
            )
        )

        self.assertEqual(
            result,
            EvidenceBundle(
                query_text="unknown question",
                corpus="regulations",
                collection="student_handbook",
            ),
        )

    def test_backend_returns_empty_bundle_for_ambiguous_low_score_results(self) -> None:
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.collection_exists = Mock(return_value=True)  # type: ignore[method-assign]
        backend.qdrant_client.query_points = Mock(  # type: ignore[method-assign]
            return_value=qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="chunk-nohit-001",
                        version=1,
                        score=0.5,
                        payload={
                            "_node_content": TextNode(
                                text="Campus order policy text.",
                                metadata={
                                    "document_id": "handbook:nohit-a",
                                    "revision_track": "source-faithful",
                                    "version_id": "v1:nohit-a",
                                    "chunk_id": "chunk-nohit-001",
                                    "anchor": {"page_start": 1, "page_end": 1},
                                    "visibility_level": "public",
                                    "source_channel": "pdf_ocr",
                                    "collection": "student_handbook",
                                    "is_current": True,
                                    "canonical_url": "https://campus.example/handbook/nohit-a",
                                    "latest_url": "https://campus.example/handbook/nohit-a",
                                },
                            ).model_dump_json(),
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="chunk-nohit-002",
                        version=1,
                        score=0.5,
                        payload={
                            "_node_content": TextNode(
                                text="Student ID policy text.",
                                metadata={
                                    "document_id": "handbook:nohit-b",
                                    "revision_track": "source-faithful",
                                    "version_id": "v1:nohit-b",
                                    "chunk_id": "chunk-nohit-002",
                                    "anchor": {"page_start": 2, "page_end": 2},
                                    "visibility_level": "public",
                                    "source_channel": "pdf_ocr",
                                    "collection": "student_handbook",
                                    "is_current": True,
                                    "canonical_url": "https://campus.example/handbook/nohit-b",
                                    "latest_url": "https://campus.example/handbook/nohit-b",
                                },
                            ).model_dump_json(),
                        },
                    ),
                ]
            )
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="校内宇宙签证办理处",
                corpus="regulations",
                collection="student_handbook",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(
            result,
            EvidenceBundle(
                query_text="校内宇宙签证办理处",
                corpus="regulations",
                collection="student_handbook",
            ),
        )

    def test_backend_collapses_same_doc_chunk_crowding_for_official_web(self) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="employment-base-primary",
                    version=0,
                    score=0.93,
                    payload={
                        "_node_content": TextNode(
                            text="中央民族大学与北京丰台人才集团共建就业实习实践基地。",
                            metadata={
                                "document_id": "official_web:muc_public:article_detail:employment-base",
                                "revision_track": "source-faithful",
                                "version_id": "owdocver:employment-base",
                                "chunk_id": "employment-base:chunk-1",
                                "acl_level": "public",
                                "source_channel": "official_web",
                                "collection": "muc_public_pages",
                                "is_current": True,
                                "canonical_url": "https://news.muc.edu.cn/info/1011/61874.htm",
                                "latest_url": "https://news.muc.edu.cn/info/1011/61874.htm",
                                "anchor": {
                                    "page_family": "article_detail",
                                    "section_path": [
                                        "中央民族大学与北京丰台人才集团共建就业实习实践基地"
                                    ],
                                },
                                "title": "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                            },
                        ).model_dump_json(),
                    },
                ),
                qdrant_models.ScoredPoint(
                    id="employment-base-support",
                    version=0,
                    score=0.92,
                    payload={
                        "_node_content": TextNode(
                            text="双方将在就业实习实践等方面深化合作。",
                            metadata={
                                "document_id": "official_web:muc_public:article_detail:employment-base",
                                "revision_track": "source-faithful",
                                "version_id": "owdocver:employment-base",
                                "chunk_id": "employment-base:chunk-2",
                                "acl_level": "public",
                                "source_channel": "official_web",
                                "collection": "muc_public_pages",
                                "is_current": True,
                                "canonical_url": "https://news.muc.edu.cn/info/1011/61874.htm",
                                "latest_url": "https://news.muc.edu.cn/info/1011/61874.htm",
                                "anchor": {
                                    "page_family": "article_detail",
                                    "section_path": [
                                        "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                                        "正文",
                                    ],
                                },
                                "title": "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                            },
                        ).model_dump_json(),
                    },
                ),
                qdrant_models.ScoredPoint(
                    id="law-interpretation-primary",
                    version=0,
                    score=0.88,
                    payload={
                        "_node_content": TextNode(
                            text="校长强世功接受“统战新语”专访 解读民族团结进步促进法。",
                            metadata={
                                "document_id": "official_web:muc_public:article_detail:law-interpretation",
                                "revision_track": "source-faithful",
                                "version_id": "owdocver:law-interpretation",
                                "chunk_id": "law-interpretation:chunk-1",
                                "acl_level": "public",
                                "source_channel": "official_web",
                                "collection": "muc_public_pages",
                                "is_current": True,
                                "canonical_url": "https://news.muc.edu.cn/info/1011/61954.htm",
                                "latest_url": "https://news.muc.edu.cn/info/1011/61954.htm",
                                "anchor": {
                                    "page_family": "article_detail",
                                    "section_path": [
                                        "校长强世功接受“统战新语”专访 解读民族团结进步促进法"
                                    ],
                                },
                                "title": "校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                            },
                        ).model_dump_json(),
                    },
                ),
            ]
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile", return_value=profile
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    corpus="official_web",
                    collection="muc_public_pages",
                    top_k=3,
                )
            )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in result.sources),
            (
                (
                    "official_web:muc_public:article_detail:employment-base",
                    "employment-base:chunk-1",
                ),
                (
                    "official_web:muc_public:article_detail:law-interpretation",
                    "law-interpretation:chunk-1",
                ),
            ),
        )

    def test_backend_locks_title_targeted_official_web_reference_query_to_exact_doc(self) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="school-overview",
                    version=0,
                    score=0.93,
                    payload={
                        "_node_content": TextNode(
                            text="学校概况包含学校简介等内容。",
                            metadata={
                                "document_id": "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                                "revision_track": "source-faithful",
                                "version_id": "owdocver:school-overview",
                                "chunk_id": "school-overview:chunk-1",
                                "acl_level": "public",
                                "source_channel": "official_web",
                                "collection": "muc_public_pages",
                                "is_current": True,
                                "canonical_url": "https://www.muc.edu.cn/xxgk1.htm",
                                "latest_url": "https://www.muc.edu.cn/xxgk1.htm",
                                "anchor": {
                                    "page_family": "article_detail",
                                    "section_path": ["学校概况", "学校简介"],
                                },
                                "title": "学校概况",
                            },
                        ).model_dump_json(),
                    },
                ),
                qdrant_models.ScoredPoint(
                    id="school-profile",
                    version=0,
                    score=0.91,
                    payload={
                        "_node_content": TextNode(
                            text="中央民族大学学校简介。",
                            metadata={
                                "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                "revision_track": "source-faithful",
                                "version_id": "owdocver:school-profile",
                                "chunk_id": "school-profile:chunk-1",
                                "acl_level": "public",
                                "source_channel": "official_web",
                                "collection": "muc_public_pages",
                                "is_current": True,
                                "canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                "latest_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                "anchor": {
                                    "page_family": "article_detail",
                                    "section_path": ["学校简介"],
                                },
                                "title": "学校简介",
                            },
                        ).model_dump_json(),
                    },
                ),
            ]
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile", return_value=profile
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="中央民族大学学校简介",
                    corpus="official_web",
                    collection="muc_public_pages",
                    top_k=3,
                )
            )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in result.sources),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-1",
                ),
            ),
        )

    def test_backend_title_targeted_official_web_reference_query_recovers_lead_chunk_from_same_doc_support(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="school-profile-chunk-1-record",
                    payload={
                        "_node_content": TextNode(
                            text="中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。",
                            metadata={
                                "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                "revision_track": "source-faithful",
                                "version_id": "owdocver:school-profile",
                                "chunk_id": "school-profile:chunk-0001",
                                "acl_level": "public",
                                "source_channel": "official_web",
                                "collection": "muc_public_pages",
                                "is_current": True,
                                "canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                "latest_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                "anchor": {
                                    "page_family": "article_detail",
                                    "section_path": ["学校概况", "学校简介"],
                                },
                                "title": "学校简介",
                            },
                        ).model_dump_json(),
                    },
                    vector=None,
                    shard_key=None,
                    order_value=None,
                )
            ],
            None,
        )
        qdrant_client.query_points.side_effect = [
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="school-profile-chunk-4",
                        version=0,
                        score=0.93,
                        payload={
                            "_node_content": TextNode(
                                text="学校拥有门类综合、特色鲜明的高水平学科专业体系。",
                                metadata={
                                    "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                    "revision_track": "source-faithful",
                                    "version_id": "owdocver:school-profile",
                                    "chunk_id": "school-profile:chunk-0004",
                                    "acl_level": "public",
                                    "source_channel": "official_web",
                                    "collection": "muc_public_pages",
                                    "is_current": True,
                                    "canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "latest_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "anchor": {
                                        "page_family": "article_detail",
                                        "section_path": ["学校概况", "学校简介"],
                                    },
                                    "title": "学校简介",
                                },
                            ).model_dump_json(),
                        },
                    )
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="school-profile-support-chunk-4",
                        version=0,
                        score=0.61,
                        payload={
                            "_node_content": TextNode(
                                text="学校现有在编教职工近2000人，其中专任教师近1200人。",
                                metadata={
                                    "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                    "revision_track": "source-faithful",
                                    "version_id": "owdocver:school-profile",
                                    "chunk_id": "school-profile:chunk-0004",
                                    "acl_level": "public",
                                    "source_channel": "official_web",
                                    "collection": "muc_public_pages",
                                    "is_current": True,
                                    "canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "latest_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "anchor": {
                                        "page_family": "article_detail",
                                        "section_path": ["学校概况", "学校简介"],
                                    },
                                    "title": "学校简介",
                                },
                            ).model_dump_json(),
                        },
                    ),
                ]
            ),
        ]
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile", return_value=profile
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="中央民族大学学校简介",
                    corpus="official_web",
                    collection="muc_public_pages",
                    top_k=3,
                )
            )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in result.sources),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-0001",
                ),
            ),
        )

    def test_backend_title_targeted_official_web_reference_query_recovers_lead_chunk_for_stable_reference(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="school-profile-chunk-1-record",
                    payload={
                        "_node_content": TextNode(
                            text="中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。",
                            metadata={
                                "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                "revision_track": "source-faithful",
                                "version_id": "owdocver:school-profile",
                                "chunk_id": "school-profile:chunk-0001",
                                "acl_level": "public",
                                "source_channel": "official_web",
                                "collection": "stable_reference",
                                "is_current": True,
                                "canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                "latest_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                "anchor": {
                                    "page_family": "article_detail",
                                    "section_path": ["学校概况", "学校简介"],
                                },
                                "title": "学校简介",
                            },
                        ).model_dump_json(),
                    },
                    vector=None,
                    shard_key=None,
                    order_value=None,
                )
            ],
            None,
        )
        qdrant_client.query_points.side_effect = [
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="school-profile-chunk-4",
                        version=0,
                        score=0.93,
                        payload={
                            "_node_content": TextNode(
                                text="学校拥有门类综合、特色鲜明的高水平学科专业体系。",
                                metadata={
                                    "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                    "revision_track": "source-faithful",
                                    "version_id": "owdocver:school-profile",
                                    "chunk_id": "school-profile:chunk-0004",
                                    "acl_level": "public",
                                    "source_channel": "official_web",
                                    "collection": "stable_reference",
                                    "is_current": True,
                                    "canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "latest_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "anchor": {
                                        "page_family": "article_detail",
                                        "section_path": ["学校概况", "学校简介"],
                                    },
                                    "title": "学校简介",
                                },
                            ).model_dump_json(),
                        },
                    )
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="school-profile-support-chunk-4",
                        version=0,
                        score=0.61,
                        payload={
                            "_node_content": TextNode(
                                text="学校现有在编教职工近2000人，其中专任教师近1200人。",
                                metadata={
                                    "document_id": "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                                    "revision_track": "source-faithful",
                                    "version_id": "owdocver:school-profile",
                                    "chunk_id": "school-profile:chunk-0004",
                                    "acl_level": "public",
                                    "source_channel": "official_web",
                                    "collection": "stable_reference",
                                    "is_current": True,
                                    "canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "latest_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                                    "anchor": {
                                        "page_family": "article_detail",
                                        "section_path": ["学校概况", "学校简介"],
                                    },
                                    "title": "学校简介",
                                },
                            ).model_dump_json(),
                        },
                    ),
                ]
            ),
        ]
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile", return_value=profile
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="中央民族大学学校简介",
                    corpus="official_web",
                    collection="stable_reference",
                    top_k=3,
                )
            )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in result.sources),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-0001",
                ),
            ),
        )

    def test_prioritize_evidence_sources_prefers_exact_curriculum_title_over_longer_superset(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科人才培养方案",
            sources=(
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.7,
                ),
                _make_source(
                    doc_id="curriculum:民族学本科人才培养方案",
                    chunk_id="curriculum:ethnology:chunk-0001",
                    snippet="民族学本科人才培养方案 一、培养目标。",
                    score=0.4761905,
                ),
            ),
        )

        self.assertEqual(ranked[0].doc_id, "curriculum:民族学本科人才培养方案")

    def test_prioritize_evidence_sources_prefers_curriculum_fact_chunk_for_short_fact_query(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.9,
                ),
                _make_source(
                    doc_id="curriculum:法学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:law-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.82,
                ),
                _make_source(
                    doc_id="curriculum:教育学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:education-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.81,
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.78,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "curriculum:ethnology-second-degree:chunk-0005")

    def test_prioritize_evidence_sources_prefers_named_curriculum_document_over_other_docs_fact_chunks(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:教育学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:education-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.82,
                ),
                _make_source(
                    doc_id="curriculum:应用统计学本科专业第二学位人才培养方案",
                    chunk_id="curriculum:stats-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:48.5学分。",
                    score=0.81,
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.49,
                ),
            ),
        )

        self.assertEqual(ranked[0].doc_id, "curriculum:民族学本科第二学士学位人才培养方案")

    def test_prioritize_evidence_sources_prefers_same_document_academic_years_chunk_over_generic_tables(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0007",
                    snippet="七、各教学环节学时学分分配表 合计 56 学分。",
                    score=0.015873017,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=(
                        "民族学本科第二学士学位人才培养方案",
                        "七、各教学环节学时学分分配表",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0010",
                    snippet="八、民族学本科专业教学进程计划表 社会研究方法。",
                    score=0.014925373,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=(
                        "民族学本科第二学士学位人才培养方案",
                        "八、民族学本科专业教学进程计划表",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0005",
                    snippet="五、学制 两年",
                    score=0.033333335,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=("民族学本科第二学士学位人才培养方案", "五、学制 两年"),
                    content_kind="section_text",
                    detail_label="五、学制",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "curriculum:ethnology-second-degree:chunk-0005")

    def test_prioritize_evidence_sources_prefers_same_document_course_map_chunk_over_generic_tables(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            sources=(
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0013",
                    snippet="五、课程设置和修读建议 1. 专业核心课程 经济学说史。",
                    score=0.032002047,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 中国近现代经济史。",
                    score=0.031257633,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0023",
                    snippet="六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图",
                    score=0.033333335,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "六、课程地图"),
                    content_kind="section_text",
                    detail_label="六、课程地图",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "curriculum:economics-innovation:chunk-0023")

    def test_select_supporting_evidence_sources_fail_closes_course_map_lookup(self) -> None:
        selected = select_supporting_evidence_sources(
            query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            max_sources=3,
            sources=(
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0023",
                    snippet="六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                    score=0.99,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "六、课程地图"),
                    content_kind="section_text",
                    detail_label="六、课程地图",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 中国近现代经济史。",
                    score=0.98,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0015",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 发展经济学专题。",
                    score=0.97,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0013",
                    snippet="五、课程设置和修读建议 1. 专业核心课程 专业核心课程 30 学分。",
                    score=0.96,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        self.assertEqual(selected, ())

    def test_prioritize_evidence_sources_does_not_force_shortest_title_for_ambiguous_ethnic_experimental_fragment(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族实验班",
            sources=(
                _make_source(
                    doc_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:cs-ethnic-experimental:chunk-0011",
                    snippet="培养要求表 必修课 40 学分。",
                    score=0.91,
                    source_title="计算机科学与技术（民族实验班）本科人才培养方案",
                    structural_path=(
                        "计算机科学与技术（民族实验班）本科人才培养方案",
                        "七、培养要求",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law-ethnic-experimental:chunk-0001",
                    snippet="法学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "一、培养目标"),
                    content_kind="section_text",
                ),
                _make_source(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:ics-ethnic-experimental:chunk-0001",
                    snippet="信息与计算科学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.48,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "信息与计算科学（民族实验班）本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            ),
        )

        self.assertEqual(
            ranked[0].doc_id, "curriculum:计算机科学与技术（民族实验班）本科人才培养方案"
        )

    def test_query_targets_source_title_accepts_curriculum_title_with_inserted_direction_variant(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="中国少数民族语言文学强基计划本科人才培养方案",
                source=_make_source(
                    doc_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    chunk_id="curriculum:minority-language-strong-base:chunk-0001",
                    snippet="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案 一、培养目标。",
                    score=0.51,
                    source_title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    structural_path=(
                        "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            )
        )

    def test_query_targets_source_title_accepts_long_semantic_curriculum_title_paraphrase(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="想看中国少数民族语言文学古文字学方向强基计划培养方案",
                source=_make_source(
                    doc_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    chunk_id="curriculum:minority-language-strong-base:chunk-0001",
                    snippet="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案 一、培养目标。",
                    score=0.51,
                    source_title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    structural_path=(
                        "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            )
        )

    def test_query_targets_source_title_accepts_short_official_web_page_title_with_school_prefix(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="中央民族大学博士后",
                source=EvidenceSource(
                    doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                    revision_track="source-faithful",
                    version_id="owdocver:test",
                    chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
                    anchor={"segment_ord": 1},
                    canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                    latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                    source_channel="official_web",
                    collection="muc_public_pages",
                    is_current=True,
                    snippet="博士后 学校现有6个博士后科研流动站。",
                    score=0.61,
                    source_title="博士后",
                    structural_path=("博士后",),
                    content_kind="article_body",
                ),
            )
        )

    def test_query_targets_source_title_ignores_parent_heading_for_official_web_reference_doc(
        self,
    ) -> None:
        self.assertFalse(
            query_targets_source_title(
                query_text="中央民族大学学校概况",
                source=EvidenceSource(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    revision_track="source-faithful",
                    version_id="owdocver:test-school-profile",
                    chunk_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487:chunk-0001",
                    anchor={"segment_ord": 1, "section_path": ["学校概况", "学校简介"]},
                    canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    latest_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    source_channel="official_web",
                    collection="stable_reference",
                    is_current=True,
                    snippet="标题：学校简介 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.61,
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="article_body",
                ),
            )
        )

    def test_build_document_support_query_text_uses_fact_hints_for_official_web_reference_pages(
        self,
    ) -> None:
        school_overview_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
            revision_track="source-faithful",
            version_id="owdocver:test-school-overview",
            chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/xxgk1.htm",
            latest_url="https://www.muc.edu.cn/xxgk1.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：学校概况 学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
            score=0.6,
            source_title="学校概况",
            structural_path=("学校概况",),
            content_kind="article_body",
        )
        postdoctoral_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
            revision_track="source-faithful",
            version_id="owdocver:test-postdoc",
            chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
            latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：博士后 中央民族大学全面推动“双一流”建设和整体发展。",
            score=0.6,
            source_title="博士后",
            structural_path=("博士后",),
            content_kind="article_body",
        )
        scholar_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
            revision_track="source-faithful",
            version_id="owdocver:test-scholars",
            chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
            anchor={"segment_ord": 1, "section_path": ["学校概况", "学校概况", "翦伯赞"]},
            canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
            latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：学术名流 翦伯赞先生对改造旧史学、创建马克思主义新史学做出了卓越贡献。",
            score=0.6,
            source_title="学术名流",
            structural_path=("学术名流", "翦伯赞"),
            content_kind="article_body",
        )

        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学校概况",
                source=school_overview_source,
            ),
            "学校概况 三个校区 12个学科门类",
        )
        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学博士后",
                source=postdoctoral_source,
            ),
            "博士后 博士后科研流动站 合格率",
        )
        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学术名流",
                source=scholar_source,
            ),
            "学术名流 历史学 社会学 民族学 人类学 语言学 音乐",
        )

    def test_build_document_support_query_text_uses_fact_hints_for_stable_reference_pages(
        self,
    ) -> None:
        school_overview_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
            revision_track="source-faithful",
            version_id="owdocver:test-school-overview-stable-reference",
            chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/xxgk1.htm",
            latest_url="https://www.muc.edu.cn/xxgk1.htm",
            source_channel="official_web",
            collection="stable_reference",
            is_current=True,
            snippet="标题：学校概况 学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
            score=0.6,
            source_title="学校概况",
            structural_path=("学校概况",),
            content_kind="article_body",
        )

        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学校概况",
                source=school_overview_source,
            ),
            "学校概况 三个校区 12个学科门类",
        )

    def test_apply_document_diversity_policy_prefers_fact_rich_chunk_for_stable_reference_queries(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        school_overview_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                revision_track="source-faithful",
                version_id="owdocver:test-overview-lead",
                chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
                anchor={"segment_ord": 1},
                canonical_url="https://www.muc.edu.cn/xxgk1.htm",
                latest_url="https://www.muc.edu.cn/xxgk1.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学校概况 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。学校现有三个校区。",
                score=0.6,
                source_title="学校概况",
                structural_path=("学校概况",),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                revision_track="source-faithful",
                version_id="owdocver:test-overview-facts",
                chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0004",
                anchor={"segment_ord": 4},
                canonical_url="https://www.muc.edu.cn/xxgk1.htm",
                latest_url="https://www.muc.edu.cn/xxgk1.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学校概况 学校拥有门类综合、特色鲜明的高水平学科专业体系。目前，学校设有1个学部、26个学院，有覆盖12个学科门类的71个本科专业。",
                score=0.58,
                source_title="学校概况",
                structural_path=("学校概况",),
                content_kind="article_body",
            ),
        )
        postdoctoral_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                revision_track="source-faithful",
                version_id="owdocver:test-postdoc-lead",
                chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
                anchor={"segment_ord": 1},
                canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：博士后 中央民族大学全面推动“双一流”建设和整体发展，创新工作机制，强化服务保障。",
                score=0.62,
                source_title="博士后",
                structural_path=("博士后",),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                revision_track="source-faithful",
                version_id="owdocver:test-postdoc-facts",
                chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0003",
                anchor={"segment_ord": 3},
                canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：博士后 学校现有6个博士后科研流动站。在全国博管会组织的历次流动站评估中，我校参评的流动站合格率均为100％。",
                score=0.57,
                source_title="博士后",
                structural_path=("博士后",),
                content_kind="article_body",
            ),
        )

        school_overview_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校概况",
            sources=school_overview_sources,
        )
        postdoctoral_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学博士后",
            sources=postdoctoral_sources,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in school_overview_filtered),
            (
                "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
                "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0004",
            ),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in postdoctoral_filtered),
            (
                "official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0003",
            ),
        )

    def test_apply_document_diversity_policy_keeps_multiple_scholar_chunks_for_scholar_page(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        scholar_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-history",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
                anchor={"segment_ord": 1, "section_path": ["学校概况", "学校概况", "翦伯赞"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 翦伯赞先生与郭沫若、范文澜等一起筹建中国历史学会，对改造旧史学、创建马克思主义新史学做出了卓越贡献。",
                score=0.61,
                source_title="学术名流",
                structural_path=("学术名流", "翦伯赞"),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-social",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0002",
                anchor={"segment_ord": 2, "section_path": ["学校概况", "学校概况", "吴泽霖"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 吴泽霖先生将社会学与民族学、人类学等学科联系起来，对社会现象作跨学科研究。",
                score=0.6,
                source_title="学术名流",
                structural_path=("学术名流", "吴泽霖"),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-language",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0006",
                anchor={"segment_ord": 6, "section_path": ["学校概况", "学校概况", "于道泉"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 于道泉长期从事藏学人才培养，设计了效果良好的藏语拉丁化拼音方案。",
                score=0.59,
                source_title="学术名流",
                structural_path=("学术名流", "于道泉"),
                content_kind="article_body",
            ),
        )

        scholar_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学术名流",
            sources=scholar_sources,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in scholar_filtered),
            (
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0002",
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0006",
            ),
        )

    def test_expand_named_document_support_uses_focused_query_for_same_document_followup(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-full", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-intro",
                        version=0,
                        score=0.49,
                        payload={
                            "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:ethnology-second-degree",
                            "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "民族学本科第二学士学位人才培养方案",
                                    "一、培养目标",
                                ]
                            },
                            "text": "民族学本科第二学士学位人才培养方案 一、培养目标。",
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-years",
                        version=0,
                        score=0.47,
                        payload={
                            "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:ethnology-second-degree",
                            "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "民族学本科第二学士学位人才培养方案",
                                    "五、学制 两年",
                                ]
                            },
                            "text": "五、学制 两年",
                        },
                    ),
                ]
            ),
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        backend.retrieve(
            RetrievalRequest(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(embedding_model.get_query_embedding.call_count, 2)
        self.assertEqual(
            embedding_model.get_query_embedding.call_args_list[1].args[0],
            "Instruct: Given a campus policy or handbook question, retrieve relevant passages that answer the query.\nQuery: 学制",
        )
        self.assertEqual(sparse_embedding_model.build_query.call_args_list[1].args[0], "学制")

    def test_build_document_support_query_text_strips_short_fact_question_noise(self) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                source=_make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="民族学本科第二学士学位人才培养方案",
                ),
            ),
            "学制",
        )

    def test_build_document_support_query_text_strips_table_question_noise(self) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                source=_make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0001",
                    snippet="经济学拔尖人才创新班人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="经济学拔尖人才创新班人才培养方案",
                ),
            ),
            "课程地图",
        )

    def test_build_document_support_query_text_normalizes_curriculum_alias_and_semester_noise(
        self,
    ) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="法学民族班培养方案里大二下有什么课",
                source=_make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law-ethnic-experimental:chunk-0004",
                    snippet="第四学期 国际公法、知识产权法。",
                    score=0.49,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                ),
            ),
            "第四学期",
        )

    def test_prioritize_evidence_sources_uses_explicit_source_title_when_doc_ids_are_opaque(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:doc-001",
                    chunk_id="curriculum:doc-001:chunk-0005",
                    snippet="学制：两年。",
                    score=0.49,
                    source_title="民族学本科第二学士学位人才培养方案",
                    content_kind="text",
                    content_role="time_rule",
                    detail_label="五、学制",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:doc-002",
                    chunk_id="curriculum:doc-002:chunk-0005",
                    snippet="学制：两年。",
                    score=0.82,
                    source_title="教育学本科第二学士学位人才培养方案",
                    content_kind="text",
                    content_role="time_rule",
                    detail_label="五、学制",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].doc_id, "curriculum:doc-001")

    def test_prioritize_evidence_sources_prefers_answer_bearing_procedure_chunk_over_closing_provision(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="学生证丢失后怎么办理补办？",
            sources=(
                _make_source(
                    doc_id="handbook:student-card",
                    chunk_id="student-card-closing",
                    snippet="附则 本办法由学生处负责解释。",
                    score=0.91,
                    collection="student_handbook",
                    source_title="中央民族大学学生证管理办法",
                    structural_path=("附则",),
                    content_kind="text",
                    content_role="closing_provision",
                    detail_label="附则",
                ),
                _make_source(
                    doc_id="handbook:student-card",
                    chunk_id="student-card-procedure",
                    snippet="学生证遗失后，应及时到学院挂失，填写补办申请表，经学院审批后到学生处办理。",
                    score=0.73,
                    collection="student_handbook",
                    source_title="中央民族大学学生证管理办法",
                    structural_path=("第三章 学籍管理", "学生证管理"),
                    content_kind="text",
                    content_role="procedure",
                    detail_label="第十二条",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "student-card-procedure")

    def test_prioritize_evidence_sources_uses_content_role_to_demote_explanatory_background_chunks(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="学生证补办流程是什么？",
            sources=(
                _make_source(
                    doc_id="handbook:doc-opaque",
                    chunk_id="student-card-background",
                    snippet="学生证补办相关规定由学生处负责解释。",
                    score=0.92,
                    collection="student_handbook",
                    source_title="中央民族大学学生证管理办法",
                    content_kind="text",
                    content_role="closing_provision",
                    detail_label="附则",
                ),
                _make_source(
                    doc_id="handbook:doc-opaque",
                    chunk_id="student-card-procedure-steps",
                    snippet="需先挂失，再提交补证申请，经学院审批后办理。",
                    score=0.67,
                    collection="student_handbook",
                    source_title="中央民族大学学生证管理办法",
                    content_kind="text",
                    content_role="procedure",
                    detail_label="第十二条",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "student-card-procedure-steps")

    def test_prioritize_evidence_sources_demotes_official_web_support_only_roles(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="本科培养",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    chunk_id="undergraduate-source-attribution",
                    snippet="本科培养 来源：教务处",
                    score=0.96,
                    collection="muc_public_pages",
                    source_title="本科培养",
                    structural_path=("人才培养",),
                    content_kind="section_text",
                    content_role="source_attribution",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    chunk_id="undergraduate-reference-fact",
                    snippet="学校现有本科专业71个，在招专业61个，涵盖11个学科门类。",
                    score=0.62,
                    collection="muc_public_pages",
                    source_title="本科培养",
                    structural_path=("人才培养",),
                    content_kind="section_text",
                    content_role="reference_fact",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    chunk_id="undergraduate-boilerplate",
                    snippet="投稿方式：mucxcb@muc.edu.cn",
                    score=0.99,
                    collection="muc_public_pages",
                    source_title="本科培养",
                    structural_path=("人才培养",),
                    content_kind="section_text",
                    content_role="boilerplate",
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "undergraduate-reference-fact")
        self.assertEqual(ranked[-1].chunk_id, "undergraduate-boilerplate")

    def test_build_evidence_sources_maps_structural_metadata_into_contract_fields(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        sources = backend._build_evidence_sources(
            (
                qdrant_models.ScoredPoint(
                    id="point-student-card",
                    version=0,
                    score=0.77,
                    payload={
                        "document_id": "handbook:student-card",
                        "revision_track": "source-faithful",
                        "version_id": "v1:student-card",
                        "chunk_id": "student-card-procedure",
                        "collection": "student_handbook",
                        "visibility_level": "public",
                        "canonical_url": "https://campus.example/handbook/student-card",
                        "latest_url": "https://campus.example/handbook/student-card",
                        "source_channel": "pdf_ocr",
                        "is_current": False,
                        "title": "中央民族大学学生证管理办法",
                        "unit_type": "article_body",
                        "content_role": "procedure",
                        "is_answer_bearing": True,
                        "anchor": {
                            "section_path": ["第三章 学籍管理", "学生证管理"],
                            "article_label": "第十二条",
                        },
                        "text": "学生证遗失后，应及时到学院挂失，填写补办申请表。",
                    },
                ),
            )
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].source_title, "中央民族大学学生证管理办法")
        self.assertEqual(sources[0].structural_path, ("第三章 学籍管理", "学生证管理"))
        self.assertEqual(sources[0].content_kind, "article_body")
        self.assertEqual(sources[0].content_role, "procedure")
        self.assertEqual(sources[0].detail_label, "第十二条")
        self.assertTrue(sources[0].is_answer_bearing)

    def test_build_evidence_sources_maps_canonical_parent_and_semester_unit_metadata(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        sources = backend._build_evidence_sources(
            (
                qdrant_models.ScoredPoint(
                    id="point-program-semester-fact",
                    version=0,
                    score=0.93,
                    payload={
                        "document_id": "program_semester_facts:law-ethnic-experimental:semester-4",
                        "revision_track": "source-faithful",
                        "version_id": "v1:law-ethnic-experimental:semester-4",
                        "chunk_id": "program_semester_facts:law-ethnic-experimental:semester-4:row-0001",
                        "collection": "program_semester_facts",
                        "visibility_level": "public",
                        "canonical_url": "https://campus.example/curriculum/law-ethnic-experimental",
                        "latest_url": "https://campus.example/curriculum/law-ethnic-experimental",
                        "source_channel": "pdf_ocr",
                        "is_current": False,
                        "source_title": "法学（民族实验班）本科人才培养方案 第四学期课程事实",
                        "content_kind": "program_semester_fact",
                        "content_role": "semester_course_list",
                        "detail_label": "第四学期课程",
                        "is_answer_bearing": True,
                        "source_doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                        "source_doc_title": "法学（民族实验班）本科人才培养方案",
                        "semester_label": "第四学期",
                        "semester_index": "4",
                        "anchor": {
                            "fact_type": "semester_course_list",
                            "section_path": ["法学（民族实验班）本科人才培养方案", "第四学期"],
                            "detail_label": "第四学期课程",
                        },
                        "text": "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
                    },
                ),
            )
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(
            sources[0].canonical_source_id,
            "curriculum:法学（民族实验班）本科人才培养方案",
        )
        self.assertEqual(
            sources[0].canonical_source_title,
            "法学（民族实验班）本科人才培养方案",
        )
        self.assertEqual(sources[0].source_unit_kind, "semester_course_list")
        self.assertEqual(sources[0].source_unit_key, "semester-4")

    def test_build_evidence_sources_infers_curriculum_table_fact_when_runtime_payload_omits_unit_metadata(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        sources = backend._build_evidence_sources(
            (
                qdrant_models.ScoredPoint(
                    id="point-curriculum-table",
                    version=0,
                    score=0.44,
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(一)大类培养",
                                "1. 通识教育",
                            ],
                            "table_group_id": "page-0150-block-6-0007",
                        },
                        "text": (
                            "五、课程设置和修读建议\n\n"
                            "(一)大类培养\n\n"
                            "1. 通识教育\n\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                            "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                        ),
                    },
                ),
            )
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].content_kind, "table_unit")
        self.assertEqual(sources[0].content_role, "table_fact")

    def test_backend_expands_named_curriculum_document_support_with_same_doc_chunks(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.get_aliases = Mock(return_value=type("Aliases", (), {"aliases": []})())
        qdrant_client.query_points = Mock(
            side_effect=[
                qdrant_models.QueryResponse(
                    points=[
                        qdrant_models.ScoredPoint(
                            id="point-intro",
                            version=0,
                            score=0.49,
                            payload={
                                "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:ethnology-second-degree",
                                "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "民族学本科第二学士学位人才培养方案",
                                        "一、培养目标",
                                    ]
                                },
                                "text": "民族学本科第二学士学位人才培养方案 一、培养目标。",
                            },
                        ),
                        qdrant_models.ScoredPoint(
                            id="point-other",
                            version=0,
                            score=0.82,
                            payload={
                                "document_id": "curriculum:教育学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:education-second-degree",
                                "chunk_id": "curriculum:教育学本科第二学士学位人才培养方案:chunk-0005",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/education-second-degree",
                                "canonical_url": "https://campus.example/curriculum/education-second-degree",
                                "latest_url": "https://campus.example/curriculum/education-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "教育学本科第二学士学位人才培养方案",
                                        "三、学制、总学分和学位授予",
                                    ]
                                },
                                "text": "三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                            },
                        ),
                    ]
                ),
                qdrant_models.QueryResponse(
                    points=[
                        qdrant_models.ScoredPoint(
                            id="point-intro",
                            version=0,
                            score=0.49,
                            payload={
                                "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:ethnology-second-degree",
                                "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "民族学本科第二学士学位人才培养方案",
                                        "一、培养目标",
                                    ]
                                },
                                "text": "民族学本科第二学士学位人才培养方案 一、培养目标。",
                            },
                        ),
                        qdrant_models.ScoredPoint(
                            id="point-years",
                            version=0,
                            score=0.47,
                            payload={
                                "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:ethnology-second-degree",
                                "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "民族学本科第二学士学位人才培养方案",
                                        "五、学制 两年",
                                    ]
                                },
                                "text": "五、学制 两年",
                            },
                        ),
                    ]
                ),
            ]
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(
            [source.chunk_id for source in result.sources[:2]],
            [
                "curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
            ],
        )
        self.assertEqual(qdrant_client.query_points.call_count, 2)

    def test_backend_supplements_curriculum_semester_followup_with_same_doc_semester_chunks(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-full", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-history-0010",
                        version=0,
                        score=0.51,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(一)大类培养",
                                    "1. 通识教育",
                                ]
                            },
                            "text": (
                                "历史学（强基计划）本科人才培养方案\n"
                                "五、课程设置和修读建议\n"
                                "课程清单如下:\n"
                                "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                                "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                                "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                            ),
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-history-0010",
                        version=0,
                        score=0.49,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(一)大类培养",
                                    "1. 通识教育",
                                ]
                            },
                            "text": (
                                "历史学（强基计划）本科人才培养方案\n"
                                "五、课程设置和修读建议\n"
                                "课程清单如下:\n"
                                "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                                "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                                "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                            ),
                        },
                    ),
                ]
            ),
        )
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="point-history-0010",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(一)大类培养",
                                "1. 通识教育",
                            ]
                        },
                        "text": (
                            "历史学（强基计划）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                            "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                        ),
                    },
                ),
                qdrant_models.Record(
                    id="point-history-0014",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "1. 专业核心课程",
                            ]
                        },
                        "text": (
                            "历史学（强基计划）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业核心课 | 1038030008 | 中国近代边疆民族史料研读 | 2 | 36 | / | 4\n"
                            "专业核心课 | 1038030011 | 世界现当代史 | 3 | 54 | / | 4\n"
                            "专业核心课 | 1038030012 | 中国史学史 | 2 | 36 | / | 5"
                        ),
                    },
                ),
            ],
            None,
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="历史学（强基计划）本科人才培养方案里第四学期有什么课",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(qdrant_client.query_points.call_count, 2)
        qdrant_client.scroll.assert_called_once()
        scroll_filter = qdrant_client.scroll.call_args.kwargs["scroll_filter"]
        document_conditions = [
            condition
            for condition in scroll_filter.must or ()
            if getattr(condition, "key", None) == "document_id"
        ]
        self.assertEqual(len(document_conditions), 1)
        self.assertEqual(
            getattr(getattr(document_conditions[0], "match", None), "value", None),
            "curriculum:历史学（强基计划）本科人才培养方案",
        )
        self.assertIn(
            "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
            tuple(source.chunk_id for source in result.sources),
        )
        self.assertIn(
            "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            tuple(source.chunk_id for source in result.sources),
        )

    def test_backend_targeted_overfetch_strategy_avoids_followup_support_query(self) -> None:
        embedding_model = Mock()
        embedding_model.get_query_embedding.return_value = (0.1, 0.2, 0.3)
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.return_value = "sparse-targeted"
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="point-law-0010",
                    version=0,
                    score=0.61,
                    payload={
                        "document_id": "curriculum:法学（民族实验班）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:law-ethnic-class",
                        "chunk_id": "curriculum:法学（民族实验班）本科人才培养方案:chunk-0010",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/law-ethnic-class",
                        "canonical_url": "https://campus.example/curriculum/law-ethnic-class",
                        "latest_url": "https://campus.example/curriculum/law-ethnic-class",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "法学（民族实验班）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "1. 专业核心课程",
                            ]
                        },
                        "text": (
                            "法学（民族实验班）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业核心课 | 1038030011 | 宪法学 | 3 | 54 | / | 4"
                        ),
                    },
                ),
                qdrant_models.ScoredPoint(
                    id="point-law-0014",
                    version=0,
                    score=0.6,
                    payload={
                        "document_id": "curriculum:法学（民族实验班）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:law-ethnic-class",
                        "chunk_id": "curriculum:法学（民族实验班）本科人才培养方案:chunk-0014",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/law-ethnic-class",
                        "canonical_url": "https://campus.example/curriculum/law-ethnic-class",
                        "latest_url": "https://campus.example/curriculum/law-ethnic-class",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "法学（民族实验班）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "2. 专业选修课程",
                            ]
                        },
                        "text": (
                            "法学（民族实验班）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业选修课 | 1038030012 | 刑法学 | 3 | 54 | / | 4"
                        ),
                    },
                ),
            ]
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=_make_runtime_profile(
                corpus="curriculum",
                collection="curriculum_plan",
                retrieval_top_k=5,
                current_only=False,
                serving_revision_tracks=("source-faithful",),
                document_support_limit=24,
                document_support_strategy="targeted_overfetch",
            ),
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="法学民族班培养方案里大二下有什么课？",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    target_document_ids=("curriculum:法学（民族实验班）本科人才培养方案",),
                    top_k=5,
                )
            )

        self.assertEqual(qdrant_client.query_points.call_count, 1)
        qdrant_client.scroll.assert_not_called()
        self.assertEqual(qdrant_client.query_points.call_args.kwargs["limit"], 24)
        self.assertEqual(
            tuple(source.chunk_id for source in result.sources),
            (
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0010",
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0014",
            ),
        )

    def test_backend_targeted_overfetch_curriculum_title_target_query_recovers_same_doc_support_when_initial_results_are_too_narrow(
        self,
    ) -> None:
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-initial", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-map-0023",
                        version=0,
                        score=0.63,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0023",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "六、课程地图",
                                ]
                            },
                            "detail_label": "六、课程地图",
                            "content_kind": "section_text",
                            "content_role": "lead_overview",
                            "is_answer_bearing": True,
                            "text": "六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-map-0023",
                        version=0,
                        score=0.63,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0023",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "六、课程地图",
                                ]
                            },
                            "detail_label": "六、课程地图",
                            "content_kind": "section_text",
                            "content_role": "lead_overview",
                            "is_answer_bearing": True,
                            "text": "六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="point-core-0013",
                        version=0,
                        score=0.6,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0013",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(二) 专业教育",
                                    "1. 专业核心课程",
                                ]
                            },
                            "detail_label": "1. 专业核心课程",
                            "content_kind": "table_unit",
                            "content_role": "table_fact",
                            "is_answer_bearing": True,
                            "text": (
                                "五、课程设置和修读建议\n"
                                "(二) 专业教育\n"
                                "1. 专业核心课程\n"
                                "专业核心课程 30 学分。\n"
                                "课程清单如下:\n"
                                "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                                "1034040237 | 中级宏观经济学 | 3 | 54 | / | 4"
                            ),
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="point-elective-0014",
                        version=0,
                        score=0.59,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0014",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(二) 专业教育",
                                    "2. 专业选修课程",
                                ]
                            },
                            "detail_label": "2. 专业选修课程",
                            "content_kind": "table_unit",
                            "content_role": "table_fact",
                            "is_answer_bearing": True,
                            "text": (
                                "五、课程设置和修读建议\n"
                                "(二) 专业教育\n"
                                "2. 专业选修课程\n"
                                "专业选修课程至少任选 7 门课程,完成 14 学分。"
                            ),
                        },
                    ),
                ]
            ),
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=_make_runtime_profile(
                corpus="curriculum",
                collection="curriculum_plan",
                retrieval_top_k=5,
                current_only=False,
                serving_revision_tracks=("source-faithful",),
                document_support_limit=24,
                document_support_strategy="targeted_overfetch",
            ),
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    target_document_ids=("curriculum:经济学拔尖人才创新班人才培养方案",),
                    top_k=5,
                )
            )

        self.assertEqual(qdrant_client.query_points.call_count, 2)
        self.assertEqual(qdrant_client.query_points.call_args_list[0].kwargs["limit"], 24)
        self.assertEqual(qdrant_client.query_points.call_args_list[1].kwargs["limit"], 24)
        self.assertEqual(embedding_model.get_query_embedding.call_count, 2)
        self.assertEqual(sparse_embedding_model.build_query.call_count, 2)
        self.assertEqual(
            tuple(source.chunk_id for source in result.sources),
            (
                "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0023",
                "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0013",
                "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0014",
            ),
        )

    def test_backend_prioritizes_same_doc_course_list_chunks_over_other_semester_tables(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-full", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-history-0032",
                        version=0,
                        score=0.57,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0032",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "七、其他说明",
                                ],
                                "table_group_id": "page-0158-block-3-0001",
                            },
                            "text": "七、其他说明\n学期 | 修读学分\n3 | 2\n4 | 4\n5 | 12\n6 | 6",
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="point-history-0025",
                        version=0,
                        score=0.56,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0025",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(四) 实践环节",
                                    "1. 专业实践",
                                ],
                                "table_group_id": "page-0156-block-2-0001",
                            },
                            "text": (
                                "类别 | 学分 | 修读性质 | 学期 | 具体要求\n"
                                "专业实习 | 3 | 必修 | 4-6 | 以实习报告为依据"
                            ),
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(points=[]),
        )
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="point-history-0010",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(一)大类培养",
                                "1. 通识教育",
                            ],
                            "table_group_id": "page-0150-block-6-0007",
                        },
                        "text": (
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                            "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                        ),
                    },
                ),
                qdrant_models.Record(
                    id="point-history-0014",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "1. 专业核心课程",
                            ],
                            "table_group_id": "page-0153-block-5-0002",
                        },
                        "text": (
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业核心课 | 1038030008 | 中国近代边疆民族史料研读 | 2 | 36 | / | 4\n"
                            "专业核心课 | 1038030011 | 世界现当代史 | 3 | 54 | / | 4\n"
                            "专业核心课 | 1038030012 | 中国史学史 | 2 | 36 | / | 5"
                        ),
                    },
                ),
                qdrant_models.Record(
                    id="point-history-0025",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0025",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(四) 实践环节",
                                "1. 专业实践",
                            ],
                            "table_group_id": "page-0156-block-2-0001",
                        },
                        "text": (
                            "类别 | 学分 | 修读性质 | 学期 | 具体要求\n"
                            "专业实习 | 3 | 必修 | 4-6 | 以实习报告为依据"
                        ),
                    },
                ),
            ],
            None,
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="历史学（强基计划）本科人才培养方案里第四学期有什么课",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(
            {source.chunk_id for source in result.sources[:2]},
            {
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            },
        )

    def test_prefer_curriculum_semester_course_list_sources_keeps_core_and_general_sections_in_front(
        self,
    ) -> None:
        reordered = _prefer_curriculum_semester_course_list_sources(
            query_text="历史学（强基计划）本科人才培养方案里第四学期有什么课",
            sources=(
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                        "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "1. 通识教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0011",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "基本素养课 | 1049020004 | 大学体育(四) | 1 | 36 | 36 | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "1. 通识教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0018",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向名称 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "强基班 | 1040040061 | 满族史 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040228 | 满文文献选读 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040239 | 中国传统村落概要 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040160 | 回族史 | 2 | 36 | / | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0019",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向名称 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "强基班 | 1040040140 | 亚太地区史专题 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040227 | 冷战史专题 | 2 | 36 | / | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "1. 专业核心课程\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1040030131 | 中国近代边疆民族史料研读 | 3 | 54 | 6 | 4\n"
                        "1040030127 | 世界现当代史 | 3 | 54 | / | 4\n"
                        "1040030019 | 西方史学史 | 2 | 36 | / | 4\n"
                        "1040030017 | 中国历史地理 | 2 | 36 | 4 | 4\n"
                        "1040030122 | 史学经典研读(三) | 1 | 18 | / | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0013",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "2. 学科基础教育\n\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1040030117 | 人文学科研究方法 | 3 | 54 | / | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "2. 学科基础教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        first_three = tuple(source.chunk_id for source in reordered[:3])
        self.assertIn("curriculum:历史学（强基计划）本科人才培养方案:chunk-0010", first_three)
        self.assertIn("curriculum:历史学（强基计划）本科人才培养方案:chunk-0014", first_three)
        self.assertLess(
            next(
                index
                for index, source in enumerate(reordered)
                if source.chunk_id.endswith("chunk-0014")
            ),
            next(
                index
                for index, source in enumerate(reordered)
                if source.chunk_id.endswith("chunk-0019")
            ),
        )

    def test_no_hit_policy_fail_closes_curriculum_ambiguous_low_score_results(self) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")
        result = _apply_no_hit_policy(
            profile=profile,
            query_text="火星校区飞船停靠规则",
            sources=(
                _make_source(
                    doc_id="curriculum:法学本科人才培养方案",
                    chunk_id="curriculum:law:chunk-0001",
                    snippet="法学本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                _make_source(
                    doc_id="curriculum:美术学类本科人才培养方案",
                    chunk_id="curriculum:fine-arts:chunk-0001",
                    snippet="美术学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
            ),
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_nonexistent_curriculum_program_with_only_boilerplate_matches(
        self,
    ) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="量子飞船驾驶本科人才培养方案",
            sources=(
                _make_source(
                    doc_id="curriculum:美术学类本科人才培养方案",
                    chunk_id="curriculum:fine-arts:chunk-0001",
                    snippet="美术学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                _make_source(
                    doc_id="curriculum:新闻传播学类本科人才培养方案",
                    chunk_id="curriculum:journalism:chunk-0001",
                    snippet="新闻传播学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                _make_source(
                    doc_id="curriculum:设计学类本科人才培养方案",
                    chunk_id="curriculum:design:chunk-0001",
                    snippet="设计学类本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
            ),
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_generic_single_bigram_match_across_tied_candidates(self) -> None:
        profile = load_runtime_profile("regulations", "student_handbook")
        sources = (
            EvidenceSource(
                doc_id="handbook:loan",
                revision_track="source-faithful",
                version_id="v1:loan",
                chunk_id="chunk-loan",
                anchor={},
                canonical_url="https://campus.example/loan",
                latest_url="https://campus.example/loan",
                source_channel="pdf_ocr",
                collection="student_handbook",
                is_current=True,
                snippet="第十条 国家助学贷款还款:办理过国家助学贷款的毕业生于毕业前确认还款手续。",
                score=0.5,
            ),
            EvidenceSource(
                doc_id="handbook:order",
                revision_track="source-faithful",
                version_id="v1:order",
                chunk_id="chunk-order",
                anchor={},
                canonical_url="https://campus.example/order",
                latest_url="https://campus.example/order",
                source_channel="pdf_ocr",
                collection="student_handbook",
                is_current=True,
                snippet="外国人、港澳台人员进入学校进行公务、业务活动应当告知学校。",
                score=0.5,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="校内宇宙签证办理处",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_rejects_live_like_weak_bigram_matches(self) -> None:
        profile = load_runtime_profile("regulations", "student_handbook")
        sources = (
            EvidenceSource(
                doc_id="handbook:discipline",
                revision_track="source-faithful",
                version_id="v1:discipline",
                chunk_id="chunk-discipline",
                anchor={},
                canonical_url="https://campus.example/discipline",
                latest_url="https://campus.example/discipline",
                source_channel="pdf_ocr",
                collection="student_handbook",
                is_current=True,
                snippet=(
                    "被开除学籍的学生由教务处或研究生院出具学习证明,学生须在接到处分决定之日起10日内"
                    "办理完相关手续并离校。逾期不办理离校手续者,学校有关部门注销其在校内的各种关系。"
                ),
                score=0.55263156,
            ),
            EvidenceSource(
                doc_id="handbook:campus-order",
                revision_track="source-faithful",
                version_id="v1:campus-order",
                chunk_id="chunk-campus-order",
                anchor={},
                canonical_url="https://campus.example/campus-order",
                latest_url="https://campus.example/campus-order",
                source_channel="pdf_ocr",
                collection="student_handbook",
                is_current=True,
                snippet="外国人、港澳台人员进入学校应经批准后方可进入学校。",
                score=0.5,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="校内宇宙签证办理处",
            sources=sources,
        )

        self.assertEqual(result, ())

    def test_no_hit_policy_accepts_tied_candidates_when_strong_phrase_support_exists(self) -> None:
        profile = load_runtime_profile("regulations", "student_handbook")
        sources = (
            EvidenceSource(
                doc_id="handbook:student-card",
                revision_track="source-faithful",
                version_id="v1:student-card",
                chunk_id="chunk-card",
                anchor={},
                canonical_url="https://campus.example/student-card",
                latest_url="https://campus.example/student-card",
                source_channel="pdf_ocr",
                collection="student_handbook",
                is_current=True,
                snippet="学生证丢失后，应持本人书面申请和相关证明材料到学生处办理补发手续。",
                score=0.5,
            ),
            EvidenceSource(
                doc_id="handbook:other",
                revision_track="source-faithful",
                version_id="v1:other",
                chunk_id="chunk-other",
                anchor={},
                canonical_url="https://campus.example/other",
                latest_url="https://campus.example/other",
                source_channel="pdf_ocr",
                collection="student_handbook",
                is_current=True,
                snippet="其他规定文本。",
                score=0.5,
            ),
        )

        result = _apply_no_hit_policy(
            profile=profile,
            query_text="学生证丢了怎么办",
            sources=sources,
        )

        self.assertEqual(result, sources)

    def test_backend_maps_qdrant_errors(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        record = _make_registry_record(
            document_id="handbook:error-case",
            version_id="v1:error-case",
            entitlement_groups=("students",),
        )
        registry.upsert(record)
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=QdrantClient(location=":memory:"),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Library hours are from 08:00 to 22:00.",
            ),
            chunk_profile=ChunkProfile(chunk_size=128, chunk_overlap=16),
            embedding_model=embedding_model,
        )
        index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=backend.qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )
        backend.qdrant_client.query_points = Mock(side_effect=RuntimeError("boom"))  # type: ignore[method-assign]

        with self.assertRaises(RetrievalBackendError):
            backend.retrieve(
                RetrievalRequest(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                    authorized_filter=_authorized_filter(),
                )
            )

    def test_backend_builds_registry_from_database_url_when_not_injected(self) -> None:
        with patch(
            "campus_retrieval_core.backend_qdrant.build_document_registry_from_env"
        ) as builder:
            builder.return_value = InMemoryDocumentRegistry()

            backend = QdrantRetrievalBackend(
                settings=RetrievalSettings(
                    qdrant_url=":memory:",
                    document_registry_database_url="postgresql://registry.example/postgres",
                    embedding_model="mock-embedding-8d",
                ),
                qdrant_client=QdrantClient(location=":memory:"),
                embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            )

            builder.assert_called_once_with(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )
            self.assertIsNotNone(backend.registry)


if __name__ == "__main__":
    unittest.main()
