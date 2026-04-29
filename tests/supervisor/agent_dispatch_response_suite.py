from __future__ import annotations

import unittest

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    ErrorInfo,
    KnowledgeScope,
    RagRequestPayload,
)
from campus_supervisor_agent_worker.agent_dispatch import dispatch_agent_request


class AgentDispatchResponseTest(unittest.TestCase):
    def test_dispatch_agent_request_preserves_error_response_fields(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="library map",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
        )
        response = dispatch_agent_request(
            request,
            agent_delegates={
                "rag-agent": lambda _request: AgentResponse(
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
