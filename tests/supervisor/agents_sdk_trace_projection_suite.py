from __future__ import annotations

import json
import unittest
from dataclasses import replace

from campus_contracts import AgentRequest, CampusNoticeDiscoverPayload
from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunnerTimeoutError,
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
    AgentsSdkToolCall,
    AgentsSdkToolExecutionRequest,
    run_agents_sdk_runner_shell,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpecRegistry,
    default_tool_spec_registry,
)


class AgentsSdkTraceProjectionTest(unittest.TestCase):
    def test_success_response_includes_sanitized_trace_projection(self) -> None:
        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            return AgentsSdkRunResult(
                final_output="已找到相关通知。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假通知"},
                        call_id="call-sdk-001",
                    ),
                ),
                model_response_ref="resp-sdk-001",
            )

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=fake_runner,
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        safe_details = response.agent_observability.safe_details
        trace = safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["schema_version"], "agents-sdk-trace-projection-v1")
        self.assertEqual(trace["adapter_lane"], "agents_sdk_domain_agent_adapter")
        self.assertEqual(trace["runtime_posture"], "sdk_adapter_admitted")
        self.assertEqual(trace["target"], "notice-agent")
        self.assertEqual(trace["selected_tool"], "campus_notice_discover")
        self.assertEqual(trace["tool_call_count"], 1)
        self.assertEqual(trace["tool_execution_count"], 0)
        self.assertEqual(trace["tool_argument_keys"], ["query_text"])
        self.assertEqual(trace["tool_outcome"], "sdk_completed")
        self.assertEqual(trace["result_outcome"], "sdk_completed")
        self.assertEqual(trace["instruction_profile_id"], "notice_discover_card_search")
        self.assertEqual(trace["result_usage_mode"], "notice_card_listing")
        self.assertEqual(
            trace["surface_execution_mode"],
            "sdk_mediated_answer_shaping",
        )
        self.assertEqual(trace["failure_class"], "")
        self.assertFalse(trace["retryable"])
        self.assertTrue(trace["tool_attempted"])
        self.assertEqual(trace["model_response_ref"], "resp-sdk-001")
        self.assertIn("model_name", trace)
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
            _notice_discover_request(),
            runner=timed_out,
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        trace = response.agent_observability.safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["schema_version"], "agents-sdk-trace-projection-v1")
        self.assertEqual(trace["failure_class"], "sdk_timeout")
        self.assertTrue(trace["retryable"])
        self.assertTrue(trace["tool_attempted"])
        self.assertEqual(trace["selected_tool"], "campus_notice_discover")
        self.assertEqual(trace["tool_call_count"], 0)
        self.assertEqual(trace["tool_execution_count"], 0)
        self.assertEqual(trace["tool_argument_keys"], [])
        self.assertIsInstance(trace["latency_ms"], int)
        self.assertGreaterEqual(trace["latency_ms"], 0)

    def test_tool_result_projection_omits_raw_sdk_trace_surfaces(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_discover",
                    arguments={"query_text": "春假通知"},
                    call_id="call-with-raw",
                )
            )
            return AgentsSdkRunResult(
                final_output="已找到。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假通知"},
                        call_id="call-with-raw",
                    ),
                ),
                model_response_ref="resp-with-raw",
            )

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
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
            tool_registry=_sdk_test_tool_registry(),
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


def _notice_discover_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="找春假通知",
        request_id="req-sdk-trace",
        payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
        allowed_tools=("campus_notice_discover",),
    )


def _sdk_test_tool_registry() -> ToolSpecRegistry:
    registry = default_tool_spec_registry()
    return replace(
        registry,
        tools=tuple(
            replace(tool, runtime_posture="sdk_adapter_admitted")
            if tool.name == "campus_notice_discover"
            else tool
            for tool in registry.tools
        ),
    )


if __name__ == "__main__":
    unittest.main()
