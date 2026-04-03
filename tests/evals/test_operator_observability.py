from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import httpx

from campus_evals.operator_observability import (
    OperatorObservabilityClient,
    OperatorObservabilityClientError,
    OperatorObservabilityClientSettings,
    OperatorQualityGrade,
    OperatorRequestCorrelation,
    OperatorTraceBacklink,
    build_case_results_publish_batch,
    load_request_correlation_manifest,
    main,
    publish_case_results_artifact,
)


class OperatorObservabilityManifestTest(unittest.TestCase):
    def test_load_request_correlation_manifest_reads_case_level_request_truth(self) -> None:
        payload = {
            "schema_version": 1,
            "cases": [
                {
                    "case_id": "case-1",
                    "request_id": "req_01",
                    "trace_id": "trace_01",
                    "sampled_at": "2026-04-03T00:10:00.000Z",
                    "trace_link": "https://sentry.example/traces/trace_01",
                    "issue_link": "https://sentry.example/issues/42",
                    "issue_fingerprint": "citation-missing",
                }
            ],
        }

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "correlations.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            correlations = load_request_correlation_manifest(path)

        self.assertEqual(tuple(correlations.keys()), ("case-1",))
        self.assertEqual(
            correlations["case-1"],
            OperatorRequestCorrelation(
                case_id="case-1",
                request_id="req_01",
                trace_id="trace_01",
                sampled_at="2026-04-03T00:10:00.000Z",
                trace_link="https://sentry.example/traces/trace_01",
                issue_link="https://sentry.example/issues/42",
                issue_fingerprint="citation-missing",
            ),
        )


