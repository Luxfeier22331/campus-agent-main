from __future__ import annotations

import unittest

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistResponse,
    SupervisorObservability,
    SupervisorRequest,
    SupervisorResponse,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.intent import IntentFrame
from campus_supervisor_core.policy import finalize_routing_decision, finalize_specialist_response
from campus_supervisor_core.routing import RoutingDecision


def _terminal_decision(
    *,
    capability: str,
    task_kind: str,
    suggested_next_action: str,
    status: str,
    answer_text: str,
    semantic_outcome: str,
    policy_reason: str,
    scope_class: str = "out_of_scope",
    risk_level: str = "low",
    error: ErrorInfo | None = None,
) -> RoutingDecision:
    return RoutingDecision(
        target=None,
        primary_corpus=None,
        primary_collection=None,
        intent_frame=IntentFrame(
            capability=capability,
            task_kind=task_kind,
            domain_candidates=("out_of_scope",),
            missing_slots=(),
            risk_level=risk_level,
            needs_clarification=False,
            suggested_next_action=suggested_next_action,
            personalization_mode="generic",
            scope_class=scope_class,
            policy_reason=policy_reason,
        ),
        terminal_response=SupervisorResponse(
            selected_target=None,
            status=status,  # type: ignore[arg-type]
            answer_text=answer_text,
            confidence="low",
            error=error,
            observability=SupervisorObservability(
                retrieval_attempted=False,
                candidate_count=0,
                retrieved_source_count=0,
                citation_expected=False,
                citation_count=0,
                citation_missing=False,
                refusal_class=suggested_next_action,
                semantic_outcome=semantic_outcome,
                scope_class=scope_class,
                policy_reason=policy_reason,
                acl_decision="denied" if suggested_next_action == "rejected" else "allowed",
                fail_closed=True,
            ),
        ),
    )


class SupervisorPolicyTest(unittest.TestCase):
    def test_finalize_completed_response_keeps_completed_status(self) -> None:
        response = SpecialistResponse(
            target="rag-agent",
            status="completed",
            answer_text="The library is open.",
            confidence="high",
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-agent")
        self.assertEqual(finalized.status, "completed")
        self.assertEqual(finalized.answer_text, "The library is open.")
        self.assertEqual(finalized.confidence, "high")
        self.assertIsNotNone(finalized.observability)
        self.assertTrue(finalized.observability.citation_expected)
        self.assertTrue(finalized.observability.retrieval_attempted)

    def test_finalize_needs_clarification_response_keeps_follow_up(self) -> None:
        response = SpecialistResponse(
            target="rag-agent",
            status="needs_clarification",
            follow_up_question="Which campus are you asking about?",
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-agent")
        self.assertEqual(finalized.status, "needs_clarification")
        self.assertEqual(finalized.follow_up_question, "Which campus are you asking about?")
        self.assertIsNotNone(finalized.observability)
        self.assertFalse(finalized.observability.retrieval_attempted)

    def test_finalize_no_answer_response_keeps_no_answer_semantics(self) -> None:
        response = SpecialistResponse(
            target="rag-agent",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="国奖看第一作者单位吗？",
                ),
                diagnostics=RagResultDiagnostics(
                    no_answer_reason="resolved_policy_clause_not_found",
                ),
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-agent")
        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(finalized.confidence, "low")
        self.assertIsNotNone(finalized.observability)
        self.assertTrue(finalized.observability.retrieval_attempted)
        self.assertEqual(finalized.observability.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(finalized.observability.scope_class, "in_scope")

    def test_finalize_restricted_no_answer_projects_restricted_semantic_outcome(self) -> None:
        response = SpecialistResponse(
            target="rag-agent",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
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
            target="rag-agent",
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
            _terminal_decision(
                capability="knowledge",
                task_kind="knowledge_lookup",
                suggested_next_action="out_of_scope",
                status="no_answer",
                answer_text="Go terminal envelope: out of scope.",
                semantic_outcome="out_of_scope",
                policy_reason="product_scope_boundary",
            ),
        )

        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(finalized.confidence, "low")
        self.assertIsNotNone(finalized.observability)
        self.assertEqual(finalized.observability.semantic_outcome, "out_of_scope")
        self.assertEqual(finalized.observability.scope_class, "out_of_scope")
        self.assertEqual(finalized.observability.policy_reason, "product_scope_boundary")

    def test_finalize_out_of_scope_uses_navigation_specific_copy_when_temporarily_unsupported(
        self,
    ) -> None:
        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="图书馆在哪里",
                    requested_capability="place_lookup",
                )
            ),
            _terminal_decision(
                capability="place_lookup",
                task_kind="place_lookup",
                suggested_next_action="out_of_scope",
                status="no_answer",
                answer_text="当前暂不支持校内导航或地点查询，待地图能力正式上线后再开放。",
                semantic_outcome="out_of_scope",
                policy_reason="navigation_temporarily_unsupported",
            ),
        )

        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(
            finalized.answer_text,
            "当前暂不支持校内导航或地点查询，待地图能力正式上线后再开放。",
        )
        self.assertEqual(
            finalized.observability.policy_reason, "navigation_temporarily_unsupported"
        )

    def test_finalize_rejected_keeps_specific_policy_reason(self) -> None:
        finalized = finalize_routing_decision(
            SupervisorRequestContext.from_request(
                SupervisorRequest(
                    user_goal="帮我写一段话说服同学支持某个政治候选人",
                    requested_capability="knowledge",
                )
            ),
            _terminal_decision(
                capability="knowledge",
                task_kind="knowledge_lookup",
                suggested_next_action="rejected",
                status="rejected",
                answer_text="这个请求不在当前可执行范围内。",
                semantic_outcome="policy_refusal",
                policy_reason="political_persuasion",
                scope_class="in_scope",
                risk_level="high",
                error=ErrorInfo(
                    code="request_rejected",
                    message="request was rejected by supervisor policy",
                ),
            ),
        )

        self.assertEqual(finalized.status, "rejected")
        self.assertIsNotNone(finalized.observability)
        self.assertEqual(finalized.observability.semantic_outcome, "policy_refusal")
        self.assertEqual(finalized.observability.policy_reason, "political_persuasion")

    def test_finalize_error_response_keeps_error_payload(self) -> None:
        response = SpecialistResponse(
            target="rag-agent",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="retrieval_failed",
                message="retrieval backend unavailable",
                retryable=False,
            ),
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-agent")
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


if __name__ == "__main__":
    unittest.main()
