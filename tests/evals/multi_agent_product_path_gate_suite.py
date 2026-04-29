from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import campus_evals.multi_agent_runtime_contract_gate as gate
from campus_evals.multi_agent_runtime_contract_gate import (
    DEFAULT_GATE_ID,
    DEFAULT_SCHEMA_VERSION,
    CommandResult,
    run_multi_agent_product_path_gate,
)
from campus_evals.public_chat_product_path_eval import load_public_chat_product_path_cases
from campus_evals.tool_family_denominator import load_tool_family_denominator
from campus_evals.workflow_trace_gate import load_workflow_trace_cases


class MultiAgentProductPathGateTest(unittest.TestCase):
    def test_gate_writes_machine_readable_artifact_with_runtime_contract_summaries(self) -> None:
        calls: list[tuple[tuple[str, ...], Path | None]] = []

        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            calls.append((command, cwd))
            return CommandResult(returncode=0, stdout="ok", stderr="")

        workflow_cases = load_workflow_trace_cases()
        tool_denominator = load_tool_family_denominator()
        public_chat_cases = load_public_chat_product_path_cases()

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            report = run_multi_agent_product_path_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                git_head_resolver=lambda: "abc123",
            )
            artifact = json.loads(
                (output_dir / "multi-agent-runtime-contract-gate.json").read_text(encoding="utf-8")
            )

        self.assertTrue(report.passed)
        self.assertEqual(artifact["gate_id"], DEFAULT_GATE_ID)
        self.assertEqual(artifact["schema_version"], DEFAULT_SCHEMA_VERSION)
        self.assertEqual(
            [check["check_id"] for check in artifact["checks"]],
            [
                "supervisor_execution_contract_generation_check",
                "workflow_trace_eval_tests",
                "tool_family_denominator_tests",
                "public_chat_product_path_eval_tests",
                "supervisor_multi_agent_runtime_tests",
                "domain_agent_adapter_tests",
                "app_api_multi_agent_observability_tests",
                "panel_multi_agent_observability_tests",
            ],
        )
        self.assertEqual(artifact["summary"]["total_checks"], 8)
        self.assertEqual(artifact["summary"]["passed_checks"], 8)
        self.assertEqual(artifact["summary"]["failed_checks"], 0)
        self.assertEqual(
            artifact["workflow_trace_summary"],
            {
                "case_family": workflow_cases.case_family,
                "case_count": len(workflow_cases.cases),
            },
        )
        self.assertEqual(
            artifact["tool_family_summary"],
            {
                "tool_count": len(tool_denominator.tools),
                "case_count": len(tool_denominator.cases),
            },
        )
        self.assertEqual(
            artifact["public_chat_product_path_summary"],
            {
                "case_family": public_chat_cases.case_family,
                "case_count": len(public_chat_cases.cases),
            },
        )
        self.assertEqual(artifact["version_summary"]["git_head"], "abc123")
        self.assertEqual(artifact["version_summary"]["runner"], DEFAULT_SCHEMA_VERSION)
        self.assertIn(
            (
                (
                    "uv",
                    "run",
                    "--all-packages",
                    "python",
                    "-m",
                    "scripts.generate_supervisor_execution_contracts",
                    "--check",
                ),
                gate.REPO_ROOT,
            ),
            calls,
        )
        self.assertIn(
            (
                (
                    "uv",
                    "run",
                    "--all-packages",
                    "python",
                    "-m",
                    "unittest",
                    "tests.evals.test_workflow_trace_gate",
                ),
                gate.REPO_ROOT,
            ),
            calls,
        )
        self.assertIn(
            (
                (
                    "go",
                    "test",
                    "./internal/httpapi",
                    "./internal/structuredplanning",
                    "./internal/runtimepolicy",
                    "./internal/structuredquery",
                ),
                gate.SUPERVISOR_API_DIR,
            ),
            calls,
        )
        self.assertIn(
            (
                (
                    "pnpm",
                    "--dir",
                    "apps/protected-panel-web",
                    "exec",
                    "vitest",
                    "run",
                    "-c",
                    "vitest.node.config.mts",
                    "test/data-provider.test.ts",
                    "test/panel-shell-copy-regression.test.ts",
                    "test/request-formatters.test.ts",
                ),
                gate.REPO_ROOT,
            ),
            calls,
        )

    def test_gate_records_failed_targeted_check_without_running_live_processes(self) -> None:
        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            if "apps/app-api" in command:
                return CommandResult(returncode=1, stdout="", stderr="app-api failed")
            return CommandResult(returncode=0, stdout="ok", stderr="")

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            report = run_multi_agent_product_path_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                git_head_resolver=lambda: "def456",
            )
            artifact = json.loads(
                (output_dir / "multi-agent-runtime-contract-gate.json").read_text(encoding="utf-8")
            )

        self.assertFalse(report.passed)
        self.assertEqual(artifact["summary"]["passed_checks"], 7)
        self.assertEqual(artifact["summary"]["failed_checks"], 1)
        checks = {check["check_id"]: check for check in artifact["checks"]}
        self.assertFalse(checks["app_api_multi_agent_observability_tests"]["passed"])
        self.assertEqual(
            checks["app_api_multi_agent_observability_tests"]["stderr"], "app-api failed"
        )
        command_words = [word for check in artifact["checks"] for word in check["command"]]
        self.assertNotIn("docker", command_words)
        self.assertNotIn("wrangler", command_words)


if __name__ == "__main__":
    unittest.main()
