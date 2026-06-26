from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals import campus_services_product_path_opening_gate as opening_gate
from campus_evals.campus_services_product_path_opening_gate import (
    DEFAULT_GATE_ID,
    DEFAULT_SCHEMA_VERSION,
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
            artifact["schema_version"],
            "campus_services_product_path_opening_gate.v2",
        )
        self.assertEqual(DEFAULT_SCHEMA_VERSION, artifact["schema_version"])
        self.assertEqual(
            [check["check_id"] for check in artifact["checks"]],
            [
                "execution_control_go_structured_runtime_tests",
                "app_api_campus_services_runtime_tests",
                "campus_web_worker_e2e_tests",
                "app_api_typecheck",
                "campus_web_typecheck",
            ],
        )
        self.assertEqual(
            sorted(artifact["summary"]["opened_tools"]),
            [
                "transport_schedule_lookup",
            ],
        )
        self.assertEqual(artifact["summary"]["blocked_tools"], [])
        self.assertEqual(artifact["summary"]["closed_tools"], [])
        self.assertEqual(artifact["version_summary"]["git_head"], "abc123")
        self.assertFalse(any("--profile" in command for command in commands))

    def test_opening_gate_no_longer_runs_old_python_lookup_release_gates(
        self,
    ) -> None:
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
                git_head_resolver=lambda: "def456",
            )
            artifact = json.loads(
                (output_dir / "campus-services-product-path-opening-gate.json").read_text(
                    encoding="utf-8"
                )
            )

        self.assertTrue(report.passed)
        self.assertNotIn(
            "service_guide_lookup_release_gate",
            [check["check_id"] for check in artifact["checks"]],
        )
        self.assertNotIn(
            "contact_directory_lookup_release_gate",
            [check["check_id"] for check in artifact["checks"]],
        )
        self.assertFalse(any("service-guide-lookup" in command for command in commands))
        self.assertFalse(any("contact-directory-lookup" in command for command in commands))
        tool_verdicts = {item["tool_name"]: item for item in artifact["tool_verdicts"]}
        self.assertNotIn("service_guide_lookup", tool_verdicts)
        self.assertNotIn("contact_directory_lookup", tool_verdicts)

    def test_opening_gate_blocks_all_open_candidates_when_shared_runtime_check_fails(
        self,
    ) -> None:
        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            if command[:2] == ("go", "test"):
                return CommandResult(returncode=1, stdout="", stderr="go runtime failed")
            return CommandResult(returncode=0, stdout="ok", stderr="")

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            report = run_campus_services_product_path_opening_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                git_head_resolver=lambda: "abc789",
            )
            artifact = json.loads(
                (output_dir / "campus-services-product-path-opening-gate.json").read_text(
                    encoding="utf-8"
                )
            )

        self.assertFalse(report.passed)
        self.assertEqual(artifact["summary"]["opened_tools"], [])
        self.assertEqual(
            sorted(artifact["summary"]["blocked_tools"]),
            [
                "transport_schedule_lookup",
            ],
        )
        self.assertEqual(artifact["summary"]["closed_tools"], [])
        tool_verdicts = {item["tool_name"]: item for item in artifact["tool_verdicts"]}
        for tool_name in artifact["summary"]["blocked_tools"]:
            self.assertEqual(tool_verdicts[tool_name]["status"], "blocked")
            self.assertIn(
                "execution_control_go_structured_runtime_tests",
                tool_verdicts[tool_name]["failed_checks"],
            )

    def test_opening_profile_registry_validation_rejects_invalid_profiles(self) -> None:
        self.assertTrue(hasattr(opening_gate, "ToolOpeningProfile"))
        self.assertTrue(hasattr(opening_gate, "validate_tool_opening_profiles"))
        profile_cls = opening_gate.ToolOpeningProfile
        validate = opening_gate.validate_tool_opening_profiles

        with self.assertRaisesRegex(ValueError, "duplicate tool opening profile"):
            validate(
                (
                    profile_cls(
                        tool_name="transport_schedule_lookup",
                        product_path_status="open_candidate",
                        required_checks=("execution_control_go_structured_runtime_tests",),
                        reason="ready",
                    ),
                    profile_cls(
                        tool_name="transport_schedule_lookup",
                        product_path_status="keep_closed",
                        required_checks=(),
                        reason="duplicate",
                    ),
                )
            )
        with self.assertRaisesRegex(ValueError, "unsupported product_path_status"):
            validate(
                (
                    profile_cls(
                        tool_name="new_tool",
                        product_path_status="experimental",
                        required_checks=(),
                        reason="invalid",
                    ),
                )
            )
        with self.assertRaisesRegex(ValueError, "open_candidate requires required_checks"):
            validate(
                (
                    profile_cls(
                        tool_name="new_tool",
                        product_path_status="open_candidate",
                        required_checks=(),
                        reason="missing checks",
                    ),
                )
            )
        with self.assertRaisesRegex(ValueError, "keep_closed must not require checks"):
            validate(
                (
                    profile_cls(
                        tool_name="new_tool",
                        product_path_status="keep_closed",
                        required_checks=("execution_control_go_structured_runtime_tests",),
                        reason="closed",
                    ),
                )
            )


if __name__ == "__main__":
    unittest.main()
