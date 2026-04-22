from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    _make_source,
    _prefer_curriculum_semester_course_list_sources,
    qdrant_models,
    unittest,
)


class BackendQdrantCurriculumRankingBackendCourseListTest(unittest.TestCase):
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
