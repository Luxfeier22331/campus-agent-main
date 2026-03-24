from __future__ import annotations

import unittest

from campus_contracts import DelegateToRagAgentResponse, ErrorInfo
from campus_supervisor_core.policy import finalize_specialist_response


class SupervisorPolicyTest(unittest.TestCase):
    def test_finalize_completed_response_keeps_completed_status(self) -> None:
        response = DelegateToRagAgentResponse(status="completed", answer_text="The library is open.", confidence="high")

        self.assertIs(finalize_specialist_response(response), response)

    def test_finalize_needs_clarification_response_keeps_follow_up(self) -> None:
        response = DelegateToRagAgentResponse(
            status="needs_clarification",
            follow_up_question="Which campus are you asking about?",
        )

        finalized = finalize_specialist_response(response)

        self.assertIs(finalized, response)
        self.assertEqual(finalized.status, "needs_clarification")
        self.assertEqual(finalized.follow_up_question, "Which campus are you asking about?")

    def test_finalize_no_answer_response_keeps_no_answer_semantics(self) -> None:
        response = DelegateToRagAgentResponse(status="no_answer", confidence="low")

        finalized = finalize_specialist_response(response)

        self.assertIs(finalized, response)
        self.assertEqual(finalized.status, "no_answer")
        self.assertEqual(finalized.confidence, "low")

    def test_finalize_error_response_keeps_error_payload(self) -> None:
        response = DelegateToRagAgentResponse(
            status="error",
            confidence="low",
            error=ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable", retryable=False),
        )

        finalized = finalize_specialist_response(response)

        self.assertIs(finalized, response)
        self.assertEqual(finalized.status, "error")
        self.assertEqual(finalized.confidence, "low")
        self.assertEqual(
            finalized.error,
            ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable", retryable=False),
        )


if __name__ == "__main__":
    unittest.main()
