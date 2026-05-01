from __future__ import annotations

import unittest

from campus_contracts import (
    AgentRequest,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
)
from campus_notice_agent.query_service import NoticeDiscoverQuery, NoticeGetQuery
from campus_supervisor_agent_worker.agent_delegates import _build_agent_delegates
from campus_supervisor_agent_worker.agents_sdk_notice_get_pilot import (
    run_notice_get_agents_sdk_pilot_adapter,
)
from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
)
from campus_supervisor_agent_worker.provider_function_calling import (
    ProviderFunctionToolRequest,
)
from campus_supervisor_agent_worker.settings import ApiSettings


class _FakeNoticeGetQueryService:
    def __init__(self, *, fail_get: bool = False) -> None:
        self.fail_get = fail_get
        self.last_get_query: NoticeGetQuery | None = None
        self.discover_called = False

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

    def discover_notice(self, _query: NoticeDiscoverQuery):
        self.discover_called = True
        raise AssertionError("selected notice resolve must not call discover")


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
                agents_sdk_runtime_allowed_targets=("notice-agent",),
                agents_sdk_runtime_allowed_tools=("campus_notice_get",),
            ),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            notice_query_service=query_service,
            provider_tool_provider=provider,
            agents_sdk_notice_get_runner=fake_runner,
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


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="读取这条通知",
        request_id="req-sdk-notice-get",
        payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
        allowed_tools=(),
    )


if __name__ == "__main__":
    unittest.main()
