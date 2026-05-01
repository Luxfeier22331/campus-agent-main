from __future__ import annotations

import json
import unittest

from campus_contracts import (
    AgentRequest,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
)
from campus_notice_agent.query_service import NoticeGetQuery
from campus_supervisor_agent_worker.agents_sdk_notice_get_pilot import (
    run_notice_get_agents_sdk_pilot_adapter,
)
from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunnerTimeoutError,
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
    AgentsSdkToolCall,
    AgentsSdkToolExecutionRequest,
    run_agents_sdk_runner_shell,
)
from campus_supervisor_agent_worker.provider_function_calling import (
    ProviderFunctionToolRequest,
)
from campus_supervisor_agent_worker.provider_tool_runtime import (
    run_notice_get_provider_tool_adapter,
)


class _FakeNoticeGetQueryService:
    def __init__(self) -> None:
        self.last_get_query: NoticeGetQuery | None = None

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        self.last_get_query = query
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

    def discover_notice(self, _query: object) -> object:
        raise AssertionError("notice_get trace tests must not call discover")


class AgentsSdkTraceProjectionTest(unittest.TestCase):
    def test_success_response_includes_sanitized_trace_projection(self) -> None:
        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            return AgentsSdkRunResult(
                final_output="这条通知已读取。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:2026-spring"},
                        call_id="call-sdk-001",
                    ),
                ),
                model_response_ref="resp-sdk-001",
            )

        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=fake_runner,
            enabled=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        safe_details = response.agent_observability.safe_details
        trace = safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["schema_version"], "agents-sdk-trace-projection-v1")
        self.assertEqual(trace["adapter_lane"], "agents_sdk_domain_agent_adapter")
        self.assertEqual(trace["runtime_posture"], "provider_loop_pilot")
        self.assertEqual(trace["target"], "notice-agent")
        self.assertEqual(trace["selected_tool"], "campus_notice_get")
        self.assertEqual(trace["tool_call_count"], 1)
        self.assertEqual(trace["tool_execution_count"], 0)
        self.assertEqual(trace["tool_argument_keys"], ["notice_id"])
        self.assertEqual(trace["tool_outcome"], "sdk_completed")
        self.assertEqual(trace["result_outcome"], "sdk_completed")
        self.assertEqual(trace["failure_class"], "")
        self.assertFalse(trace["retryable"])
        self.assertTrue(trace["tool_attempted"])
        self.assertEqual(trace["model_response_ref"], "resp-sdk-001")
        self.assertIsInstance(trace["latency_ms"], int)
        self.assertGreaterEqual(trace["latency_ms"], 0)

        lifecycle = safe_details["agents_sdk_tool_lifecycle_projection"]
        self.assertEqual(
            lifecycle["schema_version"],
            "agents-sdk-tool-lifecycle-projection-v1",
        )
        self.assertEqual(lifecycle["tool_call_id_source"], "repo")
        self.assertEqual(lifecycle["model_tool_call_ref"], "call-sdk-001")
        self.assertEqual(lifecycle["model_response_ref"], "resp-sdk-001")
        self.assertFalse(lifecycle["tool_output_submitted"])

    def test_fail_close_response_includes_sanitized_trace_projection(self) -> None:
        def timed_out(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            raise AgentsSdkRunnerTimeoutError("SDK run timed out")

        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=timed_out,
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        trace = response.agent_observability.safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["schema_version"], "agents-sdk-trace-projection-v1")
        self.assertEqual(trace["failure_class"], "sdk_timeout")
        self.assertTrue(trace["retryable"])
        self.assertTrue(trace["tool_attempted"])
        self.assertEqual(trace["selected_tool"], "campus_notice_get")
        self.assertEqual(trace["tool_call_count"], 0)
        self.assertEqual(trace["tool_execution_count"], 0)
        self.assertEqual(trace["tool_argument_keys"], [])
        self.assertIsInstance(trace["latency_ms"], int)
        self.assertGreaterEqual(trace["latency_ms"], 0)

    def test_notice_get_pilot_preserves_trace_projection_when_merging_notice_result(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={
                        "notice_id": "notice:2026-spring",
                        "source_family": "official_web_public_notice",
                    },
                    call_id="call-sdk-notice-get",
                )
            )
            return AgentsSdkRunResult(
                final_output="春假时间为 5 月 1 日至 5 月 5 日。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={
                            "notice_id": "notice:2026-spring",
                            "source_family": "official_web_public_notice",
                        },
                        call_id="call-sdk-notice-get",
                    ),
                ),
                model_response_ref="resp-sdk-notice-get",
            )

        response = run_notice_get_agents_sdk_pilot_adapter(
            _notice_get_request(),
            runner=fake_runner,
            query_service=_FakeNoticeGetQueryService(),
            enabled=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        safe_details = response.agent_observability.safe_details
        self.assertIn("agents_sdk_notice_get_pilot", safe_details)
        trace = safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["tool_execution_count"], 1)
        self.assertEqual(trace["tool_outcome"], "sdk_completed")
        lifecycle = safe_details["agents_sdk_tool_lifecycle_projection"]
        self.assertTrue(lifecycle["tool_output_submitted"])
        self.assertEqual(lifecycle["tool_execution_owner"], "repo")

    def test_tool_result_projection_omits_raw_sdk_trace_surfaces(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:2026-spring"},
                    call_id="call-with-raw",
                )
            )
            return AgentsSdkRunResult(
                final_output="已读取。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:2026-spring"},
                        call_id="call-with-raw",
                    ),
                ),
                model_response_ref="resp-with-raw",
            )

        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: {
                "outcome": "resolved_current",
                "raw_model_output": "do not project model text",
                "trace_url": "https://platform.openai.com/traces/raw",
                "sdk_run_state": {"steps": ["internal"]},
                "provider_response": "raw provider payload",
            },
            require_tool_execution=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        safe_details = response.agent_observability.safe_details
        safe_json = json.dumps(safe_details, ensure_ascii=False, sort_keys=True)
        for forbidden_fragment in (
            "raw_model_output",
            "do not project model text",
            "trace_url",
            "platform.openai.com/traces/raw",
            "sdk_run_state",
            "provider_response",
            "raw provider payload",
        ):
            with self.subTest(forbidden_fragment=forbidden_fragment):
                self.assertNotIn(forbidden_fragment, safe_json)
        self.assertIn("resolved_current", safe_json)

    def test_sdk_projection_covers_provider_lifecycle_fields(self) -> None:
        def sdk_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:2026-spring"},
                    call_id="call-sdk-parity",
                )
            )
            return AgentsSdkRunResult(
                final_output="SDK final answer.",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:2026-spring"},
                        call_id="call-sdk-parity",
                    ),
                ),
                model_response_ref="resp-sdk-parity",
            )

        def provider(_request: ProviderFunctionToolRequest) -> dict[str, object]:
            return _responses_function_call(
                name="campus_notice_get",
                arguments={"notice_id": "notice:2026-spring"},
                call_id="call-provider-parity",
                response_id="resp-provider-parity",
            )

        query_service = _FakeNoticeGetQueryService()
        sdk_response = run_notice_get_agents_sdk_pilot_adapter(
            _notice_get_request(),
            runner=sdk_runner,
            query_service=query_service,
            enabled=True,
        )
        provider_response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=query_service,
            enabled=True,
        )

        self.assertIsNotNone(sdk_response.agent_observability)
        self.assertIsNotNone(provider_response.agent_observability)
        assert sdk_response.agent_observability is not None
        assert provider_response.agent_observability is not None
        sdk_lifecycle = sdk_response.agent_observability.safe_details[
            "agents_sdk_tool_lifecycle_projection"
        ]
        provider_lifecycle = provider_response.agent_observability.safe_details[
            "provider_tool_call_projection"
        ]
        comparable_fields = {
            "schema_version",
            "tool_call_id_source",
            "model_tool_call_ref",
            "model_response_ref",
            "tool_output_submitted",
        }
        self.assertLessEqual(comparable_fields, set(sdk_lifecycle))
        self.assertLessEqual(comparable_fields, set(provider_lifecycle))


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="读取这条通知",
        request_id="req-sdk-trace",
        payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
        allowed_tools=("campus_notice_get",),
    )


def _responses_function_call(
    *,
    name: str,
    arguments: dict[str, object],
    call_id: str,
    response_id: str,
) -> dict[str, object]:
    return {
        "id": response_id,
        "output": [
            {
                "type": "function_call",
                "name": name,
                "arguments": json.dumps(arguments, ensure_ascii=False),
                "call_id": call_id,
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
