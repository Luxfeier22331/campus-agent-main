from __future__ import annotations

import unittest
from dataclasses import replace
from pathlib import Path

from campus_contracts import (
    AgentRequest,
    CampusNoticeChangeSetLookupPayload,
    CampusNoticeDiscoverPayload,
    ContactDirectoryLookupPayload,
    ServiceGuideLookupPayload,
    ServiceStatusLookupPayload,
    TransportScheduleLookupPayload,
    WorkflowAgentContext,
)
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


class AgentsSdkRunnerShellTest(unittest.TestCase):
    def test_runner_shell_passes_bounded_request_and_returns_agent_response(self) -> None:
        captured_request: AgentsSdkRunRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal captured_request
            captured_request = run_request
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

        request = _notice_discover_request()
        response = run_agents_sdk_runner_shell(
            request,
            runner=fake_runner,
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertIs(captured_request.agent_request, request)
        self.assertEqual(captured_request.target, "notice-agent")
        self.assertEqual(captured_request.allowed_tools, ("campus_notice_discover",))
        self.assertEqual(captured_request.user_goal, "找春假通知")
        self.assertEqual(captured_request.instruction_profile_id, "notice_discover_card_search")
        self.assertIn("notice cards", captured_request.instructions)
        self.assertEqual(
            [tool.name for tool in captured_request.tool_descriptors],
            ["campus_notice_discover"],
        )
        self.assertEqual(response.target, "notice-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "已找到相关通知。")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "campus_notice_discover")
        self.assertEqual(response.agent_observability.tool_outcome, "sdk_completed")
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["schema_version"], "agents-sdk-runner-projection-v1")
        self.assertEqual(projection["model_tool_call_ref"], "call-sdk-001")
        self.assertEqual(projection["model_response_ref"], "resp-sdk-001")
        self.assertEqual(projection["argument_keys"], ["query_text"])
        self.assertEqual(projection["instruction_profile_id"], "notice_discover_card_search")

    def test_runner_shell_assigns_service_guide_instruction_profile(self) -> None:
        captured_request: AgentsSdkRunRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal captured_request
            captured_request = run_request
            return AgentsSdkRunResult(
                final_output="校园卡补办：学生可在自助补卡机补卡。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="service_guide_lookup",
                        arguments={
                            "service_query": "校园卡丢了怎么办",
                            "guide_focus": "full_guide",
                        },
                        call_id="call-service-guide-001",
                    ),
                ),
                model_response_ref="resp-service-guide-001",
            )

        response = run_agents_sdk_runner_shell(
            _service_guide_request(),
            runner=fake_runner,
            enabled=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertEqual(captured_request.target, "campus-services-agent")
        self.assertEqual(
            captured_request.instruction_profile_id,
            "service_guide_source_backed_guidance",
        )
        self.assertIn("service guide", captured_request.instructions)
        self.assertIn("entry_refs.url", captured_request.instructions)
        self.assertIn("source_refs as provenance", captured_request.instructions)
        self.assertEqual(captured_request.result_usage_mode, "source_backed_guidance")
        self.assertEqual(
            captured_request.surface_execution_mode,
            "sdk_mediated_answer_shaping",
        )
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(
            projection["instruction_profile_id"],
            "service_guide_source_backed_guidance",
        )
        self.assertEqual(projection["result_usage_mode"], "source_backed_guidance")
        self.assertEqual(
            projection["surface_execution_mode"],
            "sdk_mediated_answer_shaping",
        )

    def test_runner_shell_assigns_service_status_instruction_profile(self) -> None:
        captured_request: AgentsSdkRunRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal captured_request
            captured_request = run_request
            return AgentsSdkRunResult(
                final_output="海淀校区图书馆当前正常开放。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="service_status_lookup",
                        arguments={"subject_query": "海淀校区图书馆"},
                        call_id="call-service-status-001",
                    ),
                ),
                model_response_ref="resp-service-status-001",
            )

        response = run_agents_sdk_runner_shell(
            AgentRequest(
                target="campus-services-agent",
                user_goal="图书馆今天开门吗",
                request_id="req-sdk-service-status-001",
                payload=ServiceStatusLookupPayload(subject_query="海淀校区图书馆"),
                allowed_tools=("service_status_lookup",),
            ),
            runner=fake_runner,
            enabled=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertEqual(captured_request.instruction_profile_id, "service_status_fact_lookup")
        self.assertEqual(captured_request.result_usage_mode, "service_status_fact")
        self.assertEqual(
            captured_request.surface_execution_mode,
            "deterministic_lookup_sdk_finalization",
        )
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["instruction_profile_id"], "service_status_fact_lookup")
        self.assertEqual(projection["result_usage_mode"], "service_status_fact")
        trace = response.agent_observability.safe_details["agents_sdk_trace_projection"]
        self.assertEqual(trace["instruction_profile_id"], "service_status_fact_lookup")
        self.assertEqual(trace["result_usage_mode"], "service_status_fact")
        self.assertEqual(
            trace["surface_execution_mode"],
            "deterministic_lookup_sdk_finalization",
        )

    def test_runner_shell_assigns_transport_schedule_instruction_profile(self) -> None:
        captured_request: AgentsSdkRunRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal captured_request
            captured_request = run_request
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
            AgentRequest(
                target="campus-services-agent",
                user_goal="今天两校区班车几点发",
                request_id="req-sdk-transport-001",
                payload=TransportScheduleLookupPayload(
                    query_text="今天两校区班车几点发",
                    intent="next_departure",
                ),
                allowed_tools=("transport_schedule_lookup",),
            ),
            runner=fake_runner,
            enabled=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertEqual(
            captured_request.instruction_profile_id,
            "transport_schedule_temporal_lookup",
        )
        self.assertEqual(captured_request.result_usage_mode, "transport_schedule_fact")
        self.assertEqual(
            captured_request.surface_execution_mode,
            "deterministic_lookup_sdk_finalization",
        )

    def test_runner_shell_assigns_contact_directory_instruction_profile(self) -> None:
        captured_request: AgentsSdkRunRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal captured_request
            captured_request = run_request
            return AgentsSdkRunResult(
                final_output="校园卡管理中心电话是 010-68933381。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="contact_directory_lookup",
                        arguments={"query_text": "校园卡电话", "contact_focus": "phone"},
                        call_id="call-contact-001",
                    ),
                ),
                model_response_ref="resp-contact-001",
            )

        response = run_agents_sdk_runner_shell(
            AgentRequest(
                target="campus-services-agent",
                user_goal="校园卡管理中心电话",
                request_id="req-sdk-contact-001",
                payload=ContactDirectoryLookupPayload(
                    query_text="校园卡电话",
                    contact_focus="phone",
                ),
                allowed_tools=("contact_directory_lookup",),
            ),
            runner=fake_runner,
            enabled=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertEqual(
            captured_request.instruction_profile_id,
            "contact_directory_fact_lookup",
        )
        self.assertEqual(captured_request.result_usage_mode, "contact_directory_fact")
        self.assertEqual(
            captured_request.surface_execution_mode,
            "deterministic_lookup_sdk_finalization",
        )

    def test_runner_shell_passes_validated_tool_executor_to_runner(self) -> None:
        captured_execution: AgentsSdkToolExecutionRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_discover",
                    arguments={"query_text": "春假通知"},
                    call_id="call-execute-001",
                )
            )
            self.assertEqual(tool_result["outcome"], "resolved_current")
            return AgentsSdkRunResult(
                final_output="已根据通知卡片回答。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假通知"},
                        call_id="call-execute-001",
                    ),
                ),
                model_response_ref="resp-execute-001",
            )

        def execute_tool(execution: AgentsSdkToolExecutionRequest) -> dict[str, object]:
            nonlocal captured_execution
            captured_execution = execution
            return {
                "status": "completed",
                "outcome": "resolved_current",
                "title": "2026 年春假安排通知",
                "source_ref_count": 1,
            }

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=execute_tool,
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_execution)
        assert captured_execution is not None
        self.assertEqual(captured_execution.name, "campus_notice_discover")
        self.assertEqual(captured_execution.call_id, "call-execute-001")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["tool_execution_count"], 1)
        self.assertEqual(
            projection["tool_result_projection"]["outcome"],
            "resolved_current",
        )
        self.assertEqual(response.agent_observability.source_ref_count, 1)

    def test_runner_shell_returns_service_guide_tool_result_for_downstream_structured_consumption(
        self,
    ) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="service_guide_lookup",
                    arguments={
                        "service_query": "校园卡丢了怎么办",
                        "guide_focus": "full_guide",
                    },
                    call_id="call-service-guide-exec",
                )
            )
            self.assertEqual(tool_result, _service_guide_tool_result())
            return AgentsSdkRunResult(
                final_output="校园卡补办：学生可在自助补卡机补卡。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="service_guide_lookup",
                        arguments={
                            "service_query": "校园卡丢了怎么办",
                            "guide_focus": "full_guide",
                        },
                        call_id="call-service-guide-exec",
                    ),
                ),
                model_response_ref="resp-service-guide-exec",
            )

        response = run_agents_sdk_runner_shell(
            _service_guide_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: _service_guide_tool_result(),
            require_tool_execution=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsInstance(response.result, dict)
        assert isinstance(response.result, dict)
        self.assertEqual(response.result["payload_kind"], "service_guide_lookup")
        self.assertEqual(response.result["tool_result"], _service_guide_tool_result())

    def test_runner_shell_returns_contact_directory_tool_result_for_downstream_structured_consumption(
        self,
    ) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="contact_directory_lookup",
                    arguments={
                        "query_text": "校园卡电话",
                        "contact_focus": "phone",
                    },
                    call_id="call-contact-exec",
                )
            )
            self.assertEqual(tool_result, _contact_directory_tool_result())
            return AgentsSdkRunResult(
                final_output="校园卡管理中心电话是 010-68933381。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="contact_directory_lookup",
                        arguments={
                            "query_text": "校园卡电话",
                            "contact_focus": "phone",
                        },
                        call_id="call-contact-exec",
                    ),
                ),
                model_response_ref="resp-contact-exec",
            )

        response = run_agents_sdk_runner_shell(
            AgentRequest(
                target="campus-services-agent",
                user_goal="校园卡管理中心电话",
                request_id="req-sdk-contact-structured-001",
                payload=ContactDirectoryLookupPayload(
                    query_text="校园卡电话",
                    contact_focus="phone",
                ),
                allowed_tools=("contact_directory_lookup",),
            ),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: _contact_directory_tool_result(),
            require_tool_execution=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsInstance(response.result, dict)
        assert isinstance(response.result, dict)
        self.assertEqual(response.result["payload_kind"], "contact_directory_lookup")
        self.assertEqual(response.result["tool_result"], _contact_directory_tool_result())

    def test_runner_shell_fails_closed_when_required_tool_execution_is_missing(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="模型声称已找到。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假通知"},
                        call_id="call-not-executed",
                    ),
                ),
            ),
            enabled=True,
            execute_tool=lambda _execution: {"outcome": "resolved_current"},
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_tool_not_executed")

    def test_runner_shell_fails_closed_when_expected_output_artifact_is_missing(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="transport_schedule_lookup",
                    arguments={
                        "query_text": "今天两校区班车几点发",
                        "intent": "next_departure",
                    },
                    call_id="call-missing-artifact",
                )
            )
            return AgentsSdkRunResult(
                final_output="已找到通知。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="transport_schedule_lookup",
                        arguments={
                            "query_text": "今天两校区班车几点发",
                            "intent": "next_departure",
                        },
                        call_id="call-missing-artifact",
                    ),
                ),
            )

        response = run_agents_sdk_runner_shell(
            _transport_request_with_expected_artifacts(("schedule_baseline",)),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: {"outcome": "resolved_current", "source_ref_count": 1},
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_artifact_incomplete")

    def test_runner_shell_promotes_transport_tool_result_fields_for_supervisor_contract(
        self,
    ) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="transport_schedule_lookup",
                    arguments={
                        "query_text": "今天两校区班车几点发",
                        "intent": "next_departure",
                    },
                    call_id="call-transport-shape",
                )
            )
            return AgentsSdkRunResult(
                final_output="已找到班车班次。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="transport_schedule_lookup",
                        arguments={
                            "query_text": "今天两校区班车几点发",
                            "intent": "next_departure",
                        },
                        call_id="call-transport-shape",
                    ),
                ),
            )

        tool_result = {
            "outcome": "resolved_current",
            "query_text": "今天两校区班车几点发",
            "service_status": "running",
            "requested_service_date": "2026-03-18",
            "queried_time_anchor": "2026-03-18T08:00:00+08:00",
            "source_ref_count": 1,
            "source_refs": ["notice:355122"],
            "related_notice_refs": ["notice:355122"],
            "resolved_route": {
                "route_id": "route:intercampus:student",
                "display_name": "两校区通勤班车",
                "service_family": "intercampus_commute",
            },
            "selected_departure": {
                "departure_at": "2026-03-18T08:00:00+08:00",
            },
        }

        response = run_agents_sdk_runner_shell(
            _transport_request_with_expected_artifacts(("schedule_baseline",)),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: tool_result,
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "completed")
        assert isinstance(response.result, dict)
        self.assertEqual(response.result["payload_kind"], "transport_schedule_lookup")
        self.assertEqual(response.result["tool_result"], tool_result)
        self.assertEqual(response.result["resolved_route"], tool_result["resolved_route"])
        self.assertEqual(
            response.result["selected_departure"],
            tool_result["selected_departure"],
        )
        self.assertEqual(response.result["query_text"], tool_result["query_text"])
        self.assertEqual(response.result["service_status"], tool_result["service_status"])
        self.assertEqual(
            response.result["requested_service_date"],
            tool_result["requested_service_date"],
        )
        self.assertEqual(
            response.result["related_notice_refs"],
            tool_result["related_notice_refs"],
        )

    def test_runner_shell_fails_closed_when_executed_arguments_drift_from_final_tool_call(
        self,
    ) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_discover",
                    arguments={"query_text": "春假通知"},
                    call_id="call-drift",
                )
            )
            return AgentsSdkRunResult(
                final_output="已找到。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "暑假通知"},
                        call_id="call-drift",
                    ),
                ),
            )

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: {"outcome": "resolved_current"},
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_tool_execution_mismatch")

    def test_runner_shell_fails_closed_when_tool_executor_raises(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_discover",
                    arguments={"query_text": "春假通知"},
                    call_id="call-execute-failed",
                )
            )
            raise AssertionError("executor failure should abort the runner")

        def execute_tool(_execution: AgentsSdkToolExecutionRequest) -> dict[str, object]:
            raise RuntimeError("query service unavailable")

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=execute_tool,
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertTrue(response.error.retryable if response.error else False)
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_tool_execution_failed")

    def test_runner_shell_requires_explicit_gate(self) -> None:
        runner_called = False

        def fake_runner(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal runner_called
            runner_called = True
            return AgentsSdkRunResult(final_output="x")

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=fake_runner,
            enabled=False,
        )

        self.assertFalse(runner_called)
        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code if response.error else "", "agents_sdk_runtime_failed")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "runtime_disabled")

    def test_runner_shell_fails_closed_when_tool_bridge_rejects_request(self) -> None:
        response = run_agents_sdk_runner_shell(
            AgentRequest(
                target="campus-services-agent",
                user_goal="校车是否停运",
                payload=ServiceStatusLookupPayload(subject_query="校车"),
                allowed_tools=("service_status_lookup",),
            ),
            runner=lambda _run_request: AgentsSdkRunResult(final_output="x"),
            enabled=True,
            tool_registry=_typed_handoff_only_tool_registry("service_status_lookup"),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_tool_not_admitted")
        self.assertEqual(
            response.agent_observability.safe_details["agents_sdk_runner_error"]["bridge_reason"],
            "runtime_posture_not_admitted",
        )

    def test_runner_shell_rejects_result_without_tool_call(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="不需要工具", tool_calls=()
            ),
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_no_tool_call")

    def test_runner_shell_rejects_wrong_tool_call(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="x",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="service_status_lookup",
                        arguments={"subject_query": "校车"},
                        call_id="call-wrong",
                    ),
                ),
            ),
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_wrong_tool")

    def test_runner_shell_rejects_invalid_tool_arguments(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="x",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": ""},
                        call_id="call-bad-args",
                    ),
                ),
            ),
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_bad_arguments")

    def test_runner_shell_normalizes_nullable_optional_tool_arguments_before_execution(
        self,
    ) -> None:
        captured_execution: AgentsSdkToolExecutionRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_discover",
                    arguments={
                        "query_text": "烟雾测试通知",
                        "temporal_query": None,
                        "source_families": None,
                        "target_surfaces": None,
                        "max_results": None,
                    },
                    call_id="call-null-optionals",
                )
            )
            return AgentsSdkRunResult(
                final_output="已找到烟雾测试通知：https://example.invalid/notices/smoke",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={
                            "query_text": "烟雾测试通知",
                            "temporal_query": None,
                            "source_families": None,
                            "target_surfaces": None,
                            "max_results": None,
                        },
                        call_id="call-null-optionals",
                    ),
                ),
            )

        def execute_tool(execution: AgentsSdkToolExecutionRequest) -> dict[str, object]:
            nonlocal captured_execution
            captured_execution = execution
            return {
                "outcome": "resolved_current",
                "notice_card_count": 1,
                "titles": ["烟雾测试通知"],
                "source_urls": ["https://example.invalid/notices/smoke"],
                "source_ref_count": 1,
            }

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=execute_tool,
            require_tool_execution=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_execution)
        assert captured_execution is not None
        self.assertEqual(captured_execution.arguments, {"query_text": "烟雾测试通知"})
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["argument_keys"], ["query_text"])
        self.assertEqual(projection["tool_execution_count"], 1)

    def test_runner_shell_rejects_malformed_final_output(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假通知"},
                        call_id="call-empty-output",
                    ),
                ),
            ),
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_malformed_final_output")

    def test_runner_shell_maps_timeout_to_retryable_fail_close(self) -> None:
        def timed_out(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            raise AgentsSdkRunnerTimeoutError("SDK run timed out")

        response = run_agents_sdk_runner_shell(
            _notice_discover_request(),
            runner=timed_out,
            enabled=True,
            tool_registry=_sdk_test_tool_registry(),
        )

        self.assertEqual(response.status, "error")
        self.assertTrue(response.error.retryable if response.error else False)
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_timeout")

    def test_runner_shell_source_does_not_execute_sdk_or_leak_raw_surfaces(self) -> None:
        source = Path(
            "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py"
        ).read_text(encoding="utf-8")

        forbidden_fragments = (
            "Runner.run",
            "from agents import",
            "import agents",
            "raw_response",
            "hosted_mcp",
            "web_search",
            "file_search",
            "computer_use",
            "object_store",
            "collector",
            "ingestion",
            "index_build",
            "raw_sql",
        )
        for fragment in forbidden_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, source)

    def test_runner_shell_projects_notice_change_set_expected_artifact(self) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertEqual(
                run_request.instruction_profile_id,
                "notice_change_set_transport_override",
            )
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_change_set_lookup",
                    arguments={
                        "query_text": "今天丰台到海淀通勤车乘车点有没有调整",
                        "route_labels": ["丰台到海淀通勤车"],
                        "service_date": "2026-05-07",
                    },
                    call_id="call-change-set-001",
                )
            )
            return AgentsSdkRunResult(
                final_output="已找到当前有效的班车通知变更。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_change_set_lookup",
                        arguments={
                            "query_text": "今天丰台到海淀通勤车乘车点有没有调整",
                            "route_labels": ["丰台到海淀通勤车"],
                            "service_date": "2026-05-07",
                        },
                        call_id="call-change-set-001",
                    ),
                ),
                model_response_ref="resp-change-set-001",
            )

        def execute_tool(_request: AgentsSdkToolExecutionRequest) -> dict[str, object]:
            return {
                "query_text": "今天丰台到海淀通勤车乘车点有没有调整",
                "outcome": "resolved_current",
                "change_set": {
                    "schema_version": "notice-change-set-v1",
                    "change_set_id": "notice-change-set:353903:2026-05-07",
                    "target_family": "transport_schedule",
                    "query_scope": {
                        "service_kind": "transport_schedule",
                        "route_labels": ["丰台到海淀通勤车"],
                        "service_date": "2026-05-07",
                    },
                    "effective_window": {
                        "starts_at": "2026-05-07T00:00:00+08:00",
                        "timezone": "Asia/Shanghai",
                        "current_at_query_time": True,
                    },
                    "change_kind": "stop_or_boarding_point_change",
                    "answer_eligible": True,
                    "admission_state": "answer_eligible",
                    "content_hash": "sha256:test",
                    "facts": [
                        {
                            "fact_id": "fact:353903",
                            "fact_kind": "stop_changed",
                            "change_text": "丰台校区乘车点调整至南门外停车区。",
                            "source_notice_id": "353903",
                            "source_ref_id": "notice-ref:353903",
                            "confidence": "deterministic",
                        }
                    ],
                    "source_refs": [
                        {
                            "source_ref_id": "notice-ref:353903",
                            "notice_id": "353903",
                            "title": "关于通勤班车丰台校区乘车点调整的通知",
                            "source_url": "https://portal.example.edu/notices/353903",
                            "published_at": "2026-05-07T08:00:00+08:00",
                        }
                    ],
                    "conflicts": [],
                    "safety_summary": {
                        "raw_payload_absent": True,
                        "payload_key_names": [
                            "schema_version",
                            "query_scope",
                            "effective_window",
                            "facts",
                            "source_refs",
                        ],
                        "redacted": False,
                        "notes": ["bounded_transport_notice_override"],
                    },
                },
                "source_ref_count": 1,
            }

        response = run_agents_sdk_runner_shell(
            AgentRequest(
                target="notice-agent",
                user_goal="今天丰台到海淀通勤车乘车点有没有调整",
                request_id="req-sdk-change-set-001",
                payload=CampusNoticeChangeSetLookupPayload(
                    query_text="今天丰台到海淀通勤车乘车点有没有调整",
                    route_labels=("丰台到海淀通勤车",),
                    service_date="2026-05-07",
                ),
                allowed_tools=("campus_notice_change_set_lookup",),
                workflow_context=WorkflowAgentContext(
                    target="notice-agent",
                    workflow_run_ref="workflow:req-sdk-change-set-001",
                    step_id="handoff:notice-agent:campus_notice_change_set_lookup",
                    agent_id="notice-agent",
                    expected_output_artifacts=("notice_change_set",),
                ),
            ),
            runner=fake_runner,
            enabled=True,
            execute_tool=execute_tool,
            require_tool_execution=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.result)
        assert response.result is not None
        self.assertIn("change_set", response.result)
        self.assertEqual(
            response.result["change_set"]["change_set_id"],
            "notice-change-set:353903:2026-05-07",
        )
        self.assertEqual(
            response.result["change_set"]["facts"][0]["change_text"],
            "丰台校区乘车点调整至南门外停车区。",
        )
        projection = response.agent_observability.safe_details["agents_sdk_trace_projection"][
            "output_projection_ref"
        ]
        self.assertEqual(projection["projection_kind"], "notice_change_set")


