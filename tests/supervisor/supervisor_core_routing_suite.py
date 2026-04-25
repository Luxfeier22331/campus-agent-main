from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    ContextProjection,
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
    SupervisorRequest,
    TraceContext,
    VersionQuery,
)
from campus_supervisor_core import ExecutionCancelledError, SupervisorAgent, handle_request
from campus_supervisor_core.errors import (
    MissingRoutingInputError,
    MissingSpecialistDelegateError,
)


def _make_rag_completed_response() -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-agent",
        status="completed",
        answer_text="The library is open from 08:00 to 22:00.",
        confidence="high",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
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
                        collection="student_rules",
                        is_current=False,
                        snippet="The library is open from 08:00 to 22:00.",
                        score=0.96,
                    ),
                ),
            )
        ),
    )


def _make_curriculum_course_facts_response() -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-agent",
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


def _knowledge_specialist_request(
    request: SupervisorRequest,
    *,
    scope: KnowledgeScope | None = None,
    version_query: VersionQuery | None = None,
) -> SpecialistRequest:
    return SpecialistRequest(
        target="rag-agent",
        user_goal=request.user_goal,
        conversation_id=request.conversation_id,
        request_id=request.request_id,
        safety_identifier=request.safety_identifier,
        trace=request.trace,
        actor=request.actor,
        context=request.context,
        payload=RagRequestPayload(
            scope=scope,
            version_query=version_query or VersionQuery(),
        ),
    )


