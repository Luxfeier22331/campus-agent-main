from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    InstructorBaseRagasLLM,
    OpenAICompatibleChatCompletionsLLM,
    OpenAICompatibleResponsesLLM,
    RagasSettings,
    StringPromptValue,
    SupplementalPreflightFailedError,
    asyncio,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    httpx,
    json,
    patch,
    reset_supplemental_http_runtime_state_for_tests,
    unittest,
)


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

    def test_build_http_ragas_llm_opens_shared_circuit_breaker_after_repeated_provider_failures(
        self,
    ) -> None:
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
                    ],
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

    def test_build_http_ragas_llm_generate_text_retries_do_request_failed_server_error(
        self,
    ) -> None:
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

    def test_build_http_ragas_llm_preflight_failure_opens_runtime_breaker_until_cooldown(
        self,
    ) -> None:
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

    def test_build_http_ragas_llm_hard_unavailable_provider_opens_shared_circuit_after_single_failure(
        self,
    ) -> None:
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
                return httpx.Response(
                    503,
                    request=request,
                    text='{"error":{"message":"structured unavailable","type":"api_error"}}',
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
        self.assertNotEqual(
            ((captured_payloads[0].get("text") or {}).get("format") or {}).get("type"),
            "json_schema",
        )

    def test_build_http_ragas_llm_preflight_fast_fails_when_completed_response_has_no_output_items(
        self,
    ) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                200,
                request=request,
                json={
                    "id": "resp_contract_violation",
                    "status": "completed",
                    "usage": {"output_tokens": 5},
                    "output": [],
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
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        with self.assertRaises(SupplementalPreflightFailedError) as raised:
            llm.preflight_sync()

        sync_client.close()
        self.assertEqual(attempts, 1)
        self.assertEqual(raised.exception.disposition, "non_retryable_request")
        self.assertIn("provider_contract_violation", raised.exception.reasons)
        self.assertIn("responses contract violation", str(raised.exception))

    def test_build_http_ragas_llm_posts_chat_completions_payload_when_transport_selected(
        self,
    ) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                request=request,
                json={
                    "choices": [
                        {
                            "index": 0,
                            "finish_reason": "stop",
                            "message": {
                                "role": "assistant",
                                "content": "OK",
                            },
                        }
                    ]
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_RAGAS_LLM_TRANSPORT": "chat_completions",
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
        self.assertEqual(captured["url"], "https://llm.example/v1/chat/completions")
        self.assertEqual(
            captured["body"],
            {
                "model": "gpt-5.4",
                "messages": [{"role": "user", "content": "只回复 OK"}],
                "temperature": 0.01,
                "reasoning_effort": "none",
                "verbosity": "low",
                "max_completion_tokens": 128,
            },
        )

    def test_build_http_ragas_llm_preflight_fast_fails_when_chat_completions_has_no_message_content(
        self,
    ) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                200,
                request=request,
                json={
                    "id": "chatcmpl_contract_violation",
                    "usage": {"completion_tokens": 5},
                    "choices": [],
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_RAGAS_LLM_TRANSPORT": "chat_completions",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "1",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = build_http_ragas_llm(settings, sync_client=sync_client)

        with self.assertRaises(SupplementalPreflightFailedError) as raised:
            llm.preflight_sync()

        sync_client.close()
        self.assertEqual(attempts, 1)
        self.assertEqual(raised.exception.disposition, "non_retryable_request")
        self.assertIn("provider_contract_violation", raised.exception.reasons)
        self.assertIn("chat completions contract violation", str(raised.exception))

    def test_openai_compatible_responses_llm_preflight_supports_providers_requiring_closed_json_schema(
        self,
    ) -> None:
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
                                {"type": "output_text", "text": '{"status":"ok"}'},
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

    def test_openai_compatible_responses_llm_preflight_fast_fails_when_completed_response_has_no_output_items(
        self,
    ) -> None:
        attempts = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            return httpx.Response(
                200,
                request=request,
                json={
                    "id": "resp_structured_contract_violation",
                    "status": "completed",
                    "usage": {"output_tokens": 13},
                    "output": [],
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

        with self.assertRaises(SupplementalPreflightFailedError) as raised:
            llm.preflight_sync()

        sync_client.close()
        self.assertEqual(attempts, 1)
        self.assertEqual(raised.exception.disposition, "non_retryable_request")
        self.assertIn("provider_contract_violation", raised.exception.reasons)
        self.assertIn("responses contract violation", str(raised.exception))

    def test_openai_compatible_chat_completions_llm_preflight_supports_json_schema_response_format(
        self,
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            payload = json.loads(request.content.decode("utf-8"))
            response_format = payload.get("response_format") or {}
            json_schema = response_format.get("json_schema") or {}
            schema = json_schema.get("schema") or {}
            if schema.get("additionalProperties") is not False:
                return httpx.Response(
                    400,
                    request=request,
                    json={
                        "error": {
                            "message": "Invalid schema: additionalProperties is required to be false",
                            "type": "invalid_request_error",
                            "param": "response_format.json_schema.schema",
                            "code": "invalid_json_schema",
                        }
                    },
                )
            return httpx.Response(
                200,
                request=request,
                json={
                    "choices": [
                        {
                            "index": 0,
                            "finish_reason": "stop",
                            "message": {
                                "role": "assistant",
                                "content": '{"status":"ok"}',
                            },
                        }
                    ]
                },
            )

        settings = RagasSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_RAGAS_LLM_TRANSPORT": "chat_completions",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "SUPPLEMENTAL_HTTP_RETRY_ATTEMPTS": "0",
            }
        )
        sync_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        llm = OpenAICompatibleChatCompletionsLLM(
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

    def test_build_http_ragas_llm_preflight_retries_retryable_failure_without_tripping_breaker(
        self,
    ) -> None:
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
                                    {"type": "output_text", "text": '{"status":"ok"}'},
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

    def test_build_http_ragas_embeddings_share_request_pacer_with_same_provider_origin_and_api_key(
        self,
    ) -> None:
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

    def test_build_http_ragas_embeddings_do_not_share_request_pacer_across_different_api_keys(
        self,
    ) -> None:
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

    def test_build_http_ragas_llm_recreates_internal_async_client_when_event_loop_changes(
        self,
    ) -> None:
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
                    ],
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

    def test_build_http_ragas_embeddings_recreates_internal_async_client_when_event_loop_changes(
        self,
    ) -> None:
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

    def test_build_http_ragas_embeddings_aembed_documents_retries_retryable_server_error(
        self,
    ) -> None:
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
