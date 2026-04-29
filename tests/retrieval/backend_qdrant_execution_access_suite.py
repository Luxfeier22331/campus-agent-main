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
    patch,
    qdrant_models,
    unittest,
)


class BackendQdrantExecutionAccessTest(unittest.TestCase):
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
                collection="student_rules",
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
                collection="student_rules",
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
                collection="student_rules",
                authorized_filter=_authorized_filter(),
            )
        )

        self.assertEqual(
            result,
            EvidenceBundle(
                query_text="unknown question",
                corpus="regulations",
                collection="student_rules",
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
                                    "collection": "student_rules",
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
                                    "collection": "student_rules",
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
                collection="student_rules",
                authorized_filter=_authorized_filter(),
                top_k=5,
            )
        )

        self.assertEqual(
            result,
            EvidenceBundle(
                query_text="校内宇宙签证办理处",
                corpus="regulations",
                collection="student_rules",
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
