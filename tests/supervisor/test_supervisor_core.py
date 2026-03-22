from __future__ import annotations

from dataclasses import asdict
import unittest

from campus_contracts import (
    ActorContext,
    DelegateToRagAgentRequest,
    DelegateToRagAgentResponse,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    TraceContext,
)
from campus_supervisor_core import handle_request
from campus_supervisor_core.audit import SupervisorAuditRecord, build_audit_record
from campus_supervisor_core.context import SupervisorRequestContext


def _make_completed_response() -> DelegateToRagAgentResponse:
    return DelegateToRagAgentResponse(
        status="completed",
        answer_text="The library is open from 08:00 to 22:00.",
        confidence="high",
        evidence=EvidenceBundle(
            query_text="library hours",
            corpus="student_handbook",
            sources=(
                EvidenceSource(
                    doc_id="handbook:test-001",
                    version_id="v1:test-001",
                    chunk_id="handbook:test-001:v1:test-001:chunk-0001",
                    anchor={"page_start": 12, "page_end": 12},
                    acl_level="public",
                    canonical_url="https://campus.example/handbook/test-001",
                    latest_url="https://campus.example/handbook/test-001",
                    snippet="The library is open from 08:00 to 22:00.",
                    score=0.96,
                ),
            ),
        ),
    )


def _make_no_answer_response() -> DelegateToRagAgentResponse:
    return DelegateToRagAgentResponse(
        status="no_answer",
        confidence="low",
        evidence=EvidenceBundle(query_text="library hours", corpus="student_handbook"),
    )


def _make_error_response() -> DelegateToRagAgentResponse:
    return DelegateToRagAgentResponse(
        status="error",
        confidence="low",
        error=ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable", retryable=False),
    )


class SupervisorCoreTest(unittest.TestCase):
    def test_request_context_projects_minimum_supervisor_fields(self) -> None:
        request = DelegateToRagAgentRequest(
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
        )

        context = SupervisorRequestContext.from_request(request)

        self.assertIs(context.request, request)
        self.assertEqual(context.request_id, "req-001")
        self.assertEqual(context.trace_id, "trace-001")
        self.assertEqual(context.user_id, "student-001")
        self.assertEqual(context.conversation_id, "conv-001")
        self.assertEqual(context.primary_corpus, "student_handbook")
        self.assertEqual(context.user_goal, "library hours")

    def test_handle_request_routes_request_and_emits_audit_record(self) -> None:
        captured_requests: list[DelegateToRagAgentRequest] = []
        audit_records: list[SupervisorAuditRecord] = []

        def fake_specialist(request: DelegateToRagAgentRequest) -> DelegateToRagAgentResponse:
            captured_requests.append(request)
            return _make_completed_response()

        request = DelegateToRagAgentRequest(
            user_goal="library hours",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
        )

        response = handle_request(request, specialist_delegate=fake_specialist, audit_sink=audit_records.append)

        self.assertEqual(response.status, "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0], request)
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(
            audit_records[0],
            SupervisorAuditRecord(
                request_id="req-001",
                trace_id="trace-001",
                user_id="student-001",
                status="completed",
                source_doc_ids=("handbook:test-001",),
            ),
        )

    def test_handle_request_preserves_specialist_non_completed_status(self) -> None:
        response = handle_request(
            DelegateToRagAgentRequest(user_goal="need help"),
            specialist_delegate=lambda request: DelegateToRagAgentResponse(
                status="needs_clarification",
                follow_up_question="Which campus are you asking about?",
            ),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "Which campus are you asking about?")

    def test_handle_request_shapes_needs_clarification_response_at_supervisor_boundary(self) -> None:
        response = handle_request(
            DelegateToRagAgentRequest(user_goal="need help"),
            specialist_delegate=lambda request: DelegateToRagAgentResponse(
                status="needs_clarification",
                answer_text="This should not leak.",
                follow_up_question="Which campus are you asking about?",
                error=ErrorInfo(code="ignore_me", message="ignore me"),
            ),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "Which campus are you asking about?")
        self.assertEqual(response.answer_text, "")
        self.assertIsNone(response.error)

    def test_handle_request_finalizes_no_answer_response(self) -> None:
        response = handle_request(
            DelegateToRagAgentRequest(user_goal="library map"),
            specialist_delegate=lambda request: DelegateToRagAgentResponse(
                status="no_answer",
                answer_text="This should not leak.",
                follow_up_question="This should not leak either.",
                confidence="low",
                error=ErrorInfo(code="ignore_me", message="ignore me"),
            ),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.answer_text, "")
        self.assertEqual(response.follow_up_question, "")
        self.assertIsNone(response.error)

    def test_handle_request_finalizes_error_response(self) -> None:
        response = handle_request(
            DelegateToRagAgentRequest(user_goal="library map"),
            specialist_delegate=lambda request: DelegateToRagAgentResponse(
                status="error",
                answer_text="This should not leak.",
                follow_up_question="This should not leak either.",
                confidence="low",
                error=ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable", retryable=False),
            ),
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.answer_text, "")
        self.assertEqual(response.follow_up_question, "")
        self.assertEqual(response.error, ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable"))

    def test_audit_record_serializes_minimum_fields(self) -> None:
        record = SupervisorAuditRecord(
            request_id="req-123",
            trace_id="trace-123",
            user_id="student-123",
            status="completed",
            source_doc_ids=("handbook:test-001", "handbook:test-002"),
        )

        self.assertEqual(
            asdict(record),
            {
                "request_id": "req-123",
                "trace_id": "trace-123",
                "user_id": "student-123",
                "status": "completed",
                "source_doc_ids": ("handbook:test-001", "handbook:test-002"),
            },
        )

    def test_build_audit_record_keeps_minimum_projection_for_error_response(self) -> None:
        request = DelegateToRagAgentRequest(
            user_goal="library hours",
            request_id="req-123",
            trace=TraceContext(trace_id="trace-123"),
            actor=ActorContext(user_id="student-123", groups=("students",)),
        )

        record = build_audit_record(
            request,
            DelegateToRagAgentResponse(
                status="error",
                confidence="low",
                error=ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable", retryable=False),
            ),
        )

        self.assertEqual(
            asdict(record),
            {
                "request_id": "req-123",
                "trace_id": "trace-123",
                "user_id": "student-123",
                "status": "error",
                "source_doc_ids": (),
            },
        )


if __name__ == "__main__":
    unittest.main()
