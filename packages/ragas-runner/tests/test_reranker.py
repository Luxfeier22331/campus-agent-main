from __future__ import annotations

import json
import unittest
from typing import Any
from urllib.request import Request

from campus_ragas_runner.provider_config import ProviderProfile
from campus_ragas_runner.reranker import RerankerProviderError, RerankResult, rerank_documents


class FakeResponse:
    def __init__(self, payload: object, *, status: int = 200) -> None:
        self.payload = payload
        self.status = status

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, _limit: int) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class RerankerAdapterTest(unittest.TestCase):
    def test_posts_cohere_rerank_request_and_parses_ranked_results(self) -> None:
        requests: list[Request] = []

        def fake_urlopen(request: Request, **_kwargs: Any) -> FakeResponse:
            requests.append(request)
            return FakeResponse(
                {
                    "results": [
                        {"index": 1, "relevance_score": 0.91},
                        {"index": 0, "relevance_score": 0.22},
                    ]
                }
            )

        results = rerank_documents(
            ProviderProfile(
                api_key="reranker-key",
                base_url="https://reranker.example/v2",
                model="rerank-v4",
                timeout_seconds=90,
            ),
            query="library hours",
            documents=("unrelated", "library hours are 08:00-22:00"),
            urlopen_impl=fake_urlopen,
        )

        self.assertEqual(
            results,
            (
                RerankResult(index=1, relevance_score=0.91),
                RerankResult(index=0, relevance_score=0.22),
            ),
        )
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.full_url, "https://reranker.example/v2/rerank")
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.headers["Authorization"], "Bearer reranker-key")
        self.assertEqual(
            json.loads((request.data or b"{}").decode("utf-8")),
            {
                "documents": ["unrelated", "library hours are 08:00-22:00"],
                "model": "rerank-v4",
                "query": "library hours",
            },
        )

    def test_rejects_invalid_rank_indexes_and_scores(self) -> None:
        profile = ProviderProfile(
            api_key="reranker-key",
            base_url="https://reranker.example/v2",
            model="rerank-v4",
            timeout_seconds=90,
        )
        for payload in (
            {"results": [{"index": 2, "relevance_score": 0.5}]},
            {
                "results": [
                    {"index": 0, "relevance_score": 0.5},
                    {"index": 0, "relevance_score": 0.4},
                ]
            },
            {"results": [{"index": 0, "relevance_score": float("nan")}]},
        ):
            with (
                self.subTest(payload=payload),
                self.assertRaisesRegex(RerankerProviderError, "response is invalid"),
            ):
                rerank_documents(
                    profile,
                    query="query",
                    documents=("document",),
                    urlopen_impl=lambda *_args, payload=payload, **_kwargs: FakeResponse(payload),
                )
