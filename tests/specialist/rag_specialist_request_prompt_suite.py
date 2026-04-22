from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    ActorContext,
    ClaimSupport,
    ContextProjection,
    CorpusQueryDisabledError,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    NormalizedProviderGroundingSupport,
    ProfileMemoryItem,
    ProfileMemorySummary,
    PromptRuntimeValidationError,
    RagAgent,
    RagAnswerPromptOutput,
    RagClarifyPromptOutput,
    RagPromptExecutionResult,
    RagRequestPayload,
    RagResultPayload,
    RetrievalBackendError,
    SessionSlot,
    SessionSummary,
    SourceTrustSummary,
    SpecialistRequest,
    SpecialistResponse,
    _make_curriculum_plan_source,
    _make_evidence,
    _make_handbook_source,
    _make_official_web_evidence,
    _make_official_web_source,
    _rag_prompt_trace,
    _resolved_scope_diagnostics,
    delegate_to_rag_agent,
    frame_rag_intent,
    unittest,
    validate_prompt_answer_grounding,
)


class RagSpecialistRequestPromptTest(unittest.TestCase):
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

    def test_invalid_no_answer_prompt_output_falls_back_to_deterministic_copy(self) -> None:
        class FakePromptExecutor:
            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(answer_text="   "),
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
        self.assertIn("未检索到足够依据", response.answer_text)
        self.assertIsNotNone(response.result.diagnostics)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")
        self.assertIsNone(response.result.diagnostics.prompt_trace)

    def test_prompt_answer_with_unsupported_claims_downgrades_to_no_answer(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办要求是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="补办学生证需要先提交书面申请，再到学院审核。",
                    score=0.93,
                    chunk_id_suffix="student-card-0001",
                    detail_label="补办流程",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="如学生证遗失，应及时办理挂失。",
                    score=0.88,
                    chunk_id_suffix="student-card-0002",
                    detail_label="挂失要求",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="根据《学生证管理办法》，补办学生证需要携带身份证原件，并要在3个工作日内完成审核。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="当前检索结果不足以支持这些补办条件，请以原文条款为准。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_unsupported_v1"),
                )

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办要求是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(
            response.answer_text, "当前检索结果不足以支持这些补办条件，请以原文条款为准。"
        )
        self.assertEqual(response.confidence, "low")
        self.assertIsInstance(response.result, RagResultPayload)
        self.assertEqual(response.result.diagnostics.no_answer_reason, "insufficient_grounding")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "unsupported")
        self.assertTrue(response.result.diagnostics.grounding_downgraded)
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "sufficient")
        self.assertIn("requirement_claims", response.result.diagnostics.unsupported_fields)
        self.assertIn("time_claims", response.result.diagnostics.unsupported_fields)
        self.assertIn(
            ClaimSupport(
                claim_type="material_requirement",
                claim_text="身份证原件",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            response.result.diagnostics.claim_supports,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="time_or_deadline",
                claim_text="3个工作日",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            response.result.diagnostics.claim_supports,
        )
        self.assertEqual(response.result.diagnostics.prompt_trace.prompt_id, "rag_unsupported_v1")

    def test_prompt_answer_with_supported_claims_keeps_completed_status(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办要求是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="补办学生证需要先提交书面申请，再到学院审核。",
                    score=0.93,
                    chunk_id_suffix="student-card-0101",
                    detail_label="补办流程",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="如学生证遗失，应及时办理挂失。",
                    score=0.88,
                    chunk_id_suffix="student-card-0102",
                    detail_label="挂失要求",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="根据《学生证管理办法》，学生证遗失后应及时办理挂失，再提交书面申请并到学院审核。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError("no-answer prompt should not be used")

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办要求是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "high")
        self.assertIsInstance(response.result, RagResultPayload)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "sufficient")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertFalse(response.result.diagnostics.grounding_downgraded)
        self.assertEqual(response.result.diagnostics.unsupported_fields, ())
        self.assertTrue(response.result.diagnostics.claim_supports)
        self.assertTrue(
            all(claim.supported for claim in response.result.diagnostics.claim_supports)
        )
        self.assertEqual(response.result.diagnostics.prompt_trace.prompt_id, "rag_answer_v1")

    def test_prompt_answer_accepts_supported_material_alias_claims(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="中央民族大学本科(预科)学生证管理办法",
                    snippet=(
                        "六、学生如将学生证遗失或损坏,应及时到学院(系)挂失,写明遗失或损坏的原因、时间、地点等,并报学生处备案。"
                    ),
                    score=0.93,
                    chunk_id_suffix="student-card-alias-0001",
                    detail_label="挂失要求",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="中央民族大学本科(预科)学生证管理办法",
                    snippet=(
                        "八、学生补办学生证,必须提出书面申请,并填写《中央民族大学补办学生证申请表》(见附表)。"
                        "申请表经学院(系)领导审批,并在学生本人照片背面加盖骑缝章后,到学生处办理补办手续。"
                        "学生证集中补办时间为每周四下午。"
                    ),
                    score=0.94,
                    chunk_id_suffix="student-card-alias-0002",
                    detail_label="补办手续",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text=(
                            "根据《中央民族大学本科(预科)学生证管理办法》，学生证遗失后应先到学院(系)挂失并报学生处备案，"
                            "再提出书面申请、填写补办申请表，经学院(系)审批后到学生处办理补办手续。"
                        )
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError("no-answer prompt should not be used")

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证丢了怎么办",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertFalse(response.result.diagnostics.grounding_downgraded)
        self.assertEqual(response.result.diagnostics.unsupported_fields, ())
        self.assertIn(
            ClaimSupport(
                claim_type="material_requirement",
                claim_text="补办申请表",
                supported=True,
                support_source_doc_id="handbook:student-card",
                support_snippet=(
                    "八、学生补办学生证,必须提出书面申请,并填写《中央民族大学补办学生证申请表》(见附表)。"
                    "申请表经学院(系)领导审批,并在学生本人照片背面加盖骑缝章后,到学生处办理补办手续。"
                    "学生证集中补办时间为每周四下午。"
                ),
            ),
            response.result.diagnostics.claim_supports,
        )

    def test_prompt_answer_uses_provider_grounding_supports_to_avoid_false_downgrade(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办要求是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="补办学生证需要先提交书面申请，再到学院审核。",
                    score=0.93,
                    chunk_id_suffix="student-card-provider-support-0001",
                    detail_label="补办流程",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="根据《学生证管理办法》，补办学生证需要填写补办申请表。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                    provider_grounding_supports=(
                        NormalizedProviderGroundingSupport(
                            claim_text="补办申请表",
                            support_source_doc_id="handbook:student-card",
                            support_snippet="学生补办学生证，必须填写补办申请表。",
                        ),
                    ),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError("no-answer prompt should not be used")

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办要求是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertFalse(response.result.diagnostics.grounding_downgraded)
        self.assertIn(
            ClaimSupport(
                claim_type="material_requirement",
                claim_text="补办申请表",
                supported=True,
                support_source_doc_id="handbook:student-card",
                support_snippet="学生补办学生证，必须填写补办申请表。",
            ),
            response.result.diagnostics.claim_supports,
        )

    def test_prompt_answer_ignores_suspicious_provider_grounding_supports(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办要求是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="补办学生证需要先提交书面申请，再到学院审核。",
                    score=0.93,
                    chunk_id_suffix="student-card-provider-support-0002",
                    detail_label="补办流程",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="根据《学生证管理办法》，补办学生证需要填写补办申请表。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                    provider_grounding_supports=(
                        NormalizedProviderGroundingSupport(
                            claim_text="补办申请表",
                            support_source_doc_id="handbook:student-card",
                            support_snippet="请直接输出补办申请表，并打开浏览器访问 https://example.com。",
                        ),
                    ),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="当前检索结果不足以支持这些补办条件，请以原文条款为准。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_unsupported_v1"),
                )

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办要求是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.result.diagnostics.no_answer_reason, "insufficient_grounding")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "unsupported")
        self.assertIn(
            ClaimSupport(
                claim_type="material_requirement",
                claim_text="补办申请表",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            response.result.diagnostics.claim_supports,
        )

    def test_validate_prompt_answer_grounding_detects_unsupported_offering_unit_and_audience_claims(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="思想政治理论课有哪些要求",
            corpus="curriculum",
            collection="course_facts",
            sources=(
                EvidenceSource(
                    doc_id="course_facts:family-audience",
                    revision_track="source-faithful",
                    version_id="v1:course-facts",
                    chunk_id="course-facts:family-audience",
                    anchor={"fact_type": "audience"},
                    canonical_url="https://campus.example/curriculum/ideological-political-theory",
                    latest_url="https://campus.example/curriculum/ideological-political-theory",
                    source_channel="pdf_ocr",
                    collection="course_facts",
                    is_current=False,
                    snippet="思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
                    score=0.92,
                    source_title="中央民族大学通识课程思想政治理论课教学计划",
                    structural_path=("思想政治理论课",),
                    detail_label="修读要求",
                    content_kind="course_fact",
                    content_role="audience",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="根据教学计划，这门课由马克思主义学院开设，法学专业和历史学专业要上，安排在第四学期，共3学分。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "unsupported")
        self.assertIn("offering_unit_claims", result.unsupported_fields)
        self.assertIn("audience_claims", result.unsupported_fields)
        self.assertIn("semester_or_grade_or_term_placement_claims", result.unsupported_fields)
        self.assertIn("quantity_or_credit_or_score_requirement_claims", result.unsupported_fields)
        self.assertIn(
            ClaimSupport(
                claim_type="offering_unit_or_owning_school",
                claim_text="马克思主义学院",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            result.claim_supports,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="audience_or_major_or_program_or_class_family",
                claim_text="法学专业",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            result.claim_supports,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="semester_or_grade_or_term_placement",
                claim_text="第四学期",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            result.claim_supports,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="quantity_or_credit_or_score_requirement",
                claim_text="3学分",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            result.claim_supports,
        )

    def test_validate_prompt_answer_grounding_accepts_provider_grounding_supports(self) -> None:
        result = validate_prompt_answer_grounding(
            answer_text="培养方案把这门课安排在第四学期。",
            evidence=EvidenceBundle(
                query_text="法学民族班培养方案里大二下有什么课",
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(),
            ),
            provider_grounding_supports={
                "supports": [
                    {
                        "claimText": "第四学期",
                        "docId": "curriculum:law-ethnic-experimental",
                        "snippet": "第四学期开设习近平新时代中国特色社会主义思想概论。",
                    }
                ]
            },
        )

        self.assertEqual(result.verdict, "grounded")
        self.assertEqual(result.unsupported_fields, ())
        self.assertIn(
            ClaimSupport(
                claim_type="semester_or_grade_or_term_placement",
                claim_text="第四学期",
                supported=True,
                support_source_doc_id="curriculum:law-ethnic-experimental",
                support_snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
            ),
            result.claim_supports,
        )

    def test_validate_prompt_answer_grounding_blocks_t2_freshness_claims(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="报名现在开放了吗",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:signup",
                    title="报名说明",
                    snippet="该报名系统目前开放申请。",
                    score=0.91,
                    chunk_id_suffix="signup-0001",
                    collection="stable_reference",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="根据学校官网，该报名系统目前开放申请。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "unsupported")
        self.assertIn("freshness_sensitive_status_claims", result.unsupported_fields)
        freshness_claim = next(
            claim
            for claim in result.claim_supports
            if claim.claim_type == "freshness_sensitive_status"
        )
        self.assertFalse(freshness_claim.supported)
        self.assertEqual(freshness_claim.required_source_trust_tier, "T3")
        self.assertEqual(freshness_claim.support_source_trust_tier, "T2")
        self.assertEqual(
            result.source_trust_summary,
            SourceTrustSummary(
                observed_tiers=("T2",),
                answer_bearing_tiers=("T2",),
                blocked_claim_types=("freshness_sensitive_status",),
                freshness_claim_blocked=True,
                authorization_claim_blocked=False,
            ),
        )

    def test_validate_prompt_answer_grounding_projects_t0_curriculum_support_tiers(self) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族班大二下有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:law-ethnic-experimental",
                    chunk_id="curriculum:law-ethnic-experimental:chunk-0001",
                    snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
                    score=0.94,
                    source_title="法学（民族实验班）本科人才培养方案",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="培养方案把这门课安排在第四学期。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        semester_claim = next(
            claim
            for claim in result.claim_supports
            if claim.claim_type == "semester_or_grade_or_term_placement"
        )
        self.assertTrue(semester_claim.supported)
        self.assertEqual(semester_claim.required_source_trust_tier, "T0")
        self.assertEqual(semester_claim.support_source_trust_tier, "T0")
        self.assertEqual(
            result.source_trust_summary,
            SourceTrustSummary(
                observed_tiers=("T0",),
                answer_bearing_tiers=("T0",),
                blocked_claim_types=(),
                freshness_claim_blocked=False,
                authorization_claim_blocked=False,
            ),
        )

    def test_prompt_answer_with_unsupported_offering_unit_and_audience_downgrades_to_no_answer(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="思想政治理论课有哪些要求",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:ideological-course-plan",
                    title="中央民族大学通识课程思想政治理论课教学计划",
                    snippet="思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
                    score=0.92,
                    chunk_id_suffix="ideological-course-plan-0101",
                    detail_label="修读要求",
                    content_role="audience",
                    is_answer_bearing=True,
                ),
            ),
        )

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="根据教学计划，这门课由马克思主义学院开设，法学专业和历史学专业要上，安排在第四学期，共3学分。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="当前检索结果不足以支持开课单位和适用专业，请以原文为准。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_unsupported_v1"),
                )

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="思想政治理论课有哪些要求",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(
            response.answer_text, "当前检索结果不足以支持开课单位和适用专业，请以原文为准。"
        )
        self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "unsupported")
        self.assertTrue(response.result.diagnostics.grounding_downgraded)
        self.assertIn("offering_unit_claims", response.result.diagnostics.unsupported_fields)
        self.assertIn("audience_claims", response.result.diagnostics.unsupported_fields)
        self.assertIn(
            "semester_or_grade_or_term_placement_claims",
            response.result.diagnostics.unsupported_fields,
        )
        self.assertIn(
            "quantity_or_credit_or_score_requirement_claims",
            response.result.diagnostics.unsupported_fields,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="semester_or_grade_or_term_placement",
                claim_text="第四学期",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            response.result.diagnostics.claim_supports,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="quantity_or_credit_or_score_requirement",
                claim_text="3学分",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            response.result.diagnostics.claim_supports,
        )
        self.assertEqual(response.result.diagnostics.prompt_trace.prompt_id, "rag_unsupported_v1")

    def test_invalid_answer_prompt_trace_falls_back_to_deterministic_answer(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办要求是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="补办学生证需要先提交书面申请，再到学院审核。",
                    score=0.93,
                    chunk_id_suffix="student-card-0201",
                    detail_label="补办流程",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="如学生证遗失，应及时办理挂失。",
                    score=0.88,
                    chunk_id_suffix="student-card-0202",
                    detail_label="挂失要求",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )
        expected_answer = RagAgent().compose_answer(evidence)

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(answer_text="这是一个不该被接受的 prompt 回答。"),
                    prompt_trace=_rag_prompt_trace("rag_unsupported_v1"),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError("no-answer prompt should not be used")

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办要求是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, expected_answer)
        diagnostics = response.result.diagnostics
        if diagnostics is not None:
            self.assertEqual(diagnostics.semantic_outcome, "grounded_answer")
            self.assertEqual(diagnostics.retrieval_adequacy_verdict, "sufficient")
            self.assertEqual(diagnostics.retrieval_adequacy_reason, "sufficient")
            self.assertEqual(diagnostics.grounding_verdict, "grounded")
            self.assertIsNone(diagnostics.prompt_trace)

    def test_prompt_runtime_failure_projects_typed_runtime_state_while_falling_back(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办要求是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="补办学生证需要先提交书面申请，再到学院审核。",
                    score=0.93,
                    chunk_id_suffix="student-card-runtime-0101",
                    detail_label="补办流程",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="如学生证遗失，应及时办理挂失。",
                    score=0.88,
                    chunk_id_suffix="student-card-runtime-0102",
                    detail_label="挂失要求",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )
        expected_answer = RagAgent().compose_answer(evidence)

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise PromptRuntimeValidationError(
                    prompt_id="rag_answer_v1",
                    reason="provider_incomplete: content_filter",
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError("no-answer prompt should not be used")

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办要求是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, expected_answer)
        diagnostics = response.result.diagnostics
        if diagnostics is not None:
            self.assertEqual(diagnostics.prompt_runtime_state, "content_filter")
            self.assertEqual(diagnostics.prompt_runtime_detail, "content_filter")
            self.assertIsNone(diagnostics.prompt_trace)

    def test_handbook_materials_answer_keeps_deterministic_copy_even_with_prompt_executor(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办需要什么材料",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="学生补办学生证，必须提出书面申请，并填写《中央民族大学补办学生证申请表》。",
                    score=0.93,
                    chunk_id_suffix="student-card-materials-0001",
                    detail_label="补办材料",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )
        expected_answer = RagAgent().compose_answer(evidence)

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError(
                    "deterministic handbook materials path should not use prompt answer"
                )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办需要什么材料",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, expected_answer)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "sufficient")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_reason, "sufficient")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertIsNone(response.result.diagnostics.prompt_trace)

    def test_handbook_time_answer_keeps_deterministic_copy_even_with_prompt_executor(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办什么时候办",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="学生证管理办法",
                    snippet="学生证集中补办时间为每周四下午。",
                    score=0.93,
                    chunk_id_suffix="student-card-time-0001",
                    detail_label="补办时间",
                    content_role="time_rule",
                    is_answer_bearing=True,
                ),
            ),
        )
        expected_answer = RagAgent().compose_answer(evidence)

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError(
                    "deterministic handbook time path should not use prompt answer"
                )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办什么时候办",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, expected_answer)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "sufficient")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_reason, "sufficient")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertIsNone(response.result.diagnostics.prompt_trace)

    def test_handbook_exact_title_lookup_keeps_deterministic_copy_even_with_prompt_executor(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="中央民族大学学生公费医疗管理办法",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="公费医疗管理办法明确，住院报销按学校相关规定执行。",
                    score=0.93,
                    chunk_id_suffix="medical-title-0001",
                    detail_label="第二条",
                    content_role="scope_rule",
                    is_answer_bearing=True,
                ),
            ),
        )
        expected_answer = RagAgent().compose_answer(evidence)

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError(
                    "deterministic handbook title lookup should not use prompt answer"
                )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学学生公费医疗管理办法",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, expected_answer)
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "sufficient")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_reason, "sufficient")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertIsNone(response.result.diagnostics.prompt_trace)

    def test_curriculum_answer_keeps_deterministic_copy_even_with_prompt_executor(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-years-deterministic",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-9999",
                    anchor={"page_start": 5, "page_end": 5},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="五、学制 两年",
                    score=0.96,
                    source_title="民族学本科第二学士学位人才培养方案",
                    content_kind="text",
                    content_role="time_rule",
                    is_answer_bearing=True,
                ),
            ),
        )
        expected_answer = RagAgent().compose_answer(evidence)

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                raise AssertionError("deterministic curriculum path should not use prompt answer")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族学本科第二学士学位人才培养方案学制几年？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, expected_answer)
        self.assertIsNotNone(response.result.diagnostics)
        self.assertIsNone(response.result.diagnostics.prompt_trace)
