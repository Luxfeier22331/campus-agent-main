from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.intent_models import IntentEvalReport
from campus_evals.service_guide_lookup_release_gate import (
    CommandResult,
    run_service_guide_lookup_release_gate,
    service_guide_lookup_intent_gate_cases,
)


class ServiceGuideLookupReleaseGateTest(unittest.TestCase):
    def test_intent_case_subset_covers_lookup_and_transaction_guardrails(self) -> None:
        cases = service_guide_lookup_intent_gate_cases()

        self.assertGreaterEqual(len(cases), 6)
        self.assertTrue(
            any(case.expected_allowed_tools == ("service_guide_lookup",) for case in cases)
        )
        self.assertTrue(
            any(
                case.expected_next_action == "approval_required"
                and case.expected_capability == "campus_services"
                for case in cases
            )
        )

    def test_release_gate_writes_projection_intent_and_runtime_checks(self) -> None:
        commands: list[tuple[str, ...]] = []

        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            commands.append(command)
            return CommandResult(returncode=0, stdout="ok", stderr="")

        def fake_intent_runner(_cases) -> IntentEvalReport:
            return IntentEvalReport(
                total=2,
                passed=2,
                failed=0,
                overall_exact_match_rate=1.0,
                critical_total=2,
                critical_passed=2,
                critical_gate_pass_rate=1.0,
                confusion={},
                results=(),
            )

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            report = run_service_guide_lookup_release_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
            )
            artifact = json.loads(
                (output_dir / "service-guide-lookup-release-gate.json").read_text(encoding="utf-8")
            )

        self.assertTrue(report.passed)
        self.assertEqual(artifact["gate_id"], "service_guide_lookup")
        self.assertEqual(
            [check["check_id"] for check in artifact["checks"]],
            [
                "projection_default_cases",
                "intent_service_guide_cases",
                "supervisor_go_service_guide_tests",
                "campus_services_agent_contract_tests",
                "app_api_service_guide_structured_answer_tests",
            ],
        )
        self.assertIn(
            (
                "go",
                "test",
                "./internal/structuredquery",
                "./internal/structuredplanning",
                "./internal/runtimepolicy",
                "./internal/httpapi",
                "-run",
                "ServiceGuide|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz",
            ),
            commands,
        )
        self.assertIn(
            (
                "python",
                "-m",
                "unittest",
                "tests.agent.test_campus_services_agent",
            ),
            commands,
        )
        self.assertIn(
            (
                "pnpm",
                "--dir",
                "apps/app-api",
                "exec",
                "vitest",
                "run",
                "-c",
                "vitest.node.config.mts",
                "test/chat-command.service.core.structured.test.ts",
                "-t",
                "renders campus-services answers from structured tool facts and safe source categories",
            ),
            commands,
        )

    def test_release_gate_can_include_selected_write_runtime_smoke(self) -> None:
        commands: list[tuple[str, ...]] = []
        runtime_smoke_output_dirs: list[Path] = []

        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            commands.append(command)
            return CommandResult(returncode=0, stdout="ok", stderr="")

        def fake_intent_runner(_cases) -> IntentEvalReport:
            return IntentEvalReport(
                total=2,
                passed=2,
                failed=0,
                overall_exact_match_rate=1.0,
                critical_total=2,
                critical_passed=2,
                critical_gate_pass_rate=1.0,
                confusion={},
                results=(),
            )

        def fake_runtime_smoke_runner(output_dir: Path) -> dict[str, object]:
            runtime_smoke_output_dirs.append(output_dir)
            return {
                "passed": True,
                "projection": {
                    "release_id": "owrelease_selected_write_123",
                    "service_guide_records": 2,
                    "conflict_records": 0,
                    "manual_review_sources": 0,
                },
                "probes": {
                    "failed_probe_ids": [],
                    "service_guide_queries": [{"probe_id": "procedure_current"}],
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            report = run_service_guide_lookup_release_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
                include_runtime_smoke=True,
                runtime_smoke_runner=fake_runtime_smoke_runner,
            )
            artifact = json.loads(
                (output_dir / "service-guide-lookup-release-gate.json").read_text(encoding="utf-8")
            )

        self.assertTrue(report.passed)
        self.assertEqual(
            [check["check_id"] for check in artifact["checks"]],
            [
                "projection_default_cases",
                "intent_service_guide_cases",
                "supervisor_go_service_guide_tests",
                "campus_services_agent_contract_tests",
                "app_api_service_guide_structured_answer_tests",
                "selected_write_runtime_smoke",
            ],
        )
        self.assertEqual(
            runtime_smoke_output_dirs,
            [output_dir / "selected-write-runtime-smoke"],
        )
        smoke_check = artifact["checks"][-1]
        self.assertEqual(smoke_check["summary"]["release_id"], "owrelease_selected_write_123")
        self.assertEqual(smoke_check["summary"]["service_guide_records"], 2)

    def test_release_gate_fails_when_selected_write_runtime_smoke_fails(self) -> None:
        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            return CommandResult(returncode=0, stdout="ok", stderr="")

        def fake_intent_runner(_cases) -> IntentEvalReport:
            return IntentEvalReport(
                total=1,
                passed=1,
                failed=0,
                overall_exact_match_rate=1.0,
                critical_total=1,
                critical_passed=1,
                critical_gate_pass_rate=1.0,
                confusion={},
                results=(),
            )

        def fake_runtime_smoke_runner(output_dir: Path) -> dict[str, object]:
            return {
                "passed": False,
                "projection": {"release_id": "owrelease_selected_write_123"},
                "probes": {"failed_probe_ids": ["phone_missing_fail_close"]},
            }

        with TemporaryDirectory() as temp_dir:
            report = run_service_guide_lookup_release_gate(
                output_dir=Path(temp_dir),
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
                include_runtime_smoke=True,
                runtime_smoke_runner=fake_runtime_smoke_runner,
            )

        self.assertFalse(report.passed)
        failed_checks = [check for check in report.checks if not check.passed]
        self.assertEqual(len(failed_checks), 1)
        self.assertEqual(failed_checks[0].check_id, "selected_write_runtime_smoke")

    def test_release_gate_fails_when_a_subcheck_fails(self) -> None:
        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            if command[0] == "go":
                return CommandResult(returncode=1, stdout="", stderr="service guide failed")
            return CommandResult(returncode=0, stdout="ok", stderr="")

        def fake_intent_runner(_cases) -> IntentEvalReport:
            return IntentEvalReport(
                total=1,
                passed=1,
                failed=0,
                overall_exact_match_rate=1.0,
                critical_total=1,
                critical_passed=1,
                critical_gate_pass_rate=1.0,
                confusion={},
                results=(),
            )

        with TemporaryDirectory() as temp_dir:
            report = run_service_guide_lookup_release_gate(
                output_dir=Path(temp_dir),
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
            )

        self.assertFalse(report.passed)
        failed_checks = [check for check in report.checks if not check.passed]
        self.assertEqual(len(failed_checks), 1)
        self.assertEqual(failed_checks[0].check_id, "supervisor_go_service_guide_tests")


if __name__ == "__main__":
    unittest.main()
