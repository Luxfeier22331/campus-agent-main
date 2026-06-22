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
    ragas_settings_from_projection,
    unittest,
)


class RagasScorerDefaultsTest(unittest.TestCase):
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

        settings = ragas_settings_from_projection(
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
        settings = RagasSettings(
            llm_api_key="llm-key",
            llm_model="gpt-5.4",
            embedding_api_key="embed-key",
            embedding_model="Qwen3-Embedding-4B",
            target_language="chinese",
            adapt_instruction=True,
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

        settings = RagasSettings(
            llm_base_url="https://llm.example/v1",
            llm_api_key="llm-key",
            llm_model="qwen-reasoning",
            embedding_base_url="https://embed.example/v1",
            embedding_api_key="embed-key",
            embedding_model="Qwen3-Embedding-4B",
            http_settings=SupplementalHTTPSettings(read_timeout_seconds=45),
            max_workers=2,
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
            all(call["kwargs"]["run_config"].max_workers == 2 for call in captured_calls)
        )
