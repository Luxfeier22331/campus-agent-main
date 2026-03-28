from __future__ import annotations

import asyncio
import json
import unittest

import httpx
from langchain_core.messages import HumanMessage
from langchain_core.prompt_values import StringPromptValue

from campus_evals import (
    RagasProjection,
    RagasSettings,
    build_langchain_chat_model,
    build_default_ragas_metric_names,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    build_ragas_dataset,
    build_ragas_scorer,
)


class RagasSettingsTest(unittest.TestCase):
    def test_from_env_reads_openai_compatible_llm_and_embedding_settings(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "LLM_CHAT_MODEL": "qwen-chat",
                "LLM_REASONING_MODEL": "qwen-reasoning",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EMBEDDING_TIMEOUT_SECONDS": "45",
            }
        )

        self.assertEqual(settings.llm_base_url, "https://llm.example/v1")
        self.assertEqual(settings.llm_api_key, "llm-key")
        self.assertEqual(settings.llm_model, "qwen-reasoning")
        self.assertTrue(settings.use_responses_api)
        self.assertEqual(settings.embedding_base_url, "https://embed.example/v1")
        self.assertEqual(settings.embedding_api_key, "embed-key")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.request_timeout_seconds, 45.0)

    def test_from_env_prefers_ragas_llm_model_over_reasoning_and_chat_model(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "RAGAS_LLM_MODEL": "gpt-5.4",
                "LLM_REASONING_MODEL": "gpt-5.4-mini",
                "LLM_CHAT_MODEL": "gpt-4.1-mini",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(settings.llm_model, "gpt-5.4")

    def test_from_env_requires_llm_and_embedding_secrets_and_models(self) -> None:
        with self.assertRaisesRegex(ValueError, "LLM_API_KEY is required"):
            RagasSettings.from_env(
                {
                    "LLM_CHAT_MODEL": "qwen-chat",
                    "EMBEDDING_API_KEY": "embed-key",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                }
            )

    def test_build_langchain_chat_model_uses_responses_api(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "RAGAS_LLM_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        model = build_langchain_chat_model(settings)

        self.assertEqual(model.model_name, "gpt-5.4")
        self.assertTrue(model.use_responses_api)

    def test_from_env_allows_explicit_responses_api_opt_out(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "LLM_REASONING_MODEL": "gpt-5.4",
                "RAGAS_USE_RESPONSES_API": "false",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertFalse(settings.use_responses_api)

    def test_build_langchain_chat_model_strips_n_from_responses_payload(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "RAGAS_LLM_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        model = build_langchain_chat_model(settings)
        payload = model._get_request_payload([HumanMessage(content="只回复 OK")], n=1)

        self.assertIn("input", payload)
        self.assertNotIn("n", payload)


class RagasDatasetTest(unittest.TestCase):
    def test_build_ragas_dataset_projects_single_turn_sample(self) -> None:
        dataset = build_ragas_dataset(
            RagasProjection(
                case_id="case-1",
                user_input="图书馆开放时间是什么？",
                response="08:00 到 22:00。",
                retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                reference="图书馆开放时间为 08:00-22:00。",
                metadata={"collection": "student_handbook"},
            )
        )

        self.assertEqual(len(dataset.samples), 1)
        sample = dataset.samples[0]
        self.assertEqual(sample.user_input, "图书馆开放时间是什么？")
        self.assertEqual(sample.response, "08:00 到 22:00。")
        self.assertEqual(sample.reference, "图书馆开放时间为 08:00-22:00。")
        self.assertEqual(sample.retrieved_contexts, ["图书馆开放时间为 08:00-22:00。"])


class RagasHttpTransportTest(unittest.TestCase):
    def test_build_http_ragas_llm_posts_responses_payload_without_sdk_only_fields(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ]
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "RAGAS_LLM_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        async_client = httpx.AsyncClient(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, async_client=async_client)
        result = asyncio.run(llm.agenerate_text(StringPromptValue(text="只回复 OK")))
        asyncio.run(async_client.aclose())

        self.assertEqual(result.generations[0][0].text, "OK")
        self.assertEqual(captured["url"], "https://llm.example/v1/responses")
        self.assertEqual(
            captured["body"],
            {
                "model": "gpt-5.4",
                "stream": False,
                "input": [{"role": "user", "type": "message", "content": "只回复 OK"}],
                "temperature": 0.01,
            },
        )

    def test_build_http_ragas_embeddings_posts_embedding_payload(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                json={
                    "error": None,
                    "data": [
                        {"index": 1, "embedding": [2.0, 2.5]},
                        {"index": 0, "embedding": [1.0, 1.5]},
                    ]
                },
            )

        settings = RagasSettings.from_env(
            {
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "LLM_API_KEY": "llm-key",
                "LLM_REASONING_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        sync_client = httpx.Client(
            base_url="https://embed.example/v1",
            transport=httpx.MockTransport(handler),
        )
        embeddings = build_http_ragas_embeddings(settings, sync_client=sync_client)
        result = embeddings.embed_documents(["甲", "乙"])
        sync_client.close()

        self.assertEqual(result, [[1.0, 1.5], [2.0, 2.5]])
        self.assertEqual(captured["url"], "https://embed.example/v1/embeddings")
        self.assertEqual(
            captured["body"],
            {
                "model": "Qwen3-Embedding-4B",
                "input": ["甲", "乙"],
                "dimensions": 2560,
            },
        )


class RagasScorerTest(unittest.TestCase):
    def test_build_ragas_scorer_maps_evaluation_scores_to_supplemental_results(self) -> None:
        captured: dict[str, object] = {}

        class FakeMetric:
            def __init__(self, name: str) -> None:
                self.name = name

        class FakeEvaluationResult:
            def __init__(self) -> None:
                self.scores = [
                    {
                        "faithfulness": 0.91,
                        "answer_relevancy": 0.88,
                        "context_precision": 1.0,
                        "context_recall": 0.84,
                    }
                ]

        def fake_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            captured["dataset"] = dataset
            captured["metrics"] = metrics
            captured["llm"] = llm
            captured["embeddings"] = embeddings
            captured["kwargs"] = kwargs
            return FakeEvaluationResult()

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "LLM_REASONING_MODEL": "qwen-reasoning",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EMBEDDING_TIMEOUT_SECONDS": "45",
            }
        )

        scorer = build_ragas_scorer(
            settings,
            evaluate_fn=fake_evaluate,
            llm_factory=lambda resolved: {"model": resolved.llm_model, "use_responses_api": resolved.use_responses_api},
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

        self.assertEqual(build_default_ragas_metric_names(), ("faithfulness", "answer_relevancy", "context_precision", "context_recall"))
        self.assertEqual(tuple(item.metric_name for item in results), build_default_ragas_metric_names())
        self.assertEqual(results[0].score, 0.91)
        self.assertEqual(results[1].score, 0.88)
        self.assertEqual(results[2].score, 1.0)
        self.assertEqual(results[3].score, 0.84)
        self.assertTrue(all(item.adapter_id == "ragas" for item in results))
        self.assertTrue(all(item.gating is False for item in results))

        dataset = captured["dataset"]
        self.assertEqual(len(dataset.samples), 1)
        self.assertEqual(dataset.samples[0].user_input, "图书馆开放时间是什么？")
        self.assertEqual(tuple(metric.name for metric in captured["metrics"]), build_default_ragas_metric_names())
        self.assertEqual(captured["llm"], {"model": "qwen-reasoning", "use_responses_api": True})
        self.assertEqual(captured["embeddings"], {"model": "Qwen3-Embedding-4B"})
        self.assertEqual(captured["kwargs"]["show_progress"], False)
        self.assertEqual(captured["kwargs"]["raise_exceptions"], True)
        self.assertEqual(captured["kwargs"]["run_config"].timeout, 45)
        self.assertEqual(captured["kwargs"]["run_config"].max_retries, 1)
        self.assertEqual(captured["kwargs"]["run_config"].max_workers, 1)


if __name__ == "__main__":
    unittest.main()
