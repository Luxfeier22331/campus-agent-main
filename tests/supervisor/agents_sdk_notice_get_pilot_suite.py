from __future__ import annotations

import unittest

from campus_calendar_agent.query_service import AcademicCalendarQuery
from campus_contracts import (
    AcademicCalendarLookupPayload,
    AcademicCalendarLookupResult,
    AgentRequest,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    ContactDirectoryContactPoint,
    ContactDirectoryContactRef,
    ContactDirectoryLookupPayload,
    ContactDirectoryLookupResult,
    NoticeCard,
    ScheduledDeparture,
    ServiceGuideLookupPayload,
    ServiceGuideLookupResult,
    ServiceGuideSection,
    ServiceGuideServiceRef,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    TransportRouteRef,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
    TransportScheduleSnapshotRef,
    TransportStopRef,
)
from campus_notice_agent.query_service import NoticeDiscoverQuery, NoticeGetQuery
from campus_services_agent.query_service import (
    ContactDirectoryQuery,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
)
from campus_supervisor_agent_worker.agent_delegates import (
    _build_agent_delegates,
    _build_agents_sdk_runner,
)
from campus_supervisor_agent_worker.agents_sdk_notice_get_pilot import (
    run_notice_get_agents_sdk_pilot_adapter,
)
from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
    AgentsSdkToolCall,
    AgentsSdkToolExecutionRequest,
)
from campus_supervisor_agent_worker.provider_function_calling import (
    ProviderFunctionToolRequest,
)
from campus_supervisor_agent_worker.settings import ApiSettings


class _FakeNoticeGetQueryService:
    def __init__(self, *, fail_get: bool = False) -> None:
        self.fail_get = fail_get
        self.last_get_query: NoticeGetQuery | None = None
        self.last_discover_query: NoticeDiscoverQuery | None = None

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        self.last_get_query = query
        if self.fail_get:
            raise RuntimeError("notice query service unavailable")
        return CampusNoticeGetResult(
            notice_id=query.payload.notice_id,
            outcome="resolved_current",
            title="2026 年春假安排通知",
            source_family=query.payload.source_family or "official_web_public_notice",
            source_url="https://campus.example/notices/spring-holiday",
            body_excerpt="春假时间为 5 月 1 日至 5 月 5 日。",
            provenance_refs=("source-truth:notice:2026-spring",),
        )

    def discover_notice(self, query: NoticeDiscoverQuery) -> CampusNoticeDiscoverResult:
        self.last_discover_query = query
        return CampusNoticeDiscoverResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            source_families=("official_web_public_notice",),
            notice_cards=(
                NoticeCard(
                    notice_id="notice:2026-spring",
                    title="2026 年春假安排通知",
                    source_family="official_web_public_notice",
                    source_url="https://campus.example/notices/spring-holiday",
                    published_at="2026-04-20",
                ),
            ),
            queried_time_anchor="2026-04-21T10:30:00+08:00",
        )


