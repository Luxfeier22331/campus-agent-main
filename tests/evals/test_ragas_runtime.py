from __future__ import annotations

import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import httpx
from langchain_core.prompt_values import StringPromptValue
from ragas.llms.base import InstructorBaseRagasLLM
from ragas.metrics._faithfulness import NLIStatementOutput, StatementFaithfulnessAnswer, StatementGeneratorOutput

from campus_shared.provider_config import ProviderConfigResolutionError
from campus_evals import (
    RagasProjection,
    RagasSettings,
    build_default_ragas_metric_names,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    build_ragas_dataset,
    build_ragas_scorer,
    build_ragas_supplemental_adapter_from_env,
)
from campus_evals.faithfulness_runtime import bind_faithfulness_artifact_context
from campus_evals.ragas_adapter import build_default_ragas_metrics
from campus_evals.settings import SupplementalHTTPSettings
from campus_evals.supplemental_http import (
    OpenAICompatibleResponsesLLM,
    SupplementalPreflightFailedError,
    _retry_delay_seconds,
    reset_supplemental_http_runtime_state_for_tests,
)


class RagasSettingsTest(unittest.TestCase):
    def test_supplemental_http_settings_from_env_reads_fine_grained_runtime_controls(self) -> None:
        settings = SupplementalHTTPSettings.from_env(
            {
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "2.5",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "18",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "7",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "1.5",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "1",
                "SUPPLEMENTAL_HTTP_RETRY_BACKOFF_SECONDS": "0.25",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD": "4",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS": "45",
                "SUPPLEMENTAL_HTTP_PREFLIGHT_TIMEOUT_SECONDS": "6",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "0.5",
            }
        )

        self.assertEqual(settings.connect_timeout_seconds, 2.5)
        self.assertEqual(settings.read_timeout_seconds, 18.0)
        self.assertEqual(settings.write_timeout_seconds, 7.0)
        self.assertEqual(settings.pool_timeout_seconds, 1.5)
        self.assertEqual(settings.retry_attempts, 1)
        self.assertEqual(settings.retry_backoff_seconds, 0.25)
        self.assertEqual(settings.circuit_breaker_failure_threshold, 4)
        self.assertEqual(settings.circuit_breaker_cooldown_seconds, 45.0)
        self.assertEqual(settings.preflight_timeout_seconds, 6.0)
        self.assertEqual(settings.request_min_interval_seconds, 0.5)

    def test_supplemental_http_settings_derive_request_interval_from_requests_per_minute(self) -> None:
        settings = SupplementalHTTPSettings.from_env(
            {
                "SUPPLEMENTAL_HTTP_REQUESTS_PER_MINUTE": "10",
            }
        )

        self.assertEqual(settings.requests_per_minute, 10.0)
        self.assertEqual(settings.request_min_interval_seconds, 6.0)

    def test_supplemental_http_settings_prefer_explicit_interval_over_requests_per_minute(self) -> None:
        settings = SupplementalHTTPSettings.from_env(
            {
                "SUPPLEMENTAL_HTTP_REQUESTS_PER_MINUTE": "10",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "7.5",
            }
        )

        self.assertEqual(settings.requests_per_minute, 10.0)
        self.assertEqual(settings.request_min_interval_seconds, 7.5)

    def test_from_env_reads_openai_compatible_llm_and_embedding_settings(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "4",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "75",
                "SUPPLEMENTAL_HTTP_WRITE_TIMEOUT_SECONDS": "9",
                "SUPPLEMENTAL_HTTP_POOL_TIMEOUT_SECONDS": "2",
                "RAGAS_REASONING_EFFORT": "none",
                "RAGAS_TEXT_VERBOSITY": "low",
                "RAGAS_MAX_OUTPUT_TOKENS": "256",
            }
        )

        self.assertEqual(settings.llm_base_url, "https://llm.example/v1")
        self.assertEqual(settings.llm_api_key, "llm-key")
        self.assertEqual(settings.llm_model, "gpt-5.4")
        self.assertEqual(settings.embedding_base_url, "https://embed.example/v1")
        self.assertEqual(settings.embedding_api_key, "embed-key")
        self.assertEqual(settings.embedding_model, "Qwen3-Embedding-4B")
        self.assertEqual(settings.embedding_dimensions, 2560)
        self.assertEqual(settings.http_settings.connect_timeout_seconds, 4.0)
        self.assertEqual(settings.http_settings.read_timeout_seconds, 75.0)
        self.assertEqual(settings.http_settings.write_timeout_seconds, 9.0)
        self.assertEqual(settings.http_settings.pool_timeout_seconds, 2.0)
        self.assertEqual(settings.http_settings.request_min_interval_seconds, 0.0)
        self.assertEqual(settings.reasoning_effort, "none")
        self.assertEqual(settings.text_verbosity, "low")
        self.assertEqual(settings.max_output_tokens, 256)

    def test_from_env_reads_request_pacing_override(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "12.5",
            }
        )

        self.assertEqual(settings.http_settings.request_min_interval_seconds, 12.5)

    def test_from_env_ignores_legacy_ragas_timeout_knobs(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "RAGAS_REQUEST_TIMEOUT_SECONDS": "180",
                "RAGAS_REQUEST_MIN_INTERVAL_SECONDS": "30",
            }
        )

        self.assertEqual(settings.http_settings.connect_timeout_seconds, 10.0)
        self.assertEqual(settings.http_settings.read_timeout_seconds, 30.0)
        self.assertEqual(settings.http_settings.preflight_timeout_seconds, 20.0)
        self.assertEqual(settings.http_settings.request_min_interval_seconds, 0.0)

    def test_from_env_requires_eval_ragas_model(self) -> None:
        with self.assertRaisesRegex(ValueError, "EVAL_RAGAS_MODEL is required"):
            RagasSettings.from_env(
                {
                    "LLM_API_KEY": "llm-key",
                    "EMBEDDING_API_KEY": "embed-key",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                }
            )

    def test_from_env_uses_eval_ragas_model_as_single_model_entrypoint(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(settings.llm_model, "gpt-5.4")

    def test_from_env_prefers_eval_scoped_keys_over_shared_runtime_keys(self) -> None:
        settings = RagasSettings.from_env(
            {
                "EVAL_LLM_BASE_URL": "https://eval-llm.example/v1",
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4-eval",
                "LLM_BASE_URL": "https://shared-llm.example/v1",
                "LLM_API_KEY": "shared-llm-key",
                "EVAL_EMBEDDING_BASE_URL": "https://eval-embed.example/v1",
                "EVAL_EMBEDDING_API_KEY": "eval-embed-key",
                "EVAL_EMBEDDING_MODEL": "text-embedding-3-large",
                "EMBEDDING_BASE_URL": "https://shared-embed.example/v1",
                "EMBEDDING_API_KEY": "shared-embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(settings.llm_base_url, "https://eval-llm.example/v1")
        self.assertEqual(settings.llm_api_key, "eval-llm-key")
        self.assertEqual(settings.llm_model, "gpt-5.4-eval")
        self.assertEqual(settings.embedding_base_url, "https://eval-embed.example/v1")
        self.assertEqual(settings.embedding_api_key, "eval-embed-key")
        self.assertEqual(settings.embedding_model, "text-embedding-3-large")

    def test_from_env_accepts_repo_tracked_http_settings_override(self) -> None:
        settings = RagasSettings.from_env(
            {
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4-eval",
                "EVAL_EMBEDDING_API_KEY": "eval-embed-key",
                "EVAL_EMBEDDING_MODEL": "text-embedding-3-large",
            },
            http_settings=SupplementalHTTPSettings(read_timeout_seconds=45.0),
        )

        self.assertEqual(settings.http_settings.read_timeout_seconds, 45.0)

    def test_from_env_extends_statement_generation_read_timeout_without_widening_other_timeouts(self) -> None:
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

        statement_settings = settings.http_settings_for_metric_stage(
            metric_name="faithfulness",
            stage_name="statement_generation",
        )
        default_stage_settings = settings.http_settings_for_metric_stage(
            metric_name="faithfulness",
            stage_name="nli_verdicts",
        )

        self.assertEqual(statement_settings.read_timeout_seconds, 180.0)
        self.assertEqual(statement_settings.connect_timeout_seconds, 4.0)
        self.assertEqual(statement_settings.write_timeout_seconds, 9.0)
        self.assertEqual(statement_settings.pool_timeout_seconds, 2.0)
        self.assertEqual(default_stage_settings.read_timeout_seconds, 30.0)

    def test_from_env_reads_prompt_language_adaptation_settings(self) -> None:
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

        self.assertEqual(settings.target_language, "chinese")
        self.assertTrue(settings.adapt_instruction)

    def test_from_env_requires_llm_and_embedding_secrets_and_models(self) -> None:
        with self.assertRaises(ProviderConfigResolutionError) as raised:
            RagasSettings.from_env(
                {
                    "EVAL_RAGAS_MODEL": "gpt-5.4",
                    "EMBEDDING_API_KEY": "embed-key",
                    "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                }
            )
        self.assertEqual(raised.exception.surface_name, "eval.ragas")
        self.assertEqual(raised.exception.checked_keys, ("EVAL_LLM_API_KEY", "LLM_API_KEY"))
        self.assertIn("eval.ragas", str(raised.exception))
        self.assertIn("EVAL_LLM_API_KEY", str(raised.exception))

    def test_build_ragas_supplemental_adapter_from_env_exposes_default_metric_names(self) -> None:
        adapter = build_ragas_supplemental_adapter_from_env(
            {
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(adapter.metric_names, build_default_ragas_metric_names())


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

    def test_build_ragas_dataset_projects_reference_and_context_ids(self) -> None:
        dataset = build_ragas_dataset(
            RagasProjection(
                case_id="case-with-ids",
                user_input="学生证丢了怎么办？",
                response="应先挂失，再申请补办。",
                retrieved_contexts=("学生证遗失应及时挂失。",),
                reference="学生证遗失应及时挂失。",
                retrieved_context_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
                reference_context_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
                reference_contexts=("学生证遗失应及时挂失。",),
            )
        )

        sample = dataset.samples[0]
        self.assertEqual(sample.retrieved_context_ids, ["handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"])
        self.assertEqual(sample.reference_context_ids, ["handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"])
        self.assertEqual(sample.reference_contexts, ["学生证遗失应及时挂失。"])


class RagasHttpTransportTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_supplemental_http_runtime_state_for_tests()

    def test_build_http_ragas_llm_uses_text_first_ragas_runtime(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        llm = build_http_ragas_llm(settings)

        self.assertFalse(isinstance(llm, InstructorBaseRagasLLM))
        self.assertTrue(hasattr(llm, "agenerate_text"))

    def test_build_http_ragas_llm_opens_shared_circuit_breaker_after_repeated_provider_failures(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                503,
                request=request,
                text='{"error":{"message":"Service temporarily unavailable","type":"api_error"}}',
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "0",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD": "2",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_COOLDOWN_SECONDS": "60",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        with self.assertRaisesRegex(RuntimeError, "503"):
            llm.generate_text(StringPromptValue(text="只回复 OK"))
        with self.assertRaisesRegex(RuntimeError, "503"):
            llm.generate_text(StringPromptValue(text="只回复 OK"))
        with self.assertRaisesRegex(RuntimeError, "circuit_open") as raised:
            llm.generate_text(StringPromptValue(text="只回复 OK"))

        sync_client.close()
        self.assertEqual(attempts, 2)
        self.assertNotIn("llm-key", str(raised.exception))

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
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "RAGAS_REASONING_EFFORT": "none",
                "RAGAS_TEXT_VERBOSITY": "low",
                "RAGAS_MAX_OUTPUT_TOKENS": "128",
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
                "reasoning": {"effort": "none"},
                "text": {"format": {"type": "text"}, "verbosity": "low"},
                "max_output_tokens": 128,
            },
        )

    def test_build_http_ragas_llm_generate_text_retries_retryable_server_error(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    500,
                    request=request,
                    text='{"error":{"message":"temporary upstream error","type":"bad_response_body"}}',
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        result = llm.generate_text(StringPromptValue(text="只回复 OK"))

        sync_client.close()
        self.assertEqual(result.generations[0][0].text, "OK")
        self.assertEqual(attempts, 2)

    def test_build_http_ragas_llm_generate_text_retries_do_request_failed_server_error(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    500,
                    request=request,
                    text='{"error":{"message":"upstream error: do request failed","type":"new_api_error","code":"do_request_failed"}}',
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        result = llm.generate_text(StringPromptValue(text="只回复 OK"))

        sync_client.close()
        self.assertEqual(result.generations[0][0].text, "OK")
        self.assertEqual(attempts, 2)

    def test_build_http_ragas_llm_agenerate_text_fans_out_n_requests_concurrently(self) -> None:
        class CoordinatedAsyncClient:
            def __init__(self, expected_calls: int) -> None:
                self.expected_calls = expected_calls
                self.started = 0
                self.in_flight = 0
                self.max_in_flight = 0
                self.release = asyncio.Event()

            async def post(self, path, json, headers):
                del headers
                self.started += 1
                self.in_flight += 1
                self.max_in_flight = max(self.max_in_flight, self.in_flight)
                if self.started >= self.expected_calls:
                    self.release.set()
                try:
                    await asyncio.wait_for(self.release.wait(), timeout=0.2)
                finally:
                    self.in_flight -= 1
                return httpx.Response(
                    200,
                    request=httpx.Request("POST", f"https://llm.example/v1{path}"),
                    json={
                        "error": None,
                        "output": [
                            {
                                "content": [
                                    {"type": "output_text", "text": json["input"][0]["content"]},
                                ]
                            }
                        ],
                    },
                )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        async_client = CoordinatedAsyncClient(expected_calls=3)
        llm = build_http_ragas_llm(settings, async_client=async_client)

        result = asyncio.run(llm.agenerate_text(StringPromptValue(text="只回复 OK"), n=3))

        self.assertEqual(async_client.started, 3)
        self.assertEqual(async_client.max_in_flight, 3)
        self.assertEqual(len(result.generations[0]), 3)

    def test_build_http_ragas_llm_agenerate_text_retries_retryable_server_error(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    500,
                    request=request,
                    text='{"error":{"message":"temporary upstream error","type":"bad_response_body"}}',
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
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
        self.assertEqual(attempts, 2)

    def test_build_http_ragas_llm_reuses_internal_async_client_between_calls(self) -> None:
        created_clients: list[object] = []

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs
                created_clients.append(self)

            async def post(self, path, json, headers):
                del path, headers
                return httpx.Response(
                    200,
                    request=httpx.Request("POST", "https://llm.example/v1/responses"),
                    json={
                        "error": None,
                        "output": [
                            {
                                "content": [
                                    {"type": "output_text", "text": json["input"][0]["content"]},
                                ]
                            }
                        ],
                    },
                )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        with patch("campus_evals.supplemental_http.httpx.AsyncClient", FakeAsyncClient):
            llm = build_http_ragas_llm(settings)
            async def run_two_calls() -> None:
                await llm.agenerate_text(StringPromptValue(text="first"))
                await llm.agenerate_text(StringPromptValue(text="second"))

            asyncio.run(run_two_calls())

        self.assertEqual(len(created_clients), 1)

    def test_build_http_ragas_llm_reuses_internal_sync_client_between_calls(self) -> None:
        created_clients: list[object] = []

        class FakeSyncClient:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs
                created_clients.append(self)

            def post(self, path, json, headers):
                del path, headers
                return httpx.Response(
                    200,
                    request=httpx.Request("POST", "https://llm.example/v1/responses"),
                    json={
                        "error": None,
                        "output": [
                            {
                                "content": [
                                    {"type": "output_text", "text": json["input"][0]["content"]},
                                ]
                            }
                        ],
                    },
                )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        with patch("campus_evals.supplemental_http.httpx.Client", FakeSyncClient):
            llm = build_http_ragas_llm(settings)
            llm.generate_text(StringPromptValue(text="first"))
            llm.generate_text(StringPromptValue(text="second"))

        self.assertEqual(len(created_clients), 1)

    def test_build_http_ragas_llm_reuses_request_pacer_for_same_provider_key(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "12.5",
            }
        )

        first = build_http_ragas_llm(settings)
        second = build_http_ragas_llm(settings)

        self.assertIsNotNone(first.request_pacer)
        self.assertIs(first.request_pacer, second.request_pacer)

    def test_build_http_ragas_llm_preflight_failure_opens_runtime_breaker_until_cooldown(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    503,
                    request=request,
                    text='{"error":{"message":"Service temporarily unavailable","type":"api_error"}}',
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "0",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD": "1",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        with self.assertRaises(SupplementalPreflightFailedError):
            llm.preflight_sync()

        with self.assertRaisesRegex(RuntimeError, "circuit_open"):
            llm.generate_text(StringPromptValue(text="只回复 OK"))

        sync_client.close()
        self.assertEqual(attempts, 1)

    def test_build_http_ragas_llm_hard_unavailable_provider_opens_shared_circuit_after_single_failure(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                500,
                request=request,
                text='{"error":{"message":"auth_unavailable: no auth available","type":"new_api_error"}}',
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "1",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD": "3",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        with self.assertRaisesRegex(RuntimeError, "auth_unavailable"):
            llm.generate_text(StringPromptValue(text="只回复 OK"))
        with self.assertRaisesRegex(RuntimeError, "circuit_open"):
            llm.generate_text(StringPromptValue(text="只回复 OK"))

        sync_client.close()
        self.assertEqual(attempts, 1)

    def test_build_http_ragas_llm_preflight_is_cached_for_same_runtime_signature(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        first_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        second_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        first = build_http_ragas_llm(settings, sync_client=first_client)
        second = build_http_ragas_llm(settings, sync_client=second_client)

        first_result = first.preflight_sync()
        second_result = second.preflight_sync()

        first_client.close()
        second_client.close()
        self.assertEqual(attempts, 1)
        self.assertEqual(first_result["output_text"], "OK")
        self.assertEqual(second_result["output_text"], "OK")

    def test_build_http_ragas_llm_preflight_uses_text_responses_probe(self) -> None:
        captured_payloads: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            captured_payloads.append(payload)
            text_config = payload.get("text") or {}
            format_config = text_config.get("format") or {}
            if format_config.get("type") == "json_schema":
                return httpx.Response(503, request=request, text='{"error":{"message":"structured unavailable","type":"api_error"}}')
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "0",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        result = llm.preflight_sync()

        sync_client.close()
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["output_text"], "OK")
        self.assertEqual(len(captured_payloads), 1)
        self.assertNotEqual(((captured_payloads[0].get("text") or {}).get("format") or {}).get("type"), "json_schema")

    def test_openai_compatible_responses_llm_preflight_supports_providers_requiring_closed_json_schema(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            text_config = payload.get("text") or {}
            format_config = text_config.get("format") or {}
            schema = format_config.get("schema") or {}
            if schema.get("additionalProperties") is not False:
                return httpx.Response(
                    400,
                    request=request,
                    json={
                        "error": {
                            "message": "Invalid schema: additionalProperties is required to be false",
                            "type": "invalid_request_error",
                            "param": "text.format.schema",
                            "code": "invalid_json_schema",
                        }
                    },
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "{\"status\":\"ok\"}"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "0",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = OpenAICompatibleResponsesLLM(
            base_url="https://llm.example/v1",
            api_key="llm-key",
            model="gpt-5.4",
            http_settings=settings.http_settings,
            sync_client=sync_client,
        )

        result = llm.preflight_sync()

        sync_client.close()
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["structured_output"], {"status": "ok"})

    def test_build_http_ragas_llm_preflight_retries_retryable_failure_without_tripping_breaker(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    503,
                    request=request,
                    text='{"error":{"message":"temporary upstream error","type":"bad_response_body"}}',
                )
            payload = json.loads(request.content.decode("utf-8"))
            text_config = payload.get("text") or {}
            format_config = text_config.get("format") or {}
            if format_config.get("type") == "json_schema":
                return httpx.Response(
                    200,
                    request=request,
                    json={
                        "error": None,
                        "output": [
                            {
                                "content": [
                                    {"type": "output_text", "text": "{\"status\":\"ok\"}"},
                                ]
                            }
                        ],
                    },
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {"type": "output_text", "text": "OK"},
                            ]
                        }
                    ],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "1",
                "SUPPLEMENTAL_HTTP_CIRCUIT_BREAKER_FAILURE_THRESHOLD": "1",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        result = llm.preflight_sync()
        runtime = llm.generate_text(StringPromptValue(text="只回复 OK"))

        sync_client.close()
        self.assertEqual(result["status"], "passed")
        self.assertEqual(runtime.generations[0][0].text, "OK")
        self.assertEqual(attempts, 3)

    def test_build_http_ragas_embeddings_share_request_pacer_with_same_provider_origin_and_api_key(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://provider.example/v1",
                "LLM_API_KEY": "shared-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_BASE_URL": "https://provider.example/embeddings",
                "EMBEDDING_API_KEY": "shared-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "12.5",
            }
        )

        llm = build_http_ragas_llm(settings)
        embeddings = build_http_ragas_embeddings(settings)

        self.assertIsNotNone(llm.request_pacer)
        self.assertIs(llm.request_pacer, embeddings.request_pacer)

    def test_build_http_ragas_embeddings_do_not_share_request_pacer_across_different_api_keys(self) -> None:
        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://provider.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_BASE_URL": "https://provider.example/embeddings",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "12.5",
            }
        )

        llm = build_http_ragas_llm(settings)
        embeddings = build_http_ragas_embeddings(settings)

        self.assertIsNotNone(llm.request_pacer)
        self.assertIsNot(llm.request_pacer, embeddings.request_pacer)

    def test_build_http_ragas_llm_recreates_internal_async_client_when_event_loop_changes(self) -> None:
        created_clients: list[object] = []

        class LoopBoundAsyncClient:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs
                self.loop_id = id(asyncio.get_running_loop())
                created_clients.append(self)

            async def post(self, path, json, headers):
                del path, headers
                if id(asyncio.get_running_loop()) != self.loop_id:
                    raise RuntimeError("async client reused across event loops")
                return httpx.Response(
                    200,
                    request=httpx.Request("POST", "https://llm.example/v1/responses"),
                    json={
                        "error": None,
                        "output": [
                            {
                                "content": [
                                    {"type": "output_text", "text": json["input"][0]["content"]},
                                ]
                            }
                        ],
                    },
                )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        with patch("campus_evals.supplemental_http.httpx.AsyncClient", LoopBoundAsyncClient):
            llm = build_http_ragas_llm(settings)
            asyncio.run(llm.agenerate_text(StringPromptValue(text="first")))
            asyncio.run(llm.agenerate_text(StringPromptValue(text="second")))

        self.assertEqual(len(created_clients), 2)

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
                "EVAL_RAGAS_MODEL": "gpt-5.4",
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

    def test_build_http_ragas_embeddings_recreates_internal_async_client_when_event_loop_changes(self) -> None:
        created_clients: list[object] = []

        class LoopBoundAsyncClient:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs
                self.loop_id = id(asyncio.get_running_loop())
                created_clients.append(self)

            async def post(self, path, json, headers):
                del path, headers
                if id(asyncio.get_running_loop()) != self.loop_id:
                    raise RuntimeError("async client reused across event loops")
                return httpx.Response(
                    200,
                    request=httpx.Request("POST", "https://embed.example/v1/embeddings"),
                    json={
                        "data": [
                            {"index": index, "embedding": [float(index), float(len(text))]}
                            for index, text in enumerate(json["input"])
                        ]
                    },
                )

        settings = RagasSettings.from_env(
            {
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
            }
        )

        with patch("campus_evals.supplemental_http.httpx.AsyncClient", LoopBoundAsyncClient):
            embeddings = build_http_ragas_embeddings(settings)
            asyncio.run(embeddings.aembed_documents(["first"]))
            asyncio.run(embeddings.aembed_documents(["second"]))

        self.assertEqual(len(created_clients), 2)

    def test_build_http_ragas_embeddings_aembed_documents_retries_retryable_server_error(self) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    500,
                    request=request,
                    text='{"error":{"message":"temporary upstream error","type":"bad_response_body"}}',
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "data": [
                        {"index": 0, "embedding": [1.0, 1.5]},
                    ]
                },
            )

        settings = RagasSettings.from_env(
            {
                "EMBEDDING_BASE_URL": "https://embed.example/v1",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
            }
        )
        async_client = httpx.AsyncClient(
            base_url="https://embed.example/v1",
            transport=httpx.MockTransport(handler),
        )
        embeddings = build_http_ragas_embeddings(settings, async_client=async_client)

        result = asyncio.run(embeddings.aembed_documents(["first"]))

        asyncio.run(async_client.aclose())
        self.assertEqual(result, [[1.0, 1.5]])
        self.assertEqual(attempts, 2)


class RagasScorerTest(unittest.TestCase):
    def test_build_ragas_scorer_maps_id_based_context_metric_names_back_to_standard_metric_keys(self) -> None:
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

        self.assertEqual(executed_metrics, ["id_based_context_precision", "id_based_context_recall"])
        self.assertEqual(tuple(item.metric_name for item in results), ("context_precision", "context_recall"))
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

    def test_build_ragas_scorer_uses_statement_generation_timeout_override_without_widening_other_timeouts(self) -> None:
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
            evaluate_fn=lambda **kwargs: (_ for _ in ()).throw(AssertionError("faithfulness should bypass ragas.evaluate")),
            llm_factory=lambda resolved: type("LLM", (), {"http_settings": resolved.http_settings})(),
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

    def test_build_default_ragas_metrics_binds_runtime_and_uses_single_generation_answer_relevancy(self) -> None:
        llm = object()
        embeddings = object()

        metrics = build_default_ragas_metrics(llm, embeddings)

        self.assertEqual(tuple(metric.name for metric in metrics), build_default_ragas_metric_names())
        self.assertIs(metrics[0].llm, llm)
        self.assertIs(metrics[1].llm, llm)
        self.assertIs(metrics[1].embeddings, embeddings)
        self.assertEqual(metrics[1].strictness, 1)
        self.assertIs(metrics[2].llm, llm)
        self.assertIs(metrics[3].llm, llm)

    def test_build_default_ragas_metrics_adapts_chinese_prompts_when_target_language_is_configured(self) -> None:
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
            patch("ragas.metrics._answer_relevance.ResponseRelevancePrompt.adapt", new=fake_answer_adapt),
            patch("ragas.metrics._faithfulness.StatementGeneratorPrompt.adapt", new=fake_faithfulness_adapt),
        ):
            metrics = build_default_ragas_metrics(llm, embeddings, settings=settings)

        self.assertEqual(tuple(metric.name for metric in metrics), build_default_ragas_metric_names())
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

        self.assertEqual(build_default_ragas_metric_names(), ("faithfulness", "answer_relevancy", "context_precision", "context_recall"))
        self.assertEqual(tuple(item.metric_name for item in results), build_default_ragas_metric_names())
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
        self.assertTrue(all(call["kwargs"]["run_config"].max_retries == 0 for call in captured_calls))
        self.assertTrue(all(call["kwargs"]["run_config"].max_workers == 1 for call in captured_calls))

    def test_build_ragas_scorer_marks_single_metric_timeout_as_failed_without_retrying(self) -> None:
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

        self.assertEqual(tuple(item.metric_name for item in results), build_default_ragas_metric_names())
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

    def test_build_ragas_scorer_marks_single_metric_runtime_error_as_failed_without_retrying(self) -> None:
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

        self.assertEqual(tuple(item.metric_name for item in results), build_default_ragas_metric_names())
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

    def test_build_ragas_scorer_redacts_secrets_and_falls_back_to_error_type_for_empty_runtime_messages(self) -> None:
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
                RuntimeError("circuit_open: provider origin https://llm.example::sk-secret-token is in cooldown")
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


class SupplementalRetryPolicyTest(unittest.TestCase):
    def test_retry_delay_seconds_uses_exponential_backoff_with_bounded_jitter(self) -> None:
        with patch("campus_evals.supplemental_http.random.uniform", side_effect=lambda low, high: high / 2):
            self.assertEqual(_retry_delay_seconds(1, 1.0), 1.5)
            self.assertEqual(_retry_delay_seconds(2, 1.0), 2.5)
            self.assertEqual(_retry_delay_seconds(3, 1.0), 4.5)
            self.assertEqual(_retry_delay_seconds(0, 1.0), 0.0)
            self.assertEqual(_retry_delay_seconds(2, 0.0), 0.0)


if __name__ == "__main__":
    unittest.main()
