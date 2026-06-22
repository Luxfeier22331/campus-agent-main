from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    NLIStatementOutput,
    RagasProjection,
    StatementFaithfulnessAnswer,
    StatementGeneratorOutput,
    SupplementalHTTPSettings,
    build_default_ragas_metric_names,
    build_ragas_scorer,
    ragas_settings_from_projection,
    unittest,
)


class RagasScorerMetricBindingTest(unittest.TestCase):
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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
