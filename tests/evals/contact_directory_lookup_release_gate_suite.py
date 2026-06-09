from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.contact_directory_lookup_release_gate import (
    CommandResult,
    contact_directory_lookup_intent_gate_cases,
    run_contact_directory_lookup_release_gate,
)
from campus_evals.intent_models import IntentEvalReport
from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
)


class ContactDirectoryLookupReleaseGateTest(unittest.TestCase):
    def test_intent_case_subset_covers_contact_directory_lookup_and_action_guardrails(
        self,
    ) -> None:
        cases = contact_directory_lookup_intent_gate_cases()

        self.assertGreaterEqual(len(cases), 6)
        self.assertTrue(
            any(case.expected_allowed_tools == ("contact_directory_lookup",) for case in cases)
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
            report = run_contact_directory_lookup_release_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
            )
            artifact = json.loads(
                (output_dir / "contact-directory-lookup-release-gate.json").read_text(
                    encoding="utf-8"
                )
            )

        self.assertTrue(report.passed)
        self.assertEqual(artifact["gate_id"], "contact_directory_lookup")
        self.assertEqual(
            [check["check_id"] for check in artifact["checks"]],
            [
                "projection_default_cases",
                "intent_contact_directory_cases",
                "supervisor_go_contact_directory_tests",
                "campus_services_capability_contract_tests",
                "app_api_contact_directory_structured_answer_tests",
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
                "ContactDirectory|StructuredPlan|AllowedTools|StructuredAnswerText|Readyz",
            ),
            commands,
        )
        self.assertIn(
            (
                "python",
                "-m",
                "unittest",
                "tests.agent.test_campus_services_capability",
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
                "test/chat-command.service.test.ts",
            ),
            commands,
        )

    def test_release_gate_fails_when_a_subcheck_fails(self) -> None:
        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
            if command[0] == "go":
                return CommandResult(returncode=1, stdout="", stderr="contact directory failed")
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
            report = run_contact_directory_lookup_release_gate(
                output_dir=Path(temp_dir),
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
            )

        self.assertFalse(report.passed)
        failed_checks = [check for check in report.checks if not check.passed]
        self.assertEqual(len(failed_checks), 1)
        self.assertEqual(failed_checks[0].check_id, "supervisor_go_contact_directory_tests")

    def test_release_gate_can_include_selected_write_preview_tool_readiness_audit(self) -> None:
        def fake_command_runner(
            command: tuple[str, ...],
            *,
            cwd: Path | None = None,
        ) -> CommandResult:
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

        preview_report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_contact",
                    "collection": "contact_directory",
                    "inventory_id": "muc-information-disclosure-contact",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": ["中央民族大学信息公开联系方式"],
                    "full_impact_display_names": ["中央民族大学", "中央民族大学信息公开联系方式"],
                    "bundle": {
                        "contact_records": [
                            {
                                "display_name": "中央民族大学信息公开联系方式",
                                "phones": [{"number": "010-68932551"}],
                                "aliases": ["中央民族大学信息公开联系方式", "联系方式"],
                                "source_refs": ["https://xxgk.muc.edu.cn/xxgk/xxgksx.htm"],
                                "field_status": {
                                    "organization_name": "present",
                                    "phone": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
                                "extraction_status": "ready",
                            }
                        ]
                    },
                }
            ],
        }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            preview_report_path = Path(temp_dir) / "preview-report.json"
            preview_report_path.write_text(
                json.dumps(preview_report, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            runtime_runner_calls: list[tuple[Path, Path, str]] = []
            report = run_contact_directory_lookup_release_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
                selected_write_preview_report_path=preview_report_path,
                selected_write_preview_runtime_runner=lambda *, report_path, output_dir, bundle_scope: (
                    runtime_runner_calls.append((report_path, output_dir, bundle_scope))
                    or OfficialWebSelectedWritePreviewRuntimeVerificationReport(
                        passed=True,
                        output_path=output_dir / "runtime.json",
                        summary={
                            "bundle_scope": bundle_scope,
                            "total_cases": 1,
                            "passed_cases": 1,
                            "failed_cases": 0,
                            "uncovered_supported_targets": [],
                        },
                        case_results=(),
                    )
                ),
            )
            artifact = json.loads(
                (output_dir / "contact-directory-lookup-release-gate.json").read_text(
                    encoding="utf-8"
                )
            )

        self.assertTrue(report.passed)
        self.assertEqual(
            artifact["checks"][-3]["check_id"],
            "selected_write_preview_tool_readiness",
        )
        self.assertEqual(artifact["checks"][-3]["summary"]["record_count"], 1)
        self.assertEqual(
            artifact["checks"][-1]["check_id"],
            "selected_write_preview_runtime_verification_full_impact",
        )
        self.assertEqual(artifact["checks"][-1]["summary"]["total_cases"], 1)
        self.assertEqual(
            artifact["checks"][-1]["summary"]["bundle_scope"],
            "full_impact",
        )
        self.assertEqual(
            artifact["checks"][-2]["check_id"],
            "selected_write_preview_runtime_verification_task_scope",
        )
        self.assertEqual(
            artifact["checks"][-2]["summary"]["bundle_scope"],
            "task_scope",
        )
        self.assertEqual(
            runtime_runner_calls,
            [
                (
                    preview_report_path,
                    output_dir / "selected-write-preview-runtime-verification",
                    "task_scope",
                ),
                (
                    preview_report_path,
                    output_dir / "selected-write-preview-runtime-verification-full-impact",
                    "full_impact",
                ),
            ],
        )


if __name__ == "__main__":
    unittest.main()
