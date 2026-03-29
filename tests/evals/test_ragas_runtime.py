from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from langchain_core.messages import HumanMessage
from langchain_core.prompt_values import StringPromptValue

from campus_evals import (
    RagasProjection,
    RagasSettings,
    build_default_ragas_metric_names,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    build_ragas_dataset,
    build_ragas_scorer,
)
from campus_evals._langchain_compat import build_langchain_chat_model
from campus_evals.settings import SupplementalHTTPSettings
from campus_evals.supplemental_http import (
    SupplementalPreflightFailedError,
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
                "LLM_CHAT_MODEL": "qwen-chat",
                "LLM_REASONING_MODEL": "qwen-reasoning",
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
        self.assertEqual(settings.llm_model, "qwen-reasoning")
        self.assertTrue(settings.use_responses_api)
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "LLM_REASONING_MODEL": "qwen-reasoning",
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
    def setUp(self) -> None:
        reset_supplemental_http_runtime_state_for_tests()

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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
        with self.assertRaisesRegex(RuntimeError, "circuit_open"):
            llm.generate_text(StringPromptValue(text="只回复 OK"))

        sync_client.close()
        self.assertEqual(attempts, 2)

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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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

        first.preflight_sync()
        second.preflight_sync()

        first_client.close()
        second_client.close()
        self.assertEqual(attempts, 1)

    def test_build_http_ragas_llm_preflight_requires_structured_output_probe(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
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
                                    {"type": "output_text", "text": "{}"},
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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

        with self.assertRaises(SupplementalPreflightFailedError):
            llm.preflight_sync()

        sync_client.close()

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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "RAGAS_LLM_MODEL": "gpt-5.4",
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
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "45",
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
        self.assertEqual(captured["kwargs"]["run_config"].max_retries, 0)
        self.assertEqual(captured["kwargs"]["run_config"].max_workers, 1)

    def test_build_ragas_scorer_does_not_retry_outer_evaluate_timeout(self) -> None:
        attempts = 0

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

        def flaky_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            del dataset, metrics, llm, embeddings, kwargs
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise TimeoutError("judge timed out")
            return FakeEvaluationResult()

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "LLM_REASONING_MODEL": "qwen-reasoning",
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

        with self.assertRaisesRegex(TimeoutError, "judge timed out"):
            scorer(
                RagasProjection(
                    case_id="case-retry",
                    user_input="图书馆开放时间是什么？",
                    response="08:00 到 22:00。",
                    retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                    reference="图书馆开放时间为 08:00-22:00。",
                )
            )

        self.assertEqual(attempts, 1)

    def test_build_ragas_scorer_does_not_retry_outer_do_request_failed_runtime_error(self) -> None:
        attempts = 0

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

        def flaky_evaluate(*, dataset, metrics, llm, embeddings, **kwargs):
            del dataset, metrics, llm, embeddings, kwargs
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError(
                    '500 {"error":{"message":"upstream error: do request failed","type":"new_api_error","code":"do_request_failed"}}'
                )
            return FakeEvaluationResult()

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "LLM_REASONING_MODEL": "qwen-reasoning",
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

        with self.assertRaisesRegex(RuntimeError, "do request failed"):
            scorer(
                RagasProjection(
                    case_id="case-retry-do-request-failed",
                    user_input="图书馆开放时间是什么？",
                    response="08:00 到 22:00。",
                    retrieved_contexts=("图书馆开放时间为 08:00-22:00。",),
                    reference="图书馆开放时间为 08:00-22:00。",
                )
            )

        self.assertEqual(attempts, 1)


if __name__ == "__main__":
    unittest.main()
