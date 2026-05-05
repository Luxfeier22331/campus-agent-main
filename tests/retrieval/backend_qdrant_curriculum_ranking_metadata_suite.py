from __future__ import annotations

from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantRetrievalBackend,
    RetrievalSettings,
    _make_source,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    prioritize_evidence_sources,
    qdrant_models,
    unittest,
)


class BackendQdrantCurriculumRankingMetadataTest(unittest.TestCase):
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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

        sources = build_evidence_sources(
            backend,
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
                        "collection": "student_rules",
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
            ),
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].source_title, "中央民族大学学生证管理办法")
        self.assertEqual(sources[0].structural_path, ("第三章 学籍管理", "学生证管理"))
        self.assertEqual(sources[0].content_kind, "article_body")
        self.assertEqual(sources[0].content_role, "procedure")
        self.assertEqual(sources[0].detail_label, "第十二条")
        self.assertTrue(sources[0].is_answer_bearing)

    def test_build_evidence_sources_recovers_legacy_policy_page_body_from_preface_text(
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

        sources = build_evidence_sources(
            backend,
            (
                qdrant_models.ScoredPoint(
                    id="point-student-card-closing",
                    version=0,
                    score=0.77,
                    payload={
                        "document_id": "handbook:student-card",
                        "revision_track": "source-faithful",
                        "version_id": "v1:student-card",
                        "chunk_id": "student-card-closing",
                        "collection": "student_rules",
                        "visibility_level": "public",
                        "canonical_url": "https://campus.example/handbook/student-card",
                        "latest_url": "https://campus.example/handbook/student-card",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "title": "中央民族大学本科(预科)学生证管理办法",
                        "unit_type": "policy_page",
                        "content_role": "closing_provision",
                        "anchor": {"section_path": ["十八、附则"]},
                        "display_text": "十八、本办法由学生处负责解释。",
                        "preface_text": (
                            "六、学生如将学生证遗失或损坏，应及时挂失。"
                            "七、申请补办学生证应提交书面申请。"
                            "八、每周四下午办理补办手续。"
                        ),
                    },
                ),
            ),
        )

        self.assertEqual(len(sources), 1)
        self.assertIn("学生证遗失", sources[0].snippet)
        self.assertIn("补办手续", sources[0].snippet)
        self.assertNotIn("本办法由学生处负责解释", sources[0].snippet)
        self.assertEqual(sources[0].content_kind, "policy_page")
        self.assertEqual(sources[0].content_role, "procedure")
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

        sources = build_evidence_sources(
            backend,
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
            ),
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

        sources = build_evidence_sources(
            backend,
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
            ),
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].content_kind, "table_unit")
        self.assertEqual(sources[0].content_role, "table_fact")
