from __future__ import annotations

import unittest
from dataclasses import asdict

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    PromptTrace,
    RagResultPayload,
    SessionSlot,
    SessionSummary,
    SpecialistResponse,
    SupervisorRequest,
    SupervisorResponse,
    TraceContext,
)
from campus_supervisor_core.audit import (
    SupervisorAuditRecord,
    build_audit_record,
    build_error_audit_record,
)
from campus_supervisor_core.errors import (
    DisallowedKnowledgeScopeError,
)
from campus_supervisor_core.prompts.registry import get_supervisor_prompt_spec


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


class SupervisorCoreAuditRecordTest(unittest.TestCase):
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
            selected_target="rag-agent",
            requested_capability="knowledge",
            requested_scope_corpus="regulations",
            requested_scope_collection="student_rules",
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
                "selected_target": "rag-agent",
                "requested_capability": "knowledge",
                "requested_scope_corpus": "regulations",
                "requested_scope_collection": "student_rules",
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
                    confirmed_slots=(
                        SessionSlot(name="policy_topic", value="推免资格", confirmed=True),
                    ),
                    turn_count=3,
                ),
            ),
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_rules",
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
                "requested_scope_collection": "student_rules",
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
                "selected_target": "rag-agent",
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
                collection="student_rules",
            ),
        )

        record = build_audit_record(
            request,
            SupervisorResponse(
                selected_target="rag-agent",
                status="needs_clarification",
                follow_up_question="请说明你想咨询哪一类奖学金。",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="奖学金怎么申请？",
                        corpus="regulations",
                        collection="student_rules",
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
                collection="student_rules",
            ),
        )

        record = build_audit_record(
            request,
            SupervisorResponse(
                selected_target="rag-agent",
                status="no_answer",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="校内宇宙签证办理处",
                        corpus="regulations",
                        collection="student_rules",
                    )
                ),
            ),
        )

        self.assertEqual(record.evidence_source_count, 0)
        self.assertFalse(record.follow_up_emitted)
        self.assertTrue(record.fail_closed)
