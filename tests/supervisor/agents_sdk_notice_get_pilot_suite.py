from __future__ import annotations

import unittest

from campus_contracts import (
    AgentRequest,
    CampusNoticeDiscoverPayload,
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
            canonical_url="https://campus.example/notices/spring-holiday",
            normalized_body="春假时间为 5 月 1 日至 5 月 5 日。",
            provenance_refs=("source-truth:notice:2026-spring",),
        )

    def discover_notice(self, _query: NoticeDiscoverQuery):
        self.discover_called = True
        raise AssertionError("notice_get SDK pilot must not call discover")


class AgentsSdkNoticeGetPilotTest(unittest.TestCase):
    def test_notice_get_pilot_executes_repo_owned_tool_before_final_answer(self) -> None:
        captured_run_request: AgentsSdkRunRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal captured_run_request
            captured_run_request = run_request
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={
                        "notice_id": "notice:2026-spring-holiday",
                        "source_family": "official_web_public_notice",
                    },
                    call_id="call-sdk-notice-get",
                )
            )
            self.assertEqual(tool_result["outcome"], "resolved_current")
            return AgentsSdkRunResult(
                final_output="春假时间为 5 月 1 日至 5 月 5 日。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={
                            "notice_id": "notice:2026-spring-holiday",
                            "source_family": "official_web_public_notice",
                        },
                        call_id="call-sdk-notice-get",
                    ),
                ),
                model_response_ref="resp-sdk-notice-get",
            )

        query_service = _FakeNoticeGetQueryService()
        response = run_notice_get_agents_sdk_pilot_adapter(
            _notice_get_request(),
            runner=fake_runner,
            query_service=query_service,
            enabled=True,
        )

        self.assertIsNotNone(captured_run_request)
        self.assertIsNotNone(query_service.last_get_query)
        assert query_service.last_get_query is not None
        self.assertEqual(
            query_service.last_get_query.payload,
            CampusNoticeGetPayload(
                notice_id="notice:2026-spring-holiday",
                source_family="official_web_public_notice",
            ),
        )
        self.assertFalse(query_service.discover_called)
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "春假时间为 5 月 1 日至 5 月 5 日。")
        self.assertIsInstance(response.result, CampusNoticeGetResult)
        assert isinstance(response.result, CampusNoticeGetResult)
        self.assertEqual(response.result.notice_id, "notice:2026-spring-holiday")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.source_ref_count, 2)
        safe_details = response.agent_observability.safe_details
        self.assertIn("agents_sdk_runner_projection", safe_details)
        self.assertEqual(
            safe_details["agents_sdk_runner_projection"]["tool_execution_count"],
            1,
        )
        self.assertEqual(
            safe_details["agents_sdk_notice_get_pilot"]["tool_response_status"],
            "completed",
        )

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

    def test_notice_get_pilot_rejects_non_notice_get_request(self) -> None:
        response = run_notice_get_agents_sdk_pilot_adapter(
            AgentRequest(
                target="notice-agent",
                user_goal="找春假通知",
                payload=CampusNoticeDiscoverPayload(query_text="春假"),
                allowed_tools=("campus_notice_discover",),
            ),
            runner=lambda _run_request: AgentsSdkRunResult(final_output="x"),
            query_service=_FakeNoticeGetQueryService(),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "request_not_admitted")

    def test_notice_get_pilot_fails_closed_on_query_service_failure(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:2026-spring-holiday"},
                    call_id="call-sdk-notice-failure",
                )
            )
            raise AssertionError("tool execution failure should abort the runner")

        response = run_notice_get_agents_sdk_pilot_adapter(
            _notice_get_request(),
            runner=fake_runner,
            query_service=_FakeNoticeGetQueryService(fail_get=True),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertTrue(response.error.retryable if response.error else False)
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_tool_execution_failed")

    def test_agent_delegates_route_notice_get_to_sdk_pilot_when_gate_matches(self) -> None:
        provider_called = False

        def provider(_request: ProviderFunctionToolRequest) -> dict[str, object]:
            nonlocal provider_called
            provider_called = True
            raise AssertionError("SDK pilot should be preferred over provider tool runtime")

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:2026-spring-holiday"},
                    call_id="call-sdk-delegate",
                )
            )
            return AgentsSdkRunResult(
                final_output="SDK pilot final answer.",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:2026-spring-holiday"},
                        call_id="call-sdk-delegate",
                    ),
                ),
            )

        delegates = _build_agent_delegates(
            settings=ApiSettings(
                provider_tool_runtime_enabled=True,
                agents_sdk_runtime_enabled=True,
                agents_sdk_runtime_allowed_targets=("notice-agent",),
                agents_sdk_runtime_allowed_tools=("campus_notice_get",),
            ),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            notice_query_service=_FakeNoticeGetQueryService(),
            provider_tool_provider=provider,
            agents_sdk_notice_get_runner=fake_runner,
        )

        response = delegates["notice-agent"](_notice_get_request())

        self.assertFalse(provider_called)
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "SDK pilot final answer.")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertIn(
            "agents_sdk_notice_get_pilot",
            response.agent_observability.safe_details,
        )


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="读取这条通知",
        request_id="req-sdk-notice-get",
        payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
        allowed_tools=("campus_notice_get",),
    )


if __name__ == "__main__":
    unittest.main()
