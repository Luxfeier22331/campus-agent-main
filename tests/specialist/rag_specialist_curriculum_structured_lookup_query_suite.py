from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagAgent,
    RagRequestPayload,
    SpecialistRequest,
    _make_curriculum_plan_source,
    _make_evidence,
    _query_mode,
    delegate_to_rag_agent,
    unittest,
)


class RagSpecialistCurriculumStructuredLookupQueryTest(unittest.TestCase):
    def test_query_mode_routes_curriculum_structure_queries_away_from_procedure(self) -> None:
        for query_text in (
            "经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            "法学民族实验班培养方案课程设置怎么安排",
            "法学民族实验班培养方案修读建议怎么安排",
        ):
            with self.subTest(query_text=query_text):
                self.assertEqual(_query_mode(query_text), "curriculum_lookup")

    def test_curriculum_course_map_answer_fail_closes_without_supporting_sources(self) -> None:
        evidence = EvidenceBundle(
            query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0023",
                    snippet="六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                    score=0.99,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "六、课程地图"),
                    content_kind="section_text",
                    detail_label="六、课程地图",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 中国近现代经济史。",
                    score=0.98,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0015",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 发展经济学专题。",
                    score=0.97,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0013",
                    snippet="五、课程设置和修读建议 1. 专业核心课程 专业核心课程 30 学分。",
                    score=0.96,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertEqual(draft.supporting_sources, ())
        self.assertEqual(draft.supporting_contexts, ())
        self.assertEqual(draft.answer_text, "")

    def test_curriculum_generic_degree_question_uses_curriculum_specific_clarification(
        self,
    ) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学位怎么授予？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("培养方案", response.follow_up_question)
        self.assertNotIn("学生手册", response.follow_up_question)

    def test_curriculum_short_fact_answer_reorders_supporting_sources_before_confidence(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-intro",
                    chunk_id="curriculum:法学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/law",
                    latest_url="https://campus.example/curriculum/law",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="法学本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-intro",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 一、培养目标。",
                    score=0.49,
                ),
                EvidenceSource(
                    doc_id="curriculum:汉语言文学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:chinese-intro",
                    chunk_id="curriculum:汉语言文学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/chinese",
                    latest_url="https://campus.example/curriculum/chinese",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="汉语言文学本科人才培养方案 一、培养目标。",
                    score=0.48,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-credits",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0011",
                    anchor={"page_start": 72, "page_end": 72},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="三、毕业学分要求 应修总学分:155学分 其中通识教育课程 26 学分。",
                    score=0.58,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族学本科人才培养方案总学分要求是多少？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("155学分", response.answer_text)
        self.assertNotIn("法学本科人才培养方案", response.answer_text)
        self.assertNotIn("根据培养方案相关内容", response.answer_text)

    def test_curriculum_named_document_query_with_low_title_score_still_completes(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-intro",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 一、培养目标。",
                    score=0.4761905,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-second-degree-intro",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.7,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族学本科人才培养方案",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("民族学本科人才培养方案", response.answer_text)
