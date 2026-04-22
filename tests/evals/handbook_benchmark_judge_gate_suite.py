from __future__ import annotations

from tests.evals.handbook_benchmark_test_support import (
    ExecutionResult,
    ObservedTrace,
    Path,
    TemporaryDirectory,
    _completed_case,
    _response,
    evaluate_judge_gate,
    json,
    load_judge_gate_policy,
    run_handbook_formal_benchmark,
    unittest,
)


class JudgeGatePolicyTest(unittest.TestCase):
    def test_evaluate_judge_gate_returns_warn_for_soft_gate_metric_below_threshold(self) -> None:
        with TemporaryDirectory() as tmpdir:
            policy_path = Path(tmpdir) / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "required_runs": 3,
                        "metrics": [
                            {
                                "adapter_id": "judge",
                                "metric_name": "answer_correctness_rubric",
                                "gate_level": "soft_gate",
                                "min_mean_score": 0.9,
                                "min_run_average_score": 0.88,
                                "max_run_average_drift": 0.1,
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            report = evaluate_judge_gate(
                load_judge_gate_policy(policy_path),
                {
                    "judge.answer_correctness_rubric": {
                        "metric_key": "judge.answer_correctness_rubric",
                        "run_count": 3,
                        "run_average_scores": [0.93, 0.84, 0.92],
                        "mean_average_score": 0.8966666667,
                        "min_run_average_score": 0.84,
                        "max_run_average_score": 0.93,
                        "run_average_drift": 0.09,
                        "applicable_runs": 3,
                    }
                },
            )

            self.assertEqual(report["overall_verdict"], "warn")
            self.assertEqual(report["metrics"][0]["metric_key"], "judge.answer_correctness_rubric")
            self.assertEqual(report["metrics"][0]["verdict"], "warn")

    def test_evaluate_judge_gate_marks_runtime_unavailable_without_threshold_reasons_when_no_scores_exist(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            policy_path = Path(tmpdir) / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "required_runs": 3,
                        "metrics": [
                            {
                                "adapter_id": "judge",
                                "metric_name": "answer_correctness_rubric",
                                "gate_level": "soft_gate",
                                "min_mean_score": 0.9,
                                "min_run_average_score": 0.88,
                                "max_run_average_drift": 0.1,
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            report = evaluate_judge_gate(
                load_judge_gate_policy(policy_path),
                {
                    "judge.answer_correctness_rubric": {
                        "metric_key": "judge.answer_correctness_rubric",
                        "run_count": 3,
                        "run_average_scores": [],
                        "mean_average_score": None,
                        "min_run_average_score": None,
                        "max_run_average_score": None,
                        "run_average_drift": None,
                        "applicable_runs": 0,
                        "overall": {
                            "total": 3,
                            "score_count": 0,
                            "average_score": None,
                            "verdict_counts": {"failed": 3},
                            "runtime_status": "unavailable",
                            "retryable_runtime_failure_count": 3,
                            "non_retryable_runtime_failure_count": 0,
                        },
                    }
                },
            )

            metric_report = report["metrics"][0]
            self.assertEqual(report["overall_verdict"], "warn")
            self.assertEqual(metric_report["metric_key"], "judge.answer_correctness_rubric")
            self.assertEqual(metric_report["verdict"], "warn")
            self.assertIn("insufficient_applicable_runs", metric_report["reasons"])
            self.assertIn("runtime_unavailable", metric_report["reasons"])
            self.assertNotIn("mean_average_score_below_threshold", metric_report["reasons"])
            self.assertNotIn("min_run_average_score_below_threshold", metric_report["reasons"])
            self.assertNotIn("run_average_drift_above_threshold", metric_report["reasons"])

    def test_load_judge_gate_policy_accepts_empty_metric_list_for_deterministic_only_profiles(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            policy_path = Path(tmpdir) / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "required_runs": 1,
                        "metrics": [],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            policy = load_judge_gate_policy(policy_path)
            report = evaluate_judge_gate(policy, {})

        self.assertEqual(policy["metrics"], [])
        self.assertEqual(report["overall_verdict"], "pass")
        self.assertEqual(report["metrics"], [])

    def test_run_handbook_formal_benchmark_applies_optional_deterministic_gate_policy(self) -> None:
        cases = (_completed_case(),)

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"
            policy_path = Path(tmpdir) / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "required_runs": 1,
                        "metrics": [],
                        "deterministic_gate": {
                            "gate_level": "hard_gate",
                            "min_mean_pass_rate": 1.0,
                            "min_run_pass_rate": 1.0,
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            summary = run_handbook_formal_benchmark(
                cases=cases,
                executor=lambda case: ExecutionResult(
                    response=_response(status="no_answer"),
                    observed_trace=ObservedTrace(
                        selected_scope=case.scope,
                        retrieval_called=True,
                    ),
                ),
                supplemental_adapters=(),
                output_dir=output_dir,
                reruns=1,
                policy_path=policy_path,
            )

        deterministic_gate = summary["gate_report"]["deterministic_gate"]
        self.assertEqual(summary["gate_report"]["overall_verdict"], "fail")
        self.assertEqual(deterministic_gate["verdict"], "fail")
        self.assertIn("mean_pass_rate_below_threshold", deterministic_gate["reasons"])
        self.assertIn("min_run_pass_rate_below_threshold", deterministic_gate["reasons"])
