from __future__ import annotations

import unittest

from campus_contracts import (
    AgentRequest,
    CampusNoticeDiscoverPayload,
    CampusNoticeDiscoverResult,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
    NoticeCard,
)
from campus_notice_agent.query_service import NoticeDiscoverQuery, NoticeGetQuery
from campus_supervisor_agent_worker.agent_delegates import _build_agent_delegates
from campus_supervisor_agent_worker.agent_delegates import _build_agents_sdk_runner
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

    def test_agent_delegates_route_notice_discover_to_sdk_when_toolspec_admitted(self) -> None:
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

    def test_agents_sdk_runner_builder_is_target_agnostic_and_fail_closed(self) -> None:
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
        self.assertIsNotNone(
            _build_agents_sdk_runner(
                ApiSettings(
                    agents_sdk_runtime_enabled=True,
                    prompt_runtime_provider="openai-responses",
                    prompt_runtime_api_key="test-key",
                    prompt_runtime_base_url="https://api.openai.com/v1",
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


if __name__ == "__main__":
    unittest.main()
