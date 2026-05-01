from __future__ import annotations

import json
import unittest

from campus_contracts import (
    AgentRequest,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
)
from campus_evals.agents_sdk_pilot_parity import (
    AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH,
    AgentsSdkPilotParityObservation,
    agent_response_to_agents_sdk_pilot_observation,
    evaluate_agents_sdk_pilot_parity_cases,
    load_agents_sdk_notice_get_parity_cases,
)
from campus_notice_agent.query_service import NoticeGetQuery
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
from campus_supervisor_agent_worker.provider_tool_runtime import (
    run_notice_get_provider_tool_adapter,
)


class _FakeNoticeGetQueryService:
    def __init__(self, *, fail_get: bool = False) -> None:
        self.fail_get = fail_get
        self.last_get_query: NoticeGetQuery | None = None

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

    def discover_notice(self, _query: object) -> object:
        raise AssertionError("notice_get parity harness must not call discover")


class AgentsSdkPilotParityHarnessTest(unittest.TestCase):
    def test_fixture_covers_phase6_denominator_cases_without_raw_payloads(self) -> None:
        fixture = load_agents_sdk_notice_get_parity_cases()

        self.assertTrue(AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH.exists())
        self.assertEqual(fixture.schema_version, 1)
        self.assertEqual(fixture.case_family, "agents_sdk_notice_get_parity.v1")
        self.assertEqual(
            {case.case_id for case in fixture.cases},
            {
                "notice_get_should_call_minimal_args",
                "notice_get_should_call_with_source_family",
                "notice_get_wrong_tool_fail_close",
                "notice_get_no_tool_call_fail_close",
                "notice_get_bad_arguments_fail_close",
                "notice_get_query_service_failure_retryable",
                "notice_get_final_answer_uses_tool_result",
                "notice_get_executed_reported_argument_drift_fail_close",
            },
        )
        serialized = json.dumps(
            json.loads(AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH.read_text(encoding="utf-8")),
            ensure_ascii=False,
            sort_keys=True,
        )
        for forbidden in (
            "raw_response",
            "raw_model_output",
            "sdk_run_state",
            "trace_url",
            "provider_response",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, serialized)

    def test_observation_extraction_uses_sanitized_safe_details(self) -> None:
        case = next(
            case
            for case in load_agents_sdk_notice_get_parity_cases().cases
            if case.case_id == "notice_get_should_call_with_source_family"
        )

        sdk_observation = agent_response_to_agents_sdk_pilot_observation(
            "sdk",
            _run_sdk_case(case),
        )
        provider_observation = agent_response_to_agents_sdk_pilot_observation(
            "provider",
            _run_provider_case(case),
        )

        self.assertEqual(sdk_observation.lane, "sdk")
        self.assertEqual(provider_observation.lane, "provider")
        self.assertEqual(sdk_observation.status, "completed")
        self.assertEqual(provider_observation.status, "completed")
        self.assertEqual(sdk_observation.selected_tool, "campus_notice_get")
        self.assertEqual(provider_observation.selected_tool, "campus_notice_get")
        self.assertEqual(sdk_observation.argument_keys, ("notice_id", "source_family"))
        self.assertEqual(provider_observation.argument_keys, ("notice_id", "source_family"))
        self.assertEqual(sdk_observation.tool_execution_count, 1)
        self.assertEqual(provider_observation.tool_execution_count, 1)
        self.assertTrue(sdk_observation.final_answer_present)
        self.assertTrue(provider_observation.final_answer_present)

    def test_parity_report_passes_shared_success_and_fail_close_denominator(self) -> None:
        fixture = load_agents_sdk_notice_get_parity_cases()
        sdk_observations = {}
        provider_observations = {}
        for case in fixture.cases:
            sdk_observations[case.case_id] = agent_response_to_agents_sdk_pilot_observation(
                "sdk",
                _run_sdk_case(case),
            )
            provider_observations[case.case_id] = agent_response_to_agents_sdk_pilot_observation(
                "provider",
                _run_provider_case(case),
            )

        report = evaluate_agents_sdk_pilot_parity_cases(
            fixture,
            sdk_observations=sdk_observations,
            provider_observations=provider_observations,
        )

        self.assertTrue(report.passed)
        self.assertEqual(report.total, 8)
        self.assertEqual(report.failed_count, 0)
        results = {result.case_id: result for result in report.results}
        self.assertEqual(
            results["notice_get_wrong_tool_fail_close"].sdk_observation.failure_kind,
            "wrong_tool",
        )
        self.assertEqual(
            results["notice_get_no_tool_call_fail_close"].sdk_observation.failure_kind,
            "no_tool_call",
        )
        self.assertEqual(
            results["notice_get_bad_arguments_fail_close"].sdk_observation.failure_kind,
            "bad_arguments",
        )
        self.assertEqual(
            results["notice_get_query_service_failure_retryable"].sdk_observation.failure_kind,
            "tool_execution_failed",
        )
        self.assertEqual(
            results[
                "notice_get_executed_reported_argument_drift_fail_close"
            ].sdk_observation.failure_kind,
            "argument_drift",
        )

    def test_parity_report_detects_observation_drift(self) -> None:
        fixture = load_agents_sdk_notice_get_parity_cases()
        case = fixture.cases[0]
        sdk_observation = AgentsSdkPilotParityObservation(
            lane="sdk",
            status="completed",
            selected_tool="campus_notice_get",
            tool_attempted=True,
            tool_outcome="sdk_completed",
            failure_class="",
            failure_kind="",
            argument_keys=("notice_id",),
            source_ref_count=0,
            result_outcome="sdk_completed",
            tool_execution_count=1,
            final_answer_present=True,
        )
        provider_observation = AgentsSdkPilotParityObservation(
            lane="provider",
            status="completed",
            selected_tool="campus_notice_discover",
            tool_attempted=True,
            tool_outcome="resolved_current",
            failure_class="",
            failure_kind="",
            argument_keys=("notice_id",),
            source_ref_count=2,
            result_outcome="resolved_current",
            tool_execution_count=1,
            final_answer_present=True,
        )

        report = evaluate_agents_sdk_pilot_parity_cases(
            fixture,
            sdk_observations={case.case_id: sdk_observation},
            provider_observations={case.case_id: provider_observation},
        )

        result = report.results[0]
        self.assertFalse(report.passed)
        self.assertFalse(result.passed)
        self.assertEqual(result.failure_class, "provider_observation_mismatch")


