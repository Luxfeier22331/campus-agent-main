from __future__ import annotations

import unittest

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PromptTrace,
    RagResultPayload,
    SpecialistResponse,
    SupervisorRequest,
)
from campus_supervisor_core import handle_request
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.intent import IntentFrame
from campus_supervisor_core.policy import finalize_routing_decision
from campus_supervisor_core.prompt_execution import (
    SupervisorClarifyPromptOutput,
    SupervisorPromptExecutionResult,
    SupervisorTerminalPromptOutput,
)
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec
from campus_supervisor_core.routing import RoutingDecision


def _supervisor_prompt_trace(prompt_id: str) -> PromptTrace:
    spec = get_supervisor_prompt_spec(prompt_id)
    return PromptTrace(
        prompt_id=prompt_id,
        prompt_version=prompt_id.rsplit("_", 1)[-1],
        template_sha256=spec.template_sha256,
        variables_schema_version=spec.variables_schema_version,
        output_schema_version=spec.output_schema_version,
        model_provider="openai-responses",
        model_name="gpt-5.2",
    )


def _make_rag_completed_response() -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-agent",
        status="completed",
        answer_text="The library is open from 08:00 to 22:00.",
        confidence="high",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
                sources=(
                    EvidenceSource(
                        doc_id="handbook:test-001",
                        revision_track="source-faithful",
                        version_id="v1:test-001",
                        chunk_id="handbook:test-001:source-faithful:v1:test-001:chunk-0001",
                        anchor={"page_start": 12, "page_end": 12},
                        canonical_url="https://campus.example/handbook/test-001",
                        latest_url="https://campus.example/handbook/test-001",
                        source_channel="pdf_ocr",
                        collection="student_rules",
                        is_current=False,
                        snippet="The library is open from 08:00 to 22:00.",
                        score=0.96,
                    ),
                ),
            )
        ),
    )


def _make_curriculum_course_facts_response() -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-agent",
        status="completed",
        answer_text="根据培养方案和课程教学计划，习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)；当前还不能稳定确认开课学院。",
        confidence="high",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="习概哪个学院开，第几学期开",
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.96,
                    ),
                ),
            )
        ),
    )


class SupervisorCorePromptExecutionTest(unittest.TestCase):
    def test_finalize_routing_decision_uses_injected_prompt_executor_for_clarification(
        self,
    ) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="民族实验班有什么课",
                request_id="req-clarify-exec-001",
                requested_capability="knowledge",
            )
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="knowledge_lookup",
                domain_candidates=("knowledge",),
                missing_slots=("requested_scope",),
                risk_level="low",
                needs_clarification=True,
                suggested_next_action="clarify",
                personalization_mode="generic",
                clarification_subject="民族实验班",
            ),
        )

        class FakePromptExecutor:
            def compose_clarify(
                self, packet: object
            ) -> SupervisorPromptExecutionResult[SupervisorClarifyPromptOutput]:
                return SupervisorPromptExecutionResult(
                    output=SupervisorClarifyPromptOutput(
                        follow_up_question="请先说清楚你想查哪一类培养方案资料。"
                    ),
                    prompt_trace=_supervisor_prompt_trace("supervisor_clarify_v1"),
                )

        response = finalize_routing_decision(
            context,
            decision,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "请先说清楚你想查哪一类培养方案资料。")
        self.assertEqual(response.observability.prompt_trace.prompt_id, "supervisor_clarify_v1")

    def test_finalize_routing_decision_uses_injected_prompt_executor_for_rejected(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="请执行未授权操作",
                request_id="req-reject-exec-001",
                requested_capability="knowledge",
            )
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus="regulations",
            primary_collection="student_rules",
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="unknown",
                domain_candidates=("knowledge",),
                missing_slots=(),
                risk_level="high",
                needs_clarification=False,
                suggested_next_action="rejected",
                personalization_mode="generic",
            ),
        )

        class FakePromptExecutor:
            def compose_reject(
                self, packet: object
            ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
                return SupervisorPromptExecutionResult(
                    output=SupervisorTerminalPromptOutput(
                        answer_text="这个请求不在当前可执行范围内。"
                    ),
                    prompt_trace=_supervisor_prompt_trace("supervisor_reject_v1"),
                )

        response = finalize_routing_decision(
            context,
            decision,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "rejected")
        self.assertEqual(response.answer_text, "这个请求不在当前可执行范围内。")
        self.assertEqual(response.error.code, "request_rejected")
        self.assertEqual(response.observability.prompt_trace.prompt_id, "supervisor_reject_v1")

    def test_finalize_routing_decision_uses_injected_prompt_executor_for_out_of_scope(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="MIT的校长是谁",
                request_id="req-out-of-scope-exec-001",
                requested_capability="knowledge",
            )
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="knowledge_lookup",
                domain_candidates=("out_of_scope",),
                missing_slots=(),
                risk_level="low",
                needs_clarification=False,
                suggested_next_action="out_of_scope",
                personalization_mode="generic",
                scope_class="out_of_scope",
                policy_reason="product_scope_boundary",
            ),
        )

        class FakePromptExecutor:
            def compose_out_of_scope(
                self, packet: object
            ) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
                return SupervisorPromptExecutionResult(
                    output=SupervisorTerminalPromptOutput(
                        answer_text="这个问题不属于当前支持的中央民族大学校园问答范围。"
                    ),
                    prompt_trace=_supervisor_prompt_trace("supervisor_out_of_scope_v1"),
                )

        response = finalize_routing_decision(
            context,
            decision,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.answer_text, "这个问题不属于当前支持的中央民族大学校园问答范围。")
        self.assertEqual(
            response.observability.prompt_trace.prompt_id, "supervisor_out_of_scope_v1"
        )

    def test_handle_request_preserves_error_response_fields(self) -> None:
        response = handle_request(
            SupervisorRequest(
                user_goal="library map",
                requested_capability="knowledge",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                ),
            ),
            specialist_delegates={
                "rag-agent": lambda request: SpecialistResponse(
                    target="rag-agent",
                    status="error",
                    answer_text="retrieval failed while checking the handbook.",
                    follow_up_question="Try again later?",
                    confidence="low",
                    error=ErrorInfo(
                        code="retrieval_failed",
                        message="retrieval backend unavailable",
                        retryable=False,
                    ),
                )
            },
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.answer_text, "retrieval failed while checking the handbook.")
        self.assertEqual(response.follow_up_question, "Try again later?")
        self.assertEqual(
            response.error,
            ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable"),
        )
