from __future__ import annotations

import unittest

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistResponse,
)
from campus_supervisor_core.policy import finalize_specialist_response


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
        assert finalized.observability is not None
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
        assert finalized.observability is not None
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
        assert finalized.observability is not None
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
        assert finalized.observability is not None
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
        assert finalized.observability is not None
        self.assertEqual(finalized.observability.semantic_outcome, "freshness_fail_close")
        self.assertTrue(finalized.observability.fail_closed)
        self.assertEqual(finalized.observability.scope_class, "in_scope")

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
        assert finalized.observability is not None
        self.assertIsNone(finalized.observability.retrieval_attempted)


if __name__ == "__main__":
    unittest.main()
