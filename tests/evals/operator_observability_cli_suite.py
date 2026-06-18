from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_evals.operator_observability import (
    build_profile_report_publish_batch,
    main,
    publish_case_results_artifact,
)


class OperatorObservabilityCliTest(unittest.TestCase):
    def test_publish_case_results_artifact_dry_run_includes_deterministic_policy_metrics(
        self,
    ) -> None:
        case_results_payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "request_correlation": {
                        "case_id": "case-1",
                        "request_id": "req_01",
                        "trace_id": "trace_01",
                        "sampled_at": "2026-04-03T00:10:00.000Z",
                    },
                    "metric_results": {
                        "unsupported_abstention_accuracy": {
                            "passed": True,
                            "reason": "ok",
                        },
                    },
                    "supplemental_results": [],
                }
            ]
        }

        with TemporaryDirectory() as tmpdir:
            case_results_path = Path(tmpdir) / "run-01-case-results.json"
            case_results_path.write_text(json.dumps(case_results_payload), encoding="utf-8")

            summary = publish_case_results_artifact(
                case_results_path=case_results_path,
                request_correlations_path=None,
                grade_source="deterministic_eval",
                grader_version="deterministic@2026-04-06",
                dry_run=True,
            )

        self.assertEqual(summary["grade_count"], 1)
        self.assertEqual(summary["skipped"], [])

    def test_publish_case_results_artifact_dry_run_uses_inline_request_correlation_when_manifest_omitted(
        self,
    ) -> None:
        case_results_payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "request_correlation": {
                        "case_id": "case-1",
                        "request_id": "req_01",
                        "trace_id": "trace_01",
                        "sampled_at": "2026-04-03T00:10:00.000Z",
                        "trace_link": "https://sentry.example/traces/trace_01",
                    },
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "faithfulness",
                            "score": 0.91,
                            "verdict": "passed",
                            "rationale": "grounded",
                            "metadata": {"case_id": "case-1"},
                        }
                    ],
                }
            ]
        }

        with TemporaryDirectory() as tmpdir:
            case_results_path = Path(tmpdir) / "run-01-case-results.json"
            case_results_path.write_text(json.dumps(case_results_payload), encoding="utf-8")

            summary = publish_case_results_artifact(
                case_results_path=case_results_path,
                request_correlations_path=None,
                grade_source="openai_trace_grader",
                grader_version="grader@2026-04-03",
                dry_run=True,
            )

        self.assertIsNone(summary["request_correlations_path"])
        self.assertEqual(summary["grade_count"], 1)
        self.assertEqual(summary["backlink_count"], 1)
        self.assertEqual(summary["accepted_grades"], 0)
        self.assertEqual(summary["accepted_backlinks"], 0)
        self.assertEqual(summary["skipped"], [])

    def test_publish_case_results_artifact_dry_run_renders_publishable_summary(self) -> None:
        case_results_payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "faithfulness",
                            "score": 0.91,
                            "verdict": "passed",
                            "rationale": "grounded",
                            "metadata": {"case_id": "case-1"},
                        }
                    ],
                }
            ]
        }
        request_correlations_payload = {
            "schema_version": 1,
            "cases": [
                {
                    "case_id": "case-1",
                    "request_id": "req_01",
                    "trace_id": "trace_01",
                    "sampled_at": "2026-04-03T00:10:00.000Z",
                    "trace_link": "https://sentry.example/traces/trace_01",
                }
            ],
        }

        with TemporaryDirectory() as tmpdir:
            case_results_path = Path(tmpdir) / "run-01-case-results.json"
            request_correlations_path = Path(tmpdir) / "request-correlations.json"
            case_results_path.write_text(json.dumps(case_results_payload), encoding="utf-8")
            request_correlations_path.write_text(
                json.dumps(request_correlations_payload),
                encoding="utf-8",
            )

            summary = publish_case_results_artifact(
                case_results_path=case_results_path,
                request_correlations_path=request_correlations_path,
                grade_source="openai_trace_grader",
                grader_version="grader@2026-04-03",
                dry_run=True,
            )

        self.assertEqual(summary["grade_count"], 1)
        self.assertEqual(summary["backlink_count"], 1)
        self.assertEqual(summary["accepted_grades"], 0)
        self.assertEqual(summary["accepted_backlinks"], 0)
        self.assertEqual(summary["skipped"], [])

    def test_main_supports_metric_domain_override_in_dry_run_mode(self) -> None:
        case_results_payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "supplemental_results": [
                        {
                            "adapter_id": "judge",
                            "metric_name": "refusal_quality",
                            "score": 0.25,
                            "verdict": "failed",
                            "rationale": "policy refusal mismatch",
                            "metadata": {"case_id": "case-1"},
                        }
                    ],
                }
            ]
        }
        request_correlations_payload = {
            "schema_version": 1,
            "cases": [
                {
                    "case_id": "case-1",
                    "request_id": "req_01",
                    "trace_id": "trace_01",
                    "sampled_at": "2026-04-03T00:10:00.000Z",
                }
            ],
        }

        with TemporaryDirectory() as tmpdir:
            case_results_path = Path(tmpdir) / "run-01-case-results.json"
            request_correlations_path = Path(tmpdir) / "request-correlations.json"
            case_results_path.write_text(json.dumps(case_results_payload), encoding="utf-8")
            request_correlations_path.write_text(
                json.dumps(request_correlations_payload),
                encoding="utf-8",
            )

            with patch("builtins.print") as print_mock:
                exit_code = main(
                    [
                        "--case-results",
                        str(case_results_path),
                        "--request-correlations",
                        str(request_correlations_path),
                        "--grade-source",
                        "judge_runtime",
                        "--grader-version",
                        "judge@2026-04-03",
                        "--metric-domain-override",
                        "judge.refusal_quality=policy",
                        "--dry-run",
                        "--format",
                        "json",
                    ]
                )

        self.assertEqual(exit_code, 0)
        printed_summary = json.loads(print_mock.call_args.args[0])
        self.assertEqual(printed_summary["grade_count"], 1)
        self.assertEqual(printed_summary["backlink_count"], 0)
        self.assertEqual(printed_summary["skipped"], [])

    def test_main_supports_inline_request_correlation_without_manifest(self) -> None:
        case_results_payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "request_correlation": {
                        "case_id": "case-1",
                        "request_id": "req_01",
                        "trace_id": "trace_01",
                        "sampled_at": "2026-04-03T00:10:00.000Z",
                        "trace_link": "https://sentry.example/traces/trace_01",
                    },
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "faithfulness",
                            "score": 0.91,
                            "verdict": "passed",
                            "rationale": "grounded",
                            "metadata": {"case_id": "case-1"},
                        }
                    ],
                }
            ]
        }

        with TemporaryDirectory() as tmpdir:
            case_results_path = Path(tmpdir) / "run-01-case-results.json"
            case_results_path.write_text(json.dumps(case_results_payload), encoding="utf-8")

            with patch("builtins.print") as print_mock:
                exit_code = main(
                    [
                        "--case-results",
                        str(case_results_path),
                        "--grade-source",
                        "openai_trace_grader",
                        "--grader-version",
                        "grader@2026-04-03",
                        "--dry-run",
                        "--format",
                        "json",
                    ]
                )

        self.assertEqual(exit_code, 0)
        printed_summary = json.loads(print_mock.call_args.args[0])
        self.assertIsNone(printed_summary["request_correlations_path"])
        self.assertEqual(printed_summary["grade_count"], 1)
        self.assertEqual(printed_summary["backlink_count"], 1)
        self.assertEqual(printed_summary["skipped"], [])

    def test_build_profile_report_publish_batch_skips_uncorrelated_results(self) -> None:
        profile_report_payload = {
            "schema_version": "eval_profile_gate.v1",
            "profile_id": "online_answer_path",
            "sanitized_results": [
                {
                    "case_id": "case-1",
                    "passed": False,
                    "reason": "selected capability mismatch",
                    "request_correlation": {
                        "case_id": "case-1",
                        "request_id": "req_01",
                        "trace_id": "trace_01",
                        "sampled_at": "2026-04-29T00:00:00+00:00",
                        "trace_link": "https://traces.example/trace_01",
                    },
                },
                {
                    "case_id": "case-2",
                    "passed": True,
                    "reason": "ok",
                },
            ],
        }

        batch = build_profile_report_publish_batch(
            profile_report_payload=profile_report_payload,
            grade_source="eval_profile_gate",
            grader_version="profile@2026-04-29",
        )

        self.assertEqual(len(batch.grades), 1)
        self.assertEqual(batch.grades[0].request_id, "req_01")
        self.assertEqual(batch.grades[0].verdict, "fail")
        self.assertEqual(len(batch.backlinks), 1)
        self.assertEqual(len(batch.skipped), 1)
        self.assertEqual(batch.skipped[0].case_id, "case-2")
        self.assertEqual(batch.skipped[0].reason, "missing_request_correlation")