class _FakeCampusServicesQueryService:
    def __init__(self) -> None:
        self.last_service_status_query: ServiceStatusQuery | None = None
        self.last_service_guide_query: ServiceGuideQuery | None = None
        self.last_transport_schedule_query: TransportScheduleQuery | None = None
        self.last_contact_directory_query: ContactDirectoryQuery | None = None

    def lookup_service_status(self, query: ServiceStatusQuery) -> ServiceStatusLookupResult:
        self.last_service_status_query = query
        return ServiceStatusLookupResult(
            subject_query=query.payload.subject_query,
            outcome="resolved_current",
            resolved_subject=query.payload.subject_query,
            observed_status="open",
            status_note="正常开放",
            related_notice_refs=("notice:library-hours",),
        )

    def lookup_service_guide(self, query: ServiceGuideQuery) -> ServiceGuideLookupResult:
        self.last_service_guide_query = query
        return ServiceGuideLookupResult(
            service_query=query.payload.service_query,
            guide_focus=query.payload.guide_focus,
            outcome="resolved_current",
            resolved_service=ServiceGuideServiceRef(
                service_id="service:campus-card-reissue",
                display_name="校园卡补办",
                category="campus_card",
                campus_scope="all",
                audience=("student",),
            ),
            guide_sections=(
                ServiceGuideSection(
                    section_id="service:campus-card-reissue:procedure",
                    section_type="procedure",
                    title="补办流程",
                    content="学生可在自助补卡机补卡。",
                    source_refs=("official_web:campus-card-guide#section=procedure",),
                ),
            ),
            source_refs=("official_web:campus-card-guide#section=procedure",),
        )

    def lookup_transport_schedule(
        self, query: TransportScheduleQuery
    ) -> TransportScheduleLookupResult:
        self.last_transport_schedule_query = query
        return TransportScheduleLookupResult(
            query_text=query.payload.query_text,
            intent=query.payload.intent,
            outcome="resolved_current",
            resolved_route=TransportRouteRef(
                route_id="route:haidian-fengtai",
                display_name="两校区通勤班车",
                service_family="campus_shuttle",
            ),
            service_status="running",
            requested_service_date="2026-03-18",
            selected_departure=ScheduledDeparture(
                departure_at="2026-03-18T08:00:00+08:00",
                origin_stop_ref=TransportStopRef(
                    stop_id="haidian",
                    display_name="海淀校区",
                ),
                destination_stop_ref=TransportStopRef(
                    stop_id="fengtai",
                    display_name="丰台校区",
                ),
            ),
            schedule_snapshot=TransportScheduleSnapshotRef(
                snapshot_id="snapshot:355122",
                published_at="2026-03-18T08:00:00+08:00",
                source_ref="notice:355122",
            ),
        )

    def lookup_contact_directory(
        self,
        query: ContactDirectoryQuery,
    ) -> ContactDirectoryLookupResult:
        self.last_contact_directory_query = query
        return ContactDirectoryLookupResult(
            query_text=query.payload.query_text,
            contact_focus=query.payload.contact_focus,
            outcome="resolved_current",
            resolved_contact=ContactDirectoryContactRef(
                contact_id="contact:campus-card-center",
                display_name="校园卡管理中心",
                entity_type="department",
                department="信息化建设管理处",
                campus_scope="haidian",
            ),
            contact_points=(
                ContactDirectoryContactPoint(
                    channel_type="phone",
                    label="咨询电话",
                    value="010-68933381",
                    normalized_value="01068933381",
                    source_refs=("official_web:campus-card-guide#contact",),
                ),
            ),
            source_refs=("official_web:campus-card-guide#contact",),
        )


class _FakeCalendarQueryService:
    def __init__(self) -> None:
        self.last_academic_calendar_query: AcademicCalendarQuery | None = None

    def lookup_academic_calendar(
        self,
        query: AcademicCalendarQuery,
    ) -> AcademicCalendarLookupResult:
        self.last_academic_calendar_query = query
        return AcademicCalendarLookupResult(
            query_text=query.payload.query_text,
            outcome="resolved_current",
            resolved_date="2026-05-05",
            academic_year_label="2025-2026学年",
            term_label="春季学期",
            week_index=11,
            day_kind="teaching_day",
            source_refs=("official_web:academic-calendar-2025-2026",),
        )


