from __future__ import annotations

from tests.agent.rag_agent_test_support import (
    ActorContext,
    AgentRequest,
    ContextProjection,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    _make_evidence,
    _make_program_semester_source,
    _resolved_scope_diagnostics,
    build_curriculum_program_semester_fact_document_id,
    delegate_to_rag_agent,
    unittest,
)


class RagAgentCurriculumResolutionBiasTest(unittest.TestCase):
    def test_curriculum_generic_base_class_with_verified_major_prefers_clarification_over_silent_resolution(
        self,
    ) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(query_text="基地班")

        response = delegate_to_rag_agent(
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
