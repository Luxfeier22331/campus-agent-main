from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import campus_evals.multi_agent_live_smoke_gate as multi_agent_live_smoke_gate
import campus_evals.multi_agent_runtime_contract_gate as multi_agent_runtime_contract_gate

from scripts.eval_gate import run_eval_acceptance


class MultiAgentProductPathEvalGateProfileTest(unittest.TestCase):
    def test_eval_gate_accept_supports_multi_agent_runtime_contract_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-runtime-contract-gate"
            with patch.object(
                multi_agent_runtime_contract_gate,
                "main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="multi-agent-runtime-contract",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "multi-agent-runtime-contract")
        self.assertEqual(summary["exit_code"], 0)
        runner.assert_called_once_with(
            [
                "accept",
                "--output-dir",
                str(output_dir),
                "--reruns",
                "1",
            ]
        )

    def test_eval_gate_accept_supports_multi_agent_live_smoke_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(
                multi_agent_live_smoke_gate,
                "main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="multi-agent-live-smoke",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "multi-agent-live-smoke")
        self.assertEqual(summary["exit_code"], 0)
        runner.assert_called_once_with(
            [
                "accept",
                "--output-dir",
                str(output_dir),
                "--reruns",
                "1",
            ]
        )

    def test_multi_agent_live_smoke_gate_runs_positive_and_closed_profiles(self) -> None:
        observed_profiles: list[str] = []

        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            observed_profiles.append(plan.profile)
            return {
                "schema_version": "supervisor_runtime_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_status},
                "answer": {
                    "workflow_trace_summary": {
                        "routing_frame": {"routing_next_action": "delegate"},
                        "context_resolution": {"state": "ok"},
                        "planning_outcome": "preplanned",
                        "direct_vs_delegate_branch": "delegate",
                        "workflow_mode": "single_handoff",
                        "handoff": {"target": "rag-agent"},
                        "handoff_chain": [{"target": "rag-agent"}],
                        "selected_target": "rag-agent",
                        "selected_tools": ["retrieval.query"],
                        "tool_argument_summary": {"selected_tool": "retrieval.query"},
                        "trace_steps": [
                            {
                                "step_id": "runtime_policy",
                                "span_kind": "runtime_policy",
                                "parent_step_id": "",
                                "outcome": "delegate",
                            }
                        ],
                        "tool_call_summaries": [
                            {
                                "tool_name": "retrieval.query",
                                "result_status": "completed",
                                "source_ids": [],
                            }
                        ],
                        "guardrail_outcomes": {"scope_gate": "allow"},
                        "fail_close_reason": "",
                        "runtime_versions": {"workflow_trace_summary": "test"},
                        "policy_artifact_versions": {"intent_policy": "test"},
                    }
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(multi_agent_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                )

            artifact = json.loads(
                (output_dir / multi_agent_live_smoke_gate.DEFAULT_REPORT_NAME).read_text(
                    encoding="utf-8"
                )
            )

        self.assertEqual(
            observed_profiles,
            list(multi_agent_live_smoke_gate.DEFAULT_PROCESS_SMOKE_PROFILES),
        )
        self.assertTrue(payload["passed"])
        self.assertEqual(artifact["summary"]["total_profiles"], len(observed_profiles))
        self.assertIn("rag_delegate", artifact["workflow_trace_replay"]["evaluated_profiles"])

    def test_eval_gate_rejects_publish_dry_run_for_multi_agent_product_path_profile(
        self,
    ) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(
                ValueError,
                "multi-agent-runtime-contract does not produce live case-results artifacts",
            ),
        ):
            run_eval_acceptance(
                profile="multi-agent-product-path",
                output_dir=Path(temp_dir),
                reruns=1,
                publish_dry_run=True,
                publish_grade_source="eval_release_gate",
                publish_grader_version="grader@2026-04-29",
            )


if __name__ == "__main__":
    unittest.main()
