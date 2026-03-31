from __future__ import annotations

from pathlib import Path
import unittest
import uuid
from unittest.mock import Mock, patch

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle, EvidenceSource, PersonalizationHint
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
    RetrievalBackendError,
    _apply_no_hit_policy,
    _build_document_support_query_text,
    _build_hybrid_prefetch,
    _build_qdrant_filter,
    _build_rrf_query,
    _build_qdrant_client,
    _build_metadata_filters,
)
from campus_retrieval_core.evidence_ranking import prioritize_evidence_sources
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import (
    RetrievalSettings,
)
from llama_index.core.schema import TextNode
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import ResponseHandlingException
from qdrant_client.http import models as qdrant_models
from tests.support.in_memory_registry import InMemoryDocumentRegistry

STUDENT_HANDBOOK_QDRANT_COLLECTION = (
    load_runtime_profile("regulations", "student_handbook").qdrant_index_binding.alias_name
)


def _make_source(
    *,
    doc_id: str,
    chunk_id: str,
    snippet: str,
    score: float,
    collection: str = "curriculum_plan",
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
        acl_level="public",
        canonical_url=f"https://campus.example/{chunk_id}",
        latest_url=f"https://campus.example/{chunk_id}",
        source_channel="pdf_ocr",
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


def _make_runtime_profile(
    *,
    corpus: str = "regulations",
    collection: str = "student_handbook",
    retrieval_top_k: int = 8,
    current_only: bool = True,
    serving_revision_tracks: tuple[str, ...] = ("current-effective", "source-faithful"),
    dense_prefetch_limit: int = 20,
    sparse_prefetch_limit: int = 20,
    rrf_k: int = 60,
    rrf_dense_weight: float = 1.0,
    rrf_sparse_weight: float = 1.0,
    document_support_limit: int = 24,
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
        retrieval_top_k=retrieval_top_k,
        current_only=current_only,
        serving_revision_tracks=serving_revision_tracks,
        dense_prefetch_limit=dense_prefetch_limit,
        sparse_prefetch_limit=sparse_prefetch_limit,
        rrf_k=rrf_k,
        rrf_dense_weight=rrf_dense_weight,
        rrf_sparse_weight=rrf_sparse_weight,
        document_support_limit=document_support_limit,
        embedding_query_instruction=embedding_query_instruction,
        no_hit_min_top_score=0.6,
        no_hit_min_score_gap=0.1,
        qdrant_index_binding=QdrantIndexBinding(alias_name=collection, collection_prefix=collection),
    )


def _make_registry_record(
    *,
    document_id: str,
    version_id: str,
    acl_groups: tuple[str, ...],
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
        acl_groups=acl_groups,
        campus_scope=None,
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
        f'"acl":{{"level":"public","allow_groups":[]}}}}'
        .replace("'", '"')
        .encode("utf-8")
    )


def _make_structured_jsonl_with_acl(
    *,
    document_id: str,
    version_id: str,
    text: str,
    acl_level: str,
) -> bytes:
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"acl":{{"level":"{acl_level}","allow_groups":[]}}}}'
        .replace("'", '"')
        .encode("utf-8")
    )


