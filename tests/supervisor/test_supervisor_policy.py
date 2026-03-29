from __future__ import annotations

import unittest

from campus_contracts import (
    AvailabilityObservation,
    ErrorInfo,
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

        self.assertEqual(
            finalize_specialist_response(response),
            SupervisorResponse(
                selected_target="rag-specialist",
                status="completed",
                answer_text="The library is open.",
                confidence="high",
            ),
        )

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

    def test_finalize_no_answer_response_keeps_no_answer_semantics(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            confidence="low",
        )

        finalized = finalize_specialist_response(response)

        self.assertEqual(finalized.selected_target, "rag-specialist")
        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(finalized.confidence, "low")

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


if __name__ == "__main__":
    unittest.main()
