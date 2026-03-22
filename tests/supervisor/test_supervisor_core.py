from __future__ import annotations

from dataclasses import asdict
import unittest

from campus_contracts import (
    ActorContext,
    DelegateToRagAgentRequest,
    DelegateToRagAgentResponse,
    EvidenceBundle,
    EvidenceSource,
    TraceContext,
)
from campus_supervisor_core import handle_request
from campus_supervisor_core.audit import SupervisorAuditRecord


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


class SupervisorCoreTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
