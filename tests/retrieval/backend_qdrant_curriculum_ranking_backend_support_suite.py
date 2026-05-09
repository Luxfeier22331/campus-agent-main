from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    AuthorizedRetrievalFilter,
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    qdrant_models,
    unittest,
)


class BackendQdrantCurriculumRankingBackendSupportTest(unittest.TestCase):
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

    def test_backend_rescues_curriculum_title_document_when_initial_candidates_miss_exact_title(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.return_value = (0.1, 0.2, 0.3)
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.return_value = "sparse-social-practice"
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="point-russian",
                    version=0,
                    score=0.72,
                    payload={
                        "document_id": "curriculum:俄语（俄语、中亚语）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:russian",
                        "chunk_id": "curriculum:俄语（俄语、中亚语）本科人才培养方案:chunk-0001",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/russian",
                        "canonical_url": "https://campus.example/curriculum/russian",
                        "latest_url": "https://campus.example/curriculum/russian",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {"section_path": ["俄语（俄语、中亚语）本科人才培养方案"]},
                        "text": "俄语（俄语、中亚语）本科人才培养方案。",
                    },
                ),
            ]
        )
        qdrant_client.scroll.side_effect = (
            (
                [
                    qdrant_models.Record(
                        id="point-social-practice",
                        payload={
                            "document_id": "curriculum:中央民族大学大学生社会实践环节实施方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:social-practice",
                            "chunk_id": "curriculum:中央民族大学大学生社会实践环节实施方案:chunk-0001",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/social-practice",
                            "canonical_url": "https://campus.example/curriculum/social-practice",
                            "latest_url": "https://campus.example/curriculum/social-practice",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {"section_path": ["中央民族大学大学生社会实践环节实施方案"]},
                            "display_text": "中央民族大学大学生社会实践环节实施方案。",
                        },
                    )
                ],
                None,
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

        result = backend.retrieve(
            RetrievalRequest(
                query_text="中央民族大学大学生社会实践环节实施方案",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=3,
            )
        )

        self.assertEqual(
            tuple(source.doc_id for source in result.sources),
            ("curriculum:中央民族大学大学生社会实践环节实施方案",),
        )
        qdrant_client.scroll.assert_called_once()

    def test_backend_rescue_keeps_curriculum_title_scroll_authorized_for_restricted_document(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.return_value = (0.1, 0.2, 0.3)
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.return_value = "sparse-social-practice"
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="point-russian",
                    version=0,
                    score=0.72,
                    payload={
                        "document_id": "curriculum:俄语（俄语、中亚语）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:russian",
                        "chunk_id": "curriculum:俄语（俄语、中亚语）本科人才培养方案:chunk-0001",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/russian",
                        "canonical_url": "https://campus.example/curriculum/russian",
                        "latest_url": "https://campus.example/curriculum/russian",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {"section_path": ["俄语（俄语、中亚语）本科人才培养方案"]},
                        "text": "俄语（俄语、中亚语）本科人才培养方案。",
                    },
                ),
            ]
        )
        qdrant_client.scroll.side_effect = (
            (
                [
                    qdrant_models.Record(
                        id="point-social-practice",
                        payload={
                            "document_id": "curriculum:中央民族大学大学生社会实践环节实施方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:social-practice",
                            "chunk_id": "curriculum:中央民族大学大学生社会实践环节实施方案:chunk-0001",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "restricted",
                            "entitlement_groups": ["campus_members"],
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/social-practice",
                            "canonical_url": "https://campus.example/curriculum/social-practice",
                            "latest_url": "https://campus.example/curriculum/social-practice",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {"section_path": ["中央民族大学大学生社会实践环节实施方案"]},
                            "display_text": "中央民族大学大学生社会实践环节实施方案。",
                        },
                    )
                ],
                None,
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

        result = backend.retrieve(
            RetrievalRequest(
                query_text="中央民族大学大学生社会实践环节实施方案",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=3,
                authorized_filter=AuthorizedRetrievalFilter(
                    entitlement_groups=("campus_members",),
                    visibility_level="restricted",
                    visibility_scope=None,
                ),
            )
        )

        self.assertEqual(
            tuple(source.doc_id for source in result.sources),
            ("curriculum:中央民族大学大学生社会实践环节实施方案",),
        )
        scroll_filter = qdrant_client.scroll.call_args.kwargs["scroll_filter"]
        self.assertEqual(
            {
                condition.key: condition.match.value
                for condition in scroll_filter.must
                if hasattr(condition, "key")
                and hasattr(condition, "match")
                and hasattr(condition.match, "value")
            },
            {
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "status": "active",
                "document_id": "curriculum:中央民族大学大学生社会实践环节实施方案",
            },
        )
        authorization_filter = next(
            condition for condition in scroll_filter.must if hasattr(condition, "should")
        )
        restricted_branch = next(
            branch
            for branch in authorization_filter.should
            if any(
                getattr(item, "key", "") == "visibility_level" and item.match.value == "restricted"
                for item in branch.must
            )
        )
        self.assertTrue(
            any(
                getattr(item, "key", "") == "entitlement_groups"
                and item.match.any == ["campus_members"]
                for item in restricted_branch.must
            )
        )

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