class AgentsSdkNoticeGetPilotTest(unittest.TestCase):
    def test_notice_get_pilot_is_closed_even_when_enabled(self) -> None:
        runner_called = False
        query_service = _FakeNoticeGetQueryService()

        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            raise AssertionError("closed notice get pilot must not call SDK runner")

        response = run_notice_get_agents_sdk_pilot_adapter(
            _notice_get_request(),
            runner=fake_runner,
            query_service=query_service,
            enabled=True,
        )

        self.assertFalse(runner_called)
        self.assertIsNone(query_service.last_get_query)
        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "runtime_closed")
        self.assertEqual(response.agent_observability.selected_tool, "")

    def test_notice_get_pilot_requires_explicit_gate(self) -> None:
        runner_called = False

        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            return AgentsSdkRunResult(final_output="x")

        query_service = _FakeNoticeGetQueryService()
        response = run_notice_get_agents_sdk_pilot_adapter(
            _notice_get_request(),
            runner=fake_runner,
            query_service=query_service,
            enabled=False,
        )

        self.assertFalse(runner_called)
        self.assertIsNone(query_service.last_get_query)
        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "runtime_disabled")

    def test_agent_delegates_do_not_route_internal_notice_get_to_sdk_or_provider(self) -> None:
        provider_called = False
        runner_called = False
        query_service = _FakeNoticeGetQueryService()

        def provider(_request: ProviderFunctionToolRequest) -> dict[str, object]:
            nonlocal provider_called
            provider_called = True
            raise AssertionError("internal notice get must not call provider runtime")

        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            raise AssertionError("internal notice get must not call SDK pilot")

        delegates = _build_agent_delegates(
            settings=ApiSettings(
                provider_tool_runtime_enabled=True,
                agents_sdk_runtime_enabled=True,
            ),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            calendar_query_service=None,
            notice_query_service=query_service,
            provider_tool_provider=provider,
            agents_sdk_runner=fake_runner,
        )

        response = delegates["notice-agent"](_notice_get_request())

        self.assertFalse(provider_called)
        self.assertFalse(runner_called)
        self.assertIsNotNone(query_service.last_get_query)
        self.assertEqual(response.status, "completed")
        self.assertIn("原文链接", response.answer_text)
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertNotIn(
            "agents_sdk_notice_get_pilot",
            response.agent_observability.safe_details,
        )

    def test_agent_delegates_route_notice_discover_to_sdk_when_explicitly_admitted(self) -> None:
        runner_called = False
        query_service = _FakeNoticeGetQueryService()

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            self.assertEqual(run_request.target, "notice-agent")
            self.assertEqual(run_request.allowed_tools, ("campus_notice_discover",))
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_discover",
                    arguments={"query_text": "春假通知"},
                    call_id="call-notice-discover",
                )
            )
            self.assertEqual(tool_result["outcome"], "resolved_current")
            self.assertEqual(tool_result["notice_card_count"], 1)
            return AgentsSdkRunResult(
                final_output="已找到 2026 年春假安排通知，原文链接：https://campus.example/notices/spring-holiday",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假通知"},
                        call_id="call-notice-discover",
                    ),
                ),
                model_response_ref="resp-notice-discover",
            )

        delegates = _build_agent_delegates(
            settings=ApiSettings(
                agents_sdk_runtime_enabled=True,
            ),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            calendar_query_service=None,
            notice_query_service=query_service,
            agents_sdk_runner=fake_runner,
        )

        response = delegates["notice-agent"](_notice_discover_request())

        self.assertTrue(runner_called)
        self.assertIsNotNone(query_service.last_discover_query)
        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "campus_notice_discover")
        self.assertEqual(response.agent_observability.tool_outcome, "sdk_completed")
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["tool_execution_count"], 1)
        self.assertEqual(projection["tool_result_projection"]["notice_card_count"], 1)

    def test_agent_delegates_fall_back_to_direct_notice_discover_without_sdk_gate(self) -> None:
        runner_called = False
        query_service = _FakeNoticeGetQueryService()

        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            raise AssertionError("SDK runner must not be called without explicit gate")

        delegates = _build_agent_delegates(
            settings=ApiSettings(
                agents_sdk_runtime_enabled=False,
            ),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            calendar_query_service=None,
            notice_query_service=query_service,
            agents_sdk_runner=fake_runner,
        )

        response = delegates["notice-agent"](_notice_discover_request())

        self.assertFalse(runner_called)
        self.assertIsNotNone(query_service.last_discover_query)
        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.tool_outcome, "resolved_current")
        self.assertNotIn(
            "agents_sdk_runner_projection",
            response.agent_observability.safe_details,
        )

    def test_agent_delegates_route_service_guide_to_sdk_when_tool_is_admitted(self) -> None:
        runner_called = False
        query_service = _FakeCampusServicesQueryService()

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            self.assertEqual(run_request.target, "campus-services-agent")
            self.assertEqual(run_request.allowed_tools, ("service_guide_lookup",))
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="service_guide_lookup",
                    arguments={
                        "service_query": "校园卡补办",
                        "guide_focus": "procedure",
                    },
                    call_id="call-service-guide",
                )
            )
            self.assertEqual(tool_result["outcome"], "resolved_current")
            self.assertEqual(tool_result["service_query"], "校园卡补办")
            self.assertEqual(tool_result["source_ref_count"], 1)
            return AgentsSdkRunResult(
                final_output="校园卡可在自助补卡机补办。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="service_guide_lookup",
                        arguments={
                            "service_query": "校园卡补办",
                            "guide_focus": "procedure",
                        },
                        call_id="call-service-guide",
                    ),
                ),
                model_response_ref="resp-service-guide",
            )

        delegates = _build_agent_delegates(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            rag_prompt_executor=None,
            campus_services_query_service=query_service,
            calendar_query_service=None,
            notice_query_service=None,
            agents_sdk_runner=fake_runner,
        )

        response = delegates["campus-services-agent"](_service_guide_request())

        self.assertTrue(runner_called)
        self.assertIsNotNone(query_service.last_service_guide_query)
        self.assertIsNone(query_service.last_service_status_query)
        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "service_guide_lookup")
        self.assertEqual(response.agent_observability.tool_outcome, "sdk_completed")
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["tool_result_projection"]["source_ref_count"], 1)

    def test_agent_delegates_route_contact_directory_to_sdk_when_tool_is_admitted(self) -> None:
        runner_called = False
        query_service = _FakeCampusServicesQueryService()

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            self.assertEqual(run_request.allowed_tools, ("contact_directory_lookup",))
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="contact_directory_lookup",
                    arguments={
                        "query_text": "校园卡电话",
                        "contact_focus": "phone",
                    },
                    call_id="call-contact",
                )
            )
            self.assertEqual(tool_result["outcome"], "resolved_current")
            self.assertEqual(tool_result["query_text"], "校园卡电话")
            self.assertEqual(tool_result["source_ref_count"], 1)
            return AgentsSdkRunResult(
                final_output="校园卡管理中心电话是 010-68933381。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="contact_directory_lookup",
                        arguments={
                            "query_text": "校园卡电话",
                            "contact_focus": "phone",
                        },
                        call_id="call-contact",
                    ),
                ),
                model_response_ref="resp-contact",
            )

        delegates = _build_agent_delegates(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            rag_prompt_executor=None,
            campus_services_query_service=query_service,
            calendar_query_service=None,
            notice_query_service=None,
            agents_sdk_runner=fake_runner,
        )

        response = delegates["campus-services-agent"](_contact_directory_request())

        self.assertTrue(runner_called)
        self.assertIsNotNone(query_service.last_contact_directory_query)
        self.assertEqual(response.status, "completed")
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "contact_directory_lookup")

    def test_agent_delegates_route_academic_calendar_to_sdk_when_tool_is_admitted(self) -> None:
        runner_called = False
        query_service = _FakeCalendarQueryService()

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            self.assertEqual(run_request.target, "calendar-agent")
            self.assertEqual(run_request.allowed_tools, ("academic_calendar_lookup",))
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
            campus_services_query_service=None,
            calendar_query_service=query_service,
            notice_query_service=None,
            agents_sdk_runner=fake_runner,
        )

        response = delegates["calendar-agent"](_academic_calendar_request())

        self.assertTrue(runner_called)
        self.assertIsNotNone(query_service.last_academic_calendar_query)
        self.assertEqual(response.status, "completed")
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "academic_calendar_lookup")

    def test_agent_delegates_keep_deterministic_services_off_sdk(self) -> None:
        runner_called = False
        query_service = _FakeCampusServicesQueryService()

        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            raise AssertionError("deterministic service tools must not route to SDK")

        delegates = _build_agent_delegates(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            rag_prompt_executor=None,
            campus_services_query_service=query_service,
            calendar_query_service=None,
            notice_query_service=None,
            agents_sdk_runner=fake_runner,
        )

        status_response = delegates["campus-services-agent"](_service_status_request())
        transport_response = delegates["campus-services-agent"](_transport_schedule_request())

        self.assertFalse(runner_called)
        self.assertIsNotNone(query_service.last_service_status_query)
        self.assertIsNotNone(query_service.last_transport_schedule_query)
        self.assertEqual(status_response.status, "completed")
        self.assertEqual(transport_response.status, "completed")

    def test_agents_sdk_runner_builder_is_target_agnostic_and_fail_closed(self) -> None:
        self.assertIsNone(_build_agents_sdk_runner(ApiSettings()))
        self.assertIsNone(
            _build_agents_sdk_runner(
                ApiSettings(
                    agents_sdk_runtime_enabled=True,
                    prompt_runtime_provider="openai-responses",
                    prompt_runtime_api_key="test-key",
                )
            )
        )
        self.assertIsNone(
            _build_agents_sdk_runner(
                ApiSettings(
                    agents_sdk_runtime_enabled=True,
                    prompt_runtime_provider="openai-responses",
                    agent_prompt_model="gpt-agent",
                )
            )
        )

    def test_agents_sdk_runner_builder_creates_openai_runner_when_notice_discover_is_admitted(
        self,
    ) -> None:
        runner = _build_agents_sdk_runner(
            ApiSettings(
                agents_sdk_runtime_enabled=True,
                prompt_runtime_provider="openai-responses",
                prompt_runtime_api_key="test-key",
                prompt_runtime_base_url="https://api.openai.com/v1",
                agent_prompt_model="gpt-agent",
            )
        )

        self.assertIsNotNone(runner)
        self.assertEqual(runner.__class__.__name__, "OpenAIAgentsSdkRunner")


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="读取这条通知",
        request_id="req-sdk-notice-get",
        payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
        allowed_tools=(),
    )


