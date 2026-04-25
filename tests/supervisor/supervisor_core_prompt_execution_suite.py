from __future__ import annotations

import unittest

from campus_contracts import (
    ErrorInfo,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorRequest,
)
from campus_supervisor_core import handle_request


class SupervisorCorePromptExecutionTest(unittest.TestCase):
    def test_handle_request_preserves_error_response_fields(self) -> None:
        request = SupervisorRequest(
            user_goal="library map",
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
            ),
        )
        response = handle_request(
            request,
            specialist_delegates={
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
            preplanned_specialist_request=SpecialistRequest(
                target="rag-agent",
                user_goal=request.user_goal,
                trace=request.trace,
                actor=request.actor,
                context=request.context,
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                ),
            ),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.answer_text, "retrieval failed while checking the handbook.")
        self.assertEqual(response.follow_up_question, "Try again later?")
        self.assertEqual(
            response.error,
            ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable"),
        )
