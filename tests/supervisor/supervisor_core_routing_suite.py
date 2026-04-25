from __future__ import annotations

import unittest
from dataclasses import asdict

from campus_contracts import (
    ActorContext,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    PromptTrace,
    RagRequestPayload,
    RagResultPayload,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorObservability,
    SupervisorRequest,
    SupervisorResponse,
    TraceContext,
    VersionQuery,
)
from campus_supervisor_core import ExecutionCancelledError, SupervisorAgent, handle_request
from campus_supervisor_core.audit import (
    SupervisorAuditRecord,
)
from campus_supervisor_core.errors import (
    MissingRoutingInputError,
    MissingSpecialistDelegateError,
)
from campus_supervisor_core.intent import IntentFrame
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec
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


def _knowledge_decision(
    *,
    scope: KnowledgeScope | None = None,
    version_query: VersionQuery | None = None,
    scope_reason: str = "scope_undetermined_delegate",
) -> RoutingDecision:
    return RoutingDecision(
        target="rag-agent",
        primary_corpus=scope.corpus if scope is not None else None,
        primary_collection=scope.collection if scope is not None else None,
        intent_frame=_intent_frame(
            capability="knowledge",
            task_kind="knowledge_lookup",
            domain_candidates=(
                f"{scope.corpus}/{scope.collection}" if scope is not None else "knowledge",
            ),
            suggested_next_action="delegate",
            scope_class="in_scope",
            scope_reason=scope_reason,
            launch_state="open",
        ),
        specialist_payload=RagRequestPayload(
            scope=scope,
            version_query=version_query or VersionQuery(),
        ),
    )


def _terminal_decision(
    *,
    capability: str,
    task_kind: str,
    suggested_next_action: str,
    scope_class: str,
    policy_reason: str,
    scope_reason: str,
    domain_candidates: tuple[str, ...],
    risk_level: str = "low",
) -> RoutingDecision:
    return RoutingDecision(
        target=None,
        primary_corpus=None,
        primary_collection=None,
        intent_frame=_intent_frame(
            capability=capability,
            task_kind=task_kind,
            domain_candidates=domain_candidates,
            suggested_next_action=suggested_next_action,
            scope_class=scope_class,
            policy_reason=policy_reason,
            scope_reason=scope_reason,
            launch_state="closed",
            risk_level=risk_level,
        ),
    )


def _intent_frame(
    *,
    capability: str,
    task_kind: str,
    domain_candidates: tuple[str, ...],
    suggested_next_action: str,
    scope_class: str,
    scope_reason: str,
    launch_state: str,
    policy_reason: str = "",
    risk_level: str = "low",
) -> IntentFrame:
    return IntentFrame(
        capability=capability,
        task_kind=task_kind,
        domain_candidates=domain_candidates,
        missing_slots=(),
        risk_level=risk_level,
        needs_clarification=False,
        suggested_next_action=suggested_next_action,
        scope_class=scope_class,
        policy_reason=policy_reason,
        launch_state=launch_state,
        scope_reason=scope_reason,
        classifier_version="go-runtime-policy-v1",
    )


