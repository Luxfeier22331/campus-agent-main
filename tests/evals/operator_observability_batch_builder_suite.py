from __future__ import annotations

import unittest

from campus_evals.operator_observability import (
    OperatorQualityGrade,
    OperatorRequestCorrelation,
    OperatorSkippedPublishItem,
    OperatorTraceBacklink,
    build_case_results_publish_batch,
)


class OperatorObservabilityBatchBuilderTest(unittest.TestCase):
    def test_build_case_results_publish_batch_publishes_deterministic_policy_metrics(self) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "metric_results": {
                        "out_of_scope_accuracy": {
                            "passed": True,
                            "reason": "ok",
                        },
                        "unsafe_false_allow_rate": {
                            "passed": True,
                            "reason": "ok",
                        },
                    },
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
            grade_source="deterministic_eval",
            grader_version="deterministic@2026-04-06",
        )

        self.assertEqual(
            batch.grades,
            (
                OperatorQualityGrade(
                    request_id="req_01",
                    trace_id="trace_01",
                    grade_source="deterministic_eval",
                    grade_domain="policy",
                    verdict="pass",
                    score=None,
                    grader_version="deterministic@2026-04-06",
                    sampled_at="2026-04-03T00:10:00.000Z",
                    rationale_summary="ok",
                ),
            ),
        )
        self.assertEqual(batch.backlinks, ())
        self.assertEqual(batch.skipped, ())

    def test_build_case_results_publish_batch_publishes_new_hallucination_policy_metrics(
        self,
    ) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "metric_results": {
                        "restricted_access_denied_accuracy": {
                            "passed": True,
                            "reason": "ok",
                        },
                        "freshness_fail_close_accuracy": {
                            "passed": False,
                            "reason": "semantic_outcome=unsupported_by_evidence",
                        },
                    },
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
            grade_source="deterministic_eval",
            grader_version="deterministic@2026-04-06",
        )

        self.assertEqual(
            batch.grades,
            (
                OperatorQualityGrade(
                    request_id="req_01",
                    trace_id="trace_01",
                    grade_source="deterministic_eval",
                    grade_domain="policy",
                    verdict="fail",
                    score=None,
                    grader_version="deterministic@2026-04-06",
                    sampled_at="2026-04-03T00:10:00.000Z",
                    rationale_summary="semantic_outcome=unsupported_by_evidence",
                ),
            ),
        )
        self.assertEqual(batch.backlinks, ())
        self.assertEqual(batch.skipped, ())

    def test_build_case_results_publish_batch_skips_unsupported_deterministic_metrics(self) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "metric_results": {
                        "status_accuracy": {
                            "passed": True,
                            "reason": "ok",
                        },
                    },
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
            grade_source="deterministic_eval",
            grader_version="deterministic@2026-04-06",
        )

        self.assertEqual(batch.grades, ())
        self.assertEqual(
            batch.skipped,
            (
                OperatorSkippedPublishItem(
                    case_id="case-1",
                    metric_key="deterministic.status_accuracy",
                    reason="unsupported_metric_domain",
                ),
            ),
        )

    def test_build_case_results_publish_batch_requires_request_correlation_for_publishable_deterministic_metrics(
        self,
    ) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "metric_results": {
                        "false_refusal_rate": {
                            "passed": False,
                            "reason": "status=no_answer",
                        },
                    },
                }
            ]
        }

        with self.assertRaisesRegex(
            ValueError, "missing request correlations for case ids: case-1"
        ):
            build_case_results_publish_batch(
                case_results_payload=payload,
                correlations={},
                grade_source="deterministic_eval",
                grader_version="deterministic@2026-04-06",
            )

    def test_build_case_results_publish_batch_can_use_inline_request_correlation_from_case_results(
        self,
    ) -> None:
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

    def test_build_case_results_publish_batch_maps_answer_relevancy_into_grounding(self) -> None:
        payload = {
            "results": [
                {
                    "case_id": "case-1",
                    "supplemental_results": [
                        {
                            "adapter_id": "ragas",
                            "metric_name": "answer_relevancy",
                            "score": 0.81,
                            "rationale": "answer stayed aligned with the user ask",
                            "metadata": {"case_id": "case-1"},
                        },
                    ],
                }
            ]
        }
        correlations = {
            "case-1": OperatorRequestCorrelation(
                case_id="case-1",
                request_id="req_01HQ",
                trace_id="trace_01HQ",
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
                    request_id="req_01HQ",
                    trace_id="trace_01HQ",
                    grade_source="judge_runtime",
                    grade_domain="grounding",
                    verdict="pass",
                    score=0.81,
                    grader_version="judge@2026-04-03",
                    sampled_at="2026-04-03T00:10:00.000Z",
                    rationale_summary="answer stayed aligned with the user ask",
                ),
            ),
        )
        self.assertEqual(batch.skipped, ())

    def test_build_case_results_publish_batch_coalesces_override_metrics_into_single_domain_grade(
        self,
    ) -> None:
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

    def test_build_case_results_publish_batch_requires_request_correlation_for_publishable_metrics(
        self,
    ) -> None:
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

        with self.assertRaisesRegex(
            ValueError, "missing request correlations for case ids: case-1"
        ):
            build_case_results_publish_batch(
                case_results_payload=payload,
                correlations={},
                grade_source="openai_trace_grader",
                grader_version="grader@2026-04-03",
            )
