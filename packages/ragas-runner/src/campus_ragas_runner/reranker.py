from __future__ import annotations

import json
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from campus_ragas_runner.provider_config import ProviderProfile

RERANK_PATH = "/rerank"
MAX_RESPONSE_BYTES = 1 << 20


@dataclass(frozen=True, slots=True)
class RerankResult:
    index: int
    relevance_score: float


class RerankerProviderError(RuntimeError):
    """A provider request or response failed the local reranker contract."""


def rerank_documents(
    profile: ProviderProfile,
    *,
    query: str,
    documents: Sequence[str],
    urlopen_impl: Callable[..., Any] = urlopen,
) -> tuple[RerankResult, ...]:
    base_url = profile.base_url
    if not isinstance(base_url, str) or not base_url.strip():
        raise RerankerProviderError("eval_ragas_reranker.base_url is required")
    normalized_query = _required_text(query, "query")
    normalized_documents = tuple(_required_text(document, "documents[]") for document in documents)
    body = json.dumps(
        {
            "documents": list(normalized_documents),
            "model": profile.model,
            "query": normalized_query,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = Request(
        f"{base_url.rstrip('/')}{RERANK_PATH}",
        data=body,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {profile.api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen_impl(request, timeout=profile.timeout_seconds) as response:
            status = int(getattr(response, "status", 200))
            raw = response.read(MAX_RESPONSE_BYTES)
    except HTTPError as error:
        raise RerankerProviderError(f"reranker provider returned HTTP {error.code}") from error
    except URLError as error:
        raise RerankerProviderError("reranker provider request failed") from error
    except (TimeoutError, OSError) as error:
        raise RerankerProviderError("reranker provider request failed") from error
    if status < 200 or status >= 300:
        raise RerankerProviderError(f"reranker provider returned HTTP {status}")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as error:
        raise RerankerProviderError("reranker provider response is invalid JSON") from error
    return _parse_results(payload, document_count=len(normalized_documents))


def _parse_results(payload: object, *, document_count: int) -> tuple[RerankResult, ...]:
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise RerankerProviderError("reranker provider response is invalid")
    results: list[RerankResult] = []
    seen_indexes: set[int] = set()
    for item in payload["results"]:
        if not isinstance(item, dict):
            raise RerankerProviderError("reranker provider response is invalid")
        index = item.get("index")
        score = item.get("relevance_score")
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or index < 0
            or index >= document_count
            or index in seen_indexes
            or isinstance(score, bool)
            or not isinstance(score, int | float)
            or not math.isfinite(float(score))
        ):
            raise RerankerProviderError("reranker provider response is invalid")
        seen_indexes.add(index)
        results.append(RerankResult(index=index, relevance_score=float(score)))
    return tuple(results)


def _required_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RerankerProviderError(f"{field} is required")
    return value
