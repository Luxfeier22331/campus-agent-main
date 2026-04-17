from __future__ import annotations

import unittest

from campus_contracts import (
    AvailabilityObservation,
    EvidenceBundle,
    ErrorInfo,
    PromptTrace,
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistResponse,
    SupervisorResponse,
    SupervisorRequest,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.intent import IntentFrame
from campus_supervisor_core.policy import finalize_routing_decision, finalize_specialist_response
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec
from campus_supervisor_core.routing import RoutingDecision
from campus_shared import PromptRuntimeValidationError


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


class SupervisorPolicyTest(unittest.TestCase):
    def test_finalize_completed_response_keeps_completed_status(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="completed",
            answer_text="The library is open.",
            confidence="high",
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-specialist")
        self.assertEqual(finalized.status, "completed")
        self.assertEqual(finalized.answer_text, "The library is open.")
        self.assertEqual(finalized.confidence, "high")
        self.assertIsNotNone(finalized.observability)
        self.assertTrue(finalized.observability.citation_expected)
        self.assertTrue(finalized.observability.retrieval_attempted)

    def test_finalize_needs_clarification_response_keeps_follow_up(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            follow_up_question="Which campus are you asking about?",
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-specialist")
        self.assertEqual(finalized.status, "needs_clarification")
        self.assertEqual(finalized.follow_up_question, "Which campus are you asking about?")
        self.assertIsNotNone(finalized.observability)
        self.assertFalse(finalized.observability.retrieval_attempted)

    def test_finalize_no_answer_response_keeps_no_answer_semantics(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_handbook",
                    query_text="国奖看第一作者单位吗？",
                ),
                diagnostics=RagResultDiagnostics(
                    no_answer_reason="resolved_policy_clause_not_found",
                ),
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-specialist")
        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(finalized.confidence, "low")
        self.assertIsNotNone(finalized.observability)
        self.assertTrue(finalized.observability.retrieval_attempted)
        self.assertEqual(finalized.observability.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(finalized.observability.scope_class, "in_scope")

    def test_finalize_restricted_no_answer_projects_restricted_semantic_outcome(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_handbook",
                    query_text="查看内部通知",
                ),
                diagnostics=RagResultDiagnostics(
                    no_answer_reason="restricted_access_denied",
                ),
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.status, "no_answer")
        self.assertIsNotNone(finalized.observability)
        self.assertEqual(finalized.observability.semantic_outcome, "restricted_access_denied")
        self.assertEqual(finalized.observability.scope_class, "in_scope")

    def test_finalize_freshness_fail_close_projects_fail_closed_observability(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="official_web",
                    collection="muc_public_pages",
                    query_text="中央民族大学今天有什么讲座",
                ),
                diagnostics=RagResultDiagnostics(
                    no_answer_reason="freshness_fail_close",
                    semantic_outcome="freshness_fail_close",
                    freshness_fail_closed=True,
                ),
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.status, "no_answer")
        self.assertIsNotNone(finalized.observability)
        self.assertEqual(finalized.observability.semantic_outcome, "freshness_fail_close")
        self.assertTrue(finalized.observability.fail_closed)
        self.assertEqual(finalized.observability.scope_class, "in_scope")

    def test_finalize_out_of_scope_routing_projects_terminal_no_answer(self) -> None:
        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="MIT的校长是谁",
                    requested_capability="knowledge",
                )
            ),
            RoutingDecision(
                target=None,
                primary_corpus=None,
                primary_collection=None,
                intent_frame=IntentFrame(
                    capability="knowledge",
                    task_kind="knowledge_lookup",
                    domain_candidates=("knowledge",),
                    missing_slots=(),
                    risk_level="low",
                    needs_clarification=False,
                    suggested_next_action="out_of_scope",
                    personalization_mode="generic",
                    scope_class="out_of_scope",
                    policy_reason="product_scope_boundary",
                ),
            ),
        )

        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(finalized.confidence, "low")
        self.assertIsNotNone(finalized.observability)
        self.assertEqual(finalized.observability.semantic_outcome, "out_of_scope")
        self.assertEqual(finalized.observability.scope_class, "out_of_scope")
        self.assertEqual(finalized.observability.policy_reason, "product_scope_boundary")

    def test_finalize_out_of_scope_uses_navigation_specific_copy_when_temporarily_unsupported(self) -> None:
        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="图书馆在哪里",
                    requested_capability="place_lookup",
                )
            ),
            RoutingDecision(
                target=None,
                primary_corpus=None,
                primary_collection=None,
                intent_frame=IntentFrame(
                    capability="place_lookup",
                    task_kind="place_lookup",
                    domain_candidates=("out_of_scope",),
                    missing_slots=(),
                    risk_level="low",
                    needs_clarification=False,
                    suggested_next_action="out_of_scope",
                    personalization_mode="generic",
                    scope_class="out_of_scope",
                    policy_reason="navigation_temporarily_unsupported",
                ),
            ),
        )

        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(
            finalized.answer_text,
            "当前暂不支持校内导航或地点查询，待地图能力正式上线后再开放。",
        )
        self.assertEqual(finalized.observability.policy_reason, "navigation_temporarily_unsupported")

    def test_finalize_out_of_scope_with_invalid_prompt_output_falls_back_to_default_copy(self) -> None:
        class FakePromptExecutor:
            def compose_out_of_scope(self, packet: object):
                from campus_supervisor_core.prompt_execution import (
                    SupervisorPromptExecutionResult,
                    SupervisorTerminalPromptOutput,
                )

                return SupervisorPromptExecutionResult(
                    output=SupervisorTerminalPromptOutput(answer_text="   "),
                    prompt_trace=_supervisor_prompt_trace("supervisor_out_of_scope_v1"),
                )

        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="MIT的校长是谁",
                    requested_capability="knowledge",
                )
            ),
            RoutingDecision(
                target=None,
                primary_corpus=None,
                primary_collection=None,
                intent_frame=IntentFrame(
                    capability="knowledge",
                    task_kind="knowledge_lookup",
                    domain_candidates=("knowledge",),
                    missing_slots=(),
                    risk_level="low",
                    needs_clarification=False,
                    suggested_next_action="out_of_scope",
                    personalization_mode="generic",
                    scope_class="out_of_scope",
                    policy_reason="product_scope_boundary",
                ),
            ),
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(
            finalized.answer_text,
            "当前仅支持中央民族大学校园范围内且已开放能力面的问答，这个问题不在当前支持范围内。",
        )
        self.assertIsNone(finalized.observability.prompt_trace)

    def test_finalize_out_of_scope_projects_prompt_runtime_failure_state(self) -> None:
        class FakePromptExecutor:
            def compose_out_of_scope(self, packet: object):
                raise PromptRuntimeValidationError(
                    prompt_id="supervisor_out_of_scope_v1",
                    reason="provider_incomplete: content_filter",
                )

        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="MIT的校长是谁",
                    requested_capability="knowledge",
                )
            ),
            RoutingDecision(
                target=None,
                primary_corpus=None,
                primary_collection=None,
                intent_frame=IntentFrame(
                    capability="knowledge",
                    task_kind="knowledge_lookup",
                    domain_candidates=("knowledge",),
                    missing_slots=(),
                    risk_level="low",
                    needs_clarification=False,
                    suggested_next_action="out_of_scope",
                    personalization_mode="generic",
                    scope_class="out_of_scope",
                    policy_reason="product_scope_boundary",
                ),
            ),
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(finalized.status, "no_answer")
        self.assertIsNotNone(finalized.observability)
        self.assertEqual(finalized.observability.prompt_runtime_state, "content_filter")
        self.assertEqual(finalized.observability.prompt_runtime_detail, "content_filter")
        self.assertIsNone(finalized.observability.prompt_trace)

    def test_finalize_rejected_with_invalid_prompt_output_falls_back_to_default_copy(self) -> None:
        class FakePromptExecutor:
            def compose_reject(self, packet: object):
                from campus_supervisor_core.prompt_execution import (
                    SupervisorPromptExecutionResult,
                    SupervisorTerminalPromptOutput,
                )

                return SupervisorPromptExecutionResult(
                    output=SupervisorTerminalPromptOutput(answer_text="   "),
                    prompt_trace=_supervisor_prompt_trace("supervisor_reject_v1"),
                )

        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="请执行未授权操作",
                    requested_capability="knowledge",
                )
            ),
            RoutingDecision(
                target=None,
                primary_corpus="regulations",
                primary_collection="student_handbook",
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
            ),
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(finalized.status, "rejected")
        self.assertEqual(finalized.answer_text, "这个请求不在当前可执行范围内。")
        self.assertIsNotNone(finalized.error)
        self.assertEqual(finalized.error.code, "request_rejected")
        self.assertIsNone(finalized.observability.prompt_trace)

    def test_finalize_rejected_keeps_specific_policy_reason(self) -> None:
        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="帮我写一段话说服同学支持某个政治候选人",
                    requested_capability="knowledge",
                )
            ),
            RoutingDecision(
                target=None,
                primary_corpus=None,
                primary_collection=None,
                intent_frame=IntentFrame(
                    capability="knowledge",
                    task_kind="knowledge_lookup",
                    domain_candidates=("knowledge",),
                    missing_slots=(),
                    risk_level="high",
                    needs_clarification=False,
                    suggested_next_action="rejected",
                    personalization_mode="generic",
                    policy_reason="political_persuasion",
                ),
            ),
        )

        self.assertEqual(finalized.status, "rejected")
        self.assertIsNotNone(finalized.observability)
        self.assertEqual(finalized.observability.semantic_outcome, "policy_refusal")
        self.assertEqual(finalized.observability.policy_reason, "political_persuasion")

    def test_finalize_error_response_keeps_error_payload(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="retrieval_failed",
                message="retrieval backend unavailable",
                retryable=False,
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-specialist")
        self.assertEqual(finalized.status, "error")
        self.assertEqual(finalized.confidence, "low")
        self.assertEqual(
            finalized.error,
            ErrorInfo(
                code="retrieval_failed",
                message="retrieval backend unavailable",
                retryable=False,
            ),
        )
        self.assertIsNotNone(finalized.observability)
        self.assertIsNone(finalized.observability.retrieval_attempted)

    def test_finalize_availability_completion_keeps_non_rag_target(self) -> None:
        response = SpecialistResponse(
            target="availability-specialist",
            status="completed",
            answer_text="official-homepage timed out.",
            result=AvailabilityObservation(
                target_id="official-homepage",
                observed_status="timeout",
                failure_classification="timeout",
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "availability-specialist")
        self.assertEqual(finalized.status, "completed")
        self.assertIsNotNone(finalized.observability)
        self.assertFalse(finalized.observability.retrieval_attempted)

    def test_finalize_availability_connect_failure_keeps_completed_semantics(self) -> None:
        response = SpecialistResponse(
            target="availability-specialist",
            status="completed",
            answer_text="official-homepage observed as connect_failure.",
            result=AvailabilityObservation(
                target_id="official-homepage",
                observed_status="connect_failure",
                failure_classification="connect_failure",
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "availability-specialist")
        self.assertEqual(finalized.status, "completed")
        self.assertEqual(finalized.result.observed_status, "connect_failure")
        self.assertIsNotNone(finalized.observability)
        self.assertFalse(finalized.observability.retrieval_attempted)


if __name__ == "__main__":
    unittest.main()