class SupervisorCoreRoutingTest(unittest.TestCase):
    def test_handle_request_requires_go_preplanned_specialist_request(self) -> None:
        with self.assertRaisesRegex(
            MissingRoutingInputError,
            "preplanned specialist request is required",
        ):
            handle_request(
                SupervisorRequest(
                    user_goal="library hours",
                    request_id="req-missing-preplanned",
                    trace=TraceContext(trace_id="trace-missing-preplanned"),
                    actor=ActorContext(user_id="student-001"),
                    requested_capability="knowledge",
                    requested_scope=KnowledgeScope(
                        corpus="regulations",
                        collection="student_rules",
                    ),
                ),
                specialist_delegates={},
            )

    def test_handle_request_stops_before_specialist_delegate_when_cancelled(self) -> None:
        delegate_called = False
        request = SupervisorRequest(
            user_goal="library hours",
            request_id="req-cancel-before-delegate",
            trace=TraceContext(trace_id="trace-cancel-before-delegate"),
            actor=ActorContext(user_id="student-001"),
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
            ),
        )

        def fake_rag_specialist(_request: SpecialistRequest) -> SpecialistResponse:
            nonlocal delegate_called
            delegate_called = True
            return _make_rag_completed_response()

        with self.assertRaises(ExecutionCancelledError):
            handle_request(
                request,
                specialist_delegates={"rag-agent": fake_rag_specialist},
                cancellation_checker=lambda: True,
                preplanned_specialist_request=_knowledge_specialist_request(
                    request,
                    scope=KnowledgeScope(
                        corpus="regulations",
                        collection="student_rules",
                    ),
                ),
            )

        self.assertFalse(delegate_called)

    def test_handle_request_routes_go_preplanned_rag_request(self) -> None:
        captured_requests: list[SpecialistRequest] = []
        request = SupervisorRequest(
            user_goal="library hours",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001"),
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
            ),
        )

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        response = handle_request(
            request,
            specialist_delegates={"rag-agent": fake_rag_specialist},
            preplanned_specialist_request=_knowledge_specialist_request(
                request,
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                ),
            ),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.observability)
        assert response.observability is not None
        self.assertTrue(response.observability.retrieval_attempted)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].target, "rag-agent")
        self.assertEqual(
            captured_requests[0].payload,
            RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                )
            ),
        )

    def test_handle_request_keeps_curriculum_scope_but_allows_internal_course_facts_evidence(
        self,
    ) -> None:
        captured_requests: list[SpecialistRequest] = []
        request = SupervisorRequest(
            user_goal="习概哪个学院开，第几学期开",
            request_id="req-curriculum-course-facts-001",
            trace=TraceContext(trace_id="trace-curriculum-course-facts-001"),
            actor=ActorContext(user_id="student-001"),
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="curriculum",
                collection="curriculum_plan",
            ),
        )

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_curriculum_course_facts_response()

        response = handle_request(
            request,
            specialist_delegates={"rag-agent": fake_rag_specialist},
            preplanned_specialist_request=_knowledge_specialist_request(
                request,
                scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
            ),
        )

        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].payload,
            RagRequestPayload(
                scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
            ),
        )
        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "completed")
        assert isinstance(response.result, RagResultPayload)
        self.assertEqual(response.result.evidence.collection, "course_facts")
        self.assertEqual(response.result.evidence.corpus, "curriculum")
        self.assertIn("当前还不能稳定确认开课学院", response.answer_text)

    def test_handle_request_delegates_knowledge_without_explicit_scope_to_rag_specialist(
        self,
    ) -> None:
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
        request = SupervisorRequest(
            user_goal="民族学本科人才培养方案总学分要求是多少？",
            request_id="req-unscoped-knowledge-001",
            trace=TraceContext(trace_id="trace-unscoped-knowledge-001"),
            actor=ActorContext(
                user_id="student-001",
                principal_id="principal-001",
            ),
            requested_capability="knowledge",
            context=request_context,
        )

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        response = handle_request(
            request,
            specialist_delegates={"rag-agent": fake_rag_specialist},
            preplanned_specialist_request=_knowledge_specialist_request(request),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].payload, RagRequestPayload(scope=None))
        self.assertEqual(captured_requests[0].context, request_context)

    def test_handle_request_preserves_explicit_version_query_in_rag_handoff(self) -> None:
        captured_requests: list[SpecialistRequest] = []
        version_query = VersionQuery(
            mode="compare",
            version_id="v1:student-handbook",
            compare_to_version_id="v2:student-handbook",
        )
        scope = KnowledgeScope(corpus="regulations", collection="student_rules")
        request = SupervisorRequest(
            user_goal="比较新旧学生手册关于请假制度的差异",
            request_id="req-version-query-001",
            trace=TraceContext(trace_id="trace-version-query-001"),
            actor=ActorContext(user_id="student-001"),
            requested_capability="knowledge",
            requested_scope=scope,
            version_query=version_query,
        )

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        response = handle_request(
            request,
            specialist_delegates={"rag-agent": fake_rag_specialist},
            preplanned_specialist_request=_knowledge_specialist_request(
                request,
                scope=scope,
                version_query=version_query,
            ),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].payload,
            RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                version_query=VersionQuery(
                    mode="compare",
                    version_id="v1:student-handbook",
                    compare_to_version_id="v2:student-handbook",
                ),
            ),
        )

    def test_supervisor_default_delegate_map_includes_forward_runtime_agents(self) -> None:
        delegates = SupervisorAgent().specialist_delegates

        self.assertIn("campus-services-agent", delegates)
        self.assertIn("notice-agent", delegates)

    def test_handle_request_preserves_needs_clarification_response(self) -> None:
        request = SupervisorRequest(
            user_goal="need help",
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
                    status="needs_clarification",
                    follow_up_question="Which campus are you asking about?",
                )
            },
            preplanned_specialist_request=_knowledge_specialist_request(
                request,
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "Which campus are you asking about?")

    def test_handle_request_raises_missing_rag_delegate_when_scope_is_missing(self) -> None:
        request = SupervisorRequest(
            user_goal="奖学金怎么申请？",
            requested_capability="knowledge",
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                ),
                session=SessionSummary(
                    confirmed_slots=(
                        SessionSlot(name="policy_topic", value="奖学金", confirmed=True),
                    ),
                    turn_count=2,
                ),
            ),
        )
        with self.assertRaisesRegex(
            MissingSpecialistDelegateError,
            "missing delegate for specialist target: rag-agent",
        ):
            handle_request(
                request,
                specialist_delegates={},
                preplanned_specialist_request=_knowledge_specialist_request(request),
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
        request = SupervisorRequest(
            user_goal="这个流程怎么办？",
            requested_capability="knowledge",
            context=request_context,
        )

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="rag-agent",
                status="needs_clarification",
                follow_up_question="请说明你想咨询哪一类奖学金。",
            )

        response = handle_request(
            request,
            specialist_delegates={"rag-agent": fake_rag_specialist},
            preplanned_specialist_request=_knowledge_specialist_request(request),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "请说明你想咨询哪一类奖学金。")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].payload, RagRequestPayload(scope=None))
        self.assertEqual(captured_requests[0].context, request_context)

    def test_handle_request_does_not_fallback_to_supervisor_clarification_for_internal_only_memory(
        self,
    ) -> None:
        request = SupervisorRequest(
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
        )
        with self.assertRaisesRegex(
            MissingSpecialistDelegateError,
            "missing delegate for specialist target: rag-agent",
        ):
            handle_request(
                request,
                specialist_delegates={},
                preplanned_specialist_request=_knowledge_specialist_request(request),
            )
