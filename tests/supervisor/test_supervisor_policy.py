from __future__ import annotations

import unittest

from campus_contracts import (
    AvailabilityObservation,
    EvidenceBundle,
    ErrorInfo,
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistResponse,
    SupervisorResponse,
)
from campus_supervisor_core.policy import finalize_specialist_response


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
