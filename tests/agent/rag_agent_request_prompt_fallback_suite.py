from __future__ import annotations

from tests.agent.rag_agent_test_support import (
    AgentRequest,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PromptRuntimeValidationError,
    RagAgent,
    RagAnswerPromptOutput,
    RagClarifyPromptOutput,
    RagPromptExecutionResult,
    RagRequestPayload,
    _make_handbook_source,
    _rag_prompt_trace,
    delegate_to_rag_agent,
    unittest,
)


class RagAgentRequestPromptFallbackTest(unittest.TestCase):
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
