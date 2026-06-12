from __future__ import annotations

from tests.agent.knowledge_capability_test_support import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    ActorContext,
    CapabilityRequest,
    ContextProjection,
    EvidenceBundle,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagRequestPayload,
    SessionSlot,
    SessionSummary,
    _make_program_semester_source,
    build_curriculum_program_semester_fact_document_id,
    delegate_to_knowledge_capability,
    unittest,
)


class KnowledgeCapabilityCurriculumResolutionFollowUpTest(unittest.TestCase):
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

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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
