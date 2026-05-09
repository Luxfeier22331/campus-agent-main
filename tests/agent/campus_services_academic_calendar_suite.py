from __future__ import annotations

import unittest

from campus_contracts import (
    AcademicCalendarLookupPayload,
    AcademicCalendarLookupResult,
    AcademicCalendarRelatedContext,
    ActorContext,
    AgentRequest,
    AuthorizationProjection,
    ContextProjection,
)
from campus_services_agent.academic_calendar_adapter import academic_calendar_response
from campus_services_agent.http_query_service import CampusServicesHTTPQueryService
from campus_services_agent.query_service import (
    AcademicCalendarQuery,
    CampusServicesAccessContext,
)
from campus_services_agent.sdk_tool_executor import execute_campus_services_sdk_tool
from campus_shared import PromptRuntimeProviderConfig
from campus_supervisor_agent_worker.agent_delegates import _build_agent_delegates
from campus_supervisor_agent_worker.openai_agents_runtime import (
    OpenAIAgentsRunResult,
    OpenAIAgentsToolCall,
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
            payload=AcademicCalendarLookupPayload(
                query_text="今天第几教学周",
                query_kind="date_week",
            ),
            allowed_tools=("academic_calendar_lookup",),
            actor=ActorContext(user_id="student-001"),
            context=ContextProjection(
                actor=ActorContext(user_id="student-001"),
                authorization=AuthorizationProjection(principal_id="principal-001"),
            ),
        )

        bounded = execute_campus_services_sdk_tool(
            _tool_execution(
                "academic_calendar_lookup",
                {
                    "query_text": "今天第几教学周",
                    "query_kind": "date_week",
                },
                "call-calendar-001",
            ),
            agent_request=request,
            query_service=query_service,
        )

        self.assertEqual(bounded["status"], "completed")
        self.assertEqual(bounded["outcome"], "resolved_current")
        self.assertEqual(bounded["week_index"], 11)
        self.assertEqual(bounded["academic_year_label"], "2025-2026学年")
        self.assertEqual(
            query_service.last_academic_calendar_query,
            AcademicCalendarQuery(
                payload=AcademicCalendarLookupPayload(
                    query_text="今天第几教学周",
                    query_kind="date_week",
                ),
                access_context=CampusServicesAccessContext(
                    actor=ActorContext(user_id="student-001"),
                    authorization=AuthorizationProjection(principal_id="principal-001"),
                ),
            ),
        )

    def test_academic_calendar_response_fail_closes_without_source_truth(self) -> None:
        response = academic_calendar_response(
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
                "query_kind": "date_week",
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
                payload=AcademicCalendarLookupPayload(
                    query_text="今天第几教学周",
                    query_kind="date_week",
                )
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

    def test_http_query_service_decodes_academic_calendar_event_range_result(self) -> None:
        transport = RecordingQueryHTTPTransport(
            {
                "query_text": "劳动节放假怎么安排",
                "outcome": "resolved_current",
                "query_kind": "named_event_range",
                "answer_focus": "holiday_duration",
                "event_name": "劳动节假期",
                "event_type": "holiday",
                "event_aliases": ["五一", "劳动节"],
                "event_start_date": "2026-05-01",
                "event_end_date_exclusive": "2026-05-06",
                "display_start_date": "2026-05-01",
                "display_end_date": "2026-05-05",
                "duration_days": 5,
                "applies_to": ["all"],
                "source_title": "中央民族大学 2025-2026 学年校历",
                "source_url": "https://www.muc.edu.cn/ggfw/mdxl.htm",
                "calendar_record_id": "academic-calendar:2025-2026:labor-day",
                "source_refs": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
                "primary_record_id": "academic-calendar:2025-2026:labor-day",
                "primary_source_refs": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
                "related_calendar_contexts": [
                    {
                        "relation": "overlapping_campus_course_adjustment",
                        "event_name": "运动会、春季社会实践周、劳动节假期课程调整",
                        "event_type": "course_suspension",
                        "display_start_date": "2026-04-27",
                        "display_end_date": "2026-05-05",
                        "source_refs": [
                            "https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1"
                        ],
                    }
                ],
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
                payload=AcademicCalendarLookupPayload(
                    query_text="劳动节放假怎么安排",
                    query_kind="named_event_range",
                    event_query="劳动节",
                )
            )
        )
        response = academic_calendar_response(result)

        self.assertEqual(result.query_kind, "named_event_range")
        self.assertEqual(result.answer_focus, "holiday_duration")
        self.assertEqual(result.event_end_date_exclusive, "2026-05-06")
        self.assertEqual(result.display_end_date, "2026-05-05")
        self.assertEqual(result.duration_days, 5)
        self.assertEqual(result.primary_record_id, "academic-calendar:2025-2026:labor-day")
        self.assertEqual(len(result.related_calendar_contexts), 1)
        self.assertEqual(
            result.related_calendar_contexts[0].relation,
            "overlapping_campus_course_adjustment",
        )
        self.assertIn("劳动节假期是5 月 1 日到 5 月 5 日，共 5 天", response.answer_text)
        self.assertIn("4 月 27 日到 5 月 5 日", response.answer_text)

    def test_academic_calendar_response_describes_spring_break_without_correction_tone(
        self,
    ) -> None:
        response = academic_calendar_response(
            AcademicCalendarLookupResult(
                query_text="今年春假是什么时候",
                outcome="resolved_current",
                query_kind="named_event_range",
                answer_focus="campus_break_window",
                event_name="运动会、春季社会实践周、劳动节假期课程调整",
                event_type="course_suspension",
                event_aliases=("春假", "春季社会实践周"),
                display_start_date="2026-04-27",
                display_end_date="2026-05-05",
                applies_to=("undergraduate", "preparatory", "graduate"),
                related_calendar_contexts=(
                    AcademicCalendarRelatedContext(
                        relation="overlapping_holiday_window",
                        event_name="劳动节假期",
                        event_type="holiday",
                        display_start_date="2026-05-01",
                        display_end_date="2026-05-05",
                        duration_days=5,
                        source_refs=("https://www.muc.edu.cn/ggfw/mdxl.htm",),
                    ),
                ),
                source_refs=("https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1",),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("如果你说的“春假”是指这段校内连续不上课时间", response.answer_text)
        self.assertIn("4 月 27 日到 5 月 5 日", response.answer_text)
        self.assertIn("本（预）科生、研究生课程停课", response.answer_text)
        self.assertIn("其中 劳动节假期是5 月 1 日到 5 月 5 日，共 5 天", response.answer_text)
        self.assertNotIn("口语说法", response.answer_text)
        self.assertNotIn("官方表述", response.answer_text)
        self.assertNotIn("大家常说", response.answer_text)

    def test_academic_calendar_response_connects_labor_day_to_spring_break_conditionally(
        self,
    ) -> None:
        response = academic_calendar_response(
            AcademicCalendarLookupResult(
                query_text="五一放几天",
                outcome="resolved_current",
                query_kind="named_event_range",
                answer_focus="holiday_duration",
                holiday_name="劳动节假期",
                event_name="劳动节假期",
                event_type="holiday",
                display_start_date="2026-05-01",
                display_end_date="2026-05-05",
                duration_days=5,
                related_calendar_contexts=(
                    AcademicCalendarRelatedContext(
                        relation="overlapping_campus_course_adjustment",
                        event_name="运动会、春季社会实践周、劳动节假期课程调整",
                        event_type="course_suspension",
                        display_start_date="2026-04-27",
                        display_end_date="2026-05-05",
                        applies_to=("undergraduate", "preparatory", "graduate"),
                        source_refs=(
                            "https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1",
                        ),
                    ),
                ),
                source_refs=("https://www.muc.edu.cn/ggfw/mdxl.htm",),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("劳动节假期是5 月 1 日到 5 月 5 日，共 5 天", response.answer_text)
        self.assertIn("4 月 27 日到 5 月 5 日", response.answer_text)
        self.assertIn("如果你说的“春假”是指这段校内连续不上课时间", response.answer_text)
        self.assertNotIn("口语说法", response.answer_text)
        self.assertNotIn("官方表述", response.answer_text)
        self.assertNotIn("大家常说", response.answer_text)

    def test_academic_calendar_response_renders_day_status_terse_factually(self) -> None:
        response = academic_calendar_response(
            AcademicCalendarLookupResult(
                query_text="2026-05-01 上课吗",
                outcome="resolved_current",
                query_kind="day_status",
                answer_focus="day_status",
                resolved_date="2026-05-01",
                day_kind="holiday",
                event_name="劳动节假期",
                source_refs=("https://www.muc.edu.cn/ggfw/mdxl.htm",),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "5 月 1 日不上课，属于劳动节假期。")

    def test_academic_calendar_response_renders_notice_rest_day_override(self) -> None:
        response = academic_calendar_response(
            AcademicCalendarLookupResult(
                query_text="2026-05-09 上课吗",
                outcome="resolved_current",
                query_kind="day_status",
                answer_focus="day_status",
                resolved_date="2026-05-09",
                day_kind="normal_rest_day",
                source_refs=("https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1",),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "5 月 9 日不上课，当天按休息日安排。")

    def test_academic_calendar_response_renders_course_suspension_day_status(self) -> None:
        response = academic_calendar_response(
            AcademicCalendarLookupResult(
                query_text="2026-04-28 上课吗",
                outcome="resolved_current",
                query_kind="day_status",
                answer_focus="day_status",
                resolved_date="2026-04-28",
                day_kind="course_suspension",
                event_name="运动会、春季社会实践周、劳动节假期课程调整",
                source_refs=("https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1",),
            )
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            response.answer_text,
            "4 月 28 日不上课，属于运动会、春季社会实践周、劳动节假期课程调整。",
        )

    def test_agent_delegates_route_academic_calendar_to_sdk_when_tool_is_admitted(self) -> None:
        runner_called = False
        query_service = FakeCampusServicesQueryService()

        def fake_runner(agent, input_text, *, context, max_turns, run_config):
            nonlocal runner_called
            runner_called = True
            _ = input_text, context, max_turns, run_config
            self.assertEqual(agent.name, "campus-services-agent")
            self.assertEqual(agent.tools[0].name, "academic_calendar_lookup")

            class ToolContext:
                tool_call_id = "call-calendar"

            import asyncio

            tool_payload = asyncio.run(
                agent.tools[0].on_invoke_tool(
                    ToolContext(),
                    '{"query_text":"今天第几教学周","query_kind":"date_week"}',
                )
            )
            import json

            tool_result = json.loads(tool_payload)
            self.assertEqual(tool_result["outcome"], "resolved_current")
            self.assertEqual(tool_result["week_index"], 11)
            self.assertEqual(tool_result["source_ref_count"], 1)
            return OpenAIAgentsRunResult(
                final_output="今天是第 11 教学周。",
                tool_calls=(
                    OpenAIAgentsToolCall(
                        name="academic_calendar_lookup",
                        arguments={"query_text": "今天第几教学周", "query_kind": "date_week"},
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
            openai_agents_runtime=_native_runtime(fake_runner),
        )

        response = delegates["campus-services-agent"](_academic_calendar_request())

        self.assertTrue(runner_called)
        self.assertIsNotNone(query_service.last_academic_calendar_query)
        self.assertEqual(response.status, "completed")
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "academic_calendar_lookup")
        projection = response.agent_observability.safe_details["openai_agents_runtime_projection"]
        self.assertEqual(projection["instruction_profile_id"], "academic_calendar_fact_lookup")


def _native_runtime(runner):
    return __import__(
        "campus_supervisor_agent_worker.openai_agents_runtime",
        fromlist=["OpenAIAgentsNativeRuntime"],
    ).OpenAIAgentsNativeRuntime(
        provider_config=PromptRuntimeProviderConfig(
            provider="openai",
            transport="responses",
            api_key="test-key",
            base_url="https://api.openai.com/v1",
        ),
        model_name="gpt-5.4-mini",
        runner=runner,
    )


def _tool_execution(name: str, arguments: dict[str, object], call_id: str):
    return type(
        "_ToolExecution",
        (),
        {
            "name": name,
            "arguments": arguments,
            "call_id": call_id,
        },
    )()


def _academic_calendar_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="今天第几教学周",
        request_id="req-sdk-academic-calendar",
        payload=AcademicCalendarLookupPayload(
            query_text="今天第几教学周",
            query_kind="date_week",
        ),
        allowed_tools=("academic_calendar_lookup",),
    )


if __name__ == "__main__":
    unittest.main()
