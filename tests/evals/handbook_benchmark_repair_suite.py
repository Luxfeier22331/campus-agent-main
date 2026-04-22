from __future__ import annotations

from tests.evals.handbook_benchmark_test_support import (
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
    collect_repairable_handbook_benchmark_targets,
    current_faithfulness_artifact_context,
    json,
    repair_handbook_formal_benchmark,
    run_handbook_formal_benchmark,
    unittest,
)


class HandbookBenchmarkRepairTest(unittest.TestCase):
    def test_repair_handbook_formal_benchmark_binds_source_context_for_faithfulness_repair(
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

            run_handbook_formal_benchmark(
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

            repair_handbook_formal_benchmark(
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

    def test_collect_repairable_handbook_benchmark_targets_only_selects_transient_infra_failures(
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

            targets = collect_repairable_handbook_benchmark_targets(output_dir)

            self.assertEqual(len(targets), 1)
            self.assertEqual(targets[0]["run_number"], 1)
            self.assertEqual(targets[0]["case_id"], "case-ragas")
            self.assertEqual(targets[0]["adapter_id"], "ragas")
            self.assertEqual(
                targets[0]["metric_keys"],
                ["ragas.answer_relevancy", "ragas.faithfulness"],
            )
            self.assertEqual(targets[0]["failure_reasons"], ["http_429", "provider_runtime"])

    def test_collect_repairable_handbook_benchmark_targets_includes_preflight_unavailable_backfill_targets(
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

            run_handbook_formal_benchmark(
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

            targets = collect_repairable_handbook_benchmark_targets(benchmark_dir)

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

    def test_repair_handbook_formal_benchmark_writes_repaired_artifacts_without_mutating_original(
        self,
    ) -> None:
        cases = (_completed_case(),)
        run_scores = iter(
            (
                SupplementalResult(
                    adapter_id="judge",
                    metric_name="answer_correctness_rubric",
                    score=None,
                    verdict="failed",
                    rationale='judge runtime error: 429 {"error":{"message":"upstream error","code":"do_request_failed"}}',
                    metadata={"judge_error": "RuntimeError"},
                ),
                SupplementalResult(
                    adapter_id="judge",
                    metric_name="answer_correctness_rubric",
                    score=0.9,
                    verdict="passed",
                    rationale="scored benchmark-completed",
                    metadata={"expected_status": "completed"},
                ),
            )
        )
        original_adapter = type(
            "StatefulAdapter",
            (),
            {
                "adapter_id": "judge",
                "metric_name": "answer_correctness_rubric",
                "metric_names": ("answer_correctness_rubric",),
                "evaluate": lambda self, case, execution: (next(run_scores),),
            },
        )()
        repair_adapter = type(
            "RepairAdapter",
            (),
            {
                "adapter_id": "judge",
                "metric_name": "answer_correctness_rubric",
                "metric_names": ("answer_correctness_rubric",),
                "evaluate": lambda self, case, execution: (
                    SupplementalResult(
                        adapter_id="judge",
                        metric_name="answer_correctness_rubric",
                        score=0.95,
                        verdict="passed",
                        rationale="repaired benchmark-completed",
                        metadata={"expected_status": "completed"},
                    ),
                ),
            },
        )()

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"
            repair_dir = Path(tmpdir) / "benchmark-repair"
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

            run_handbook_formal_benchmark(
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
                reruns=2,
                policy_path=policy_path,
            )

            original_summary = json.loads(
                (benchmark_dir / "summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                original_summary["aggregate"]["supplemental"]["judge.answer_correctness_rubric"][
                    "applicable_runs"
                ],
                1,
            )

            repaired_summary = repair_handbook_formal_benchmark(
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
                supplemental_adapters=(repair_adapter,),
                benchmark_dir=benchmark_dir,
                output_dir=repair_dir,
                case_workers=2,
            )

            self.assertTrue((repair_dir / "repair-config.json").exists())
            self.assertTrue((repair_dir / "repair-plan.json").exists())
            self.assertTrue((repair_dir / "run-01-repair-results.json").exists())
            self.assertTrue((repair_dir / "run-01-case-results.json").exists())
            self.assertTrue((repair_dir / "summary.json").exists())
            self.assertEqual(repaired_summary["provenance"]["repair_of"], str(benchmark_dir))
            self.assertEqual(repaired_summary["repair"]["applied_target_count"], 1)
            repaired_metric = repaired_summary["aggregate"]["supplemental"][
                "judge.answer_correctness_rubric"
            ]
            self.assertEqual(repaired_metric["applicable_runs"], 2)
            self.assertAlmostEqual(repaired_metric["mean_average_score"], 0.925)
            self.assertEqual(repaired_summary["gate_report"]["overall_verdict"], "pass")
            repair_config = json.loads(
                (repair_dir / "repair-config.json").read_text(encoding="utf-8")
            )
            self.assertEqual(repair_config["case_workers"], 2)

            original_summary_after = json.loads(
                (benchmark_dir / "summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                original_summary_after["aggregate"]["supplemental"][
                    "judge.answer_correctness_rubric"
                ]["applicable_runs"],
                1,
            )
            self.assertTrue((repair_dir / "repair-summary.json").exists())
            repair_summary = json.loads(
                (repair_dir / "repair-summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(repair_summary["selected_target_count"], 1)
            self.assertEqual(repair_summary["applied_target_count"], 1)
            self.assertEqual(repair_summary["remaining_metric_keys"], [])

    def test_repair_handbook_formal_benchmark_backfills_preflight_unavailable_metrics_when_provider_recovers(
        self,
    ) -> None:
        cases = (_completed_case(), _no_answer_case())

        class UnavailableOriginalAdapter:
            adapter_id = "judge"
            metric_name = "answer_correctness_rubric"
            metric_names = ("answer_correctness_rubric",)

            def preflight(self) -> dict[str, object]:
                raise RuntimeError("preflight_failed: 503 upstream temporarily unavailable")

            def evaluate(self, case, execution):
                del case, execution
                raise AssertionError("evaluate should not run when preflight is unavailable")

        class RecoveredRepairAdapter:
            adapter_id = "judge"
            metric_name = "answer_correctness_rubric"
            metric_names = ("answer_correctness_rubric",)

            def __init__(self) -> None:
                self.evaluate_calls = 0

            def preflight(self) -> dict[str, object]:
                return {"status": "passed"}

            def evaluate(self, case, execution):
                del execution
                self.evaluate_calls += 1
                if case.expected_status == "completed":
                    return (
                        SupplementalResult(
                            adapter_id="judge",
                            metric_name="answer_correctness_rubric",
                            score=0.94,
                            verdict="passed",
                            rationale="repaired benchmark-completed after preflight recovery",
                            metadata={"expected_status": "completed"},
                        ),
                    )
                return (
                    SupplementalResult(
                        adapter_id="judge",
                        metric_name="answer_correctness_rubric",
                        verdict="not_applicable",
                        rationale="completed-only metric",
                        metadata={"expected_status": case.expected_status},
                    ),
                )

        repair_adapter = RecoveredRepairAdapter()

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"
            repair_dir = Path(tmpdir) / "benchmark-repair"
            policy_path = Path(tmpdir) / "policy.json"
            policy_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "required_runs": 1,
                        "metrics": [
                            {
                                "adapter_id": "judge",
                                "metric_name": "answer_correctness_rubric",
                                "gate_level": "soft_gate",
                                "min_mean_score": 0.9,
                                "min_run_average_score": 0.9,
                                "max_run_average_drift": 0.2,
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            run_handbook_formal_benchmark(
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
                supplemental_adapters=(UnavailableOriginalAdapter(),),
                output_dir=benchmark_dir,
                reruns=1,
                policy_path=policy_path,
            )

            original_summary = json.loads(
                (benchmark_dir / "summary.json").read_text(encoding="utf-8")
            )
            original_metric = original_summary["aggregate"]["supplemental"][
                "judge.answer_correctness_rubric"
            ]
            self.assertEqual(original_metric["overall"]["runtime_status"], "unavailable")
            self.assertEqual(original_metric["applicable_runs"], 0)

            repaired_summary = repair_handbook_formal_benchmark(
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
                supplemental_adapters=(repair_adapter,),
                benchmark_dir=benchmark_dir,
                output_dir=repair_dir,
                policy_path=policy_path,
            )

            self.assertEqual(repair_adapter.evaluate_calls, 2)
            self.assertEqual(repaired_summary["repair"]["selected_target_count"], 2)
            self.assertEqual(repaired_summary["repair"]["applied_target_count"], 2)
            repaired_metric = repaired_summary["aggregate"]["supplemental"][
                "judge.answer_correctness_rubric"
            ]
            self.assertEqual(repaired_metric["applicable_runs"], 1)
            self.assertAlmostEqual(repaired_metric["mean_average_score"], 0.94)
            self.assertEqual(repaired_summary["gate_report"]["overall_verdict"], "pass")

            repair_plan = json.loads((repair_dir / "repair-plan.json").read_text(encoding="utf-8"))
            self.assertTrue(
                all(
                    target["target_source"] == "preflight_unavailable_backfill"
                    for target in repair_plan["targets"]
                )
            )
            repair_results = json.loads(
                (repair_dir / "run-01-repair-results.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                [item["status"] for item in repair_results["results"]],
                ["repaired", "repaired"],
            )

    def test_repair_handbook_formal_benchmark_marks_rerun_failed_when_runtime_failure_persists(
        self,
    ) -> None:
        cases = (_completed_case(),)
        original_adapter = type(
            "OriginalAdapter",
            (),
            {
                "adapter_id": "ragas",
                "metric_name": "faithfulness",
                "metric_names": ("faithfulness",),
                "evaluate": lambda self, case, execution: (
                    SupplementalResult(
                        adapter_id="ragas",
                        metric_name="faithfulness",
                        score=None,
                        verdict="failed",
                        rationale="ragas runtime error: TimeoutError",
                        metadata={"judge_error": "RuntimeError"},
                    ),
                ),
            },
        )()
        repair_adapter = type(
            "RepairAdapter",
            (),
            {
                "adapter_id": "ragas",
                "metric_name": "faithfulness",
                "metric_names": ("faithfulness",),
                "evaluate": lambda self, case, execution: (
                    SupplementalResult(
                        adapter_id="ragas",
                        metric_name="faithfulness",
                        score=None,
                        verdict="failed",
                        rationale="ragas runtime error: TimeoutError",
                        metadata={"judge_error": "RuntimeError"},
                    ),
                ),
            },
        )()

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"
            repair_dir = Path(tmpdir) / "benchmark-repair"

            run_handbook_formal_benchmark(
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

            repaired_summary = repair_handbook_formal_benchmark(
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
                supplemental_adapters=(repair_adapter,),
                benchmark_dir=benchmark_dir,
                output_dir=repair_dir,
            )

            repaired_metric = repaired_summary["aggregate"]["supplemental"]["ragas.faithfulness"]
            self.assertEqual(repaired_metric["applicable_runs"], 0)
            self.assertEqual(repaired_metric["overall"]["runtime_status"], "unavailable")

            repair_results = json.loads(
                (repair_dir / "run-01-repair-results.json").read_text(encoding="utf-8")
            )
            self.assertEqual(repair_results["results"][0]["status"], "rerun_failed")
            self.assertEqual(repair_results["results"][0]["recovered_metric_keys"], [])
            self.assertEqual(
                repair_results["results"][0]["remaining_metric_keys"], ["ragas.faithfulness"]
            )

            repair_summary = json.loads(
                (repair_dir / "repair-summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(repair_summary["status_counts"], {"rerun_failed": 1})
            self.assertEqual(repair_summary["repaired_metric_keys"], [])
            self.assertEqual(repair_summary["failed_metric_keys"], ["ragas.faithfulness"])
            self.assertEqual(repair_summary["remaining_metric_keys"], ["ragas.faithfulness"])

    def test_repair_handbook_formal_benchmark_skips_targets_when_repair_preflight_is_unavailable(
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

        class UnavailableRepairAdapter:
            adapter_id = "judge"
            metric_name = "answer_correctness_rubric"
            metric_names = ("answer_correctness_rubric",)

            def __init__(self) -> None:
                self.evaluate_calls = 0

            def preflight(self) -> dict[str, object]:
                raise RuntimeError("preflight_failed: 503 upstream temporarily unavailable")

            def evaluate(self, case, execution):
                del case, execution
                self.evaluate_calls += 1
                raise AssertionError("repair rerun should skip unavailable adapters")

        repair_adapter = UnavailableRepairAdapter()

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"
            repair_dir = Path(tmpdir) / "benchmark-repair"

            run_handbook_formal_benchmark(
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

            repaired_summary = repair_handbook_formal_benchmark(
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
                supplemental_adapters=(repair_adapter,),
                benchmark_dir=benchmark_dir,
                output_dir=repair_dir,
            )

            self.assertEqual(repair_adapter.evaluate_calls, 0)
            self.assertEqual(repaired_summary["repair"]["selected_target_count"], 1)
            self.assertEqual(repaired_summary["repair"]["applied_target_count"], 0)
            repair_results = json.loads(
                (repair_dir / "run-01-repair-results.json").read_text(encoding="utf-8")
            )
            self.assertEqual(repair_results["results"][0]["status"], "skipped_provider_unavailable")
