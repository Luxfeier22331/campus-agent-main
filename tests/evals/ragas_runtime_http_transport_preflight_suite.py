from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    OpenAICompatibleChatCompletionsLLM,
    OpenAICompatibleResponsesLLM,
    RagasSettings,
    StringPromptValue,
    SupplementalPreflightFailedError,
    asyncio,
    build_http_ragas_llm,
    httpx,
    json,
    ragas_settings_from_projection,
    reset_supplemental_http_runtime_state_for_tests,
    unittest,
)


class RagasHttpTransportPreflightTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_supplemental_http_runtime_state_for_tests()

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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = RagasSettings(
            llm_base_url="https://llm.example/v1",
            llm_api_key="llm-key",
            llm_model="gpt-5.4",
            llm_transport="chat_completions",
            embedding_api_key="embed-key",
            embedding_model="Qwen3-Embedding-4B",
            embedding_dimensions=2560,
            reasoning_effort="none",
            text_verbosity="low",
            max_output_tokens=128,
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

        settings = RagasSettings(
            llm_base_url="https://llm.example/v1",
            llm_api_key="llm-key",
            llm_model="gpt-5.4",
            llm_transport="chat_completions",
            embedding_api_key="embed-key",
            embedding_model="Qwen3-Embedding-4B",
            embedding_dimensions=2560,
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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
