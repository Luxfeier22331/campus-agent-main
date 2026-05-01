from __future__ import annotations

import json
import unittest

from campus_contracts import AgentObservability, AgentResponse, ErrorInfo
from campus_evals.agents_sdk_pilot_parity import (
    AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH,
    AgentsSdkPilotParityObservation,
    agent_response_to_agents_sdk_pilot_observation,
    evaluate_agents_sdk_pilot_parity_cases,
    load_agents_sdk_notice_get_parity_cases,
)


class AgentsSdkPilotParityHarnessTest(unittest.TestCase):
    def test_fixture_records_notice_get_pilot_as_retired_closed(self) -> None:
        fixture = load_agents_sdk_notice_get_parity_cases()

        self.assertTrue(AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH.exists())
        self.assertEqual(fixture.schema_version, 1)
        self.assertEqual(fixture.case_family, "agents_sdk_notice_get_parity.v1")
        self.assertEqual(
            {case.case_id for case in fixture.cases},
            {
                "notice_get_sdk_and_provider_closed",
                "notice_get_disabled_gate_closed",
            },
        )
        for case in fixture.cases:
            with self.subTest(case_id=case.case_id):
                self.assertEqual(case.expected_sdk.selected_tool, "")
                self.assertEqual(case.expected_provider.selected_tool, "")
                self.assertEqual(case.expected_sdk.tool_execution_count, 0)
                self.assertEqual(case.expected_provider.tool_execution_count, 0)
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

    def test_observation_extraction_uses_closed_safe_details(self) -> None:
        sdk_observation = agent_response_to_agents_sdk_pilot_observation(
            "sdk",
            _closed_response("agents_sdk_notice_get_pilot_failed", "runtime_closed"),
        )
        provider_observation = agent_response_to_agents_sdk_pilot_observation(
            "provider",
            _closed_response("provider_tool_runtime_failed", "runtime_closed"),
        )

        self.assertEqual(sdk_observation.lane, "sdk")
        self.assertEqual(provider_observation.lane, "provider")
        self.assertEqual(sdk_observation.status, "error")
        self.assertEqual(provider_observation.status, "error")
        self.assertEqual(sdk_observation.selected_tool, "")
        self.assertEqual(provider_observation.selected_tool, "")
        self.assertEqual(sdk_observation.failure_kind, "runtime_closed")
        self.assertEqual(provider_observation.failure_kind, "runtime_closed")
        self.assertEqual(sdk_observation.tool_execution_count, 0)
        self.assertEqual(provider_observation.tool_execution_count, 0)
        self.assertFalse(sdk_observation.final_answer_present)
        self.assertFalse(provider_observation.final_answer_present)

    def test_parity_report_passes_closed_denominator(self) -> None:
        fixture = load_agents_sdk_notice_get_parity_cases()
        sdk_observations = {}
        provider_observations = {}
        for case in fixture.cases:
            sdk_observations[case.case_id] = _observation(
                "sdk",
                case.expected_sdk.failure_kind,
            )
            provider_observations[case.case_id] = _observation(
                "provider",
                case.expected_provider.failure_kind,
            )

        report = evaluate_agents_sdk_pilot_parity_cases(
            fixture,
            sdk_observations=sdk_observations,
            provider_observations=provider_observations,
        )

        self.assertTrue(report.passed)
        self.assertEqual(report.total, 2)
        self.assertEqual(report.failed_count, 0)

    def test_parity_report_detects_observation_drift(self) -> None:
        fixture = load_agents_sdk_notice_get_parity_cases()
        case = fixture.cases[0]
        sdk_observation = _observation("sdk", "runtime_closed")
        provider_observation = _observation("provider", "runtime_disabled")

        report = evaluate_agents_sdk_pilot_parity_cases(
            fixture,
            sdk_observations={case.case_id: sdk_observation},
            provider_observations={case.case_id: provider_observation},
        )

        result = report.results[0]
        self.assertFalse(report.passed)
        self.assertFalse(result.passed)
        self.assertEqual(result.failure_class, "provider_observation_mismatch")


def _closed_response(error_code: str, failure_class: str) -> AgentResponse:
    return AgentResponse(
        target="notice-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(code=error_code, message=failure_class),
        agent_observability=AgentObservability(
            selected_tool="",
            tool_attempted=False,
            tool_outcome=failure_class,
            failure_class=failure_class,
            result_outcome=failure_class,
            source_ref_count=0,
            access_decision="not_evaluated",
            safe_details={},
        ),
    )


def _observation(lane: str, failure_kind: str) -> AgentsSdkPilotParityObservation:
    return AgentsSdkPilotParityObservation(
        lane=lane,
        status="error",
        selected_tool="",
        tool_attempted=False,
        tool_outcome=failure_kind,
        failure_class=failure_kind,
        failure_kind=failure_kind,
        argument_keys=(),
        source_ref_count=0,
        result_outcome=failure_kind,
        tool_execution_count=0,
        final_answer_present=False,
    )


if __name__ == "__main__":
    unittest.main()
