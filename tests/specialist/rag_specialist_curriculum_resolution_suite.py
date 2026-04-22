from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    ActorContext,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagRequestPayload,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    _assert_answer_text_hides_internal_locators,
    _make_evidence,
    _make_program_semester_source,
    _resolved_curriculum_diagnostics_from_response,
    _resolved_scope_diagnostics,
    build_curriculum_program_semester_fact_document_id,
    delegate_to_rag_agent,
    unittest,
)


class RagSpecialistCurriculumResolutionTest(unittest.TestCase):
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

    def test_curriculum_follow_up_program_fragment_uses_recent_goal_to_resolve_family_then_semester(
        self,
    ) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_semester_facts",
                sources=(
                    _make_program_semester_source(
                        source_document_id="curriculum:法学（民族实验班）本科人才培养方案",
                        semester_label="第四学期",
                        snippet="按当前已采集的《法学（民族实验班）本科人才培养方案》，第四学期有侵权责任法、翻译学导论、中国少数民族文字学。",
                        score=0.92,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="法学",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="民族班培养方案里大二下有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            retriever_call["query_text"],
            "法学民族实验班培养方案里第四学期有什么课",
        )
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
        self.assertIn("侵权责任法", response.answer_text)

    def test_curriculum_follow_up_semester_fragment_uses_recent_goal_to_continue_same_program(
        self,
    ) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_semester_facts",
                sources=(
                    _make_program_semester_source(
                        source_document_id="curriculum:法学（民族实验班）本科人才培养方案",
                        semester_label="第四学期",
                        snippet="按当前已采集的《法学（民族实验班）本科人才培养方案》，第四学期有侵权责任法、翻译学导论、中国少数民族文字学。",
                        score=0.92,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="那大二下呢",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="法学民族班培养方案里大一上有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            retriever_call["query_text"],
            "法学民族实验班培养方案里第四学期有什么课",
        )
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
        self.assertIn("中国少数民族文字学", response.answer_text)

    def test_curriculum_follow_up_program_fragment_prefers_typed_session_slots_over_stale_recent_goal(
        self,
    ) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_semester_facts",
                sources=(
                    _make_program_semester_source(
                        source_document_id="curriculum:法学（民族实验班）本科人才培养方案",
                        semester_label="第四学期",
                        snippet="按当前已采集的《法学（民族实验班）本科人才培养方案》，第四学期有侵权责任法、翻译学导论、中国少数民族文字学。",
                        score=0.92,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="法学",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="民族班培养方案里大一上有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                    session=SessionSummary(
                        confirmed_slots=(
                            SessionSlot(
                                name=CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
                                value="民族实验班",
                                confirmed=True,
                            ),
                            SessionSlot(
                                name=CURRICULUM_SEMESTER_SLOT_NAME,
                                value="第四学期",
                                confirmed=True,
                            ),
                        ),
                        turn_count=4,
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["query_text"], "法学民族实验班培养方案里第四学期有什么课")
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
        self.assertEqual(response.result.diagnostics.session_program_family, "民族实验班")
        self.assertEqual(response.result.diagnostics.session_program, "法学民族实验班")
        self.assertEqual(response.result.diagnostics.session_semester, "第四学期")

    def test_curriculum_follow_up_semester_fragment_prefers_typed_program_slot_over_stale_recent_goal(
        self,
    ) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_semester_facts",
                sources=(
                    _make_program_semester_source(
                        source_document_id="curriculum:法学（民族实验班）本科人才培养方案",
                        semester_label="第四学期",
                        snippet="按当前已采集的《法学（民族实验班）本科人才培养方案》，第四学期有侵权责任法、翻译学导论、中国少数民族文字学。",
                        score=0.92,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="那大二下呢",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="信息与计算科学民族班培养方案里大一上有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                    session=SessionSummary(
                        confirmed_slots=(
                            SessionSlot(
                                name=CURRICULUM_PROGRAM_SLOT_NAME,
                                value="法学民族实验班",
                                confirmed=True,
                            ),
                            SessionSlot(
                                name=CURRICULUM_SEMESTER_SLOT_NAME,
                                value="第一学期",
                                confirmed=True,
                            ),
                        ),
                        turn_count=5,
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["query_text"], "法学民族实验班培养方案里第四学期有什么课")
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

    def test_curriculum_generic_base_class_with_verified_major_prefers_clarification_over_silent_resolution(
        self,
    ) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(query_text="基地班")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="基地班",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertFalse(retriever_called)

    def test_curriculum_deictic_query_with_verified_major_prefers_major_scoped_candidate(
        self,
    ) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_semester_facts",
                sources=(
                    _make_program_semester_source(
                        source_document_id="curriculum:历史学（强基计划）本科人才培养方案",
                        semester_label="第四学期",
                        snippet="按当前已采集的《历史学（强基计划）本科人才培养方案》，第四学期有中国史学史、史学理论专题。",
                        score=0.92,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="我这个专业的基地班大二下有什么课",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
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
                    "curriculum:历史学（强基计划）本科人才培养方案",
                    "第四学期",
                ),
            ),
        )
        self.assertEqual(retriever_call["preferred_document_ids"], ())
        self.assertIn("中国史学史", response.answer_text)
        self.assertEqual(response.result.diagnostics.session_program_family, "强基计划")
        self.assertEqual(response.result.diagnostics.session_program, "历史学强基计划")
        self.assertEqual(response.result.diagnostics.session_semester, "第四学期")

    def test_curriculum_generic_base_class_clarification_records_soft_bias_without_identity_resolution(
        self,
    ) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="基地班",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(query_text="基地班"),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(
            response.result.diagnostics.clarification_reason, "curriculum_program_family_alias"
        )
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "ambiguous")
        self.assertEqual(
            response.result.diagnostics.retrieval_adequacy_reason, "curriculum_program_family_alias"
        )
        self.assertEqual(response.result.diagnostics.resolution_mode, "needs_clarification")
        self.assertFalse(response.result.diagnostics.used_verified_identity)
        self.assertTrue(response.result.diagnostics.used_soft_preference)
        self.assertEqual(
            response.result.diagnostics.candidate_title_summary[0],
            "历史学（强基计划）本科人才培养方案",
        )
        self.assertIn(
            "哲学（强基计划）本科人才培养方案",
            response.result.diagnostics.candidate_title_summary,
        )
        self.assertIn(
            "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
            response.result.diagnostics.candidate_title_summary,
        )

    def test_curriculum_deictic_resolution_records_verified_identity_diagnostics(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="我这个专业的基地班大二下有什么课",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="我这个专业的基地班大二下有什么课",
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(),
            ),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="curriculum",
                collection="curriculum_plan",
                resolved_policy_document_id="curriculum:历史学（强基计划）本科人才培养方案",
                resolved_policy_title="历史学（强基计划）本科人才培养方案",
                rewritten_query="历史学（强基计划）本科人才培养方案 我这个专业的基地班第四学期有什么课",
                semantic_outcome="unsupported_by_evidence",
                resolution_mode="resolved_single",
                used_verified_identity=True,
                used_soft_preference=False,
            ),
        )

    def test_curriculum_deictic_experimental_class_with_verified_major_still_needs_clarification(
        self,
    ) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(query_text="我这个专业的实验班大二下有什么课")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="我这个专业的实验班大二下有什么课",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertFalse(retriever_called)