def _notice_discover_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="找春假通知",
        request_id="req-sdk-001",
        payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
        allowed_tools=("campus_notice_discover",),
    )


def _notice_discover_request_with_expected_artifacts(
    expected_output_artifacts: tuple[str, ...],
) -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="找春假通知",
        request_id="req-sdk-001",
        payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
        allowed_tools=("campus_notice_discover",),
        workflow_context=WorkflowAgentContext(
            target="notice-agent",
            workflow_run_ref="workflow:req-sdk-001",
            step_id="handoff:notice-agent:campus_notice_discover",
            agent_id="notice-agent",
            expected_output_artifacts=expected_output_artifacts,
        ),
    )


def _transport_request_with_expected_artifacts(
    expected_output_artifacts: tuple[str, ...],
) -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="今天两校区班车几点发",
        request_id="req-sdk-transport-expected-001",
        payload=TransportScheduleLookupPayload(
            query_text="今天两校区班车几点发",
            intent="next_departure",
        ),
        allowed_tools=("transport_schedule_lookup",),
        workflow_context=WorkflowAgentContext(
            target="campus-services-agent",
            workflow_run_ref="workflow:req-sdk-transport-expected-001",
            step_id="handoff:campus-services-agent:transport_schedule_lookup",
            agent_id="campus-services-agent",
            expected_output_artifacts=expected_output_artifacts,
        ),
    )


