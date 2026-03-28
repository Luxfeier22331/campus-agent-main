from __future__ import annotations

from dataclasses import asdict
import unittest
from unittest.mock import patch

from campus_contracts import (
    ActorContext,
    AvailabilityCheckPayload,
    AvailabilityObservation,
    ContextProjection,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagRequestPayload,
    RagResultPayload,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorResponse,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core import SupervisorAgent, handle_request, handle_specialist_request
from campus_supervisor_core.audit import (
    SupervisorAuditRecord,
    build_audit_record,
    build_error_audit_record,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import DisallowedKnowledgeScopeError, MissingSpecialistDelegateError


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
        request = SupervisorRequest(
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
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
        self.assertEqual(context.context.actor.user_id, "student-001")

    def test_handle_request_routes_rag_request_and_emits_audit_record(self) -> None:
        captured_requests: list[SpecialistRequest] = []
        audit_records: list[SupervisorAuditRecord] = []

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        request = SupervisorRequest(
            user_goal="library hours",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        response = handle_request(
            request,
            specialist_delegates={"rag-specialist": fake_rag_specialist},
            audit_sink=audit_records.append,
        )

        self.assertEqual(response.selected_target, "rag-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].target, "rag-specialist")
        self.assertEqual(
            captured_requests[0].payload,
            RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
        )
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(
            asdict(audit_records[0]),
            {
                "request_id": "req-001",
                "trace_id": "trace-001",
                "user_id": "student-001",
                "selected_target": "rag-specialist",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_handbook",
                "status": "completed",
                "error_code": None,
                "source_doc_ids": ("handbook:test-001",),
            },
        )

    def test_handle_request_keeps_source_doc_ids_empty_for_availability_completion(self) -> None:
        audit_records: list[SupervisorAuditRecord] = []
        request = SupervisorRequest(
            user_goal="官网现在能打开吗？",
            request_id="req-availability",
            trace=TraceContext(trace_id="trace-availability"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            requested_capability="availability",
            availability_target_id="official-homepage",
        )

        response = handle_request(
            request,
            specialist_delegates={
                "availability-specialist": lambda inner_request: _make_availability_completed_response()
            },
            audit_sink=audit_records.append,
        )

        self.assertEqual(response.selected_target, "availability-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(
            response.result,
            AvailabilityObservation(
                target_id="official-homepage",
                observed_status="timeout",
                failure_classification="timeout",
            ),
        )
        self.assertEqual(audit_records[0].selected_target, "availability-specialist")
        self.assertEqual(audit_records[0].requested_capability, "availability")
        self.assertEqual(audit_records[0].source_doc_ids, ())

    def test_handle_request_keeps_completed_status_for_availability_connect_failure(self) -> None:
        request = SupervisorRequest(
            user_goal="官网现在能打开吗？",
            requested_capability="availability",
            availability_target_id="official-homepage",
        )

        response = handle_request(
            request,
            specialist_delegates={
                "availability-specialist": lambda inner_request: _make_availability_completed_response(
                    observed_status="connect_failure",
                    failure_classification="connect_failure",
                )
            },
        )

        self.assertEqual(response.selected_target, "availability-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "connect_failure")
        self.assertEqual(response.result.failure_classification, "connect_failure")

    def test_supervisor_default_delegate_map_includes_availability_specialist(self) -> None:
        request = SupervisorRequest(
            user_goal="官网现在能打开吗？",
            requested_capability="availability",
            availability_target_id="official-homepage",
        )
        expected_response = _make_availability_completed_response()

        with patch(
            "campus_supervisor_core.agent.delegate_to_availability_specialist",
            return_value=expected_response,
        ) as availability_delegate:
            with patch(
                "campus_supervisor_core.agent.delegate_to_rag_agent",
                side_effect=AssertionError("rag delegate should not be used"),
            ) as rag_delegate:
                response = SupervisorAgent().handle(request)

        availability_delegate.assert_called_once()
        rag_delegate.assert_not_called()
        self.assertEqual(
            response,
            SupervisorResponse(
                selected_target="availability-specialist",
                status="completed",
                answer_text=expected_response.answer_text,
                confidence=expected_response.confidence,
                result=expected_response.result,
            ),
        )

    def test_handle_request_preserves_needs_clarification_response(self) -> None:
        response = handle_request(
            SupervisorRequest(
                user_goal="need help",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                ),
            ),
            specialist_delegates={
                "rag-specialist": lambda request: SpecialistResponse(
                    target="rag-specialist",
                    status="needs_clarification",
                    follow_up_question="Which campus are you asking about?",
                )
            },
        )

        self.assertEqual(response.selected_target, "rag-specialist")
        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "Which campus are you asking about?")

    def test_handle_request_returns_supervisor_clarification_without_delegate_when_scope_is_missing(self) -> None:
        response = handle_request(
            SupervisorRequest(
                user_goal="奖学金怎么申请？",
                requested_capability="knowledge",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        groups=("students",),
                        campus_scope="north",
                    ),
                    session=SessionSummary(
                        confirmed_slots=(SessionSlot(name="policy_topic", value="奖学金", confirmed=True),),
                        turn_count=2,
                    ),
                ),
            ),
            specialist_delegates={},
        )

        self.assertEqual(
            response,
            SupervisorResponse(
                selected_target=None,
                status="needs_clarification",
                follow_up_question="请先说明你想查询的知识范围或资料集合。",
                confidence="low",
            ),
        )

    def test_handle_request_returns_approval_required_without_delegate_for_high_risk_request(self) -> None:
        audit_records: list[SupervisorAuditRecord] = []

        response = handle_request(
            SupervisorRequest(
                user_goal="帮我提交奖学金申请",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                ),
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        groups=("students",),
                        campus_scope="north",
                    ),
                    profile_memory=ProfileMemorySummary(),
                    session=SessionSummary(turn_count=1),
                ),
            ),
            specialist_delegates={},
            audit_sink=audit_records.append,
        )

        self.assertEqual(
            response,
            SupervisorResponse(
                selected_target=None,
                status="approval_required",
                answer_text="该请求涉及需要人工确认的操作，必须先经过审批。",
                confidence="low",
            ),
        )
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(audit_records[0].status, "approval_required")
        self.assertIsNone(audit_records[0].selected_target)

    def test_handle_request_raises_for_valid_route_without_delegate(self) -> None:
        with self.assertRaisesRegex(
            MissingSpecialistDelegateError,
            "missing delegate for specialist target: availability-specialist",
        ):
            handle_request(
                SupervisorRequest(
                    user_goal="官网现在能打开吗？",
                    requested_capability="availability",
                    availability_target_id="official-homepage",
                ),
                specialist_delegates={"rag-specialist": lambda request: _make_rag_completed_response()},
            )

    def test_handle_request_preserves_error_response_fields(self) -> None:
        response = handle_request(
            SupervisorRequest(
                user_goal="library map",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_handbook",
                ),
            ),
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

        self.assertEqual(response.selected_target, "rag-specialist")
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
            selected_target="rag-specialist",
            requested_capability="knowledge",
            requested_scope_corpus="regulations",
            requested_scope_collection="student_handbook",
            status="completed",
            error_code=None,
            source_doc_ids=("handbook:test-001", "handbook:test-002"),
        )

        self.assertEqual(
            asdict(record),
            {
                "request_id": "req-123",
                "trace_id": "trace-123",
                "user_id": "student-123",
                "selected_target": "rag-specialist",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_handbook",
                "status": "completed",
                "error_code": None,
                "source_doc_ids": ("handbook:test-001", "handbook:test-002"),
            },
        )
        self.assertEqual(
            tuple(asdict(record).keys()),
            (
                "request_id",
                "trace_id",
                "user_id",
                "selected_target",
                "requested_capability",
                "requested_scope_corpus",
                "requested_scope_collection",
                "status",
                "error_code",
                "source_doc_ids",
            ),
        )

    def test_build_audit_record_omits_context_projection_and_memory_fields(self) -> None:
        request = SupervisorRequest(
            user_goal="保研政策怎么准备？",
            request_id="req-context-001",
            trace=TraceContext(trace_id="trace-context-001"),
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    groups=("students",),
                    campus_scope="north",
                    cohort="2023",
                    major="philosophy",
                ),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="咨询保研",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                            last_verified_at="2026-03-28",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(SessionSlot(name="policy_topic", value="推免资格", confirmed=True),),
                    turn_count=3,
                ),
            ),
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        record = build_audit_record(
            request,
            SupervisorResponse(
                selected_target=None,
                status="approval_required",
                answer_text="该请求涉及需要人工确认的操作，必须先经过审批。",
                confidence="low",
            ),
        )

        payload = asdict(record)

        self.assertEqual(
            payload,
            {
                "request_id": "req-context-001",
                "trace_id": "trace-context-001",
                "user_id": "student-001",
                "selected_target": None,
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_handbook",
                "status": "approval_required",
                "error_code": None,
                "source_doc_ids": (),
            },
        )
        for forbidden_key in (
            "principal_id",
            "roles",
            "groups",
            "campus_scope",
            "cohort",
            "major",
            "program",
            "context",
            "profile_memory",
            "session",
            "memory",
            "confirmed_slots",
            "raw_transcript",
        ):
            self.assertNotIn(forbidden_key, payload)

    def test_build_audit_record_keeps_minimum_projection_for_non_rag_response(self) -> None:
        request = SupervisorRequest(
            user_goal="官网现在能打开吗？",
            request_id="req-123",
            trace=TraceContext(trace_id="trace-123"),
            actor=ActorContext(user_id="student-123", groups=("students",)),
            requested_capability="availability",
            availability_target_id="official-homepage",
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
                "selected_target": "availability-specialist",
                "requested_capability": "availability",
                "requested_scope_corpus": None,
                "requested_scope_collection": None,
                "status": "completed",
                "error_code": None,
                "source_doc_ids": (),
            },
        )

    def test_build_error_audit_record_preserves_request_projection_and_error_code(self) -> None:
        request = SupervisorRequest(
            user_goal="培养方案要求",
            request_id="req-err-001",
            trace=TraceContext(trace_id="trace-err-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            requested_scope=KnowledgeScope(
                corpus="curriculum",
                collection="curriculum_plan",
            ),
        )

        record = build_error_audit_record(
            request,
            error_code=DisallowedKnowledgeScopeError.error_code,
        )

        self.assertEqual(
            asdict(record),
            {
                "request_id": "req-err-001",
                "trace_id": "trace-err-001",
                "user_id": "student-001",
                "selected_target": "rag-specialist",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "curriculum",
                "requested_scope_collection": "curriculum_plan",
                "status": "error",
                "error_code": "disallowed_knowledge_scope",
                "source_doc_ids": (),
            },
        )

    def test_handle_specialist_request_preserves_internal_delegate_seam(self) -> None:
        request = SpecialistRequest(
            target="availability-specialist",
            user_goal="官网现在能打开吗？",
            payload=AvailabilityCheckPayload(target_id="official-homepage"),
        )

        response = handle_specialist_request(
            request,
            specialist_delegates={
                "availability-specialist": lambda inner_request: _make_availability_completed_response(
                    observed_status="ok",
                    failure_classification="",
                )
            },
        )

        self.assertEqual(response.target, "availability-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "ok")


if __name__ == "__main__":
    unittest.main()
