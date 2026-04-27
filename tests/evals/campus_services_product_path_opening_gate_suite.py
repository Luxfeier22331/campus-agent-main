from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.campus_services_product_path_opening_gate import (
    DEFAULT_GATE_ID,
    CommandResult,
    run_campus_services_product_path_opening_gate,
)


class CampusServicesProductPathOpeningGateTest(unittest.TestCase):
    def test_opening_gate_writes_machine_readable_artifact_and_open_verdicts(self) -> None:
        commands: list[tuple[str, ...]] = []

        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            commands.append(command)
            return CommandResult(returncode=0, stdout="ok", stderr="")

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            report = run_campus_services_product_path_opening_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                git_head_resolver=lambda: "abc123",
            )
            artifact = json.loads(
                (output_dir / "campus-services-product-path-opening-gate.json").read_text(
                    encoding="utf-8"
                )
            )

        self.assertTrue(report.passed)
        self.assertEqual(artifact["gate_id"], DEFAULT_GATE_ID)
        self.assertEqual(
            [check["check_id"] for check in artifact["checks"]],
            [
                "service_guide_lookup_release_gate",
                "contact_directory_lookup_release_gate",
                "supervisor_go_structured_runtime_tests",
                "campus_services_agent_adapter_tests",
                "app_api_campus_services_runtime_tests",
                "public_chat_worker_e2e_tests",
                "app_api_typecheck",
                "public_chat_typecheck",
            ],
        )
        self.assertEqual(
            sorted(artifact["summary"]["opened_tools"]),
            [
                "contact_directory_lookup",
                "service_guide_lookup",
                "service_status_lookup",
                "transport_schedule_lookup",
            ],
        )
        self.assertEqual(artifact["summary"]["blocked_tools"], [])
        self.assertEqual(artifact["version_summary"]["git_head"], "abc123")
        self.assertIn(
            (
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "scripts.eval_gate",
                "accept",
                "--profile",
                "service-guide-lookup",
                "--output-dir",
                str(
                    output_dir
                    / "service-guide-lookup-release-gate"
                ),
            ),
            commands,
        )
        self.assertIn(
            (
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "scripts.eval_gate",
                "accept",
                "--profile",
                "contact-directory-lookup",
                "--output-dir",
                str(
                    output_dir
                    / "contact-directory-lookup-release-gate"
                ),
            ),
            commands,
        )

    def test_opening_gate_marks_single_tool_blocked_when_service_guide_release_gate_fails(
        self,
    ) -> None:
        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            if "--profile" in command and "service-guide-lookup" in command:
                return CommandResult(returncode=1, stdout="", stderr="service guide gate failed")
            return CommandResult(returncode=0, stdout="ok", stderr="")

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            report = run_campus_services_product_path_opening_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                git_head_resolver=lambda: "def456",
            )
            artifact = json.loads(
                (output_dir / "campus-services-product-path-opening-gate.json").read_text(
                    encoding="utf-8"
                )
            )

        self.assertFalse(report.passed)
        tool_verdicts = {item["tool_name"]: item for item in artifact["tool_verdicts"]}
        self.assertEqual(tool_verdicts["service_guide_lookup"]["status"], "blocked")
        self.assertIn(
            "service_guide_lookup_release_gate",
            tool_verdicts["service_guide_lookup"]["failed_checks"],
        )
        self.assertEqual(tool_verdicts["contact_directory_lookup"]["status"], "open")
        self.assertEqual(tool_verdicts["service_status_lookup"]["status"], "open")
        self.assertEqual(tool_verdicts["transport_schedule_lookup"]["status"], "open")


if __name__ == "__main__":
    unittest.main()
