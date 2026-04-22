from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

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

    def test_run_eval_acceptance_builds_official_web_profile_args(self) -> None:
        seen_argv: list[str] = []

        def fake_runner(argv: list[str]) -> int:
            nonlocal seen_argv
            seen_argv = list(argv)
            return 0

        with patch("scripts.eval_gate._resolve_profile_runner", return_value=fake_runner):
            summary = run_eval_acceptance(
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
                "--publish-operator-observability",
                "--publish-operator-observability-dry-run",
                "--publish-grade-source",
                "eval_release_gate",
                "--publish-grader-version",
                "grader@2026-04-23",
                "--publish-request-correlations",
                "/tmp/request-correlations.json",
                "--publish-metric-domain-override",
                "judge.answer_correctness_rubric=grounding",
                "--official-web-scope",
                "stable_reference",
                "--qdrant-collection-name",
                "official_web_stable_reference__r20260404_204033",
            ],
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


if __name__ == "__main__":
    unittest.main()
