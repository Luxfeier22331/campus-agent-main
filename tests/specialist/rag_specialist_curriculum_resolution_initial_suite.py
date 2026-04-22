from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    _assert_answer_text_hides_internal_locators,
    _resolved_curriculum_diagnostics_from_response,
    build_curriculum_program_semester_fact_document_id,
    delegate_to_rag_agent,
    unittest,
)


class RagSpecialistCurriculumResolutionInitialTest(unittest.TestCase):
    def test_curriculum_ambiguous_title_fragment_maps_to_needs_clarification(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族实验班",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="法学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "一、培养目标"),
                ),
                EvidenceSource(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ics-ethnic-experimental",
                    chunk_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="信息与计算科学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.48,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "信息与计算科学（民族实验班）本科人才培养方案",
                        "一、培养目标",
                    ),
                ),
                EvidenceSource(
                    doc_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:cs-ethnic-experimental",
                    chunk_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/cs-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/cs-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="计算机科学与技术（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.47,
                    source_title="计算机科学与技术（民族实验班）本科人才培养方案",
                    structural_path=(
                        "计算机科学与技术（民族实验班）本科人才培养方案",
                        "一、培养目标",
                    ),
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族实验班",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("民族实验班", response.follow_up_question)
        self.assertEqual(response.result.evidence, evidence)
        self.assertIsNotNone(response.result.diagnostics)
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "ambiguous")
        self.assertEqual(
            response.result.diagnostics.retrieval_adequacy_reason, "multi_candidate_title"
        )
        self.assertEqual(
            response.result.diagnostics.retrieved_title_summary,
            (
                "法学（民族实验班）本科人才培养方案",
                "信息与计算科学（民族实验班）本科人才培养方案",
                "计算机科学与技术（民族实验班）本科人才培养方案",
            ),
        )

    def test_curriculum_semester_course_query_normalizes_alias_and_avoids_cross_doc_contamination(
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
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、公司法。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0005",
                    anchor={"page_start": 25, "page_end": 25},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 翻译学导论、中国少数民族文字学。",
                    score=0.90,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ics-ethnic-experimental",
                    chunk_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 常微分方程、概率论、数学分析II。",
                    score=0.88,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=("信息与计算科学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )
        retriever_calls: list[str] = []

        def fake_retriever(query_text: str, *args: object, **kwargs: object) -> EvidenceBundle:
            retriever_calls.append(query_text)
            return evidence

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="法学民族班培养方案里大二下有什么课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(retriever_calls, ["法学民族实验班培养方案里第四学期有什么课"])
        self.assertEqual(response.status, "completed")
        self.assertIn("侵权责任法", response.answer_text)
        self.assertIn("中国少数民族文字学", response.answer_text)
        self.assertNotIn("常微分方程", response.answer_text)
        self.assertEqual(
            tuple(source.doc_id for source in response.result.evidence.sources),
            (
                "curriculum:法学（民族实验班）本科人才培养方案",
                "curriculum:法学（民族实验班）本科人才培养方案",
            ),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.evidence.sources),
            (
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0005",
            ),
        )
        self.assertEqual(response.result.diagnostics.session_program_family, "民族实验班")
        self.assertEqual(response.result.diagnostics.session_program, "法学民族实验班")
        self.assertEqual(response.result.diagnostics.session_semester, "第四学期")

    def test_curriculum_semester_course_query_uses_program_semester_facts_collection(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_semester_facts",
                sources=(
                    EvidenceSource(
                        doc_id=build_curriculum_program_semester_fact_document_id(
                            "curriculum:法学（民族实验班）本科人才培养方案",
                            "第四学期",
                        ),
                        revision_track="source-faithful",
                        version_id="v1:law-ethnic-semester-4",
                        chunk_id="program_semester_facts:law-ethnic:semester-4:row-0001",
                        anchor={"fact_type": "semester_course_list"},
                        canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                        latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                        source_channel="pdf_ocr",
                        collection="program_semester_facts",
                        is_current=False,
                        snippet="按当前已采集的《法学（民族实验班）本科人才培养方案》，第四学期有侵权责任法、公司法、翻译学导论。",
                        score=0.95,
                        source_title="法学（民族实验班）本科人才培养方案 第四学期课程事实",
                        structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                        detail_label="第四学期课程",
                        content_kind="program_semester_fact",
                        content_role="semester_course_list",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="法学民族班培养方案里大二下有什么课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_semester_facts")
        self.assertEqual(
            retriever_call["target_document_ids"],
            (
                build_curriculum_program_semester_fact_document_id(
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "第四学期",
                ),
            ),
        )
        self.assertIn("根据培养方案相关内容", response.answer_text)
        self.assertNotIn("根据学生手册相关规定", response.answer_text)
        self.assertIn("侵权责任法", response.answer_text)
        self.assertIn("公司法", response.answer_text)
        _assert_answer_text_hides_internal_locators(self, response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_curriculum_diagnostics_from_response(
                response,
                resolved_policy_document_id="curriculum:法学（民族实验班）本科人才培养方案",
                resolved_policy_title="法学（民族实验班）本科人才培养方案",
                rewritten_query="法学民族实验班培养方案里第四学期有什么课",
                retrieved_title_summary=("法学（民族实验班）本科人才培养方案 第四学期课程事实",),
                resolution_mode="resolved_single",
                session_program_family="民族实验班",
                session_program="法学民族实验班",
                session_semester="第四学期",
            ),
        )

    def test_curriculum_semester_course_query_without_program_resolution_maps_to_needs_clarification(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ics-ethnic-experimental",
                    chunk_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 常微分方程、概率论、数学分析II。",
                    score=0.91,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=("信息与计算科学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族班培养方案里大二下有什么课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("培养方案", response.follow_up_question)
