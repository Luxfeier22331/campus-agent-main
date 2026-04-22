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
    _make_runtime_profile,
    _make_structured_jsonl,
    _make_structured_jsonl_with_entitlement_groups,
    _make_structured_jsonl_with_visibility_level,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    index_chunks_to_qdrant,
    load_runtime_profile,
    patch,
    qdrant_models,
    unittest,
)


class BackendQdrantExecutionTest(unittest.TestCase):
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
