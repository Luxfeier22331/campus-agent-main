from __future__ import annotations

import unittest

from campus_contracts import (
    EvidenceBundle,
    EvidenceSource,
    RagResultDiagnostics,
    RagResultPayload,
    ServiceGuideLookupResult,
    ServiceGuideSection,
    ServiceGuideServiceRef,
    SpecialistResponse,
)
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

    def test_build_supervisor_observability_marks_service_guide_tool(self) -> None:
        response = SpecialistResponse(
            target="campus-services-agent",
            status="completed",
            answer_text="公寓楼新生办理入住手续流程：到指定公寓楼报到。",
            confidence="high",
            result=ServiceGuideLookupResult(
                service_query="宿舍入住怎么办理",
                guide_focus="procedure",
                outcome="resolved_current",
                resolved_service=ServiceGuideServiceRef(
                    service_id="service:handbook:check-in",
                    display_name="公寓楼新生办理入住手续流程",
                ),
                guide_sections=(
                    ServiceGuideSection(
                        section_type="procedure",
                        title="公寓楼新生办理入住手续流程",
                        content="1. 到指定公寓楼报到。",
                        source_refs=("handbook:student_rules:pages:252-255#page=253",),
                    ),
                ),
                source_refs=("handbook:student_rules:pages:252-255#page=253",),
                matched_service_category="student_housing",
            ),
        )

        observability = build_supervisor_observability_from_specialist_response(response)

        self.assertEqual(observability.selected_tool, "service_guide_lookup")
        self.assertEqual(observability.tool_business_outcome, "resolved_current")
        self.assertFalse(observability.retrieval_attempted)
