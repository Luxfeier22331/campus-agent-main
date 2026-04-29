from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    _make_runtime_profile,
    patch,
    qdrant_models,
    unittest,
)


class BackendQdrantCurriculumRankingBackendOverfetchTest(unittest.TestCase):
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