class OperatorObservabilityBatchBuilderTest(unittest.TestCase):
    def test_build_case_results_publish_batch_can_use_inline_request_correlation_from_case_results(self) -> None:
        payload = {
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
                            "score": 0.913,
                            "rationale": "grounded to cited handbook passages",
                            "metadata": {"case_id": "case-1"},
                        }
                    ],
                }
            ]
        }

        batch = build_case_results_publish_batch(
            case_results_payload=payload,
            correlations={},
            grade_source="openai_trace_grader",
            grader_version="grader@2026-04-03",
        )

        self.assertEqual(len(batch.grades), 1)
        self.assertEqual(batch.grades[0].request_id, "req_01")
        self.assertEqual(batch.grades[0].verdict, "pass")
        self.assertEqual(len(batch.backlinks), 1)
        self.assertEqual(batch.backlinks[0].trace_link, "https://sentry.example/traces/trace_01")

    def test_build_case_results_publish_batch_maps_default_domain_grades_and_backlink(self) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "faithfulness",
                            "score": 0.913,
                            "rationale": "grounded to cited handbook passages",
                            "metadata": {"case_id": "case-1"},
                        },
                        {
                            "adapter_id": "judge",
                            "metric_name": "answer_correctness_rubric",
                            "score": 0.88,
                            "verdict": "passed",
                            "rationale": "answer matched reference",
                            "metadata": {"case_id": "case-1"},
                        },
                        {
                            "adapter_id": "ragas",
                            "metric_name": "context_precision",
                            "score": 0.91,
                            "rationale": "citation contexts were precise",
                            "metadata": {"case_id": "case-1"},
                        },
                        {
                            "adapter_id": "ragas",
                            "metric_name": "context_recall",
                            "score": 0.87,
                            "rationale": "citation contexts covered the answer",
                            "metadata": {"case_id": "case-1"},
                        },
                        {
                            "adapter_id": "judge",
                            "metric_name": "refusal_quality",
                            "score": None,
                            "verdict": "not_applicable",
                            "rationale": "completed-only metric",
                            "metadata": {"case_id": "case-1"},
                        },
                    ],
                }
            ]
        }
        correlations = {
            "case-1": OperatorRequestCorrelation(
                case_id="case-1",
                request_id="req_01",
                trace_id="trace_01",
                sampled_at="2026-04-03T00:10:00.000Z",
                trace_link="https://sentry.example/traces/trace_01",
                issue_link="https://sentry.example/issues/42",
                issue_fingerprint="citation-missing",
            )
        }

        batch = build_case_results_publish_batch(
            case_results_payload=payload,
            correlations=correlations,
            grade_source="openai_trace_grader",
            grader_version="grader@2026-04-03",
        )

        self.assertEqual(
            batch.grades,
            (
                OperatorQualityGrade(
                    request_id="req_01",
                    trace_id="trace_01",
                    grade_source="openai_trace_grader",
                    grade_domain="grounding",
                    verdict="pass",
                    score=0.88,
                    grader_version="grader@2026-04-03",
                    sampled_at="2026-04-03T00:10:00.000Z",
                    rationale_summary="answer matched reference",
                ),
                OperatorQualityGrade(
                    request_id="req_01",
                    trace_id="trace_01",
                    grade_source="openai_trace_grader",
                    grade_domain="citation",
                    verdict="pass",
                    score=0.87,
                    grader_version="grader@2026-04-03",
                    sampled_at="2026-04-03T00:10:00.000Z",
                    rationale_summary="citation contexts covered the answer",
                ),
            ),
        )
        self.assertEqual(
            batch.backlinks,
            (
                OperatorTraceBacklink(
                    request_id="req_01",
                    trace_id="trace_01",
                    trace_link="https://sentry.example/traces/trace_01",
                    issue_link="https://sentry.example/issues/42",
                    issue_fingerprint="citation-missing",
                ),
            ),
        )
        self.assertEqual(
            [(item.metric_key, item.reason) for item in batch.skipped],
            [
                ("judge.refusal_quality", "verdict_not_publishable"),
            ],
        )

    def test_build_case_results_publish_batch_maps_default_policy_grade(self) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "supplemental_results": [
                        {
                            "adapter_id": "judge",
                            "metric_name": "refusal_quality",
                            "score": 0.31,
                            "verdict": "failed",
                            "rationale": "refusal omitted policy reason",
                            "metadata": {"case_id": "case-1"},
                        },
                    ],
                }
            ]
        }
        correlations = {
            "case-1": OperatorRequestCorrelation(
                case_id="case-1",
                request_id="req_01",
                trace_id="trace_01",
                sampled_at="2026-04-03T00:10:00.000Z",
            )
        }

        batch = build_case_results_publish_batch(
            case_results_payload=payload,
            correlations=correlations,
            grade_source="judge_runtime",
            grader_version="judge@2026-04-03",
        )

        self.assertEqual(
            batch.grades,
            (
                OperatorQualityGrade(
                    request_id="req_01",
                    trace_id="trace_01",
                    grade_source="judge_runtime",
                    grade_domain="policy",
                    verdict="fail",
                    score=0.31,
                    grader_version="judge@2026-04-03",
                    sampled_at="2026-04-03T00:10:00.000Z",
                    rationale_summary="refusal omitted policy reason",
                ),
            ),
        )
        self.assertEqual(batch.skipped, ())

    def test_build_case_results_publish_batch_coalesces_override_metrics_into_single_domain_grade(self) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "supplemental_results": [
                        {
                            "adapter_id": "judge",
                            "metric_name": "answer_correctness_rubric",
                            "score": 0.82,
                            "verdict": "passed",
                            "rationale": "answer matched reference",
                            "metadata": {"case_id": "case-1"},
                        },
                        {
                            "adapter_id": "judge",
                            "metric_name": "refusal_quality",
                            "score": 0.31,
                            "verdict": "failed",
                            "rationale": "refusal omitted policy reason",
                            "metadata": {"case_id": "case-1"},
                        },
                    ],
                }
            ]
        }
        correlations = {
            "case-1": OperatorRequestCorrelation(
                case_id="case-1",
                request_id="req_01",
                trace_id="trace_01",
                sampled_at="2026-04-03T00:10:00.000Z",
            )
        }

        batch = build_case_results_publish_batch(
            case_results_payload=payload,
            correlations=correlations,
            grade_source="judge_runtime",
            grader_version="judge@2026-04-03",
            metric_domain_overrides={
                "judge.answer_correctness_rubric": "policy",
                "judge.refusal_quality": "policy",
            },
        )

        self.assertEqual(len(batch.grades), 1)
        self.assertEqual(batch.grades[0].grade_domain, "policy")
        self.assertEqual(batch.grades[0].verdict, "fail")
        self.assertEqual(batch.grades[0].score, 0.31)
        self.assertEqual(batch.grades[0].rationale_summary, "refusal omitted policy reason")
        self.assertEqual(batch.skipped, ())

    def test_build_case_results_publish_batch_requires_request_correlation_for_publishable_metrics(self) -> None:
        payload = {
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

        with self.assertRaisesRegex(ValueError, "missing request correlations for case ids: case-1"):
            build_case_results_publish_batch(
                case_results_payload=payload,
                correlations={},
                grade_source="openai_trace_grader",
                grader_version="grader@2026-04-03",
            )


class OperatorObservabilityClientTest(unittest.TestCase):
    def test_client_posts_quality_grades_with_internal_auth_header(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["header"] = request.headers.get("x-app-internal-auth")
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(200, request=request, json={"accepted": 1})

        settings = OperatorObservabilityClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            publisher = OperatorObservabilityClient(settings=settings, client=client)
            accepted = publisher.ingest_quality_grades(
                (
                    OperatorQualityGrade(
                        request_id="req_01",
                        trace_id="trace_01",
                        grade_source="openai_trace_grader",
                        grade_domain="grounding",
                        verdict="pass",
                        score=0.913,
                        grader_version="grader@2026-04-03",
                        sampled_at="2026-04-03T00:10:00.000Z",
                        rationale_summary="grounded to cited handbook passages",
                    ),
                )
            )
        finally:
            client.close()

        self.assertEqual(accepted, 1)
        self.assertEqual(captured["url"], "https://app-api.internal/api/internal/operator/quality/grades")
        self.assertEqual(captured["header"], "trusted-secret")
        self.assertEqual(
            captured["body"],
            {
                "grades": [
                    {
                        "requestId": "req_01",
                        "traceId": "trace_01",
                        "gradeSource": "openai_trace_grader",
                        "gradeDomain": "grounding",
                        "verdict": "pass",
                        "score": 0.913,
                        "graderVersion": "grader@2026-04-03",
                        "sampledAt": "2026-04-03T00:10:00.000Z",
                        "rationaleSummary": "grounded to cited handbook passages",
                    }
                ]
            },
        )

    def test_client_posts_trace_backlinks_with_internal_auth_header(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["header"] = request.headers.get("x-app-internal-auth")
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(200, request=request, json={"accepted": 1})

        settings = OperatorObservabilityClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            publisher = OperatorObservabilityClient(settings=settings, client=client)
            accepted = publisher.ingest_trace_backlinks(
                (
                    OperatorTraceBacklink(
                        request_id="req_01",
                        trace_id="trace_01",
                        trace_link="https://sentry.example/traces/trace_01",
                        issue_link="https://sentry.example/issues/42",
                        issue_fingerprint="citation-missing",
                    ),
                )
            )
        finally:
            client.close()

        self.assertEqual(accepted, 1)
        self.assertEqual(captured["url"], "https://app-api.internal/api/internal/operator/trace-backlinks")
        self.assertEqual(captured["header"], "trusted-secret")
        self.assertEqual(
            captured["body"],
            {
                "backlinks": [
                    {
                        "requestId": "req_01",
                        "traceId": "trace_01",
                        "traceLink": "https://sentry.example/traces/trace_01",
                        "issueLink": "https://sentry.example/issues/42",
                        "issueFingerprint": "citation-missing",
                    }
                ]
            },
        )

    def test_client_raises_structured_error_for_non_success_response(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                404,
                request=request,
                json={
                    "error": {
                        "code": "request_not_found",
                        "message": "Request observability seed not found.",
                        "retryable": False,
                        "details": {"requestId": "req_missing"},
                    }
                },
            )

        settings = OperatorObservabilityClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            publisher = OperatorObservabilityClient(settings=settings, client=client)
            with self.assertRaisesRegex(OperatorObservabilityClientError, "request_not_found") as raised:
                publisher.ingest_quality_grades(
                    (
                        OperatorQualityGrade(
                            request_id="req_missing",
                            trace_id="trace_missing",
                            grade_source="openai_trace_grader",
                            grade_domain="grounding",
                            verdict="pass",
                            score=0.913,
                            grader_version="grader@2026-04-03",
                            sampled_at="2026-04-03T00:10:00.000Z",
                            rationale_summary="grounded to cited handbook passages",
                        ),
                    )
                )
        finally:
            client.close()

        self.assertEqual(raised.exception.status_code, 404)


class OperatorObservabilityCliTest(unittest.TestCase):
    def test_publish_case_results_artifact_dry_run_uses_inline_request_correlation_when_manifest_omitted(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