def _run_sdk_case(case):
    return run_notice_get_agents_sdk_pilot_adapter(
        _notice_get_request(case.user_goal),
        runner=_sdk_runner_for_case(case),
        query_service=_FakeNoticeGetQueryService(
            fail_get=case.sdk_scenario == "query_service_failure"
        ),
        enabled=True,
    )


def _run_provider_case(case):
    return run_notice_get_provider_tool_adapter(
        _notice_get_request(case.user_goal),
        provider=_provider_for_case(case),
        query_service=_FakeNoticeGetQueryService(
            fail_get=case.provider_scenario == "query_service_failure"
        ),
        enabled=True,
        finalize_with_provider=case.provider_scenario == "final_answer_uses_tool_result",
    )


def _sdk_runner_for_case(case):
    def runner(run_request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
        if case.sdk_scenario == "wrong_tool":
            return AgentsSdkRunResult(
                final_output="错误工具。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_discover",
                        arguments={"query_text": "春假"},
                        call_id="call-sdk-wrong",
                    ),
                ),
            )
        if case.sdk_scenario == "no_tool_call":
            return AgentsSdkRunResult(final_output="没有工具调用。", tool_calls=())
        arguments = _arguments_for_case(case)
        if case.sdk_scenario == "executed_reported_argument_drift":
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments=arguments,
                    call_id="call-sdk-drift",
                )
            )
            return AgentsSdkRunResult(
                final_output="已读取。",
                tool_calls=(
                    AgentsSdkToolCall(
                        name="campus_notice_get",
                        arguments={"notice_id": "notice:drift"},
                        call_id="call-sdk-drift",
                    ),
                ),
            )
        if case.sdk_scenario != "bad_arguments":
            assert run_request.execute_tool is not None
            run_request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name="campus_notice_get",
                    arguments=arguments,
                    call_id=f"call-sdk-{case.case_id}",
                )
            )
        return AgentsSdkRunResult(
            final_output="春假时间为 5 月 1 日至 5 月 5 日。",
            tool_calls=(
                AgentsSdkToolCall(
                    name="campus_notice_get",
                    arguments=arguments,
                    call_id=f"call-sdk-{case.case_id}",
                ),
            ),
            model_response_ref=f"resp-sdk-{case.case_id}",
        )

    return runner


def _provider_for_case(case):
    calls = 0

    def provider(_request: ProviderFunctionToolRequest) -> dict[str, object]:
        nonlocal calls
        calls += 1
        if case.provider_scenario == "wrong_tool":
            return _responses_function_call(
                name="campus_notice_discover",
                arguments={"query_text": "春假"},
                call_id="call-provider-wrong",
                response_id=f"resp-provider-{case.case_id}",
            )
        if case.provider_scenario == "no_tool_call":
            return _responses_message("没有工具调用。", response_id=f"resp-provider-{case.case_id}")
        if case.provider_scenario == "final_answer_uses_tool_result" and calls > 1:
            return _responses_message(
                "春假安排是 5 月 1 日至 5 月 5 日。",
                response_id=f"resp-provider-final-{case.case_id}",
            )
        return _responses_function_call(
            name="campus_notice_get",
            arguments=_arguments_for_case(case),
            call_id=f"call-provider-{case.case_id}",
            response_id=f"resp-provider-{case.case_id}",
        )

    return provider


def _arguments_for_case(case) -> dict[str, object]:
    arguments: dict[str, object] = {"notice_id": case.notice_id}
    if case.source_family:
        arguments["source_family"] = case.source_family
    return arguments


def _notice_get_request(user_goal: str) -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal=user_goal,
        request_id="req-sdk-parity",
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


def _responses_message(text: str, *, response_id: str) -> dict[str, object]:
    return {
        "id": response_id,
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
