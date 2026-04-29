from __future__ import annotations

from tests.evals.formal_benchmark_test_support import (
    HANDBOOK_SCOPE,
    ExecutionResult,
    ObservedTrace,
    Path,
    SupplementalResult,
    TemporaryDirectory,
    _completed_case,
    _no_answer_case,
    _response,
    _source,
    collect_repairable_benchmark_targets,
    current_faithfulness_artifact_context,
    json,
    repair_formal_benchmark,
    run_formal_benchmark,
    unittest,
)


class FormalBenchmarkRepairSelectionTest(unittest.TestCase):
    def test_repair_formal_benchmark_binds_source_context_for_faithfulness_repair(
        self,
    ) -> None:
        cases = (_completed_case(),)
        original_adapter = type(
            "OriginalAdapter",
            (),
            {
                "adapter_id": "judge",
                "metric_name": "answer_correctness_rubric",
                "metric_names": ("answer_correctness_rubric",),
                "evaluate": lambda self, case, execution: (
                    SupplementalResult(
                        adapter_id="judge",
                        metric_name="answer_correctness_rubric",
                        score=None,
                        verdict="failed",
                        rationale='judge runtime error: 429 {"error":{"message":"upstream error","code":"do_request_failed"}}',
                        metadata={"judge_error": "RuntimeError"},
                    ),
                ),
            },
        )()
        seen_contexts: list[tuple[str, int, str, str | None]] = []

        class RepairContextAwareAdapter:
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
                        score=0.95,
                        verdict="passed",
                        rationale=f"repaired {case.case_id}",
                    ),
                )

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"
            repair_dir = Path(tmpdir) / "benchmark-repair"

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
                supplemental_adapters=(original_adapter,),
                output_dir=benchmark_dir,
                reruns=1,
            )

            repair_formal_benchmark(
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
                supplemental_adapters=(RepairContextAwareAdapter(),),
                benchmark_dir=benchmark_dir,
                output_dir=repair_dir,
            )

        self.assertEqual(
            seen_contexts,
            [
                (str(repair_dir), 1, "repair", str(benchmark_dir)),
            ],
        )

    def test_collect_repairable_benchmark_targets_only_selects_transient_infra_failures(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / "run-01-case-results.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "benchmark_type": "formal_benchmark",
                        "run_number": 1,
                        "results": [
                            {
                                "case_id": "case-ragas",
                                "passed": True,
                                "status_result": {"passed": True, "reason": ""},
                                "retrieval_result": {"passed": True, "reason": ""},
                                "answer_result": {"passed": True, "reason": ""},
                                "trace_result": {"passed": True, "reason": ""},
                                "metric_results": {},
                                "supplemental_results": [
                                    {
                                        "adapter_id": "ragas",
                                        "metric_name": "faithfulness",
                                        "score": None,
                                        "verdict": "failed",
                                        "rationale": 'ragas runtime error: 429 {"error":{"message":"upstream error","code":"do_request_failed"}}',
                                        "metadata": {"judge_error": "RuntimeError"},
                                    },
                                    {
                                        "adapter_id": "ragas",
                                        "metric_name": "answer_relevancy",
                                        "score": None,
                                        "verdict": "failed",
                                        "rationale": 'ragas runtime error: 429 {"error":{"message":"upstream error","code":"do_request_failed"}}',
                                        "metadata": {"judge_error": "RuntimeError"},
                                    },
                                ],
                            },
                            {
                                "case_id": "case-low-score",
                                "passed": True,
                                "status_result": {"passed": True, "reason": ""},
                                "retrieval_result": {"passed": True, "reason": ""},
                                "answer_result": {"passed": True, "reason": ""},
                                "trace_result": {"passed": True, "reason": ""},
                                "metric_results": {},
                                "supplemental_results": [
                                    {
                                        "adapter_id": "judge",
                                        "metric_name": "answer_correctness_rubric",
                                        "score": 0.2,
                                        "verdict": "failed",
                                        "rationale": "judge scored the answer as incomplete",
                                        "metadata": {},
                                    }
                                ],
                            },
                            {
                                "case_id": "case-invalid-request",
                                "passed": True,
                                "status_result": {"passed": True, "reason": ""},
                                "retrieval_result": {"passed": True, "reason": ""},
                                "answer_result": {"passed": True, "reason": ""},
                                "trace_result": {"passed": True, "reason": ""},
                                "metric_results": {},
                                "supplemental_results": [
                                    {
                                        "adapter_id": "judge",
                                        "metric_name": "answer_correctness_rubric",
                                        "score": None,
                                        "verdict": "failed",
                                        "rationale": "judge runtime error: 400 invalid request",
                                        "metadata": {"judge_error": "HTTPStatusError"},
                                    }
                                ],
                            },
                            {
                                "case_id": "case-auth-unavailable",
                                "passed": True,
                                "status_result": {"passed": True, "reason": ""},
                                "retrieval_result": {"passed": True, "reason": ""},
                                "answer_result": {"passed": True, "reason": ""},
                                "trace_result": {"passed": True, "reason": ""},
                                "metric_results": {},
                                "supplemental_results": [
                                    {
                                        "adapter_id": "judge",
                                        "metric_name": "answer_correctness_rubric",
                                        "score": None,
                                        "verdict": "failed",
                                        "rationale": 'judge runtime error: 500 {"error":{"message":"auth_unavailable: no auth available"}}',
                                        "metadata": {"judge_error": "RuntimeError"},
                                    }
                                ],
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            targets = collect_repairable_benchmark_targets(output_dir)

            self.assertEqual(len(targets), 1)
            self.assertEqual(targets[0]["run_number"], 1)
            self.assertEqual(targets[0]["case_id"], "case-ragas")
            self.assertEqual(targets[0]["adapter_id"], "ragas")
            self.assertEqual(
                targets[0]["metric_keys"],
                ["ragas.answer_relevancy", "ragas.faithfulness"],
            )
            self.assertEqual(targets[0]["failure_reasons"], ["http_429", "provider_runtime"])

    def test_collect_repairable_benchmark_targets_includes_preflight_unavailable_backfill_targets(
        self,
    ) -> None:
        cases = (_completed_case(), _no_answer_case())

        class UnavailableAdapter:
            adapter_id = "judge"
            metric_name = "answer_correctness_rubric"
            metric_names = ("answer_correctness_rubric",)

            def preflight(self) -> dict[str, object]:
                raise RuntimeError("preflight_failed: 503 upstream temporarily unavailable")

            def evaluate(self, case, execution):
                del case, execution
                raise AssertionError("evaluate should not run when preflight is unavailable")

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"

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
                    ),
                ),
                supplemental_adapters=(UnavailableAdapter(),),
                output_dir=benchmark_dir,
                reruns=1,
            )

            targets = collect_repairable_benchmark_targets(benchmark_dir)

            self.assertEqual(len(targets), 2)
            self.assertEqual(
                [
                    (target["run_number"], target["case_id"], target["adapter_id"])
                    for target in targets
                ],
                [
                    (1, "benchmark-completed", "judge"),
                    (1, "benchmark-no-answer", "judge"),
                ],
            )
            self.assertTrue(
                all(
                    target["target_source"] == "preflight_unavailable_backfill"
                    for target in targets
                )
            )
            self.assertTrue(
                all(
                    target["metric_keys"] == ["judge.answer_correctness_rubric"]
                    for target in targets
                )
            )
