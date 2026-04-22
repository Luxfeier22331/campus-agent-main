from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_contracts import (
    ActorContext,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
    SpecialistResponse,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    ObservedTrace,
    SupplementalResult,
    TraceExpectation,
    expected_source_ref,
)
from campus_evals.faithfulness_runtime import current_faithfulness_artifact_context
from campus_evals.handbook_benchmark import (
    collect_repairable_handbook_benchmark_targets,
    repair_handbook_formal_benchmark,
    run_handbook_formal_benchmark,
)
from campus_evals.judge_gate import evaluate_judge_gate, load_judge_gate_policy
from campus_evals.operator_observability import OperatorRequestCorrelation

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_handbook")


def _source(doc_id: str) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id="v1",
        chunk_id="chunk-1",
        anchor={"page": 1},
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=False,
        snippet="snippet",
        score=0.95,
    )


def _completed_case() -> GoldenCase:
    return GoldenCase(
        case_id="benchmark-completed",
        split="release_gate",
        source_type="expert_authored",
        user_goal="图书馆开放时间是什么？",
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        expected_status="completed",
        expected_sources=(expected_source_ref("handbook:library"),),
        required_facts=("08:00",),
        trace_expectation=TraceExpectation(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
    )


def _no_answer_case() -> GoldenCase:
    return GoldenCase(
        case_id="benchmark-no-answer",
        split="release_gate",
        source_type="expert_authored",
        user_goal="火星校区飞船停靠规则",
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        expected_status="no_answer",
        trace_expectation=TraceExpectation(
            selected_scope=HANDBOOK_SCOPE,
            retrieval_called=True,
            fail_closed_expected=True,
        ),
    )


def _response(
    *,
    status: str,
    answer_text: str = "",
    sources: tuple[EvidenceSource, ...] = (),
    follow_up_question: str = "",
) -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-agent",
        status=status,
        answer_text=answer_text,
        confidence="high" if status == "completed" else "low",
        follow_up_question=follow_up_question,
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="query",
                corpus="regulations",
                collection="student_handbook",
                sources=sources,
            )
        ),
    )


class HandbookBenchmarkFacadeTest(unittest.TestCase):
    def test_handbook_benchmark_module_keeps_public_exports(self) -> None:
        import campus_evals.handbook_benchmark as handbook_benchmark_module

        for name in (
            "collect_repairable_handbook_benchmark_targets",
            "repair_handbook_formal_benchmark",
            "run_handbook_formal_benchmark",
        ):
            self.assertTrue(hasattr(handbook_benchmark_module, name), name)


class HandbookBenchmarkRunnerTest(unittest.TestCase):
    def test_run_handbook_formal_benchmark_persists_case_level_request_correlation(self) -> None:
        cases = (_completed_case(),)

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

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

    def test_run_handbook_formal_benchmark_binds_faithfulness_artifact_context_per_run(
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

    def test_run_handbook_formal_benchmark_skips_unavailable_supplemental_adapters_and_preserves_deterministic_runs(
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

    def test_run_handbook_formal_benchmark_raises_for_non_retryable_preflight_failure(self) -> None:
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

    def test_run_handbook_formal_benchmark_writes_expected_artifacts_and_summaries(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
