from __future__ import annotations

import unittest
from pathlib import Path

from campus_evals.agents_sdk_pilot_parity import (
    AgentsSdkPilotParityObservation,
    AgentsSdkPilotParityReport,
    AgentsSdkPilotParityResult,
)
from campus_evals.agents_sdk_posture_decision import (
    AgentsSdkPostureEvidence,
    decide_agents_sdk_runtime_posture,
)


class AgentsSdkPostureDecisionTest(unittest.TestCase):
    def test_runtime_posture_decision_artifact_records_selected_experimental_lane(self) -> None:
        artifact = Path(
            ".planning/workstreams/agents-sdk-domain-agent-adapter-pilot/phases/"
            "phase-07-runtime-posture-decision/RUNTIME-POSTURE-DECISION.md"
        )

        self.assertTrue(artifact.exists())
        content = artifact.read_text(encoding="utf-8")
        self.assertIn("selected_posture: keep_experimental_lane", content)
        self.assertIn("does not change product defaults", content)
        self.assertIn("No default env values are flipped", content)
        self.assertIn("Phase 8", content)

    def test_full_parity_and_boundary_checks_allow_selected_promotion(self) -> None:
        decision = decide_agents_sdk_runtime_posture(
            AgentsSdkPostureEvidence(
                parity_report=_passing_report(),
                phase5_trace_projection_ready=True,
                boundary_checks_passed=True,
                readiness_gate_covered=True,
                rollback_path_documented=True,
                live_latency_cost_evidence_present=True,
            )
        )

        self.assertEqual(decision.selected_posture, "promote_selected_adapter")
        self.assertTrue(decision.promotion_allowed)
        self.assertIn("parity_passed", decision.evidence_considered)
        self.assertIn("live_latency_cost_evidence_present", decision.evidence_considered)

    def test_live_evidence_absent_keeps_experimental_lane_after_parity_passes(self) -> None:
        decision = decide_agents_sdk_runtime_posture(
            AgentsSdkPostureEvidence(
                parity_report=_passing_report(),
                phase5_trace_projection_ready=True,
                boundary_checks_passed=True,
                readiness_gate_covered=True,
                rollback_path_documented=True,
                live_latency_cost_evidence_present=False,
            )
        )

        self.assertEqual(decision.selected_posture, "keep_experimental_lane")
        self.assertFalse(decision.promotion_allowed)
        self.assertIn("live_latency_cost_evidence_missing", decision.blockers)
        self.assertIn("passing parity does not change product defaults", decision.rollout_notes)

    def test_any_parity_failure_keeps_experimental_lane_with_failure_evidence(self) -> None:
        decision = decide_agents_sdk_runtime_posture(
            AgentsSdkPostureEvidence(
                parity_report=_failing_report("provider_observation_mismatch"),
                phase5_trace_projection_ready=True,
                boundary_checks_passed=True,
                readiness_gate_covered=True,
                rollback_path_documented=True,
                live_latency_cost_evidence_present=True,
            )
        )

        self.assertEqual(decision.selected_posture, "keep_experimental_lane")
        self.assertFalse(decision.promotion_allowed)
        self.assertIn("parity_failed", decision.blockers)
        self.assertIn("provider_observation_mismatch", decision.evidence_considered)

    def test_missing_phase5_projection_defers_expansion(self) -> None:
        decision = decide_agents_sdk_runtime_posture(
            AgentsSdkPostureEvidence(
                parity_report=_passing_report(),
                phase5_trace_projection_ready=False,
                boundary_checks_passed=True,
                readiness_gate_covered=True,
                rollback_path_documented=True,
                live_latency_cost_evidence_present=True,
            )
        )

        self.assertEqual(decision.selected_posture, "defer_expansion")
        self.assertFalse(decision.promotion_allowed)
        self.assertIn("phase5_trace_projection_missing", decision.blockers)

    def test_boundary_leak_rejects_sdk_adapter(self) -> None:
        decision = decide_agents_sdk_runtime_posture(
            AgentsSdkPostureEvidence(
                parity_report=_passing_report(),
                phase5_trace_projection_ready=True,
                boundary_checks_passed=False,
                readiness_gate_covered=True,
                rollback_path_documented=True,
                live_latency_cost_evidence_present=True,
            )
        )

        self.assertEqual(decision.selected_posture, "reject_sdk_adapter")
        self.assertFalse(decision.promotion_allowed)
        self.assertIn("boundary_checks_failed", decision.blockers)
        self.assertIn(
            "reject if raw SDK/provider payload crosses repo boundary", decision.rejection_criteria
        )


def _passing_report() -> AgentsSdkPilotParityReport:
    sdk = _observation("sdk")
    provider = _observation("provider")
    result = AgentsSdkPilotParityResult(
        case_id="notice_get_should_call_minimal_args",
        passed=True,
        failure_class="",
        reason="ok",
        sdk_observation=sdk,
        provider_observation=provider,
    )
    return AgentsSdkPilotParityReport(
        passed=True,
        total=1,
        passed_count=1,
        failed_count=0,
        results=(result,),
    )


def _failing_report(failure_class: str) -> AgentsSdkPilotParityReport:
    sdk = _observation("sdk")
    provider = _observation("provider")
    result = AgentsSdkPilotParityResult(
        case_id="notice_get_should_call_minimal_args",
        passed=False,
        failure_class=failure_class,
        reason="drift",
        sdk_observation=sdk,
        provider_observation=provider,
    )
    return AgentsSdkPilotParityReport(
        passed=False,
        total=1,
        passed_count=0,
        failed_count=1,
        results=(result,),
    )


def _observation(lane: str) -> AgentsSdkPilotParityObservation:
    return AgentsSdkPilotParityObservation(
        lane=lane,
        status="completed",
        selected_tool="campus_notice_get",
        tool_attempted=True,
        tool_outcome="completed",
        failure_class="",
        failure_kind="",
        argument_keys=("notice_id",),
        source_ref_count=2,
        result_outcome="resolved_current",
        tool_execution_count=1,
        final_answer_present=True,
        tool_output_submitted=lane == "sdk",
    )


if __name__ == "__main__":
    unittest.main()
