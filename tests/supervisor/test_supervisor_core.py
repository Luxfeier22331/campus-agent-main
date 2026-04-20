from __future__ import annotations

from dataclasses import asdict
import unittest
from unittest.mock import patch

from campus_contracts import (
    ActorContext,
    AuthorizedRetrievalFilter,
    AuthorizationProjection,
    AvailabilityCheckPayload,
    AvailabilityObservation,
    CampusNoticeDiscoverPayload,
    ContextProjection,
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    CurriculumFollowUpSlots,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    PromptTrace,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorObservability,
    SupervisorResponse,
    SupervisorRequest,
    TemporalQuery,
    TraceContext,
)
from campus_supervisor_core import SupervisorAgent, handle_request, handle_specialist_request
from campus_supervisor_core.audit import (
    SupervisorAuditRecord,
    build_audit_record,
    build_error_audit_record,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import (
    DisallowedKnowledgeScopeError,
    InvalidSpecialistToolPolicyError,
    MissingSpecialistDelegateError,
)
from campus_supervisor_core.policy import finalize_routing_decision
from campus_supervisor_core.prompt_execution import (
    SupervisorClarifyPromptOutput,
    SupervisorPromptExecutionResult,
    SupervisorTerminalPromptOutput,
)
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec
from campus_supervisor_core.intent import IntentFrame
from campus_supervisor_core.response import build_supervisor_observability_from_specialist_response
from campus_supervisor_core.routing import RoutingDecision


def _supervisor_prompt_trace(prompt_id: str) -> PromptTrace:
    spec = get_supervisor_prompt_spec(prompt_id)
    return PromptTrace(
        prompt_id=prompt_id,
        prompt_version=prompt_id.rsplit("_", 1)[-1],
        template_sha256=spec.template_sha256,
        variables_schema_version=spec.variables_schema_version,
        output_schema_version=spec.output_schema_version,
        model_provider="openai-responses",
        model_name="gpt-5.2",
    )


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


def _make_curriculum_course_facts_response() -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-specialist",
        status="completed",
        answer_text="根据培养方案和课程教学计划，习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)；当前还不能稳定确认开课学院。",
        confidence="high",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="习概哪个学院开，第几学期开",
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.96,
                    ),
                ),
            )
        ),
    )


