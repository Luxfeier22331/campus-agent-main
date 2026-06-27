# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.evals.tool_runtime_contract_eval_gate_profile_suite_support import *


class ToolRuntimeContractEvalGateProfileTestPart01(unittest.TestCase):
    def test_eval_gate_accept_supports_tool_runtime_contract_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-runtime-contract-gate"
            with patch.object(
                tool_runtime_contract_gate,
                "main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="tool-runtime-contract",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "tool-runtime-contract")
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

    def test_eval_gate_accept_supports_tool_live_smoke_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-live-smoke"
            with patch.object(
                tool_live_smoke_gate,
                "main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="tool-live-smoke",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "tool-live-smoke")
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

    def test_tool_live_smoke_gate_runs_positive_and_closed_profiles(self) -> None:
        observed_profiles: list[str] = []

        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            observed_profiles.append(plan.profile)
            return {
                "schema_version": "execution_control_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_run_status},
                "answer": {"workflow_trace_summary": _current_workflow_trace_summary(plan.profile)},
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-live-smoke"
            with patch.object(tool_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = tool_live_smoke_gate.run_tool_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                )

            artifact = json.loads(
                (output_dir / tool_live_smoke_gate.DEFAULT_REPORT_NAME).read_text(encoding="utf-8")
            )

        self.assertEqual(
            observed_profiles,
            list(tool_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES),
        )
        self.assertTrue(payload["passed"])
        self.assertEqual(artifact["summary"]["total_profiles"], len(observed_profiles))
        self.assertIn("rag_delegate", artifact["workflow_trace_replay"]["evaluated_profiles"])

    def test_tool_live_smoke_default_profiles_cover_governed_workflow_lane(
        self,
    ) -> None:
        self.assertEqual(
            set(tool_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES),
            {
                "closed_gate",
                "terminal_fail_close",
                "rag_delegate",
                "multi_step_notice_knowledge_followthrough",
                "transport_notice_override_multistep",
                "selected_notice_knowledge_followthrough_ineligible",
            },
        )
        self.assertEqual(
            set(tool_live_smoke_gate.DEFAULT_SINGLE_SURFACE_SDK_PROCESS_SMOKE_PROFILES),
            {
                "transport_schedule_sdk_opened",
                "transport_schedule_sdk_opened_stream",
                "notice_discover_sdk_opened",
                "transactional_approval_required",
            },
        )
        self.assertEqual(
            set(tool_live_smoke_gate.DEFAULT_PROCESS_SMOKE_PROFILES),
            set(tool_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES)
            | set(tool_live_smoke_gate.DEFAULT_SINGLE_SURFACE_SDK_PROCESS_SMOKE_PROFILES),
        )
        self.assertEqual(
            tool_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS[
                "multi_step_notice_knowledge_followthrough"
            ],
            "workflow-notice-knowledge-followthrough-multistep",
        )
        self.assertEqual(
            tool_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS[
                "transport_notice_override_multistep"
            ],
            "workflow-transport-notice-override-multistep",
        )
        self.assertEqual(
            tool_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS[
                "selected_notice_knowledge_followthrough_ineligible"
            ],
            "workflow-selected-notice-knowledge-followthrough-ineligible",
        )

    def test_tool_live_smoke_assigns_distinct_local_ports_per_profile(self) -> None:
        built_ports: list[tuple[str, int, int]] = []

        def fake_build_process_smoke_plan(
            *,
            repo_root,
            output_dir,
            profile: str,
            api_port: int,
            object_store_port: int,
        ):
            built_ports.append((profile, api_port, object_store_port))
            return SimpleNamespace(
                profile=profile,
                expected_run_status=200,
                output_dir=output_dir,
            )

        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            return {
                "schema_version": "execution_control_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_run_status},
                "answer": {
                    "workflow_trace_summary": _current_workflow_trace_summary(plan.profile),
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-live-smoke"
            with (
                patch.object(
                    tool_live_smoke_gate,
                    "build_process_smoke_plan",
                    side_effect=fake_build_process_smoke_plan,
                ),
                patch.object(tool_live_smoke_gate, "run_process_smoke", fake_smoke),
            ):
                tool_live_smoke_gate.run_tool_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=(
                        "closed_gate",
                        "rag_delegate",
                        "selected_notice_knowledge_followthrough_ineligible",
                    ),
                )

        self.assertEqual(len(built_ports), 3)
        self.assertEqual(len({item[1] for item in built_ports}), 3)
        self.assertEqual(len({item[2] for item in built_ports}), 3)

    def test_tool_live_smoke_workflow_replay_is_blocking(self) -> None:
        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            summary = _current_workflow_trace_summary(plan.profile)
            if plan.profile == "rag_delegate":
                summary = {
                    **summary,
                    "selected_tool": "campus_notice_discover",
                }
            return {
                "schema_version": "execution_control_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_run_status},
                "answer": {
                    "workflow_trace_summary": summary,
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-live-smoke"
            with patch.object(tool_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = tool_live_smoke_gate.run_tool_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )

        replay = payload["workflow_trace_replay"]
        self.assertFalse(payload["passed"])
        self.assertFalse(replay.get("report_only", False))
        self.assertEqual(replay["failed_case_ids"], ["workflow-knowledge-delegate"])

    def test_tool_live_smoke_missing_mapped_trace_fails_gate(self) -> None:
        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            return {
                "schema_version": "execution_control_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_run_status},
                "answer": {},
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-live-smoke"
            with patch.object(tool_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = tool_live_smoke_gate.run_tool_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )

        replay = payload["workflow_trace_replay"]
        self.assertFalse(payload["passed"])
        self.assertEqual(replay["missing_case_ids"], ["workflow-knowledge-delegate"])

    def test_tool_live_smoke_replay_accepts_current_workflow_trace_shapes(self) -> None:
        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            return {
                "schema_version": "execution_control_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_run_status},
                "answer": {
                    "workflow_trace_summary": _current_workflow_trace_summary(plan.profile),
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-live-smoke"
            with patch.object(tool_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = tool_live_smoke_gate.run_tool_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                )

        replay = payload["workflow_trace_replay"]
        self.assertEqual(replay["failed_case_ids"], [])
        self.assertEqual(replay["missing_case_ids"], [])
        self.assertEqual(
            set(replay["evaluated_profiles"]),
            set(tool_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES)
            & set(tool_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS),
        )

    def test_tool_live_smoke_overwrites_existing_process_smoke_summary(self) -> None:
        call_count = {"value": 0}

        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            call_count["value"] += 1
            summary = _current_workflow_trace_summary(plan.profile)
            if call_count["value"] == 1:
                summary = {
                    **summary,
                    "selected_tool": "campus_notice_discover",
                }
            return {
                "schema_version": "execution_control_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_run_status},
                "answer": {
                    "workflow_trace_summary": summary,
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "tool-live-smoke"
            with patch.object(tool_live_smoke_gate, "run_process_smoke", fake_smoke):
                first_payload = tool_live_smoke_gate.run_tool_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )
                second_payload = tool_live_smoke_gate.run_tool_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )

        self.assertFalse(first_payload["passed"])
        self.assertEqual(
            first_payload["workflow_trace_replay"]["failed_case_ids"],
            ["workflow-knowledge-delegate"],
        )
        self.assertTrue(second_payload["passed"])
        self.assertEqual(second_payload["workflow_trace_replay"]["failed_case_ids"], [])

    def test_eval_gate_rejects_removed_tool_runtime_contract_product_path_profile(
        self,
    ) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(
                ValueError,
                "unsupported eval profile",
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
