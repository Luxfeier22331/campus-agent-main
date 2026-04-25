from __future__ import annotations

import unittest

from campus_contracts import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    ActorContext,
    ContextProjection,
    CurriculumFollowUpSlots,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultDiagnostics,
    RagResultPayload,
    SessionSlot,
    SessionSummary,
    SpecialistResponse,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.response import build_supervisor_observability_from_specialist_response


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


class SupervisorCoreObservabilityContextTest(unittest.TestCase):
    def test_build_supervisor_observability_keeps_raw_retrieved_sources_separate_from_supporting_sources(
        self,
    ) -> None:
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
            target="rag-agent",
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

    def test_build_supervisor_observability_does_not_mirror_supporting_sources_for_clarification(
        self,
    ) -> None:
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
            target="rag-agent",
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

    def test_build_supervisor_observability_marks_course_map_fail_close_as_no_retrieval(
        self,
    ) -> None:
        response = SpecialistResponse(
            target="rag-agent",
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
                collection="student_rules",
            ),
        )

        context = SupervisorRequestContext.from_request(request)

        self.assertIs(context.request, request)
        self.assertEqual(context.request_id, "req-001")
        self.assertEqual(context.trace_id, "trace-001")
        self.assertEqual(context.user_id, "student-001")
        self.assertEqual(context.conversation_id, "conv-001")
        self.assertEqual(context.primary_corpus, "regulations")
        self.assertEqual(context.primary_collection, "student_rules")
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
                        SessionSlot(
                            name=CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
                            value="民族实验班",
                            confirmed=True,
                        ),
                        SessionSlot(
                            name=CURRICULUM_PROGRAM_SLOT_NAME,
                            value="法学民族实验班",
                            confirmed=True,
                        ),
                        SessionSlot(
                            name=CURRICULUM_SEMESTER_SLOT_NAME, value="第四学期", confirmed=True
                        ),
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
