from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    InstructorBaseRagasLLM,
    PydanticBaseModel,
    StringPromptValue,
    asyncio,
    build_http_ragas_llm,
    httpx,
    json,
    ragas_settings_from_projection,
    reset_supplemental_http_runtime_state_for_tests,
    unittest,
)


class RagasHttpTransportSyncTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_supplemental_http_runtime_state_for_tests()

    def test_build_http_ragas_llm_exposes_structured_generation_for_pydantic_ragas_prompts(
        self,
    ) -> None:
        settings = ragas_settings_from_projection(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        llm = build_http_ragas_llm(settings)

        self.assertIsInstance(llm, InstructorBaseRagasLLM)
        self.assertTrue(hasattr(llm, "agenerate_text"))

    def test_build_http_ragas_llm_agenerate_uses_responses_json_schema_payload(self) -> None:
        captured: dict[str, object] = {}

        class StructuredAnswer(PydanticBaseModel):
            question: str
            noncommittal: int

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(
                200,
                request=request,
                json={
                    "error": None,
                    "output": [
                        {
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": '{"question":"奖学金怎么申请？","noncommittal":0}',
                                },
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
                "RAGAS_REASONING_EFFORT": "none",
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

        result = asyncio.run(
            llm.agenerate(
                prompt="Generate one question.",
                response_model=StructuredAnswer,
            )
        )

        asyncio.run(async_client.aclose())
        body = captured["body"]
        text_format = body["text"]["format"]
        self.assertEqual(captured["url"], "https://llm.example/v1/responses")
        self.assertEqual(text_format["type"], "json_schema")
        self.assertEqual(text_format["name"], "StructuredAnswer")
        self.assertTrue(text_format["strict"])
        self.assertEqual(body["reasoning"], {"effort": "none"})
        self.assertEqual(body["max_output_tokens"], 256)
        self.assertEqual(result.question, "奖学金怎么申请？")
        self.assertEqual(result.noncommittal, 0)

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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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
                "max_output_tokens": 256,
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

        settings = ragas_settings_from_projection(
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

        settings = ragas_settings_from_projection(
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
