from __future__ import annotations

from campus_evals import DimensionResult
from campus_evals import models as eval_models

from tests.evals.formal_benchmark_test_support import (
    HANDBOOK_SCOPE,
    ExecutionResult,
    ObservedTrace,
    OperatorRequestCorrelation,
    Path,
    SupplementalResult,
    TemporaryDirectory,
    _completed_case,
    _no_answer_case,
    _response,
    _source,
    current_faithfulness_artifact_context,
    json,
    run_formal_benchmark,
    unittest,
)


class FormalBenchmarkFacadeTest(unittest.TestCase):
    def test_formal_benchmark_module_keeps_public_exports(self) -> None:
        import campus_evals.formal_benchmark as formal_benchmark_module

        for name in (
            "collect_repairable_benchmark_targets",
            "repair_formal_benchmark",
            "run_formal_benchmark",
        ):
            self.assertTrue(hasattr(formal_benchmark_module, name), name)


class HandbookBenchmarkRunTest(unittest.TestCase):
    def test_run_formal_benchmark_persists_case_level_request_correlation(self) -> None:
        cases = (_completed_case(),)

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

            run_formal_benchmark(
                cases=cases,
                executor=lambda case: ExecutionResult(
                    response=_response(
                        status=case.expected_status,
                        answer_text="图书馆开放时间为 08:00 到 22:00。",
                        sources=(_source("handbook:library"),),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=HANDBOOK_SCOPE,
                        retrieval_called=True,
                    ),
                    request_correlation=OperatorRequestCorrelation(
                        case_id=case.case_id,
                        request_id="req_eval_01HQ",
                        trace_id="trace_eval_01HQ",
                        sampled_at="2026-04-03T00:10:00.000Z",
                        trace_link="https://sentry.example/traces/trace_eval_01HQ",
                    ),
                ),
                supplemental_adapters=(),
                output_dir=output_dir,
                reruns=1,
            )

            payload = json.loads(
                (output_dir / "run-01-case-results.json").read_text(encoding="utf-8")
            )

        self.assertEqual(
            payload["results"][0]["request_correlation"],
            {
                "case_id": "benchmark-completed",
                "request_id": "req_eval_01HQ",
                "trace_id": "trace_eval_01HQ",
                "sampled_at": "2026-04-03T00:10:00.000Z",
                "trace_link": "https://sentry.example/traces/trace_eval_01HQ",
                "issue_link": None,
                "issue_fingerprint": None,
            },
        )

    def test_run_formal_benchmark_persists_workflow_trace_artifact_fields(self) -> None:
        self.assertTrue(hasattr(eval_models, "WorkflowTraceSummary"))
        self.assertTrue(hasattr(eval_models, "OrchestrationCaseResults"))
        workflow_trace_summary_cls = eval_models.WorkflowTraceSummary
        orchestration_case_results_cls = eval_models.OrchestrationCaseResults
        cases = (_completed_case(),)

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

            run_formal_benchmark(
                cases=cases,
                executor=lambda case: ExecutionResult(
                    response=_response(
                        status=case.expected_status,
                        answer_text="图书馆开放时间为 08:00 到 22:00。",
                        sources=(_source("handbook:library"),),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=HANDBOOK_SCOPE,
                        retrieval_called=True,
                    ),
                    workflow_trace_summary=workflow_trace_summary_cls(
                        routing_frame={"requested_capability": "knowledge"},
                        context_resolution={"resolved_scope": "regulations/student_rules"},
                        planning_outcome="delegate",
                        direct_vs_delegate_branch="delegate",
                        handoff={"target": "rag-agent"},
                        selected_target="rag-agent",
                        selected_tools=("retrieval.query",),
                        tool_argument_summary={"collection": "student_rules"},
                        guardrail_outcomes={"scope_gate": "pass"},
                        runtime_versions={"execution-control": "test"},
                        policy_artifact_versions={"intent-policy": "test"},
                    ),
                    orchestration_case_results=orchestration_case_results_cls(
                        direct_vs_delegate_branch_correctness=DimensionResult(True, "ok"),
                        handoff_correctness=DimensionResult(True, "ok"),
                        tool_argument_precision=DimensionResult(True, "ok"),
                        guardrail_correctness=DimensionResult(True, "ok"),
                        fail_close_correctness=DimensionResult(True, "not_applicable"),
                        trace_projection_completeness=DimensionResult(True, "ok"),
                    ),
                ),
                supplemental_adapters=(),
                output_dir=output_dir,
                reruns=1,
            )

            payload = json.loads(
                (output_dir / "run-01-case-results.json").read_text(encoding="utf-8")
            )

        result = payload["results"][0]
        self.assertEqual(result["workflow_trace_summary"]["selected_target"], "rag-agent")
        self.assertEqual(result["workflow_trace_summary"]["selected_tools"], ["retrieval.query"])
        self.assertTrue(
            result["orchestration_case_results"]["trace_projection_completeness"]["passed"]
        )

    def test_run_formal_benchmark_binds_faithfulness_artifact_context_per_run(
        self,
    ) -> None:
        cases = (_completed_case(),)
        seen_contexts: list[tuple[str, int, str, str | None]] = []

        class ContextAwareAdapter:
            adapter_id = "judge"
            metric_name = "answer_correctness_rubric"
            metric_names = ("answer_correctness_rubric",)

            def evaluate(self, case, execution):
                del execution
                context = current_faithfulness_artifact_context()
                if context is None:
                    seen_contexts.append(("missing", -1, "missing", None))
                else:
                    seen_contexts.append(
                        (
                            str(context.output_dir),
                            context.run_number,
                            context.benchmark_mode,
                            str(context.source_output_dir)
                            if context.source_output_dir is not None
                            else None,
                        )
                    )
                return (
                    SupplementalResult(
                        adapter_id="judge",
                        metric_name="answer_correctness_rubric",
                        score=0.9,
                        verdict="passed",
                        rationale=f"scored {case.case_id}",
                    ),
                )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

            run_formal_benchmark(
                cases=cases,
                executor=lambda case: ExecutionResult(
                    response=_response(
                        status=case.expected_status,
                        answer_text="图书馆开放时间为 08:00 到 22:00。",
                        sources=(_source("handbook:library"),),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=HANDBOOK_SCOPE,
                        retrieval_called=True,
                    ),
                ),
                supplemental_adapters=(ContextAwareAdapter(),),
                output_dir=output_dir,
                reruns=2,
            )

        self.assertEqual(
            seen_contexts,
            [
                (str(output_dir), 1, "run", None),
                (str(output_dir), 2, "run", None),
            ],
        )

    def test_run_formal_benchmark_skips_unavailable_supplemental_adapters_and_preserves_deterministic_runs(
        self,
    ) -> None:
        cases = (_completed_case(),)

        class PreflightAwareAdapter:
            adapter_id = "judge"
            metric_name = "answer_correctness_rubric"
            metric_names = ("answer_correctness_rubric",)

            def __init__(self) -> None:
                self.preflight_calls = 0
                self.evaluate_calls = 0
                self.preflight_failed = False

            def preflight(self) -> dict[str, object]:
                self.preflight_calls += 1
                self.preflight_failed = True
                raise RuntimeError("preflight_failed: 503 upstream temporarily unavailable")

            def evaluate(self, case, execution):
                del execution
                self.evaluate_calls += 1
                if self.preflight_failed:
                    return (
                        SupplementalResult(
                            adapter_id="judge",
                            metric_name="answer_correctness_rubric",
                            score=None,
                            verdict="failed",
                            rationale=f"judge runtime error: circuit_open after preflight_failed for {case.case_id}",
                            metadata={"judge_error": "RuntimeError"},
                        ),
                    )
                return (
                    SupplementalResult(
                        adapter_id="judge",
                        metric_name="answer_correctness_rubric",
                        score=0.9,
                        verdict="passed",
                        rationale=f"scored {case.case_id}",
                        metadata={"expected_status": case.expected_status},
                    ),
                )

        adapter = PreflightAwareAdapter()

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

            run_formal_benchmark(
                cases=cases,
                executor=lambda case: ExecutionResult(
                    response=_response(
                        status=case.expected_status,
                        answer_text="图书馆开放时间为 08:00 到 22:00。",
                        sources=(_source("handbook:library"),),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=HANDBOOK_SCOPE,
                        retrieval_called=True,
                        retrieved_sources=(_source("handbook:library"),),
                        supporting_sources=(_source("handbook:library"),),
                    ),
                ),
                supplemental_adapters=(adapter,),
                output_dir=output_dir,
                reruns=1,
                benchmark_type="formal_benchmark",
            )

            self.assertEqual(adapter.preflight_calls, 1)
            self.assertEqual(adapter.evaluate_calls, 0)
            self.assertTrue((output_dir / "supplemental-preflight.json").exists())
            preflight = json.loads(
                (output_dir / "supplemental-preflight.json").read_text(encoding="utf-8")
            )
            self.assertEqual(preflight["summary"]["status_counts"]["failed"], 1)
            self.assertEqual(preflight["adapters"][0]["failure_disposition"], "transient_retryable")
            self.assertEqual(preflight["adapters"][0]["run_action"], "skip_adapter")
            summary = json.loads((output_dir / "run-01-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["summary"]["total"], 1)
            self.assertEqual(summary["summary"]["passed"], 1)
            self.assertEqual(summary["summary"]["by_supplemental"], {})
            aggregate = json.loads((output_dir / "summary.json").read_text(encoding="utf-8"))
            metric = aggregate["aggregate"]["supplemental"]["judge.answer_correctness_rubric"]
            self.assertEqual(metric["overall"]["runtime_status"], "unavailable")
            self.assertEqual(metric["overall"]["skip_reason"], "preflight_unavailable")
            self.assertEqual(metric["overall"]["preflight_failure_count"], 1)
            self.assertEqual(
                metric["overall"]["failure_disposition_counts"],
                {"transient_retryable": 1},
            )
            gate_metric = next(
                item
                for item in aggregate["gate_report"]["metrics"]
                if item["metric_key"] == "judge.answer_correctness_rubric"
            )
            self.assertIn("runtime_unavailable", gate_metric["reasons"])
            self.assertNotIn("mean_average_score_below_threshold", gate_metric["reasons"])
            self.assertNotIn("min_run_average_score_below_threshold", gate_metric["reasons"])
            self.assertNotIn("run_average_drift_above_threshold", gate_metric["reasons"])

    def test_run_formal_benchmark_raises_for_non_retryable_preflight_failure(self) -> None:
        cases = (_completed_case(),)

        class InvalidRequestAdapter:
            adapter_id = "judge"
            metric_name = "answer_correctness_rubric"
            metric_names = ("answer_correctness_rubric",)

            def preflight(self) -> dict[str, object]:
                raise RuntimeError("400 invalid request: unsupported parameter")

            def evaluate(self, case, execution):
                del case, execution
                raise AssertionError(
                    "evaluate should not run after non-retryable preflight failure"
                )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

            with self.assertRaisesRegex(
                RuntimeError, "non-retryable supplemental preflight failure"
            ):
                run_formal_benchmark(
                    cases=cases,
                    executor=lambda case: ExecutionResult(
                        response=_response(
                            status=case.expected_status,
                            answer_text="图书馆开放时间为 08:00 到 22:00。",
                            sources=(_source("handbook:library"),),
                        ),
                        observed_trace=ObservedTrace(
                            selected_scope=HANDBOOK_SCOPE,
                            retrieval_called=True,
                            retrieved_sources=(_source("handbook:library"),),
                            supporting_sources=(_source("handbook:library"),),
                        ),
                    ),
                    supplemental_adapters=(InvalidRequestAdapter(),),
                    output_dir=output_dir,
                    reruns=1,
                    benchmark_type="formal_benchmark",
                )

            self.assertTrue((output_dir / "supplemental-preflight.json").exists())
            self.assertFalse((output_dir / "summary.json").exists())
            preflight = json.loads(
                (output_dir / "supplemental-preflight.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                preflight["adapters"][0]["failure_disposition"], "non_retryable_request"
            )
            self.assertEqual(preflight["adapters"][0]["run_action"], "abort_benchmark")

    def test_run_formal_benchmark_writes_expected_artifacts_and_summaries(self) -> None:
        cases = (_completed_case(), _no_answer_case())
        adapter = type(
            "Adapter",
            (),
            {
                "adapter_id": "judge",
                "evaluate": lambda self, case, execution: (
                    (
                        SupplementalResult(
                            adapter_id="judge",
                            metric_name="answer_correctness_rubric",
                            score=0.9,
                            verdict="passed",
                            rationale=f"scored {case.case_id}",
                            metadata={"expected_status": case.expected_status},
                        ),
                    )
                    if case.expected_status == "completed"
                    else (
                        SupplementalResult(
                            adapter_id="judge",
                            metric_name="answer_correctness_rubric",
                            verdict="not_applicable",
                            rationale="completed-only metric",
                            metadata={"expected_status": case.expected_status},
                        ),
                    )
                ),
            },
        )()

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"
            policy_path = Path(tmpdir) / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "required_runs": 2,
                        "metrics": [
                            {
                                "adapter_id": "judge",
                                "metric_name": "answer_correctness_rubric",
                                "gate_level": "soft_gate",
                                "min_mean_score": 0.85,
                                "min_run_average_score": 0.85,
                                "max_run_average_drift": 0.2,
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            run_formal_benchmark(
                cases=cases,
                executor=lambda case: ExecutionResult(
                    response=_response(
                        status=case.expected_status,
                        answer_text="图书馆开放时间为 08:00 到 22:00。"
                        if case.expected_status == "completed"
                        else "",
                        sources=(_source("handbook:library"),)
                        if case.expected_status == "completed"
                        else (),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=HANDBOOK_SCOPE,
                        retrieval_called=True,
                        retrieved_sources=(_source("handbook:library"),),
                        supporting_sources=(_source("handbook:library"),),
                    ),
                ),
                supplemental_adapters=(adapter,),
                output_dir=output_dir,
                reruns=2,
                case_workers=2,
                policy_path=policy_path,
                benchmark_type="formal_benchmark",
            )

            self.assertTrue((output_dir / "benchmark-config.json").exists())
            self.assertTrue((output_dir / "supplemental-preflight.json").exists())
            self.assertTrue((output_dir / "run-01-case-results.json").exists())
            self.assertTrue((output_dir / "run-01-summary.json").exists())
            self.assertTrue((output_dir / "run-02-case-results.json").exists())
            self.assertTrue((output_dir / "run-02-summary.json").exists())
            self.assertTrue((output_dir / "summary.json").exists())
            self.assertTrue((output_dir / "gate-report.json").exists())
            self.assertTrue((output_dir / "SUMMARY.md").exists())
            self.assertTrue((output_dir / "supplemental-provider-summary.json").exists())
            self.assertTrue((output_dir / "supplemental-runtime-events.jsonl").exists())

            benchmark_config = json.loads(
                (output_dir / "benchmark-config.json").read_text(encoding="utf-8")
            )
            summary = json.loads((output_dir / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(benchmark_config["case_workers"], 2)
            self.assertEqual(summary["benchmark_type"], "formal_benchmark")
            self.assertEqual(summary["reruns"], 2)
            self.assertEqual(summary["case_set"]["expected_status_counts"]["completed"], 1)
            self.assertEqual(summary["case_set"]["expected_status_counts"]["no_answer"], 1)
            run_results = json.loads(
                (output_dir / "run-01-case-results.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                run_results["results"][0]["observed_trace"]["retrieved_sources"][0]["doc_id"],
                "handbook:library",
            )
            self.assertEqual(
                run_results["results"][0]["observed_trace"]["supporting_sources"][0]["chunk_id"],
                "chunk-1",
            )
            metric_summary = summary["aggregate"]["supplemental"]["judge.answer_correctness_rubric"]
            self.assertAlmostEqual(metric_summary["mean_average_score"], 0.9)
            self.assertEqual(metric_summary["by_expected_status"]["completed"]["score_count"], 2)
            self.assertEqual(
                metric_summary["by_expected_status"]["no_answer"]["verdict_counts"][
                    "not_applicable"
                ],
                2,
            )
