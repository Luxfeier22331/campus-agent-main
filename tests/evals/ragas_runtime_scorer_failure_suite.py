from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    RagasProjection,
    RagasSettings,
    build_default_ragas_metric_names,
    build_ragas_scorer,
    unittest,
)


class RagasScorerFailureTest(unittest.TestCase):
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
