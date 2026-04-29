from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    STUDENT_HANDBOOK_QDRANT_COLLECTION,
    ChunkProfile,
    EvidenceBundle,
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantClient,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    TextNode,
    _authorized_filter,
    _make_registry_record,
    _make_structured_jsonl,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    index_chunks_to_qdrant,
    load_runtime_profile,
    qdrant_models,
    unittest,
)


class BackendQdrantExecutionBasicsTest(unittest.TestCase):
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
                collection="student_rules",
                authorized_filter=_authorized_filter(),
            )
        )

        self.assertIsInstance(result, EvidenceBundle)
        self.assertEqual(result.corpus, "regulations")
        self.assertEqual(result.collection, "student_rules")
        self.assertEqual(len(result.sources), 1)
        source = result.sources[0]
        self.assertEqual(source.doc_id, "handbook:test-001")
        self.assertEqual(source.revision_track, "source-faithful")
        self.assertEqual(source.version_id, "v1:test-001")
        self.assertEqual(source.source_channel, "pdf_ocr")
        self.assertEqual(source.collection, "student_rules")
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
                                    "collection": "student_rules",
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
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=3,
            )
        )

        self.assertEqual(len(result.sources), 1)
        self.assertEqual(result.sources[0].doc_id, "handbook:hybrid-winner")
        profile = load_runtime_profile("regulations", "student_rules")
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
                collection="student_rules",
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
                                    "collection": "student_rules",
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
                collection="student_rules",
                authorized_filter=_authorized_filter(),
            )
        )

        self.assertEqual(len(result.sources), 1)
        source = result.sources[0]
        self.assertEqual(source.doc_id, "handbook:payload-complete")
        self.assertTrue(source.is_current)
        self.assertEqual(source.canonical_url, "https://payload.example/should-not-win")
        self.assertEqual(source.latest_url, "https://payload.example/should-not-win")
