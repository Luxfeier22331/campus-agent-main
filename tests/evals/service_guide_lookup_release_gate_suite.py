from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.intent_models import IntentEvalReport
from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    OfficialWebSelectedWritePreviewRuntimeVerificationReport,
)
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
                "test/chat-command.service.test.ts",
                "-t",
                "renders campus-services answers from structured tool facts and safe source categories",
            ),
            commands,
        )

    def test_release_gate_artifact_reports_question_matrix_coverage(self) -> None:
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

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "gate"
            run_service_guide_lookup_release_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
            )
            artifact = json.loads(
                (output_dir / "service-guide-lookup-release-gate.json").read_text(encoding="utf-8")
            )

        coverage = artifact["coverage"]
        self.assertEqual(
            coverage["coverage_sources"],
            {
                "deterministic_matrix": "QUESTION-MATRIX.md",
                "representative_public_chat_subset": (
                    "packages/evals/fixtures/public_chat_entry_cases.v1.json"
                ),
            },
        )
        self.assertEqual(coverage["matrix"]["total_cases"], 33)
        self.assertEqual(coverage["matrix"]["positive_service_guide_cases"], 20)
        self.assertEqual(coverage["matrix"]["boundary_cases"], 7)
        self.assertEqual(coverage["matrix"]["fail_close_cases"], 6)
        self.assertEqual(
            coverage["matrix"]["focus_counts"],
            {
                "contact": 3,
                "eligibility": 2,
                "entry": 5,
                "full_guide": 1,
                "office_hours": 2,
                "procedure": 4,
                "required_materials": 3,
            },
        )
        self.assertEqual(
            coverage["public_chat_subset"]["case_ids"],
            [
                "public-entry-campus-card-loss-guide",
                "public-entry-academic-calendar-guide-entry",
                "public-entry-public-medical-materials",
                "public-entry-vpn-login-entry",
            ],
        )
        self.assertEqual(
            coverage["public_chat_subset"]["matrix_case_ids"],
            [
                "sg-procedure-campus-card-loss",
                "sg-entry-calendar-url",
                "sg-materials-medical-reimbursement",
                "sg-entry-vpn-login",
            ],
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
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-it-vpn-service-guide",
                    "record_count": 1,
                    "full_record_count": 3,
                    "task_scope_display_names": ["中央民族大学 VPN 使用说明"],
                    "full_impact_display_names": ["学生校园卡服务", "中央民族大学 VPN 使用说明"],
                    "bundle": {
                        "service_guide_records": [
                            {
                                "display_name": "中央民族大学 VPN 使用说明",
                                "guide_sections": [{"section_type": "procedure"}],
                                "procedure_groups": [
                                    {
                                        "group_id": "service:official_web:vpn:procedure_group:client_install",
                                        "source_refs": ["https://met.muc.edu.cn/info/1027/1137.htm"],
                                        "steps": [
                                            {
                                                "content": "首次使用请根据系统提示下载客户端。",
                                                "source_refs": [
                                                    "https://met.muc.edu.cn/info/1027/1137.htm"
                                                ],
                                            }
                                        ],
                                    }
                                ],
                                "entry_refs": [{"label": "中央民族大学VPN系统"}],
                                "source_refs": ["https://met.muc.edu.cn/info/1027/1137.htm"],
                                "field_status": {
                                    "service_name": "present",
                                    "process_steps": "present",
                                    "service_entry": "present",
                                    "source_url": "present",
                                    "source_version_evidence": "present",
                                },
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
            report = run_service_guide_lookup_release_gate(
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
                (output_dir / "service-guide-lookup-release-gate.json").read_text(encoding="utf-8")
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
        self.assertIn("failed_cases", artifact["checks"][-2]["summary"])
        self.assertIn("passed_cases", artifact["checks"][-2]["summary"])
        self.assertIn("runtime_output_path", artifact["checks"][-2]["summary"])
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

    def test_release_gate_propagates_preview_runtime_verifier_failures(self) -> None:
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

        preview_report = {
            "schema_version": "official_web_selected_write_preview_report.v1",
            "results": [
                {
                    "selected_write_id": "owrelease_selected_write_service",
                    "collection": "service_guide",
                    "inventory_id": "muc-it-vpn-service-guide",
                    "record_count": 1,
                    "full_record_count": 1,
                    "task_scope_display_names": ["中央民族大学 VPN 使用说明"],
                    "full_impact_display_names": ["中央民族大学 VPN 使用说明"],
                    "bundle": {"service_guide_records": [{"display_name": "中央民族大学 VPN 使用说明"}]},
                    "full_bundle": {
                        "service_guide_records": [{"display_name": "中央民族大学 VPN 使用说明"}]
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
            report = run_service_guide_lookup_release_gate(
                output_dir=output_dir,
                command_runner=fake_command_runner,
                intent_runner=fake_intent_runner,
                selected_write_preview_report_path=preview_report_path,
                selected_write_preview_runtime_runner=lambda *, report_path, output_dir, bundle_scope: (
                    OfficialWebSelectedWritePreviewRuntimeVerificationReport(
                        passed=False,
                        output_path=output_dir / "runtime.json",
                        summary={
                            "bundle_scope": bundle_scope,
                            "total_cases": 1,
                            "passed_cases": 0,
                            "failed_cases": 1,
                            "failed_case_ids": ["service-guide-vpn-entry"],
                            "uncovered_supported_targets": [],
                        },
                        case_results=(),
                    )
                ),
            )

        self.assertFalse(report.passed)
        failing_ids = [check.check_id for check in report.checks if not check.passed]
        self.assertIn("selected_write_preview_runtime_verification_task_scope", failing_ids)
        self.assertIn("selected_write_preview_runtime_verification_full_impact", failing_ids)

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
                "probes": {"failed_probe_ids": ["phone_current"]},
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