def _notice_discover_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="找春假通知",
        request_id="req-sdk-notice-discover",
        payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
        allowed_tools=("campus_notice_discover",),
    )


def _service_guide_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="校园卡丢了怎么办",
        request_id="req-sdk-service-guide",
        payload=ServiceGuideLookupPayload(
            service_query="校园卡补办",
            guide_focus="procedure",
        ),
        allowed_tools=("service_guide_lookup",),
    )


def _contact_directory_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="校园卡管理中心电话",
        request_id="req-sdk-contact-directory",
        payload=ContactDirectoryLookupPayload(
            query_text="校园卡电话",
            contact_focus="phone",
        ),
        allowed_tools=("contact_directory_lookup",),
    )


def _academic_calendar_request() -> AgentRequest:
    return AgentRequest(
        target="calendar-agent",
        user_goal="今天第几教学周",
        request_id="req-sdk-academic-calendar",
        payload=AcademicCalendarLookupPayload(query_text="今天第几教学周"),
        allowed_tools=("academic_calendar_lookup",),
    )


def _service_status_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="图书馆今天开门吗",
        request_id="req-direct-service-status",
        payload=ServiceStatusLookupPayload(subject_query="海淀校区图书馆"),
        allowed_tools=("service_status_lookup",),
    )


def _transport_schedule_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="今天两校区班车几点发",
        request_id="req-direct-transport-schedule",
        payload=TransportScheduleLookupPayload(
            query_text="今天两校区班车几点发",
            intent="next_departure",
        ),
        allowed_tools=("transport_schedule_lookup",),
    )


if __name__ == "__main__":
    unittest.main()
