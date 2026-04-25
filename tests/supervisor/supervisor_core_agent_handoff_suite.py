from __future__ import annotations

import unittest

from campus_contracts import (
    CampusNoticeDiscoverPayload,
    EvidenceBundle,
    EvidenceSource,
    RagResultPayload,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    SpecialistRequest,
    SpecialistResponse,
    TemporalQuery,
)
from campus_supervisor_core import dispatch_agent_request


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


class SupervisorCoreAgentHandoffTest(unittest.TestCase):
    def test_dispatch_agent_request_preserves_structured_runtime_handoff_allowed_tools(
        self,
    ) -> None:
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

        agent_request = SpecialistRequest(
            target="campus-services-agent",
            user_goal="图书馆今天开门吗",
            payload=ServiceStatusLookupPayload(
                subject_query="图书馆今天开门吗",
                temporal_query=TemporalQuery(mode="current"),
                campus_scope="haidian",
            ),
            allowed_tools=("service_status_lookup",),
        )

        response = dispatch_agent_request(
            agent_request,
            agent_delegates={"campus-services-agent": fake_campus_services_agent},
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
        self.assertEqual(response.target, "campus-services-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "open")

    def test_dispatch_agent_request_delegates_go_preplanned_tool_policy(self) -> None:
        request = SpecialistRequest(
            target="notice-agent",
            user_goal="帮我找校历通知",
            payload=CampusNoticeDiscoverPayload(
                query_text="校历通知",
                temporal_query=TemporalQuery(mode="current_year", year_hint="2026"),
            ),
            allowed_tools=("service_status_lookup",),
        )
        captured_requests: list[SpecialistRequest] = []

        response = dispatch_agent_request(
            request,
            agent_delegates={
                "notice-agent": lambda inner_request: (
                    captured_requests.append(inner_request)
                    or SpecialistResponse(
                        target="notice-agent",
                        status="completed",
                    )
                )
            },
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(captured_requests, [request])
