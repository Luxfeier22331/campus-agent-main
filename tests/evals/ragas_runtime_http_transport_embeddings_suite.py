from __future__ import annotations

from tests.evals.ragas_runtime_test_support import (
    RagasSettings,
    StringPromptValue,
    asyncio,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
    httpx,
    json,
    patch,
    reset_supplemental_http_runtime_state_for_tests,
    unittest,
)


class RagasHttpTransportEmbeddingsTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_supplemental_http_runtime_state_for_tests()

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
