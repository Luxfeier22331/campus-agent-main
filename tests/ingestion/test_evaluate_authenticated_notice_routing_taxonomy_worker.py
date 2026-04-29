from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.evaluate_authenticated_notice_routing_taxonomy"
)


class EvaluateAuthenticatedNoticeRoutingTaxonomyWorkerCliTest(unittest.TestCase):
    def test_default_fixture_lives_under_internal_notice_config(self) -> None:
        root = Path(__file__).resolve().parents[2]

        self.assertEqual(
            worker.DEFAULT_AUTHENTICATED_NOTICE_ROUTING_TAXONOMY_EVAL_PATH.relative_to(
                root
            ).as_posix(),
            "configs/ingestion/campus_notices/internal_notice/routing-taxonomy-eval.v1.jsonl",
        )

    def test_main_prints_json_report_for_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "routing-taxonomy-eval.jsonl"
            fixture_path.write_text(
                json.dumps(
                    {
                        "case_id": "course-selection",
                        "notice_id": "354192",
                        "title": "关于2025-2026学年第二学期本科生网上选课的通知",
                        "notice_type_name": "教学通知",
                        "expected_notice_family": "course_teaching_arrangement",
                        "expected_consumption_route": "notice_level_query",
                        "expected_machine_processing_policy": "not_required",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch("sys.stdout", new_callable=io.StringIO) as stdout:
                exit_code = worker.main(
                    [
                        "--fixture-path",
                        str(fixture_path),
                        "--min-accuracy",
                        "1.0",
                        "--fail-on-error",
                    ]
                )

        self.assertEqual(exit_code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["case_count"], 1)
        self.assertEqual(payload["passed_count"], 1)

    def test_repo_owned_default_fixture_passes_cli_gate(self) -> None:
        self.assertTrue(worker.DEFAULT_AUTHENTICATED_NOTICE_ROUTING_TAXONOMY_EVAL_PATH.exists())

        with patch("sys.stdout", new_callable=io.StringIO) as stdout:
            exit_code = worker.main(["--fail-on-error"])

        self.assertEqual(exit_code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["ok"])
        self.assertGreaterEqual(payload["case_count"], 16)

    def test_fail_on_error_returns_nonzero_when_threshold_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "routing-taxonomy-eval.jsonl"
            fixture_path.write_text(
                json.dumps(
                    {
                        "case_id": "wrong-family",
                        "notice_id": "355546",
                        "title": "讲座预告丨舞蹈学院名家讲堂",
                        "notice_type_name": "科研通知",
                        "expected_notice_family": "course_teaching_arrangement",
                        "expected_consumption_route": "notice_level_query",
                        "expected_machine_processing_policy": "not_required",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with patch("sys.stdout", new_callable=io.StringIO) as stdout:
                exit_code = worker.main(
                    [
                        "--fixture-path",
                        str(fixture_path),
                        "--min-accuracy",
                        "1.0",
                        "--fail-on-error",
                    ]
                )

        self.assertEqual(exit_code, 1)
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["failed_case_ids"], ["wrong-family"])


if __name__ == "__main__":
    unittest.main()