class SupervisorCoreRoutingTest(unittest.TestCase):
    def test_handle_request_requires_go_preplanned_routing_decision(self) -> None:
        with self.assertRaisesRegex(
            MissingRoutingInputError,
            "preplanned routing decision is required",
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

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            nonlocal delegate_called
            delegate_called = True
            return _make_rag_completed_response()

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

        with self.assertRaises(ExecutionCancelledError):
            handle_request(
                request,
                specialist_delegates={"rag-agent": fake_rag_specialist},
                cancellation_checker=lambda: True,
            )

        self.assertFalse(delegate_called)

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
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
            ),
        )

        response = handle_request(
            request,
            specialist_delegates={"rag-agent": fake_rag_specialist},
            audit_sink=audit_records.append,
            preplanned_routing_decision=_knowledge_decision(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                ),
                scope_reason="explicit_requested_scope",
            ),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.observability)
        assert response.observability is not None
        self.assertEqual(response.observability.intent_capability, "knowledge")
        self.assertEqual(response.observability.intent_task_kind, "knowledge_lookup")
        self.assertEqual(response.observability.intent_launch_state, "open")
        self.assertEqual(response.observability.intent_next_action, "delegate")
        self.assertEqual(response.observability.intent_scope_class, "in_scope")
        self.assertEqual(response.observability.intent_scope_reason, "explicit_requested_scope")
        self.assertEqual(response.observability.intent_classifier_version, "go-runtime-policy-v1")
        self.assertEqual(response.observability.intent_schema_version, "intent-schema-1.0.0")
        self.assertEqual(response.observability.intent_context_resolution_state, "not_follow_up")
        self.assertEqual(response.observability.intent_routing_confidence, "high")
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
                "selected_target": "rag-agent",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_rules",
                "status": "completed",
                "error_code": None,
                "source_doc_ids": ("handbook:test-001",),
                "evidence_source_count": 1,
                "follow_up_emitted": False,
                "fail_closed": False,
                "intent_capability": "knowledge",
                "intent_task_kind": "knowledge_lookup",
                "intent_launch_state": "open",
                "intent_next_action": "delegate",
                "intent_scope_class": "in_scope",
                "intent_scope_reason": "explicit_requested_scope",
                "intent_policy_reason": "",
                "intent_classifier_version": "go-runtime-policy-v1",
            },
        )

    def test_handle_request_keeps_curriculum_scope_but_allows_internal_course_facts_evidence(
        self,
    ) -> None:
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
                requested_capability="knowledge",
                requested_scope=KnowledgeScope(
                    corpus="curriculum",
                    collection="curriculum_plan",
                ),
            ),
            specialist_delegates={"rag-agent": fake_rag_specialist},
            preplanned_routing_decision=_knowledge_decision(
                scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
                scope_reason="explicit_requested_scope",
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
            specialist_delegates={"rag-agent": fake_rag_specialist},
            audit_sink=lambda _record: None,
            preplanned_routing_decision=_knowledge_decision(),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].payload, RagRequestPayload(scope=None))
        self.assertEqual(captured_requests[0].context, request_context)

    def test_handle_request_preserves_explicit_version_query_in_rag_handoff(self) -> None:
        captured_requests: list[SpecialistRequest] = []

        def fake_rag_specialist(request: SpecialistRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        response = handle_request(
            SupervisorRequest(
                user_goal="比较新旧学生手册关于请假制度的差异",
                request_id="req-version-query-001",
                trace=TraceContext(trace_id="trace-version-query-001"),
                actor=ActorContext(user_id="student-001"),
                requested_capability="knowledge",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                ),
                version_query=VersionQuery(
                    mode="compare",
                    version_id="v1:student-handbook",
                    compare_to_version_id="v2:student-handbook",
                ),
            ),
            specialist_delegates={"rag-agent": fake_rag_specialist},
            audit_sink=lambda _record: None,
            preplanned_routing_decision=_knowledge_decision(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                version_query=VersionQuery(
                    mode="compare",
                    version_id="v1:student-handbook",
                    compare_to_version_id="v2:student-handbook",
                ),
                scope_reason="explicit_requested_scope",
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
        response = handle_request(
            SupervisorRequest(
                user_goal="need help",
                requested_capability="knowledge",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                ),
            ),
            specialist_delegates={
                "rag-agent": lambda request: SpecialistResponse(
                    target="rag-agent",
                    status="needs_clarification",
                    follow_up_question="Which campus are you asking about?",
                )
            },
            preplanned_routing_decision=_knowledge_decision(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                scope_reason="explicit_requested_scope",
            ),
        )

        self.assertEqual(response.selected_target, "rag-agent")
        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.follow_up_question, "Which campus are you asking about?")

    def test_handle_request_raises_missing_rag_delegate_when_scope_is_missing(self) -> None:
        with self.assertRaisesRegex(
            MissingSpecialistDelegateError,
            "missing delegate for specialist target: rag-agent",
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
                            confirmed_slots=(
                                SessionSlot(name="policy_topic", value="奖学金", confirmed=True),
                            ),
                            turn_count=2,
                        ),
                    ),
                ),
                specialist_delegates={},
                preplanned_routing_decision=_knowledge_decision(),
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
                target="rag-agent",
                status="needs_clarification",
                follow_up_question="请说明你想咨询哪一类奖学金。",
            )

        response = handle_request(
            SupervisorRequest(
                user_goal="这个流程怎么办？",
                requested_capability="knowledge",
                context=request_context,
            ),
            specialist_delegates={"rag-agent": fake_rag_specialist},
            preplanned_routing_decision=_knowledge_decision(),
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
        with self.assertRaisesRegex(
            MissingSpecialistDelegateError,
            "missing delegate for specialist target: rag-agent",
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
                preplanned_routing_decision=_knowledge_decision(),
            )

    def test_handle_request_returns_approval_required_without_delegate_for_high_risk_request(
        self,
    ) -> None:
        audit_records: list[SupervisorAuditRecord] = []

        response = handle_request(
            SupervisorRequest(
                user_goal="帮我提交奖学金申请",
                requested_capability="knowledge",
                requested_scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
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
            preplanned_routing_decision=_terminal_decision(
                capability="knowledge",
                task_kind="knowledge_lookup",
                suggested_next_action="approval_required",
                scope_class="in_scope",
                policy_reason="approval_required",
                scope_reason="transaction_guardrail",
                domain_candidates=("regulations/student_rules",),
                risk_level="high",
            ),
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
                    intent_capability="knowledge",
                    intent_task_kind="knowledge_lookup",
                    intent_launch_state="closed",
                    intent_next_action="approval_required",
                    intent_scope_class="in_scope",
                    intent_scope_reason="transaction_guardrail",
                    intent_classifier_version="go-runtime-policy-v1",
                    intent_schema_version="intent-schema-1.0.0",
                    intent_routing_confidence="high",
                    intent_context_resolution_state="not_follow_up",
                    intent_context_reference_type="none",
                    acl_decision="approval_required",
                    fail_closed=True,
                ),
            ),
        )
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(audit_records[0].status, "approval_required")
        self.assertIsNone(audit_records[0].selected_target)

    def test_handle_request_returns_out_of_scope_without_delegate_for_obvious_external_query(
        self,
    ) -> None:
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
            specialist_delegates={"rag-agent": fake_rag_specialist},
            audit_sink=audit_records.append,
        )

        self.assertFalse(delegate_called)
        self.assertEqual(response.selected_target, None)
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.observability.semantic_outcome, "out_of_scope")
        self.assertEqual(response.observability.scope_class, "out_of_scope")
        self.assertEqual(response.observability.policy_reason, "product_scope_boundary")
        self.assertEqual(response.observability.intent_capability, "knowledge")
        self.assertEqual(response.observability.intent_launch_state, "closed")
        self.assertEqual(response.observability.intent_next_action, "out_of_scope")
        self.assertEqual(response.observability.intent_policy_reason, "product_scope_boundary")
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(audit_records[0].status, "no_answer")
        self.assertIsNone(audit_records[0].selected_target)
        self.assertEqual(audit_records[0].intent_launch_state, "closed")
        self.assertEqual(audit_records[0].intent_next_action, "out_of_scope")

    def test_handle_request_fail_closes_navigation_queries_before_delegate(self) -> None:
        delegate_called = False
        audit_records: list[SupervisorAuditRecord] = []

        def fake_navigation_specialist(_request: SpecialistRequest) -> SpecialistResponse:
            nonlocal delegate_called
            delegate_called = True
            return _make_rag_completed_response()

        response = handle_request(
            SupervisorRequest(
                user_goal="图书馆在哪里",
                requested_capability="place_lookup",
            ),
            specialist_delegates={"navigation-agent": fake_navigation_specialist},
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
        self.assertEqual(response.observability.intent_capability, "place_lookup")
        self.assertEqual(response.observability.intent_task_kind, "place_lookup")
        self.assertEqual(response.observability.intent_launch_state, "closed")
        self.assertEqual(response.observability.intent_next_action, "out_of_scope")
        self.assertEqual(len(audit_records), 1)
        self.assertEqual(audit_records[0].status, "no_answer")
        self.assertIsNone(audit_records[0].selected_target)
        self.assertEqual(audit_records[0].intent_capability, "place_lookup")
        self.assertEqual(
            audit_records[0].intent_policy_reason, "navigation_temporarily_unsupported"
        )
