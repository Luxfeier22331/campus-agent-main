from __future__ import annotations

import math
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_ingestion_core.sparse import SparseEmbeddingModel
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from qdrant_client.http.exceptions import ResponseHandlingException

from campus_retrieval_core.backend_qdrant_filters import _build_qdrant_filter
from campus_retrieval_core.backend_qdrant_query import (
    _build_hybrid_prefetch as _build_hybrid_prefetch_impl,
)
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS = 300.0
DEFAULT_DENSE_QUERY_CACHE_MAX_ENTRIES = 2048
DEFAULT_REGISTRY_LOOKUP_CACHE_TTL_SECONDS = 60.0
DEFAULT_REGISTRY_LOOKUP_CACHE_MAX_ENTRIES = 4096

_QDRANT_READ_RETRY_ATTEMPTS = 3
_QDRANT_READ_RETRY_BACKOFF_SECONDS = 0.5
_QDRANT_TRANSIENT_ERROR_TEXT = (
    "timed out",
    "timeout",
    "temporarily unavailable",
    "connection reset",
    "handshake",
)


@dataclass(frozen=True, slots=True)
class _RetrievalDeadline:
    expires_at: float | None = None

    @classmethod
    def from_timeout_ms(cls, timeout_ms: int | None) -> _RetrievalDeadline:
        if timeout_ms is None:
            return cls()
        return cls(expires_at=time.monotonic() + (timeout_ms / 1000.0))

    def remaining_seconds(self) -> float | None:
        if self.expires_at is None:
            return None
        return max(0.0, self.expires_at - time.monotonic())

    def is_expired(self) -> bool:
        remaining_seconds = self.remaining_seconds()
        return remaining_seconds is not None and remaining_seconds <= 0

    def qdrant_timeout_seconds(self) -> int | None:
        remaining_seconds = self.remaining_seconds()
        if remaining_seconds is None:
            return None
        return max(1, math.ceil(remaining_seconds))


def _build_hybrid_prefetch(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    embedding_model: object,
    sparse_embedding_model: SparseEmbeddingModel,
    dense_query_embedding: Sequence[float] | None = None,
    query_filter: qdrant_models.Filter | None = None,
    build_qdrant_filter_fn=_build_qdrant_filter,
) -> list[qdrant_models.Prefetch]:
    return _build_hybrid_prefetch_impl(
        request=request,
        profile=profile,
        embedding_model=embedding_model,
        sparse_embedding_model=sparse_embedding_model,
        dense_query_embedding=dense_query_embedding,
        query_filter=query_filter,
        build_qdrant_filter_fn=build_qdrant_filter_fn,
    )


def _build_qdrant_client(settings: RetrievalSettings) -> QdrantClient:
    client_factory = _resolve_qdrant_client_factory()
    if settings.qdrant_url == ":memory:":
        return client_factory(location=":memory:")
    return client_factory(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=settings.qdrant_timeout_seconds,
        cloud_inference=False,
        check_compatibility=False,
        trust_env=False,
    )


def _resolve_qdrant_client_factory() -> type[QdrantClient]:
    backend_module = sys.modules.get("campus_retrieval_core.backend_qdrant")
    if backend_module is None:
        return QdrantClient
    return getattr(backend_module, "QdrantClient", QdrantClient)


def _retry_qdrant_read[RetryResultT](
    operation: Callable[[], RetryResultT],
    *,
    deadline: _RetrievalDeadline | None = None,
) -> RetryResultT:
    last_error: ResponseHandlingException | None = None
    for attempt in range(1, _QDRANT_READ_RETRY_ATTEMPTS + 1):
        if deadline is not None and deadline.is_expired():
            raise TimeoutError("qdrant read deadline exceeded")
        try:
            return operation()
        except ResponseHandlingException as exc:
            if (
                not _looks_like_transient_qdrant_error(exc)
                or attempt >= _QDRANT_READ_RETRY_ATTEMPTS
            ):
                raise
            last_error = exc
            backoff_seconds = _QDRANT_READ_RETRY_BACKOFF_SECONDS * attempt
            remaining_seconds = deadline.remaining_seconds() if deadline is not None else None
            if remaining_seconds is not None:
                if remaining_seconds <= 0:
                    raise
                backoff_seconds = min(backoff_seconds, remaining_seconds)
            time.sleep(backoff_seconds)
    if last_error is not None:
        raise last_error
    raise RuntimeError("retry helper exhausted without result")


def _looks_like_transient_qdrant_error(error: ResponseHandlingException) -> bool:
    normalized = str(error).strip().lower()
    return any(fragment in normalized for fragment in _QDRANT_TRANSIENT_ERROR_TEXT)
