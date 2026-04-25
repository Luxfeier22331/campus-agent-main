from __future__ import annotations

import unittest

from campus_contracts import (
    ErrorInfo,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_supervisor_core import dispatch_agent_request


class SupervisorCorePromptExecutionTest(unittest.TestCase):
    def test_dispatch_agent_request_preserves_error_response_fields(self) -> None:
        request = SpecialistRequest(
            target="rag-agent",
            user_goal="library map",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
        )
        response = dispatch_agent_request(
            request,
            agent_delegates={
                "rag-agent": lambda _request: SpecialistResponse(
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

        self.assertEqual(response.target, "rag-agent")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.answer_text, "retrieval failed while checking the handbook.")
        self.assertEqual(response.follow_up_question, "Try again later?")
        self.assertEqual(
            response.error,
            ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable"),
        )
