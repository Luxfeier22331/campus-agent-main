from __future__ import annotations

import unittest

from campus_evals.agents_sdk_pilot_parity import (
    AgentsSdkPilotParityObservation,
    AgentsSdkPilotParityReport,
    AgentsSdkPilotParityResult,
)
from campus_evals.agents_sdk_promotion_gate import (
    AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX,
    AgentsSdkPromotionGateEvidence,
    evaluate_agents_sdk_promotion_gate,
)


class AgentsSdkPromotionGateTest(unittest.TestCase):
    def test_notice_discover_can_stay_explicitly_gated_after_parity_without_live_evidence(
        self,
    ) -> None:
        result = evaluate_agents_sdk_promotion_gate(
            AgentsSdkPromotionGateEvidence(
                target="notice-agent",
                tool="campus_notice_discover",
                sdk_observation=_observation("sdk"),
                direct_observation=_observation("direct"),
                parity_report=_passing_report(),
                boundary_checks_passed=True,
                redaction_checks_passed=True,
                rollback_path_documented=True,
                live_latency_cost_evidence_present=False,
            )
        )

        self.assertTrue(result.adapter_admitted)
        self.assertFalse(result.default_on_allowed)
        self.assertEqual(result.decision, "keep_explicit_runtime_gate")
        self.assertEqual(result.blockers, ("live_latency_cost_evidence_missing",))

    def test_missing_tool_execution_blocks_adapter_admission(self) -> None:
        result = evaluate_agents_sdk_promotion_gate(
            AgentsSdkPromotionGateEvidence(
                target="notice-agent",
                tool="campus_notice_discover",
                sdk_observation=_observation("sdk", tool_execution_count=0),
                direct_observation=_observation("direct"),
                parity_report=_passing_report(),
                boundary_checks_passed=True,
                redaction_checks_passed=True,
                rollback_path_documented=True,
                live_latency_cost_evidence_present=True,
            )
        )

        self.assertFalse(result.adapter_admitted)
        self.assertIn("sdk_tool_execution_missing", result.blockers)

    def test_campus_services_matrix_admits_opened_read_only_tools_to_sdk(self) -> None:
        self.assertEqual(
            AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX["service_status_lookup"],
            "sdk_adapter_admitted",
        )
        self.assertEqual(
            AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX["transport_schedule_lookup"],
            "sdk_adapter_admitted",
        )
        self.assertEqual(
            AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX["service_guide_lookup"],
            "sdk_adapter_admitted",
        )
        self.assertEqual(
            AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX["contact_directory_lookup"],
            "sdk_adapter_admitted",
        )
        self.assertEqual(
            AGENTS_SDK_CAMPUS_SERVICES_ADOPTION_MATRIX["academic_calendar_lookup"],
            "sdk_adapter_admitted",
        )


def _passing_report() -> AgentsSdkPilotParityReport:
    sdk = _observation("sdk")
    direct = _observation("direct")
    return AgentsSdkPilotParityReport(
        passed=True,
        total=1,
        passed_count=1,
        failed_count=0,
        results=(
            AgentsSdkPilotParityResult(
                case_id="notice_discover_sdk_vs_direct_card_first",
                passed=True,
                failure_class="",
                reason="ok",
                sdk_observation=sdk,
                provider_observation=direct,
            ),
        ),
    )


def _observation(
    lane: str,
    *,
    tool_execution_count: int = 1,
) -> AgentsSdkPilotParityObservation:
    return AgentsSdkPilotParityObservation(
        lane=lane,
        status="completed",
        selected_tool="campus_notice_discover",
        tool_attempted=True,
        tool_outcome="sdk_completed" if lane == "sdk" else "resolved_current",
        failure_class="",
        failure_kind="",
        argument_keys=("query_text",),
        source_ref_count=1,
        result_outcome="sdk_completed" if lane == "sdk" else "resolved_current",
        tool_execution_count=tool_execution_count,
        final_answer_present=True,
        tool_output_submitted=lane == "sdk",
    )


if __name__ == "__main__":
    unittest.main()
