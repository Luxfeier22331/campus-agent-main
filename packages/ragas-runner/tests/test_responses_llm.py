from __future__ import annotations

import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from campus_ragas_runner.responses_llm import (
    RAGAS_MAX_OUTPUT_TOKENS,
    RAGAS_USER_AGENT,
    ResponsesRagasLLM,
)
from openai import AsyncOpenAI, OpenAI
from pydantic import BaseModel


class ExtractedAnswer(BaseModel):
    answer: str


class FakeResponse:
    def __init__(self, output_text: str = '{"answer":"ok"}') -> None:
        self.output_text = output_text


class FakeResponses:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[dict[str, object]] = []

    def create(self, **kwargs: object) -> FakeResponse:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return FakeResponse()


class FakeAsyncResponses(FakeResponses):
    async def create(self, **kwargs: object) -> FakeResponse:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return FakeResponse()


class FakeClient:
    def __init__(self, responses: FakeResponses | FakeAsyncResponses) -> None:
        self.responses = responses


class ResponsesRagasLLMTest(unittest.TestCase):
    def test_real_openai_clients_use_native_responses_schema(self) -> None:
        requests: list[dict[str, object]] = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                raw_request = self.rfile.read(content_length)
                requests.append(
                    {
                        "path": self.path,
                        "user_agent": self.headers.get("user-agent"),
                        "body": json.loads(raw_request),
                    }
                )
                body = {
                    "id": "resp_test",
                    "object": "response",
                    "created_at": 1,
                    "model": "deepseek-v4-flash-0731",
                    "output": [
                        {
                            "id": "message_test",
                            "type": "message",
                            "role": "assistant",
                            "status": "completed",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": '{"answer":"ok"}',
                                }
                            ],
                        }
                    ],
                    "status": "completed",
                }
                raw = json.dumps(body).encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *_args: object) -> None:
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        sync_client = OpenAI(
            api_key="test",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            default_headers={"User-Agent": RAGAS_USER_AGENT},
        )
        async_client = AsyncOpenAI(
            api_key="test",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
            default_headers={"User-Agent": RAGAS_USER_AGENT},
        )
        try:
            llm = ResponsesRagasLLM(
                client=sync_client,
                async_client=async_client,
                model="deepseek-v4-flash-0731",
            )
            self.assertEqual(llm.generate("extract this", ExtractedAnswer).answer, "ok")
            self.assertEqual(
                asyncio.run(llm.agenerate("extract that", ExtractedAnswer)).answer,
                "ok",
            )
        finally:
            sync_client.close()
            asyncio.run(async_client.close())
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual([request["path"] for request in requests], ["/v1/responses"] * 2)
        self.assertEqual(
            [request["user_agent"] for request in requests],
            [RAGAS_USER_AGENT] * 2,
        )
        for request in requests:
            body = request["body"]
            assert isinstance(body, dict)
            self.assertEqual(body["model"], "deepseek-v4-flash-0731")
            self.assertEqual(body["max_output_tokens"], RAGAS_MAX_OUTPUT_TOKENS)
            self.assertEqual(body["temperature"], 0)
            self.assertNotIn("tools", body)
            self.assertNotIn("tool_choice", body)
            self.assertEqual(body["text"]["format"]["type"], "json_schema")
            self.assertEqual(body["text"]["format"]["name"], "ExtractedAnswer")

    def test_builds_native_schema_and_parses_sync_and_async_results(self) -> None:
        sync_responses = FakeResponses()
        async_responses = FakeAsyncResponses()
        llm = ResponsesRagasLLM(
            client=FakeClient(sync_responses),  # type: ignore[arg-type]
            async_client=FakeClient(async_responses),  # type: ignore[arg-type]
            model="deepseek-v4-flash-0731",
        )

        self.assertEqual(
            llm.generate("extract this", ExtractedAnswer), ExtractedAnswer(answer="ok")
        )
        self.assertEqual(
            asyncio.run(llm.agenerate("extract that", ExtractedAnswer)),
            ExtractedAnswer(answer="ok"),
        )

        self.assertEqual(sync_responses.calls[0]["input"], "extract this")
        self.assertEqual(async_responses.calls[0]["input"], "extract that")
        for request in [sync_responses.calls[0], async_responses.calls[0]]:
            self.assertEqual(request["model"], "deepseek-v4-flash-0731")
            self.assertEqual(request["temperature"], 0)
            self.assertEqual(request["max_output_tokens"], RAGAS_MAX_OUTPUT_TOKENS)
            self.assertNotIn("tools", request)
            self.assertNotIn("tool_choice", request)
            self.assertEqual(request["text"]["format"]["type"], "json_schema")

    def test_provider_error_is_not_hidden(self) -> None:
        error = RuntimeError("provider failed")
        llm = ResponsesRagasLLM(
            client=FakeClient(FakeResponses(error=error)),  # type: ignore[arg-type]
            async_client=FakeClient(FakeAsyncResponses(error=error)),  # type: ignore[arg-type]
            model="deepseek-v4-flash-0731",
        )
        with self.assertRaisesRegex(RuntimeError, "provider failed"):
            llm.generate("extract this", ExtractedAnswer)
        with self.assertRaisesRegex(RuntimeError, "provider failed"):
            asyncio.run(llm.agenerate("extract that", ExtractedAnswer))


if __name__ == "__main__":
    unittest.main()
