from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import (
    AgentRequest,
    CampusNoticeDiscoverPayload,
    TransportScheduleLookupPayload,
    WorkflowAgentContext,
)
from campus_supervisor_agent_worker.agents_sdk_runner import (
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


class AgentsSdkWorkflowStepTraceSuite(unittest.TestCase):
    def test_success_trace_includes_workflow_step_metadata_and_projection_refs(self) -> None:
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
        assert response.agent_observability is not None
        trace = response.agent_observability.safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["workflow_run_ref"], "workflow:req-sdk-trace")
        self.assertEqual(trace["step_id"], "handoff:notice-agent:campus_notice_discover")
        self.assertEqual(trace["agent_id"], "notice-agent")
        self.assertEqual(trace["step_status"], "completed")
        self.assertEqual(trace["terminal_reason"], "")
        self.assertEqual(trace["fail_close_reason"], "")
        self.assertEqual(
            trace["input_projection_refs"][0]["projection_id"],
            "projection:notice_context:test",
        )

    def test_fail_close_trace_includes_workflow_step_metadata(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=lambda _run_request: (_ for _ in ()).throw(RuntimeError("boom")),
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        assert response.agent_observability is not None
        trace = response.agent_observability.safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["workflow_run_ref"], "workflow:req-sdk-trace")
        self.assertEqual(trace["step_id"], "handoff:notice-agent:campus_notice_discover")
        self.assertEqual(trace["agent_id"], "notice-agent")
        self.assertEqual(trace["step_status"], "error")
        self.assertEqual(trace["terminal_reason"], "sdk_runner_failed")
        self.assertEqual(trace["fail_close_reason"], "sdk_runner_failed")

    def test_transport_step_trace_includes_output_projection_summary(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="transport_schedule_lookup",
                    arguments={
                        "query_text": "今天两校区班车几点发",
                        "intent": "next_departure",
                    },
                    call_id="call-transport-001",
                )
            )
            self.assertEqual(
                tool_result["resolved_route"]["display_name"],
                "两校区通勤班车",
            )
            return AgentsSdkRunResult(
                final_output="两校区通勤班车下一班 08:00 发车。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="transport_schedule_lookup",
                        arguments={
                            "query_text": "今天两校区班车几点发",
                            "intent": "next_departure",
                        },
                        call_id="call-transport-001",
                    ),
                ),
                model_response_ref="resp-transport-001",
            )

        response = run_agents_sdk_runner_shell(
            _transport_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: {
                "outcome": "resolved_current",
                "query_text": "今天两校区班车几点发",
                "intent": "next_departure",
                "service_status": "running",
                "source_ref_count": 1,
                "source_refs": ["notice:355122"],
                "resolved_route": {
                    "route_id": "route:intercampus:student",
                    "display_name": "两校区通勤班车",
                    "service_family": "intercampus_commute",
                },
                "selected_departure": {
                    "departure_at": "2026-03-18T08:00:00+08:00",
                },
            },
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "completed")
        assert response.agent_observability is not None
        trace = response.agent_observability.safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["workflow_run_ref"], "workflow:req-sdk-transport")
        self.assertEqual(trace["step_id"], "handoff:campus-services-agent:transport_schedule_lookup")
        output_projection = trace["output_projection_ref"]
        self.assertEqual(output_projection["projection_kind"], "schedule_baseline")
        self.assertTrue(output_projection["projection_id"].startswith("projection:schedule_baseline:"))
        self.assertTrue(output_projection["content_hash"].startswith("sha256:"))


def _notice_discover_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="找春假通知",
        request_id="req-sdk-trace",
        payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
        allowed_tools=("campus_notice_discover",),
        workflow_context=WorkflowAgentContext(
            target="notice-agent",
            workflow_run_ref="workflow:req-sdk-trace",
            step_id="handoff:notice-agent:campus_notice_discover",
            agent_id="notice-agent",
            required_projection_kind="notice_context",
            projection_refs=(
                {
                    "projection_id": "projection:notice_context:test",
                    "source_step_id": "handoff:notice-agent:campus_notice_get",
                    "projection_kind": "notice_context",
                    "content_hash": "sha256:test",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["title"],
                    },
                },
            ),
        ),
    )


def _transport_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="今天两校区班车几点发",
        request_id="req-sdk-transport",
        payload=TransportScheduleLookupPayload(
            query_text="今天两校区班车几点发",
            intent="next_departure",
        ),
        allowed_tools=("transport_schedule_lookup",),
        workflow_context=WorkflowAgentContext(
            target="campus-services-agent",
            workflow_run_ref="workflow:req-sdk-transport",
            step_id="handoff:campus-services-agent:transport_schedule_lookup",
            agent_id="campus-services-agent",
        ),
    )


def _sdk_test_tool_registry() -> ToolSpecRegistry:
    registry = default_tool_spec_registry()
    return replace(
        registry,
        tools=tuple(
            replace(tool, runtime_posture="sdk_adapter_admitted")
            if tool.name in {"campus_notice_discover", "transport_schedule_lookup"}
            else tool
            for tool in registry.tools
        ),
    )


if __name__ == "__main__":
    unittest.main()
