from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.eval_gate import collect_eval_gate_status, main, run_eval_acceptance


class EvalGateTest(unittest.TestCase):
    def test_collect_eval_gate_status_can_include_worker_secret_presence(self) -> None:
        repo_root = Path("/tmp/campus-agent")
        with (
            patch(
                "scripts.eval_gate.collect_env_doctor_status",
                return_value={"overall_ready": True, "surface": "evals"},
            ) as doctor,
            patch(
                "scripts.eval_gate.collect_worker_secret_presence",
                return_value={"overall_ready": False, "env": "staging"},
            ) as secrets,
        ):
            status = collect_eval_gate_status(
                repo_root=repo_root,
                include_worker_secret_presence=True,
                worker_env="staging",
                worker_apps=("apps/app-api",),
            )

        doctor.assert_called_once_with(repo_root=repo_root, surface="evals")
        secrets.assert_called_once_with(
            repo_root=repo_root,
            env_name="staging",
            app_paths=("apps/app-api",),
        )
        self.assertFalse(status["overall_ready"])
        self.assertEqual(status["env_doctor"]["surface"], "evals")
        self.assertEqual(status["worker_secret_presence"]["env"], "staging")

    def test_run_eval_acceptance_rejects_removed_official_web_profile(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
            run_eval_acceptance(
                profile="official-web-stable-reference",
                output_dir=Path("/tmp/eval-artifacts"),
                reruns=1,
                verbose=True,
                log_jsonl=Path("/tmp/runtime-events.jsonl"),
                qdrant_collection_name="official_web_stable_reference__r20260404_204033",
                publish_dry_run=True,
                publish_grade_source="eval_release_gate",
                publish_grader_version="grader@2026-04-23",
                publish_request_correlations=Path("/tmp/request-correlations.json"),
                publish_metric_domain_overrides=("judge.answer_correctness_rubric=grounding",),
            )

    def test_run_eval_acceptance_builds_profile_publish_args(self) -> None:
        seen_argv: list[str] = []

        def fake_runner(argv: list[str]) -> int:
            nonlocal seen_argv
            seen_argv = list(argv)
            return 0

        with patch("scripts.eval_gate._resolve_profile_runner", return_value=fake_runner):
            summary = run_eval_acceptance(
                profile="online-answer-path",
                output_dir=Path("/tmp/eval-artifacts"),
                reruns=1,
                verbose=True,
                log_jsonl=Path("/tmp/runtime-events.jsonl"),
                cases_path=Path("/tmp/cases.json"),
                observations_path=Path("/tmp/observations.json"),
                collect_runtime=True,
            )

        self.assertEqual(summary["exit_code"], 0)
        self.assertEqual(summary["output_dir"], "/tmp/eval-artifacts")
        self.assertEqual(
            seen_argv,
            [
                "accept",
                "--output-dir",
                "/tmp/eval-artifacts",
                "--reruns",
                "1",
                "--verbose",
                "--log-jsonl",
                "/tmp/runtime-events.jsonl",
                "--cases-path",
                "/tmp/cases.json",
                "--observations-path",
                "/tmp/observations.json",
                "--collect-runtime",
            ],
        )

    def test_run_eval_acceptance_builds_observation_profile_args(self) -> None:
        seen_argv: list[str] = []

        def fake_runner(argv: list[str]) -> int:
            nonlocal seen_argv
            seen_argv = list(argv)
            return 0

        with patch("scripts.eval_gate._resolve_profile_runner", return_value=fake_runner):
            summary = run_eval_acceptance(
                profile="online-answer-path",
                output_dir=Path("/tmp/eval-artifacts"),
                reruns=1,
                cases_path=Path("/tmp/cases.json"),
                observations_path=Path("/tmp/observations.json"),
                collect_runtime=True,
            )

        self.assertEqual(summary["exit_code"], 0)
        self.assertEqual(
            seen_argv,
            [
                "accept",
                "--output-dir",
                "/tmp/eval-artifacts",
                "--reruns",
                "1",
                "--cases-path",
                "/tmp/cases.json",
                "--observations-path",
                "/tmp/observations.json",
                "--collect-runtime",
            ],
        )

    def test_run_eval_acceptance_rejects_collect_runtime_for_observation_only_profile(
        self,
    ) -> None:
        runner = Mock(return_value=0)

        with (
            patch("scripts.eval_gate._resolve_profile_runner", return_value=runner),
            self.assertRaisesRegex(ValueError, "does not support runtime collection"),
        ):
            run_eval_acceptance(
                profile="tool-routing-product-path",
                output_dir=Path("/tmp/eval-artifacts"),
                collect_runtime=True,
            )

        runner.assert_not_called()

    def test_observation_profiles_do_not_support_operator_publish_dry_run(self) -> None:
        with (
            patch("scripts.eval_gate._resolve_profile_runner", return_value=lambda _: 0),
            self.assertRaisesRegex(ValueError, "does not produce live case-results"),
        ):
            run_eval_acceptance(
                profile="tool-denominator",
                output_dir=Path("/tmp/eval-artifacts"),
                publish_dry_run=True,
                publish_grade_source="eval_release_gate",
                publish_grader_version="grader@2026-04-29",
            )

    def test_official_web_fresh_news_is_not_eval_gate_profile(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
            run_eval_acceptance(
                profile="official-web-fresh-news",
                output_dir=Path("/tmp/eval-artifacts"),
                qdrant_collection_name="official_web_fresh_news__r20260404_222909",
            )

    def test_all_observation_profiles_are_registered(self) -> None:
        profiles = (
            "online-answer-path",
            "tool-denominator",
            "tool-routing-product-path",
            "document-quality",
            "authz-privacy",
            "agentic-retrieval-plan",
            "answer-quality-contract",
            "hindsight-memory-product-path",
            "eval-operations-governance",
            "quality-calibration",
        )

        with patch("scripts.eval_gate._resolve_profile_runner", return_value=lambda _: 0):
            summaries = [
                run_eval_acceptance(profile=profile, output_dir=Path("/tmp/eval-artifacts"))
                for profile in profiles
            ]

        self.assertEqual([summary["exit_code"] for summary in summaries], [0] * len(profiles))

    def test_tool_runtime_contract_deprecated_alias_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
            run_eval_acceptance(
                profile="multi-agent-product-path",
                output_dir=Path("/tmp/multi-agent-product-path"),
            )

    def test_personal_memory_extraction_profile_is_retired(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported eval profile"):
            run_eval_acceptance(
                profile="personal-memory-extraction",
                output_dir=Path("/tmp/personal-memory-extraction"),
            )

    def test_main_publish_defaults_to_dry_run_json_output(self) -> None:
        buffer = io.StringIO()
        with (
            patch(
                "scripts.eval_gate.publish_case_results_artifact",
                return_value={
                    "case_results_path": "/tmp/case-results.json",
                    "request_correlations_path": None,
                    "grade_source": "eval_release_gate",
                    "grader_version": "grader@2026-04-23",
                    "dry_run": True,
                    "grade_count": 1,
                    "backlink_count": 1,
                    "accepted_grades": 0,
                    "accepted_backlinks": 0,
                    "skipped": [],
                },
            ) as publish,
            redirect_stdout(buffer),
        ):
            exit_code = main(
                [
                    "publish",
                    "--case-results",
                    "/tmp/case-results.json",
                    "--grade-source",
                    "eval_release_gate",
                    "--grader-version",
                    "grader@2026-04-23",
                    "--json",
                ]
            )

        payload = json.loads(buffer.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertTrue(payload["dry_run"])
        publish.assert_called_once_with(
            case_results_path=Path("/tmp/case-results.json"),
            request_correlations_path=None,
            grade_source="eval_release_gate",
            grader_version="grader@2026-04-23",
            metric_domain_overrides=None,
            dry_run=True,
        )

    def test_main_publish_profile_uses_profile_report_artifact(self) -> None:
        buffer = io.StringIO()
        with (
            patch(
                "scripts.eval_gate.publish_profile_report_artifact",
                return_value={
                    "profile_report_path": "/tmp/profile-report.json",
                    "grade_source": "eval_profile_gate",
                    "grader_version": "profile@2026-04-29",
                    "dry_run": True,
                    "grade_count": 1,
                    "backlink_count": 1,
                    "accepted_grades": 0,
                    "accepted_backlinks": 0,
                    "skipped": [
                        {
                            "case_id": "case-2",
                            "metric_key": "profile.online_answer_path",
                            "reason": "missing_request_correlation",
                        }
                    ],
                },
            ) as publish,
            redirect_stdout(buffer),
        ):
            exit_code = main(
                [
                    "publish-profile",
                    "--profile-report",
                    "/tmp/profile-report.json",
                    "--grade-source",
                    "eval_profile_gate",
                    "--grader-version",
                    "profile@2026-04-29",
                    "--dry-run",
                    "--json",
                ]
            )

        payload = json.loads(buffer.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["grade_count"], 1)
        self.assertEqual(payload["skipped"][0]["reason"], "missing_request_correlation")
        publish.assert_called_once_with(
            profile_report_path=Path("/tmp/profile-report.json"),
            grade_source="eval_profile_gate",
            grader_version="profile@2026-04-29",
            dry_run=True,
        )

    def test_audit_includes_rag_retrieval_quality_gate(self) -> None:
        from scripts.eval_gate import audit_eval_gate_configuration

        with (
            patch("scripts.eval_gate._audit_profile_registry_runners", return_value=_pass("a")),
            patch("scripts.eval_gate._audit_workflow_dispatch_choices", return_value=_pass("b")),
            patch(
                "scripts.eval_gate._audit_workflow_contract_generation_check",
                return_value=_pass("c"),
            ),
            patch("scripts.eval_gate._audit_operations_policy_coverage", return_value=_pass("d")),
            patch(
                "scripts.eval_gate._audit_denominator_registry_coverage", return_value=_pass("e")
            ),
            patch("scripts.eval_gate._audit_rag_eval_coverage", return_value=_pass("f")),
            patch(
                "scripts.eval_gate._audit_rag_retrieval_quality_gate",
                return_value={
                    "check_id": "rag_retrieval_quality_gate",
                    "passed": False,
                    "gaps": ["regulations/student_rules:doc_recall_at_5_below_threshold"],
                },
            ),
            patch(
                "scripts.eval_gate._audit_tool_denominator_fixture_coverage",
                return_value=_pass("g"),
            ),
            patch("scripts.eval_gate._audit_profile_fixture_smoke", return_value=_pass("h")),
        ):
            report = audit_eval_gate_configuration(repo_root=Path("/tmp/campus-agent"))

        checks = {check["check_id"]: check for check in report["checks"]}
        self.assertFalse(report["passed"])
        self.assertIn("rag_retrieval_quality_gate", checks)
        self.assertEqual(
            checks["rag_retrieval_quality_gate"]["gaps"],
            ["regulations/student_rules:doc_recall_at_5_below_threshold"],
        )


def _pass(check_id: str) -> dict[str, object]:
    return {"check_id": check_id, "passed": True}


if __name__ == "__main__":
    unittest.main()
