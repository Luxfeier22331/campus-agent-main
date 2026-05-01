from __future__ import annotations

import unittest
from pathlib import Path

from campus_contracts import (
    AgentRequest,
    CampusNoticeGetPayload,
    ServiceStatusLookupPayload,
)
from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunnerTimeoutError,
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
    AgentsSdkToolCall,
    AgentsSdkToolExecutionRequest,
    run_agents_sdk_runner_shell,
)


class AgentsSdkRunnerShellTest(unittest.TestCase):
    def test_runner_shell_passes_bounded_request_and_returns_agent_response(self) -> None:
        captured_request: AgentsSdkRunRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            nonlocal captured_request
            captured_request = run_request
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

        request = _notice_get_request()
        response = run_agents_sdk_runner_shell(
            request,
            runner=fake_runner,
            enabled=True,
        )

        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertIs(captured_request.agent_request, request)
        self.assertEqual(captured_request.target, "notice-agent")
        self.assertEqual(captured_request.allowed_tools, ("campus_notice_get",))
        self.assertEqual(captured_request.user_goal, "读取这条通知")
        self.assertEqual(
            [tool.name for tool in captured_request.tool_descriptors], ["campus_notice_get"]
        )
        self.assertEqual(response.target, "notice-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "这条通知已读取。")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.selected_tool, "campus_notice_get")
        self.assertEqual(response.agent_observability.tool_outcome, "sdk_completed")
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["schema_version"], "agents-sdk-runner-projection-v1")
        self.assertEqual(projection["model_tool_call_ref"], "call-sdk-001")
        self.assertEqual(projection["model_response_ref"], "resp-sdk-001")
        self.assertEqual(projection["argument_keys"], ["notice_id"])

    def test_runner_shell_passes_validated_tool_executor_to_runner(self) -> None:
        captured_execution: AgentsSdkToolExecutionRequest | None = None

        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            tool_result = run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={
                        "notice_id": "notice:2026-spring",
                        "source_family": "official_web_public_notice",
                    },
                    call_id="call-execute-001",
                )
            )
            self.assertEqual(tool_result["outcome"], "resolved_current")
            return AgentsSdkRunResult(
                final_output="已根据通知正文回答。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={
                            "notice_id": "notice:2026-spring",
                            "source_family": "official_web_public_notice",
                        },
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
            _notice_get_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=execute_tool,
            require_tool_execution=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_execution)
        assert captured_execution is not None
        self.assertEqual(captured_execution.name, "campus_notice_get")
        self.assertEqual(captured_execution.call_id, "call-execute-001")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        projection = response.agent_observability.safe_details["agents_sdk_runner_projection"]
        self.assertEqual(projection["tool_execution_count"], 1)
        self.assertEqual(
            projection["tool_result_projection"]["outcome"],
            "resolved_current",
        )

    def test_runner_shell_fails_closed_when_required_tool_execution_is_missing(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="模型声称已读取。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:2026-spring"},
                        call_id="call-not-executed",
                    ),
                ),
            ),
            enabled=True,
            execute_tool=lambda _execution: {"outcome": "resolved_current"},
            require_tool_execution=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_tool_not_executed")

    def test_runner_shell_fails_closed_when_executed_arguments_drift_from_final_tool_call(
        self,
    ) -> None:
        def fake_runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            self.assertIsNotNone(run_request.execute_tool)
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:executed"},
                    call_id="call-drift",
                )
            )
            return AgentsSdkRunResult(
                final_output="已读取。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:reported"},
                        call_id="call-drift",
                    ),
                ),
            )

        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=lambda _execution: {"outcome": "resolved_current"},
            require_tool_execution=True,
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
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:2026-spring"},
                    call_id="call-execute-failed",
                )
            )
            raise AssertionError("executor failure should abort the runner")

        def execute_tool(_execution: AgentsSdkToolExecutionRequest) -> dict[str, object]:
            raise RuntimeError("query service unavailable")

        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=fake_runner,
            enabled=True,
            execute_tool=execute_tool,
            require_tool_execution=True,
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
            _notice_get_request(),
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
            _notice_get_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="不需要工具", tool_calls=()
            ),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_no_tool_call")

    def test_runner_shell_rejects_wrong_tool_call(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="x",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假"},
                        call_id="call-wrong",
                    ),
                ),
            ),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_wrong_tool")

    def test_runner_shell_rejects_invalid_tool_arguments(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="x",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": ""},
                        call_id="call-bad-args",
                    ),
                ),
            ),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_bad_arguments")

    def test_runner_shell_rejects_malformed_final_output(self) -> None:
        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=lambda _run_request: AgentsSdkRunResult(
                final_output="",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:2026-spring"},
                        call_id="call-empty-output",
                    ),
                ),
            ),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "sdk_malformed_final_output")

    def test_runner_shell_maps_timeout_to_retryable_fail_close(self) -> None:
        def timed_out(_run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
            raise AgentsSdkRunnerTimeoutError("SDK run timed out")

        response = run_agents_sdk_runner_shell(
            _notice_get_request(),
            runner=timed_out,
            enabled=True,
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


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="读取这条通知",
        request_id="req-sdk-001",
        payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
        allowed_tools=("campus_notice_get",),
    )


if __name__ == "__main__":
    unittest.main()
