from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    TextNode,
    _make_runtime_profile,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    patch,
    qdrant_models,
    unittest,
)


class BackendQdrantExecutionTitleTargetTest(unittest.TestCase):
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
