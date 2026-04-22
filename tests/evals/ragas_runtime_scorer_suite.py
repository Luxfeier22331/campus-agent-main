from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    NLIStatementOutput,
    Path,
    RagasProjection,
    RagasSettings,
    StatementFaithfulnessAnswer,
    StatementGeneratorOutput,
    SupplementalHTTPSettings,
    TemporaryDirectory,
    bind_faithfulness_artifact_context,
    build_default_ragas_metric_names,
    build_default_ragas_metrics,
    build_ragas_scorer,
    json,
    patch,
    unittest,
)


class RagasScorerTest(unittest.TestCase):
    def test_build_ragas_scorer_maps_id_based_context_metric_names_back_to_standard_metric_keys(
        self,
    ) -> None:
        executed_metrics: list[str] = []

        class FakeMetric:
            def __init__(self, name: str) -> None:
                self.name = name

        class FakeEvaluationResult:
            def __init__(self, metric_name: str, score: float) -> None:
                self.scores = [{metric_name: score}]

        def fake_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            del dataset, llm, embeddings, kwargs
            executed_metrics.append(metrics[0].name)
            if metrics[0].name == "id_based_context_precision":
                return FakeEvaluationResult("id_based_context_precision", 1.0)
            return FakeEvaluationResult("id_based_context_recall", 0.8)

        def metric_factory(llm, embeddings, *, metric_names=None, projection=None):
            del llm, embeddings, metric_names
            self.assertIsNotNone(projection)
            return (
                FakeMetric("id_based_context_precision"),
                FakeMetric("id_based_context_recall"),
            )

        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=fake_evaluate,
            llm_factory=lambda resolved: {"model": resolved.llm_model},
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=metric_factory,
            metric_names=("context_precision", "context_recall"),
        )

        results = scorer(
            RagasProjection(
                case_id="case-id-based",
                user_input="学生证丢了怎么办？",
                response="应先挂失，再申请补办。",
                retrieved_contexts=("学生证遗失应及时挂失。",),
                reference="学生证遗失应及时挂失。",
                retrieved_context_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
                reference_context_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
            )
        )

        self.assertEqual(
            executed_metrics, ["id_based_context_precision", "id_based_context_recall"]
        )
        self.assertEqual(
            tuple(item.metric_name for item in results), ("context_precision", "context_recall")
        )
        self.assertEqual(results[0].score, 1.0)
        self.assertEqual(results[1].score, 0.8)

    def test_build_ragas_scorer_executes_only_requested_metric_names(self) -> None:
        executed_metrics: list[str] = []
        factory_metric_names: list[tuple[str, ...] | None] = []
        score_by_metric = {"faithfulness": 0.91}

        class FakeMetric:
            def __init__(self, name: str) -> None:
                self.name = name

        class FakeEvaluationResult:
            def __init__(self, metric_name: str) -> None:
                self.scores = [{metric_name: score_by_metric[metric_name]}]

        def fake_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            del dataset, llm, embeddings, kwargs
            executed_metrics.append(metrics[0].name)
            return FakeEvaluationResult(metrics[0].name)

        def metric_factory(llm, embeddings, *, metric_names=None):
            del llm, embeddings
            factory_metric_names.append(tuple(metric_names) if metric_names is not None else None)
            resolved_names = tuple(metric_names or build_default_ragas_metric_names())
            return tuple(FakeMetric(name) for name in resolved_names)

        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=fake_evaluate,
            llm_factory=lambda resolved: {"model": resolved.llm_model},
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=metric_factory,
            metric_names=("faithfulness",),
        )

        results = scorer(
            RagasProjection(
                case_id="case-single-metric",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertEqual(factory_metric_names, [("faithfulness",)])
        self.assertEqual(executed_metrics, ["faithfulness"])
        self.assertEqual(tuple(item.metric_name for item in results), ("faithfulness",))

    def test_build_ragas_scorer_uses_statement_generation_timeout_override_without_widening_other_timeouts(
        self,
    ) -> None:
        observed_stage_settings: list[tuple[str, SupplementalHTTPSettings]] = []

        class FakeFaithfulnessMetric:
            name = "faithfulness"

            def __init__(self, llm) -> None:
                self.llm = llm
                self.init_timeout: int | None = None

            def init(self, run_config) -> None:
                self.init_timeout = int(run_config.timeout)

            async def _create_statements(self, row, callbacks=None) -> StatementGeneratorOutput:
                del row, callbacks
                observed_stage_settings.append(("statement_generation", self.llm.http_settings))
                return StatementGeneratorOutput(statements=["statement-1"])

            async def _create_verdicts(self, row, statements, callbacks=None) -> NLIStatementOutput:
                del row, statements, callbacks
                observed_stage_settings.append(("nli_verdicts", self.llm.http_settings))
                return NLIStatementOutput(
                    statements=[
                        StatementFaithfulnessAnswer(
                            statement="statement-1",
                            reason="supported by evidence",
                            verdict=1,
                        )
                    ]
                )

            def _compute_score(self, answers) -> float:
                del answers
                return 1.0

        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "4",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "30",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "9",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "2",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=lambda **kwargs: (_ for _ in ()).throw(
                AssertionError("faithfulness should bypass ragas.evaluate")
            ),
            llm_factory=lambda resolved: type(
                "LLM", (), {"http_settings": resolved.http_settings}
            )(),
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=lambda llm, embeddings: (FakeFaithfulnessMetric(llm),),
            metric_names=("faithfulness",),
        )

        results = scorer(
            RagasProjection(
                case_id="case-stage-timeout",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertEqual(results[0].score, 1.0)
        self.assertEqual(observed_stage_settings[0][0], "statement_generation")
        self.assertEqual(observed_stage_settings[0][1].read_timeout_seconds, 180.0)
        self.assertEqual(observed_stage_settings[0][1].connect_timeout_seconds, 4.0)
        self.assertEqual(observed_stage_settings[0][1].write_timeout_seconds, 9.0)
        self.assertEqual(observed_stage_settings[0][1].pool_timeout_seconds, 2.0)
        self.assertEqual(observed_stage_settings[1][0], "nli_verdicts")
        self.assertEqual(observed_stage_settings[1][1].read_timeout_seconds, 30.0)

    def test_build_ragas_scorer_uses_configured_faithfulness_nli_batch_size(self) -> None:
        observed_batches: list[tuple[str, ...]] = []

        class FakeFaithfulnessMetric:
            name = "faithfulness"

            def __init__(self, llm) -> None:
                self.llm = llm

            def init(self, run_config) -> None:
                del run_config

            async def _create_statements(self, row, callbacks=None) -> StatementGeneratorOutput:
                del row, callbacks
                return StatementGeneratorOutput(
                    statements=[f"statement-{index}" for index in range(1, 8)]
                )

            async def _create_verdicts(self, row, statements, callbacks=None) -> NLIStatementOutput:
                del row, callbacks
                observed_batches.append(tuple(statements))
                return NLIStatementOutput(
                    statements=[
                        StatementFaithfulnessAnswer(
                            statement=statement,
                            reason="supported by evidence",
                            verdict=1,
                        )
                        for statement in statements
                    ]
                )

            def _compute_score(self, answers) -> float:
                del answers
                return 1.0

        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            },
            faithfulness_nli_batch_size=3,
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=lambda **kwargs: (_ for _ in ()).throw(
                AssertionError("faithfulness should bypass ragas.evaluate")
            ),
            llm_factory=lambda resolved: type(
                "LLM", (), {"http_settings": resolved.http_settings}
            )(),
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=lambda llm, embeddings: (FakeFaithfulnessMetric(llm),),
            metric_names=("faithfulness",),
        )

        results = scorer(
            RagasProjection(
                case_id="case-faithfulness-batches",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertEqual(results[0].score, 1.0)
        self.assertEqual(
            observed_batches,
            [
                ("statement-1", "statement-2", "statement-3"),
                ("statement-4", "statement-5", "statement-6"),
                ("statement-7",),
            ],
        )

    def test_build_ragas_scorer_uses_staged_faithfulness_checkpoint_resume_on_repair(self) -> None:
        class FakeFaithfulnessMetric:
            name = "faithfulness"

            def __init__(self, *, fail_on_verdict_call: int | None = None) -> None:
                self.fail_on_verdict_call = fail_on_verdict_call
                self.init_calls = 0
                self.statement_calls = 0
                self.verdict_calls = 0
                self.verdict_batches: list[tuple[str, ...]] = []

            def init(self, run_config) -> None:
                del run_config
                self.init_calls += 1

            async def _create_statements(self, row, callbacks=None) -> StatementGeneratorOutput:
                del row, callbacks
                self.statement_calls += 1
                return StatementGeneratorOutput(
                    statements=[
                        "statement-1",
                        "statement-2",
                        "statement-3",
                        "statement-4",
                        "statement-5",
                    ]
                )

            async def _create_verdicts(self, row, statements, callbacks=None) -> NLIStatementOutput:
                del row, callbacks
                self.verdict_calls += 1
                batch = tuple(str(item) for item in statements)
                self.verdict_batches.append(batch)
                if self.fail_on_verdict_call == self.verdict_calls:
                    raise RuntimeError("503 upstream temporarily unavailable")
                return NLIStatementOutput(
                    statements=[
                        StatementFaithfulnessAnswer(
                            statement=statement,
                            reason="supported by evidence",
                            verdict=1,
                        )
                        for statement in batch
                    ]
                )

            def _compute_score(self, answers) -> float:
                total = len(answers.statements)
                if total == 0:
                    return float("nan")
                faithful = sum(1 for item in answers.statements if int(item.verdict) == 1)
                return faithful / total

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        projection = RagasProjection(
            case_id="case-faithfulness-checkpoint",
            user_input="图书馆开放时间是什么？",
            response="图书馆开放时间是 08:00 到 22:00。",
            retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
            reference="图书馆开放时间为 08:00-22:00。",
        )

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "benchmark"
            repair_dir = Path(tmpdir) / "repair"
            first_metric = FakeFaithfulnessMetric(fail_on_verdict_call=2)
            first_scorer = build_ragas_scorer(
                settings,
                evaluate_fn=lambda **kwargs: (_ for _ in ()).throw(
                    AssertionError("faithfulness should bypass ragas.evaluate")
                ),
                llm_factory=lambda resolved: {"model": resolved.llm_model},
                embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
                metric_factory=lambda llm, embeddings: (first_metric,),
            )

            with bind_faithfulness_artifact_context(
                output_dir=benchmark_dir,
                run_number=1,
                benchmark_mode="run",
            ):
                first_results = first_scorer(projection)

            self.assertEqual(first_metric.init_calls, 1)
            self.assertEqual(first_metric.statement_calls, 1)
            self.assertEqual(
                first_metric.verdict_batches,
                [
                    ("statement-1", "statement-2", "statement-3", "statement-4"),
                    ("statement-5",),
                ],
            )
            self.assertEqual(first_results[0].verdict, "failed")
            self.assertEqual(first_results[0].metadata["faithfulness_stage"], "nli_verdicts")
            self.assertEqual(first_results[0].metadata["statement_count"], 5)
            self.assertEqual(first_results[0].metadata["completed_batch_count"], 1)
            self.assertEqual(first_results[0].metadata["remaining_batch_count"], 1)
            checkpoint_path = Path(str(first_results[0].metadata["checkpoint_path"]))
            self.assertTrue(checkpoint_path.exists())
            checkpoint_payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
            self.assertEqual(
                checkpoint_payload["stages"]["statement_generation"]["status"],
                "completed",
            )
            self.assertEqual(checkpoint_payload["stages"]["nli_verdicts"]["status"], "partial")
            self.assertEqual(
                sorted(checkpoint_payload["stages"]["nli_verdicts"]["batches"].keys()),
                ["0"],
            )

            second_metric = FakeFaithfulnessMetric()
            second_scorer = build_ragas_scorer(
                settings,
                evaluate_fn=lambda **kwargs: (_ for _ in ()).throw(
                    AssertionError("faithfulness should bypass ragas.evaluate")
                ),
                llm_factory=lambda resolved: {"model": resolved.llm_model},
                embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
                metric_factory=lambda llm, embeddings: (second_metric,),
            )

            with bind_faithfulness_artifact_context(
                output_dir=repair_dir,
                run_number=1,
                benchmark_mode="repair",
                source_output_dir=benchmark_dir,
            ):
                second_results = second_scorer(projection)

            self.assertEqual(second_metric.init_calls, 1)
            self.assertEqual(second_metric.statement_calls, 0)
            self.assertEqual(second_metric.verdict_batches, [("statement-5",)])
            self.assertAlmostEqual(second_results[0].score or 0.0, 1.0)
            self.assertEqual(second_results[0].metadata["statement_count"], 5)
            self.assertEqual(second_results[0].metadata["completed_batch_count"], 2)
            self.assertEqual(second_results[0].metadata["remaining_batch_count"], 0)
            self.assertEqual(
                Path(str(second_results[0].metadata["source_checkpoint_path"])),
                checkpoint_path,
            )
            repair_checkpoint_path = Path(str(second_results[0].metadata["checkpoint_path"]))
            self.assertTrue(repair_checkpoint_path.exists())
            repair_payload = json.loads(repair_checkpoint_path.read_text(encoding="utf-8"))
            self.assertEqual(repair_payload["stages"]["nli_verdicts"]["status"], "completed")
            self.assertEqual(repair_payload["stages"]["score_aggregation"]["status"], "completed")

    def test_build_default_ragas_metrics_binds_runtime_and_uses_single_generation_answer_relevancy(
        self,
    ) -> None:
        llm = object()
        embeddings = object()

        metrics = build_default_ragas_metrics(llm, embeddings)

        self.assertEqual(
            tuple(metric.name for metric in metrics), build_default_ragas_metric_names()
        )
        self.assertIs(metrics[0].llm, llm)
        self.assertIs(metrics[1].llm, llm)
        self.assertIs(metrics[1].embeddings, embeddings)
        self.assertEqual(metrics[1].strictness, 1)
        self.assertIs(metrics[2].llm, llm)
        self.assertIs(metrics[3].llm, llm)

    def test_build_default_ragas_metrics_adapts_chinese_prompts_when_target_language_is_configured(
        self,
    ) -> None:
        llm = object()
        embeddings = object()
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EVAL_RAGAS_TARGET_LANGUAGE": "chinese",
                "RAGAS_ADAPT_INSTRUCTION": "true",
            }
        )
        answer_calls: list[tuple[str, object, bool]] = []
        faithfulness_calls: list[tuple[str, object, bool]] = []

        async def fake_answer_adapt(self, *, target_language, llm, adapt_instruction=False):
            answer_calls.append((target_language, llm, adapt_instruction))
            return self

        async def fake_faithfulness_adapt(self, *, target_language, llm, adapt_instruction=False):
            faithfulness_calls.append((target_language, llm, adapt_instruction))
            return self

        with (
            patch(
                "ragas.metrics._answer_relevance.ResponseRelevancePrompt.adapt",
                new=fake_answer_adapt,
            ),
            patch(
                "ragas.metrics._faithfulness.StatementGeneratorPrompt.adapt",
                new=fake_faithfulness_adapt,
            ),
        ):
            metrics = build_default_ragas_metrics(llm, embeddings, settings=settings)

        self.assertEqual(
            tuple(metric.name for metric in metrics), build_default_ragas_metric_names()
        )
        self.assertEqual(answer_calls, [("chinese", llm, True)])
        self.assertEqual(faithfulness_calls, [("chinese", llm, True)])

    def test_build_ragas_scorer_maps_evaluation_scores_to_supplemental_results(self) -> None:
        captured_calls: list[dict[str, object]] = []
        score_by_metric = {
            "faithfulness": 0.91,
            "answer_relevancy": 0.88,
            "context_precision": 1.0,
            "context_recall": 0.84,
        }

        class FakeMetric:
            def __init__(self, name: str) -> None:
                self.name = name

        class FakeEvaluationResult:
            def __init__(self, metric_name: str) -> None:
                self.scores = [{metric_name: score_by_metric[metric_name]}]

        def fake_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            captured_calls.append(
                {
                    "dataset": dataset,
                    "metrics": metrics,
                    "llm": llm,
                    "embeddings": embeddings,
                    "kwargs": kwargs,
                }
            )
            return FakeEvaluationResult(metrics[0].name)

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "qwen-reasoning",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "45",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=fake_evaluate,
            llm_factory=lambda resolved: {"model": resolved.llm_model},
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=lambda llm, embeddings: (
                FakeMetric("faithfulness"),
                FakeMetric("answer_relevancy"),
                FakeMetric("context_precision"),
                FakeMetric("context_recall"),
            ),
        )
        results = scorer(
            RagasProjection(
                case_id="case-2",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertEqual(
            build_default_ragas_metric_names(),
            ("faithfulness", "answer_relevancy", "context_precision", "context_recall"),
        )
        self.assertEqual(
            tuple(item.metric_name for item in results), build_default_ragas_metric_names()
        )
        self.assertEqual(results[0].score, 0.91)
        self.assertEqual(results[1].score, 0.88)
        self.assertEqual(results[2].score, 1.0)
        self.assertEqual(results[3].score, 0.84)
        self.assertTrue(all(item.adapter_id == "ragas" for item in results))
        self.assertTrue(all(item.gating is False for item in results))

        self.assertEqual(len(captured_calls), 4)
        self.assertEqual(
            [tuple(metric.name for metric in call["metrics"]) for call in captured_calls],
            [("faithfulness",), ("answer_relevancy",), ("context_precision",), ("context_recall",)],
        )

        dataset = captured_calls[0]["dataset"]
        self.assertEqual(len(dataset.samples), 1)
        self.assertEqual(dataset.samples[0].user_input, "图书馆开放时间是什么？")
        self.assertEqual(captured_calls[0]["llm"], {"model": "qwen-reasoning"})
        self.assertEqual(captured_calls[0]["embeddings"], {"model": "Qwen3-Embedding-4B"})
        self.assertTrue(all(call["kwargs"]["show_progress"] is False for call in captured_calls))
        self.assertTrue(all(call["kwargs"]["raise_exceptions"] is True for call in captured_calls))
        self.assertTrue(all(call["kwargs"]["run_config"].timeout == 45 for call in captured_calls))
        self.assertTrue(
            all(call["kwargs"]["run_config"].max_retries == 0 for call in captured_calls)
        )
        self.assertTrue(
            all(call["kwargs"]["run_config"].max_workers == 1 for call in captured_calls)
        )

    def test_build_ragas_scorer_marks_single_metric_timeout_as_failed_without_retrying(
        self,
    ) -> None:
        attempts: dict[str, int] = {}
        score_by_metric = {
            "faithfulness": 0.91,
            "context_precision": 1.0,
            "context_recall": 0.84,
        }

        class FakeMetric:
            def __init__(self, name: str) -> None:
                self.name = name

        class FakeEvaluationResult:
            def __init__(self, metric_name: str) -> None:
                self.scores = [{metric_name: score_by_metric[metric_name]}]

        def flaky_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            del dataset, llm, embeddings, kwargs
            metric_name = metrics[0].name
            attempts[metric_name] = attempts.get(metric_name, 0) + 1
            if metric_name == "answer_relevancy":
                raise TimeoutError("judge timed out")
            return FakeEvaluationResult(metric_name)

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "qwen-reasoning",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=flaky_evaluate,
            llm_factory=lambda resolved: {"model": resolved.llm_model},
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=lambda llm, embeddings: (
                FakeMetric("faithfulness"),
                FakeMetric("answer_relevancy"),
                FakeMetric("context_precision"),
                FakeMetric("context_recall"),
            ),
        )

        results = scorer(
            RagasProjection(
                case_id="case-retry",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertEqual(
            tuple(item.metric_name for item in results), build_default_ragas_metric_names()
        )
        self.assertEqual(results[0].score, 0.91)
        self.assertEqual(results[1].verdict, "failed")
        self.assertIsNone(results[1].score)
        self.assertIn("judge timed out", results[1].rationale)
        self.assertEqual(results[1].metadata["judge_error"], "TimeoutError")
        self.assertEqual(results[2].score, 1.0)
        self.assertEqual(results[3].score, 0.84)
        self.assertEqual(
            attempts,
            {
                "faithfulness": 1,
                "answer_relevancy": 1,
                "context_precision": 1,
                "context_recall": 1,
            },
        )

    def test_build_ragas_scorer_marks_single_metric_runtime_error_as_failed_without_retrying(
        self,
    ) -> None:
        attempts: dict[str, int] = {}
        score_by_metric = {
            "faithfulness": 0.91,
            "answer_relevancy": 0.88,
            "context_recall": 0.84,
        }

        class FakeMetric:
            def __init__(self, name: str) -> None:
                self.name = name

        class FakeEvaluationResult:
            def __init__(self, metric_name: str) -> None:
                self.scores = [{metric_name: score_by_metric[metric_name]}]

        def flaky_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            del dataset, llm, embeddings, kwargs
            metric_name = metrics[0].name
            attempts[metric_name] = attempts.get(metric_name, 0) + 1
            if metric_name == "context_precision":
                raise RuntimeError(
                    '500 {"error":{"message":"upstream error: do request failed","type":"new_api_error","code":"do_request_failed"}}'
                )
            return FakeEvaluationResult(metric_name)

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "qwen-reasoning",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=flaky_evaluate,
            llm_factory=lambda resolved: {"model": resolved.llm_model},
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=lambda llm, embeddings: (
                FakeMetric("faithfulness"),
                FakeMetric("answer_relevancy"),
                FakeMetric("context_precision"),
                FakeMetric("context_recall"),
            ),
        )

        results = scorer(
            RagasProjection(
                case_id="case-retry-do-request-failed",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertEqual(
            tuple(item.metric_name for item in results), build_default_ragas_metric_names()
        )
        self.assertEqual(results[0].score, 0.91)
        self.assertEqual(results[1].score, 0.88)
        self.assertEqual(results[2].verdict, "failed")
        self.assertIsNone(results[2].score)
        self.assertIn("do request failed", results[2].rationale)
        self.assertEqual(results[2].metadata["judge_error"], "RuntimeError")
        self.assertEqual(results[3].score, 0.84)
        self.assertEqual(
            attempts,
            {
                "faithfulness": 1,
                "answer_relevancy": 1,
                "context_precision": 1,
                "context_recall": 1,
            },
        )

    def test_build_ragas_scorer_redacts_secrets_and_falls_back_to_error_type_for_empty_runtime_messages(
        self,
    ) -> None:
        class FakeMetric:
            def __init__(self, name: str) -> None:
                self.name = name

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "qwen-reasoning",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=lambda **kwargs: (_ for _ in ()).throw(
                RuntimeError(
                    "circuit_open: provider origin https://llm.example::sk-secret-token is in cooldown"
                )
            ),
            llm_factory=lambda resolved: {"model": resolved.llm_model},
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=lambda llm, embeddings: (FakeMetric("faithfulness"),),
        )

        results = scorer(
            RagasProjection(
                case_id="case-redaction",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertEqual(results[0].verdict, "failed")
        self.assertIn("circuit_open", results[0].rationale)
        self.assertNotIn("sk-secret-token", results[0].rationale)

        empty_timeout_scorer = build_ragas_scorer(
            settings,
            evaluate_fn=lambda **kwargs: (_ for _ in ()).throw(TimeoutError()),
            llm_factory=lambda resolved: {"model": resolved.llm_model},
            embeddings_factory=lambda resolved: {"model": resolved.embedding_model},
            metric_factory=lambda llm, embeddings: (FakeMetric("faithfulness"),),
        )

        empty_timeout_results = empty_timeout_scorer(
            RagasProjection(
                case_id="case-timeout-empty-message",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
            )
        )

        self.assertIn("TimeoutError", empty_timeout_results[0].rationale)
