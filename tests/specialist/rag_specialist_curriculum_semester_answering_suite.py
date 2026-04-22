from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagAgent,
    RagRequestPayload,
    SpecialistRequest,
    build_curriculum_program_semester_fact_document_id,
    delegate_to_rag_agent,
    unittest,
)


class RagSpecialistCurriculumSemesterAnsweringTest(unittest.TestCase):
    def test_curriculum_completed_answer_uses_direct_fact_sentence_without_curriculum_prefix(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:test-curriculum",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 65, "page_end": 65},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 / 五、学制 两年。",
                    score=0.83,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:test-curriculum",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0002",
                    anchor={"page_start": 66, "page_end": 66},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 / 八、教学进程计划表。",
                    score=0.79,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族学本科人才培养方案学制几年？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertNotIn("根据培养方案相关内容", response.answer_text)
        self.assertIn("学制", response.answer_text)
        self.assertIn("两年", response.answer_text)
        self.assertNotIn("学生手册", response.answer_text)

    def test_curriculum_table_semester_query_accepts_numeric_semester_columns(self) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第一学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-intro",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 147, "page_end": 147},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="法学（民族实验班）本科人才培养方案 法学专业 1979 年开始招生。",
                    score=0.99,
                    source_title="法学（民族实验班）本科人才培养方案",
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-1",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0002",
                    anchor={"page_start": 150, "page_end": 150},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "2. 学科基础教育\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "民族班 | 1036030166 | 习近平法治思想概论 | 2 | 36 | / | 1\n"
                        "民族班 | 1036030001 | 法学导论 | 2 | 36 | / | 1"
                    ),
                    score=0.97,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "法学（民族实验班）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0003",
                    anchor={"page_start": 153, "page_end": 153},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4"
                    ),
                    score=0.96,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "法学（民族实验班）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="法学民族实验班培养方案里第一学期有什么课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("习近平法治思想概论", response.answer_text)
        self.assertIn("法学导论", response.answer_text)
        self.assertNotIn("侵权责任法", response.answer_text)

    def test_curriculum_time_answer_prefers_direct_academic_year_statement(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-years",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                    anchor={"page_start": 5, "page_end": 5},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="五、学制 两年",
                    score=0.35,
                    source_title="民族学本科第二学士学位人才培养方案",
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-table",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0009",
                    anchor={"page_start": 668, "page_end": 669},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "八、民族学本科专业教学进程计划表\n\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 学时 | — | 各学期周学时分配\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 总计 | 其中实践 | 1 | 2 | 3 | 4\n"
                        "专业教育 | 专业必修课共30学分 | 1026030031 | 民族学导论 | 2 | 36 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030067 | 人类学导论 | 2 | 36 | — | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030047 | 民族学人类学经典导读 | 2 | 36 | — | — | — | 2"
                    ),
                    score=0.48,
                    source_title="民族学本科第二学士学位人才培养方案",
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertEqual(
            [source.chunk_id for source in draft.supporting_sources],
            ["curriculum:民族学本科第二学士学位人才培养方案:chunk-0005"],
        )
        self.assertIn("两年", draft.answer_text)
        self.assertNotIn("民族学导论", draft.answer_text)

    def test_curriculum_semester_answer_filters_other_semester_rows_within_same_source(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-mixed",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0016",
                    anchor={"page_start": 153, "page_end": 153},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040243 | 法学论文写作(初阶) | 2 | 36 | / | 1\n"
                        "民族班 | 1036040003 | 中国法律思想史 | 2 | 36 | / | 2\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040205 | 消费者权益保护法 | 2 | 36 | / | 5"
                    ),
                    score=0.97,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "法学（民族实验班）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("侵权责任法", draft.answer_text)
        self.assertIn("公司法", draft.answer_text)
        self.assertNotIn("法学论文写作(初阶)", draft.answer_text)
        self.assertNotIn("中国法律思想史", draft.answer_text)
        self.assertNotIn("消费者权益保护法", draft.answer_text)

    def test_curriculum_semester_answer_filters_rows_by_numeric_semester_columns(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科第二学士学位人才培养方案里第二学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-semester-mixed",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0009",
                    anchor={"page_start": 668, "page_end": 669},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "八、民族学本科专业教学进程计划表\n\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 学时 | — | 各学期周学时分配\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 总计 | 其中实践 | 1 | 2 | 3 | 4\n"
                        "专业教育 | 专业必修课共30学分 | 1026030031 | 民族学导论 | 2 | 36 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030067 | 人类学导论 | 2 | 36 | — | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030361 | 中国民族志 | 3 | 54 | — | 3\n"
                        "专业教育 | 专业必修课共30学分 | 1026030081 | 民族学田野调查方法 | 2 | 36 | 9 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030047 | 民族学人类学经典导读 | 2 | 36 | — | — | — | 2"
                    ),
                    score=0.95,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=(
                        "民族学本科第二学士学位人才培养方案",
                        "八、民族学本科专业教学进程计划表",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("人类学导论", draft.answer_text)
        self.assertIn("民族学田野调查方法", draft.answer_text)
        self.assertNotIn("民族学导论", draft.answer_text)
        self.assertNotIn("中国民族志", draft.answer_text)

    def test_curriculum_semester_answer_merges_same_semester_rows_across_multiple_sources(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="历史学强基计划培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-general-education",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                    anchor={"page_start": 93, "page_end": 93},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                        "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                    ),
                    score=0.97,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-core-courses",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                    anchor={"page_start": 95, "page_end": 96},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "1. 专业核心课程\n\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1040030131 | 中国近代边疆民族史料研读 | 3 | 54 | 6 | 4\n"
                        "1040030127 | 世界现当代史 | 3 | 54 | / | 4\n"
                        "1040030019 | 西方史学史 | 2 | 36 | / | 4\n"
                        "1040030015 | 中国史学史 | 2 | 36 | / | 5"
                    ),
                    score=0.96,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("大学英语(四)", draft.answer_text)
        self.assertIn("中国近代边疆民族史料研读", draft.answer_text)
        self.assertNotIn("中国史学史", draft.answer_text)
        self.assertEqual(
            {source.chunk_id for source in draft.supporting_sources},
            {
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            },
        )
        self.assertNotIn("民族学人类学经典导读", draft.answer_text)

    def test_curriculum_semester_answer_lists_all_semester_courses_without_table_row_truncation(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4a",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0015",
                    anchor={"page_start": 152, "page_end": 152},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040100 | 合同法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040101 | 人格权法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040102 | 物权法 | 2 | 36 | / | 4"
                    ),
                    score=0.98,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "法学（民族实验班）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4b",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0016",
                    anchor={"page_start": 153, "page_end": 153},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040201 | 翻译学导论 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040202 | 中国少数民族文字学 | 2 | 36 | / | 4"
                    ),
                    score=0.97,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "法学（民族实验班）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("第四学期有", draft.answer_text)
        self.assertIn("合同法", draft.answer_text)
        self.assertIn("侵权责任法", draft.answer_text)
        self.assertIn("中国少数民族文字学", draft.answer_text)
        self.assertNotIn("|", draft.answer_text)
        self.assertEqual(
            {source.chunk_id for source in draft.supporting_sources},
            {
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0015",
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0016",
            },
        )

    def test_curriculum_semester_answer_merges_program_semester_fact_partial_chunks_without_leaking_broken_course_fragments(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="program_semester_facts",
            sources=(
                EvidenceSource(
                    doc_id=build_curriculum_program_semester_fact_document_id(
                        "curriculum:法学（民族实验班）本科人才培养方案",
                        "第四学期",
                    ),
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4-partial-1",
                    chunk_id="program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:chunk-0001",
                    anchor={"fact_type": "semester_course_list"},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="program_semester_facts",
                    is_current=False,
                    snippet=(
                        "按当前已采集的《法学（民族实验班）本科人才培养方案》，第四学期有"
                        "经济学说史、可持续发展经济学、马克思主义哲学原著选读、语言学概论、中国民族史概要(一"
                    ),
                    score=0.98,
                    source_title="法学（民族实验班）本科人才培养方案 第四学期课程事实",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期课程",
                    content_kind="program_semester_fact",
                    content_role="semester_course_list",
                    is_answer_bearing=True,
                    canonical_source_id="curriculum:法学（民族实验班）本科人才培养方案",
                    canonical_source_title="法学（民族实验班）本科人才培养方案",
                    source_unit_kind="semester_course_list",
                    source_unit_key="semester-4",
                ),
                EvidenceSource(
                    doc_id=build_curriculum_program_semester_fact_document_id(
                        "curriculum:法学（民族实验班）本科人才培养方案",
                        "第四学期",
                    ),
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4-partial-2",
                    chunk_id="program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:chunk-0002",
                    anchor={"fact_type": "semester_course_list"},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="program_semester_facts",
                    is_current=False,
                    snippet=(
                        "展经济学、马克思主义哲学原著选读、语言学概论、中国民族史概要(一)、"
                        "中国少数民族民间文学概论、中国民族史。"
                    ),
                    score=0.97,
                    source_title="法学（民族实验班）本科人才培养方案 第四学期课程事实",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期课程",
                    content_kind="program_semester_fact",
                    content_role="semester_course_list",
                    is_answer_bearing=True,
                    canonical_source_id="curriculum:法学（民族实验班）本科人才培养方案",
                    canonical_source_title="法学（民族实验班）本科人才培养方案",
                    source_unit_kind="semester_course_list",
                    source_unit_key="semester-4",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertEqual(
            draft.answer_text,
            (
                "根据培养方案相关内容，第四学期有经济学说史、可持续发展经济学、马克思主义哲学原著选读、"
                "语言学概论、中国民族史概要(一)、中国少数民族民间文学概论、中国民族史。"
            ),
        )
        self.assertNotIn("；展经济学", draft.answer_text)
        self.assertNotIn("中国民族史概要(一；", draft.answer_text)
        self.assertEqual(
            {source.chunk_id for source in draft.supporting_sources},
            {
                "program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:chunk-0001",
                "program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:chunk-0002",
            },
        )