def _make_structured_jsonl_with_acl_groups(
    *,
    document_id: str,
    version_id: str,
    text: str,
    acl_level: str,
    acl_groups: tuple[str, ...],
) -> bytes:
    allow_groups = ",".join(f'"{group}"' for group in acl_groups)
    return (
        f'{{"doc_id":"{document_id}","version_id":"{version_id}","chunk_id":"legacy-{document_id}",'
        f'"clean_text":{text!r},"anchor":{{"section_path":["Student Handbook","Library"],"page_start":5,"page_end":5}},'
        f'"acl":{{"level":"{acl_level}","allow_groups":[{allow_groups}]}}}}'
        .replace("'", '"')
        .encode("utf-8")
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
    def test_build_metadata_filters_treats_public_acl_as_public_level(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                acl_groups=("students",),
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
        acl_filter = filters.filters[4]
        self.assertEqual(acl_filter.condition.value, "or")
        auth_keys = _collect_filter_keys(acl_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertIn("acl_level", auth_keys)
        self.assertIn("acl_groups", auth_keys)

    def test_build_metadata_filters_ignore_personalization_hint_for_acl_and_serving_scope(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="保研流程",
                corpus="regulations",
                collection="student_handbook",
                acl_groups=("students",),
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
        acl_filter = filters.filters[4]
        self.assertEqual(acl_filter.condition.value, "or")
        auth_keys = _collect_filter_keys(acl_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)

    def test_build_metadata_filters_prefers_authorized_filter_over_legacy_fields(self) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                campus_scope="legacy-campus",
                acl_groups=("legacy-group",),
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("students",),
                    visibility_level="public",
                    acl_groups=("students",),
                    visibility_scope="north",
                    campus_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        acl_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(acl_filter)
        self.assertIn("entitlement_groups", auth_keys)
        campus_filter = filters.filters[5]
        scope_keys = _collect_filter_keys(campus_filter)
        self.assertIn("visibility_scope", scope_keys)
        self.assertIn("campus_scope", scope_keys)

    def test_build_metadata_filters_uses_projection_payload_keys_before_legacy_carriers(self) -> None:
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
        scope_filter = filters.filters[5]
        scope_keys = _collect_filter_keys(scope_filter)

        self.assertIn("visibility_level", auth_keys)
        self.assertIn("entitlement_groups", auth_keys)
        self.assertIn("visibility_scope", scope_keys)

    def test_build_metadata_filters_omit_entitlement_group_predicates_when_authorized_filter_has_no_acl_groups(
        self,
    ) -> None:
        filters = _build_metadata_filters(
            RetrievalRequest(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                acl_groups=("students",),
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=(),
                    visibility_level="public",
                    acl_groups=(),
                    visibility_scope="north",
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        acl_filter = filters.filters[4]
        auth_keys = _collect_filter_keys(acl_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("acl_level", auth_keys)
        self.assertNotIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_build_qdrant_filter_omits_entitlement_group_predicates_when_authorized_filter_has_no_acl_groups(
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
                    acl_groups=(),
                    policy_projection_version="phase1-authorization-projection-v1",
                ),
            )
        )

        auth_filter = qdrant_filter.must[3]
        auth_keys = _collect_qdrant_filter_keys(auth_filter)
        self.assertIn("visibility_level", auth_keys)
        self.assertIn("acl_level", auth_keys)
        self.assertNotIn("entitlement_groups", auth_keys)
        self.assertNotIn("acl_groups", auth_keys)

    def test_index_chunks_to_qdrant_skips_payload_indexes_for_local_backend(self) -> None:
        record = _make_registry_record(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            acl_groups=("students",),
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
        qdrant_client.create_payload_index = Mock(side_effect=AssertionError("should not be called"))  # type: ignore[method-assign]

        ids = index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=qdrant_client,
            collection_name=STUDENT_HANDBOOK_QDRANT_COLLECTION,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        self.assertEqual(len(ids), 1)

    def test_index_chunks_to_qdrant_creates_named_dense_and_sparse_vectors_for_remote_backend(self) -> None:
        record = _make_registry_record(
            document_id="handbook:test-remote",
            version_id="v1:test-remote",
            acl_groups=("students",),
        )
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=_make_structured_jsonl(
                document_id=record.document_id,
                version_id=record.version_id,
                text="Remote qdrant indexing should create acl_level payload indexes.",
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
        indexed_fields = [call.kwargs["field_name"] for call in qdrant_client.create_payload_index.call_args_list]
        self.assertEqual(
            indexed_fields,
            [
                "document_id",
                "revision_track",
                "version_id",
                "corpus",
                "collection",
                "visibility_scope",
                "entitlement_groups",
                "visibility_level",
                "policy_projection_version",
                "campus_scope",
                "acl_groups",
                "acl_level",
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

        self.assertEqual(settings.document_registry_database_url, "postgresql://shared.example/postgres")

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

            def build_document(self, text: str) -> qdrant_models.Document | qdrant_models.SparseVector:
                raise AssertionError("document embedding should not be used during retrieval query prefetch")

            def build_query(self, text: str) -> qdrant_models.Document | qdrant_models.SparseVector | None:
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
                acl_groups=("students",),
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
                and getattr(getattr(condition, "match", None), "any", None) == ["current-effective", "source-faithful"]
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
            acl_groups=("students",),
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

        with patch("campus_retrieval_core.backend_qdrant.QdrantClient", return_value=fake_client) as client_ctor:
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
        qdrant_client.get_aliases = Mock(side_effect=AssertionError("alias listing should not be called"))
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
                acl_groups=("students",),
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
            acl_groups=("students",),
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
                ResponseHandlingException(RuntimeError("_ssl.c:983: The handshake operation timed out")),
                ResponseHandlingException(RuntimeError("_ssl.c:983: The handshake operation timed out")),
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
                acl_groups=("students",),
                top_k=5,
            )
        )

        self.assertEqual(result.sources, ())
        self.assertEqual(qdrant_client.collection_exists.call_count, 3)
        qdrant_client.query_points.assert_called_once()

    def test_backend_returns_evidence_bundle_with_source_locator(self) -> None:
        registry = InMemoryDocumentRegistry()
        record = _make_registry_record(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            acl_groups=("students",),
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
                acl_groups=("students",),
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
            acl_groups=("students",),
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
                                    "acl_level": "public",
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
                acl_groups=("students",),
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
            acl_groups=("students",),
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
                acl_groups=("students",),
            )
        )

        self.assertEqual(result.sources, ())

    def test_backend_uses_payload_urls_when_evidence_payload_is_complete(self) -> None:
        registry = InMemoryDocumentRegistry()
        record = _make_registry_record(
            document_id="handbook:payload-complete",
            version_id="v1:payload-complete",
            acl_groups=("students",),
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
                                    "acl_level": "public",
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
                acl_groups=("students",),
            )
        )

        self.assertEqual(len(result.sources), 1)
        source = result.sources[0]
        self.assertEqual(source.doc_id, "handbook:payload-complete")
        self.assertTrue(source.is_current)
        self.assertEqual(source.canonical_url, "https://payload.example/should-not-win")
        self.assertEqual(source.latest_url, "https://payload.example/should-not-win")

    def test_backend_applies_acl_filter_before_returning_sources(self) -> None:
        registry = InMemoryDocumentRegistry()
        allowed = _make_registry_record(
            document_id="handbook:students",
            version_id="v1:students",
            acl_groups=("students",),
        )
        blocked = _make_registry_record(
            document_id="handbook:staff",
            version_id="v1:staff",
            acl_groups=("staff",),
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
            structured_jsonl_bytes=_make_structured_jsonl_with_acl(
                document_id=blocked.document_id,
                version_id=blocked.version_id,
                text="Staff office hours are private.",
                acl_level="restricted",
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
                acl_groups=("students",),
                top_k=5,
            )
        )

        self.assertEqual([source.doc_id for source in result.sources], ["handbook:students"])

    def test_backend_fail_closes_when_document_has_acl_groups_even_if_structured_acl_level_is_public(self) -> None:
        registry = InMemoryDocumentRegistry()
        restricted = _make_registry_record(
            document_id="handbook:staff-only",
            version_id="v1:staff-only",
            acl_groups=("staff",),
        )
        registry.upsert(restricted)

        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        restricted_chunks = build_indexable_chunks_from_jsonl(
            record=restricted,
            structured_jsonl_bytes=_make_structured_jsonl_with_acl_groups(
                document_id=restricted.document_id,
                version_id=restricted.version_id,
                text="Staff office hours are private.",
                acl_level="public",
                acl_groups=("staff",),
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
                acl_groups=("students",),
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
                acl_groups=("students",),
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
                                    "acl_level": "public",
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
                                    "acl_level": "public",
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
                acl_groups=("students",),
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

    def test_prioritize_evidence_sources_prefers_exact_curriculum_title_over_longer_superset(self) -> None:
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

    def test_prioritize_evidence_sources_prefers_curriculum_fact_chunk_for_short_fact_query(self) -> None:
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

    def test_prioritize_evidence_sources_prefers_named_curriculum_document_over_other_docs_fact_chunks(self) -> None:
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

    def test_prioritize_evidence_sources_prefers_same_document_academic_years_chunk_over_generic_tables(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0007",
                    snippet="七、各教学环节学时学分分配表 合计 56 学分。",
                    score=0.015873017,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=("民族学本科第二学士学位人才培养方案", "七、各教学环节学时学分分配表"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0010",
                    snippet="八、民族学本科专业教学进程计划表 社会研究方法。",
                    score=0.014925373,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=("民族学本科第二学士学位人才培养方案", "八、民族学本科专业教学进程计划表"),
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

    def test_prioritize_evidence_sources_prefers_same_document_course_map_chunk_over_generic_tables(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            sources=(
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0013",
                    snippet="五、课程设置和修读建议 1. 专业核心课程 经济学说史。",
                    score=0.032002047,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "五、课程设置和修读建议", "(二) 专业教育", "1. 专业核心课程"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 中国近现代经济史。",
                    score=0.031257633,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "五、课程设置和修读建议", "(二) 专业教育", "2. 专业选修课程"),
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

    def test_expand_named_document_support_uses_focused_query_for_same_document_followup(self) -> None:
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
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(aliases=[])
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
                            "acl_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {"section_path": ["民族学本科第二学士学位人才培养方案", "一、培养目标"]},
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
                            "acl_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {"section_path": ["民族学本科第二学士学位人才培养方案", "五、学制 两年"]},
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

    def test_prioritize_evidence_sources_uses_explicit_source_title_when_doc_ids_are_opaque(self) -> None:
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

    def test_prioritize_evidence_sources_prefers_answer_bearing_procedure_chunk_over_closing_provision(self) -> None:
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

    def test_prioritize_evidence_sources_uses_content_role_to_demote_explanatory_background_chunks(self) -> None:
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
                        "acl_level": "public",
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
                                "acl_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {"section_path": ["民族学本科第二学士学位人才培养方案", "一、培养目标"]},
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
                                "acl_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/education-second-degree",
                                "canonical_url": "https://campus.example/curriculum/education-second-degree",
                                "latest_url": "https://campus.example/curriculum/education-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {"section_path": ["教育学本科第二学士学位人才培养方案", "三、学制、总学分和学位授予"]},
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
                                "acl_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {"section_path": ["民族学本科第二学士学位人才培养方案", "一、培养目标"]},
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
                                "acl_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {"section_path": ["民族学本科第二学士学位人才培养方案", "五、学制 两年"]},
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

    def test_no_hit_policy_rejects_nonexistent_curriculum_program_with_only_boilerplate_matches(self) -> None:
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
                acl_level="public",
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
                acl_level="public",
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
                acl_level="public",
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
                acl_level="public",
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
                acl_level="public",
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
                acl_level="public",
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
            acl_groups=("students",),
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
                    acl_groups=("students",),
                )
            )

    def test_backend_builds_registry_from_database_url_when_not_injected(self) -> None:
        with patch("campus_retrieval_core.backend_qdrant.build_document_registry_from_env") as builder:
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
