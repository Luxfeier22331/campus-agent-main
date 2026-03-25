from __future__ import annotations

from dataclasses import asdict
import unittest

from campus_contracts import (
    ActorContext,
    AvailabilityCheckPayload,
    AvailabilityObservation,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    RagRequestPayload,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
    TraceContext,
)
from campus_supervisor_core import handle_request
from campus_supervisor_core.audit import SupervisorAuditRecord, build_audit_record
from campus_supervisor_core.context import SupervisorRequestContext


def _make_rag_completed_response() -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-specialist",
        status="completed",
        answer_text="The library is open from 08:00 to 22:00.",
        confidence="high",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
                sources=(
                    EvidenceSource(
                        doc_id="handbook:test-001",
                        revision_track="source-faithful",
                        version_id="v1:test-001",
                        chunk_id="handbook:test-001:source-faithful:v1:test-001:chunk-0001",
                        anchor={"page_start": 12, "page_end": 12},
                        acl_level="public",
                        canonical_url="https://campus.example/handbook/test-001",
                        latest_url="https://campus.example/handbook/test-001",
                        source_channel="pdf_ocr",
                        collection="student_handbook",
                        is_current=False,
                        snippet="The library is open from 08:00 to 22:00.",
                        score=0.96,
                    ),
                ),
            )
        ),
    )


def _make_availability_completed_response(
    *,
    observed_status: str = "timeout",
    failure_classification: str = "timeout",
) -> SpecialistResponse:
    return SpecialistResponse(
        target="availability-specialist",
        status="completed",
        answer_text=f"official-homepage observed as {observed_status}.",
        result=AvailabilityObservation(
            target_id="official-homepage",
            observed_status=observed_status,
            failure_classification=failure_classification,
        ),
    )


class SupervisorCoreTest(unittest.TestCase):
    def test_request_context_projects_minimum_supervisor_fields(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
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
        self.assertEqual(context.primary_corpus, "regulations")
        self.assertEqual(context.primary_collection, "student_handbook")
        self.assertEqual(context.user_goal, "library hours")

    def test_handle_request_routes_rag_request_and_emits_audit_record(self) -> None:
        captured_requests: list[SpecialistRequest] = []
        audit_records: list[SupervisorAuditRecord] = []

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="library hours",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
        )

        response = handle_request(
            request,
            specialist_delegates={"rag-specialist": fake_rag_specialist},
            audit_sink=audit_records.append,
        )

        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertIs(captured_requests[0], request)
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(
            asdict(audit_records[0]),
            {
                "request_id": "req-001",
                "trace_id": "trace-001",
                "user_id": "student-001",
                "status": "completed",
                "source_doc_ids": ("handbook:test-001",),
            },
        )

    def test_handle_request_keeps_source_doc_ids_empty_for_availability_completion(self) -> None:
        audit_records: list[SupervisorAuditRecord] = []
        request = SpecialistRequest(
            target="availability-specialist",
            user_goal="官网现在能打开吗？",
            request_id="req-availability",
            trace=TraceContext(trace_id="trace-availability"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            payload=AvailabilityCheckPayload(target_id="official-homepage"),
        )

        response = handle_request(
            request,
            specialist_delegates={
                "availability-specialist": lambda inner_request: _make_availability_completed_response()
            },
            audit_sink=audit_records.append,
        )

        self.assertEqual(response.target, "availability-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(
            response.result,
            AvailabilityObservation(
                target_id="official-homepage",
                observed_status="timeout",
                failure_classification="timeout",
            ),
        )
        self.assertEqual(audit_records[0].source_doc_ids, ())

    def test_handle_request_preserves_needs_clarification_response(self) -> None:
        response = handle_request(
            SpecialistRequest(target="rag-specialist", user_goal="need help"),
            specialist_delegates={
                "rag-specialist": lambda request: SpecialistResponse(
                    target="rag-specialist",
                    status="needs_clarification",
                    follow_up_question="Which campus are you asking about?",
                )
            },
        )

        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "Which campus are you asking about?")

    def test_handle_request_raises_for_valid_route_without_delegate(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "missing delegate for specialist target: availability-specialist",
        ):
            handle_request(
                SpecialistRequest(
                    target="availability-specialist",
                    user_goal="官网现在能打开吗？",
                    payload=AvailabilityCheckPayload(target_id="official-homepage"),
                ),
                specialist_delegates={"rag-specialist": lambda request: _make_rag_completed_response()},
            )

    def test_handle_request_preserves_error_response_fields(self) -> None:
        response = handle_request(
            SpecialistRequest(target="rag-specialist", user_goal="library map"),
            specialist_delegates={
                "rag-specialist": lambda request: SpecialistResponse(
                    target="rag-specialist",
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

        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.answer_text, "retrieval failed while checking the handbook.")
        self.assertEqual(response.follow_up_question, "Try again later?")
        self.assertEqual(
            response.error,
            ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable"),
        )

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
        self.assertEqual(
            tuple(asdict(record).keys()),
            ("request_id", "trace_id", "user_id", "status", "source_doc_ids"),
        )

    def test_build_audit_record_keeps_minimum_projection_for_non_rag_response(self) -> None:
        request = SpecialistRequest(
            target="availability-specialist",
            user_goal="官网现在能打开吗？",
            request_id="req-123",
            trace=TraceContext(trace_id="trace-123"),
            actor=ActorContext(user_id="student-123", groups=("students",)),
            payload=AvailabilityCheckPayload(target_id="official-homepage"),
        )

        record = build_audit_record(
            request,
            _make_availability_completed_response(
                observed_status="connect_failure",
                failure_classification="connect_failure",
            ),
        )

        self.assertEqual(
            asdict(record),
            {
                "request_id": "req-123",
                "trace_id": "trace-123",
                "user_id": "student-123",
                "status": "completed",
                "source_doc_ids": (),
            },
        )


if __name__ == "__main__":
    unittest.main()
