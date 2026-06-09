from __future__ import annotations

import unittest

from campus_contracts import (
    CapabilityRequest,
    CapabilityResponse,
    ErrorInfo,
    KnowledgeScope,
    RagRequestPayload,
)
from campus_supervisor_agent_worker.capability_dispatch import dispatch_capability_request


class AgentDispatchResponseTest(unittest.TestCase):
    def test_dispatch_capability_request_preserves_error_response_fields(self) -> None:
        request = CapabilityRequest(
            capability="knowledge",
            user_goal="library map",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
        )
        response = dispatch_capability_request(
            request,
            capability_delegates={
                "knowledge": lambda _request: CapabilityResponse(
                    capability="knowledge",
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

        self.assertEqual(response.capability, "knowledge")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.answer_text, "retrieval failed while checking the handbook.")
        self.assertEqual(response.follow_up_question, "Try again later?")
        self.assertEqual(
            response.error,
            ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable"),
        )
