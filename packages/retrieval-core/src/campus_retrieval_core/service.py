from __future__ import annotations

from campus_contracts import EvidenceBundle

from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend, RetrievalBackendError
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

_BACKEND_CACHE: dict[object, QdrantRetrievalBackend] = {}


def clear_backend_cache() -> None:
    _BACKEND_CACHE.clear()


def _get_cached_backend(settings: object) -> QdrantRetrievalBackend:
    backend = _BACKEND_CACHE.get(settings)
    if backend is None:
        backend = QdrantRetrievalBackend(settings)
        _BACKEND_CACHE[settings] = backend
    return backend


def retrieve_sources(
    query: str,
    *,
    corpus: str,
    collection: str,
    campus_scope: str | None = None,
    acl_groups: tuple[str, ...] = (),
    top_k: int = 3,
    backend: QdrantRetrievalBackend | None = None,
) -> EvidenceBundle:
    request = RetrievalRequest(
        query_text=query,
        corpus=corpus,
        collection=collection,
        campus_scope=campus_scope,
        acl_groups=acl_groups,
        top_k=top_k,
    )
    try:
        runtime_backend = backend or _get_cached_backend(RetrievalSettings.from_env())
    except Exception as exc:  # pragma: no cover - exercised via caller mapping
        raise RetrievalBackendError("failed to initialize retrieval backend") from exc
    return runtime_backend.retrieve(request)
