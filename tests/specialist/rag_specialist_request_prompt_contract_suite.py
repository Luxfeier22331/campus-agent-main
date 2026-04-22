from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    ActorContext,
    ContextProjection,
    CorpusQueryDisabledError,
    ErrorInfo,
    EvidenceBundle,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagAnswerPromptOutput,
    RagPromptExecutionResult,
    RagRequestPayload,
    RagResultPayload,
    RetrievalBackendError,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    SpecialistResponse,
    _make_evidence,
    _rag_prompt_trace,
    _resolved_scope_diagnostics,
    delegate_to_rag_agent,
    frame_rag_intent,
    unittest,
)


class RagSpecialistRequestPromptContractTest(unittest.TestCase):
    def test_frame_rag_intent_marks_user_grounded_personalization_when_context_exists(self) -> None:
        request = SpecialistRequest(
            target="rag-agent",
            user_goal="保研申请流程是什么？",
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    cohort="2023",
                    major="philosophy",
                ),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="咨询保研",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                            last_verified_at="2026-03-28",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name="policy_topic", value="推免资格", confirmed=True),
                    ),
                    turn_count=3,
                ),
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        frame = frame_rag_intent(request)

        self.assertEqual(frame.question_kind, "procedure")
        self.assertEqual(frame.personalization_mode, "user_grounded")
        self.assertEqual(frame.response_mode, "retrieve_then_answer")
        self.assertEqual(frame.retrieval_plan, "personalized_rewrite")

    def test_blank_user_goal_is_rejected_by_request_contract(self) -> None:
        with self.assertRaisesRegex(ValueError, "user_goal"):
            SpecialistRequest(
                target="rag-agent",
                user_goal="   ",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            )

    def test_missing_scope_resolves_curriculum_plan_for_curriculum_query(self) -> None:
        captured_calls: list[dict[str, object]] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_calls.append(
                {
                    "collection": kwargs.get("collection"),
                    "corpus": kwargs.get("corpus"),
                    "query": query,
                }
            )
            return EvidenceBundle(
                query_text=query,
                corpus=str(kwargs["corpus"]),
                collection=str(kwargs["collection"]),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族学本科人才培养方案总学分要求是多少？",
                payload=RagRequestPayload(scope=None),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(captured_calls[0]["corpus"], "curriculum")
        self.assertEqual(captured_calls[0]["collection"], "curriculum_plan")
        assert isinstance(response.result, RagResultPayload)
        self.assertEqual(response.result.evidence.corpus, "curriculum")
        self.assertEqual(response.result.evidence.collection, "curriculum_plan")
        self.assertEqual(response.result.diagnostics.resolved_scope_corpus, "curriculum")
        self.assertEqual(response.result.diagnostics.resolved_scope_collection, "curriculum_plan")

    def test_missing_scope_without_campus_signal_clarifies_before_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="MIT的校长是谁",
                payload=RagRequestPayload(scope=None),
            ),
            retriever=fake_retriever,
        )

        self.assertFalse(retriever_called)
        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.confidence, "low")
        self.assertIn("知识范围", response.follow_up_question)
        self.assertIsNone(response.result)

    def test_retrieval_error_maps_to_error_response(self) -> None:
        def raising_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            raise RetrievalBackendError("qdrant unavailable")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="library hours",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=raising_retriever,
        )

        self.assertEqual(
            response,
            SpecialistResponse(
                target="rag-agent",
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="retrieval_failed",
                    message="qdrant unavailable",
                    retryable=False,
                ),
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="library hours",
                        corpus="regulations",
                        collection="student_rules",
                    )
                ),
            ),
        )

    def test_query_disabled_corpus_maps_to_explicit_error_response(self) -> None:
        def raising_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            raise CorpusQueryDisabledError(
                "campus_services/service_catalog retrieval is disabled by runtime profile"
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="宿舍报修流程",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(
                        corpus="campus_services",
                        collection="service_catalog",
                    )
                ),
            ),
            retriever=raising_retriever,
        )

        self.assertIsInstance(response, SpecialistResponse)
        self.assertEqual(response.target, "rag-agent")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.error.code, "corpus_not_query_enabled")
        self.assertIn("service_catalog", response.error.message)
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="宿舍报修流程",
                    corpus="campus_services",
                    collection="service_catalog",
                ),
                diagnostics=_resolved_scope_diagnostics(
                    corpus="campus_services",
                    collection="service_catalog",
                ),
            ),
        )

    def test_no_evidence_maps_to_no_answer(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="library hours",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
            ),
        )

        self.assertEqual(response.target, "rag-agent")
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertIn("未检索到足够依据", response.answer_text)
        self.assertIn("学生手册", response.answer_text)
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_rules",
                ),
                diagnostics=_resolved_scope_diagnostics(
                    corpus="regulations",
                    collection="student_rules",
                    semantic_outcome="unsupported_by_evidence",
                ),
            ),
        )

    def test_no_evidence_uses_injected_prompt_executor_for_no_answer(self) -> None:
        class FakePromptExecutor:
            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="当前依据还不够，请补充更具体的制度名称。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_unsupported_v1"),
                )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="library hours",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
            ),
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.answer_text, "当前依据还不够，请补充更具体的制度名称。")
        self.assertEqual(response.result.diagnostics.prompt_trace.prompt_id, "rag_unsupported_v1")
