from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    RagasSettings,
    StringPromptValue,
    asyncio,
    build_http_ragas_llm,
    httpx,
    patch,
    reset_supplemental_http_runtime_state_for_tests,
    unittest,
)


class RagasHttpTransportAsyncTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_supplemental_http_runtime_state_for_tests()

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