class SupervisorCoreTest(unittest.TestCase):
    def test_build_supervisor_observability_keeps_raw_retrieved_sources_separate_from_supporting_sources(self) -> None:
        support_source = EvidenceSource(
            doc_id="curriculum:法学（民族实验班）本科人才培养方案",
            revision_track="source-faithful",
            version_id="v1:support",
            chunk_id="chunk-support",
            anchor={"page_start": 1, "page_end": 1},
            canonical_url="https://campus.example/curriculum/law",
            latest_url="https://campus.example/curriculum/law",
            source_channel="pdf_ocr",
            collection="curriculum_plan",
            is_current=True,
            snippet="第四学期开设侵权责任法。",
            score=0.96,
            source_title="法学（民族实验班）本科人才培养方案",
        )
        raw_background = EvidenceSource(
            doc_id="curriculum:培养方案说明",
            revision_track="source-faithful",
            version_id="v1:background",
            chunk_id="chunk-background",
            anchor={"page_start": 2, "page_end": 2},
            canonical_url="https://campus.example/curriculum/background",
            latest_url="https://campus.example/curriculum/background",
            source_channel="pdf_ocr",
            collection="curriculum_plan",
            is_current=True,
            snippet="培养方案说明包含通识课程要求。",
            score=0.72,
            source_title="培养方案说明",
        )
        response = SpecialistResponse(
            target="rag-specialist",
            status="completed",
            answer_text="第四学期开设侵权责任法。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="法学民族班大二下有什么课",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(support_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(support_source, raw_background),
                ),
            ),
        )

        observability = build_supervisor_observability_from_specialist_response(response)

        self.assertEqual(observability.candidate_count, 2)
        self.assertEqual(observability.retrieved_source_count, 2)
        self.assertEqual(observability.citation_count, 1)
        self.assertEqual(
            tuple(source.chunk_id for source in observability.retrieved_sources),
            ("chunk-support", "chunk-background"),
        )

    def test_build_supervisor_observability_does_not_mirror_supporting_sources_for_clarification(self) -> None:
        support_source = EvidenceSource(
            doc_id="curriculum:法学（民族实验班）本科人才培养方案",
            revision_track="source-faithful",
            version_id="v1:support",
            chunk_id="chunk-support",
            anchor={"page_start": 1, "page_end": 1},
            canonical_url="https://campus.example/curriculum/law",
            latest_url="https://campus.example/curriculum/law",
            source_channel="pdf_ocr",
            collection="curriculum_plan",
            is_current=True,
            snippet="请明确是法学民族实验班还是其他法学培养方案。",
            score=0.96,
            source_title="法学（民族实验班）本科人才培养方案",
        )
        response = SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            answer_text="请明确是法学民族实验班还是其他法学培养方案。",
            follow_up_question="请明确是法学民族实验班还是其他法学培养方案。",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="法学培养方案",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(support_source,),
                ),
                diagnostics=RagResultDiagnostics(),
            ),
        )

        observability = build_supervisor_observability_from_specialist_response(response)

        self.assertFalse(observability.retrieval_attempted)
        self.assertEqual(observability.candidate_count, 0)
        self.assertEqual(observability.retrieved_source_count, 0)
        self.assertEqual(observability.retrieved_sources, ())
        self.assertEqual(observability.citation_count, 0)

    def test_build_supervisor_observability_marks_course_map_fail_close_as_no_retrieval(self) -> None:
        response = SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            answer_text="当前还不能稳定解析培养方案里的课程地图/拓扑图。",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(),
                ),
                diagnostics=RagResultDiagnostics(
                    no_answer_reason="curriculum_course_map_unsupported",
                    semantic_outcome="unsupported_scope",
                    retrieval_adequacy_verdict="insufficient",
                    retrieval_adequacy_reason="unsupported_query_type",
                ),
            ),
        )

        observability = build_supervisor_observability_from_specialist_response(response)

        self.assertFalse(observability.retrieval_attempted)
        self.assertEqual(observability.candidate_count, 0)
        self.assertEqual(observability.retrieved_source_count, 0)
        self.assertEqual(observability.retrieved_sources, ())

    def test_request_context_projects_minimum_supervisor_fields(self) -> None:
        request = SupervisorRequest(
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001"),
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

    def test_request_context_personalization_hint_exposes_curriculum_follow_up_slots(self) -> None:
        request = SupervisorRequest(
            user_goal="法学",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name=CURRICULUM_PROGRAM_FAMILY_SLOT_NAME, value="民族实验班", confirmed=True),
                        SessionSlot(name=CURRICULUM_PROGRAM_SLOT_NAME, value="法学民族实验班", confirmed=True),
                        SessionSlot(name=CURRICULUM_SEMESTER_SLOT_NAME, value="第四学期", confirmed=True),
                    ),
                    turn_count=4,
                ),
            ),
            requested_scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
        )

        context = SupervisorRequestContext.from_request(request)

        self.assertEqual(
            context.personalization_hint.curriculum_follow_up,
            CurriculumFollowUpSlots(
                program_family="民族实验班",
                program="法学民族实验班",
                semester="第四学期",
            ),
        )

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
            actor=ActorContext(user_id="student-001"),
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
                "principal_type": "",
                "authorization_projection_source": "",
                "entitlement_snapshot_id": "",
                "policy_projection_version": "phase1-authorization-projection-v1",
                "personalization_mode": "generic",
                "selected_target": "rag-specialist",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_handbook",
                "status": "completed",
                "error_code": None,
                "source_doc_ids": ("handbook:test-001",),
                "evidence_source_count": 1,
                "follow_up_emitted": False,
                "fail_closed": False,
            },
        )

    def test_handle_request_keeps_curriculum_scope_but_allows_internal_course_facts_evidence(self) -> None:
        captured_requests: list[SpecialistRequest] = []

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_curriculum_course_facts_response()

        response = handle_request(
            SupervisorRequest(
                user_goal="习概哪个学院开，第几学期开",
                request_id="req-curriculum-course-facts-001",
                trace=TraceContext(trace_id="trace-curriculum-course-facts-001"),
                actor=ActorContext(user_id="student-001"),
                requested_scope=KnowledgeScope(
                    corpus="curriculum",
                    collection="curriculum_plan",
                ),
            ),
            specialist_delegates={"rag-specialist": fake_rag_specialist},
        )

        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].payload,
            RagRequestPayload(scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")),
        )
        self.assertEqual(response.selected_target, "rag-specialist")
        self.assertEqual(response.status, "completed")
        assert isinstance(response.result, RagResultPayload)
        self.assertEqual(response.result.evidence.collection, "course_facts")
        self.assertEqual(response.result.evidence.corpus, "curriculum")
        self.assertIn("当前还不能稳定确认开课学院", response.answer_text)

    def test_handle_request_delegates_knowledge_without_explicit_scope_to_rag_specialist(self) -> None:
        captured_requests: list[SpecialistRequest] = []
        request_context = ContextProjection(
            actor=ActorContext(
                user_id="student-001",
                principal_id="principal-001",
            ),
            profile_memory=ProfileMemorySummary(
                items=(
                    ProfileMemoryItem(
                        item_id="memory-001",
                        key="recent_goal",
                        value="奖学金申请",
                        source_type="user_declared",
                        confidence="high",
                        visibility="user_visible",
                        last_verified_at="2026-04-02",
                    ),
                ),
            ),
            session=SessionSummary(
                confirmed_slots=(SessionSlot(name="policy_topic", value="奖学金", confirmed=True),),
                turn_count=2,
            ),
        )

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        response = handle_request(
            SupervisorRequest(
                user_goal="民族学本科人才培养方案总学分要求是多少？",
                request_id="req-unscoped-knowledge-001",
                trace=TraceContext(trace_id="trace-unscoped-knowledge-001"),
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                ),
                requested_capability="knowledge",
                context=request_context,
            ),
            specialist_delegates={"rag-specialist": fake_rag_specialist},
            audit_sink=lambda _record: None,
        )

        self.assertEqual(response.selected_target, "rag-specialist")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].payload, RagRequestPayload(scope=None))
        self.assertEqual(captured_requests[0].context, request_context)

    def test_handle_request_keeps_source_doc_ids_empty_for_availability_completion(self) -> None:
        audit_records: list[SupervisorAuditRecord] = []
        request = SupervisorRequest(
            user_goal="官网现在能打开吗？",
            request_id="req-availability",
            trace=TraceContext(trace_id="trace-availability"),
            actor=ActorContext(user_id="student-001"),
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
                "campus_supervisor_core.agent._delegate_to_rag_specialist",
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
                observability=SupervisorObservability(
                    retrieval_attempted=False,
                    candidate_count=0,
                    retrieved_source_count=0,
                    citation_expected=False,
                    citation_count=0,
                    citation_missing=False,
                    acl_decision="allowed",
                    fail_closed=False,
                ),
            ),
        )

    def test_supervisor_default_delegate_map_includes_forward_runtime_agents(self) -> None:
        delegates = SupervisorAgent().specialist_delegates

        self.assertIn("campus-services-agent", delegates)
        self.assertIn("notice-agent", delegates)

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

    def test_handle_request_raises_missing_rag_delegate_when_scope_is_missing(self) -> None:
        with self.assertRaisesRegex(
            MissingSpecialistDelegateError,
            "missing delegate for specialist target: rag-specialist",
        ):
            handle_request(
                SupervisorRequest(
                    user_goal="奖学金怎么申请？",
                    requested_capability="knowledge",
                    context=ContextProjection(
                        actor=ActorContext(
                            user_id="student-001",
                            principal_id="principal-001",
                        ),
                        session=SessionSummary(
                            confirmed_slots=(SessionSlot(name="policy_topic", value="奖学金", confirmed=True),),
                            turn_count=2,
                        ),
                    ),
                ),
                specialist_delegates={},
            )

    def test_handle_request_preserves_specialist_clarification_when_scope_is_missing(self) -> None:
        captured_requests: list[SpecialistRequest] = []
        request_context = ContextProjection(
            actor=ActorContext(
                user_id="student-001",
                principal_id="principal-001",
            ),
            profile_memory=ProfileMemorySummary(
                items=(
                    ProfileMemoryItem(
                        item_id="memory-001",
                        key="recent_goal",
                        value="奖学金申请",
                        source_type="user_declared",
                        confidence="high",
                        visibility="user_visible",
                        last_verified_at="2026-04-02",
                    ),
                ),
            ),
            session=SessionSummary(
                confirmed_slots=(SessionSlot(name="policy_topic", value="奖学金", confirmed=True),),
                turn_count=2,
            ),
        )

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="rag-specialist",
                status="needs_clarification",
                follow_up_question="请说明你想咨询哪一类奖学金。",
            )

        response = handle_request(
            SupervisorRequest(
                user_goal="这个流程怎么办？",
                requested_capability="knowledge",
                context=request_context,
            ),
            specialist_delegates={"rag-specialist": fake_rag_specialist},
        )

        self.assertEqual(response.selected_target, "rag-specialist")
        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "请说明你想咨询哪一类奖学金。")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].payload, RagRequestPayload(scope=None))
        self.assertEqual(captured_requests[0].context, request_context)

    def test_handle_request_does_not_fallback_to_supervisor_clarification_for_internal_only_memory(self) -> None:
        with self.assertRaisesRegex(
            MissingSpecialistDelegateError,
            "missing delegate for specialist target: rag-specialist",
        ):
            handle_request(
                SupervisorRequest(
                    user_goal="这个流程怎么办？",
                    requested_capability="knowledge",
                    context=ContextProjection(
                        actor=ActorContext(
                            user_id="student-001",
                            principal_id="principal-001",
                        ),
                        profile_memory=ProfileMemorySummary(
                            items=(
                                ProfileMemoryItem(
                                    item_id="memory-001",
                                    key="recent_goal",
                                    value="处分申诉",
                                    source_type="system_inferred",
                                    confidence="high",
                                    visibility="internal_only",
                                    last_verified_at="2026-04-02",
                                ),
                            ),
                        ),
                    ),
                ),
                specialist_delegates={},
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
                observability=SupervisorObservability(
                    retrieval_attempted=False,
                    candidate_count=0,
                    retrieved_source_count=0,
                    citation_expected=False,
                    citation_count=0,
                    citation_missing=False,
                    refusal_class="approval_required",
                    semantic_outcome="approval_required",
                    policy_reason="approval_required",
                    acl_decision="approval_required",
                    fail_closed=True,
                ),
            ),
        )
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(audit_records[0].status, "approval_required")
        self.assertIsNone(audit_records[0].selected_target)

    def test_handle_request_returns_out_of_scope_without_delegate_for_obvious_external_query(self) -> None:
        delegate_called = False
        audit_records: list[SupervisorAuditRecord] = []

        def fake_rag_specialist(_request: SpecialistRequest) -> SpecialistResponse:
            nonlocal delegate_called
            delegate_called = True
            return _make_rag_completed_response()

        response = handle_request(
            SupervisorRequest(
                user_goal="MIT的校长是谁",
                requested_capability="knowledge",
            ),
            specialist_delegates={"rag-specialist": fake_rag_specialist},
            audit_sink=audit_records.append,
        )

        self.assertFalse(delegate_called)
        self.assertEqual(response.selected_target, None)
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.observability.semantic_outcome, "out_of_scope")
        self.assertEqual(response.observability.scope_class, "out_of_scope")
        self.assertEqual(response.observability.policy_reason, "product_scope_boundary")
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(audit_records[0].status, "no_answer")
        self.assertIsNone(audit_records[0].selected_target)

    def test_handle_request_fail_closes_navigation_queries_before_delegate(self) -> None:
        delegate_called = False
        audit_records: list[SupervisorAuditRecord] = []

        def fake_navigation_specialist(_request: SpecialistRequest) -> SpecialistResponse:
            nonlocal delegate_called
            delegate_called = True
            return _make_availability_completed_response()

        response = handle_request(
            SupervisorRequest(
                user_goal="图书馆在哪里",
                requested_capability="place_lookup",
            ),
            specialist_delegates={"navigation-specialist": fake_navigation_specialist},
            audit_sink=audit_records.append,
        )

        self.assertFalse(delegate_called)
        self.assertEqual(response.selected_target, None)
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(
            response.answer_text,
            "当前暂不支持校内导航或地点查询，待地图能力正式上线后再开放。",
        )
        self.assertEqual(response.observability.semantic_outcome, "out_of_scope")
        self.assertEqual(response.observability.policy_reason, "navigation_temporarily_unsupported")
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(audit_records[0].status, "no_answer")
        self.assertIsNone(audit_records[0].selected_target)

    def test_finalize_routing_decision_uses_injected_prompt_executor_for_clarification(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="民族实验班有什么课",
                request_id="req-clarify-exec-001",
                requested_capability="knowledge",
            )
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="knowledge_lookup",
                domain_candidates=("knowledge",),
                missing_slots=("requested_scope",),
                risk_level="low",
                needs_clarification=True,
                suggested_next_action="clarify",
                personalization_mode="generic",
                clarification_subject="民族实验班",
            ),
        )

        class FakePromptExecutor:
            def compose_clarify(self, packet: object) -> SupervisorPromptExecutionResult[SupervisorClarifyPromptOutput]:
                return SupervisorPromptExecutionResult(
                    output=SupervisorClarifyPromptOutput(
                        follow_up_question="请先说清楚你想查哪一类培养方案资料。"
                    ),
                    prompt_trace=_supervisor_prompt_trace("supervisor_clarify_v1"),
                )

        response = finalize_routing_decision(
            context,
            decision,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "请先说清楚你想查哪一类培养方案资料。")
        self.assertEqual(response.observability.prompt_trace.prompt_id, "supervisor_clarify_v1")

    def test_finalize_routing_decision_uses_injected_prompt_executor_for_rejected(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="请执行未授权操作",
                request_id="req-reject-exec-001",
                requested_capability="knowledge",
            )
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus="regulations",
            primary_collection="student_handbook",
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="unknown",
                domain_candidates=("knowledge",),
                missing_slots=(),
                risk_level="high",
                needs_clarification=False,
                suggested_next_action="rejected",
                personalization_mode="generic",
            ),
        )

        class FakePromptExecutor:
            def compose_reject(self, packet: object) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
                return SupervisorPromptExecutionResult(
                    output=SupervisorTerminalPromptOutput(
                        answer_text="这个请求不在当前可执行范围内。"
                    ),
                    prompt_trace=_supervisor_prompt_trace("supervisor_reject_v1"),
                )

        response = finalize_routing_decision(
            context,
            decision,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "rejected")
        self.assertEqual(response.answer_text, "这个请求不在当前可执行范围内。")
        self.assertEqual(response.error.code, "request_rejected")
        self.assertEqual(response.observability.prompt_trace.prompt_id, "supervisor_reject_v1")

    def test_finalize_routing_decision_uses_injected_prompt_executor_for_out_of_scope(self) -> None:
        context = SupervisorRequestContext.from_request(
            SupervisorRequest(
                user_goal="MIT的校长是谁",
                request_id="req-out-of-scope-exec-001",
                requested_capability="knowledge",
            )
        )
        decision = RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=IntentFrame(
                capability="knowledge",
                task_kind="knowledge_lookup",
                domain_candidates=("out_of_scope",),
                missing_slots=(),
                risk_level="low",
                needs_clarification=False,
                suggested_next_action="out_of_scope",
                personalization_mode="generic",
                scope_class="out_of_scope",
                policy_reason="product_scope_boundary",
            ),
        )

        class FakePromptExecutor:
            def compose_out_of_scope(self, packet: object) -> SupervisorPromptExecutionResult[SupervisorTerminalPromptOutput]:
                return SupervisorPromptExecutionResult(
                    output=SupervisorTerminalPromptOutput(
                        answer_text="这个问题不属于当前支持的中央民族大学校园问答范围。"
                    ),
                    prompt_trace=_supervisor_prompt_trace("supervisor_out_of_scope_v1"),
                )

        response = finalize_routing_decision(
            context,
            decision,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.answer_text, "这个问题不属于当前支持的中央民族大学校园问答范围。")
        self.assertEqual(response.observability.prompt_trace.prompt_id, "supervisor_out_of_scope_v1")

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
            principal_type="student",
            authorization_projection_source="campus_identity",
            entitlement_snapshot_id="entitlements-2026-03-29",
            policy_projection_version="phase1-authorization-projection-v1",
            personalization_mode="user_grounded",
            selected_target="rag-specialist",
            requested_capability="knowledge",
            requested_scope_corpus="regulations",
            requested_scope_collection="student_handbook",
            status="completed",
            error_code=None,
            source_doc_ids=("handbook:test-001", "handbook:test-002"),
            evidence_source_count=2,
            follow_up_emitted=False,
            fail_closed=False,
        )

        self.assertEqual(
            asdict(record),
            {
                "request_id": "req-123",
                "trace_id": "trace-123",
                "user_id": "student-123",
                "principal_type": "student",
                "authorization_projection_source": "campus_identity",
                "entitlement_snapshot_id": "entitlements-2026-03-29",
                "policy_projection_version": "phase1-authorization-projection-v1",
                "personalization_mode": "user_grounded",
                "selected_target": "rag-specialist",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_handbook",
                "status": "completed",
                "error_code": None,
                "source_doc_ids": ("handbook:test-001", "handbook:test-002"),
                "evidence_source_count": 2,
                "follow_up_emitted": False,
                "fail_closed": False,
            },
        )
        self.assertEqual(
            tuple(asdict(record).keys()),
            (
                "request_id",
                "trace_id",
                "user_id",
                "principal_type",
                "authorization_projection_source",
                "entitlement_snapshot_id",
                "policy_projection_version",
                "personalization_mode",
                "selected_target",
                "requested_capability",
                "requested_scope_corpus",
                "requested_scope_collection",
                "status",
                "error_code",
                "source_doc_ids",
                "evidence_source_count",
                "follow_up_emitted",
                "fail_closed",
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
                    principal_type="student",
                    cohort="2023",
                    major="philosophy",
                ),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    projection_source="campus_identity",
                    entitlement_snapshot_id="entitlements-2026-03-29",
                    entitlement_groups=("students",),
                    visibility_scope="north",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=("students",),
                        visibility_level="restricted",
                        visibility_scope="north",
                        policy_projection_version="phase1-authorization-projection-v1",
                    ),
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
                "principal_type": "student",
                "authorization_projection_source": "campus_identity",
                "entitlement_snapshot_id": "entitlements-2026-03-29",
                "policy_projection_version": "phase1-authorization-projection-v1",
                "personalization_mode": "user_grounded",
                "selected_target": None,
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_handbook",
                "status": "approval_required",
                "error_code": None,
                "source_doc_ids": (),
                "evidence_source_count": 0,
                "follow_up_emitted": False,
                "fail_closed": False,
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
            "entitlement_groups",
            "visibility_scope",
            "approval_state",
            "retrieval_filter",
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
            actor=ActorContext(user_id="student-123"),
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
                "principal_type": "",
                "authorization_projection_source": "",
                "entitlement_snapshot_id": "",
                "policy_projection_version": "phase1-authorization-projection-v1",
                "personalization_mode": "generic",
                "selected_target": "availability-specialist",
                "requested_capability": "availability",
                "requested_scope_corpus": None,
                "requested_scope_collection": None,
                "status": "completed",
                "error_code": None,
                "source_doc_ids": (),
                "evidence_source_count": 0,
                "follow_up_emitted": False,
                "fail_closed": False,
            },
        )

    def test_build_error_audit_record_preserves_request_projection_and_error_code(self) -> None:
        request = SupervisorRequest(
            user_goal="培养方案要求",
            request_id="req-err-001",
            trace=TraceContext(trace_id="trace-err-001"),
            actor=ActorContext(
                user_id="student-001",
                principal_id="principal-001",
                principal_type="student",
            ),
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    principal_type="student",
                ),
                authorization=AuthorizationProjection(
                    principal_id="principal-001",
                    projection_source="campus_identity",
                    entitlement_snapshot_id="entitlements-2026-03-29",
                    entitlement_groups=("students",),
                    visibility_scope="north",
                    retrieval_filter=AuthorizedRetrievalFilter(
                        entitlement_groups=("students",),
                        visibility_level="restricted",
                        visibility_scope="north",
                        policy_projection_version="phase1-authorization-projection-v1",
                    ),
                ),
            ),
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
                "principal_type": "student",
                "authorization_projection_source": "campus_identity",
                "entitlement_snapshot_id": "entitlements-2026-03-29",
                "policy_projection_version": "phase1-authorization-projection-v1",
                "personalization_mode": "cohort_grounded",
                "selected_target": "rag-specialist",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "curriculum",
                "requested_scope_collection": "curriculum_plan",
                "status": "error",
                "error_code": "disallowed_knowledge_scope",
                "source_doc_ids": (),
                "evidence_source_count": 0,
                "follow_up_emitted": False,
                "fail_closed": True,
            },
        )

    def test_build_audit_record_marks_clarification_follow_up(self) -> None:
        request = SupervisorRequest(
            user_goal="奖学金怎么申请？",
            request_id="req-clarify-001",
            trace=TraceContext(trace_id="trace-clarify-001"),
            actor=ActorContext(user_id="student-001"),
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        record = build_audit_record(
            request,
            SupervisorResponse(
                selected_target="rag-specialist",
                status="needs_clarification",
                follow_up_question="请说明你想咨询哪一类奖学金。",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="奖学金怎么申请？",
                        corpus="regulations",
                        collection="student_handbook",
                    )
                ),
            ),
        )

        self.assertEqual(record.evidence_source_count, 0)
        self.assertTrue(record.follow_up_emitted)
        self.assertFalse(record.fail_closed)

    def test_build_audit_record_marks_no_answer_as_fail_closed(self) -> None:
        request = SupervisorRequest(
            user_goal="校内宇宙签证办理处",
            request_id="req-no-answer-001",
            trace=TraceContext(trace_id="trace-no-answer-001"),
            actor=ActorContext(user_id="student-001"),
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        record = build_audit_record(
            request,
            SupervisorResponse(
                selected_target="rag-specialist",
                status="no_answer",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="校内宇宙签证办理处",
                        corpus="regulations",
                        collection="student_handbook",
                    )
                ),
            ),
        )

        self.assertEqual(record.evidence_source_count, 0)
        self.assertFalse(record.follow_up_emitted)
        self.assertTrue(record.fail_closed)

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

    def test_handle_request_preserves_structured_runtime_handoff_allowed_tools(self) -> None:
        captured_requests: list[SpecialistRequest] = []

        def fake_campus_services_agent(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="campus-services-agent",
                status="completed",
                answer_text="海淀校区图书馆当前开放到 22:00。",
                confidence="high",
                result=ServiceStatusLookupResult(
                    subject_query="图书馆今天开门吗",
                    outcome="resolved_current",
                    resolved_subject="海淀校区图书馆",
                    observed_status="open",
                    queried_time_anchor="2026-04-21T10:30:00+08:00",
                    effective_from="2026-04-21T08:00:00+08:00",
                    effective_until="2026-04-21T22:00:00+08:00",
                ),
            )

        with patch(
            "campus_supervisor_core.agent.route_request",
            return_value=RoutingDecision(
                target="campus-services-agent",
                primary_corpus=None,
                primary_collection=None,
                intent_frame=IntentFrame(
                    capability="knowledge",
                    task_kind="knowledge_lookup",
                    domain_candidates=("campus_services",),
                    missing_slots=(),
                    risk_level="low",
                    needs_clarification=False,
                    suggested_next_action="delegate",
                    scope_class="in_scope",
                ),
                specialist_payload=ServiceStatusLookupPayload(
                    subject_query="图书馆今天开门吗",
                    temporal_query=TemporalQuery(mode="current"),
                    campus_scope="haidian",
                ),
                allowed_tools=("service_status_lookup",),
            ),
        ):
            response = handle_request(
                SupervisorRequest(
                    user_goal="图书馆今天开门吗",
                    requested_capability="knowledge",
                ),
                specialist_delegates={"campus-services-agent": fake_campus_services_agent},
            )

        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].target, "campus-services-agent")
        self.assertEqual(captured_requests[0].allowed_tools, ("service_status_lookup",))
        self.assertEqual(
            captured_requests[0].payload,
            ServiceStatusLookupPayload(
                subject_query="图书馆今天开门吗",
                temporal_query=TemporalQuery(mode="current"),
                campus_scope="haidian",
            ),
        )
        self.assertEqual(response.selected_target, "campus-services-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "open")

    def test_handle_specialist_request_rejects_tool_outside_notice_agent_policy(self) -> None:
        request = SpecialistRequest(
            target="notice-agent",
            user_goal="帮我找校历通知",
            payload=CampusNoticeDiscoverPayload(
                query_text="校历通知",
                temporal_query=TemporalQuery(mode="current_year", year_hint="2026"),
            ),
            allowed_tools=("service_status_lookup",),
        )

        with self.assertRaisesRegex(
            InvalidSpecialistToolPolicyError,
            "notice-agent does not allow tools: service_status_lookup",
        ):
            handle_specialist_request(
                request,
                specialist_delegates={
                    "notice-agent": lambda inner_request: SpecialistResponse(
                        target="notice-agent",
                        status="completed",
                    )
                },
            )


if __name__ == "__main__":
    unittest.main()