def _service_guide_request() -> AgentRequest:
    return AgentRequest(
        target="campus-services-agent",
        user_goal="校园卡丢了怎么办",
        request_id="req-sdk-service-guide-001",
        payload=ServiceGuideLookupPayload(
            service_query="校园卡丢了怎么办",
            guide_focus="full_guide",
        ),
        allowed_tools=("service_guide_lookup",),
    )


def _service_guide_tool_result() -> dict[str, object]:
    return {
        "outcome": "resolved_current",
        "service_query": "校园卡丢了怎么办",
        "source_ref_count": 1,
        "resolved_service": {
            "display_name": "校园卡挂失与补卡",
        },
        "guide_sections": [
            {
                "title": "挂失与补卡流程",
                "content": "先办理挂失，再在自助补卡机补卡。",
                "source_refs": ["official_web:campus-card"],
            }
        ],
        "required_materials": [
            {
                "name": "本人有效证件",
                "required": True,
                "source_refs": ["official_web:campus-card"],
            }
        ],
        "entry_refs": [
            {
                "label": "学生自助补卡机",
                "location_ref": "中慧楼二层",
                "source_refs": ["official_web:campus-card"],
            }
        ],
        "office_hours": [
            {
                "label": "卡务中心",
                "day_pattern": "工作日",
                "time_range": "09:00-17:00",
                "source_refs": ["official_web:campus-card"],
            }
        ],
        "contact_refs": [
            {
                "label": "海淀校区校园卡管理中心",
                "phone": "010-68933381",
                "source_refs": ["official_web:campus-card"],
            }
        ],
        "eligibility_notes": ["学生和教职工均可办理。"],
        "source_refs": ["official_web:campus-card"],
    }


def _contact_directory_tool_result() -> dict[str, object]:
    return {
        "outcome": "resolved_current",
        "query_text": "校园卡电话",
        "contact_focus": "phone",
        "source_ref_count": 1,
        "resolved_contact": {
            "display_name": "校园卡管理中心",
        },
        "contact_points": [
            {
                "label": "咨询电话",
                "value": "010-68933381",
                "source_refs": ["official_web:campus-card"],
            }
        ],
        "source_refs": ["official_web:campus-card"],
    }


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


def _typed_handoff_only_tool_registry(tool_name: str) -> ToolSpecRegistry:
    registry = default_tool_spec_registry()
    return replace(
        registry,
        tools=tuple(
            replace(tool, runtime_posture="typed_handoff_only") if tool.name == tool_name else tool
            for tool in registry.tools
        ),
    )


if __name__ == "__main__":
    unittest.main()
