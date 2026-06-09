from __future__ import annotations

import unittest

from campus_contracts import (
    CampusNoticeDiscoverPayload,
    CapabilityRequest,
    WorkflowCapabilityContext,
)
from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.openai_agents_runtime import (
    OpenAIAgentsRunResult,
    OpenAIAgentsToolCall,
)
from campus_supervisor_agent_worker.openai_agents_runtime_projection import (
    OpenAIAgentsRuntimeProjectionError,
    OpenAIAgentsToolExecutionRecord,
    bounded_tool_result_projection,
    response_from_native_runtime_result,
    runtime_error_response,
)


class OpenAIAgentsRuntimeProjectionTest(unittest.TestCase):
    def test_success_projection_returns_completed_response(self) -> None:
        request = _request()
        descriptors = build_agents_sdk_tool_descriptors(request.allowed_tools)
        response = response_from_native_runtime_result(
            request,
            OpenAIAgentsRunResult(
                final_output="已找到相关通知。",
                tool_calls=(
                    OpenAIAgentsToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假通知"},
                        call_id="call-native-001",
                    ),
                ),
                model_response_ref="resp-native-001",
            ),
            descriptors=descriptors,
            tool_execution_records=(
                OpenAIAgentsToolExecutionRecord(
                    name="campus_notice_discover",
                    call_id="call-native-001",
                    arguments={"query_text": "春假通知"},
                    argument_keys=("query_text",),
                    result_projection={
                        "status": "completed",
                        "outcome": "resolved_current",
                        "query_text": "春假通知",
                        "notice_card_count": 1,
                        "source_ref_count": 1,
                    },
                ),
            ),
            require_tool_execution=True,
            latency_ms=8,
            instruction_profile_id="notice_discover_card_search",
            result_usage_mode="notice_card_listing",
            surface_execution_mode="sdk_mediated_answer_shaping",
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "已找到相关通知。")
        assert response.capability_observability is not None
        self.assertEqual(
            response.capability_observability.safe_details["agents_sdk_trace_projection"][
                "model_response_ref"
            ],
            "resp-native-001",
        )

    def test_runtime_error_projection_returns_fail_closed_response(self) -> None:
        response = runtime_error_response(
            _request(),
            "runtime_unavailable",
            "OpenAI Agents native runtime is unavailable",
            bridge_reason="runner_unavailable",
            latency_ms=0,
            runtime_posture="typed_activity_admitted",
        )

        self.assertEqual(response.status, "error")
        assert response.error is not None
        self.assertEqual(response.error.code, "agents_sdk_runtime_failed")
        assert response.capability_observability is not None
        self.assertEqual(
            response.capability_observability.safe_details["openai_agents_runtime_error"][
                "bridge_reason"
            ],
            "runner_unavailable",
        )

    def test_projection_rejects_multiple_tool_calls(self) -> None:
        request = _request()
        descriptors = build_agents_sdk_tool_descriptors(request.allowed_tools)

        with self.assertRaisesRegex(
            OpenAIAgentsRuntimeProjectionError,
            "multiple tool calls",
        ):
            response_from_native_runtime_result(
                request,
                OpenAIAgentsRunResult(
                    final_output="x",
                    tool_calls=(
                        OpenAIAgentsToolCall(
                            name="campus_notice_discover",
                            arguments={"query_text": "春假通知"},
                            call_id="call-1",
                        ),
                        OpenAIAgentsToolCall(
                            name="campus_notice_discover",
                            arguments={"query_text": "春假通知"},
                            call_id="call-2",
                        ),
                    ),
                ),
                descriptors=descriptors,
            )

    def test_projection_uses_tool_result_output_projection_ref(self) -> None:
        from campus_contracts import TransportScheduleLookupPayload

        request = CapabilityRequest(
            capability="campus_services",
            user_goal="校车什么时候发车",
            request_id="req-native-projection-transport-001",
            payload=TransportScheduleLookupPayload(
                query_text="校车什么时候发车",
                intent="next_departure",
            ),
            allowed_tools=("service_status_lookup", "transport_schedule_lookup"),
            workflow_context=WorkflowCapabilityContext(
                capability="campus_services",
                workflow_run_ref="workflow:req-native-projection-transport-001",
                step_id="handoff:campus_services:transport_schedule_lookup",
                capability_id="campus_services",
                expected_output_artifacts=("schedule_baseline",),
            ),
        )
        descriptors = build_agents_sdk_tool_descriptors(request.allowed_tools)

        response = response_from_native_runtime_result(
            request,
            OpenAIAgentsRunResult(
                final_output="已找到班车信息。",
                tool_calls=(
                    OpenAIAgentsToolCall(
                        name="transport_schedule_lookup",
                        arguments={
                            "query_text": "校车什么时候发车",
                            "intent": "next_departure",
                        },
                        call_id="call-transport-001",
                    ),
                ),
                model_response_ref="resp-transport-001",
            ),
            descriptors=descriptors,
            tool_execution_records=(
                OpenAIAgentsToolExecutionRecord(
                    name="transport_schedule_lookup",
                    call_id="call-transport-001",
                    arguments={
                        "query_text": "校车什么时候发车",
                        "intent": "next_departure",
                    },
                    argument_keys=("intent", "query_text"),
                    result_projection={
                        "status": "completed",
                        "outcome": "resolved_current",
                        "query_text": "校车什么时候发车",
                        "output_projection_ref": {
                            "projection_id": "projection:schedule_baseline:tool-owned",
                            "source_step_id": (
                                "handoff:campus_services:transport_schedule_lookup"
                            ),
                            "projection_kind": "schedule_baseline",
                            "content_hash": "sha256:tool-owned",
                            "safety": {
                                "truncated": False,
                                "redacted": False,
                                "max_chars": 1600,
                                "fields_present": ["route_id"],
                            },
                        },
                        "source_ref_count": 1,
                    },
                ),
            ),
            require_tool_execution=True,
        )

        assert response.capability_observability is not None
        output_projection_ref = response.capability_observability.safe_details[
            "agents_sdk_trace_projection"
        ]["output_projection_ref"]
        self.assertEqual(
            output_projection_ref["projection_id"],
            "projection:schedule_baseline:tool-owned",
        )

    def test_bounded_projection_strips_raw_provider_fragments(self) -> None:
        projection = bounded_tool_result_projection(
            {
                "outcome": "resolved_current",
                "raw_model_output": "secret",
                "trace_url": "https://platform.openai.com/traces/secret",
                "safe_nested": {"query_text": "春假通知"},
            }
        )

        self.assertEqual(projection["outcome"], "resolved_current")
        self.assertNotIn("raw_model_output", projection)
        self.assertNotIn("trace_url", projection)
        self.assertEqual(projection["safe_nested"]["query_text"], "春假通知")


def _request() -> CapabilityRequest:
    return CapabilityRequest(
        capability="notice",
        user_goal="找春假通知",
        request_id="req-native-projection-001",
        payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
        allowed_tools=("campus_notice_discover",),
        workflow_context=WorkflowCapabilityContext(
            capability="notice",
            workflow_run_ref="workflow:req-native-projection-001",
            step_id="handoff:notice:campus_notice_discover",
            capability_id="notice",
        ),
    )


if __name__ == "__main__":
    unittest.main()
