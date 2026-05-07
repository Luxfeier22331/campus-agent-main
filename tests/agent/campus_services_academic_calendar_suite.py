from __future__ import annotations

import unittest

from campus_contracts import (
    AcademicCalendarLookupPayload,
    AcademicCalendarLookupResult,
    ActorContext,
    AgentRequest,
    AuthorizationProjection,
    ContextProjection,
)
from campus_services_agent import tool_adapter as campus_services_tool_adapter
from campus_services_agent.http_query_service import CampusServicesHTTPQueryService
from campus_services_agent.query_service import (
    AcademicCalendarQuery,
    CampusServicesAccessContext,
)
from campus_services_agent.service import delegate_to_campus_services_agent
from campus_supervisor_agent_worker.agent_delegates import _build_agent_delegates
from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
    AgentsSdkToolCall,
    AgentsSdkToolExecutionRequest,
)
from campus_supervisor_agent_worker.settings import ApiSettings

from tests.agent.campus_services_agent_fakes import (
    FakeCampusServicesQueryService,
    RecordingQueryHTTPTransport,
)


class CampusServicesAcademicCalendarTest(unittest.TestCase):
    def test_academic_calendar_payload_routes_through_internal_query_service(self) -> None:
        query_service = FakeCampusServicesQueryService()
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="今天第几教学周",
            payload=AcademicCalendarLookupPayload(query_text="今天第几教学周"),
            allowed_tools=("academic_calendar_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(principal_id="principal-001"),
            ),
        )

        response = delegate_to_campus_services_agent(request, query_service=query_service)

        self.assertEqual(response.target, "campus-services-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.week_index, 11)
        self.assertIn("第11教学周", response.answer_text)
        self.assertEqual(response.agent_observability.selected_tool, "academic_calendar_lookup")
        self.assertEqual(
            response.agent_observability.safe_details["agent_execution_projection"],
            {
                "schema_version": "agent-execution-projection-v1",
                "projection_owner": "campus-services-agent",
                "selected_tool": "academic_calendar_lookup",
                "payload_kind": "academic_calendar_lookup",
                "tool_selection_reason": "typed_payload_allowed_tool",
            },
        )
        self.assertEqual(
            query_service.last_academic_calendar_query,
            AcademicCalendarQuery(
                payload=AcademicCalendarLookupPayload(query_text="今天第几教学周"),
                access_context=CampusServicesAccessContext(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(principal_id="principal-001"),
                ),
            ),
        )

    def test_academic_calendar_response_fail_closes_without_source_truth(self) -> None:
        response = campus_services_tool_adapter._academic_calendar_response(
            AcademicCalendarLookupResult(
                query_text="今天第几教学周",
                outcome="temporarily_unverifiable",
                fail_close_reason="source_truth_unavailable",
            )
        )

        self.assertEqual(response.target, "campus-services-agent")
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.agent_observability.failure_class, "fail_close")

    def test_http_query_service_posts_academic_calendar_payload_and_decodes_result(self) -> None:
        transport = RecordingQueryHTTPTransport(
            {
                "query_text": "今天第几教学周",
                "outcome": "resolved_current",
                "resolved_date": "2026-05-05",
                "academic_year_label": "2025-2026学年",
                "term_label": "春季学期",
                "week_index": 11,
                "day_kind": "teaching_day",
                "source_refs": ["official_web:academic-calendar-2025-2026"],
            }
        )
        query_service = CampusServicesHTTPQueryService(
            base_url="http://supervisor-api.internal",
            shared_secret="query-secret",
            timeout_seconds=0.75,
            transport=transport,
        )

        result = query_service.lookup_academic_calendar(
            AcademicCalendarQuery(
                payload=AcademicCalendarLookupPayload(query_text="今天第几教学周")
            )
        )

        self.assertEqual(
            transport.calls[0][0],
            "http://supervisor-api.internal/internal/query/calendar/academic-calendar",
        )
        self.assertEqual(transport.calls[0][2]["payload"]["query_text"], "今天第几教学周")
        self.assertIn("access_context", transport.calls[0][2])
        self.assertEqual(result.outcome, "resolved_current")
        self.assertEqual(result.week_index, 11)
        self.assertEqual(result.source_refs, ("official_web:academic-calendar-2025-2026",))

    def test_agent_delegates_route_academic_calendar_to_sdk_when_tool_is_admitted(self) -> None:
        runner_called = False
        query_service = FakeCampusServicesQueryService()

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            self.assertEqual(run_request.target, "campus-services-agent")
            self.assertEqual(run_request.allowed_tools, ("academic_calendar_lookup",))
            self.assertEqual(
                run_request.instruction_profile_id,
                "academic_calendar_fact_lookup",
            )
            self.assertEqual(run_request.result_usage_mode, "academic_calendar_fact")
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="academic_calendar_lookup",
                    arguments={"query_text": "今天第几教学周"},
                    call_id="call-calendar",
                )
            )
            self.assertEqual(tool_result["outcome"], "resolved_current")
            self.assertEqual(tool_result["week_index"], 11)
            self.assertEqual(tool_result["source_ref_count"], 1)
            return AgentsSdkRunResult(
                final_output="今天是第 11 教学周。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="academic_calendar_lookup",
                        arguments={"query_text": "今天第几教学周"},
                        call_id="call-calendar",
                    ),
                ),
                model_response_ref="resp-calendar",
            )

        delegates = _build_agent_delegates(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            rag_prompt_executor=None,
            campus_services_query_service=query_service,
            notice_query_service=None,
            agents_sdk_runner=fake_runner,
        )

        response = delegates["campus-services-agent"](_academic_calendar_request())

        self.assertTrue(runner_called)
        self.assertIsNotNone(query_service.last_academic_calendar_query)
        self.assertEqual(response.status, "completed")
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "academic_calendar_lookup")
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["instruction_profile_id"], "academic_calendar_fact_lookup")


def _academic_calendar_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="今天第几教学周",
        request_id="req-sdk-academic-calendar",
        payload=AcademicCalendarLookupPayload(query_text="今天第几教学周"),
        allowed_tools=("academic_calendar_lookup",),
    )


if __name__ == "__main__":
    unittest.main()
